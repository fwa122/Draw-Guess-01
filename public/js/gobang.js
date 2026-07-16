/**
 * 五子棋游戏逻辑
 * 支持本地双人对战和 AI 对战
 */

// ===== 游戏配置 =====
const CONFIG = {
    BOARD_SIZE: 15,        // 棋盘大小 15x15
    CELL_SIZE: 40,         // 格子大小
    PADDING: 20,           // 边距
    PIECE_RADIUS: 16,      // 棋子半径
    WIN_COUNT: 5,          // 连续 5 子获胜
    AI_DEPTH: 2,           // AI 搜索深度
};

// ===== 游戏状态 =====
let gameState = {
    board: [],              // 棋盘状态数组
    currentPlayer: 'black', // 当前玩家
    moveHistory: [],        // 落子历史
    gameOver: false,        // 游戏是否结束
    winner: null,           // 获胜方
    isAI: false,            // 是否 AI 模式
    soundEnabled: true,     // 音效开关
    startTime: null,        // 开始时间
    blackTime: 0,           // 黑方累计时间
    whiteTime: 0,           // 白方累计时间
    timerInterval: null,    // 计时器
    lastMoveTime: null,     // 上次落子时间
};

// ===== 初始化游戏 =====
function initGame() {
    // 初始化棋盘
    gameState.board = [];
    for (let i = 0; i < CONFIG.BOARD_SIZE; i++) {
        gameState.board[i] = [];
        for (let j = 0; j < CONFIG.BOARD_SIZE; j++) {
            gameState.board[i][j] = null;
        }
    }

    // 重置状态
    gameState.currentPlayer = 'black';
    gameState.moveHistory = [];
    gameState.gameOver = false;
    gameState.winner = null;
    gameState.startTime = Date.now();
    gameState.blackTime = 0;
    gameState.whiteTime = 0;
    gameState.lastMoveTime = Date.now();

    // 清除计时器
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
    }

    // 启动计时器
    gameState.timerInterval = setInterval(updateTimer, 1000);

    // 绘制棋盘
    drawBoard();
    updateUI();
    updateHistory();

    // 更新玩家状态
    document.getElementById('blackPlayer').classList.add('active');
    document.getElementById('whitePlayer').classList.remove('active');

    // 更新游戏状态显示
    document.getElementById('currentTurn').innerHTML = `
        <span class="turn-indicator black"></span>
        <span class="turn-text">黑方执子</span>
    `;
}

// ===== 绘制棋盘 =====
function drawBoard() {
    const canvas = document.getElementById('gobangBoard');
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // 清空画布
    ctx.clearRect(0, 0, width, height);

    // 绘制棋盘背景
    ctx.fillStyle = '#dcb35c';
    ctx.fillRect(0, 0, width, height);

    // 绘制网格线
    ctx.strokeStyle = '#8b6914';
    ctx.lineWidth = 1;

    const cellSize = (width - 2 * CONFIG.PADDING) / (CONFIG.BOARD_SIZE - 1);

    for (let i = 0; i < CONFIG.BOARD_SIZE; i++) {
        // 横线
        ctx.beginPath();
        ctx.moveTo(CONFIG.PADDING, CONFIG.PADDING + i * cellSize);
        ctx.lineTo(width - CONFIG.PADDING, CONFIG.PADDING + i * cellSize);
        ctx.stroke();

        // 竖线
        ctx.beginPath();
        ctx.moveTo(CONFIG.PADDING + i * cellSize, CONFIG.PADDING);
        ctx.lineTo(CONFIG.PADDING + i * cellSize, height - CONFIG.PADDING);
        ctx.stroke();
    }

    // 绘制星位点
    const starPoints = [
        [3, 3], [3, 11], [7, 7], [11, 3], [11, 11]
    ];

    ctx.fillStyle = '#8b6914';
    starPoints.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(
            CONFIG.PADDING + x * cellSize,
            CONFIG.PADDING + y * cellSize,
            4, 0, Math.PI * 2
        );
        ctx.fill();
    });

    // 绘制棋子
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
    const ctx = canvas.getContext('2d');
    const cellSize = (canvas.width - 2 * CONFIG.PADDING) / (CONFIG.BOARD_SIZE - 1);

    const centerX = CONFIG.PADDING + x * cellSize;
    const centerY = CONFIG.PADDING + y * cellSize;

    // 绘制阴影
    ctx.beginPath();
    ctx.arc(centerX + 2, centerY + 2, CONFIG.PIECE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fill();

    // 绘制棋子
    ctx.beginPath();
    ctx.arc(centerX, centerY, CONFIG.PIECE_RADIUS, 0, Math.PI * 2);

    if (color === 'black') {
        // 黑棋渐变
        const gradient = ctx.createRadialGradient(
            centerX - 5, centerY - 5, 0,
            centerX, centerY, CONFIG.PIECE_RADIUS
        );
        gradient.addColorStop(0, '#666');
        gradient.addColorStop(1, '#000');
        ctx.fillStyle = gradient;
    } else {
        // 白棋渐变
        const gradient = ctx.createRadialGradient(
            centerX - 5, centerY - 5, 0,
            centerX, centerY, CONFIG.PIECE_RADIUS
        );
        gradient.addColorStop(0, '#fff');
        gradient.addColorStop(1, '#ddd');
        ctx.fillStyle = gradient;
    }
    ctx.fill();

    // 边框
    ctx.strokeStyle = color === 'black' ? '#333' : '#999';
    ctx.lineWidth = 1;
    ctx.stroke();
}

// ===== 标记最后一步 =====
function markLastMove(x, y) {
    const canvas = document.getElementById('gobangBoard');
    const ctx = canvas.getContext('2d');
    const cellSize = (canvas.width - 2 * CONFIG.PADDING) / (CONFIG.BOARD_SIZE - 1);

    const centerX = CONFIG.PADDING + x * cellSize;
    const centerY = CONFIG.PADDING + y * cellSize;

    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
}

// ===== 处理点击 =====
function handleClick(event) {
    if (gameState.gameOver) return;
    if (gameState.isAI && gameState.currentPlayer === 'white') return;

    const canvas = document.getElementById('gobangBoard');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    const cellSize = (canvas.width - 2 * CONFIG.PADDING) / (CONFIG.BOARD_SIZE - 1);

    // 计算最近的交叉点
    const x = Math.round((clickX - CONFIG.PADDING) / cellSize);
    const y = Math.round((clickY - CONFIG.PADDING) / cellSize);

    // 检查是否在有效范围内
    if (x < 0 || x >= CONFIG.BOARD_SIZE || y < 0 || y >= CONFIG.BOARD_SIZE) return;

    // 检查是否已有棋子
    if (gameState.board[x][y]) return;

    // 落子
    makeMove(x, y);
}

// ===== 落子 =====
function makeMove(x, y) {
    const player = gameState.currentPlayer;

    // 更新棋盘
    gameState.board[x][y] = player;

    // 记录历史
    gameState.moveHistory.push({
        x,
        y,
        player,
        time: Date.now()
    });

    // 播放音效
    if (gameState.soundEnabled) {
        playSound('place');
    }

    // 重绘棋盘
    drawBoard();
    updateUI();
    updateHistory();

    // 检查胜利
    if (checkWin(x, y, player)) {
        gameOver(player);
        return;
    }

    // 检查平局
    if (gameState.moveHistory.length === CONFIG.BOARD_SIZE * CONFIG.BOARD_SIZE) {
        gameOver(null);
        return;
    }

    // 切换玩家
    switchPlayer();
}

// ===== 切换玩家 =====
function switchPlayer() {
    // 更新时间
    const now = Date.now();
    if (gameState.currentPlayer === 'black') {
        gameState.blackTime += now - gameState.lastMoveTime;
    } else {
        gameState.whiteTime += now - gameState.lastMoveTime;
    }
    gameState.lastMoveTime = now;

    // 切换
    gameState.currentPlayer = gameState.currentPlayer === 'black' ? 'white' : 'black';

    // 更新UI
    const blackPlayer = document.getElementById('blackPlayer');
    const whitePlayer = document.getElementById('whitePlayer');

    if (gameState.currentPlayer === 'black') {
        blackPlayer.classList.add('active');
        whitePlayer.classList.remove('active');
        document.getElementById('currentTurn').innerHTML = `
            <span class="turn-indicator black"></span>
            <span class="turn-text">黑方执子</span>
        `;
    } else {
        blackPlayer.classList.remove('active');
        whitePlayer.classList.add('active');
        document.getElementById('currentTurn').innerHTML = `
            <span class="turn-indicator white"></span>
            <span class="turn-text">白方执子</span>
        `;
    }

    // AI 自动下棋
    if (gameState.isAI && gameState.currentPlayer === 'white') {
        setTimeout(makeAIMove, 500);
    }
}

// ===== 检查胜利 =====
function checkWin(x, y, player) {
    const directions = [
        [1, 0],   // 横向
        [0, 1],   // 纵向
        [1, 1],   // 斜向 /
        [1, -1]   // 斜向 \
    ];

    for (const [dx, dy] of directions) {
        let count = 1;

        // 正向计数
        for (let i = 1; i < CONFIG.WIN_COUNT; i++) {
            const nx = x + dx * i;
            const ny = y + dy * i;
            if (nx < 0 || nx >= CONFIG.BOARD_SIZE || ny < 0 || ny >= CONFIG.BOARD_SIZE) break;
            if (gameState.board[nx][ny] !== player) break;
            count++;
        }

        // 反向计数
        for (let i = 1; i < CONFIG.WIN_COUNT; i++) {
            const nx = x - dx * i;
            const ny = y - dy * i;
            if (nx < 0 || nx >= CONFIG.BOARD_SIZE || ny < 0 || ny >= CONFIG.BOARD_SIZE) break;
            if (gameState.board[nx][ny] !== player) break;
            count++;
        }

        if (count >= CONFIG.WIN_COUNT) {
            return true;
        }
    }

    return false;
}

// ===== 游戏结束 =====
function gameOver(winner) {
    gameState.gameOver = true;
    gameState.winner = winner;

    // 停止计时
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
    }

    // 计算总时间
    const totalTime = Math.floor((Date.now() - gameState.startTime) / 1000);

    // 播放音效
    if (gameState.soundEnabled) {
        playSound(winner ? 'win' : 'draw');
    }

    // 显示弹窗
    const modal = document.getElementById('gameOverModal');
    const winnerIcon = document.getElementById('winnerIcon');
    const winnerText = document.getElementById('winnerText');

    if (winner === 'black') {
        winnerIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>`;
        winnerIcon.className = 'winner-icon black';
        winnerText.textContent = '黑方获胜!';
    } else if (winner === 'white') {
        winnerIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><circle cx="12" cy="12" r="10"/></svg>`;
        winnerIcon.className = 'winner-icon white';
        winnerText.textContent = '白方获胜!';
    } else {
        winnerIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20"/></svg>`;
        winnerIcon.className = 'winner-icon draw';
        winnerText.textContent = '平局!';
    }

    document.getElementById('totalMoves').textContent = gameState.moveHistory.length;
    document.getElementById('totalTime').textContent = formatTime(totalTime);

    modal.classList.add('show');
}

// ===== AI 下棋 =====
function makeAIMove() {
    if (gameState.gameOver) return;

    const bestMove = findBestMove();
    if (bestMove) {
        makeMove(bestMove.x, bestMove.y);
    }
}

// ===== AI 寻找最佳落子点 =====
function findBestMove() {
    // 简单 AI：优先防守和进攻
    const emptyPoints = [];

    for (let i = 0; i < CONFIG.BOARD_SIZE; i++) {
        for (let j = 0; j < CONFIG.BOARD_SIZE; j++) {
            if (!gameState.board[i][j]) {
                emptyPoints.push({ x: i, y: j });
            }
        }
    }

    // 评估每个空位
    let bestScore = -Infinity;
    let bestMove = null;

    for (const point of emptyPoints) {
        const score = evaluatePoint(point.x, point.y);
        if (score > bestScore) {
            bestScore = score;
            bestMove = point;
        }
    }

    return bestMove;
}

// ===== 评估落子点得分 =====
function evaluatePoint(x, y) {
    let score = 0;

    // 检查是否能赢
    gameState.board[x][y] = 'white';
    if (checkWin(x, y, 'white')) {
        score += 10000;
    }
    gameState.board[x][y] = null;

    // 检查是否需要防守
    gameState.board[x][y] = 'black';
    if (checkWin(x, y, 'black')) {
        score += 5000;
    }
    gameState.board[x][y] = null;

    // 评估棋型
    score += evaluatePattern(x, y, 'white') * 2;
    score += evaluatePattern(x, y, 'black');

    // 中心位置加分
    const centerDist = Math.abs(x - 7) + Math.abs(y - 7);
    score += (14 - centerDist);

    return score;
}

// ===== 评估棋型得分 =====
function evaluatePattern(x, y, player) {
    let score = 0;
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];

    for (const [dx, dy] of directions) {
        let count = 0;
        let open = 0;

        // 正向
        for (let i = 1; i <= 4; i++) {
            const nx = x + dx * i;
            const ny = y + dy * i;
            if (nx < 0 || nx >= CONFIG.BOARD_SIZE || ny < 0 || ny >= CONFIG.BOARD_SIZE) break;
            if (gameState.board[nx][ny] === player) count++;
            else if (gameState.board[nx][ny] === null) { open++; break; }
            else break;
        }

        // 反向
        for (let i = 1; i <= 4; i++) {
            const nx = x - dx * i;
            const ny = y - dy * i;
            if (nx < 0 || nx >= CONFIG.BOARD_SIZE || ny < 0 || ny >= CONFIG.BOARD_SIZE) break;
            if (gameState.board[nx][ny] === player) count++;
            else if (gameState.board[nx][ny] === null) { open++; break; }
            else break;
        }

        // 棋型评分
        if (count >= 4) score += 1000;
        else if (count === 3 && open === 2) score += 500;
        else if (count === 3) score += 100;
        else if (count === 2 && open === 2) score += 50;
        else if (count === 2) score += 10;
    }

    return score;
}

// ===== 悔棋 =====
function undoMove() {
    if (gameState.moveHistory.length === 0) return;
    if (gameState.gameOver) return;

    // AI 模式悔两步
    const undoCount = gameState.isAI ? 2 : 1;

    for (let i = 0; i < undoCount && gameState.moveHistory.length > 0; i++) {
        const lastMove = gameState.moveHistory.pop();
        gameState.board[lastMove.x][lastMove.y] = null;
        gameState.currentPlayer = lastMove.player;
    }

    drawBoard();
    updateUI();
    updateHistory();
}

// ===== 更新计时器 =====
function updateTimer() {
    if (gameState.gameOver) return;

    const now = Date.now();
    let blackTotal = gameState.blackTime;
    let whiteTotal = gameState.whiteTime;

    if (gameState.currentPlayer === 'black') {
        blackTotal += now - gameState.lastMoveTime;
    } else {
        whiteTotal += now - gameState.lastMoveTime;
    }

    document.getElementById('blackTimer').textContent = formatTime(Math.floor(blackTotal / 1000));
    document.getElementById('whiteTimer').textContent = formatTime(Math.floor(whiteTotal / 1000));
}

// ===== 格式化时间 =====
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ===== 更新 UI =====
function updateUI() {
    document.getElementById('moveCount').textContent = `第 ${gameState.moveHistory.length} 手`;
}

// ===== 更新历史记录 =====
function updateHistory() {
    const historyList = document.getElementById('historyList');

    if (gameState.moveHistory.length === 0) {
        historyList.innerHTML = '<div class="history-empty">暂无记录</div>';
        return;
    }

    let html = '';
    gameState.moveHistory.forEach((move, index) => {
        const col = String.fromCharCode(65 + move.x); // A-O
        const row = CONFIG.BOARD_SIZE - move.y;       // 15-1
        const color = move.player === 'black' ? '黑' : '白';

        html += `
            <div class="history-item ${move.player}">
                <span class="history-index">${index + 1}</span>
                <span class="history-color">${color}</span>
                <span class="history-position">${col}${row}</span>
            </div>
        `;
    });

    historyList.innerHTML = html;
    historyList.scrollTop = historyList.scrollHeight;
}

// ===== 播放音效 =====
function playSound(type) {
    // 使用 Web Audio API 生成简单音效
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        switch (type) {
            case 'place':
                oscillator.frequency.value = 800;
                gainNode.gain.value = 0.1;
                break;
            case 'win':
                oscillator.frequency.value = 1200;
                gainNode.gain.value = 0.2;
                break;
            case 'draw':
                oscillator.frequency.value = 400;
                gainNode.gain.value = 0.1;
                break;
        }

        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
        // 忽略音频错误
    }
}

// ===== 功能按钮 =====

// 重新开始
function restartGame() {
    document.getElementById('gameOverModal').classList.remove('show');
    initGame();
}

// 返回大厅
function goBack() {
    window.location.href = '/lobby.html';
}

// 关闭弹窗
function closeModal() {
    document.getElementById('gameOverModal').classList.remove('show');
    goBack();
}

// 切换 AI 模式
function toggleAI() {
    gameState.isAI = !gameState.isAI;
    
    const btn = event.currentTarget;
    btn.classList.toggle('active', gameState.isAI);

    if (gameState.isAI) {
        document.getElementById('whitePlayerName').textContent = 'AI';
    } else {
        document.getElementById('whitePlayerName').textContent = '白方';
    }

    // 如果当前是白棋回合且 AI 开启，自动下棋
    if (gameState.isAI && gameState.currentPlayer === 'white' && !gameState.gameOver) {
        setTimeout(makeAIMove, 500);
    }
}

// 切换音效
function toggleSound() {
    gameState.soundEnabled = !gameState.soundEnabled;
    
    const btn = event.currentTarget;
    btn.classList.toggle('active', gameState.soundEnabled);
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gobangBoard');
    canvas.addEventListener('click', handleClick);

    // 触摸支持
    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        const touch = e.changedTouches[0];
        handleClick({
            clientX: touch.clientX,
            clientY: touch.clientY
        });
    });

    initGame();
});