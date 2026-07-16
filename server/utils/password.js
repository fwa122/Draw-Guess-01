/**
 * 密码工具模块
 * 处理密码加密、验证、强度校验等
 */

const bcrypt = require('bcrypt');

// 配置
const CONFIG = {
    SALT_ROUNDS: 12,        // bcrypt 加密轮数
    MIN_LENGTH: 8,          // 最小长度
    REQUIRE_LETTER: true,   // 必须包含字母
    REQUIRE_NUMBER: true    // 必须包含数字
};

/**
 * 验证密码强度
 * @param {string} password - 原始密码
 * @returns {{valid: boolean, error?: string}}
 */
function validatePassword(password) {
    if (!password || typeof password !== 'string') {
        return { valid: false, error: '请输入密码' };
    }
    
    if (password.length < CONFIG.MIN_LENGTH) {
        return { valid: false, error: `密码长度不能少于 ${CONFIG.MIN_LENGTH} 位` };
    }
    
    if (CONFIG.REQUIRE_LETTER && !/[a-zA-Z]/.test(password)) {
        return { valid: false, error: '密码必须包含字母' };
    }
    
    if (CONFIG.REQUIRE_NUMBER && !/[0-9]/.test(password)) {
        return { valid: false, error: '密码必须包含数字' };
    }
    
    // 检查常见弱密码
    const weakPasswords = ['12345678', 'password', 'qwertyui', 'abcdefgh'];
    if (weakPasswords.some(weak => password.toLowerCase().includes(weak))) {
        return { valid: false, error: '密码过于简单，请设置更复杂的密码' };
    }
    
    return { valid: true };
}

/**
 * 加密密码
 * @param {string} password - 原始密码
 * @returns {Promise<string>} - 加密后的密码哈希
 */
async function hashPassword(password) {
    return bcrypt.hash(password, CONFIG.SALT_ROUNDS);
}

/**
 * 验证密码
 * @param {string} password - 原始密码
 * @param {string} hash - 存储的密码哈希
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, hash) {
    if (!password || !hash) {
        return false;
    }
    return bcrypt.compare(password, hash);
}

/**
 * 检查是否需要升级密码哈希
 * （如果加密轮数变化，需要重新哈希）
 * @param {string} hash - 存储的密码哈希
 * @returns {boolean}
 */
function needsRehash(hash) {
    try {
        const rounds = bcrypt.getRounds(hash);
        return rounds < CONFIG.SALT_ROUNDS;
    } catch (e) {
        return false;
    }
}

module.exports = {
    validatePassword,
    hashPassword,
    verifyPassword,
    needsRehash,
    CONFIG
};