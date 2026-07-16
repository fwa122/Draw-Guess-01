/**
 * 房间大厅页面逻辑
 * 依赖：socket-client.js, avatar-library.js
 */

// ===== 全局变量 =====
let currentRoomData = null;
let currentPlayer = null;
let roomPlayers = [];
let selectedSeatIndex = null; // 当前选中的座位索引（用于交换）

// ===== 从URL获取房间数据 =====
function getRoomDataFromURL() {
    const params = new URLSearchParams(window.location.search);

    const roomData = {
        id: params.get('roomId') || params.get('roomCode') || '',
        code: params.get('roomCode') || '',
        name: params.get('roomName') || '未命名房间',
        type: params.get('roomType') || '经典模式',
        maxPlayers: parseInt(params.get('maxPlayers') || '6'),
        roundTime: parseInt(params.get('roundTime') || '90'),
        status: params.get('status') || '等待中',
        isHost: params.get('isHost') === 'true',
        playerName: params.get('playerName') || '',
        playerAvatar: params.get('playerAvatar') || ''
    };

    return roomData;
}

// ===== 更新房间信息显示 =====
function updateRoomInfo(room) {
    if (!room) return;

    currentRoomData = room;

    // 更新页面标题
    document.title = `${room.name} - 你画我猜`;
    document.getElementById('roomTitle').textContent = room.name;
    document.getElementById('roomIdDisplay').textContent = room.code || room.id || '---';
    document.getElementById('roomName').textContent = room.name;
    document.getElementById('roomType').textContent = room.type || room.gameMode || '经典模式';
    document.getElementById('roomPlayerCount').textContent = `${room.players ? room.players.length : 0}/${room.maxPlayers}`;
    document.getElementById('roomStatusText').textContent = room.status || '等待中';
    document.getElementById('roomRoundTime').textContent = `${room.roundTime || 90}秒`;
}

// ===== 渲染玩家列表 =====
function renderPlayers(players, roomData) {
    const playersGrid = document.getElementById('playersGrid');
    playersGrid.innerHTML = '';

    const maxPlayers = roomData?.maxPlayers || 6;

    // 更新房间信息
    updateRoomInfo(roomData);

    // 初始化座位数组（所有座位）
    const seats = [];
    for (let i = 0; i < maxPlayers; i++) {
        seats[i] = null; // 空位
    }

    // 将玩家放入对应座位（使用 seatIndex）
    if (players && players.length > 0) {
        players.forEach((player, idx) => {
            // 如果玩家有 seatIndex，使用它；否则按加入顺序
            const seatIndex = player.seatIndex !== undefined ? player.seatIndex : idx;
            if (seatIndex >= 0 && seatIndex < maxPlayers) {
                seats[seatIndex] = player;
            }
        });
    }

    // 渲染所有座位（玩家或空位）
    seats.forEach((seat, index) => {
        if (seat) {
            // 有玩家
            const playerCard = createPlayerCard(seat, index);
            playersGrid.appendChild(playerCard);
        } else {
            // 空位
            const emptySlot = createEmptySlot(index);
            playersGrid.appendChild(emptySlot);
        }
    });
}

// ===== 创建玩家卡片 =====
function createPlayerCard(player, seatIndex) {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.dataset.playerId = player.id || player.socketId;
    card.dataset.seatIndex = seatIndex;

    // 状态映射：status 字段
    const playerStatus = player.status || 'waiting';

    const statusText = {
        'ready': '已准备',
        'waiting': '未准备',
        'playing': '游戏中',
        'offline': '离线'
    };

    // 处理头像显示
    const avatarSvg = player.avatar?.svg || player.avatar || getRandomAvatar().svg;

    // 第一个座位（首位绘画者）特殊样式
    const isFirstSeat = seatIndex === 0;

    // 是否是当前玩家的卡片（按 id 匹配，避免同名玩家冲突）
    const isCurrentPlayer = player.id === socketClient.playerId;

    // 是否是当前绘画者
    const isPainter = currentRoomData && currentRoomData.currentPainter === (player.id || player.socketId);

    card.innerHTML = `
        <div class="player-seat-number ${isFirstSeat ? 'first' : ''}">${seatIndex + 1}</div>
        <div class="player-avatar-wrapper">
            <div class="player-avatar">
                ${avatarSvg}
            </div>
            ${player.isHost ? '<div class="player-role-badge">房主</div>' : ''}
            ${isPainter ? '<div class="player-role-badge painter" style="bottom: -8px; background: var(--accent-color);">绘画者</div>' : ''}
        </div>
        <div class="player-name">${escapeHtml(player.name)}</div>
        <div class="player-status ${playerStatus}">
            <div class="player-status-dot"></div>
            ${statusText[playerStatus] || '未准备'}
        </div>
    `;

    // 如果是当前玩家，添加点击事件支持座位选择
    if (isCurrentPlayer) {
        card.classList.add('selectable');
        card.addEventListener('click', () => {
            handleSeatSelect(seatIndex, card);
        });
    }

    // 如果当前玩家已选中自己的座位，高亮显示
    if (selectedSeatIndex === seatIndex) {
        card.classList.add('selected');
    }

    return card;
}

// ===== 创建空位卡片 =====
function createEmptySlot(seatIndex) {
    const card = document.createElement('div');
    card.className = 'player-card empty-slot';
    card.dataset.seatIndex = seatIndex;
    card.style.opacity = '0.6';
    card.style.background = 'rgba(240, 244, 248, 0.5)';

    // 第一个座位特殊样式
    const isFirstSeat = seatIndex === 0;

    card.innerHTML = `
        <div class="player-seat-number ${isFirstSeat ? 'first' : ''}">${seatIndex + 1}</div>
        <div class="player-avatar-wrapper">
            <div class="player-avatar">
                <svg viewBox="0 0 24 24" stroke-width="1.5" stroke="#94a3b8" fill="none" style="width: 40px; height: 40px;">
                    <line x1="12" y1="6" x2="12" y2="18"></line>
                    <line x1="6" y1="12" x2="18" y2="12"></line>
                </svg>
            </div>
        </div>
        <div class="player-name" style="color: #94a3b8;">空位</div>
        <div class="player-status waiting">
            <div class="player-status-dot"></div>
            等待加入
        </div>
    `;

    // 如果当前玩家已选中座位，空位可以点击交换
    if (selectedSeatIndex !== null) {
        card.classList.add('selectable');
        card.addEventListener('click', () => {
            handleSwapSeat(seatIndex);
        });
    }

    return card;
}

// ===== 座位选择处理 =====
function handleSeatSelect(seatIndex, card) {
    // 如果已选中同一座位，取消选择
    if (selectedSeatIndex === seatIndex) {
        selectedSeatIndex = null;
        card.classList.remove('selected');
        renderPlayers(roomPlayers, currentRoomData);
        return;
    }

    // 选中自己的座位
    selectedSeatIndex = seatIndex;
    card.classList.add('selected');

    // 重新渲染，让空位显示为可点击状态
    renderPlayers(roomPlayers, currentRoomData);
}

// ===== 座位交换处理 =====
function handleSwapSeat(targetSeatIndex) {
    if (selectedSeatIndex === null) {
        return;
    }

    // 找到当前玩家
    currentPlayer = roomPlayers.find(p => p.id === socketClient.playerId);
    if (!currentPlayer) {
        console.log('找不到当前玩家');
        return;
    }

    console.log('发送座位交换请求:', selectedSeatIndex, '->', targetSeatIndex);

    // 发送座位交换请求到服务器
    socketClient.swapSeat(currentRoomData.code, selectedSeatIndex, targetSeatIndex);

    // 清除选中状态
    selectedSeatIndex = null;
}

// ===== 返回大厅 =====
function backToLobby() {
    if (confirm('确定要返回游戏大厅吗？')) {
        window.location.href = 'lobby.html';
    }
}

// ===== 刷新房间数据 =====
async function refreshRoomData() {
    const btn = document.getElementById('btnRefreshRoom');
    if (!btn) return;

    // 添加刷新动画
    btn.classList.add('refreshing');

    try {
        // 重新调用 joinRoom 获取最新房间数据
        if (roomCode && playerName) {
            const response = await socketClient.joinRoom(roomCode, playerName, null, playerAvatar);
            if (response && response.success) {
                console.log('刷新房间数据成功:', response.room);
                currentRoomData = response.room;
                roomPlayers = response.room.players || [];
                currentPlayer = roomPlayers.find(p => p.id === socketClient.playerId);
                renderPlayers(roomPlayers, currentRoomData);
                updateRoomInfo(currentRoomData);
            }
        }
    } catch (error) {
        console.error('刷新房间数据失败:', error);
    }

    // 移除刷新动画
    setTimeout(() => {
        btn.classList.remove('refreshing');
    }, 500);
}

// ===== 退出房间 =====
function leaveRoom() {
    if (confirm('确定要退出房间并返回大厅吗？')) {
        if (currentRoomData && currentRoomData.code) {
            socketClient.leaveRoom(currentRoomData.code);
        }
        window.location.href = 'lobby.html';
    }
}

// ===== 准备/取消准备 =====
async function toggleReady() {
    if (!currentRoomData || !currentRoomData.code) return;

    const isCurrentlyReady = currentPlayer?.status === 'ready';
    const newReadyState = !isCurrentlyReady;

    console.log('切换准备状态:', newReadyState, '房间:', currentRoomData.code);
    
    try {
        const response = await socketClient.setReady(newReadyState, currentRoomData.code);
        if (response && response.success) {
            console.log('准备状态切换成功:', response.status);
        }
    } catch (error) {
        console.error('准备状态切换失败:', error);
        Toast.error(error.message || '操作失败');
    }
}

// ===== 开始游戏 =====
function startGame() {
    if (!currentRoomData) {
        Toast.error('房间信息未加载');
        return;
    }

    if (!isHost) {
        Toast.warning('只有房主才能开始游戏');
        return;
    }

    // 检查是否有足够的玩家准备（使用 status 字段）
    const readyCount = roomPlayers.filter(p => p.status === 'ready').length;

    if (readyCount < 2) {
        Toast.warning('至少需要2名玩家准备才能开始游戏');
        return;
    }

    // 通过Socket.io开始游戏
    socketClient.startGame(currentRoomData.code)
        .then((response) => {
            if (response && response.success) {
                console.log('游戏开始');
            } else {
                Toast.error((response && response.message) || '开始游戏失败');
            }
        })
        .catch((error) => {
            console.error('开始游戏失败:', error);
            Toast.error(error.message || '开始游戏失败');
        });
}

// ===== 页面加载时初始化 =====
window.onload = function() {
    const roomData = getRoomDataFromURL();
    currentRoomData = roomData;

    // 初始化当前玩家信息
    currentPlayer = {
        name: roomData.playerName,
        avatar: roomData.playerAvatar,
        ready: false,
        isHost: roomData.isHost
    };

    // 更新页面标题和房间信息
    document.title = `${roomData.name} - 你画我猜`;
    updateRoomInfo(roomData);

    // 初始渲染空位
    renderPlayers([], roomData);

    // 根据是否是房主显示不同的按钮
    updateButtons();
};

// ===== 更新按钮显示 =====
function updateButtons() {
    const btnStartGame = document.getElementById('btnStartGame');
    const btnReady = document.getElementById('btnReady');
    const btnReadyText = document.getElementById('btnReadyText');

    if (isHost) {
        // 房主：显示"开始游戏"按钮，隐藏"准备"按钮
        btnStartGame.style.display = 'flex';
        btnReady.style.display = 'none';
    } else {
        // 非房主：隐藏"开始游戏"按钮，显示"准备/取消准备"按钮
        btnStartGame.style.display = 'none';
        btnReady.style.display = 'flex';

        // 更新准备按钮状态
        const isReady = currentPlayer?.status === 'ready';
        if (isReady) {
            btnReady.classList.add('is-ready');
            btnReadyText.textContent = '取消准备';
        } else {
            btnReady.classList.remove('is-ready');
            btnReadyText.textContent = '准备';
        }
    }
}

// ===== Socket.io 集成 =====
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('roomCode');
const playerName = urlParams.get('playerName') || '玩家' + Math.floor(Math.random() * 10000);
const playerAvatar = urlParams.get('playerAvatar') || '';
const isHost = urlParams.get('isHost') === 'true';

async function initSocket() {
    try {
        await socketClient.connect();
        console.log('已连接到服务器');

        // 所有用户（包括房主）都需要调用 joinRoom 来恢复连接
        // 服务器会识别重连用户并更新其 socket.id
        try {
            const response = await socketClient.joinRoom(roomCode, playerName, null, playerAvatar);
            if (response && response.success) {
                console.log('成功加入房间:', response.room, response.isReconnect ? '(重连)' : '(新加入)');
                currentRoomData = response.room;
                roomPlayers = response.room.players || [];
                currentPlayer = roomPlayers.find(p => p.id === socketClient.playerId);

                // 状态机校验：若房间正在游戏中，自动跳转到对应游戏页
                const shouldStay = GameState.enforce(
                    currentRoomData,
                    socketClient.playerId,
                    'room-lobby',
                    {
                        roomCode: roomCode,
                        roomName: currentRoomData.name || '',
                        playerName: playerName,
                        playerAvatar: playerAvatar || ''
                    }
                );
                if (!shouldStay) return;

                renderPlayers(roomPlayers, currentRoomData);
                updateRoomInfo(currentRoomData);
            } else {
                Toast.error(response?.message || '加入房间失败');
                setTimeout(() => window.location.replace('lobby.html'), 1500);
            }
        } catch (joinError) {
            console.error('加入房间失败:', joinError);
            Toast.error('加入房间失败: ' + joinError.message);
            setTimeout(() => window.location.replace('lobby.html'), 1500);
        }

        // 监听房间数据更新（所有玩家都会收到）
        socketClient.on('roomUpdate', (room) => {
            console.log('房间数据更新:', room);
            currentRoomData = room;
            roomPlayers = room.players || [];
            currentPlayer = roomPlayers.find(p => p.id === socketClient.playerId) || currentPlayer;

            // 状态机校验：若房间已开始游戏，自动跳转
            const shouldStay = GameState.enforce(
                currentRoomData,
                socketClient.playerId,
                'room-lobby',
                {
                    roomCode: roomCode,
                    roomName: currentRoomData.name || '',
                    playerName: playerName,
                    playerAvatar: playerAvatar || ''
                }
            );
            if (!shouldStay) return;

            renderPlayersWithKick(roomPlayers, currentRoomData);
            updateRoomInfo(currentRoomData);
            updateButtons(); // 更新按钮显示状态
        });

        // 监听房间销毁
        socketClient.on('roomDestroyed', ({ message }) => {
            Toast.warning(message || '房主已离开，房间已销毁');
            setTimeout(() => window.location.replace('lobby.html'), 1500);
        });

        // 监听玩家加入（备用，主要通过 roomUpdate 同步）
        socketClient.on('playerJoined', (player) => {
            console.log('玩家加入:', player);
            // 避免重复添加，先检查是否已存在
            if (!roomPlayers.find(p => p.id === player.id || p.name === player.name)) {
                roomPlayers.push(player);
            }
            renderPlayers(roomPlayers, currentRoomData);
        });

        // 监听玩家离开
        socketClient.on('playerLeft', (playerId) => {
            console.log('玩家离开:', playerId);
            roomPlayers = roomPlayers.filter(p => p.id !== playerId && p.socketId !== playerId);
            renderPlayers(roomPlayers, currentRoomData);
        });

        // 监听游戏开始
        socketClient.on('gameStarted', ({ room, currentWord }) => {
            console.log('游戏开始:', room, currentWord);

            // 检查游戏类型
            const gameMode = room.gameMode || room.type || 'classic';

            if (gameMode === 'gobang') {
                // 五子棋游戏跳转到 gobang-online.html
                const gameParams = new URLSearchParams({
                    room: room.code,
                    action: 'play',
                    playerName: playerName
                });
                window.location.replace(`gobang-online.html?${gameParams.toString()}`);
            } else {
                // 你画我猜游戏
                // 判断当前用户是否是绘画者（根据 currentPainter 字段）
                const isPainter = room.currentPainter === socketClient.socket.id;

                const gameParams = new URLSearchParams({
                    roomCode: room.code,
                    roomName: room.name,
                    playerName: playerName, // 确保传递玩家名称，防止重复创建用户
                    playerAvatar: typeof playerAvatar === 'object' ? JSON.stringify(playerAvatar) : playerAvatar,
                    currentWord: currentWord || '',
                    isPainter: isPainter ? 'true' : 'false',
                    round: room.currentRound || 1,
                    totalRounds: room.maxRounds || 5
                });

                const targetPage = isPainter ? 'painter.html' : 'guesser.html';
                window.location.replace(`${targetPage}?${gameParams.toString()}`);
            }
        });

        // ===== 新增：监听被踢出事件 =====
        socketClient.on('kicked', (data) => {
            console.log('被踢出房间:', data);
            document.getElementById('kickedMessage').textContent = data.message || '您已被房主踢出房间';
            document.getElementById('kickedModal').style.display = 'flex';
        });

        // ===== 新增：监听作弊警告 =====
        socketClient.on('cheatWarning', (data) => {
            console.log('作弊警告:', data);
            document.getElementById('cheatWarningMessage').textContent = data.message || '检测到异常答题行为';
            document.getElementById('cheatWarningModal').style.display = 'flex';
        });

        // ===== 新增：监听黑名单事件 =====
        socketClient.on('blacklisted', (data) => {
            console.log('被加入黑名单:', data);
            document.getElementById('blacklistMessage').textContent = data.message || '检测到作弊行为';
            document.getElementById('blacklistModal').style.display = 'flex';
        });

        // ===== 新增：监听恢复为玩家 =====
        socketClient.on('restored', (data) => {
            console.log('恢复为玩家:', data);
            Toast.success(data.message || '您已被恢复为玩家');
        });

    } catch (error) {
        console.error('连接失败:', error);
        Toast.error('服务器连接失败，请刷新页面重试');
    }
}

// 页面加载后初始化Socket连接
initSocket();

// ===== 弹窗关闭函数 =====
function closeCheatWarning() {
    document.getElementById('cheatWarningModal').style.display = 'none';
}

function closeKickedModal() {
    document.getElementById('kickedModal').style.display = 'none';
}

function goToLobby() {
    window.location.replace('lobby.html');
}

// ===== 踢人功能 =====
async function kickPlayer(targetId, targetName) {
    if (!currentRoomData || !currentRoomData.isHost) {
        Toast.warning('只有房主才能踢人');
        return;
    }

    const confirmed = await Confirm.warn(`确定要踢出玩家 ${targetName} 吗？踢出后该玩家将成为观战者。`, '踢出确认');
    if (!confirmed) return;

    socketClient.socket.emit('kickPlayer', {
        roomCode: currentRoomData.code,
        targetId: targetId
    }, (response) => {
        if (response && response.success) {
            console.log('踢出成功');
            Toast.success(`已踢出玩家 ${targetName}`);
        } else {
            Toast.error(response?.message || '踢出失败');
        }
    });
}

// ===== 更新玩家渲染，添加踢人按钮 =====
function renderPlayersWithKick(players, roomData) {
    const grid = document.getElementById('playersGrid');
    if (!grid) return;

    grid.innerHTML = '';

    players.forEach((player, index) => {
        const card = document.createElement('div');
        card.className = 'player-card';
        if (player.isHost) card.classList.add('host');

        // 使用 hostId 判断房主身份（优先使用 roomData.hostId）
        const isCurrentHost = (roomData.hostId && currentPlayer?.id === roomData.hostId) || currentPlayer?.isHost;
        const canKick = isCurrentHost && !player.isHost && player.id !== currentPlayer?.id;

        card.innerHTML = `
            <div class="player-seat-number ${index === 0 ? 'first' : ''}">${index + 1}</div>
            ${canKick ? `
                <button class="player-kick-btn" onclick="kickPlayer('${escapeHtml(player.id)}', '${escapeHtml(player.name)}')" title="踢出该玩家">
                    <svg viewBox="0 0 24 24">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            ` : ''}
            <div class="player-avatar-wrapper">
                <div class="player-avatar">${escapeHtml(player.avatar || '🎮')}</div>
            </div>
            <div class="player-name">${escapeHtml(player.name)}</div>
            ${player.isHost ? '<div class="player-role-badge">房主</div>' : ''}
            <div class="player-status ${player.status || 'waiting'}">
                <div class="player-status-dot"></div>
                <span>${player.status === 'ready' ? '已准备' : player.status === 'playing' ? '游戏中' : '等待中'}</span>
            </div>
        `;

        grid.appendChild(card);
    });

    // 更新观战者列表
    renderSpectators(roomData.spectators || []);
}

// ===== 渲染观战者列表 =====
function renderSpectators(spectators) {
    const section = document.getElementById('spectatorsSection');
    const list = document.getElementById('spectatorsList');
    const count = document.getElementById('spectatorCount');

    if (!section || !list) return;

    if (spectators.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    count.textContent = spectators.length;

    list.innerHTML = spectators.map(s => `
        <div class="spectator-item">
            <div class="spectator-avatar">${escapeHtml(s.avatar || '👁️')}</div>
            <span>${escapeHtml(s.name)}</span>
            ${s.reason ? `<span style="color: var(--text-muted); font-size: 11px;">(${escapeHtml(s.reason)})</span>` : ''}
        </div>
    `).join('');
}