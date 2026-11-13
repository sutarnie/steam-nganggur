export default {
  apps: [
    {
      name: 'Steam Nganggur',
      script: 'dist/index.js',
      cwd: '/opt/steam-nganggur',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: '/var/log/steam-nganggur/out.log',
      error_file: '/var/log/steam-nganggur/error.log',
      merge_logs: true,
      restart_delay: 5000,
    },
  ],
};
