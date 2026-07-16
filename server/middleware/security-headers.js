/**
 * 安全响应头中间件
 * 添加 CSP、X-Frame-Options 等安全头
 */

/**
 * 安全响应头配置
 */
const SECURITY_HEADERS = {
    // 防止 MIME 类型嗅探
    'X-Content-Type-Options': 'nosniff',
    
    // 防止点击劫持
    'X-Frame-Options': 'DENY',
    
    // XSS 保护
    'X-XSS-Protection': '1; mode=block',
    
    // 禁用引用策略
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    
    // 权限策略
    'Permissions-Policy': 'geography=(), microphone=(), camera=()',
    
    // 内容安全策略
    'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'"
    ].join('; '),
    
    // HTTP 严格传输安全（生产环境建议启用）
    // 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};

/**
 * 安全响应头中间件
 */
function securityHeaders(req, res, next) {
    // 设置安全响应头
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
        res.setHeader(header, value);
    }
    
    // 移除可能暴露服务器信息的头
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');
    
    next();
}

/**
 * CORS 安全配置中间件
 * 用于限制跨域请求
 */
function createCorsMiddleware(options = {}) {
    const {
        allowedOrigins = [],
        allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders = ['Content-Type', 'Authorization', 'X-Requested-With'],
        credentials = true,
        maxAge = 86400 // 24 小时
    } = options;

    return (req, res, next) => {
        const origin = req.headers.origin;
        
        // 检查是否是允许的来源
        const isAllowed = allowedOrigins.length === 0 || 
                          allowedOrigins.includes('*') ||
                          allowedOrigins.includes(origin);

        if (isAllowed) {
            res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin);
            res.setHeader('Access-Control-Allow-Methods', allowedMethods.join(', '));
            res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(', '));
            
            if (credentials) {
                res.setHeader('Access-Control-Allow-Credentials', 'true');
            }
            
            res.setHeader('Access-Control-Max-Age', maxAge.toString());
        }

        // 处理预检请求
        if (req.method === 'OPTIONS') {
            return res.status(204).end();
        }

        next();
    };
}

/**
 * 生产环境 CORS 配置
 * 根据实际域名配置（从环境变量读取）
 */
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://39.96.53.222', 'http://39.96.53.222:3000'];

const productionCorsMiddleware = createCorsMiddleware({
    allowedOrigins: allowedOrigins,
    credentials: true
});

/**
 * 开发环境 CORS 配置（允许所有来源）
 */
const developmentCorsMiddleware = createCorsMiddleware({
    allowedOrigins: ['*'],
    credentials: true
});

/**
 * 输入消毒中间件
 * 清理请求输入中的潜在危险内容
 */
function sanitizeInput(req, res, next) {
    // 递归清理对象
    function sanitize(obj) {
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }

        for (const key of Object.keys(obj)) {
            if (typeof obj[key] === 'string') {
                // 移除潜在的脚本标签
                obj[key] = obj[key]
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                    .replace(/javascript:/gi, '')
                    .replace(/on\w+\s*=/gi, '');
            } else if (typeof obj[key] === 'object') {
                sanitize(obj[key]);
            }
        }
        
        return obj;
    }

    // 清理请求体
    if (req.body) {
        sanitize(req.body);
    }

    // 清理查询参数
    if (req.query) {
        sanitize(req.query);
    }

    next();
}

/**
 * 请求大小限制中间件
 */
function requestSizeLimiter(maxSize = '1mb') {
    const maxBytes = parseSize(maxSize);
    
    return (req, res, next) => {
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);
        
        if (contentLength > maxBytes) {
            return res.status(413).json({
                success: false,
                error: '请求体过大'
            });
        }
        
        next();
    };
}

/**
 * 解析大小字符串
 */
function parseSize(size) {
    if (typeof size === 'number') return size;
    
    const units = {
        'b': 1,
        'kb': 1024,
        'mb': 1024 * 1024,
        'gb': 1024 * 1024 * 1024
    };
    
    const match = size.toLowerCase().match(/^(\d+)(b|kb|mb|gb)?$/);
    
    if (!match) return 1024 * 1024; // 默认 1MB
    
    const value = parseInt(match[1], 10);
    const unit = match[2] || 'b';
    
    return value * (units[unit] || 1);
}

module.exports = {
    SECURITY_HEADERS,
    securityHeaders,
    createCorsMiddleware,
    productionCorsMiddleware,
    developmentCorsMiddleware,
    sanitizeInput,
    requestSizeLimiter
};