/**
 * 五子棋 API 路由
 */

const express = require('express');
const router = express.Router();
const { getGobangLeaderboard, getPlayerGobangStats, getPlayerRecentGames } = require('../db/gobang-records');
const { query } = require('../db/pool');

/**
 * 获取五子棋排行榜
 * GET /api/gobang/leaderboard?limit=50&orderBy=rating
 */
router.get('/leaderboard', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const orderBy = req.query.orderBy || 'rating';

        const leaderboard = await getGobangLeaderboard(limit, orderBy);

        res.json({
            success: true,
            leaderboard
        });
    } catch (error) {
        console.error('[五子棋] 获取排行榜失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

/**
 * 获取玩家五子棋战绩
 * GET /api/gobang/player/:clientId
 */
router.get('/player/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;

        const stats = await getPlayerGobangStats(clientId);
        const recentGames = await getPlayerRecentGames(clientId, 10);

        res.json({
            success: true,
            stats,
            recentGames
        });
    } catch (error) {
        console.error('[五子棋] 获取玩家战绩失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

/**
 * 获取五子棋游戏历史
 * GET /api/gobang/history/:clientId
 */
router.get('/history/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;
        const limit = parseInt(req.query.limit) || 20;

        const games = await getPlayerRecentGames(clientId, limit);

        res.json({
            success: true,
            games
        });
    } catch (error) {
        console.error('[五子棋] 获取历史对局失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

/**
 * 获取热门玩家 (胜率最高)
 * GET /api/gobang/top-players
 */
router.get('/top-players', async (req, res) => {
    try {
        const results = await query(
            `SELECT client_id, nickname, avatar, wins, total_games, win_rate, rating
             FROM gobang_leaderboard
             WHERE total_games >= 5
             ORDER BY rating DESC
             LIMIT 10`
        );

        res.json({
            success: true,
            players: results
        });
    } catch (error) {
        console.error('[五子棋] 获取热门玩家失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

module.exports = router;