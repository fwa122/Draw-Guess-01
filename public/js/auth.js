/**
 * 前端认证工具模块
 * 处理 Token 存储、自动刷新、认证请求等
 */

const AUTH_CONFIG = {
    ACCESS_TOKEN_KEY: 'draw_guess_access_token',
    REFRESH_TOKEN_KEY: 'draw_guess_refresh_token',
    USER_KEY: 'draw_guess_user',
    TOKEN_REFRESH_THRESHOLD: 5 * 60 * 1000  // Token 过期前 5 分钟刷新
};

/**
 * 存储 Token
 * @param {string} accessToken 
 * @param {string} refreshToken 
 */
function saveTokens(accessToken, refreshToken) {
    localStorage.setItem(AUTH_CONFIG.ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, refreshToken);
}

/**
 * 获取 Access Token
 * @returns {string|null}
 */
function getAccessToken() {
    return localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY);
}

/**
 * 获取 Refresh Token
 * @returns {string|null}
 */
function getRefreshToken() {
    return localStorage.getItem(AUTH_CONFIG.REFRESH_TOKEN_KEY);
}

/**
 * 清除所有认证信息
 */
function clearAuth() {
    localStorage.removeItem(AUTH_CONFIG.ACCESS_TOKEN_KEY);
    localStorage.removeItem(AUTH_CONFIG.REFRESH_TOKEN_KEY);
    localStorage.removeItem(AUTH_CONFIG.USER_KEY);
}

/**
 * 保存用户信息
 * @param {Object} user 
 */
function saveUser(user) {
    localStorage.setItem(AUTH_CONFIG.USER_KEY, JSON.stringify(user));
}

/**
 * 获取用户信息
 * @returns {Object|null}
 */
function getUser() {
    const userStr = localStorage.getItem(AUTH_CONFIG.USER_KEY);
    return userStr ? JSON.parse(userStr) : null;
}

/**
 * 检查是否已登录（有 Token）
 * @returns {boolean}
 */
function isLoggedIn() {
    return !!getAccessToken();
}

/**
 * 刷新 Access Token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function refreshAccessToken() {
    const refreshToken = getRefreshToken();
    
    if (!refreshToken) {
        return { success: false, error: '无 Refresh Token' };
    }
    
    try {
        const response = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ refreshToken })
        });
        
        const data = await response.json();
        
        if (data.success) {
            saveTokens(data.accessToken, data.refreshToken);
            return { success: true };
        }
        
        // Refresh Token 失效，清除认证信息
        clearAuth();
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: '网络错误' };
    }
}

/**
 * 带认证的 fetch 请求
 * 自动添加 Authorization 头，自动刷新过期 Token
 * @param {string} url 
 * @param {Object} options 
 * @returns {Promise<Response>}
 */
async function authFetch(url, options = {}) {
    let accessToken = getAccessToken();
    
    // 如果没有 Token，直接请求（可能返回 401）
    if (!accessToken) {
        return fetch(url, options);
    }
    
    // 添加 Authorization 头
    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`
    };
    
    // 发送请求
    let response = await fetch(url, {
        ...options,
        headers
    });
    
    // 如果返回 401，尝试刷新 Token
    if (response.status === 401) {
        const result = await refreshAccessToken();
        
        if (result.success) {
            // 用新 Token 重试
            accessToken = getAccessToken();
            const newHeaders = {
                ...options.headers,
                'Authorization': `Bearer ${accessToken}`
            };
            
            response = await fetch(url, {
                ...options,
                headers: newHeaders
            });
        }
    }
    
    return response;
}

/**
 * 登出
 * @returns {Promise<{success: boolean}>}
 */
async function logout() {
    try {
        const accessToken = getAccessToken();
        
        if (accessToken) {
            await authFetch('/api/auth/logout', {
                method: 'POST'
            });
        }
    } catch (error) {
        console.error('登出请求失败:', error);
    }
    
    clearAuth();
    return { success: true };
}

/**
 * 检查并恢复登录状态
 * 页面加载时调用
 * @returns {Promise<{loggedIn: boolean, user?: Object}>}
 */
async function checkAuthStatus() {
    if (!isLoggedIn()) {
        return { loggedIn: false };
    }
    
    try {
        const response = await authFetch('/api/auth/verify');
        const data = await response.json();
        
        if (data.success) {
            return { 
                loggedIn: true, 
                user: getUser()
            };
        }
        
        // Token 无效，尝试刷新
        const refreshResult = await refreshAccessToken();
        
        if (refreshResult.success) {
            return { 
                loggedIn: true, 
                user: getUser()
            };
        }
        
        return { loggedIn: false };
    } catch (error) {
        return { loggedIn: false };
    }
}

// 导出函数
window.AuthUtils = {
    saveTokens,
    getAccessToken,
    getRefreshToken,
    clearAuth,
    saveUser,
    getUser,
    isLoggedIn,
    refreshAccessToken,
    authFetch,
    logout,
    checkAuthStatus
};