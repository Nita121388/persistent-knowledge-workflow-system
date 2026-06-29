import { readFileSync } from 'node:fs';

let watcher: any = null;

export function startFileWatcher() {
  // Check if watcher already started
  if (watcher) return;

  // Lazy start: load inboxPath from config
  try {
    const configPath = new URL('../../config.json', import.meta.url).pathname;
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    // No config yet — settings not configured
    return;
  }

  // Dynamic import chokidar
  try {
    // Watcher will be started after settings are configured
    console.log('File watcher ready (will start after settings configured)');
  } catch (err) {
    console.error('Failed to start file watcher:', err);
  }
}

export function initFileWatcher(inboxPath: string) {
  if (watcher) {
    watcher.close();
  }

  import('chokidar').then(({ watch }) => {
    watcher = watch(inboxPath, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on('add', async (filePath: string) => {
      if (!filePath.endsWith('.md')) return;

      console.log(`New file detected: ${filePath}`);

      // Wait a bit for the file to be fully written
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        const { createJob } = await import('./worker/job-queue.js');
        await createJob({
          type: 'scan_inbox',
          payload: { mode: 'incremental' },
        });
      } catch (err) {
        console.error('Failed to create scan job:', err);
      }
    });

    console.log(`File watcher started on: ${inboxPath}`);
  }).catch(err => {
    console.error('Failed to load chokidar:', err);
  });
}

export function stopFileWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
