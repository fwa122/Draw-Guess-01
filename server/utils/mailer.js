/**
 * 邮件发送模块
 * 使用 QQ 邮箱 SMTP 服务发送验证码
 */

const nodemailer = require('nodemailer');

// 邮件配置
const transporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true, // SSL
    auth: {
        user: process.env.SMTP_USER || '471338924@qq.com',
        pass: process.env.SMTP_PASS || 'hlbhvtovqbnjbhfc'
    }
});

/**
 * 发送验证码邮件
 * @param {string} email - 目标邮箱
 * @param {string} code - 验证码
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendVerifyCode(email, code) {
    try {
        const senderEmail = process.env.SMTP_USER || '471338924@qq.com';
        const info = await transporter.sendMail({
            from: `"你画我猜游戏" <${senderEmail}>`,
            to: email,
            subject: '【你画我猜】邮箱验证码',
            html: `
                <div style="max-width: 500px; margin: 0 auto; padding: 30px; background: #f8fafc; border-radius: 12px;">
                    <h2 style="color: #1e293b; text-align: center; margin-bottom: 20px;">你画我猜 - 邮箱验证</h2>
                    <div style="background: white; padding: 30px; border-radius: 8px; text-align: center;">
                        <p style="color: #64748b; margin-bottom: 20px;">您的验证码是：</p>
                        <div style="font-size: 32px; font-weight: bold; color: #3b82f6; letter-spacing: 8px; margin: 20px 0;">
                            ${code}
                        </div>
                        <p style="color: #ef4444; font-size: 13px; margin-top: 20px;">
                            验证码 3 分钟内有效，最多可尝试 3 次
                        </p>
                        <p style="color: #94a3b8; font-size: 13px; margin-top: 10px;">
                            请勿将验证码告知他人，谨防被骗
                        </p>
                    </div>
                    <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">
                        如果这不是您的操作，请忽略此邮件
                    </p>
                </div>
            `
        });
        
        console.log(`[邮件] 发送成功: ${email}, MessageID: ${info.messageId}`);
        return { success: true };
    } catch (error) {
        console.error(`[邮件] 发送失败: ${email}`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * 验证邮件配置是否正确
 * @returns {Promise<boolean>}
 */
async function verifyConfig() {
    try {
        await transporter.verify();
        console.log('[邮件] SMTP 配置验证成功');
        return true;
    } catch (error) {
        console.error('[邮件] SMTP 配置验证失败:', error.message);
        return false;
    }
}

module.exports = {
    sendVerifyCode,
    verifyConfig
};