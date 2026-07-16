// ===== 大厅页面 JavaScript 逻辑 =====
// 注意：avatarLibrary 和 getRandomAvatar 已移到 avatar-library.js
// 注意：socket-client.js 已加载，可以直接使用 socketClient

// ===== 全局变量 =====
let allRooms = [];
let filteredRooms = [];
let currentSelectedAvatar = null;
let joinSelectedAvatar = null;
let selectedRoom = null;

// ===== 更新在线人数显示 =====
function updateOnlineStats(stats) {
    const onlineStats = document.getElementById('onlineStats');
    if (onlineStats) {
        const total = stats.total || stats;
        const playing = stats.playing;
        if (playing !== undefined) {
            onlineStats.textContent = `${total.toLocaleString()} 人在线 (${playing} 游戏中)`;
        } else {
            onlineStats.textContent = `${total.toLocaleString()} 人在线`;
        }
    }
}

// ===== 渲染房间列表 =====
function renderRooms(rooms) {
    const roomsGrid = document.getElementById('roomsGrid');
    roomsGrid.innerHTML = '';

    if (rooms.length === 0) {
        roomsGrid.innerHTML = `
            <div style="text-align: center; padding: 60px; color: var(--text-secondary);">
                <div style="font-size: 48px; margin-bottom: 16px; display: flex; justify-content: center;">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none">
                        <circle cx="11" cy="11" r="8"/>
                        <path d="m21 21-4.35-4.35"/>
                    </svg>
                </div>
                <div style="font-size: 16px;">暂无符合条件的房间</div>
            </div>
        `;
        return;
    }

    rooms.forEach(room => {
        const roomCard = document.createElement('div');
        roomCard.className = 'room-card';

        // 生成玩家头像
        const maxPlayers = room.maxPlayers || 6;
        const currentPlayers = room.currentPlayers || 0;
        const players = room.players || [];

        // 创建玩家头像数组（现有玩家 + 空位）
        const playerAvatars = [];
        for (let i = 0; i < maxPlayers; i++) {
            if (i < players.length) {
                // 现有玩家
                playerAvatars.push(players[i]);
            } else {
                // 空位
                playerAvatars.push(null);
            }
        }

        const colors = [
            'linear-gradient(135deg, #ef4444, #f97316)',
            'linear-gradient(135deg, #f59e0b, #eab308)',
            'linear-gradient(135deg, #22c55e, #10b981)',
            'linear-gradient(135deg, #3b82f6, #2563eb)',
            'linear-gradient(135deg, #8b5cf6, #7c3aed)',
            'linear-gradient(135deg, #ec4899, #db2777)',
            'linear-gradient(135deg, #14b8a6, #0d9488)',
            'linear-gradient(135deg, #f97316, #ea580c)'
        ];

        const playersHTML = playerAvatars.map((player, index) => {
            if (!player) {
                // 空位
                return `<div class="room-player-avatar empty">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </div>`;
            }
            // 显示玩家头像（名字首字或头像）- XSS 防护
            const display = escapeHtml(player.avatar || player.name[0] || '?');
            return `<div class="room-player-avatar" style="background: ${colors[index % colors.length]}">${display}</div>`;
        }).join('');

        // 状态文本
        const statusText = {
            'waiting': '等待中',
            'playing': '游戏中',
            'full': '已满员'
        };

        // 判断是否满员
        const isFull = currentPlayers >= maxPlayers;
        // 判断是否可以加入
        const canJoin = room.status === 'waiting' && !isFull;

        roomCard.innerHTML = `
            <div class="room-card-header">
                <div class="room-name">${escapeHtml(room.name)}</div>
                <div class="room-status ${room.status}">${statusText[room.status] || '等待中'}</div>
            </div>

            <div class="room-card-body">
                <div class="room-info-row room-id-row">
                    <span class="room-info-icon">
                        <svg viewBox="0 0 24 24">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="9" y1="9" x2="15" y2="9"></line>
                            <line x1="9" y1="15" x2="15" y2="15"></line>
                        </svg>
                    </span>
                    <span class="room-id-text">房间ID: <strong>${escapeHtml(room.code || room.id)}</strong></span>
                </div>
                <div class="room-info-row">
                    <span class="room-info-icon">
                        <svg viewBox="0 0 24 24">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                    </span>
                    <span>人数: ${room.currentPlayers || 0}/${room.maxPlayers}</span>
                </div>
                <div class="room-info-row">
                    <span class="room-info-icon">
                        <svg viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                    </span>
                    <span>回合: ${room.roundTime || room.time || 90}秒</span>
                </div>
                <div class="room-info-row">
                    <span class="room-info-icon">
                        <svg viewBox="0 0 24 24">
                            <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                            <line x1="6" y1="12" x2="6" y2="12"></line>
                            <line x1="10" y1="12" x2="10" y2="12"></line>
                            <circle cx="17" cy="12" r="2"></circle>
                        </svg>
                    </span>
                    <span>模式: 经典</span>
                </div>
                ${room.isPrivate ? '<div class="room-info-row"><span class="room-info-icon"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span><span>私密房间</span></div>' : ''}
            </div>

            <div class="room-players">
                ${playersHTML}
            </div>

            <div class="room-card-footer">
                <button class="join-btn" ${!canJoin ? 'disabled' : ''} onclick="joinRoom('${escapeHtml(room.code || room.id)}')">
                    ${canJoin ? '加入房间' : room.status === 'playing' ? '游戏中' : '已满员'}
                </button>
            </div>
        `;

        roomsGrid.appendChild(roomCard);
    });
}

// ===== 搜索和筛选 =====
function filterRooms() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();
    const statusFilter = document.getElementById('filterStatus').value;
    const playersFilter = document.getElementById('filterPlayers').value;

    // 使用全局房间列表 allRooms
    filteredRooms = (allRooms || []).filter(room => {
        // 名称和房间ID搜索
        const matchesSearch = !searchTerm ||
                              room.name.toLowerCase().includes(searchTerm) ||
                              (room.code || room.id || '').toLowerCase().includes(searchTerm);

        // 状态筛选
        const matchesStatus = statusFilter === 'all' || room.status === statusFilter;

        // 人数筛选
        let matchesPlayers = true;
        if (playersFilter !== 'all') {
            const [min, max] = playersFilter.split('-').map(Number);
            matchesPlayers = room.currentPlayers >= min && room.currentPlayers <= max;
        }

        return matchesSearch && matchesStatus && matchesPlayers;
    });

    renderRooms(filteredRooms);
}

// ===== 创建房间弹窗 =====
const createRoomModal = document.getElementById('createRoomModal');
const btnCreateRoom = document.getElementById('btnCreateRoom');
const btnCancelCreate = document.getElementById('btnCancelCreate');
const btnConfirmCreate = document.getElementById('btnConfirmCreate');
const roomTypeSelect = document.getElementById('roomType');
const passwordGroup = document.getElementById('passwordGroup');
const avatarPreview = document.getElementById('avatarPreview');
const refreshAvatarBtn = document.getElementById('refreshAvatar');

// 初始化当前选择的头像
currentSelectedAvatar = getRandomAvatar();

// 更新头像预览
function updateAvatarPreview() {
    avatarPreview.innerHTML = currentSelectedAvatar.svg;
}

// 初始化头像预览
updateAvatarPreview();

// 随机切换头像按钮
refreshAvatarBtn.addEventListener('click', () => {
    currentSelectedAvatar = getRandomAvatar();
    updateAvatarPreview();
});

// 打开弹窗
btnCreateRoom.addEventListener('click', () => {
    createRoomModal.classList.add('show');
    // 每次打开弹窗时重置头像
    currentSelectedAvatar = getRandomAvatar();
    updateAvatarPreview();
});

// 关闭弹窗
btnCancelCreate.addEventListener('click', () => {
    createRoomModal.classList.remove('show');
    document.getElementById('createRoomForm').reset();
    passwordGroup.style.display = 'none';
});

// 点击外部关闭
createRoomModal.addEventListener('click', (e) => {
    if (e.target === createRoomModal) {
        createRoomModal.classList.remove('show');
        document.getElementById('createRoomForm').reset();
        passwordGroup.style.display = 'none';
    }
});

// 私密房间密码显示
roomTypeSelect.addEventListener('change', (e) => {
    passwordGroup.style.display = e.target.value === 'private' ? 'block' : 'none';
});

// ===== 创建房间确认按钮 =====
btnConfirmCreate.addEventListener('click', async () => {
    console.log('点击创建房间确认按钮');

    // 检查Socket连接状态
    if (!socketClient.isConnected) {
        Toast.error('服务器未连接，请刷新页面重试');
        return;
    }

    const roomName = document.getElementById('roomName').value.trim();
    if (!roomName) {
        Toast.warning('请输入房间名称');
        return;
    }

    const nickname = document.getElementById('playerNickname').value.trim();
    if (!nickname) {
        Toast.warning('请输入你的昵称');
        return;
    }

    // 获取游戏类型
    const gameMode = document.getElementById('gameMode').value || 'classic';

    // 根据游戏类型设置参数
    let maxPlayers = parseInt(document.getElementById('maxPlayers').value) || 6;
    if (gameMode === 'gobang') {
        maxPlayers = 2; // 五子棋固定2人
    }

    const options = {
        name: roomName,
        maxPlayers: maxPlayers,
        roundTime: parseInt(document.getElementById('roundTime').value) || 90,
        gameMode: gameMode,
        type: document.getElementById('roomType').value === 'private' ? '私密' : '经典模式',
        isPrivate: document.getElementById('roomType').value === 'private',
        password: document.getElementById('roomPassword').value || '',
        playerName: nickname,
        playerAvatar: currentSelectedAvatar.svg
    };

    console.log('创建房间选项:', options);
    console.log('游戏类型:', gameMode, '最大人数:', maxPlayers, '类型:', typeof maxPlayers);

    // 关闭弹窗
    createRoomModal.classList.remove('show');
    document.getElementById('createRoomForm').reset();
    passwordGroup.style.display = 'none';

    // 根据游戏类型跳转到不同页面
    if (gameMode === 'gobang') {
        // 五子棋统一在游戏页面创建房间，避免大厅和游戏页重复调用 createRoom
        const params = new URLSearchParams({
            action: 'create',
            roomName: roomName,
            playerName: nickname,
            playerAvatar: currentSelectedAvatar.svg,
            clientId: socketClient.clientId,
            maxPlayers: maxPlayers.toString(),
            roundTime: options.roundTime.toString(),
            isPrivate: options.isPrivate ? 'true' : 'false',
            password: options.password
        });
        window.location.href = `gobang-online.html?${params.toString()}`;
        return;
    }

    try {
        const response = await socketClient.createRoom(options);
        console.log('创建房间响应:', response);

        if (response && response.success) {
            // 经典模式跳转到 room-lobby.html
            const params = new URLSearchParams({
                roomCode: response.roomCode,
                roomName: response.room.name,
                maxPlayers: response.room.maxPlayers.toString(),
                roundTime: (response.room.roundTime || 90).toString(),
                roomType: response.room.type || '经典模式',
                status: '等待中',
                isHost: 'true',
                playerName: nickname,
                playerAvatar: currentSelectedAvatar.svg
            });
            window.location.href = `room-lobby.html?${params.toString()}`;
        }
    } catch (error) {
        console.error('创建房间失败:', error);
        Toast.error('创建房间失败: ' + error.message);
    }
});

// ===== 游戏类型切换逻辑 =====
const gameModeSelect = document.getElementById('gameMode');
const maxPlayersSelect = document.getElementById('maxPlayers');
const roundTimeGroup = document.querySelector('#roundTime')?.closest('.form-group');

// 监听游戏类型变化
gameModeSelect.addEventListener('change', (e) => {
    const mode = e.target.value;

    if (mode === 'gobang') {
        // 五子棋模式：固定人数为2人，禁用选择
        maxPlayersSelect.value = '2';
        maxPlayersSelect.disabled = true;

        // 隐藏回合时间（五子棋不需要）
        if (roundTimeGroup) {
            roundTimeGroup.style.opacity = '0.5';
            roundTimeGroup.querySelector('select').disabled = true;
        }
    } else {
        // 经典模式：恢复默认设置
        maxPlayersSelect.disabled = false;

        if (roundTimeGroup) {
            roundTimeGroup.style.opacity = '1';
            roundTimeGroup.querySelector('select').disabled = false;
        }
    }
});

// ===== 快速匹配 =====
const btnQuickMatch = document.getElementById('btnQuickMatch');
const quickMatchToast = document.getElementById('quickMatchToast');

btnQuickMatch.addEventListener('click', () => {
    quickMatchToast.classList.add('show');

    // 通过Socket.io快速匹配
    socketClient.quickMatch((response) => {
        quickMatchToast.classList.remove('show');

        if (response.success) {
            const room = response.room;
            const params = new URLSearchParams({
                roomCode: room.code,
                roomName: room.name,
                maxPlayers: room.maxPlayers.toString(),
                roundTime: (room.roundTime || 90).toString(),
                status: '等待中',
                isHost: 'false',
                playerName: response.playerName,
                playerAvatar: response.playerAvatar
            });
            window.location.href = `room-lobby.html?${params.toString()}`;
        } else {
            Toast.warning(response.message || '快速匹配失败');
        }
    });
});

// ===== 加入房间 =====
function joinRoom(roomId) {
    const room = allRooms.find(r => r.id === roomId || r.code === roomId);
    selectedRoom = room;

    if (room && room.isPrivate) {
        const password = prompt('该房间为私密房间，请输入密码：');
        if (password === null) return;
    }

    // 所有房间都显示加入房间弹窗
    showJoinRoomModal(room);
}

// ===== 直接加入房间（无需弹窗） =====
async function joinRoomDirect(roomId, nickname) {
    try {
        const response = await socketClient.joinRoom(roomId, nickname, null, null);
        console.log('直接加入房间响应:', response);

        if (response && response.success) {
            // 根据游戏类型跳转到不同页面
            const gameMode = response.room.gameMode || 'classic';

            if (gameMode === 'gobang') {
                // 五子棋跳转到 gobang-online.html
                const params = new URLSearchParams({
                    room: response.room.code || roomId,
                    action: 'join',
                    playerName: nickname,
                    playerAvatar: joinSelectedAvatar?.svg || currentSelectedAvatar?.svg || '',
                    clientId: socketClient.clientId
                });
                window.location.href = `gobang-online.html?${params.toString()}`;
            } else {
                // 经典模式跳转到 room-lobby.html
                const params = new URLSearchParams({
                    roomCode: response.room.code || roomId,
                    roomName: response.room.name,
                    maxPlayers: response.room.maxPlayers.toString(),
                    roundTime: (response.room.roundTime || 90).toString(),
                    roomType: response.room.gameMode || '经典模式',
                    status: '等待中',
                    isHost: 'false',
                    playerName: nickname
                });
                window.location.href = `room-lobby.html?${params.toString()}`;
            }
        }
    } catch (error) {
        console.error('直接加入房间失败:', error);
        Toast.error('加入房间失败: ' + error.message);
    }
}

// ===== 显示加入房间弹窗 =====
function showJoinRoomModal(room) {
    const modal = document.getElementById('joinRoomModal');
    if (!modal) {
        console.error('加入房间弹窗不存在');
        return;
    }

    updateJoinRoomModal(room);
    modal.classList.add('show');

    // 初始化加入房间的头像预览
    joinSelectedAvatar = getRandomAvatar();
    const joinAvatarPreview = document.getElementById('joinAvatarPreview');
    if (joinAvatarPreview) {
        joinAvatarPreview.innerHTML = joinSelectedAvatar.svg;
    }
}

// ===== 加入房间头像刷新按钮 =====
const refreshJoinAvatarBtn = document.getElementById('refreshJoinAvatar');
if (refreshJoinAvatarBtn) {
    refreshJoinAvatarBtn.addEventListener('click', (e) => {
        e.preventDefault();
        joinSelectedAvatar = getRandomAvatar();
        const joinAvatarPreview = document.getElementById('joinAvatarPreview');
        if (joinAvatarPreview) {
            joinAvatarPreview.innerHTML = joinSelectedAvatar.svg;
        }
    });
}

// ===== 关闭加入房间弹窗 =====
const btnCloseJoin = document.getElementById('btnCloseJoin');
const btnCancelJoin = document.getElementById('btnCancelJoin');
const joinRoomModal = document.getElementById('joinRoomModal');

if (btnCloseJoin) {
    btnCloseJoin.addEventListener('click', () => {
        joinRoomModal.classList.remove('show');
    });
}

if (btnCancelJoin) {
    btnCancelJoin.addEventListener('click', () => {
        joinRoomModal.classList.remove('show');
    });
}

if (joinRoomModal) {
    joinRoomModal.addEventListener('click', (e) => {
        if (e.target === joinRoomModal) {
            joinRoomModal.classList.remove('show');
        }
    });
}

// ===== 确认加入房间按钮 =====
const btnConfirmJoin = document.getElementById('btnConfirmJoin');
if (btnConfirmJoin) {
    btnConfirmJoin.addEventListener('click', async () => {
        const nickname = document.getElementById('joinNickname').value.trim();
        if (!nickname) {
            Toast.warning('请输入你的昵称');
            return;
        }

        const roomCode = document.getElementById('joinRoomCode').value.trim();
        if (!roomCode) {
            Toast.error('房间号不存在');
            return;
        }

        const password = document.getElementById('joinPassword')?.value || '';

        // 五子棋房间统一在游戏页面加入，避免大厅和游戏页重复调用 joinRoom
        const room = selectedRoom || allRooms.find(r => r.id === roomCode || r.code === roomCode);
        if (room && room.gameMode === 'gobang') {
            // 私密房间先验证密码
            if (room.isPrivate) {
                try {
                    const valid = await socketClient.validateRoomPassword(roomCode, password);
                    if (!valid.success) {
                        Toast.error(valid.message || '密码错误');
                        return;
                    }
                } catch (error) {
                    console.error('密码验证失败:', error);
                    Toast.error('密码验证失败: ' + error.message);
                    return;
                }
            }

            joinRoomModal.classList.remove('show');
            const params = new URLSearchParams({
                room: roomCode,
                action: 'join',
                playerName: nickname,
                playerAvatar: joinSelectedAvatar.svg,
                clientId: socketClient.clientId,
                password: password
            });
            window.location.href = `gobang-online.html?${params.toString()}`;
            return;
        }

        try {
            const response = await socketClient.joinRoom(roomCode, nickname, password, joinSelectedAvatar.svg);
            console.log('加入房间响应:', response);

            if (response && response.success) {
                joinRoomModal.classList.remove('show');

                // 经典模式跳转到 room-lobby.html
                const params = new URLSearchParams({
                    roomCode: response.room.code || roomCode,
                    roomName: response.room.name,
                    maxPlayers: response.room.maxPlayers.toString(),
                    roundTime: (response.room.roundTime || 90).toString(),
                    roomType: response.room.gameMode || '经典模式',
                    status: '等待中',
                    isHost: 'false',
                    playerName: nickname,
                    playerAvatar: joinSelectedAvatar.svg
                });
                window.location.href = `room-lobby.html?${params.toString()}`;
            }
        } catch (error) {
            console.error('加入房间失败:', error);
            Toast.error('加入房间失败: ' + error.message);
        }
    });
}

// ===== 更新加入房间弹窗内容 =====
function updateJoinRoomModal(room) {
    const joinRoomCode = document.getElementById('joinRoomCode');
    const joinRoomName = document.getElementById('joinRoomName');
    const joinPasswordGroup = document.getElementById('joinPasswordGroup');

    if (joinRoomCode) {
        joinRoomCode.value = room.code || room.id;
    }
    if (joinRoomName) {
        joinRoomName.value = room.name;
    }
    if (joinPasswordGroup) {
        joinPasswordGroup.style.display = room.isPrivate ? 'block' : 'none';
    }
}

// ===== 刷新列表 =====
const btnRefresh = document.getElementById('btnRefresh');

btnRefresh.addEventListener('click', () => {
    btnRefresh.innerHTML = `<span class="action-btn-icon">
        <svg viewBox="0 0 24 24" class="spinning">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
    </span>刷新中...`;
    btnRefresh.disabled = true;

    setTimeout(() => {
        renderRooms(filteredRooms);
        btnRefresh.innerHTML = `<span class="action-btn-icon">
            <svg viewBox="0 0 24 24">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
        </span>刷新列表`;
        btnRefresh.disabled = false;
    }, 1000);
});

// ===== Socket.io 初始化 =====
async function initSocket() {
    try {
        await socketClient.connect();
        console.log('已连接到服务器');

        // 监听房间列表更新
        socketClient.on('roomList', (rooms) => {
            console.log('房间列表更新:', rooms);
            allRooms = rooms;
            filteredRooms = rooms;
            renderRooms(rooms);
        });

        // 监听在线人数更新（服务端广播）
        socketClient.on('onlineCount', (stats) => {
            updateOnlineStats(stats);
        });

        // 获取房间列表
        const rooms = await socketClient.getRoomList();
        console.log('获取房间列表:', rooms);
        allRooms = rooms;
        filteredRooms = rooms;
        renderRooms(rooms);

        // 获取在线人数
        socketClient.socket.emit('getOnlineCount', (response) => {
            if (response && response.success) {
                updateOnlineStats(response);
            }
        });

        // 定时轮询在线人数（每10秒），作为广播的补充
        setInterval(() => {
            socketClient.socket.emit('getOnlineCount', (response) => {
                if (response && response.success) {
                    updateOnlineStats(response);
                }
            });
        }, 10000);

    } catch (error) {
        console.error('连接失败:', error);
    }
}

// ===== 搜索和筛选事件监听 =====
document.getElementById('searchInput')?.addEventListener('input', filterRooms);
document.getElementById('filterStatus')?.addEventListener('change', filterRooms);
document.getElementById('filterPlayers')?.addEventListener('change', filterRooms);

// ===== 页面加载完成后初始化 =====
document.addEventListener('DOMContentLoaded', function() {
    initSocket();
});