const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const wordBank = require('./words/wordBank');
const { createWebSocketAdapter } = require('./websocket-adapter');
const { initDatabase, saveGameRecord, getLeaderboard, createOrUpdateUser, updateLeaderboard } = require('./db/init');
const authRoutes = require('./routes/auth');
const gobangRoutes = require('./routes/gobang');
const { recordAndDetect, checkBlacklisted, clearCache, CHEAT_CONFIG } = require('./utils/blacklist');
const RoomPersistence = require('./db/room-persistence');
const { securityHeaders, developmentCorsMiddleware, requestSizeLimiter } = require('./middleware/security-headers');
const { generalLimiter } = require('./middleware/rate-limiter');

const app = express();
const server = http.createServer(app);

// 安全响应头中间件
app.use(securityHeaders);

// CORS 配置（开发环境允许所有来源）
app.use(developmentCorsMiddleware);

// 请求大小限制
app.use(requestSizeLimiter('10mb'));

// API 通用速率限制
app.use('/api/', generalLimiter);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const PORT = process.env.PORT || 3000;

// 优先使用与可执行文件同级的 public 目录，便于外部替换资源；打包时回退到快照内的 public
const publicPath = (() => {
    const besideExe = path.join(path.dirname(process.execPath), 'public');
    if (fs.existsSync(besideExe)) return besideExe;
    return path.join(__dirname, '../public');
})();

app.use(express.static(publicPath));

// 解析 JSON 请求体
app.use(express.json());

// 挂载认证路由
app.use('/api/auth', authRoutes);

// 挂载五子棋路由
app.use('/api/gobang', gobangRoutes);

// 排行榜 API
app.get('/api/leaderboard', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const leaderboard = await getLeaderboard(limit);
        res.json({ success: true, leaderboard });
    } catch (error) {
        console.error('[API] 获取排行榜失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

// 添加根路径重定向到大厅页面
app.get('/', (req, res) => {
    res.redirect('/lobby.html');
});

// ===== 房间状态机 =====
const ROOM_STATUS = {
    WAITING: 'waiting',
    PLAYING: 'playing',
    FINISHED: 'finished'
};

// 合法状态流转表
const STATUS_TRANSITIONS = {
    [ROOM_STATUS.WAITING]: [ROOM_STATUS.PLAYING],
    [ROOM_STATUS.PLAYING]: [ROOM_STATUS.PLAYING, ROOM_STATUS.FINISHED],
    [ROOM_STATUS.FINISHED]: [ROOM_STATUS.WAITING]
};

// 校验状态流转是否合法
function canTransitionStatus(fromStatus, toStatus) {
    if (!fromStatus || !toStatus) return false;
    if (fromStatus === toStatus) return true;
    const allowed = STATUS_TRANSITIONS[fromStatus];
    return allowed && allowed.includes(toStatus);
}

// 尝试变更房间状态，非法则返回 false
function transitionRoomStatus(room, newStatus) {
    if (!canTransitionStatus(room.status, newStatus)) {
        console.warn(`非法房间状态流转: ${room.code} ${room.status} -> ${newStatus}`);
        return false;
    }
    room.status = newStatus;
    return true;
}

// 生成发送给客户端的房间快照（默认会隐藏 currentWord 等敏感字段）
function getRoomSnapshot(room) {
    if (!room) return null;
    // 找到房主的 ID
    const hostPlayer = room.players.find(p => p.isHost);
    return {
        code: room.code,
        name: room.name,
        type: room.gameMode || 'classic',
        gameMode: room.gameMode || 'classic', // 添加 gameMode 字段，方便前端判断
        status: room.status,
        maxPlayers: room.maxPlayers,
        roundTime: room.roundTime,
        currentRound: room.currentRound,
        maxRounds: room.maxRounds,
        currentPainter: room.currentPainter,
        hostId: hostPlayer ? hostPlayer.id : null,
        wordPackId: room.wordPackId,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            status: p.status,
            score: p.score,
            avatar: p.avatar,
            color: p.color, // 五子棋玩家颜色
            role: p.role, // 五子棋玩家角色
            seatIndex: p.seatIndex !== undefined ? p.seatIndex : room.players.indexOf(p)
        })),
        spectators: room.spectators || []
    };
}

// 校验创建房间参数
function validateRoomOptions(options) {
    if (!options || typeof options !== 'object') {
        return { valid: false, message: '参数错误' };
    }

    const name = String(options.name || '').trim();
    if (!name || name.length > 20) {
        return { valid: false, message: '房间名称长度应为 1-20 个字符' };
    }

    const playerName = String(options.playerName || '').trim();
    if (!playerName || playerName.length > 12) {
        return { valid: false, message: '玩家昵称长度应为 1-12 个字符' };
    }

    const maxPlayers = parseInt(options.maxPlayers, 10);
    if (isNaN(maxPlayers) || maxPlayers < 2 || maxPlayers > 12) {
        return { valid: false, message: '房间人数应在 2-12 之间' };
    }

    const roundTime = parseInt(options.roundTime, 10);
    if (isNaN(roundTime) || roundTime < 10 || roundTime > 300) {
        return { valid: false, message: '绘画时间应在 10-300 秒之间' };
    }

    // 支持的游戏模式
    const allowedModes = ['classic', 'gobang'];
    const gameMode = options.gameMode || 'classic';
    if (!allowedModes.includes(gameMode)) {
        return { valid: false, message: '未知的游戏模式' };
    }

    // 五子棋特殊配置：固定人数为2人
    console.log('[调试] 五子棋验证 - gameMode:', gameMode, 'maxPlayers:', maxPlayers, 'options.maxPlayers:', options.maxPlayers);
    if (gameMode === 'gobang' && maxPlayers !== 2) {
        console.log('[调试] 五子棋验证失败 - maxPlayers值:', maxPlayers, '类型:', typeof maxPlayers);
        return { valid: false, message: '五子棋模式仅支持2人对战' };
    }

    if (options.isPrivate) {
        const password = String(options.password || '').trim();
        if (!password || password.length > 20) {
            return { valid: false, message: '私密房间密码长度应为 1-20 个字符' };
        }
    }

    return { valid: true };
}

// 广播房间状态更新
function broadcastRoomUpdate(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    io.to(roomCode).emit('roomUpdate', getRoomSnapshot(room));
}

// 处理下一轮逻辑
function handleNextRound(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    // 只有进行中的房间才能进入下一轮
    if (room.status !== ROOM_STATUS.PLAYING) {
        console.warn(`handleNextRound 非法调用: ${roomCode} 状态为 ${room.status}`);
        return;
    }

    room.currentRound++;
    room.guessRankings = []; // 清空答题排名
    // 新回合开始，清空笔迹历史和快照
    room.strokeHistory = [];
    room.lastSnapshot = null;

    // 一轮游戏结束条件：所有在线玩家都绘画过一次
    const onlinePlayers = room.players.filter(p => p.status !== 'offline');
    const totalTurns = onlinePlayers.length;

    if (room.currentRound > totalTurns) {
        stopRoundTimer(roomCode); // 游戏结束，停止计时
        if (!transitionRoomStatus(room, ROOM_STATUS.FINISHED)) {
            return;
        }
        const rankings = getRankings(room);
        io.to(roomCode).emit('gameEnded', { room: getRoomSnapshot(room), rankings });
        console.log(`游戏结束: ${roomCode}`);

        saveGameRecord(room, rankings).then(gameId => {
            if (gameId) {
                console.log(`[数据库] 对局记录已保存，ID: ${gameId}`);
            }
        }).catch(err => {
            console.error('[数据库] 保存对局记录异常:', err.message);
        });

        rankings.forEach(player => {
            if (player.id) {
                createOrUpdateUser(player.id, player.name, player.avatar).then(userId => {
                    if (userId) {
                        updateLeaderboard(userId, player.name, player.avatar, player.score);
                    }
                }).catch(err => {
                    console.error('[数据库] 用户/排行榜更新异常:', err.message);
                });
            }
        });

        // 重置房间为等待状态，方便玩家重新开始
        setTimeout(() => {
            resetRoomToWaiting(roomCode);
        }, 3000);
        return;
    }

    // 筛选在线玩家作为候选绘画者
    if (onlinePlayers.length < 2) {
        stopRoundTimer(roomCode);
        if (room.painterSwitchTimer) {
            clearTimeout(room.painterSwitchTimer);
            room.painterSwitchTimer = null;
        }
        io.to(roomCode).emit('roomDestroyed', { message: '在线玩家不足，游戏结束' });
        rooms.delete(roomCode);
        return;
    }

    const painterIndex = room.players.findIndex(p => p.id === room.currentPainter);
    // 找到下一个在线玩家
    let nextPainter = null;
    for (let i = 1; i <= room.players.length; i++) {
        const p = room.players[(painterIndex + i) % room.players.length];
        if (p && p.status !== 'offline') {
            nextPainter = p;
            break;
        }
    }

    if (!nextPainter) {
        nextPainter = onlinePlayers[0];
    }

    room.currentPainter = nextPainter.id;
    room.currentWord = null; // 等待绘画者手动选择
    room.wordCandidates = generateWordCandidates(room, 6);
    room.refreshLeft = 3; // 剩余刷新次数

    room.players.forEach(p => {
        if (p.status !== 'offline') p.status = 'playing';
    });

    // 向所有人广播回合开始（此时答案未确定，只显示等待提示）
    io.to(roomCode).emit('roundStarted', {
        round: room.currentRound,
        totalRounds: onlinePlayers.length,
        painterId: room.currentPainter,
        timer: room.roundTime,
        category: null,
        wordLength: null,
        hint: null,
        selecting: true
    });

    // 单独给绘画者发送候选词汇列表（确保在 gameStarted 之前发送）
    io.to(room.currentPainter).emit('wordCandidates', {
        candidates: room.wordCandidates,
        refreshLeft: room.refreshLeft
    });
    console.log(`[选词] 发送候选词汇给绘画者 ${room.currentPainter}:`, room.wordCandidates.length, '个词汇');

    broadcastRoomUpdate(roomCode);

    // 绘画者选择词汇后才会启动计时器
}

const rooms = new Map();
const lastCanvasEmit = new Map(); // 绘画事件限频缓存
const messageRateLimit = new Map(); // 聊天/猜词消息限频缓存
const strokeIncrementLimit = new Map(); // 笔迹增量限频缓存

// ===== 性能配置 =====
const PERFORMANCE_CONFIG = {
    canvasThrottleMs: 30,       // Canvas 更新限频（毫秒）
    strokeThrottleMs: 16,       // 笔迹增量限频（毫秒）约 60fps
    messageThrottleMs: 1000,    // 消息限频窗口
    maxStrokesPerRoom: 1000,    // 每房间最大笔迹数
    roomCleanupInterval: 60000, // 空闲房间清理间隔（毫秒）
    roomMaxIdleTime: 300000     // 房间最大空闲时间（毫秒）
};

// 生成公开房间列表（不含 currentWord 等敏感字段）
function getPublicRoomList() {
    return Array.from(rooms.values())
        .filter(r => {
            // 过滤掉私密房间
            if (r.isPrivate) return false;

            // 过滤掉没有在线玩家的房间
            const onlinePlayers = r.players.filter(p => p.status !== 'offline');
            if (onlinePlayers.length === 0) return false;

            return true;
        })
        .map(r => ({
            id: r.code,
            code: r.code,
            name: r.name,
            type: r.gameMode || 'classic',
            gameMode: r.gameMode || 'classic', // 添加 gameMode 字段，方便前端判断
            status: r.status,
            currentPlayers: r.players.filter(p => p.status !== 'offline').length,
            maxPlayers: r.maxPlayers,
            roundTime: r.roundTime,
            isPrivate: r.isPrivate,
            // 简要玩家信息（用于显示头像）
            players: r.players.filter(p => p.status !== 'offline').map(p => ({
                name: p.name,
                avatar: p.avatar || p.name[0]
            }))
        }));
}

// 广播房间列表更新到所有客户端
function broadcastRoomList() {
    io.emit('roomList', getPublicRoomList());
}

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// 获取最终排行榜
function getRankings(room) {
    return room.players
        .filter(p => p.status !== 'offline')
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .map((p, index) => ({
            rank: index + 1,
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            score: p.score || 0,
            isHost: p.isHost
        }));
}

// 游戏结束后重置房间为等待状态
function resetRoomToWaiting(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    stopRoundTimer(roomCode); // 重置时确保计时器停止

    // 清理绘画者掉线宽限期定时器
    if (room.painterSwitchTimer) {
        clearTimeout(room.painterSwitchTimer);
        room.painterSwitchTimer = null;
    }

    if (!transitionRoomStatus(room, ROOM_STATUS.WAITING)) {
        return;
    }

    room.currentRound = 0;
    room.currentPainter = null;
    room.currentWord = null;
    room.wordCandidates = null;
    room.refreshLeft = 0;
    room.guessRankings = [];
    // 清空笔迹历史和快照
    room.strokeHistory = [];
    room.lastSnapshot = null;

    room.players.forEach(p => {
        // 离线玩家也一并重置，避免重连后出现状态/分数不一致
        // 房主自动设为 ready，避免游戏结束后无法立即重新开始
        p.status = p.isHost ? 'ready' : 'waiting';
        p.score = 0;
        if (room.scores) {
            room.scores[p.id] = 0;
        }
    });

    broadcastRoomUpdate(roomCode);
    broadcastRoomList();
    console.log(`房间已重置为等待状态: ${roomCode}`);
}

// 根据排名计算分数（第1名10分，第2名8分，第3名6分，第4名5分，第5名4分，第6名3分，第7名2分，第8名及之后1分）
function calculateScoreByRank(rank) {
    const scoreMap = {
        1: 10,
        2: 8,
        3: 6,
        4: 5,
        5: 4,
        6: 3,
        7: 2
    };
    return scoreMap[rank] || 1; // 第8名及之后为1分
}

// 对已经猜中的玩家进行简单和谐：若聊天内容直接打出答案，替换为 ***
function censorWord(message, word) {
    if (!message || !word) return message;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    return message.replace(regex, '***');
}

// 聊天/猜词消息限流：每个 socket 在 1 秒内最多发送 3 条
function checkMessageRateLimit(socketId) {
    const now = Date.now();
    const windowSize = 1000;
    const maxCount = 3;

    let record = messageRateLimit.get(socketId);
    if (!record || now - record.windowStart >= windowSize) {
        record = { windowStart: now, count: 1 };
        messageRateLimit.set(socketId, record);
        return true;
    }

    if (record.count >= maxCount) {
        return false;
    }

    record.count++;
    return true;
}

// 生成绘画者候选词汇列表（同一批次内不重复，每次刷新独立随机）
function generateWordCandidates(room, count = 6) {
    const candidates = [];
    const seen = new Set();
    let attempts = 0;
    const maxAttempts = count * 20; // 防止词库过小导致死循环

    while (candidates.length < count && attempts < maxAttempts) {
        const word = wordBank.getRandomWord(room.wordPackId);
        attempts++;
        if (!seen.has(word)) {
            seen.add(word);
            candidates.push(word);
        }
    }

    // 若词库不足，允许重复填充以满足数量要求
    while (candidates.length < count) {
        candidates.push(wordBank.getRandomWord(room.wordPackId));
    }

    return candidates;
}

// 启动回合倒计时
function startRoundTimer(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    stopRoundTimer(roomCode); // 先停止旧计时器
    room.remainingTime = room.roundTime;

    io.to(roomCode).emit('timerUpdate', { remainingTime: room.remainingTime });

    room.timerInterval = setInterval(() => {
        room.remainingTime--;
        if (room.remainingTime <= 0) {
            room.remainingTime = 0;
            stopRoundTimer(roomCode);
            io.to(roomCode).emit('timerUpdate', { remainingTime: 0 });

            // 公布答案并准备切换下一回合
            if (room.currentWord) {
                io.to(roomCode).emit('roundEnded', {
                    word: room.currentWord.word,
                    message: '时间到！正确答案是：'
                });
            }

            setTimeout(() => {
                handleNextRound(roomCode);
            }, 3000);
        } else {
            io.to(roomCode).emit('timerUpdate', { remainingTime: room.remainingTime });
        }
    }, 1000);
}

// 停止回合倒计时
function stopRoundTimer(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
    }
}

// ===== 性能优化：清理空闲房间 =====
function cleanupIdleRooms() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [roomCode, room] of rooms.entries()) {
        // 获取在线玩家数量
        const onlinePlayers = room.players.filter(p => p.status !== 'offline');
        const hasOnlinePlayers = onlinePlayers.length > 0;
        const lastActivity = room.lastActivity || room.creationTime || now;

        // 立即清理条件1：没有玩家的房间
        if (room.players.length === 0) {
            stopRoundTimer(roomCode);
            if (room.timerInterval) {
                clearInterval(room.timerInterval);
            }
            rooms.delete(roomCode);

            // 删除数据库中的房间
            RoomPersistence.deleteRoom(roomCode).catch(err => {
                console.error('[房间清理] 删除房间失败:', err.message);
            });

            cleanedCount++;
            console.log(`[房间清理] 清理空房间: ${roomCode}`);
            continue;
        }

        // 立即清理条件2：所有玩家都离线且超过30秒
        if (!hasOnlinePlayers) {
            const offlineDuration = now - lastActivity;
            const maxOfflineTime = 30000; // 30秒

            if (offlineDuration > maxOfflineTime) {
                stopRoundTimer(roomCode);
                if (room.timerInterval) {
                    clearInterval(room.timerInterval);
                }
                rooms.delete(roomCode);

                // 删除数据库中的房间
                RoomPersistence.deleteRoom(roomCode).catch(err => {
                    console.error('[房间清理] 删除房间失败:', err.message);
                });

                cleanedCount++;
                console.log(`[房间清理] 清理离线房间: ${roomCode} (离线 ${Math.round(offlineDuration/1000)}秒)`);
                continue;
            }
        }

        // 常规清理：超过最大空闲时间的房间
        const isIdle = now - lastActivity > PERFORMANCE_CONFIG.roomMaxIdleTime;
        if (!hasOnlinePlayers && isIdle) {
            stopRoundTimer(roomCode);
            if (room.timerInterval) {
                clearInterval(room.timerInterval);
            }
            rooms.delete(roomCode);

            RoomPersistence.deleteRoom(roomCode).catch(err => {
                console.error('[房间清理] 删除房间失败:', err.message);
            });

            cleanedCount++;
            console.log(`[房间清理] 清理超时空闲房间: ${roomCode}`);
        }
    }

    if (cleanedCount > 0) {
        console.log(`[性能] 本次清理 ${cleanedCount} 个空闲房间，当前房间数: ${rooms.size}`);
    }

}

// ===== 五子棋辅助函数 =====

// 检查五子棋胜负
function checkGobangWinner(board, x, y, color) {
    const directions = [
        [[0, 1], [0, -1]],   // 垂直
        [[1, 0], [-1, 0]],   // 水平
        [[1, 1], [-1, -1]], // 对角线
        [[1, -1], [-1, 1]]  // 反对角线
    ];

    for (const [dir1, dir2] of directions) {
        let count = 1;

        // 方向1
        let nx = x + dir1[0];
        let ny = y + dir1[1];
        while (nx >= 0 && nx < 15 && ny >= 0 && ny < 15 && board[nx][ny] === color) {
            count++;
            nx += dir1[0];
            ny += dir1[1];
        }

        // 方向2
        nx = x + dir2[0];
        ny = y + dir2[1];
        while (nx >= 0 && nx < 15 && ny >= 0 && ny < 15 && board[nx][ny] === color) {
            count++;
            nx += dir2[0];
            ny += dir2[1];
        }

        if (count >= 5) {
            return color;
        }
    }

    return null;
}

// 保存五子棋游戏记录
async function saveGobangGame(room) {
    try {
        const winner = room.players.find(p => p.color === room.winner);
        const loser = room.players.find(p => p.color !== room.winner);

        if (!winner || !loser) {
            console.error('[五子棋] 保存记录失败: 找不到玩家');
            return;
        }

        // 调用五子棋记录保存函数
        const { saveGobangGame: saveGame } = require('./db/gobang-records');
        await saveGame({
            roomCode: room.code,
            blackPlayer: room.players[0],
            whitePlayer: room.players[1],
            winner: winner,
            loser: loser,
            moveHistory: room.moveHistory,
            duration: Date.now() - room.createdAt
        });

        console.log(`[五子棋] 游戏记录已保存: ${room.code}`);
    } catch (err) {
        console.error('[五子棋] 保存记录异常:', err.message);
    }
}

// 处理五子棋玩家离开
function handleGobangPlayerLeave(socket, roomCode) {
    const room = rooms.get(roomCode);

    if (!room) {
        return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player) {
        return;
    }

    console.log(`[五子棋] 玩家离开: ${roomCode} - ${player.name}`);

    // 如果游戏未结束，通知对手
    if (!room.gameOver) {
        io.to(roomCode).emit('gobangOpponentLeft', {
            playerName: player.name
        });
    }

    // 移除玩家
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(roomCode);

    // 如果房间空了，删除房间
    if (room.players.length === 0) {
        rooms.delete(roomCode);
        console.log(`[五子棋] 房间已删除: ${roomCode}`);
    }
}
function updateRoomActivity(roomCode) {
    const room = rooms.get(roomCode);
    if (room) {
        room.lastActivity = Date.now();
    }
}

let onlineCountDebounce = null;

function getOnlineStats() {
    const total = io.engine.clientsCount;
    let playing = 0;
    
    for (const [, room] of rooms) {
        if (room.status === 'playing') {
            playing += room.players.filter(p => p.status !== 'offline').length;
        }
    }
    
    const browsing = total - playing;
    
    return { total, playing, browsing };
}

function broadcastOnlineCount() {
    if (onlineCountDebounce) clearTimeout(onlineCountDebounce);
    onlineCountDebounce = setTimeout(() => {
        const stats = getOnlineStats();
        io.emit('onlineCount', stats);
    }, 1000);
}

io.on('connection', (socket) => {
    console.log(`玩家连接: ${socket.id}`);

    broadcastOnlineCount();

    socket.on('getOnlineCount', (callback) => {
        const stats = getOnlineStats();
        if (callback) {
            callback({ success: true, ...stats });
        }
    });

    socket.on('createRoom', async (options, callback) => {
        const validation = validateRoomOptions(options);
        if (!validation.valid) {
            if (callback) callback({ success: false, message: validation.message });
            return;
        }

        // 检查黑名单
        const clientId = options.clientId || socket.id;
        const isBlacklisted = await checkBlacklisted(clientId);
        if (isBlacklisted) {
            if (callback) callback({ success: false, message: '您因作弊已被禁止创建房间', blacklisted: true });
            return;
        }

        const roomCode = generateRoomCode();
        const gameMode = options.gameMode || 'classic';

        // 创建基础房间结构
        const room = {
            code: roomCode,
            name: options.name || '未命名房间',
            maxPlayers: options.maxPlayers || 8,
            roundTime: options.roundTime || 90,
            gameMode: gameMode,
            isPrivate: options.isPrivate || false,
            password: options.password || null,
            hostId: socket.id, // 记录房主 socket ID
            players: [],
            spectators: [], // 观战者列表
            status: 'waiting',
            lastActivity: Date.now() // 初始化活动时间
        };

        // 根据游戏类型添加特定字段
        if (gameMode === 'gobang') {
            // 五子棋特有字段
            room.board = [];
            room.currentTurn = 'black';
            room.moveHistory = [];
            room.gameOver = false;
            room.winner = null;
            room.createdAt = Date.now();

            // 初始化棋盘
            for (let i = 0; i < 15; i++) {
                room.board[i] = [];
                for (let j = 0; j < 15; j++) {
                    room.board[i][j] = null;
                }
            }
        } else {
            // 经典模式（你画我猜）特有字段
            room.currentRound = 0;
            room.maxRounds = 5;
            room.currentPainter = null;
            room.currentWord = null;
            room.wordPackId = options.wordPackId || 'default';
            room.scores = {};
            room.guessRankings = [];
            room.roundStartTime = null;
            room.strokeHistory = [];
            room.lastSnapshot = null;
        }

        // 房主作为第一个玩家加入
        const player = {
            id: socket.id,
            clientId: options.clientId || socket.id,
            name: options.playerName || '房主',
            isHost: true,
            status: 'ready',
            score: 0,
            avatar: options.playerAvatar || (options.playerName || '房主')[0]
        };

        // 五子棋房间添加颜色和角色字段
        if (gameMode === 'gobang') {
            player.color = 'black';
            player.role = 'player';
        }

        room.players.push(player);

        // 经典模式才需要 scores
        if (gameMode === 'classic') {
            room.scores[socket.id] = 0;
        }

        socket.join(roomCode);
        rooms.set(roomCode, room);

        // P0 优化：持久化房间到数据库
        RoomPersistence.createRoom({
            code: roomCode,
            name: room.name,
            hostClientId: player.clientId,
            isPrivate: room.isPrivate,
            password: room.password,
            gameMode: room.gameMode,
            maxPlayers: room.maxPlayers,
            roundTime: room.roundTime
        }).then(result => {
            if (result.success) {
                console.log(`[房间持久化] 房间已保存: ${roomCode}`);
            }
        }).catch(err => {
            console.error('[房间持久化] 保存房间失败:', err.message);
        });

        // 持久化房主玩家
        RoomPersistence.addPlayerToRoom(roomCode, {
            clientId: player.clientId,
            nickname: player.name,
            avatar: player.avatar,
            isHost: true,
            seatIndex: 0
        }).catch(err => {
            console.error('[房间持久化] 保存房主失败:', err.message);
        });

        // 广播房间列表更新到所有客户端
        broadcastRoomList();

        // 向房间内广播脱敏后的房间数据（不包含 currentWord）
        broadcastRoomUpdate(roomCode);

        // 使用回调返回响应（回调内部包含快照，不暴露 currentWord）
        if (callback) {
            callback({ success: true, roomCode, room: getRoomSnapshot(room), player });
        }

        updateRoomActivity(roomCode); // 性能优化：更新房间活动时间
        console.log(`房间创建: ${roomCode} by ${player.name}`);
    });

    socket.on('joinRoom', async ({ roomCode, playerName, password, playerAvatar, clientId }, callback) => {
        const room = rooms.get(roomCode);

        if (!room) {
            if (callback) callback({ success: false, message: '房间不存在' });
            return;
        }

        // 检查黑名单
        const isBlacklisted = await checkBlacklisted(clientId || socket.id);
        if (isBlacklisted) {
            if (callback) callback({ success: false, message: '您因作弊已被禁止加入房间', blacklisted: true });
            return;
        }

        // 优先使用 clientId 判断是否为重连用户，避免同名冲突
        const existingPlayer = clientId
            ? room.players.find(p => p.clientId === clientId)
            : room.players.find(p => p.name === playerName);
        
        // 重连用户跳过密码验证
        if (!existingPlayer) {
            // 新用户需要验证密码
            if (room.isPrivate && room.password !== password) {
                if (callback) callback({ success: false, message: '密码错误' });
                return;
            }
        }
        if (existingPlayer) {
            const oldId = existingPlayer.id;
            // 更新现有玩家的 socket.id 和状态
            existingPlayer.id = socket.id;
            // 根据房间状态恢复玩家状态：游戏中则恢复为 playing，等待中按原逻辑处理
            existingPlayer.status = room.status === ROOM_STATUS.PLAYING ? 'playing' : (existingPlayer.isHost ? 'ready' : 'waiting');
            existingPlayer.avatar = playerAvatar || existingPlayer.avatar || playerName[0];
            // 允许重连时更新昵称，但身份标识保持不变
            if (playerName) {
                existingPlayer.name = playerName;
            }

            // 取消离线清理定时器
            if (existingPlayer.offlineTimer) {
                clearTimeout(existingPlayer.offlineTimer);
                existingPlayer.offlineTimer = null;
            }

            // 如果该玩家是当前绘画者，更新房间的 currentPainter ID 并取消回合切换宽限期
            if (room.currentPainter === oldId) {
                room.currentPainter = socket.id;
                if (room.painterSwitchTimer) {
                    clearTimeout(room.painterSwitchTimer);
                    room.painterSwitchTimer = null;
                    console.log(`绘画者 ${existingPlayer.name} 重连，取消回合切换`);
                }
            }

            // 迁移分数记录：把旧 socket.id 的分数转到新的 socket.id，避免脏 key 累积
            if (room.scores[oldId] !== undefined) {
                room.scores[socket.id] = room.scores[oldId];
                delete room.scores[oldId];
            } else if (!room.scores[socket.id]) {
                room.scores[socket.id] = existingPlayer.score || 0;
            }
            existingPlayer.score = room.scores[socket.id];

            // 迁移本回合答题排名中的旧 socket.id
            room.guessRankings = room.guessRankings.map(id => id === oldId ? socket.id : id);

            socket.join(roomCode);

            // P0 优化：更新数据库中的玩家在线状态
            RoomPersistence.setPlayerOnline(roomCode, existingPlayer.clientId).catch(err => {
                console.error('[房间持久化] 更新重连状态失败:', err.message);
            });

            if (callback) {
                callback({ success: true, room: getRoomSnapshot(room), player: existingPlayer, isReconnect: true });
            }

// 如果正在游戏中，向该玩家同步当前回合状态
            if (room.status === ROOM_STATUS.PLAYING) {
                const onlinePlayers = room.players.filter(p => p.status !== 'offline');
                if (room.currentWord) {
                    socket.emit('roundStarted', {
                        round: room.currentRound,
                        totalRounds: onlinePlayers.length,
                        painterId: room.currentPainter,
                        timer: room.remainingTime ?? room.roundTime,
                        category: room.currentWord.category,
                        wordLength: room.currentWord.word.length,
                        hint: room.currentWord.hint || null,
                        selecting: false
                    });
                    socket.emit('timerUpdate', { remainingTime: room.remainingTime ?? room.roundTime });
                    if (socket.id === room.currentPainter) {
                        socket.emit('painterWord', {
                            word: room.currentWord.word,
                            category: room.currentWord.category,
                            hint: room.currentWord.hint || null
                        });
                    }
                } else {
                    // 绘画者尚未选择词汇
                    socket.emit('roundStarted', {
                        round: room.currentRound,
                        totalRounds: onlinePlayers.length,
                        painterId: room.currentPainter,
                        timer: room.roundTime,
                        category: null,
                        wordLength: null,
                        hint: null,
                        selecting: true
                    });
                    if (socket.id === room.currentPainter && room.wordCandidates) {
                        socket.emit('wordCandidates', {
                            candidates: room.wordCandidates,
                            refreshLeft: room.refreshLeft
                        });
                    }
                }
            }

            // 向房间内所有玩家广播脱敏后的房间数据更新
            broadcastRoomUpdate(roomCode);
            broadcastRoomList();

            console.log(`玩家重连房间 ${roomCode}: ${playerName}`);
            return;
        }

        // P1 优化：如果房间正在游戏中，返回特殊状态让前端选择
        if (room.status === ROOM_STATUS.PLAYING) {
            // 五子棋房间允许观战者加入进行中的游戏
            if (room.gameMode === 'gobang') {
                const spectator = {
                    id: socket.id,
                    clientId: clientId || socket.id,
                    name: playerName,
                    isHost: false,
                    status: 'spectating',
                    score: 0,
                    avatar: playerAvatar || playerName[0],
                    role: 'spectator'
                };
                room.spectators.push(spectator);
                socket.join(roomCode);
                room.lastActivity = Date.now();

                socket.emit('gobangRoleAssigned', {
                    role: 'spectator',
                    board: room.board,
                    moveHistory: room.moveHistory,
                    currentTurn: room.currentTurn,
                    gameOver: room.gameOver,
                    players: room.players.map(p => ({ name: p.name, color: p.color })),
                    spectators: room.spectators.map(s => ({ name: s.name }))
                });

                if (callback) {
                    callback({ success: true, room: getRoomSnapshot(room), player: spectator });
                }

                broadcastRoomUpdate(roomCode);
                broadcastRoomList();

                console.log(`[五子棋] 观战者加入进行中的房间 ${roomCode}: ${playerName}`);
                return;
            }

            if (callback) {
                callback({
                    success: false,
                    isPlaying: true,
                    message: '房间正在游戏中',
                    room: getRoomSnapshot(room),
                    canSpectate: true
                });
            }
            return;
        }

        // 新玩家加入
        if (room.players.length >= room.maxPlayers) {
            if (callback) callback({ success: false, message: '房间已满' });
            return;
        }

        const player = {
            id: socket.id,
            clientId: clientId || socket.id,
            name: playerName,
            isHost: room.players.length === 0,
            status: 'waiting',
            score: 0,
            avatar: playerAvatar || playerName[0]
        };

        // 五子棋房间添加颜色和角色字段
        if (room.gameMode === 'gobang') {
            // 五子棋房间只有两个对战位
            if (room.players.length < 2) {
                player.color = room.players.length === 0 ? 'black' : 'white';
                player.role = 'player';
            } else {
                // 超过2人作为观战者
                player.role = 'spectator';
                room.spectators.push(player);
            }
        }

        if (player.role !== 'spectator') {
            room.players.push(player);
        }

        // 经典模式才需要 scores
        if (room.gameMode === 'classic') {
            if (!room.scores) {
                room.scores = {};
            }
            room.scores[socket.id] = 0;
        }

        socket.join(roomCode);
        room.lastActivity = Date.now();

        // 五子棋观战者：同步当前棋盘状态
        if (room.gameMode === 'gobang' && player.role === 'spectator') {
            socket.emit('gobangRoleAssigned', {
                role: 'spectator',
                board: room.board,
                moveHistory: room.moveHistory,
                currentTurn: room.currentTurn,
                gameOver: room.gameOver,
                players: room.players.map(p => ({ name: p.name, color: p.color })),
                spectators: room.spectators.map(s => ({ name: s.name }))
            });
        }

        // 使用回调返回响应
        if (callback) {
            callback({ success: true, room: getRoomSnapshot(room), player });
        }

        // 如果正在游戏中，向该玩家同步当前回合状态
        if (room.status === ROOM_STATUS.PLAYING) {
            const onlinePlayers = room.players.filter(p => p.status !== 'offline');
            if (room.currentWord) {
                socket.emit('roundStarted', {
                    round: room.currentRound,
                    totalRounds: onlinePlayers.length,
                    painterId: room.currentPainter,
                    timer: room.remainingTime ?? room.roundTime,
                    category: room.currentWord.category,
                    wordLength: room.currentWord.word.length,
                    hint: room.currentWord.hint || null,
                    selecting: false
                });
                socket.emit('timerUpdate', { remainingTime: room.remainingTime ?? room.roundTime });
                if (socket.id === room.currentPainter) {
                    socket.emit('painterWord', {
                        word: room.currentWord.word,
                        category: room.currentWord.category,
                        hint: room.currentWord.hint || null
                    });
                }
            } else {
                socket.emit('roundStarted', {
                    round: room.currentRound,
                    totalRounds: onlinePlayers.length,
                    painterId: room.currentPainter,
                    timer: room.roundTime,
                    category: null,
                    wordLength: null,
                    hint: null,
                    selecting: true
                });
                if (socket.id === room.currentPainter && room.wordCandidates) {
                    socket.emit('wordCandidates', {
                        candidates: room.wordCandidates,
                        refreshLeft: room.refreshLeft
                    });
                }
            }
        }

        // 向房间内所有玩家广播脱敏后的房间数据更新（包括新加入的玩家）
        broadcastRoomUpdate(roomCode);

        // 更新大厅房间列表
        broadcastRoomList();

        // P0 优化：持久化玩家到数据库
        RoomPersistence.addPlayerToRoom(roomCode, {
            clientId: player.clientId,
            nickname: player.name,
            avatar: player.avatar,
            isHost: player.isHost,
            seatIndex: room.players.length - 1
        }).catch(err => {
            console.error('[房间持久化] 保存玩家失败:', err.message);
        });

        updateRoomActivity(roomCode); // 性能优化：更新房间活动时间
        console.log(`玩家加入房间 ${roomCode}: ${playerName}`);
    });

    // 玩家从游戏页面重新连接进入已创建/已加入的房间（避免重复创建或重复加入）
    socket.on('enterRoom', ({ roomCode, clientId }, callback) => {
        const room = rooms.get(roomCode);

        if (!room) {
            if (callback) callback({ success: false, message: '房间不存在' });
            return;
        }

        // 根据 clientId 查找已有玩家
        const existingPlayer = clientId
            ? room.players.find(p => p.clientId === clientId)
            : room.players.find(p => p.id === socket.id);

        if (!existingPlayer) {
            // 玩家不在房间中，可能是直接通过 URL 进入，让客户端回退到 joinRoom/createRoom
            if (callback) callback({ success: false, message: '玩家不在房间中', notInRoom: true });
            return;
        }

        // 更新 socket id 并加入房间
        const oldId = existingPlayer.id;
        existingPlayer.id = socket.id;
        existingPlayer.status = room.status === ROOM_STATUS.PLAYING ? 'playing' : (existingPlayer.isHost ? 'ready' : 'waiting');

        // 取消离线清理定时器
        if (existingPlayer.offlineTimer) {
            clearTimeout(existingPlayer.offlineTimer);
            existingPlayer.offlineTimer = null;
        }

        socket.join(roomCode);

        // 迁移分数记录
        if (room.scores && room.scores[oldId] !== undefined) {
            room.scores[socket.id] = room.scores[oldId];
            delete room.scores[oldId];
        }

        // 更新数据库在线状态
        RoomPersistence.setPlayerOnline(roomCode, existingPlayer.clientId).catch(err => {
            console.error('[房间持久化] 更新重连状态失败:', err.message);
        });

        if (callback) {
            callback({ success: true, room: getRoomSnapshot(room), player: existingPlayer, isReconnect: true });
        }

        broadcastRoomUpdate(roomCode);
        updateRoomActivity(roomCode);
        console.log(`玩家进入房间 ${roomCode}: ${existingPlayer.name} (clientId: ${existingPlayer.clientId})`);
    });

    // 验证房间密码（仅验证，不加入房间）
    socket.on('validateRoomPassword', ({ roomCode, password }, callback) => {
        const room = rooms.get(roomCode);
        if (!room) {
            if (callback) callback({ success: false, message: '房间不存在' });
            return;
        }
        if (!room.isPrivate) {
            if (callback) callback({ success: true, message: '公开房间无需密码' });
            return;
        }
        if (room.password !== password) {
            if (callback) callback({ success: false, message: '密码错误' });
            return;
        }
        if (callback) callback({ success: true, message: '密码正确' });
    });

    socket.on('leaveRoom', (roomCode) => {
        // 支持对象参数或直接参数
        const actualRoomCode = typeof roomCode === 'object' ? roomCode.roomCode : roomCode;
        const room = rooms.get(actualRoomCode);
        
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            
            if (player && player.isHost) {
                // 如果是房主离开，销毁房间并通知所有人
                stopRoundTimer(actualRoomCode);
                io.to(actualRoomCode).emit('roomDestroyed', { message: '房主已离开，房间已销毁' });
                rooms.delete(actualRoomCode);
                console.log(`房主离开，房间销毁: ${actualRoomCode}`);
            } else {
                // 如果是普通玩家，正常退出并通知其他人
                const isPainter = room.currentPainter === socket.id;
                room.players = room.players.filter(p => p.id !== socket.id);
                socket.leave(actualRoomCode);

                if (room.players.length === 0) {
                    stopRoundTimer(actualRoomCode);
                    rooms.delete(actualRoomCode);
                    console.log(`房间销毁(空): ${actualRoomCode}`);
                } else {
                    io.to(actualRoomCode).emit('playerLeft', socket.id);

                    // 如果离开的玩家是当前的绘画者且正在游戏中，立即结束本回合
                    if (isPainter && room.status === 'playing') {
                        console.log(`绘画者 ${socket.id} 离开了，准备切换下一轮`);
                        stopRoundTimer(actualRoomCode);
                        io.to(actualRoomCode).emit('chatMessage', {
                            playerName: '系统',
                            message: '当前绘画者已离开房间，本回合结束。',
                            timestamp: Date.now()
                        });
                        // 触发下一轮逻辑
                        handleNextRound(actualRoomCode);
                    } else {
                        // 广播最新的房间状态以刷新人数
                        broadcastRoomUpdate(actualRoomCode);
                    }
                    console.log(`普通玩家离开房间: ${actualRoomCode}`);
                }
            }
            broadcastRoomList();
        }
    });

    // P1 优化：观战者加入
    socket.on('joinAsSpectator', async ({ roomCode, playerName, playerAvatar, clientId }, callback) => {
        const room = rooms.get(roomCode);

        if (!room) {
            if (callback) callback({ success: false, message: '房间不存在' });
            return;
        }

        // 创建观战者对象
        const spectator = {
            id: socket.id,
            clientId: clientId || socket.id,
            name: playerName,
            avatar: playerAvatar || playerName[0],
            joinTime: Date.now()
        };

        // 添加到观战者列表
        if (!room.spectators) {
            room.spectators = [];
        }
        room.spectators.push(spectator);

        socket.join(roomCode);

        // 持久化观战者到数据库
        RoomPersistence.addPlayerToRoom(roomCode, {
            clientId: spectator.clientId,
            nickname: spectator.name,
            avatar: spectator.avatar,
            isHost: false,
            isSpectator: true,
            seatIndex: -1
        }).catch(err => {
            console.error('[房间持久化] 保存观战者失败:', err.message);
        });

        // 获取当前画布快照
        const canvasSnapshot = room.lastSnapshot || null;

        // 获取当前游戏状态
        let gameState = null;
        if (room.status === ROOM_STATUS.PLAYING && room.currentWord) {
            const onlinePlayers = room.players.filter(p => p.status !== 'offline');
            gameState = {
                round: room.currentRound,
                totalRounds: onlinePlayers.length,
                painterId: room.currentPainter,
                timer: room.remainingTime ?? room.roundTime,
                category: room.currentWord.category,
                wordLength: room.currentWord.word.length,
                hint: room.currentWord.hint || null,
                selecting: false,
                currentPainterName: room.players.find(p => p.id === room.currentPainter)?.name || '未知'
            };
        }

        if (callback) {
            callback({
                success: true,
                room: getRoomSnapshot(room),
                spectator,
                canvasSnapshot,
                gameState
            });
        }

        // 广播观战者加入消息
        io.to(roomCode).emit('chatMessage', {
            playerName: '系统',
            message: `${playerName} 以观战者身份加入房间`,
            isSystem: true,
            timestamp: Date.now()
        });

        broadcastRoomUpdate(roomCode);
        updateRoomActivity(roomCode);

        console.log(`观战者加入房间 ${roomCode}: ${playerName}`);
    });

    // P1 优化：观战者转玩家
    socket.on('spectatorToPlayer', async ({ roomCode }, callback) => {
        const room = rooms.get(roomCode);

        if (!room) {
            if (callback) callback({ success: false, message: '房间不存在' });
            return;
        }

        // 检查房间是否在游戏中
        if (room.status === ROOM_STATUS.PLAYING) {
            if (callback) callback({ success: false, message: '游戏进行中，请等待下一局' });
            return;
        }

        // 检查房间是否已满
        if (room.players.length >= room.maxPlayers) {
            if (callback) callback({ success: false, message: '房间已满' });
            return;
        }

        // 找到观战者
        const spectatorIndex = room.spectators?.findIndex(s => s.id === socket.id);
        if (spectatorIndex === -1 || spectatorIndex === undefined) {
            if (callback) callback({ success: false, message: '您不是观战者' });
            return;
        }

        const spectator = room.spectators[spectatorIndex];

        // 转换为玩家
        const player = {
            id: socket.id,
            clientId: spectator.clientId,
            name: spectator.name,
            isHost: false,
            status: 'waiting',
            score: 0,
            avatar: spectator.avatar
        };

        // 从观战者列表移除
        room.spectators.splice(spectatorIndex, 1);

        // 添加到玩家列表
        room.players.push(player);
        if (!room.scores) {
            room.scores = {};
        }
        room.scores[socket.id] = 0;

        // 更新数据库
        RoomPersistence.updatePlayerStatus(roomCode, spectator.clientId, {
            isSpectator: false,
            isOnline: true,
            status: 'waiting'
        }).catch(err => {
            console.error('[房间持久化] 更新观战者状态失败:', err.message);
        });

        if (callback) {
            callback({ success: true, room: getRoomSnapshot(room), player });
        }

        // 广播转换消息
        io.to(roomCode).emit('chatMessage', {
            playerName: '系统',
            message: `${spectator.name} 从观战者转为玩家`,
            isSystem: true,
            timestamp: Date.now()
        });

        broadcastRoomUpdate(roomCode);
        broadcastRoomList();

        console.log(`观战者转玩家: ${spectator.name} in ${roomCode}`);
    });

    // 快速匹配
    socket.on('quickMatch', (callback) => {
        // 找一个等待中且未满的房间（排除私密房间）
        const waitingRooms = Array.from(rooms.values()).filter(
            r => r.status === 'waiting' && !r.isPrivate && r.players.length < r.maxPlayers
        );

        if (waitingRooms.length === 0) {
            // 没有可加入的房间，返回提示
            if (callback) {
                callback({
                    success: false,
                    message: '暂无可加入的房间，请创建房间'
                });
            }
            return;
        }

        // 加入一个现有房间（优先选择人数较多的房间，加快游戏开始）
        waitingRooms.sort((a, b) => b.players.length - a.players.length);
        const room = waitingRooms[0];

        const playerName = '玩家' + Math.floor(Math.random() * 10000);
        const player = {
            id: socket.id,
            clientId: socket.id,
            name: playerName,
            isHost: false,
            status: 'waiting',
            score: 0,
            avatar: playerName[0]
        };

        room.players.push(player);
        room.scores[socket.id] = 0;
        socket.join(room.code);

        socket.to(room.code).emit('playerJoined', player);
        updateRoomActivity(room.code); // 性能优化：更新房间活动时间

        if (callback) {
            callback({
                success: true,
                room: getRoomSnapshot(room),
                playerName: player.name,
                playerAvatar: player.avatar
            });
        }
    });

    socket.on('playerReady', ({ roomCode, ready }, callback) => {
        const room = rooms.get(roomCode);
        if (!room) {
            if (callback) callback({ success: false, message: '房间不存在' });
            return;
        }

        const player = room.players.find(p => p.id === socket.id);
        if (!player) {
            if (callback) callback({ success: false, message: '玩家不存在' });
            return;
        }

        player.status = ready ? 'ready' : 'waiting';
        console.log(`玩家 ${player.name} 状态更新: ${player.status}`);

        broadcastRoomUpdate(roomCode);
        broadcastRoomList();

        if (callback) callback({ success: true, status: player.status });
    });

    // 座位交换（移动到空位）
    socket.on('swapSeat', ({ roomCode, fromIndex, toIndex }) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        // 只能在等待状态下交换座位
        if (room.status !== 'waiting') return;

        // 找到发起交换的玩家
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        // 验证 fromIndex 是否是该玩家的当前座位（使用 seatIndex 属性）
        const currentSeatIndex = player.seatIndex !== undefined ? player.seatIndex : room.players.indexOf(player);
        if (currentSeatIndex !== fromIndex) {
            console.log(`座位交换失败: 玩家当前座位是 ${currentSeatIndex}，不是 ${fromIndex}`);
            return;
        }

        // 验证目标座位在有效范围内
        if (toIndex < 0 || toIndex >= room.maxPlayers) {
            console.log(`座位交换失败: 目标座位 ${toIndex + 1} 超出范围`);
            return;
        }

        // 验证目标座位是空位（没有其他玩家占用）
        const targetOccupied = room.players.find(p => p.seatIndex === toIndex);
        if (targetOccupied) {
            console.log(`座位交换失败: 目标座位 ${toIndex + 1} 已有玩家 ${targetOccupied.name}`);
            return;
        }

        // 移动玩家到目标座位（更新 seatIndex）
        player.seatIndex = toIndex;

        broadcastRoomUpdate(roomCode);
        broadcastRoomList();

        console.log(`玩家 ${player.name} 从座位 ${fromIndex + 1} 移动到座位 ${toIndex + 1}`);
    });

    socket.on('startGame', ({ roomCode }, callback) => {
        const room = rooms.get(roomCode);
        if (!room) {
            if (callback) callback({ success: false, message: '房间不存在' });
            return;
        }

        // 防止游戏已经开始后重复触发
        if (room.status !== ROOM_STATUS.WAITING) {
            if (callback) callback({ success: false, message: '房间当前状态无法开始游戏' });
            return;
        }

        // 双重校验：同时检查 room.hostId 和 player.isHost
        const host = room.players.find(p => p.isHost);
        const isHost = (host && host.id === socket.id) || room.hostId === socket.id;
        if (!isHost) {
            if (callback) callback({ success: false, message: '只有房主才能开始游戏' });
            return;
        }

        const readyPlayers = room.players.filter(p => p.status === 'ready');
        if (readyPlayers.length < 2) {
            if (callback) callback({ success: false, message: '至少需要2名玩家准备' });
            return;
        }

        if (!transitionRoomStatus(room, ROOM_STATUS.PLAYING)) {
            if (callback) callback({ success: false, message: '房间当前状态无法开始游戏' });
            return;
        }

        room.currentRound = 1;
        // 游戏开始，初始化笔迹历史和快照
        room.strokeHistory = [];
        room.lastSnapshot = null;
        // 按照座位顺序选择第一个绘画者（seatIndex 为 0 的玩家）
        const sortedPlayers = room.players
            .filter(p => p.status === 'ready')
            .sort((a, b) => {
                const aIndex = a.seatIndex !== undefined ? a.seatIndex : room.players.indexOf(a);
                const bIndex = b.seatIndex !== undefined ? b.seatIndex : room.players.indexOf(b);
                return aIndex - bIndex;
            });
        room.currentPainter = sortedPlayers[0].id;
        room.currentWord = null; // 等待绘画者手动选择
        room.wordCandidates = generateWordCandidates(room, 6);
        room.refreshLeft = 3; // 剩余刷新次数
        room.guessRankings = []; // 清空答题排名
        room.maxRounds = sortedPlayers.length; // 一轮游戏按准备玩家数量进行

        // 将所有玩家状态更新为 'playing'
        room.players.forEach(p => {
            p.status = 'playing';
        });

        const roomSnapshot = getRoomSnapshot(room);

        if (callback) {
            callback({ success: true, room: roomSnapshot });
        }

        io.to(roomCode).emit('gameStarted', {
            room: roomSnapshot
        });

        // 向所有人广播回合开始（此时答案未确定，只显示等待提示）
        io.to(roomCode).emit('roundStarted', {
            round: room.currentRound,
            totalRounds: room.maxRounds,
            painterId: room.currentPainter,
            timer: room.roundTime,
            category: null,
            wordLength: null,
            hint: null,
            selecting: true
        });

        // 单独给绘画者发送候选词汇列表
        io.to(room.currentPainter).emit('wordCandidates', {
            candidates: room.wordCandidates,
            refreshLeft: room.refreshLeft
        });

        // 绘画者选择词汇后才会启动计时器

        console.log(`游戏开始: ${roomCode}`);
    });

    socket.on('canvasUpdate', ({ roomCode, data }) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        // 只有当前绘画者才能广播画布更新
        if (socket.id !== room.currentPainter) {
            console.log(`[canvasUpdate] 非绘画者不能更新画布: ${socket.id}`);
            return;
        }

        // 限频：每个 socket 在每个房间每 30ms 最多转发一次
        const key = `${socket.id}:${roomCode}`;
        const now = Date.now();
        const last = lastCanvasEmit.get(key) || 0;
        if (now - last < 30) return;
        lastCanvasEmit.set(key, now);

        socket.to(roomCode).emit('canvasUpdate', { playerId: socket.id, data });
    });

    // ===== 矢量笔迹同步事件 =====

    // 接收完整笔迹（笔画结束时发送）
    socket.on('stroke', ({ roomCode, stroke }) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        // 只有当前绘画者才能发送笔迹
        if (socket.id !== room.currentPainter) {
            console.log(`[stroke] 非绘画者不能发送笔迹: ${socket.id}`);
            return;
        }

        // 存储笔迹到房间历史
        room.strokeHistory.push(stroke);
        // 性能优化：限制历史长度，避免内存过大
        while (room.strokeHistory.length > PERFORMANCE_CONFIG.maxStrokesPerRoom) {
            room.strokeHistory.shift();
        }

        // 转发给房间内所有竞猜者（不包括绘画者自己）
        socket.to(roomCode).emit('stroke', stroke);
    });

    // 接收笔迹增量（绘画过程中实时发送）
    socket.on('strokeIncrement', ({ roomCode, strokeId, points, tool, color, width }) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        if (socket.id !== room.currentPainter) return;

        // 性能优化：限频约 60fps
        const key = `${socket.id}:${roomCode}`;
        const now = Date.now();
        const last = strokeIncrementLimit.get(key) || 0;
        if (now - last < PERFORMANCE_CONFIG.strokeThrottleMs) return;
        strokeIncrementLimit.set(key, now);

        // 实时转发给竞猜者
        socket.to(roomCode).emit('strokeIncrement', { strokeId, points, tool, color, width });
    });

    // 接收画布快照（定期发送，用于中途加入同步）
    socket.on('canvasSnapshot', ({ roomCode, data, timestamp }) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        if (socket.id !== room.currentPainter) return;

        // 更新房间快照
        room.lastSnapshot = { data, timestamp };

        // 转发给所有竞猜者
        socket.to(roomCode).emit('canvasSnapshot', { data, timestamp });
    });

    // 竞猜者请求画布同步（中途加入或重连）
    socket.on('requestCanvasSync', ({ roomCode }) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        // 先发送最新快照
        if (room.lastSnapshot) {
            socket.emit('canvasSnapshot', room.lastSnapshot);
        }

        // 再发送快照之后的笔迹
        const snapshotTime = room.lastSnapshot?.timestamp || 0;
        const recentStrokes = room.strokeHistory.filter(s => s.timestamp > snapshotTime);

        if (recentStrokes.length > 0) {
            socket.emit('strokeBatch', recentStrokes);
        }
    });

    // 清空画布操作
    socket.on('clearCanvas', ({ roomCode, timestamp }) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        if (socket.id !== room.currentPainter) return;

        // 记录清空操作
        room.strokeHistory.push({ type: 'clear', timestamp });
        if (room.strokeHistory.length > 2000) {
            room.strokeHistory.shift();
        }

        // 转发给竞猜者
        socket.to(roomCode).emit('clearCanvas', { timestamp });
    });

    // 区域擦除操作
    socket.on('areaErase', ({ roomCode, rect, timestamp }) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        if (socket.id !== room.currentPainter) return;

        // 记录区域擦除操作
        room.strokeHistory.push({ type: 'area-erase', rect, timestamp });
        if (room.strokeHistory.length > 2000) {
            room.strokeHistory.shift();
        }

        // 转发给竞猜者
        socket.to(roomCode).emit('areaErase', { rect, timestamp });
    });

    // 绘画者选择绘画目标词
    socket.on('selectWord', ({ roomCode, word }) => {
        const room = rooms.get(roomCode);
        if (!room) {
            console.log(`[selectWord] 房间不存在: ${roomCode}`);
            return;
        }

        // 只有绘画者可以选择词语
        if (socket.id !== room.currentPainter) {
            console.log(`[selectWord] 非绘画者不能选择词语: ${socket.id}`);
            return;
        }

        // 兼容旧客户端可能把候选词对象整个发过来；只取字符串词面
        const wordText = typeof word === 'string' ? word : (word && word.word);
        if (!wordText || typeof wordText !== 'string') {
            console.log(`[selectWord] 无效的词语格式: ${roomCode}`);
            return;
        }

        // 在候选词中查找完整信息
        const matchedCandidate = room.wordCandidates && room.wordCandidates.find(c => c.word === wordText);
        room.currentWord = matchedCandidate || { category: '自定义', word: wordText, hint: null };
        console.log(`[selectWord] 绘画者选择词语: "${room.currentWord.word}"，房间: ${roomCode}`);

        // 向所有人广播回合开始（包含提示信息，不暴露答案）
        io.to(roomCode).emit('roundStarted', {
            round: room.currentRound,
            totalRounds: room.maxRounds,
            painterId: room.currentPainter,
            timer: room.roundTime,
            category: room.currentWord.category,
            wordLength: room.currentWord.word.length,
            hint: room.currentWord.hint || null,
            selecting: false
        });

        // 单独向绘画者发送确认
        socket.emit('painterWord', {
            word: room.currentWord.word,
            category: room.currentWord.category,
            hint: room.currentWord.hint || null
        });

        // 开始倒计时
        startRoundTimer(roomCode);
    });

    // 绘画者刷新候选词汇
    socket.on('refreshWords', ({ roomCode }, callback) => {
        const room = rooms.get(roomCode);
        if (!room) {
            if (callback) callback({ success: false, message: '房间不存在' });
            return;
        }

        // 只有绘画者可以刷新
        if (socket.id !== room.currentPainter) {
            if (callback) callback({ success: false, message: '只有绘画者可以刷新词汇' });
            return;
        }

        if (room.refreshLeft <= 0) {
            if (callback) callback({ success: false, message: '刷新次数已用完' });
            return;
        }

        room.refreshLeft--;
        room.wordCandidates = generateWordCandidates(room, 6);

        console.log(`[refreshWords] 绘画者刷新词汇，剩余次数: ${room.refreshLeft}，房间: ${roomCode}`);

        // 向绘画者返回新的候选词汇
        const payload = {
            candidates: room.wordCandidates,
            refreshLeft: room.refreshLeft
        };
        socket.emit('wordCandidates', payload);

        if (callback) {
            callback({ success: true, ...payload });
        }
    });

    socket.on('guess', async ({ roomCode, guess }) => {
        const room = rooms.get(roomCode);
        if (!room) {
            console.log(`[guess] 房间不存在: ${roomCode}`);
            return;
        }

        const player = room.players.find(p => p.id === socket.id);
        if (!player) {
            console.log(`[guess] 玩家不存在: ${socket.id}`);
            return;
        }

        // 消息限流
        if (!checkMessageRateLimit(socket.id)) {
            console.log(`[guess] 消息发送过于频繁: ${socket.id}`);
            return;
        }

        // 基本输入校验
        const trimmedGuess = String(guess || '').trim();
        if (!trimmedGuess || trimmedGuess.length > 50) {
            return;
        }

        console.log(`[guess] 玩家 ${player.name} 猜测/聊天: "${trimmedGuess}"`);

        // 检查是否有当前词语
        if (!room.currentWord) {
            console.log(`[guess] 房间没有当前词语`);
            return;
        }

        const targetWord = room.currentWord.word.trim();

        // 绘画者发送的内容视为普通聊天（保留互动，但不参与计分）
        if (socket.id === room.currentPainter) {
            io.to(roomCode).emit('chatMessage', {
                playerId: socket.id,
                playerName: player.name,
                playerAvatar: player.avatar,
                message: trimmedGuess,
                isPainter: true,
                timestamp: Date.now()
            });
            return;
        }

        // 已猜中者发送的内容视为普通聊天；若直接打出答案，则做简单和谐，避免 spoil
        const hasAlreadyGuessedCorrect = room.guessRankings.includes(socket.id);
        if (hasAlreadyGuessedCorrect) {
            const safeMessage = censorWord(trimmedGuess, targetWord);
            io.to(roomCode).emit('chatMessage', {
                playerId: socket.id,
                playerName: player.name,
                playerAvatar: player.avatar,
                message: safeMessage,
                timestamp: Date.now()
            });
            return;
        }

        // 正常竞猜逻辑
        const isCorrect = trimmedGuess === targetWord;
        console.log(`[guess] 答案匹配: "${trimmedGuess}" === "${targetWord}" = ${isCorrect}`);

        if (isCorrect) {
            // 作弊检测：计算答题用时
            const answerTime = room.roundStartTime ? Date.now() - room.roundStartTime : 0;
            const clientId = player.clientId || socket.id;
            
            const cheatResult = await recordAndDetect(
                clientId,
                roomCode,
                answerTime,
                true,
                room.currentRound,
                player.userId || null
            );

            // 如果被加入黑名单
            if (cheatResult.blacklisted) {
                io.to(socket.id).emit('blacklisted', {
                    message: cheatResult.warning,
                    reason: '作弊检测'
                });
                
                // 广播系统消息
                io.to(roomCode).emit('chatMessage', {
                    playerName: '系统',
                    message: `${player.name} 因作弊被踢出房间`,
                    isSystem: true,
                    timestamp: Date.now()
                });

                // 转为观战模式
                room.spectators.push({
                    id: socket.id,
                    clientId: clientId,
                    name: player.name,
                    avatar: player.avatar,
                    reason: '作弊'
                });

                // 从玩家列表移除
                room.players = room.players.filter(p => p.id !== socket.id);
                delete room.scores[socket.id];

                broadcastRoomUpdate(roomCode);
                return;
            }

            // 显示警告
            if (cheatResult.warning) {
                io.to(socket.id).emit('cheatWarning', { message: cheatResult.warning });
            }

            // 记录答对排名
            room.guessRankings.push(socket.id);
            const rank = room.guessRankings.length;

            // 根据排名计算分数
            const scoreToAdd = calculateScoreByRank(rank);
            room.scores[socket.id] += scoreToAdd;
            player.score += scoreToAdd;

            console.log(`[guess] 答对了！排名: ${rank}, 加分: ${scoreToAdd}, 总分: ${player.score}`);

            // 广播猜对信息：不暴露答案，只展示玩家和分数
            io.to(roomCode).emit('guessCorrect', {
                playerId: socket.id,
                playerName: player.name,
                playerAvatar: player.avatar,
                score: player.score,
                rank: rank,
                scoreAdded: scoreToAdd
            });

            // 系统提示：只提示有人猜对，不显示答案
            io.to(roomCode).emit('chatMessage', {
                playerName: '系统',
                message: `${player.name} 猜对了！`,
                isSystem: true,
                timestamp: Date.now()
            });

            broadcastRoomUpdate(roomCode);

            // 检查是否所有竞猜者都已猜对
            const onlinePlayers = room.players.filter(p => p.status !== 'offline');
            const guessers = onlinePlayers.filter(p => p.id !== room.currentPainter);
            const allGuessersCorrect = guessers.length > 0 && room.guessRankings.length === guessers.length;

            if (allGuessersCorrect) {
                console.log(`[guess] 所有竞猜者都已猜对，切换到下一位绘画者`);
                // 给绘画者加分
                const painter = room.players.find(p => p.id === room.currentPainter);
                if (painter) {
                    const painterScore = 3 + guessers.length;
                    painter.score += painterScore;
                    room.scores[room.currentPainter] += painterScore;
                    console.log(`[guess] 绘画者 ${painter.name} 获得 ${painterScore} 分`);

                    io.to(roomCode).emit('painterBonus', {
                        painterId: room.currentPainter,
                        painterName: painter.name,
                        score: painterScore,
                        reason: '所有玩家都猜对了'
                    });
                }

                // 停止当前回合计时，延迟2秒后切换到下一位绘画者
                stopRoundTimer(roomCode);
                setTimeout(() => {
                    handleNextRound(roomCode);
                }, 2000);
            }
        } else {
            console.log(`[guess] 答错了`);
            // 答错的 guess 作为普通聊天展示，保留互动趣味性
            io.to(roomCode).emit('guessAttempt', {
                playerId: socket.id,
                playerName: player.name,
                playerAvatar: player.avatar,
                guess: trimmedGuess,
                isCorrect: false
            });
        }
    });

    socket.on('chatMessage', ({ roomCode, message }) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        // 消息限流
        if (!checkMessageRateLimit(socket.id)) {
            console.log(`[chatMessage] 消息发送过于频繁: ${socket.id}`);
            return;
        }

        const trimmed = String(message || '').trim();
        if (!trimmed || trimmed.length > 100) {
            return;
        }

        io.to(roomCode).emit('chatMessage', {
            playerId: socket.id,
            playerName: player.name,
            playerAvatar: player.avatar,
            message: trimmed,
            timestamp: Date.now()
        });
    });

    socket.on('nextRound', ({ roomCode }) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isHost) {
            console.log(`[nextRound] 非房主不能切换回合: ${socket.id}`);
            return;
        }

        handleNextRound(roomCode);
    });

    socket.on('getRooms', () => {
        socket.emit('roomList', getPublicRoomList());
    });

    // ===== 房主踢人功能 =====
    socket.on('kickPlayer', ({ roomCode, targetId }, callback) => {
        const room = rooms.get(roomCode);
        if (!room) {
            if (callback) callback({ success: false, message: '房间不存在' });
            return;
        }

        // 双重校验：检查是否是房主
        const hostPlayer = room.players.find(p => p.isHost);
        const isHost = (hostPlayer && hostPlayer.id === socket.id) || room.hostId === socket.id;
        if (!isHost) {
            if (callback) callback({ success: false, message: '只有房主才能踢人' });
            return;
        }

        // 找到目标玩家
        const targetPlayer = room.players.find(p => p.id === targetId);
        if (!targetPlayer) {
            if (callback) callback({ success: false, message: '玩家不存在' });
            return;
        }

        // 不能踢自己
        if (targetId === socket.id) {
            if (callback) callback({ success: false, message: '不能踢自己' });
            return;
        }

        // 添加到观战列表
        room.spectators.push({
            id: targetPlayer.id,
            clientId: targetPlayer.clientId,
            name: targetPlayer.name,
            avatar: targetPlayer.avatar,
            reason: '被房主踢出'
        });

        // 从玩家列表移除
        room.players = room.players.filter(p => p.id !== targetId);
        delete room.scores[targetId];

        // 通知被踢玩家
        io.to(targetId).emit('kicked', {
            message: '您已被房主踢出房间',
            reason: '房主操作'
        });

        // 广播系统消息
        io.to(roomCode).emit('chatMessage', {
            playerName: '系统',
            message: `${targetPlayer.name} 被房主踢出房间，已转为观战模式`,
            isSystem: true,
            timestamp: Date.now()
        });

        broadcastRoomUpdate(roomCode);

        if (callback) callback({ success: true, message: '踢出成功' });
        console.log(`[kick] ${targetPlayer.name} 被踢出房间 ${roomCode}`);
    });

    // ===== 获取观战者列表 =====
    socket.on('getSpectators', ({ roomCode }, callback) => {
        const room = rooms.get(roomCode);
        if (!room) {
            if (callback) callback({ success: false, spectators: [] });
            return;
        }

        if (callback) callback({ success: true, spectators: room.spectators || [] });
    });

    // ===== 观战者恢复为玩家 =====
    socket.on('restorePlayer', async ({ roomCode, spectatorId }, callback) => {
        const room = rooms.get(roomCode);
        if (!room) {
            if (callback) callback({ success: false, message: '房间不存在' });
            return;
        }

        // 检查是否是房主
        if (room.hostId !== socket.id) {
            if (callback) callback({ success: false, message: '只有房主才能恢复玩家' });
            return;
        }

        // 找到观战者
        const spectator = room.spectators.find(s => s.id === spectatorId);
        if (!spectator) {
            if (callback) callback({ success: false, message: '观战者不存在' });
            return;
        }

        // 检查房间是否已满
        if (room.players.length >= room.maxPlayers) {
            if (callback) callback({ success: false, message: '房间已满' });
            return;
        }

        // 检查黑名单
        if (spectator.reason === '作弊') {
            const isBlacklisted = await checkBlacklisted(spectator.clientId);
            if (isBlacklisted) {
                if (callback) callback({ success: false, message: '该玩家在黑名单中，无法恢复' });
                return;
            }
        }

        // 恢复为玩家
        const player = {
            id: spectator.id,
            clientId: spectator.clientId,
            name: spectator.name,
            avatar: spectator.avatar,
            isHost: false,
            status: 'waiting',
            score: 0
        };

        room.players.push(player);
        room.scores[spectator.id] = 0;
        room.spectators = room.spectators.filter(s => s.id !== spectatorId);

        // 通知恢复的玩家
        io.to(spectatorId).emit('restored', { message: '您已被恢复为玩家' });

        // 广播系统消息
        io.to(roomCode).emit('chatMessage', {
            playerName: '系统',
            message: `${spectator.name} 已恢复为玩家`,
            isSystem: true,
            timestamp: Date.now()
        });

        broadcastRoomUpdate(roomCode);

        if (callback) callback({ success: true });
    });

    socket.on('disconnect', () => {
        console.log(`玩家断开连接: ${socket.id}`);

        // 清理该 socket 的消息限频缓存
        messageRateLimit.delete(socket.id);

        // 标记玩家为离线，但不立即销毁房间
        for (const [roomCode, room] of rooms) {
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                const player = room.players[playerIndex];
                const wasPainter = room.currentPainter === socket.id && room.status === ROOM_STATUS.PLAYING;
                player.status = 'offline';
                player.disconnectTime = Date.now();

                // P0 优化：记录玩家离线状态到数据库
                RoomPersistence.setPlayerOffline(roomCode, player.clientId).catch(err => {
                    console.error('[房间持久化] 记录离线失败:', err.message);
                });

                // 清理该 socket 的绘画限频缓存
                lastCanvasEmit.delete(`${socket.id}:${roomCode}`);

                console.log(`玩家离线: ${player.name} in ${roomCode}`);
                broadcastRoomUpdate(roomCode);

                // 如果绘画者在游戏中掉线，给予短暂宽限期（仅适用于你画我猜模式）
                if (wasPainter && room.gameMode !== 'gobang') {
                    console.log(`绘画者 ${player.name} 掉线，启动回合切换宽限期`);
                    if (room.painterSwitchTimer) {
                        clearTimeout(room.painterSwitchTimer);
                        room.painterSwitchTimer = null;
                    }
                    room.painterSwitchTimer = setTimeout(() => {
                        const currentPainter = room.players.find(p => p.id === room.currentPainter);
                        if (!currentPainter || currentPainter.status === 'offline') {
                            console.log(`绘画者 ${player.name} 宽限期结束，切换回合`);
                            stopRoundTimer(roomCode);
                            io.to(roomCode).emit('chatMessage', {
                                playerName: '系统',
                                message: '当前绘画者已掉线，本回合结束。',
                                isSystem: true,
                                timestamp: Date.now()
                            });
                            handleNextRound(roomCode);
                        }
                        room.painterSwitchTimer = null;
                    }, 5000);
                }

                // P0 优化：房主掉线时自动转让房主
                if (player.isHost) {
                    // 房主掉线：等待 60 秒，如果未重连则转让房主
                    setTimeout(() => {
                        const stillOfflineHost = room.players.find(p => p.id === socket.id && p.status === 'offline' && p.isHost);
                        if (stillOfflineHost) {
                            // 查找在线玩家作为新房主（优先选择分数最高的玩家）
                            const onlinePlayers = room.players.filter(p => p.status !== 'offline' && p.id !== socket.id);

                            if (onlinePlayers.length > 0) {
                                // 按分数排序，选择分数最高的作为新房主
                                onlinePlayers.sort((a, b) => (b.score || 0) - (a.score || 0));
                                const newHost = onlinePlayers[0];

                                // 更新内存中的房主信息
                                stillOfflineHost.isHost = false;
                                newHost.isHost = true;
                                room.hostId = newHost.id;

                                // 更新数据库中的房主信息
                                RoomPersistence.transferHost(roomCode, newHost.clientId)
                                    .then(() => console.log(`[房主转让] ${newHost.name} 成为新房主`))
                                    .catch(err => console.error('[房主转让] 失败:', err.message));

                                // 广播房主变更消息
                                io.to(roomCode).emit('chatMessage', {
                                    playerName: '系统',
                                    message: `${stillOfflineHost.name} 掉线超时，${newHost.name} 已成为新房主`,
                                    isSystem: true,
                                    timestamp: Date.now()
                                });

                                // 发送房间更新
                                broadcastRoomUpdate(roomCode);
                            } else {
                                // 没有在线玩家，销毁房间
                                stopRoundTimer(roomCode);
                                if (room.painterSwitchTimer) {
                                    clearTimeout(room.painterSwitchTimer);
                                    room.painterSwitchTimer = null;
                                }
                                io.to(roomCode).emit('roomDestroyed', { message: '房主掉线超时，房间已销毁' });
                                rooms.delete(roomCode);

                                // 删除数据库中的房间
                                RoomPersistence.deleteRoom(roomCode).catch(err => {
                                    console.error('[房间持久化] 删除房间失败:', err.message);
                                });

                                broadcastRoomList();
                                console.log(`房主掉线超时且无其他玩家，房间销毁: ${roomCode}`);
                            }
                        }
                    }, 60000);
                } else {
                    // 普通玩家掉线：60 秒后仍未重连则自动移出房间
                    player.offlineTimer = setTimeout(() => {
                        const currentRoom = rooms.get(roomCode);
                        if (!currentRoom) return;

                        const stillOfflinePlayer = currentRoom.players.find(p => p.id === socket.id && p.status === 'offline');
                        if (!stillOfflinePlayer) return;

                        currentRoom.players = currentRoom.players.filter(p => p.id !== socket.id);
                        if (currentRoom.scores) {
                            delete currentRoom.scores[socket.id];
                        }
                        if (currentRoom.guessRankings) {
                            currentRoom.guessRankings = currentRoom.guessRankings.filter(id => id !== socket.id);
                        }

                        io.to(roomCode).emit('chatMessage', {
                            playerName: '系统',
                            message: `${stillOfflinePlayer.name} 离线超时，已离开房间`,
                            isSystem: true,
                            timestamp: Date.now()
                        });

                        if (currentRoom.players.length === 0) {
                            stopRoundTimer(roomCode);
                            if (currentRoom.painterSwitchTimer) {
                                clearTimeout(currentRoom.painterSwitchTimer);
                                currentRoom.painterSwitchTimer = null;
                            }
                            rooms.delete(roomCode);

                            // 删除数据库中的房间
                            RoomPersistence.deleteRoom(roomCode).catch(err => {
                                console.error('[房间持久化] 删除房间失败:', err.message);
                            });

                            console.log(`房间空置超时，自动销毁: ${roomCode}`);
                        } else {
                            broadcastRoomUpdate(roomCode);
                        }
                        broadcastRoomList();
                    }, 60000);
                }
                break;
            }
        }

        broadcastOnlineCount();
    });

    // ===== 五子棋房间系统 =====

    // 创建五子棋房间
    socket.on('createGobangRoom', (data) => {
        console.log('[五子棋] 创建房间请求:', data);

        const roomCode = generateRoomCode();
        const playerName = data.playerName || '玩家';
        const clientId = data.clientId || socket.id;

        // 创建五子棋房间
        const gobangRoom = {
            code: roomCode,
            gameMode: 'gobang',
            status: 'waiting',
            players: [{
                id: socket.id,
                clientId: clientId,
                name: playerName,
                color: 'black',
                role: 'player', // player 或 spectator
                status: 'ready'
            }],
            spectators: [], // 观战者列表
            board: [],
            currentTurn: 'black',
            moveHistory: [],
            gameOver: false,
            winner: null,
            createdAt: Date.now(),
            lastActivity: Date.now()
        };

        // 初始化棋盘
        for (let i = 0; i < 15; i++) {
            gobangRoom.board[i] = [];
            for (let j = 0; j < 15; j++) {
                gobangRoom.board[i][j] = null;
            }
        }

        // 存储五子棋房间
        rooms.set(roomCode, gobangRoom);
        socket.join(roomCode);

        console.log(`[五子棋] 房间已创建: ${roomCode}`);

        socket.emit('gobangRoomCreated', {
            roomCode: roomCode,
            playerName: playerName,
            color: 'black',
            role: 'player',
            message: '房间已创建，等待对手加入...'
        });
    });

    // 加入五子棋房间
    socket.on('joinGobangRoom', (data) => {
        console.log('[五子棋] 加入房间请求:', data);

        const { roomCode, playerName, clientId } = data;
        const room = rooms.get(roomCode);

        if (!room) {
            socket.emit('gobangError', { message: '房间不存在' });
            return;
        }

        // 统计当前对战玩家数量
        const playerCount = room.players.length;

        let player;
        let role;

        // 如果对战位未满（少于2人），加入对战
        if (playerCount < 2) {
            player = {
                id: socket.id,
                clientId: clientId || socket.id,
                name: playerName || '玩家',
                color: playerCount === 0 ? 'black' : 'white',
                role: 'player',
                status: 'ready'
            };
            room.players.push(player);
            role = 'player';
        } else {
            // 对战位已满，加入观战
            player = {
                id: socket.id,
                clientId: clientId || socket.id,
                name: playerName || '玩家',
                role: 'spectator',
                status: 'spectating'
            };
            room.spectators.push(player);
            role = 'spectator';
        }

        socket.join(roomCode);
        room.lastActivity = Date.now();

        console.log(`[五子棋] 玩家加入: ${roomCode} - ${player.name} (${role})`);

        // 通知房间内所有玩家
        io.to(roomCode).emit('gobangPlayerJoined', {
            playerName: player.name,
            color: player.color || null,
            role: role,
            gameStarted: room.players.length === 2
        });

        // 如果两人都在，开始游戏
        if (room.players.length === 2 && room.status === 'waiting') {
            room.status = 'playing';
            room.currentTurn = 'black';

            io.to(roomCode).emit('gobangGameStarted', {
                roomCode: roomCode,
                blackPlayer: room.players[0].name,
                whitePlayer: room.players[1].name,
                currentTurn: 'black',
                spectators: room.spectators.map(s => s.name)
            });

            console.log(`[五子棋] 游戏开始: ${roomCode}`);
        }

        // 发送给新加入玩家的个人信息
        socket.emit('gobangRoleAssigned', {
            role: role,
            color: player.color || null,
            board: room.board,
            moveHistory: room.moveHistory,
            currentTurn: room.currentTurn,
            gameOver: room.gameOver,
            players: room.players.map(p => ({ name: p.name, color: p.color })),
            spectators: room.spectators.map(s => ({ name: s.name }))
        });
    });

    // 五子棋玩家准备/取消准备
    socket.on('gobangPlayerReady', ({ roomCode }, callback) => {
        const room = rooms.get(roomCode);

        if (!room) {
            if (callback) callback({ success: false, message: '房间不存在' });
            return;
        }

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.role !== 'player') {
            if (callback) callback({ success: false, message: '当前玩家无法准备' });
            return;
        }

        // 支持 ready ↔ waiting 状态切换
        if (player.status === 'waiting') {
            player.status = 'ready';
        } else if (player.status === 'ready') {
            player.status = 'waiting';
        } else {
            if (callback) callback({ success: false, message: '当前状态无法切换' });
            return;
        }

        io.to(roomCode).emit('gobangPlayerReady', {
            roomCode,
            playerId: player.id,
            playerName: player.name,
            color: player.color,
            status: player.status
        });

        if (callback) callback({ success: true, status: player.status });
    });

    // 五子棋开始游戏
    socket.on('startGobangGame', ({ roomCode }, callback) => {
        const room = rooms.get(roomCode);

        if (!room) {
            if (callback) callback({ success: false, message: '房间不存在' });
            return;
        }

        if (room.gameMode !== 'gobang') {
            if (callback) callback({ success: false, message: '不是五子棋房间' });
            return;
        }

        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isHost) {
            if (callback) callback({ success: false, message: '只有房主才能开始游戏' });
            return;
        }

        const fightingPlayers = room.players.filter(p => p.role === 'player');
        if (fightingPlayers.length !== 2) {
            if (callback) callback({ success: false, message: '需要两名对战玩家才能开始' });
            return;
        }

        // 房主不需要准备，只需要另一名对战玩家已准备
        const otherPlayer = fightingPlayers.find(p => !p.isHost);
        if (!otherPlayer || otherPlayer.status !== 'ready') {
            if (callback) callback({ success: false, message: '所有玩家都准备后才能开始' });
            return;
        }

        if (!transitionRoomStatus(room, ROOM_STATUS.PLAYING)) {
            if (callback) callback({ success: false, message: '房间当前状态无法开始游戏' });
            return;
        }

        // 重置棋盘，准备开始新对局
        for (let i = 0; i < 15; i++) {
            for (let j = 0; j < 15; j++) {
                room.board[i][j] = null;
            }
        }
        room.moveHistory = [];
        room.winner = null;
        room.gameOver = false;
        room.currentTurn = 'black';

        const blackPlayer = fightingPlayers.find(p => p.color === 'black');
        const whitePlayer = fightingPlayers.find(p => p.color === 'white');

        io.to(roomCode).emit('gobangGameStarted', {
            roomCode,
            blackPlayer: blackPlayer ? blackPlayer.name : '',
            whitePlayer: whitePlayer ? whitePlayer.name : '',
            currentTurn: 'black',
            spectators: room.spectators.map(s => s.name)
        });

        if (callback) callback({ success: true });
    });

    // 五子棋落子
    socket.on('gobangMove', (data) => {
        const { roomCode, x, y, color } = data;
        const room = rooms.get(roomCode);

        if (!room) {
            socket.emit('gobangError', { message: '房间不存在' });
            return;
        }

        // 检查玩家角色（观战者不能落子）
        const player = room.players.find(p => p.id === socket.id) ||
                       room.spectators.find(s => s.id === socket.id);

        if (!player) {
            socket.emit('gobangError', { message: '你不在游戏中' });
            return;
        }

        if (player.role === 'spectator') {
            socket.emit('gobangError', { message: '观战者不能落子' });
            return;
        }

        // 检查是否轮到该玩家
        if (room.currentTurn !== color) {
            socket.emit('gobangError', { message: '不是你的回合' });
            return;
        }

        // 检查位置是否已有棋子
        if (room.board[x][y] !== null) {
            socket.emit('gobangError', { message: '该位置已有棋子' });
            return;
        }

        // 落子
        room.board[x][y] = color;
        room.moveHistory.push({ x, y, color, timestamp: Date.now() });
        room.lastActivity = Date.now();

        console.log(`[五子棋] 落子: ${roomCode} - (${x}, ${y}) ${color}`);

        // 广播落子（包括观战者）
        io.to(roomCode).emit('gobangMove', {
            x: x,
            y: y,
            color: color,
            moveNumber: room.moveHistory.length
        });

        // 检查胜负
        const winner = checkGobangWinner(room.board, x, y, color);
        if (winner) {
            room.gameOver = true;
            room.winner = color;

            const winnerPlayer = room.players.find(p => p.color === color);

            io.to(roomCode).emit('gobangGameOver', {
                winner: color,
                winnerName: winnerPlayer ? winnerPlayer.name : '未知',
                moveHistory: room.moveHistory
            });

            console.log(`[五子棋] 游戏结束: ${roomCode} - ${color} 获胜`);

            // 保存游戏记录
            saveGobangGame(room).catch(err => {
                console.error('[五子棋] 保存记录失败:', err.message);
            });
        } else {
            // 切换回合
            room.currentTurn = color === 'black' ? 'white' : 'black';
        }
    });

    // 五子棋游戏结束（认输）
    socket.on('gobangResign', (data) => {
        const { roomCode } = data;
        const room = rooms.get(roomCode);

        if (!room) {
            return;
        }

        const player = room.players.find(p => p.id === socket.id);
        if (!player) {
            return;
        }

        // 认输，对手获胜
        const winnerColor = player.color === 'black' ? 'white' : 'black';
        const winnerPlayer = room.players.find(p => p.color === winnerColor);

        room.gameOver = true;
        room.winner = winnerColor;

        io.to(roomCode).emit('gobangGameOver', {
            winner: winnerColor,
            winnerName: winnerPlayer ? winnerPlayer.name : '未知',
            reason: 'resign',
            resignedPlayer: player.name
        });

        console.log(`[五子棋] 认输: ${roomCode} - ${player.name} 认输`);

        // 保存游戏记录
        saveGobangGame(room).catch(err => {
            console.error('[五子棋] 保存记录失败:', err.message);
        });
    });

    // 五子棋玩家离开
    socket.on('leaveGobangRoom', (data) => {
        const { roomCode } = data;
        handleGobangPlayerLeave(socket, roomCode);
    });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        const lines = [
            `端口 ${PORT} 已被占用，无法启动游戏服务器。`,
            '',
            '请检查：',
            `1. 是否已经双击运行了 你画我猜.exe（只能运行一个）`,
            `2. 是否还有其他程序占用了端口 ${PORT}`
        ];
        console.error(lines.join('\n'));

        // 在 Windows 上弹出消息框，避免黑框一闪而过
        if (process.platform === 'win32') {
            const psMessage = lines.join('`n');
            exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${psMessage}', '启动失败', 'OK', 'Error')"`, () => {
                process.exit(1);
            });
        } else {
            process.exit(1);
        }
    } else {
        console.error('服务器启动失败:', err);
        process.exit(1);
    }
});

server.listen(PORT, '0.0.0.0', async () => {
    const localUrl = `http://localhost:${PORT}`;
    const lanUrl = `http://${getLocalIP()}:${PORT}`;
    console.log(`服务器运行在 ${localUrl}`);
    console.log(`局域网访问地址: ${lanUrl}`);

    await initDatabase();

    // P1 优化：从数据库恢复房间
    try {
        const recoveryResult = await RoomPersistence.recoverRooms();
        if (recoveryResult.success && recoveryResult.rooms.length > 0) {
            for (const room of recoveryResult.rooms) {
                rooms.set(room.code, room);
                console.log(`[房间恢复] 房间 ${room.code} 已恢复到内存`);
            }
            console.log(`[房间恢复] 共恢复 ${recoveryResult.rooms.length} 个房间`);
            broadcastRoomList();
        }
    } catch (recoveryError) {
        console.error('[房间恢复] 恢复失败:', recoveryError.message);
    }

    // 初始化 WebSocket 适配器（支持原生 WebSocket 连接）
    const wsAdapter = createWebSocketAdapter(server, io, rooms, {
        getRoomSnapshot,
        transitionRoomStatus,
        broadcastRoomUpdate,
        validateRoomOptions,
        handleNextRound,
        ROOM_STATUS
    });

    // 性能优化：启动空闲房间清理定时器
    setInterval(cleanupIdleRooms, PERFORMANCE_CONFIG.roomCleanupInterval);
    console.log(`[性能] 空闲房间清理定时器已启动，间隔 ${PERFORMANCE_CONFIG.roomCleanupInterval / 1000} 秒`);

    // 自动打开默认浏览器（仅在 Windows 打包运行时生效，node 命令运行时不影响）
    if (process.platform === 'win32') {
        exec(`start ${localUrl}`, (err) => {
            if (err) console.log('自动打开浏览器失败，请手动访问上述地址');
        });
    }
});

function getLocalIP() {
    const interfaces = require('os').networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}