require('dotenv').config();
const { testConnection } = require('./db/pool');

(async () => {
    console.log('测试数据库连接...');
    console.log('DB_HOST:', process.env.DB_HOST);
    console.log('DB_USER:', process.env.DB_USER);
    console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '已设置' : '未设置');

    const result = await testConnection();
    console.log('结果:', result ? '成功' : '失败');
})();