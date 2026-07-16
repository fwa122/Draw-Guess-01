/**
 * 认证中间件
 * 验证 JWT Token，保护需要认证的 API 端点
 */

const { verifyAccessToken, extractToken } = require('../utils/jwt');

/**
 * 认证中间件 - 验证 Access Token
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @param {Function} next - 下一个中间件
 */
function authMiddleware(req, res, next) {
    const token = extractToken(req);
    
    if (!token) {
        return res.status(401).json({
            success: false,
            error: '请先登录',
            code: 'NO_TOKEN'
        });
    }
    
    const result = verifyAccessToken(token);
    
    if (!result.valid) {
        return res.status(401).json({
            success: false,
            error: result.error,
            code: result.code || 'TOKEN_INVALID'
        });
    }
    
    // 将用户信息附加到请求对象
    req.user = result.payload;
    next();
}

/**
 * 可选认证中间件 - Token 存在则验证，不存在则跳过
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @param {Function} next - 下一个中间件
 */
function optionalAuthMiddleware(req, res, next) {
    const token = extractToken(req);
    
    if (!token) {
        // 没有 Token，继续执行但不设置用户信息
        req.user = null;
        return next();
    }
    
    const result = verifyAccessToken(token);
    
    if (result.valid) {
        req.user = result.payload;
    } else {
        req.user = null;
    }
    
    next();
}

/**
 * 检查用户是否已绑定邮箱
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @param {Function} next - 下一个中间件
 */
function requireEmailBound(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: '请先登录'
        });
    }
    
    // 这里可以添加额外的检查逻辑
    // 例如检查用户是否已绑定邮箱
    next();
}

module.exports = {
    authMiddleware,
    optionalAuthMiddleware,
    requireEmailBound
};