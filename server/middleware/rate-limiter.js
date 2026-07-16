/**
 * API 速率限制中间件
 * 防止接口被恶意调用
 */

// 速率限制配置
const RATE_LIMIT_CONFIG = {
    // 通用限制：每个 IP 每分钟最多 60 次请求
    general: {
        windowMs: 60 * 1000,  // 1 分钟
        max: 60               // 最多 60 次请求
    },
    // 认证相关限制：每个 IP 每分钟最多 10 次请求
    auth: {
        windowMs: 60 * 1000,  // 1 分钟
        max: 10               // 最多 10 次请求
    },
    // 发送验证码限制：每个 IP 每小时最多 5 次
    sendCode: {
        windowMs: 60 * 60 * 1000,  // 1 小时
        max: 5                      // 最多 5 次
    },
    // 登录限制：每个 IP 每分钟最多 5 次尝试
    login: {
        windowMs: 60 * 1000,  // 1 分钟
        max: 5               // 最多 5 次请求
    }
};

// 速率限制存储（内存存储，生产环境建议使用 Redis）
const rateLimitStore = new Map();

/**
 * 清理过期的速率限制记录
 */
function cleanupExpiredRecords() {
    const now = Date.now();
    for (const [key, record] of rateLimitStore) {
        if (now - record.windowStart > record.windowMs) {
            rateLimitStore.delete(key);
        }
    }
}

// 每分钟清理一次过期记录
setInterval(cleanupExpiredRecords, 60 * 1000);

/**
 * 获取客户端 IP
 */
function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           'unknown';
}

/**
 * 创建速率限制中间件
 * @param {Object} options - 配置选项
 * @param {number} options.windowMs - 时间窗口（毫秒）
 * @param {number} options.max - 最大请求数
 * @param {string} options.message - 超限时的错误消息
 * @param {Function} options.keyGenerator - 自定义键生成函数
 */
function createRateLimiter(options = {}) {
    const {
        windowMs = 60 * 1000,
        max = 60,
        message = '请求过于频繁，请稍后再试',
        keyGenerator = (req) => getClientIp(req)
    } = options;

    return (req, res, next) => {
        const key = keyGenerator(req);
        const now = Date.now();

        let record = rateLimitStore.get(key);

        // 如果没有记录或已过期，创建新记录
        if (!record || now - record.windowStart >= windowMs) {
            record = {
                windowStart: now,
                count: 0,
                windowMs
            };
            rateLimitStore.set(key, record);
        }

        // 增加计数
        record.count++;

        // 设置响应头
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count));
        res.setHeader('X-RateLimit-Reset', new Date(record.windowStart + windowMs).toISOString());

        // 检查是否超过限制
        if (record.count > max) {
            const retryAfter = Math.ceil((record.windowStart + windowMs - now) / 1000);
            res.setHeader('Retry-After', retryAfter);

            console.warn(`[速率限制] IP ${key} 超过限制: ${record.count}/${max}`);

            return res.status(429).json({
                success: false,
                error: message,
                retryAfter,
                limit: max,
                remaining: 0,
                reset: new Date(record.windowStart + windowMs).toISOString()
            });
        }

        next();
    };
}

/**
 * 通用速率限制中间件
 */
const generalLimiter = createRateLimiter({
    ...RATE_LIMIT_CONFIG.general,
    message: '请求过于频繁，请稍后再试'
});

/**
 * 认证接口速率限制中间件
 */
const authLimiter = createRateLimiter({
    ...RATE_LIMIT_CONFIG.auth,
    message: '认证请求过于频繁，请稍后再试'
});

/**
 * 发送验证码速率限制中间件
 */
const sendCodeLimiter = createRateLimiter({
    ...RATE_LIMIT_CONFIG.sendCode,
    message: '验证码发送次数过多，请一小时后再试'
});

/**
 * 登录速率限制中间件
 */
const loginLimiter = createRateLimiter({
    ...RATE_LIMIT_CONFIG.login,
    message: '登录尝试次数过多，请稍后再试'
});

/**
 * 针对用户的速率限制（结合 IP 和用户标识）
 */
const userActionLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    message: '操作过于频繁，请稍后再试',
    keyGenerator: (req) => {
        const ip = getClientIp(req);
        const userId = req.body?.clientId || req.query?.clientId || 'anonymous';
        return `${ip}:${userId}`;
    }
});

module.exports = {
    RATE_LIMIT_CONFIG,
    createRateLimiter,
    generalLimiter,
    authLimiter,
    sendCodeLimiter,
    loginLimiter,
    userActionLimiter,
    getClientIp,
    cleanupExpiredRecords
};