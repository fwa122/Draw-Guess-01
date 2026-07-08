const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const wordBank = require('./words/wordBank');

const app = express();
const server = http.createServer(app);
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
    return {
        code: room.code,
        name: room.name,
        type: room.gameMode || 'classic',
        status: room.status,
        maxPlayers: room.maxPlayers,
        roundTime: room.roundTime,
        currentRound: room.currentRound,
        maxRounds: room.maxRounds,
        currentPainter: room.currentPainter,
        wordPackId: room.wordPackId,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            status: p.status,
            score: p.score,
            avatar: p.avatar,
            seatIndex: p.seatIndex !== undefined ? p.seatIndex : room.players.indexOf(p)
        }))
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

    // 当前仅支持经典模式
    const allowedModes = ['classic'];
    const gameMode = options.gameMode || 'classic';
    if (!allowedModes.includes(gameMode)) {
        return { valid: false, message: '未知的游戏模式' };
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

    // 单独给绘画者发送候选词汇列表
    io.to(room.currentPainter).emit('wordCandidates', {
        candidates: room.wordCandidates,
        refreshLeft: room.refreshLeft
    });

    broadcastRoomUpdate(roomCode);

    // 绘画者选择词汇后才会启动计时器
}

const rooms = new Map();
const lastCanvasEmit = new Map(); // 绘画事件限频缓存
const messageRateLimit = new Map(); // 聊天/猜词消息限频缓存

// 生成公开房间列表（不含 currentWord 等敏感字段）
function getPublicRoomList() {
    return Array.from(rooms.values())
        .filter(r => !r.isPrivate)
        .map(r => ({
            id: r.code,
            code: r.code,
            name: r.name,
            type: r.gameMode || 'classic',
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

io.on('connection', (socket) => {
    console.log(`玩家连接: ${socket.id}`);

    socket.on('createRoom', (options, callback) => {
        const validation = validateRoomOptions(options);
        if (!validation.valid) {
            if (callback) callback({ success: false, message: validation.message });
            return;
        }

        const roomCode = generateRoomCode();
        const room = {
            code: roomCode,
            name: options.name || '未命名房间',
            maxPlayers: options.maxPlayers || 8,
            roundTime: options.roundTime || 90,
            gameMode: options.gameMode || 'classic',
            isPrivate: options.isPrivate || false,
            password: options.password || null,
            players: [],
            status: 'waiting',
            currentRound: 0,
            maxRounds: 5,
            currentPainter: null,
            currentWord: null,
            wordPackId: options.wordPackId || 'default',
            scores: {},
            guessRankings: [] // 本回合答对玩家的排名列表
        };

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
        room.players.push(player);
        room.scores[socket.id] = 0;

        socket.join(roomCode);
        rooms.set(roomCode, room);

        // 广播房间列表更新到所有客户端
        broadcastRoomList();

        // 向房间内广播脱敏后的房间数据（不包含 currentWord）
        broadcastRoomUpdate(roomCode);

        // 使用回调返回响应（回调内部包含快照，不暴露 currentWord）
        if (callback) {
            callback({ success: true, roomCode, room: getRoomSnapshot(room), player });
        }

        console.log(`房间创建: ${roomCode} by ${player.name}`);
    });

    socket.on('joinRoom', ({ roomCode, playerName, password, playerAvatar, clientId }, callback) => {
        const room = rooms.get(roomCode);

        if (!room) {
            if (callback) callback({ success: false, message: '房间不存在' });
            return;
        }

        if (room.isPrivate && room.password !== password) {
            if (callback) callback({ success: false, message: '密码错误' });
            return;
        }

        // 优先使用 clientId 判断是否为重连用户，避免同名冲突
        const existingPlayer = clientId
            ? room.players.find(p => p.clientId === clientId)
            : room.players.find(p => p.name === playerName);
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

        room.players.push(player);
        room.scores[socket.id] = 0;
        socket.join(roomCode);

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

        console.log(`玩家加入房间 ${roomCode}: ${playerName}`);
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

    // 快速匹配
    socket.on('quickMatch', (callback) => {
        // 找一个等待中且未满的房间
        const waitingRooms = Array.from(rooms.values()).filter(
            r => r.status === 'waiting' && r.players.length < r.maxPlayers
        );

        if (waitingRooms.length === 0) {
            // 没有可加入的房间，创建一个新房间
            const roomCode = 'QM' + Date.now().toString(36).toUpperCase();
            const playerName = '玩家' + Math.floor(Math.random() * 10000);
            const player = {
                id: socket.id,
                clientId: socket.id,
                name: playerName,
                isHost: true,
                status: 'ready',
                score: 0,
                avatar: playerName[0]
            };

            const room = {
                code: roomCode,
                name: '快速匹配房间',
                maxPlayers: 6,
                roundTime: 90,
                gameMode: 'classic',
                isPrivate: false,
                password: null,
                players: [player],
                status: 'waiting',
                currentRound: 0,
                maxRounds: 5,
                currentPainter: null,
                currentWord: null,
                wordPackId: 'default',
                scores: { [socket.id]: 0 },
                guessRankings: []
            };

            socket.join(roomCode);
            rooms.set(roomCode, room);

            if (callback) {
                callback({
                    success: true,
                    room: getRoomSnapshot(room),
                    playerName: player.name,
                    playerAvatar: player.avatar
                });
            }
        } else {
            // 加入一个现有房间
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

            if (callback) {
                callback({
                    success: true,
                    room: getRoomSnapshot(room),
                    playerName: player.name,
                    playerAvatar: player.avatar
                });
            }
        }
    });

    socket.on('playerReady', ({ roomCode, ready }) => {
        const room = rooms.get(roomCode);
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.status = ready ? 'ready' : 'waiting';
                console.log(`玩家 ${player.name} 状态更新: ${player.status}`);

                broadcastRoomUpdate(roomCode);

                // 更新大厅房间列表
                broadcastRoomList();
            }
        }
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

        const host = room.players.find(p => p.isHost);
        if (host && host.id !== socket.id) {
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

    socket.on('guess', ({ roomCode, guess }) => {
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

                // 清理该 socket 的绘画限频缓存
                lastCanvasEmit.delete(`${socket.id}:${roomCode}`);

                console.log(`玩家离线: ${player.name} in ${roomCode}`);
                broadcastRoomUpdate(roomCode);

                // 如果绘画者在游戏中掉线，给予短暂宽限期（页面跳转会快速重连）
                if (wasPainter) {
                    console.log(`绘画者 ${player.name} 掉线，启动回合切换宽限期`);
                    if (room.painterSwitchTimer) {
                        clearTimeout(room.painterSwitchTimer);
                        room.painterSwitchTimer = null;
                    }
                    room.painterSwitchTimer = setTimeout(() => {
                        // 宽限期结束后仍未重连，才真正切换回合
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

                // 针对房主和普通玩家设置不同的超时处理
                if (player.isHost) {
                    // 房主掉线：给予较短的重连时间（例如 60秒），超时则销毁房间
                    setTimeout(() => {
                        const stillOfflineHost = room.players.find(p => p.id === socket.id && p.status === 'offline' && p.isHost);
                        if (stillOfflineHost) {
                            stopRoundTimer(roomCode);
                            if (room.painterSwitchTimer) {
                                clearTimeout(room.painterSwitchTimer);
                                room.painterSwitchTimer = null;
                            }
                            io.to(roomCode).emit('roomDestroyed', { message: '房主掉线超时，房间已销毁' });
                            rooms.delete(roomCode);
                            broadcastRoomList();
                            console.log(`房主掉线超时，房间销毁: ${roomCode}`);
                        }
                    }, 60000);
                } else {
                    // 普通玩家掉线：60 秒后仍未重连则自动移出房间，释放座位
                    player.offlineTimer = setTimeout(() => {
                        const currentRoom = rooms.get(roomCode);
                        if (!currentRoom) return;

                        const stillOfflinePlayer = currentRoom.players.find(p => p.id === socket.id && p.status === 'offline');
                        if (!stillOfflinePlayer) return;

                        currentRoom.players = currentRoom.players.filter(p => p.id !== socket.id);
                        delete currentRoom.scores[socket.id];
                        currentRoom.guessRankings = currentRoom.guessRankings.filter(id => id !== socket.id);

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

server.listen(PORT, '0.0.0.0', () => {
    const localUrl = `http://localhost:${PORT}`;
    const lanUrl = `http://${getLocalIP()}:${PORT}`;
    console.log(`服务器运行在 ${localUrl}`);
    console.log(`局域网访问地址: ${lanUrl}`);

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