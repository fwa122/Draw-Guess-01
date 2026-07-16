require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: '+08:00',
    // 性能优化参数
    connectTimeout: 10000,        // 连接超时 10 秒
    acquireTimeout: 10000,        // 获取连接超时 10 秒
    timeout: 60000,               // 查询超时 60 秒
    enableKeepAlive: true,        // 启用 TCP Keep-Alive
    keepAliveInitialDelay: 30000  // Keep-Alive 初始延迟 30 秒
});

async function testConnection() {
    try {
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        console.log('[数据库] 连接成功');
        return true;
    } catch (error) {
        console.error('[数据库] 连接失败:', error.message);
        console.error('[数据库] 错误分类:', classifyError(error));
        return false;
    }
}

function classifyError(error) {
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        return '网络问题：检查 RDS 白名单是否添加了服务器 IP (172.24.6.240)';
    }
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
        return '鉴权失败：检查用户名、密码是否正确，或认证插件是否兼容';
    }
    if (error.code === 'ER_BAD_DB_ERROR') {
        return '数据库不存在：检查 DB_NAME 是否正确';
    }
    return '未知错误';
}

async function query(sql, params = []) {
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.execute(sql, params);
        return rows;
    } finally {
        connection.release();
    }
}

async function execute(sql, params = []) {
    const connection = await pool.getConnection();
    try {
        const [result] = await connection.execute(sql, params);
        return result;
    } finally {
        connection.release();
    }
}

module.exports = {
    pool,
    testConnection,
    query,
    execute
};