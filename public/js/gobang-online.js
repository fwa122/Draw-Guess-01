/**
 * 五子棋联机模式 - WebSocket 实时对战
 */

// ===== 配置 =====
const CONFIG = {
    BOARD_SIZE: 15,
    CELL_SIZE: 40,
    PADDING: 20,
    PIECE_RADIUS: 16,
    WIN_COUNT: 5
};

// ===== 游戏状态 =====
let gameState = {
    board: [],
    myColor: null,         // 我执子颜色
    myRole: null,          // 我的角色：player 或 spectator
    myStatus: 'waiting',   // 我的状态：waiting / ready / playing
    isHost: false,         // 是否为房主
    currentTurn: 'black',  // 当前执子方
    moveHistory: [],
    gameOver: false,
    winner: null,
    startTime: null,
    blackTime: 0,
    whiteTime: 0,
    timerInterval: null,
    lastMoveTime: null,
    roomCode: null,
    isMyTurn: false,
    spectators: [],        // 观战者列表
    players: [],           // 对战玩家列表
    roomStatus: 'waiting'  // 房间状态：waiting / playing / finished
};

// WebSocket 连接
let socket = null;

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    initBoard();
    connectToServer();
    bindActions();
});

// ===== 初始化棋盘 =====
function initBoard() {
    gameState.board = [];
    for (let i = 0; i < CONFIG.BOARD_SIZE; i++) {
        gameState.board[i] = [];
        for (let j = 0; j < CONFIG.BOARD_SIZE; j++) {
            gameState.board[i][j] = null;
        }
    }
    drawBoard();
}

// ===== 连接服务器 =====
function connectToServer() {
    socket = io();

    socket.on('connect', () => {
        console.log('[五子棋] 已连接到服务器');
        document.getElementById('statusDot').className = 'status-dot connected';
        document.getElementById('connectionStatus').textContent = '已连接';

        // 获取 URL 参数
        const params = new URLSearchParams(window.location.search);
        const roomCode = params.get('room');
        const action = params.get('action');
        const urlPlayerName = params.get('playerName');
        const urlPlayerAvatar = params.get('playerAvatar');
        const urlClientId = params.get('clientId');
        const urlRoomName = params.get('roomName');
        const urlMaxPlayers = params.get('maxPlayers');
        const urlRoundTime = params.get('roundTime');
        const urlIsPrivate = params.get('isPrivate') === 'true';
        const urlPassword = params.get('password') || '';

        const playerName = urlPlayerName || localStorage.getItem('nickname') || '玩家' + Math.floor(Math.random() * 1000);
        const clientId = urlClientId || localStorage.getItem('draw_guess_client_id') || 'guest_' + Date.now();
        const playerAvatar = urlPlayerAvatar || localStorage.getItem('avatar') || null;

        showWaiting('连接房间中...', roomCode || '--');

        if (action === 'create') {
            // 房主创建五子棋房间
            socket.emit('createRoom', {
                name: urlRoomName || (playerName + ' 的五子棋房间'),
                gameMode: 'gobang',
                maxPlayers: parseInt(urlMaxPlayers, 10) || 2,
                roundTime: parseInt(urlRoundTime, 10) || 90,
                isPrivate: urlIsPrivate,
                password: urlPassword,
                playerName: playerName,
                clientId: clientId,
                playerAvatar: playerAvatar
            }, (response) => {
                if (response && response.success) {
                    console.log('[五子棋] 创建房间成功:', response);
                    setupRoom(response.room, response.player);
                    hideWaiting();
                    Toast.success('房间已创建，等待对手加入');
                } else {
                    console.error('[五子棋] 创建房间失败:', response);
                    Toast.error(response ? response.message : '创建房间失败');
                    setTimeout(() => goBack(), 2000);
                }
            });
        } else if (action === 'join' && roomCode) {
            // 加入已有房间
            socket.emit('joinRoom', {
                roomCode: roomCode,
                playerName: playerName,
                clientId: clientId,
                password: urlPassword,
                playerAvatar: playerAvatar
            }, (response) => {
                if (response && response.success) {
                    console.log('[五子棋] 加入房间成功:', response);
                    setupRoom(response.room, response.player);
                    hideWaiting();
                } else {
                    console.error('[五子棋] 加入房间失败:', response);
                    Toast.error(response ? response.message : '加入房间失败');
                    setTimeout(() => goBack(), 2000);
                }
            });
        } else {
            hideWaiting();
            Toast.error('房间参数错误');
            setTimeout(() => goBack(), 1500);
        }
    });

    socket.on('disconnect', () => {
        console.log('[五子棋] 与服务器断开连接');
        document.getElementById('statusDot').className = 'status-dot disconnected';
        document.getElementById('connectionStatus').textContent = '已断开';
    });

    // 房间状态更新
    socket.on('roomUpdate', (room) => {
        console.log('[五子棋] 房间更新:', room);
        if (room && room.code === gameState.roomCode) {
            updateRoomState(room);
        }
    });

    // 玩家准备/取消准备
    socket.on('gobangPlayerReady', (data) => {
        console.log('[五子棋] 玩家准备状态变更:', data);
        if (data.roomCode === gameState.roomCode) {
            const newStatus = data.status || 'ready';
            // 同步 gameState.players 中的状态
            const targetPlayer = gameState.players.find(p =>
                (data.playerId && p.id === data.playerId) ||
                (data.color && p.color === data.color)
            );
            if (targetPlayer) {
                targetPlayer.status = newStatus;
            }
            // 如果当前玩家就是自己，也同步 myStatus
            if (data.playerId === socket.id || data.color === gameState.myColor) {
                gameState.myStatus = newStatus;
            }
            updatePlayerStatus(data.playerId || data.color, newStatus);
            updateActionButtons();
            if (data.playerName) {
                Toast.info(data.playerName + (newStatus === 'ready' ? ' 已准备' : ' 已取消准备'));
            }
        }
    });

    // 角色分配（观战者或重连时同步状态）
    socket.on('gobangRoleAssigned', (data) => {
        console.log('[五子棋] 角色分配:', data);
        if (data.role === 'spectator') {
            gameState.myRole = 'spectator';
            gameState.myColor = null;
            gameState.roomStatus = data.gameOver ? 'finished' : 'playing';

            // 同步棋盘
            if (data.board) {
                gameState.board = data.board;
                gameState.moveHistory = data.moveHistory || [];
                gameState.currentTurn = data.currentTurn || 'black';
                gameState.gameOver = data.gameOver || false;
                gameState.winner = data.winner || null;
                gameState.spectators = data.spectators || [];

                drawBoard();
                updateHistory();
                updateTurnUI();
                updateRoomStatusDisplay();
                updateActionButtons();

                // 游戏进行中则启动计时器并显示对战信息
                if (gameState.roomStatus === 'playing') {
                    gameState.startTime = Date.now();
                    gameState.lastMoveTime = Date.now();
                    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
                    gameState.timerInterval = setInterval(updateTimer, 1000);
                    Toast.info('你正在观战');
                }
            }
        }
    });

    // 游戏开始
    socket.on('gobangGameStarted', (data) => {
        console.log('[五子棋] 游戏开始:', data);
        if (data.roomCode === gameState.roomCode) {
            startGame(data);
        }
    });

    // 收到落子
    socket.on('gobangMove', (data) => {
        console.log('[五子棋] 收到落子:', data);
        applyMove(data.x, data.y, data.color);
    });

    // 游戏结束
    socket.on('gobangGameOver', (data) => {
        console.log('[五子棋] 游戏结束:', data);
        handleGameOver(data);
    });

    // 对手离开
    socket.on('gobangOpponentLeft', () => {
        console.log('[五子棋] 对手已离开');
        showOpponentLeft();
    });

    // 错误处理
    socket.on('gobangError', (data) => {
        console.error('[五子棋] 错误:', data.message);
        Toast.error(data.message);
    });

    // 通用错误
    socket.on('error', (message) => {
        console.error('[五子棋] 服务器错误:', message);
        Toast.error(message);
    });
}

// ===== 绑定操作按钮 =====
function bindActions() {
    const readyBtn = document.getElementById('readyBtn');
    const startBtn = document.getElementById('startBtn');
    const canvas = document.getElementById('gobangBoard');

    if (readyBtn) {
        readyBtn.addEventListener('click', () => {
            // 允许在 waiting 或 ready 状态下点击（准备 / 取消准备）
            if (!gameState.roomCode || (gameState.myStatus !== 'waiting' && gameState.myStatus !== 'ready')) return;
            readyBtn.disabled = true;
            socket.emit('gobangPlayerReady', { roomCode: gameState.roomCode }, (response) => {
                if (response && response.success) {
                    // 状态由 gobangPlayerReady 广播事件统一同步，此处仅恢复按钮可点击
                    readyBtn.disabled = false;
                } else {
                    readyBtn.disabled = false;
                    Toast.error(response ? response.message : '操作失败');
                }
            });
        });
    }

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (!gameState.roomCode || !gameState.isHost) return;
            startBtn.disabled = true;
            socket.emit('startGobangGame', { roomCode: gameState.roomCode }, (response) => {
                if (response && response.success) {
                    Toast.success('游戏开始');
                } else {
                    startBtn.disabled = false;
                    Toast.error(response ? response.message : '开始游戏失败');
                }
            });
        });
    }

    if (canvas) {
        canvas.addEventListener('click', handleClick);
        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            const touch = e.changedTouches[0];
            handleClick({ clientX: touch.clientX, clientY: touch.clientY });
        });
    }
}

// ===== 设置房间信息 =====
function setupRoom(room, player) {
    if (!room) return;

    gameState.roomCode = room.code;
    gameState.roomStatus = room.status || 'waiting';
    gameState.spectators = room.spectators || [];
    gameState.players = (room.players || []).filter(p => p.role === 'player');

    if (player) {
        gameState.myColor = player.color || null;
        gameState.myRole = player.role || 'spectator';
        gameState.myStatus = player.status || 'waiting';
        gameState.isHost = !!player.isHost;
    }

    document.getElementById('roomCodeDisplay').textContent = room.code;
    document.getElementById('waitingRoomCode').textContent = room.code;

    updateRoomState(room);
}

// ===== 更新房间状态 =====
function updateRoomState(room) {
    if (!room) return;

    gameState.roomStatus = room.status || 'waiting';
    gameState.spectators = room.spectators || [];
    gameState.players = (room.players || []).filter(p => p.role === 'player');

    // 更新房主信息
    const hostPlayer = room.players.find(p => p.isHost);
    if (hostPlayer && hostPlayer.id === socket.id) {
        gameState.isHost = true;
    }

    // 更新当前玩家在房间中的状态
    const me = room.players.find(p => p.id === socket.id);
    if (me) {
        gameState.myStatus = me.status;
        gameState.myColor = me.color;
        gameState.myRole = me.role;
        gameState.isHost = !!me.isHost;
    }

    // 更新黑棋玩家
    const blackPlayer = gameState.players.find(p => p.color === 'black');
    if (blackPlayer) {
        document.getElementById('blackPlayerName').textContent = blackPlayer.name;
        updatePlayerStatus('black', blackPlayer.status);
    } else {
        document.getElementById('blackPlayerName').textContent = '等待加入';
        updatePlayerStatus('black', 'empty');
    }

    // 更新白棋玩家
    const whitePlayer = gameState.players.find(p => p.color === 'white');
    if (whitePlayer) {
        document.getElementById('whitePlayerName').textContent = whitePlayer.name;
        updatePlayerStatus('white', whitePlayer.status);
    } else {
        document.getElementById('whitePlayerName').textContent = '等待加入';
        updatePlayerStatus('white', 'empty');
    }

    // 更新房间状态显示
    updateRoomStatusDisplay();

    // 更新观战者列表
    updateSpectatorsList(gameState.spectators);

    // 更新操作按钮
    updateActionButtons();

    // 如果游戏已开始，同步棋盘状态
    if (gameState.roomStatus === 'playing' && room.board) {
        // 保持当前棋盘不变，由 gameStarted 事件处理
    }
}

// ===== 更新玩家状态标签 =====
function updatePlayerStatus(colorOrId, status) {
    const color = typeof colorOrId === 'string' && (colorOrId === 'black' || colorOrId === 'white')
        ? colorOrId
        : (gameState.players.find(p => p.id === colorOrId)?.color);

    if (!color) return;

    const statusEl = document.getElementById(color + 'PlayerStatus');
    if (!statusEl) return;

    const statusMap = {
        'waiting': { text: '等待中', className: 'waiting' },
        'ready': { text: '已准备', className: 'ready' },
        'playing': { text: '游戏中', className: 'playing' },
        'empty': { text: '未加入', className: 'empty' }
    };

    const info = statusMap[status] || statusMap['waiting'];
    statusEl.innerHTML = `<span class="status-badge ${info.className}">${info.text}</span>`;
}

// ===== 更新房间状态显示 =====
function updateRoomStatusDisplay() {
    const roomStatusEl = document.getElementById('roomStatus');
    const turnTextEl = document.querySelector('#currentTurn .turn-text');

    if (!roomStatusEl || !turnTextEl) return;

    const statusMap = {
        'waiting': { text: '等待中', className: '' },
        'playing': { text: '游戏中', className: 'playing' },
        'finished': { text: '已结束', className: '' }
    };

    const info = statusMap[gameState.roomStatus] || statusMap['waiting'];
    roomStatusEl.textContent = info.text;
    roomStatusEl.className = 'room-status ' + info.className;

    if (gameState.roomStatus === 'waiting') {
        if (gameState.players.length < 2) {
            turnTextEl.textContent = '等待对手加入';
        } else {
            const allReady = gameState.players.every(p => p.status === 'ready');
            if (allReady) {
                turnTextEl.textContent = gameState.isHost ? '可以开始游戏' : '等待房主开始';
            } else {
                turnTextEl.textContent = '等待玩家准备';
            }
        }
    } else if (gameState.roomStatus === 'playing') {
        turnTextEl.textContent = gameState.isMyTurn ? '轮到你落子' : '等待对手';
    }
}

// ===== 更新操作按钮 =====
function updateActionButtons() {
    const readyBtn = document.getElementById('readyBtn');
    const startBtn = document.getElementById('startBtn');

    if (!readyBtn || !startBtn) return;

    // 游戏开始后隐藏操作按钮
    if (gameState.roomStatus === 'playing' || gameState.roomStatus === 'finished') {
        readyBtn.style.display = 'none';
        startBtn.style.display = 'none';
        return;
    }

    // 非房主显示准备按钮
    if (!gameState.isHost && gameState.myRole === 'player') {
        readyBtn.style.display = 'inline-flex';
        readyBtn.disabled = false;
        readyBtn.innerHTML = gameState.myStatus === 'ready'
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>取消准备`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>准备`;
    } else {
        readyBtn.style.display = 'none';
    }

    // 房主显示开始按钮：房主无需准备，只需所有非房主对战玩家已准备
    if (gameState.isHost && gameState.players.length === 2) {
        const nonHostPlayers = gameState.players.filter(p => !p.isHost);
        const allReady = nonHostPlayers.length > 0 && nonHostPlayers.every(p => p.status === 'ready');
        startBtn.style.display = 'inline-flex';
        startBtn.disabled = !allReady;
    } else {
        startBtn.style.display = 'none';
    }
}

// ===== 开始游戏 =====
function startGame(data) {
    console.log('[五子棋] 开始游戏:', data);

    gameState.roomStatus = 'playing';
    gameState.gameOver = false;
    gameState.moveHistory = [];
    gameState.board = [];
    for (let i = 0; i < CONFIG.BOARD_SIZE; i++) {
        gameState.board[i] = [];
        for (let j = 0; j < CONFIG.BOARD_SIZE; j++) {
            gameState.board[i][j] = null;
        }
    }

    // 隐藏等待弹窗
    hideWaiting();

    // 更新玩家信息
    if (data.blackPlayer) {
        document.getElementById('blackPlayerName').textContent = data.blackPlayer;
    }
    if (data.whitePlayer) {
        document.getElementById('whitePlayerName').textContent = data.whitePlayer;
    }

    // 更新玩家状态为游戏中
    gameState.players.forEach(p => {
        p.status = 'playing';
        updatePlayerStatus(p.color, 'playing');
    });

    // 更新观战者列表
    if (data.spectators && data.spectators.length > 0) {
        updateSpectatorsList(data.spectators);
    }

    // 初始化状态
    gameState.currentTurn = data.currentTurn || 'black';
    gameState.isMyTurn = gameState.currentTurn === gameState.myColor;
    gameState.startTime = Date.now();
    gameState.lastMoveTime = Date.now();

    // 更新 UI
    updateRoomStatusDisplay();
    updateTurnUI();
    updateActionButtons();

    // 启动计时器
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
    }
    gameState.timerInterval = setInterval(updateTimer, 1000);

    // 显示认输按钮
    if (gameState.myRole === 'player') {
        document.getElementById('surrenderBtn').style.display = 'flex';
    }

    // 重绘棋盘
    drawBoard();

    // 显示提示
    if (gameState.myRole === 'player') {
        Toast.success('游戏开始！你执' + (gameState.myColor === 'black' ? '黑' : '白') + '棋');
    } else {
        Toast.info('游戏已经开始，你正在观战');
    }
}

// ===== 处理点击 =====
function handleClick(event) {
    // 观战者不能落子
    if (gameState.myRole !== 'player') {
        if (gameState.myRole === 'spectator') {
            Toast.warning('观战者不能落子');
        }
        return;
    }

    // 非游戏状态不能落子
    if (gameState.roomStatus !== 'playing') {
        Toast.warning('游戏尚未开始');
        return;
    }

    if (gameState.gameOver) return;
    if (!gameState.isMyTurn) {
        Toast.warning('还没轮到你');
        return;
    }

    const canvas = document.getElementById('gobangBoard');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    const cellSize = (canvas.width - 2 * CONFIG.PADDING) / (CONFIG.BOARD_SIZE - 1);

    const x = Math.round((clickX - CONFIG.PADDING) / cellSize);
    const y = Math.round((clickY - CONFIG.PADDING) / cellSize);

    if (x < 0 || x >= CONFIG.BOARD_SIZE || y < 0 || y >= CONFIG.BOARD_SIZE) return;
    if (gameState.board[x][y]) {
        Toast.warning('该位置已有棋子');
        return;
    }

    // 发送落子
    socket.emit('gobangMove', {
        roomCode: gameState.roomCode,
        x,
        y,
        color: gameState.myColor
    });
}

// ===== 应用落子 =====
function applyMove(x, y, color) {
    gameState.board[x][y] = color;
    gameState.moveHistory.push({ x, y, color });

    drawBoard();
    updateHistory();

    // 切换回合
    gameState.currentTurn = color === 'black' ? 'white' : 'black';
    gameState.isMyTurn = gameState.currentTurn === gameState.myColor;
    gameState.lastMoveTime = Date.now();

    updateTurnUI();
}

// ===== 更新回合 UI =====
function updateTurnUI() {
    const blackPlayer = document.getElementById('blackPlayer');
    const whitePlayer = document.getElementById('whitePlayer');

    if (!blackPlayer || !whitePlayer) return;

    if (gameState.currentTurn === 'black') {
        blackPlayer.classList.add('active');
        whitePlayer.classList.remove('active');
    } else {
        blackPlayer.classList.remove('active');
        whitePlayer.classList.add('active');
    }

    const turnText = gameState.isMyTurn ? '轮到你落子' : '等待对手';
    document.getElementById('currentTurn').innerHTML = `
        <span class="turn-indicator ${gameState.currentTurn}"></span>
        <span class="turn-text">${turnText}</span>
    `;

    document.getElementById('moveCount').textContent = `第 ${gameState.moveHistory.length} 手`;
}

// ===== 游戏结束 =====
function handleGameOver(data) {
    gameState.gameOver = true;
    gameState.winner = data.winner;
    gameState.roomStatus = 'finished';

    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
    }

    const totalTime = Math.floor((Date.now() - gameState.startTime) / 1000);

    // 更新弹窗
    const winnerIcon = document.getElementById('winnerIcon');
    const winnerText = document.getElementById('winnerText');

    if (!winnerIcon || !winnerText) return;

    if (data.winner === gameState.myColor) {
        winnerIcon.className = 'winner-icon ' + data.winner;
        winnerText.textContent = '你赢了!';
    } else if (data.winner) {
        winnerIcon.className = 'winner-icon ' + data.winner;
        winnerText.textContent = '你输了!';
    } else {
        winnerIcon.className = 'winner-icon draw';
        winnerText.textContent = '平局!';
    }

    document.getElementById('totalMoves').textContent = gameState.moveHistory.length;
    document.getElementById('totalTime').textContent = formatTime(totalTime);

    document.getElementById('gameOverModal').classList.add('show');

    updateRoomStatusDisplay();
    updateActionButtons();
}

// ===== 认输 =====
function surrender() {
    if (confirm('确定要认输吗？')) {
        socket.emit('gobangResign', {
            roomCode: gameState.roomCode
        });
    }
}

// ===== 再来一局 =====
function playAgain() {
    document.getElementById('gameOverModal').classList.remove('show');
    initBoard();
    gameState.moveHistory = [];
    gameState.gameOver = false;
    gameState.winner = null;
    gameState.roomStatus = 'waiting';

    // 重置玩家状态
    if (gameState.myRole === 'player') {
        gameState.myStatus = 'waiting';
    }

    // 通知服务器再来一局（由房主触发）
    if (gameState.isHost) {
        // 重置对战玩家状态
        socket.emit('startGobangGame', { roomCode: gameState.roomCode }, (response) => {
            if (!response || !response.success) {
                Toast.info('等待对手准备后房主可重新开始');
            }
        });
    } else {
        Toast.info('等待房主开始下一局');
    }

    updateRoomStatusDisplay();
    updateActionButtons();
}

// ===== 显示等待 =====
function showWaiting(text, roomCode) {
    const overlay = document.getElementById('waitingOverlay');
    if (!overlay) return;
    document.getElementById('waitingText').textContent = text;
    document.getElementById('waitingRoomCode').textContent = roomCode;
    overlay.style.display = 'flex';
}

// ===== 隐藏等待 =====
function hideWaiting() {
    const overlay = document.getElementById('waitingOverlay');
    if (overlay) overlay.style.display = 'none';
}

// ===== 显示对手离开 =====
function showOpponentLeft() {
    const overlay = document.createElement('div');
    overlay.className = 'opponent-left';
    overlay.textContent = '对手已离开';
    document.body.appendChild(overlay);

    setTimeout(() => {
        goBack();
    }, 2000);
}

// ===== 返回大厅 =====
function goBack() {
    if (socket) {
        socket.disconnect();
    }
    window.location.href = '/lobby.html';
}

// ===== 绘制棋盘 =====
function drawBoard() {
    const canvas = document.getElementById('gobangBoard');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#dcb35c';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#8b6914';
    ctx.lineWidth = 1;

    const cellSize = (width - 2 * CONFIG.PADDING) / (CONFIG.BOARD_SIZE - 1);

    for (let i = 0; i < CONFIG.BOARD_SIZE; i++) {
        ctx.beginPath();
        ctx.moveTo(CONFIG.PADDING, CONFIG.PADDING + i * cellSize);
        ctx.lineTo(width - CONFIG.PADDING, CONFIG.PADDING + i * cellSize);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(CONFIG.PADDING + i * cellSize, CONFIG.PADDING);
        ctx.lineTo(CONFIG.PADDING + i * cellSize, height - CONFIG.PADDING);
        ctx.stroke();
    }

    // 星位点
    const starPoints = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];
    ctx.fillStyle = '#8b6914';
    starPoints.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(CONFIG.PADDING + x * cellSize, CONFIG.PADDING + y * cellSize, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    // 棋子
    for (let i = 0; i < CONFIG.BOARD_SIZE; i++) {
        for (let j = 0; j < CONFIG.BOARD_SIZE; j++) {
            if (gameState.board[i][j]) {
                drawPiece(i, j, gameState.board[i][j]);
            }
        }
    }

    // 标记最后一步
    if (gameState.moveHistory.length > 0) {
        const lastMove = gameState.moveHistory[gameState.moveHistory.length - 1];
        markLastMove(lastMove.x, lastMove.y);
    }
}

// ===== 绘制棋子 =====
function drawPiece(x, y, color) {
    const canvas = document.getElementById('gobangBoard');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cellSize = (canvas.width - 2 * CONFIG.PADDING) / (CONFIG.BOARD_SIZE - 1);

    const centerX = CONFIG.PADDING + x * cellSize;
    const centerY = CONFIG.PADDING + y * cellSize;

    ctx.beginPath();
    ctx.arc(centerX + 2, centerY + 2, CONFIG.PIECE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(centerX, centerY, CONFIG.PIECE_RADIUS, 0, Math.PI * 2);

    if (color === 'black') {
        const gradient = ctx.createRadialGradient(centerX - 5, centerY - 5, 0, centerX, centerY, CONFIG.PIECE_RADIUS);
        gradient.addColorStop(0, '#666');
        gradient.addColorStop(1, '#000');
        ctx.fillStyle = gradient;
    } else {
        const gradient = ctx.createRadialGradient(centerX - 5, centerY - 5, 0, centerX, centerY, CONFIG.PIECE_RADIUS);
        gradient.addColorStop(0, '#fff');
        gradient.addColorStop(1, '#ddd');
        ctx.fillStyle = gradient;
    }
    ctx.fill();

    ctx.strokeStyle = color === 'black' ? '#333' : '#999';
    ctx.lineWidth = 1;
    ctx.stroke();
}

// ===== 标记最后一步 =====
function markLastMove(x, y) {
    const canvas = document.getElementById('gobangBoard');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cellSize = (canvas.width - 2 * CONFIG.PADDING) / (CONFIG.BOARD_SIZE - 1);

    ctx.beginPath();
    ctx.arc(CONFIG.PADDING + x * cellSize, CONFIG.PADDING + y * cellSize, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
}

// ===== 更新历史记录 =====
function updateHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    if (gameState.moveHistory.length === 0) {
        historyList.innerHTML = '<div class="history-empty">暂无记录</div>';
        return;
    }

    let html = '';
    gameState.moveHistory.forEach((move, index) => {
        const col = String.fromCharCode(65 + move.x);
        const row = CONFIG.BOARD_SIZE - move.y;
        const color = move.color === 'black' ? '黑' : '白';

        html += `
            <div class="history-item ${move.color}">
                <span class="history-index">${index + 1}</span>
                <span class="history-color">${color}</span>
                <span class="history-position">${col}${row}</span>
            </div>
        `;
    });

    historyList.innerHTML = html;
    historyList.scrollTop = historyList.scrollHeight;
}

// ===== 更新计时器 =====
function updateTimer() {
    if (gameState.gameOver || gameState.roomStatus !== 'playing') return;

    const now = Date.now();
    let blackTotal = gameState.blackTime;
    let whiteTotal = gameState.whiteTime;

    if (gameState.currentTurn === 'black') {
        blackTotal += now - gameState.lastMoveTime;
    } else {
        whiteTotal += now - gameState.lastMoveTime;
    }

    const blackTimer = document.getElementById('blackTimer');
    const whiteTimer = document.getElementById('whiteTimer');
    if (blackTimer) blackTimer.textContent = formatTime(Math.floor(blackTotal / 1000));
    if (whiteTimer) whiteTimer.textContent = formatTime(Math.floor(whiteTotal / 1000));
}

// ===== 更新观战者列表 =====
function updateSpectatorsList(spectators) {
    const panel = document.getElementById('spectatorsPanel');
    const list = document.getElementById('spectatorsList');

    if (!panel || !list) return;

    if (!spectators || spectators.length === 0) {
        panel.style.display = 'none';
        list.innerHTML = '<div class="spectators-empty">暂无观战者</div>';
        return;
    }

    panel.style.display = 'block';
    list.innerHTML = spectators.map(s => {
        const name = typeof s === 'string' ? s : (s.name || '观战者');
        return `
            <div class="spectator-item">
                <div class="spectator-avatar">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <circle cx="12" cy="12" r="10"/>
                    </svg>
                </div>
                <div class="spectator-name">${name}</div>
            </div>
        `;
    }).join('');
}

// ===== 格式化时间 =====
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
