/**
 * PM2 process file for ZOLA STYLISH MANAGEMENT SYSTEM (Linux VPS or Windows).
 *
 *   npm install -g pm2
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup      # start automatically after a reboot
 *
 * Settings come from the .env file in this folder.
 */
module.exports = {
  apps: [
    {
      name: 'zola-stylish',
      cwd: './backend',
      script: 'src/server.js',
      // One process: background jobs (reminders, scheduled backups) must run once.
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '600M',
      kill_timeout: 10000,
      time: true,
    },
  ],
};
