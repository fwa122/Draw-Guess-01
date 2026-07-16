/**
 * 安全工具函数
 * 提供 XSS 防护、输入验证等功能
 */

// ============================================
// XSS 防护
// ============================================

/**
 * HTML 转义函数
 * 将特殊字符转换为 HTML 实体，防止 XSS 攻击
 * @param {string} text - 需要转义的文本
 * @returns {string} - 转义后的文本
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

/**
 * 反转义 HTML 实体
 * @param {string} html - 包含 HTML 实体的文本
 * @returns {string} - 原始文本
 */
function unescapeHtml(html) {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = String(html);
    return div.textContent;
}

/**
 * 安全设置元素文本内容（防止 XSS）
 * @param {HTMLElement} element - 目标元素
 * @param {string} text - 文本内容
 */
function setSafeText(element, text) {
    if (!element) return;
    element.textContent = String(text || '');
}

/**
 * 安全设置元素 HTML 内容（已转义）
 * @param {HTMLElement} element - 目标元素
 * @param {string} html - HTML 内容（会先转义）
 */
function setSafeHtml(element, html) {
    if (!element) return;
    element.textContent = String(html || '');
}

/**
 * 创建安全的超链接
 * @param {string} url - 链接地址
 * @param {string} text - 链接文本
 * @returns {string} - 安全的 <a> 标签 HTML
 */
function createSafeLink(url, text) {
    // 只允许 http/https/mailto 协议
    const safeProtocols = ['http://', 'https://', 'mailto:'];
    const lowerUrl = String(url || '').toLowerCase();
    
    if (!safeProtocols.some(p => lowerUrl.startsWith(p))) {
        return escapeHtml(text || '');
    }
    
    const safeUrl = escapeHtml(url);
    const safeText = escapeHtml(text || url);
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeText}</a>`;
}

// ============================================
// 输入验证
// ============================================

/**
 * 验证邮箱格式
 * @param {string} email - 邮箱地址
 * @returns {boolean}
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(String(email || ''));
}

/**
 * 验证密码强度
 * 至少8位，必须包含字母和数字
 * @param {string} password - 密码
 * @returns {{ valid: boolean, message: string }}
 */
function validatePasswordStrength(password) {
    const pwd = String(password || '');
    
    if (pwd.length < 8) {
        return { valid: false, message: '密码至少需要8个字符' };
    }
    
    if (!/[a-zA-Z]/.test(pwd)) {
        return { valid: false, message: '密码必须包含字母' };
    }
    
    if (!/[0-9]/.test(pwd)) {
        return { valid: false, message: '密码必须包含数字' };
    }
    
    return { valid: true, message: '' };
}

/**
 * 验证房间名称
 * @param {string} name - 房间名称
 * @returns {{ valid: boolean, message: string }}
 */
function validateRoomName(name) {
    const n = String(name || '').trim();
    
    if (!n) {
        return { valid: false, message: '请输入房间名称' };
    }
    
    if (n.length > 20) {
        return { valid: false, message: '房间名称不能超过20个字符' };
    }
    
    // 检查是否包含特殊字符（只允许中英文、数字、下划线、短横线）
    if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(n)) {
        return { valid: false, message: '房间名称只能包含中英文、数字、下划线和短横线' };
    }
    
    return { valid: true, message: '' };
}

/**
 * 验证玩家昵称
 * @param {string} nickname - 玩家昵称
 * @returns {{ valid: boolean, message: string }}
 */
function validateNickname(nickname) {
    const n = String(nickname || '').trim();
    
    if (!n) {
        return { valid: false, message: '请输入昵称' };
    }
    
    if (n.length < 1 || n.length > 12) {
        return { valid: false, message: '昵称长度应为1-12个字符' };
    }
    
    // 检查是否包含特殊字符
    if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(n)) {
        return { valid: false, message: '昵称只能包含中英文、数字、下划线和短横线' };
    }
    
    return { valid: true, message: '' };
}

/**
 * 验证房间密码
 * @param {string} password - 房间密码
 * @returns {{ valid: boolean, message: string }}
 */
function validateRoomPassword(password) {
    const pwd = String(password || '');
    
    // 允许空密码（公开房间）
    if (!pwd) {
        return { valid: true, message: '' };
    }
    
    if (pwd.length < 4 || pwd.length > 20) {
        return { valid: false, message: '房间密码长度应为4-20个字符' };
    }
    
    // 只允许数字和字母
    if (!/^[a-zA-Z0-9]+$/.test(pwd)) {
        return { valid: false, message: '房间密码只能包含字母和数字' };
    }
    
    return { valid: true, message: '' };
}

// ============================================
// 安全工具
// ============================================

/**
 * 安全解析 JSON
 * @param {string} jsonString - JSON 字符串
 * @param {*} defaultValue - 解析失败时的默认值
 * @returns {*}
 */
function safeJsonParse(jsonString, defaultValue = null) {
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        return defaultValue;
    }
}

/**
 * 安全存储（带类型检查）
 */
const SafeStorage = {
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.error('[安全存储] 存储失败:', e);
            return false;
        }
    },
    
    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            return defaultValue;
        }
    },
    
    remove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            return false;
        }
    }
};

// ============================================
// 导出（兼容不同模块系统）
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        escapeHtml,
        unescapeHtml,
        setSafeText,
        setSafeHtml,
        createSafeLink,
        isValidEmail,
        validatePasswordStrength,
        validateRoomName,
        validateNickname,
        validateRoomPassword,
        safeJsonParse,
        SafeStorage
    };
}