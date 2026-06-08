// PM2 config — ek baar setup, hamesha on rehega
// Setup:
//   npm install -g pm2
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup   (auto-start on Windows boot)
//
// Commands:
//   pm2 status          — dekho agent chal raha hai ya nahi
//   pm2 logs tiq-agent  — live logs dekho
//   pm2 restart tiq-agent
//   pm2 stop tiq-agent

module.exports = {
  apps: [
    {
      name:         'tiq-agent',
      script:       'src/web/server.js',
      interpreter:  'node',
      instances:    1,          // MUST stay 1 — fileLock and activeSseSessions are in-memory
      exec_mode:    'fork',     // cluster mode would give each worker its own copy, breaking both
      watch:        false,
      autorestart:  true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file:  'logs/pm2-error.log',
      out_file:    'logs/pm2-out.log',
      merge_logs:  true,
    },
  ],
};
