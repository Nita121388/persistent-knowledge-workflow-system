import { getDb, schema } from '@pkws/storage';
import { genJobId, type JobType, type Job } from '@pkws/shared/utils.js';
import { eq, and } from 'drizzle-orm';

export interface CreateJobParams {
  type: JobType;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export async function createJob(params: CreateJobParams): Promise<Job> {
  const db = getDb();
  const id = genJobId();
  const now = new Date().toISOString();

  // Check idempotency
  if (params.idempotencyKey) {
    const existing = await db.select()
      .from(schema.jobs)
      .where(eq(schema.jobs.idempotencyKey, params.idempotencyKey))
      .get();

    if (existing) {
      return existing as unknown as Job;
    }
  }

  const values = {
    id,
    type: params.type,
    status: 'queued' as const,
    payloadJson: JSON.stringify(params.payload),
    idempotencyKey: params.idempotencyKey || null,
    retryCount: 0,
    createdAt: now,
  };

  db.insert(schema.jobs).values(values).run();

  // Notify worker
  if (typeof processJob !== 'undefined') {
    // Worker will pick it up on next cycle
  }

  return { ...values, resultJson: null, errorMessage: null, startedAt: null, finishedAt: null };
}

// Keep track of running jobs
const runningJobs = new Set<string>();

export async function processNextJob(): Promise<boolean> {
  const db = getDb();

  const job = await db.transaction(async (tx) => {
    // Find next queued job
    const next = await tx.select()
      .from(schema.jobs)
      .where(eq(schema.jobs.status, 'queued'))
      .orderBy(schema.jobs.createdAt)
      .limit(1)
      .get();

    if (!next) return null;

    // Mark as running
    tx.update(schema.jobs)
      .set({ status: 'running', startedAt: new Date().toISOString() })
      .where(eq(schema.jobs.id, next.id))
      .run();

    return next;
  });

  if (!job) return false;

  const jobId = job.id;
  runningJobs.add(jobId);

  try {
    const { handleJob } = await import('./handlers.js');
    await handleJob(job as any);

    db.update(schema.jobs)
      .set({ status: 'succeeded', finishedAt: new Date().toISOString() })
      .where(eq(schema.jobs.id, jobId))
      .run();
  } catch (err: any) {
    console.error(`Job ${jobId} failed:`, err);

    const retryCount = job.retryCount + 1;
    if (retryCount < 3) {
      db.update(schema.jobs)
        .set({
          status: 'queued',
          retryCount,
          errorMessage: err.message,
          finishedAt: null,
        })
        .where(eq(schema.jobs.id, jobId))
        .run();
    } else {
      db.update(schema.jobs)
        .set({ status: 'failed', errorMessage: err.message, finishedAt: new Date().toISOString() })
        .where(eq(schema.jobs.id, jobId))
        .run();
    }
  } finally {
    runningJobs.delete(jobId);
  }

  return true;
}

export async function isJobPending(caseId: string, type: JobType): Promise<boolean> {
  const db = getDb();
  const existing = await db.select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.type, type),
        eq(schema.jobs.status, 'queued'),
      )
    )
    .limit(1)
    .get();
  return !!existing;
}

import { and } from 'drizzle-orm';
