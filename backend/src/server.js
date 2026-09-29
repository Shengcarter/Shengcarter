'use strict';

const os = require('os');
const config = require('./config');
const logger = require('./config/logger');
const db = require('./config/database');
const createApp = require('./app');
const settingsService = require('./services/settingsService');
const jobs = require('./jobs');
const backupService = require('./services/backupService');

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

async function start() {
  try {
    await db.ping();
  } catch (error) {
    logger.fatal({ err: error }, 'Cannot connect to MySQL. Check the DATABASE_* values in .env and that MySQL is running.');
    process.exit(1);
  }

  try {
    await settingsService.load();
  } catch (error) {
    logger.fatal({ err: error }, 'Database is not initialised. Run "npm run setup:db" in the backend folder first.');
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    logger.info(`${config.appName} is running`);
    logger.info(`  Local:   http://localhost:${config.port}`);
    if (config.host === '0.0.0.0') {
      for (const address of lanAddresses()) logger.info(`  Network: http://${address}:${config.port}`);
    }
  });

  if (config.jobsEnabled) {
    jobs.start();
    backupService.schedule();
  }

  const shutdown = (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    jobs.stop();
    server.close(async () => {
      await db.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

start();
