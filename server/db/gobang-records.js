/**
 * 五子棋房间管理模块
 * 处理对局记录保存和排行榜更新
 */

const { query, execute } = require('./pool');

/**
 * 保存五子棋对局记录
 * @param {Object} gameData - 对局数据
 */
async function saveGobangGame(gameData) {
    const {
        roomCode,
        winnerClientId,
        winnerColor,
        totalMoves,
        duration,
        boardSnapshot,
        moveHistory,
        players
    } = gameData;

    try {
        // 保存对局记录
        const result = await execute(
            `INSERT INTO gobang_records 
            (room_code, winner_client_id, winner_color, total_moves, duration, board_snapshot, move_history, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'finished')`,
            [
                roomCode,
                winnerClientId || null,
                winnerColor || null,
                totalMoves,
                duration,
                JSON.stringify(boardSnapshot),
                JSON.stringify(moveHistory)
            ]
        );

        const gameId = result.insertId;

        // 保存玩家记录
        for (const player of players) {
            await execute(
                `INSERT INTO gobang_players 
                (game_id, client_id, nickname, avatar, color, is_winner, move_count, time_used)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    gameId,
                    player.clientId,
                    player.nickname,
                    player.avatar,
                    player.color,
                    player.clientId === winnerClientId ? 1 : 0,
                    player.moveCount || 0,
                    player.timeUsed || 0
                ]
            );

            // 更新排行榜
            await updateGobangLeaderboard(player, player.clientId === winnerClientId);
        }

        console.log(`[五子棋] 对局记录已保存，ID: ${gameId}`);
        return gameId;
    } catch (error) {
        console.error('[五子棋] 保存对局记录失败:', error.message);
        throw error;
    }
}

/**
 * 更新五子棋排行榜
 */
async function updateGobangLeaderboard(player, isWinner) {
    try {
        // 检查是否已有记录
        const existing = await query(
            'SELECT * FROM gobang_leaderboard WHERE client_id = ?',
            [player.clientId]
        );

        if (existing && existing.length > 0) {
            // 更新现有记录
            const record = existing[0];
            const totalGames = record.total_games + 1;
            const wins = record.wins + (isWinner ? 1 : 0);
            const losses = record.losses + (!isWinner ? 1 : 0);
            const winRate = totalGames > 0 ? (wins / totalGames * 100) : 0;
            const totalMoves = record.total_moves + (player.moveCount || 0);
            const avgMoves = totalGames > 0 ? (totalMoves / totalGames) : 0;

            // 计算新积分 (简化版 ELO)
            const ratingChange = isWinner ? 25 : -15;
            const newRating = Math.max(0, record.rating + ratingChange);

            await execute(
                `UPDATE gobang_leaderboard 
                SET total_games = ?, wins = ?, losses = ?, win_rate = ?, 
                    total_moves = ?, avg_moves = ?, rating = ?, nickname = ?, avatar = ?
                WHERE client_id = ?`,
                [
                    totalGames, wins, losses, winRate,
                    totalMoves, avgMoves, newRating,
                    player.nickname, player.avatar,
                    player.clientId
                ]
            );
        } else {
            // 创建新记录
            await execute(
                `INSERT INTO gobang_leaderboard 
                (client_id, nickname, avatar, total_games, wins, losses, win_rate, total_moves, avg_moves, rating)
                VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 1000)`,
                [
                    player.clientId,
                    player.nickname,
                    player.avatar,
                    isWinner ? 1 : 0,
                    isWinner ? 0 : 1,
                    isWinner ? 100.00 : 0.00,
                    player.moveCount || 0,
                    player.moveCount || 0
                ]
            );
        }
    } catch (error) {
        console.error('[五子棋] 更新排行榜失败:', error.message);
    }
}

/**
 * 获取五子棋排行榜
 * @param {number} limit - 返回条数
 * @param {string} orderBy - 排序字段 (rating, wins, win_rate)
 */
async function getGobangLeaderboard(limit = 50, orderBy = 'rating') {
    try {
        const validOrderBy = ['rating', 'wins', 'win_rate', 'total_games'];
        const orderField = validOrderBy.includes(orderBy) ? orderBy : 'rating';

        const results = await query(
            `SELECT 
                id, client_id, nickname, avatar,
                total_games, wins, losses, draws,
                win_rate, total_moves, avg_moves, rating
            FROM gobang_leaderboard 
            ORDER BY ${orderField} DESC 
            LIMIT ?`,
            [limit]
        );

        // 添加排名
        return results.map((row, index) => ({
            ...row,
            rank: index + 1
        }));
    } catch (error) {
        console.error('[五子棋] 获取排行榜失败:', error.message);
        return [];
    }
}

/**
 * 获取玩家五子棋战绩
 */
async function getPlayerGobangStats(clientId) {
    try {
        const results = await query(
            `SELECT * FROM gobang_leaderboard WHERE client_id = ?`,
            [clientId]
        );

        return results && results.length > 0 ? results[0] : null;
    } catch (error) {
        console.error('[五子棋] 获取玩家战绩失败:', error.message);
        return null;
    }
}

/**
 * 获取玩家最近的对局记录
 */
async function getPlayerRecentGames(clientId, limit = 10) {
    try {
        const results = await query(
            `SELECT 
                gr.id, gr.room_code, gr.winner_color, gr.total_moves, 
                gr.duration, gr.created_at,
                gp.color, gp.is_winner
            FROM gobang_players gp
            JOIN gobang_records gr ON gp.game_id = gr.id
            WHERE gp.client_id = ?
            ORDER BY gr.created_at DESC
            LIMIT ?`,
            [clientId, limit]
        );

        return results;
    } catch (error) {
        console.error('[五子棋] 获取历史对局失败:', error.message);
        return [];
    }
}

module.exports = {
    saveGobangGame,
    updateGobangLeaderboard,
    getGobangLeaderboard,
    getPlayerGobangStats,
    getPlayerRecentGames
};