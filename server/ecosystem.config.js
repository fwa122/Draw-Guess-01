module.exports = {
  apps: [{
    name: 'draw-guess',
    script: 'server.js',
    cwd: '/home/admin/server',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      DB_HOST: 'rm-2ze83d5js7f79iv2g.mysql.rds.aliyuncs.com',
      DB_PORT: '3306',
      DB_NAME: 'drawguess_db',
      DB_USER: 'User23456',
      DB_PASSWORD: '471338924Cqr!'
    }
  }]
};