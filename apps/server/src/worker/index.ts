import PQueue from 'p-queue';
import { processNextJob } from './job-queue.js';

let workerInterval: ReturnType<typeof setInterval> | null = null;
const queue = new PQueue({ concurrency: 1 });

export function startWorker() {
  if (workerInterval) return; // Already running

  console.log('Starting background worker...');

  workerInterval = setInterval(async () => {
    try {
      await queue.add(() => processNextJob());
    } catch (err) {
      // Log but don't crash the loop
      console.error('Worker error:', err);
    }
  }, 2000); // Poll every 2 seconds
}

export function stopWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}
