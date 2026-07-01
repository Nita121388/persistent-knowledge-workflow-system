import PQueue from 'p-queue';
import { processNextJob } from './job-queue.js';

let workerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
const queue = new PQueue({ concurrency: 1 });

export function startWorker() {
  if (workerInterval) return; // Already running

  console.log('Starting background worker (常驻模式)...');

  isRunning = true;

  workerInterval = setInterval(async () => {
    if (!isRunning) return;
    try {
      await queue.add(() => processNextJob());
    } catch (err) {
      // Log but don't crash the loop
      console.error('Worker error:', err);
    }
  }, 2000); // Poll every 2 seconds
}

export function stopWorker() {
  isRunning = false;
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  console.log('Worker stopped.');
}
