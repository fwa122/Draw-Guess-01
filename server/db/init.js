const fs = require('fs');
const path = require('path');
const { execute, testConnection } = require('./pool');

async function initDatabase() {
    console.log('[数据库] 开始初始化...');
    
    const connected = await testConnection();
    if (!connected) {
        console.error('[数据库] 连接失败，无法初始化');
        return false;
    }
    
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
        console.error('[数据库] schema.sql 文件不存在');
        return false;
    }
    
    const sql = fs.readFileSync(schemaPath, 'utf8');
    const statements = sql.split(';').filter(s => s.trim());
    
    for (const stmt of statements) {
        if (!stmt.trim()) continue;
        try {
            await execute(stmt);
            console.log('[数据库] 执行成功:', stmt.substring(0, 50) + '...');
        } catch (error) {
            console.error('[数据库] 执行失败:', error.message);
        }
    }
    
    console.log('[数据库] 初始化完成');
    return true;
}

async function getLeaderboard(limit = 10) {
    try {
        const rows = await execute(
            'SELECT nickname, avatar, total_score, total_games, rank FROM leaderboard ORDER BY rank LIMIT ?',
            [limit]
        );
        return rows;
    } catch (error) {
        console.error('[数据库] 获取排行榜失败:', error.message);
        return [];
    }
}

async function updateLeaderboard(userId, nickname, avatar, score) {
    try {
        const [userRows] = await execute(
            'SELECT total_score, total_games FROM users WHERE id = ?',
            [userId]
        );
        
        if (userRows.length > 0) {
            const currentTotal = userRows[0].total_score || 0;
            const currentGames = userRows[0].total_games || 0;
            const newTotal = currentTotal + score;
            const newGames = currentGames + 1;
            
            await execute(
                'UPDATE users SET total_score = ?, total_games = ?, nickname = ?, avatar = ? WHERE id = ?',
                [newTotal, newGames, nickname, avatar, userId]
            );
            
            await execute(
                'INSERT INTO leaderboard (user_id, nickname, avatar, total_score, total_games, rank) ' +
                'VALUES (?, ?, ?, ?, ?, 0) ON DUPLICATE KEY UPDATE ' +
                'nickname = VALUES(nickname), avatar = VALUES(avatar), ' +
                'total_score = VALUES(total_score), total_games = VALUES(total_games)',
                [userId, nickname, avatar, newTotal, newGames]
            );
            
            await execute('SET @rank := 0');
            await execute('UPDATE leaderboard SET rank = (@rank := @rank + 1) ORDER BY total_score DESC');
        }
    } catch (error) {
        console.error('[数据库] 更新排行榜失败:', error.message);
    }
}

async function createOrUpdateUser(clientId, nickname, avatar) {
    try {
        const [existing] = await execute(
            'SELECT id FROM users WHERE client_id = ?',
            [clientId]
        );
        
        if (existing.length > 0) {
            const userId = existing[0].id;
            await execute(
                'UPDATE users SET nickname = ?, avatar = ? WHERE id = ?',
                [nickname, avatar, userId]
            );
            return userId;
        } else {
            const result = await execute(
                'INSERT INTO users (client_id, nickname, avatar) VALUES (?, ?, ?)',
                [clientId, nickname, avatar]
            );
            return result.insertId;
        }
    } catch (error) {
        console.error('[数据库] 创建/更新用户失败:', error.message);
        return null;
    }
}

async function saveGameRecord(room, rankings) {
    try {
        const winner = rankings[0];
        
        const result = await execute(
            'INSERT INTO game_records ' +
            '(room_code, room_name, game_mode, round_time, total_rounds, ' +
            'winner_id, winner_name, winner_score, started_at, ended_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                room.code,
                room.name,
                room.gameMode,
                room.roundTime,
                room.currentRound,
                null,
                winner ? winner.name : null,
                winner ? winner.score : 0,
                new Date(),
                new Date()
            ]
        );
        
        const gameId = result.insertId;
        
        for (let i = 0; i < rankings.length; i++) {
            const player = rankings[i];
            await execute(
                'INSERT INTO game_players ' +
                '(game_id, client_id, nickname, avatar, is_host, score, rank, is_winner) ' +
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    gameId,
                    player.id,
                    player.name,
                    player.avatar,
                    player.isHost ? 1 : 0,
                    player.score,
                    i + 1,
                    i === 0 ? 1 : 0
                ]
            );
        }
        
        return gameId;
    } catch (error) {
        console.error('[数据库] 保存对局记录失败:', error.message);
        return null;
    }
}

module.exports = {
    initDatabase,
    getLeaderboard,
    updateLeaderboard,
    createOrUpdateUser,
    saveGameRecord
};