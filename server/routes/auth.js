/**
 * 登录认证路由
 * 处理注册、登录、密码管理、JWT Token 管理等
 */

const express = require('express');
const router = express.Router();
const { sendVerifyCode } = require('../utils/mailer');
const { createCode, verifyCode, canSendCode } = require('../utils/verifyCode');
const { query, execute } = require('../db/pool');
const { 
    generateTokenPair, 
    verifyAccessToken, 
    verifyRefreshToken, 
    invalidateToken,
    extractToken 
} = require('../utils/jwt');
const { validatePassword, hashPassword, verifyPassword } = require('../utils/password');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');
const { sendCodeLimiter, loginLimiter } = require('../middleware/rate-limiter');
const { sanitizeInput } = require('../middleware/security-headers');

// 输入消毒
router.use(sanitizeInput);

// ============================================
// 邮箱状态检查
// ============================================

/**
 * 检查邮箱状态
 * GET /api/auth/check-email?email=xxx
 */
router.get('/check-email', async (req, res) => {
    const { email } = req.query;
    
    if (!email) {
        return res.status(400).json({ success: false, error: '请输入邮箱地址' });
    }
    
    try {
        const users = await query(
            'SELECT id, email_verified, has_password FROM users WHERE email = ?',
            [email.toLowerCase()]
        );
        
        if (!users || users.length === 0) {
            return res.json({
                exists: false,
                hasPassword: false,
                message: '该邮箱未注册'
            });
        }
        
        const user = users[0];
        res.json({
            exists: true,
            hasPassword: !!user.has_password,
            emailVerified: !!user.email_verified,
            message: user.has_password ? '该邮箱已注册，可使用密码登录' : '该邮箱已注册，可使用验证码登录'
        });
    } catch (error) {
        console.error('[数据库] 检查邮箱失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

// ============================================
// 验证码发送
// ============================================

/**
 * 发送验证码
 * POST /api/auth/send-code
 * Body: { email, type?: 'register'|'login'|'reset' }
 */
router.post('/send-code', sendCodeLimiter, async (req, res) => {
    const { email, type = 'register' } = req.body;
    
    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
        return res.status(400).json({ success: false, error: '请输入有效的邮箱地址' });
    }
    
    // 检查发送冷却
    const sendCheck = canSendCode(email);
    if (!sendCheck.canSend) {
        return res.status(429).json({
            success: false,
            error: `请等待 ${sendCheck.remainingTime} 秒后再试`,
            remainingTime: sendCheck.remainingTime
        });
    }
    
    // 根据类型检查邮箱状态
    try {
        const existing = await query(
            'SELECT id, email_verified, has_password FROM users WHERE email = ?',
            [email.toLowerCase()]
        );
        
        if (type === 'register' && existing && existing.length > 0 && existing[0].email_verified) {
            return res.status(400).json({
                success: false,
                error: '该邮箱已注册，请直接登录'
            });
        }
        
        if ((type === 'login' || type === 'reset') && (!existing || existing.length === 0)) {
            return res.status(400).json({
                success: false,
                error: '该邮箱未注册'
            });
        }
    } catch (dbError) {
        console.error('[数据库] 查询邮箱失败:', dbError.message);
        return res.status(500).json({ success: false, error: '服务器错误' });
    }
    
    // 创建验证码
    const result = createCode(email);
    if (!result.canSend) {
        return res.status(429).json({
            success: false,
            error: `请等待 ${result.remainingTime} 秒后再试`,
            remainingTime: result.remainingTime
        });
    }
    
    // 发送邮件
    const mailResult = await sendVerifyCode(email, result.code);
    if (!mailResult.success) {
        return res.status(500).json({
            success: false,
            error: '邮件发送失败，请稍后重试'
        });
    }
    
    res.json({
        success: true,
        message: '验证码已发送，请查收邮件'
    });
});

// ============================================
// 注册（邮箱+验证码+密码）
// ============================================

/**
 * 注册账号
 * POST /api/auth/register
 * Body: { email, code, password, nickname?, avatar? }
 */
router.post('/register', async (req, res) => {
    const { email, code, password, nickname, avatar } = req.body;
    
    // 参数验证
    if (!email || !code || !password) {
        return res.status(400).json({ success: false, error: '参数不完整' });
    }
    
    // 验证密码强度
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
        return res.status(400).json({ success: false, error: passwordCheck.error });
    }
    
    // 验证验证码
    const verifyResult = verifyCode(email, code);
    if (!verifyResult.valid) {
        return res.status(400).json({ success: false, error: verifyResult.error });
    }
    
    try {
        const emailLower = email.toLowerCase();
        
        // 检查邮箱是否已注册
        const existing = await query(
            'SELECT id, email_verified FROM users WHERE email = ?',
            [emailLower]
        );
        
        if (existing && existing.length > 0 && existing[0].email_verified) {
            return res.status(400).json({ success: false, error: '该邮箱已注册' });
        }
        
        // 加密密码
        const passwordHash = await hashPassword(password);
        
        // 生成 client_id
        const clientId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // 创建用户
        const result = await execute(
            `INSERT INTO users (client_id, nickname, avatar, email, email_verified, password, has_password) 
             VALUES (?, ?, ?, ?, 1, ?, 1)`,
            [clientId, nickname || '游客', avatar || '/images/default-avatar.svg', emailLower, passwordHash]
        );
        
        const user = {
            id: result.insertId,
            client_id: clientId,
            nickname: nickname || '游客',
            avatar: avatar || '🎨',
            email: emailLower,
            email_verified: 1,
            has_password: 1
        };
        
        // 生成 JWT Token
        const tokens = generateTokenPair({ id: user.id, clientId: user.client_id });
        
        res.json({
            success: true,
            message: '注册成功',
            user: {
                id: user.id,
                clientId: user.client_id,
                nickname: user.nickname,
                avatar: user.avatar,
                email: user.email,
                emailVerified: true,
                hasPassword: true
            },
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken
        });
    } catch (dbError) {
        console.error('[数据库] 注册失败:', dbError.message);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

// ============================================
// 登录（密码登录 / 验证码登录）
// ============================================

/**
 * 密码登录
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    
    // 参数验证
    if (!email || !password) {
        return res.status(400).json({ success: false, error: '请输入邮箱和密码' });
    }
    
    try {
        const emailLower = email.toLowerCase();
        
        // 查找用户
        const users = await query(
            'SELECT * FROM users WHERE email = ? AND email_verified = 1',
            [emailLower]
        );
        
        if (!users || users.length === 0) {
            return res.status(401).json({ success: false, error: '邮箱或密码错误' });
        }
        
        const user = users[0];
        
        // 检查是否设置了密码
        if (!user.has_password || !user.password) {
            return res.status(400).json({ 
                success: false, 
                error: '该账号未设置密码，请使用验证码登录',
                code: 'NO_PASSWORD'
            });
        }
        
        // 验证密码
        const passwordValid = await verifyPassword(password, user.password);
        if (!passwordValid) {
            return res.status(401).json({ success: false, error: '邮箱或密码错误' });
        }
        
        // 更新 client_id（绑定到当前设备）
        const newClientId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        await execute(
            'UPDATE users SET client_id = ? WHERE id = ?',
            [newClientId, user.id]
        );
        
        // 生成 JWT Token
        const tokens = generateTokenPair({ id: user.id, clientId: newClientId });
        
        res.json({
            success: true,
            message: '登录成功',
            user: {
                id: user.id,
                clientId: newClientId,
                nickname: user.nickname,
                avatar: user.avatar,
                email: user.email,
                emailVerified: true,
                hasPassword: true,
                totalGames: user.total_games,
                totalScore: user.total_score,
                bestScore: user.best_score
            },
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken
        });
    } catch (dbError) {
        console.error('[数据库] 登录失败:', dbError.message);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

/**
 * 验证码登录
 * POST /api/auth/login-with-code
 * Body: { email, code }
 */
router.post('/login-with-code', async (req, res) => {
    const { email, code } = req.body;
    
    // 参数验证
    if (!email || !code) {
        return res.status(400).json({ success: false, error: '请输入邮箱和验证码' });
    }
    
    // 验证验证码
    const verifyResult = verifyCode(email, code);
    if (!verifyResult.valid) {
        return res.status(400).json({ success: false, error: verifyResult.error });
    }
    
    try {
        const emailLower = email.toLowerCase();
        
        // 查找用户
        const users = await query(
            'SELECT * FROM users WHERE email = ? AND email_verified = 1',
            [emailLower]
        );
        
        if (!users || users.length === 0) {
            return res.status(404).json({ success: false, error: '该邮箱未注册' });
        }
        
        const user = users[0];
        
        // 更新 client_id
        const newClientId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        await execute(
            'UPDATE users SET client_id = ? WHERE id = ?',
            [newClientId, user.id]
        );
        
        // 生成 JWT Token
        const tokens = generateTokenPair({ id: user.id, clientId: newClientId });
        
        res.json({
            success: true,
            message: '登录成功',
            user: {
                id: user.id,
                clientId: newClientId,
                nickname: user.nickname,
                avatar: user.avatar,
                email: user.email,
                emailVerified: true,
                hasPassword: !!user.has_password,
                totalGames: user.total_games,
                totalScore: user.total_score,
                bestScore: user.best_score
            },
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken
        });
    } catch (dbError) {
        console.error('[数据库] 验证码登录失败:', dbError.message);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

// ============================================
// 密码管理
// ============================================

/**
 * 设置密码（已绑定邮箱但未设置密码的用户）
 * POST /api/auth/set-password
 * Body: { email, code, password }
 */
router.post('/set-password', async (req, res) => {
    const { email, code, password } = req.body;
    
    // 参数验证
    if (!email || !code || !password) {
        return res.status(400).json({ success: false, error: '参数不完整' });
    }
    
    // 验证密码强度
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
        return res.status(400).json({ success: false, error: passwordCheck.error });
    }
    
    // 验证验证码
    const verifyResult = verifyCode(email, code);
    if (!verifyResult.valid) {
        return res.status(400).json({ success: false, error: verifyResult.error });
    }
    
    try {
        const emailLower = email.toLowerCase();
        
        // 查找用户
        const users = await query(
            'SELECT * FROM users WHERE email = ? AND email_verified = 1',
            [emailLower]
        );
        
        if (!users || users.length === 0) {
            return res.status(404).json({ success: false, error: '该邮箱未注册' });
        }
        
        const user = users[0];
        
        // 加密密码
        const passwordHash = await hashPassword(password);
        
        // 更新密码
        await execute(
            'UPDATE users SET password = ?, has_password = 1 WHERE id = ?',
            [passwordHash, user.id]
        );
        
        res.json({
            success: true,
            message: '密码设置成功'
        });
    } catch (dbError) {
        console.error('[数据库] 设置密码失败:', dbError.message);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

/**
 * 重置密码
 * POST /api/auth/reset-password
 * Body: { email, code, newPassword }
 */
router.post('/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;
    
    // 参数验证
    if (!email || !code || !newPassword) {
        return res.status(400).json({ success: false, error: '参数不完整' });
    }
    
    // 验证密码强度
    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.valid) {
        return res.status(400).json({ success: false, error: passwordCheck.error });
    }
    
    // 验证验证码
    const verifyResult = verifyCode(email, code);
    if (!verifyResult.valid) {
        return res.status(400).json({ success: false, error: verifyResult.error });
    }
    
    try {
        const emailLower = email.toLowerCase();
        
        // 查找用户
        const users = await query(
            'SELECT * FROM users WHERE email = ? AND email_verified = 1',
            [emailLower]
        );
        
        if (!users || users.length === 0) {
            return res.status(404).json({ success: false, error: '该邮箱未注册' });
        }
        
        const user = users[0];
        
        // 加密新密码
        const passwordHash = await hashPassword(newPassword);
        
        // 更新密码
        await execute(
            'UPDATE users SET password = ?, has_password = 1 WHERE id = ?',
            [passwordHash, user.id]
        );
        
        res.json({
            success: true,
            message: '密码重置成功'
        });
    } catch (dbError) {
        console.error('[数据库] 重置密码失败:', dbError.message);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

// ============================================
// Token 管理
// ============================================

/**
 * 刷新 Token
 * POST /api/auth/refresh
 * Body: { refreshToken }
 */
router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
        return res.status(400).json({ success: false, error: '缺少 Refresh Token' });
    }
    
    const result = verifyRefreshToken(refreshToken);
    
    if (!result.valid) {
        return res.status(401).json({ 
            success: false, 
            error: result.error,
            code: result.code || 'REFRESH_INVALID'
        });
    }
    
    // 生成新的 Token 对
    const tokens = generateTokenPair({ id: result.payload.id, clientId: result.payload.clientId });
    
    res.json({
        success: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
    });
});

/**
 * 登出
 * POST /api/auth/logout
 * Header: Authorization: Bearer <accessToken>
 */
router.post('/logout', authMiddleware, (req, res) => {
    const token = extractToken(req);
    
    if (token) {
        invalidateToken(token);
    }
    
    res.json({
        success: true,
        message: '登出成功'
    });
});

/**
 * 验证 Token 有效性
 * GET /api/auth/verify
 * Header: Authorization: Bearer <accessToken>
 */
router.get('/verify', authMiddleware, (req, res) => {
    res.json({
        success: true,
        message: 'Token 有效',
        user: {
            id: req.user.id,
            clientId: req.user.clientId
        }
    });
});

// ============================================
// 用户信息
// ============================================

/**
 * 获取用户信息
 * GET /api/auth/user/:clientId
 */
router.get('/user/:clientId', optionalAuthMiddleware, async (req, res) => {
    const { clientId } = req.params;
    
    try {
        const users = await query(
            'SELECT * FROM users WHERE client_id = ?',
            [clientId]
        );
        
        if (!users || users.length === 0) {
            return res.json({
                success: true,
                user: null,
                message: '新用户'
            });
        }
        
        const user = users[0];
        
        res.json({
            success: true,
            user: {
                id: user.id,
                clientId: user.client_id,
                nickname: user.nickname,
                avatar: user.avatar,
                email: user.email,
                emailVerified: !!user.email_verified,
                hasPassword: !!user.has_password,
                totalGames: user.total_games,
                totalScore: user.total_score,
                bestScore: user.best_score
            }
        });
    } catch (dbError) {
        console.error('[数据库] 获取用户信息失败:', dbError.message);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

/**
 * 更新用户信息（需要认证）
 * POST /api/auth/update-profile
 * Header: Authorization: Bearer <accessToken>
 * Body: { nickname, avatar }
 */
router.post('/update-profile', authMiddleware, async (req, res) => {
    const { nickname, avatar } = req.body;
    const { clientId } = req.user;
    
    try {
        const updates = [];
        const values = [];
        
        if (nickname) {
            updates.push('nickname = ?');
            values.push(nickname);
        }
        if (avatar) {
            updates.push('avatar = ?');
            values.push(avatar);
        }
        
        if (updates.length > 0) {
            values.push(clientId);
            await execute(
                `UPDATE users SET ${updates.join(', ')} WHERE client_id = ?`,
                values
            );
        }
        
        res.json({ success: true, message: '更新成功' });
    } catch (dbError) {
        console.error('[数据库] 更新用户信息失败:', dbError.message);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

module.exports = router;