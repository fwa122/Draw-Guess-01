/**
 * 验证码管理模块
 * 生成、存储、验证验证码
 */

// 验证码存储（内存缓存）
// 格式: { email: { code: '123456', expires: timestamp, lastSent: timestamp, attempts: number } }
const codeStore = new Map();

// 配置
const CONFIG = {
    CODE_LENGTH: 6,             // 验证码长度
    EXPIRE_TIME: 3 * 60 * 1000, // 有效期 3 分钟
    COOLDOWN_TIME: 60 * 1000,   // 发送冷却时间 60 秒
    MAX_ATTEMPTS: 3             // 最大尝试次数
};

/**
 * 生成随机验证码
 * @returns {string}
 */
function generateCode() {
    let code = '';
    for (let i = 0; i < CONFIG.CODE_LENGTH; i++) {
        code += Math.floor(Math.random() * 10);
    }
    return code;
}

/**
 * 创建并存储验证码
 * @param {string} email - 邮箱地址
 * @returns {{code: string, canSend: boolean, remainingTime?: number}}
 */
function createCode(email) {
    const emailLower = email.toLowerCase();
    const now = Date.now();
    const existing = codeStore.get(emailLower);
    
    // 检查发送冷却
    if (existing && existing.lastSent) {
        const elapsed = now - existing.lastSent;
        if (elapsed < CONFIG.COOLDOWN_TIME) {
            return {
                code: null,
                canSend: false,
                remainingTime: Math.ceil((CONFIG.COOLDOWN_TIME - elapsed) / 1000)
            };
        }
    }
    
    // 生成新验证码
    const code = generateCode();
    codeStore.set(emailLower, {
        code,
        expires: now + CONFIG.EXPIRE_TIME,
        lastSent: now,
        attempts: 0  // 重置尝试次数
    });
    
    return { code, canSend: true };
}

/**
 * 验证验证码
 * @param {string} email - 邮箱地址
 * @param {string} code - 用户输入的验证码
 * @returns {{valid: boolean, error?: string, attemptsLeft?: number}}
 */
function verifyCode(email, code) {
    const emailLower = email.toLowerCase();
    const stored = codeStore.get(emailLower);
    
    if (!stored) {
        return { valid: false, error: '请先获取验证码' };
    }
    
    // 检查是否过期
    if (Date.now() > stored.expires) {
        codeStore.delete(emailLower);
        return { valid: false, error: '验证码已过期，请重新获取' };
    }
    
    // 检查尝试次数
    if (stored.attempts >= CONFIG.MAX_ATTEMPTS) {
        codeStore.delete(emailLower);
        return { valid: false, error: '验证码尝试次数已达上限，请重新获取' };
    }
    
    // 验证码错误
    if (stored.code !== code) {
        stored.attempts++;
        const attemptsLeft = CONFIG.MAX_ATTEMPTS - stored.attempts;
        
        if (attemptsLeft <= 0) {
            codeStore.delete(emailLower);
            return { valid: false, error: '验证码尝试次数已达上限，请重新获取' };
        }
        
        return { 
            valid: false, 
            error: `验证码错误，还剩 ${attemptsLeft} 次尝试机会`,
            attemptsLeft 
        };
    }
    
    // 验证成功后删除验证码
    codeStore.delete(emailLower);
    return { valid: true };
}

/**
 * 检查邮箱是否可以发送验证码
 * @param {string} email - 邮箱地址
 * @returns {{canSend: boolean, remainingTime?: number}}
 */
function canSendCode(email) {
    const emailLower = email.toLowerCase();
    const existing = codeStore.get(emailLower);
    
    if (!existing || !existing.lastSent) {
        return { canSend: true };
    }
    
    const elapsed = Date.now() - existing.lastSent;
    if (elapsed >= CONFIG.COOLDOWN_TIME) {
        return { canSend: true };
    }
    
    return {
        canSend: false,
        remainingTime: Math.ceil((CONFIG.COOLDOWN_TIME - elapsed) / 1000)
    };
}

/**
 * 清理过期验证码
 */
function cleanExpiredCodes() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [email, data] of codeStore.entries()) {
        if (data.expires < now) {
            codeStore.delete(email);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`[验证码] 清理了 ${cleaned} 个过期验证码`);
    }
}

// 每 3 分钟清理一次过期验证码
setInterval(cleanExpiredCodes, 3 * 60 * 1000);

module.exports = {
    createCode,
    verifyCode,
    canSendCode,
    generateCode,
    CONFIG  // 导出配置供其他模块使用
};