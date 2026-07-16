/**
 * 黑名单管理模块
 * 处理作弊检测、黑名单添加/移除、黑名单检查等
 */

const { query, execute } = require('../db/pool');

// 作弊检测配置
const CHEAT_CONFIG = {
    MIN_ANSWER_TIME: 2000,       // 最小答题时间（毫秒），低于此值视为可疑
    CONSECUTIVE_COUNT: 3,         // 连续可疑次数阈值
    TIME_WINDOW: 60000            // 时间窗口（毫秒），在此时间窗口内统计
};

// 内存中的作弊检测缓存（按 clientId 存储）
const cheatCache = new Map();

/**
 * 记录答题并检测作弊
 * @param {string} clientId - 客户端ID
 * @param {string} roomCode - 房间码
 * @param {number} answerTime - 答题用时（毫秒）
 * @param {boolean} isCorrect - 是否正确
 * @param {number} roundNumber - 回合数
 * @param {number} userId - 用户ID（可选）
 * @returns {{isCheat: boolean, warning?: string, blacklisted: boolean}}
 */
async function recordAndDetect(clientId, roomCode, answerTime, isCorrect, roundNumber, userId = null) {
    // 只检测正确答案
    if (!isCorrect) {
        return { isCheat: false, blacklisted: false };
    }

    // 检查是否已在黑名单
    const isBlacklisted = await checkBlacklisted(clientId);
    if (isBlacklisted) {
        return { 
            isCheat: false, 
            blacklisted: true, 
            warning: '您因作弊已被禁止参与游戏' 
        };
    }

    // 记录到数据库
    try {
        await execute(
            `INSERT INTO cheat_detection (user_id, client_id, room_code, answer_time, is_correct, round_number) 
             VALUES (?, ?, ?, ?, 1, ?)`,
            [userId, clientId, roomCode, answerTime, roundNumber]
        );
    } catch (e) {
        console.error('[作弊检测] 记录失败:', e.message);
    }

    // 检测作弊
    const now = Date.now();
    let cache = cheatCache.get(clientId);
    
    if (!cache) {
        cache = { records: [], warningCount: 0 };
        cheatCache.set(clientId, cache);
    }

    // 清理过期记录
    cache.records = cache.records.filter(r => now - r.time < CHEAT_CONFIG.TIME_WINDOW);

    // 添加新记录
    if (answerTime < CHEAT_CONFIG.MIN_ANSWER_TIME) {
        cache.records.push({ time: now, answerTime, roundNumber });
    }

    // 检测连续可疑答题
    const suspiciousCount = cache.records.length;
    
    if (suspiciousCount >= CHEAT_CONFIG.CONSECUTIVE_COUNT) {
        // 标记为作弊
        await addToBlacklist(clientId, userId, `连续${suspiciousCount}次答题时间低于${CHEAT_CONFIG.MIN_ANSWER_TIME}毫秒`, null);
        
        // 清除缓存
        cheatCache.delete(clientId);
        
        return {
            isCheat: true,
            blacklisted: true,
            warning: `检测到作弊行为：连续${suspiciousCount}次答题时间异常。您已被加入黑名单，禁止参与游戏和排行榜。`
        };
    }

    // 警告提示
    if (suspiciousCount >= 1) {
        cache.warningCount++;
        return {
            isCheat: false,
            blacklisted: false,
            warning: `警告：答题时间异常，请正常游戏。已检测到 ${suspiciousCount} 次可疑答题。`
        };
    }

    return { isCheat: false, blacklisted: false };
}

/**
 * 检查用户是否在黑名单中
 * @param {string} clientId - 客户端ID
 * @returns {Promise<boolean>}
 */
async function checkBlacklisted(clientId) {
    try {
        const users = await query(
            'SELECT id FROM users WHERE client_id = ? AND is_blacklisted = 1',
            [clientId]
        );
        return users && users.length > 0;
    } catch (e) {
        console.error('[黑名单] 检查失败:', e.message);
        return false;
    }
}

/**
 * 添加用户到黑名单
 * @param {string} clientId - 客户端ID
 * @param {number} userId - 用户ID
 * @param {string} reason - 原因
 * @param {number} gameId - 对局ID
 */
async function addToBlacklist(clientId, userId, reason, gameId = null) {
    try {
        // 获取用户信息
        const users = await query('SELECT id, nickname FROM users WHERE client_id = ?', [clientId]);
        if (!users || users.length === 0) {
            console.error('[黑名单] 用户不存在:', clientId);
            return;
        }

        const user = users[0];

        // 更新用户表
        await execute(
            `UPDATE users SET is_blacklisted = 1, blacklist_reason = ?, blacklist_time = NOW() WHERE id = ?`,
            [reason, user.id]
        );

        // 添加黑名单记录
        await execute(
            `INSERT INTO blacklist_records (user_id, client_id, nickname, reason, game_id) VALUES (?, ?, ?, ?, ?)`,
            [user.id, clientId, user.nickname, reason, gameId]
        );

        // 从排行榜移除
        await execute('DELETE FROM leaderboard WHERE user_id = ?', [user.id]);

        console.log(`[黑名单] 已添加: ${user.nickname} (${clientId}), 原因: ${reason}`);
    } catch (e) {
        console.error('[黑名单] 添加失败:', e.message);
    }
}

/**
 * 从黑名单移除用户
 * @param {string} clientId - 客户端ID
 */
async function removeFromBlacklist(clientId) {
    try {
        await execute(
            `UPDATE users SET is_blacklisted = 0, blacklist_reason = NULL, blacklist_time = NULL WHERE client_id = ?`,
            [clientId]
        );

        await execute('DELETE FROM blacklist_records WHERE client_id = ?', [clientId]);

        console.log(`[黑名单] 已移除: ${clientId}`);
    } catch (e) {
        console.error('[黑名单] 移除失败:', e.message);
    }
}

/**
 * 获取黑名单列表
 * @param {number} limit - 限制数量
 * @returns {Promise<Array>}
 */
async function getBlacklist(limit = 50) {
    try {
        return await query(
            `SELECT br.*, u.nickname, u.email FROM blacklist_records br 
             LEFT JOIN users u ON br.user_id = u.id 
             ORDER BY br.created_at DESC LIMIT ?`,
            [limit]
        );
    } catch (e) {
        console.error('[黑名单] 获取列表失败:', e.message);
        return [];
    }
}

/**
 * 清除缓存（游戏结束时调用）
 * @param {string} clientId - 客户端ID
 */
function clearCache(clientId) {
    cheatCache.delete(clientId);
}

/**
 * 清除所有缓存
 */
function clearAllCache() {
    cheatCache.clear();
}

module.exports = {
    recordAndDetect,
    checkBlacklisted,
    addToBlacklist,
    removeFromBlacklist,
    getBlacklist,
    clearCache,
    clearAllCache,
    CHEAT_CONFIG
};