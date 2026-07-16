/**
 * 设置模块 - 处理邮箱绑定和账号恢复
 */

// 获取服务器地址
const API_BASE = window.location.origin;

// 发送验证码冷却时间
let sendCodeCooldown = 0;
let sendRecoverCodeCooldown = 0;

/**
 * 显示提示信息
 * @param {string} message - 提示信息
 * @param {'success'|'error'|'info'} type - 类型
 */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `settings-toast settings-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('settings-toast-show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('settings-toast-show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * 获取用户信息
 * @returns {Promise<Object|null>}
 */
async function fetchUserInfo() {
    const clientId = localStorage.getItem('clientId');
    if (!clientId) return null;
    
    try {
        const response = await fetch(`${API_BASE}/api/auth/user/${clientId}`);
        const data = await response.json();
        return data.success ? data.user : null;
    } catch (error) {
        console.error('获取用户信息失败:', error);
        return null;
    }
}

/**
 * 更新用户状态显示
 * @param {Object|null} user 
 */
function updateUserStatusDisplay(user) {
    const nicknameEl = document.getElementById('settingsNickname');
    const emailStatusEl = document.getElementById('settingsEmailStatus');
    const avatarEl = document.getElementById('settingsAvatar');
    const emailBindSection = document.getElementById('emailBindSection');
    const emailBoundSection = document.getElementById('emailBoundSection');
    const boundEmailDisplay = document.getElementById('boundEmailDisplay');
    
    if (user) {
        nicknameEl.textContent = user.nickname || '游客';
        avatarEl.textContent = user.avatar || '🎨';
        
        if (user.emailVerified) {
            emailStatusEl.textContent = user.email;
            emailStatusEl.classList.add('email-bound');
            emailBindSection.style.display = 'none';
            emailBoundSection.style.display = 'block';
            boundEmailDisplay.textContent = user.email;
        } else {
            emailStatusEl.textContent = '未绑定邮箱';
            emailStatusEl.classList.remove('email-bound');
            emailBindSection.style.display = 'block';
            emailBoundSection.style.display = 'none';
        }
    } else {
        nicknameEl.textContent = '游客';
        emailStatusEl.textContent = '未绑定邮箱';
        emailStatusEl.classList.remove('email-bound');
        avatarEl.textContent = '🎨';
        emailBindSection.style.display = 'block';
        emailBoundSection.style.display = 'none';
    }
}

/**
 * 发送验证码
 * @param {string} email - 邮箱地址
 * @param {string} type - 'bind' 或 'recover'
 */
async function sendVerifyCode(email, type = 'bind') {
    const btnId = type === 'bind' ? 'btnSendCode' : 'btnSendRecoverCode';
    const btn = document.getElementById(btnId);
    
    try {
        btn.disabled = true;
        btn.textContent = '发送中...';
        
        const response = await fetch(`${API_BASE}/api/auth/send-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('验证码已发送，请查收邮件', 'success');
            startCooldown(btn, type);
        } else {
            showToast(data.error || '发送失败', 'error');
            btn.disabled = false;
            btn.textContent = '发送验证码';
        }
    } catch (error) {
        console.error('发送验证码失败:', error);
        showToast('网络错误，请稍后重试', 'error');
        btn.disabled = false;
        btn.textContent = '发送验证码';
    }
}

/**
 * 开始冷却倒计时
 * @param {HTMLElement} btn 
 * @param {string} type 
 */
function startCooldown(btn, type) {
    let cooldown = type === 'bind' ? sendCodeCooldown : sendRecoverCodeCooldown;
    cooldown = 60;
    
    const interval = setInterval(() => {
        cooldown--;
        btn.textContent = `${cooldown}秒后重试`;
        
        if (cooldown <= 0) {
            clearInterval(interval);
            btn.disabled = false;
            btn.textContent = '发送验证码';
        }
    }, 1000);
    
    if (type === 'bind') {
        sendCodeCooldown = cooldown;
    } else {
        sendRecoverCodeCooldown = cooldown;
    }
}

/**
 * 绑定邮箱
 */
async function bindEmail() {
    const email = document.getElementById('bindEmail').value.trim();
    const code = document.getElementById('verifyCode').value.trim();
    const clientId = localStorage.getItem('clientId');
    
    if (!email) {
        showToast('请输入邮箱地址', 'error');
        return;
    }
    
    if (!code || code.length !== 6) {
        showToast('请输入6位验证码', 'error');
        return;
    }
    
    const btn = document.getElementById('btnBindEmail');
    btn.disabled = true;
    btn.textContent = '绑定中...';
    
    try {
        const nickname = document.getElementById('playerNickname')?.value || '游客';
        const avatar = document.getElementById('avatarPreview')?.textContent || '🎨';
        
        const response = await fetch(`${API_BASE}/api/auth/bind-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId,
                email,
                code,
                nickname,
                avatar
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('邮箱绑定成功！', 'success');
            updateUserStatusDisplay(data.user);
            document.getElementById('bindEmail').value = '';
            document.getElementById('verifyCode').value = '';
        } else {
            showToast(data.error || '绑定失败', 'error');
        }
    } catch (error) {
        console.error('绑定邮箱失败:', error);
        showToast('网络错误，请稍后重试', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '绑定邮箱';
    }
}

/**
 * 恢复账号
 */
async function recoverAccount() {
    const email = document.getElementById('recoverEmail').value.trim();
    const code = document.getElementById('recoverVerifyCode').value.trim();
    const clientId = localStorage.getItem('clientId');
    
    if (!email) {
        showToast('请输入邮箱地址', 'error');
        return;
    }
    
    if (!code || code.length !== 6) {
        showToast('请输入6位验证码', 'error');
        return;
    }
    
    const btn = document.getElementById('btnRecoverAccount');
    btn.disabled = true;
    btn.textContent = '恢复中...';
    
    try {
        const response = await fetch(`${API_BASE}/api/auth/recover`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                code,
                clientId
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('账号恢复成功！', 'success');
            updateUserStatusDisplay(data.user);
            document.getElementById('recoverEmail').value = '';
            document.getElementById('recoverVerifyCode').value = '';
        } else {
            showToast(data.error || '恢复失败', 'error');
        }
    } catch (error) {
        console.error('恢复账号失败:', error);
        showToast('网络错误，请稍后重试', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '恢复账号';
    }
}

/**
 * 初始化设置模块
 */
function initSettings() {
    const settingsModal = document.getElementById('settingsModal');
    const btnSettings = document.getElementById('btnSettings');
    const btnCloseSettings = document.getElementById('btnCloseSettings');
    const btnSendCode = document.getElementById('btnSendCode');
    const btnSendRecoverCode = document.getElementById('btnSendRecoverCode');
    const btnBindEmail = document.getElementById('btnBindEmail');
    const btnRecoverAccount = document.getElementById('btnRecoverAccount');
    
    // 打开设置弹窗
    btnSettings?.addEventListener('click', async () => {
        settingsModal.classList.add('active');
        const user = await fetchUserInfo();
        updateUserStatusDisplay(user);
    });
    
    // 关闭设置弹窗
    btnCloseSettings?.addEventListener('click', () => {
        settingsModal.classList.remove('active');
    });
    
    // 点击遮罩关闭
    settingsModal?.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('active');
        }
    });
    
    // 发送绑定验证码
    btnSendCode?.addEventListener('click', () => {
        const email = document.getElementById('bindEmail').value.trim();
        if (!email) {
            showToast('请输入邮箱地址', 'error');
            return;
        }
        sendVerifyCode(email, 'bind');
    });
    
    // 发送恢复验证码
    btnSendRecoverCode?.addEventListener('click', () => {
        const email = document.getElementById('recoverEmail').value.trim();
        if (!email) {
            showToast('请输入邮箱地址', 'error');
            return;
        }
        sendVerifyCode(email, 'recover');
    });
    
    // 绑定邮箱
    btnBindEmail?.addEventListener('click', bindEmail);
    
    // 恢复账号
    btnRecoverAccount?.addEventListener('click', recoverAccount);
}

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', initSettings);