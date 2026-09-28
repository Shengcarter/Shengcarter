'use strict';

const cron = require('node-cron');
const logger = require('../config/logger');
const messaging = require('../services/messaging');
const appointmentService = require('../services/appointmentService');
const notificationService = require('../services/notificationService');

/**
 * Background jobs. Each job guards against overlapping runs and logs failures
 * without crashing the server. Scheduled backups are registered separately
 * because their schedule is configurable in Settings.
 */
const tasks = [];

function guarded(name, fn) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (error) {
      logger.error({ err: error, job: name }, 'Background job failed');
    } finally {
      running = false;
    }
  };
}

const JOBS = [
  { name: 'message-queue', schedule: '*/30 * * * * *', run: () => messaging.processQueue() },
  { name: 'appointment-reminders', schedule: '*/5 * * * *', run: () => appointmentService.sendDueReminders() },
  { name: 'notification-cleanup', schedule: '30 3 * * *', run: () => notificationService.prune() },
];

function register(job) {
  tasks.push(cron.schedule(job.schedule, guarded(job.name, job.run), { name: job.name }));
}

function start() {
  for (const job of JOBS) register(job);
  logger.info(`Background jobs started: ${JOBS.map((j) => j.name).join(', ')}`);
}

function stop() {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}

module.exports = { start, stop, register, guarded, JOBS };
