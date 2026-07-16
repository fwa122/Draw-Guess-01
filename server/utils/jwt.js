/**
 * JWT 工具模块
 * 处理 Token 生成、验证、刷新等
 */

const jwt = require('jsonwebtoken');

// 配置
const CONFIG = {
    ACCESS_TOKEN_SECRET: process.env.JWT_SECRET || 'draw-guess-secret-key-2024',
    REFRESH_TOKEN_SECRET: process.env.JWT_REFRESH_SECRET || 'draw-guess-refresh-key-2024',
    ACCESS_TOKEN_EXPIRES: '15m',  // Access Token 有效期 15 分钟
    REFRESH_TOKEN_EXPIRES: '7d'   // Refresh Token 有效期 7 天
};

// Token 黑名单（用于登出）
const tokenBlacklist = new Set();

/**
 * 生成 Access Token
 * @param {Object} payload - 用户信息 { id, clientId }
 * @returns {string}
 */
function generateAccessToken(payload) {
    return jwt.sign(
        { 
            id: payload.id,
            clientId: payload.clientId 
        },
        CONFIG.ACCESS_TOKEN_SECRET,
        { 
            expiresIn: CONFIG.ACCESS_TOKEN_EXPIRES,
            issuer: 'draw-guess',
            audience: 'draw-guess-client'
        }
    );
}

/**
 * 生成 Refresh Token
 * @param {Object} payload - 用户信息 { id, clientId }
 * @returns {string}
 */
function generateRefreshToken(payload) {
    return jwt.sign(
        { 
            id: payload.id,
            clientId: payload.clientId,
            type: 'refresh'
        },
        CONFIG.REFRESH_TOKEN_SECRET,
        { 
            expiresIn: CONFIG.REFRESH_TOKEN_EXPIRES,
            issuer: 'draw-guess',
            audience: 'draw-guess-client'
        }
    );
}

/**
 * 生成 Token 对（Access + Refresh）
 * @param {Object} payload - 用户信息 { id, clientId }
 * @returns {{accessToken: string, refreshToken: string}}
 */
function generateTokenPair(payload) {
    return {
        accessToken: generateAccessToken(payload),
        refreshToken: generateRefreshToken(payload)
    };
}

/**
 * 验证 Access Token
 * @param {string} token - Access Token
 * @returns {{valid: boolean, payload?: Object, error?: string}}
 */
function verifyAccessToken(token) {
    try {
        // 检查黑名单
        if (tokenBlacklist.has(token)) {
            return { valid: false, error: 'Token 已失效' };
        }
        
        const decoded = jwt.verify(token, CONFIG.ACCESS_TOKEN_SECRET, {
            issuer: 'draw-guess',
            audience: 'draw-guess-client'
        });
        
        return { valid: true, payload: decoded };
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return { valid: false, error: 'Token 已过期', code: 'TOKEN_EXPIRED' };
        }
        if (error.name === 'JsonWebTokenError') {
            return { valid: false, error: 'Token 无效', code: 'TOKEN_INVALID' };
        }
        return { valid: false, error: 'Token 验证失败', code: 'TOKEN_ERROR' };
    }
}

/**
 * 验证 Refresh Token
 * @param {string} token - Refresh Token
 * @returns {{valid: boolean, payload?: Object, error?: string}}
 */
function verifyRefreshToken(token) {
    try {
        // 检查黑名单
        if (tokenBlacklist.has(token)) {
            return { valid: false, error: 'Token 已失效' };
        }
        
        const decoded = jwt.verify(token, CONFIG.REFRESH_TOKEN_SECRET, {
            issuer: 'draw-guess',
            audience: 'draw-guess-client'
        });
        
        // 确保是 refresh token
        if (decoded.type !== 'refresh') {
            return { valid: false, error: 'Token 类型错误' };
        }
        
        return { valid: true, payload: decoded };
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return { valid: false, error: 'Refresh Token 已过期，请重新登录', code: 'REFRESH_EXPIRED' };
        }
        return { valid: false, error: 'Refresh Token 无效' };
    }
}

/**
 * 将 Token 加入黑名单（登出时使用）
 * @param {string} token - Access Token
 */
function invalidateToken(token) {
    tokenBlacklist.add(token);
    
    // 1 小时后自动从黑名单移除（Token 已过期）
    setTimeout(() => {
        tokenBlacklist.delete(token);
    }, 60 * 60 * 1000);
}

/**
 * 清理黑名单
 */
function cleanBlacklist() {
    console.log(`[JWT] 当前黑名单 Token 数量: ${tokenBlacklist.size}`);
}

// 每 30 分钟清理一次日志
setInterval(cleanBlacklist, 30 * 60 * 1000);

/**
 * 从请求头提取 Token
 * @param {Object} req - Express 请求对象
 * @returns {string|null}
 */
function extractToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return null;
    }
    
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return null;
    }
    
    return parts[1];
}

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    generateTokenPair,
    verifyAccessToken,
    verifyRefreshToken,
    invalidateToken,
    extractToken,
    CONFIG
};