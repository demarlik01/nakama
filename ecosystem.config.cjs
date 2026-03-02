module.exports = {
  apps: [
    {
      name: 'agent-for-work',
      script: 'dist/index.js',
      node_args: '--experimental-specifier-resolution=node',
      env: {
        NODE_ENV: 'production',
      },
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
