import Fastify from 'fastify';
import cors from '@fastify/cors';
import { initStorage } from '@pkws/storage';
import { settingsRoutes } from './routes/settings.js';
import { caseRoutes } from './routes/cases.js';
import { inboxRoutes } from './routes/inbox.js';
import { anchorRoutes } from './routes/anchors.js';
import { workspaceRuleRoutes } from './routes/workspace-rules.js';
import { jobRoutes } from './routes/jobs.js';
import { healthRoutes } from './routes/health.js';
import { startWorker } from './worker/index.js';
import { initFileWatcher } from './watcher.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // Check if settings exist to know if we need setup
  const configPath = path.join(__dirname, '..', 'config.json');
  let needsSetup = true;
  let workspacePath = '';

  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      workspacePath = config.workspacePath || '';
      if (workspacePath && fs.existsSync(workspacePath)) {
        needsSetup = false;
      }
    } catch {
      // config corrupt, needs setup
    }
  }

  if (!needsSetup) {
    initStorage(workspacePath);
    startWorker();
    initFileWatcher();
  }

  // Register routes
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(settingsRoutes, { prefix: '/api' });
  await app.register(caseRoutes, { prefix: '/api' });
  await app.register(inboxRoutes, { prefix: '/api' });
  await app.register(anchorRoutes, { prefix: '/api' });
  await app.register(workspaceRuleRoutes, { prefix: '/api' });
  await app.register(jobRoutes, { prefix: '/api' });

  const port = process.env.PORT ? parseInt(process.env.PORT) : 3721;
  const host = process.env.HOST || '0.0.0.0';

  try {
    await app.listen({ port, host });
    console.log(`PKWS Server running at http://localhost:${port}`);
    console.log(`Status: ${needsSetup ? 'SETUP REQUIRED' : 'READY'}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
