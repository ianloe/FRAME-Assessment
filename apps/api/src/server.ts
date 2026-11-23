import { config } from './config.js';
import { pool } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { runSeed } from './db/seed.js';
import { buildApp } from './app.js';

async function main() {
  await runMigrations();
  await runSeed();

  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`FRAME API listening on port ${config.port}`);
}

main().catch((err) => {
  console.error('Failed to start FRAME API:', err);
  process.exit(1);
});
