const mysql = require('mysql2/promise');

(async () => {
    try {
        console.log('开始连接数据库...');
        const conn = await mysql.createConnection({
            host: 'rm-2ze83d5js7f79iv2g.mysql.rds.aliyuncs.com',
            port: 3306,
            user: 'User23456',
            password: '471338924Cqr!',
            database: 'drawguess_db',
            connectTimeout: 10000
        });
        console.log('数据库连接成功！');
        const [rows] = await conn.execute('SELECT 1 as test');
        console.log('查询结果:', rows);
        await conn.end();
        console.log('连接已关闭');
    } catch (err) {
        console.error('连接失败:', err.message);
        console.error('错误代码:', err.code);
    }
})();