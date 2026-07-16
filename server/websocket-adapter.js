/**
 * WebSocket 适配器 - 为 Socket.io 服务器添加原生 WebSocket 支持
 * 让 uni-app x 等使用原生 WebSocket 的客户端可以连接
 */

const WebSocket = require('ws');

/**
 * 创建 WebSocket 适配器
 * @param {http.Server} server - HTTP 服务器实例
 * @param {Object} io - Socket.io 实例
 * @param {Map} rooms - 房间 Map
 * @param {Object} helpers - 辅助函数
 */
function createWebSocketAdapter(server, io, rooms, helpers) {
    // 创建独立的 WebSocket 服务器，使用 /ws 路径
    const wss = new WebSocket.Server({ 
        server,
        path: '/ws'  // 使用独立的路径，避免与 Socket.io 冲突
    });
    
    console.log('[WS适配器] 原生 WebSocket 服务器已启动，路径: /ws');
    
    // 从 helpers 提取函数
    const {
        getRoomSnapshot,
        transitionRoomStatus,
        broadcastRoomUpdate,
        validateRoomOptions,
        handleNextRound,
        ROOM_STATUS
    } = helpers;
    
    // 存储原生 WebSocket 连接
    const wsClients = new Map();
    
    // 生成唯一 ID
    function generateId() {
        return 'ws_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
    }
    
    // 发送消息（Socket.io 格式）
    function sendMessage(ws, event, data) {
        try {
            const message = '42' + JSON.stringify([event, data]);
            ws.send(message);
            console.log('[WS适配器] 发送事件:', event);
        } catch (error) {
            console.error('[WS适配器] 发送消息失败:', error);
        }
    }
    
    // 广播到房间
    function broadcastToRoom(roomCode, event, data, excludeClient = null) {
        const message = '42' + JSON.stringify([event, data]);
        
        wsClients.forEach((client) => {
            if (client.currentRoom === roomCode && client.ws !== excludeClient && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(message);
            }
        });
        
        // 同时通过 Socket.io 广播
        io.to(roomCode).emit(event, data);
    }
    
    // 心跳检测
    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            const client = findClientByWs(ws);
            if (client) {
                if (!client.isAlive) {
                    console.log('[WS适配器] 清理死连接:', client.id);
                    handleDisconnect(client);
                    ws.terminate();
                    return;
                }
                client.isAlive = false;
                ws.ping();
            }
        });
    }, 30000);
    
    // 查找客户端
    function findClientByWs(ws) {
        for (const client of wsClients.values()) {
            if (client.ws === ws) {
                return client;
            }
        }
        return null;
    }
    
    // 处理连接
    wss.on('connection', (ws, req) => {
        const clientId = generateId();
        console.log('[WS适配器] 新连接:', clientId, '来源:', req.socket.remoteAddress);
        
        const clientInfo = {
            id: clientId,
            ws: ws,
            isAlive: true,
            currentRoom: null,
            playerData: null
        };
        wsClients.set(clientId, clientInfo);
        
        // 发送欢迎消息
        sendMessage(ws, 'connected', { id: clientId });
        
        // 心跳响应
        ws.on('pong', () => {
            if (clientInfo) {
                clientInfo.isAlive = true;
            }
        });
        
        // 接收消息
        ws.on('message', (data) => {
            const message = data.toString();
            console.log('[WS适配器] 收到消息:', message.substring(0, 100));
            
            // 处理心跳
            if (message === '2') {
                ws.send('3');
                return;
            }
            
            // 解析 Socket.io 格式的消息
            if (message.startsWith('42')) {
                try {
                    const jsonStr = message.substring(2);
                    const parsed = JSON.parse(jsonStr);
                    const event = parsed[0];
                    const eventData = parsed[1];
                    
                    console.log('[WS适配器] 解析事件:', event);
                    handleEvent(ws, clientInfo, event, eventData);
                } catch (error) {
                    console.error('[WS适配器] 消息解析错误:', error);
                }
            }
        });
        
        // 连接关闭
        ws.on('close', () => {
            console.log('[WS适配器] 连接关闭:', clientId);
            handleDisconnect(clientInfo);
        });
        
        // 错误处理
        ws.on('error', (error) => {
            console.error('[WS适配器] 错误:', clientId, error.message);
        });
    });
    
    // 处理断开连接
    function handleDisconnect(clientInfo) {
        if (!clientInfo) return;
        
        wsClients.delete(clientInfo.id);
        
        // 处理离开房间
        if (clientInfo.currentRoom && clientInfo.playerData) {
            const room = rooms.get(clientInfo.currentRoom);
            if (room) {
                // 标记玩家为离线
                const player = room.players.find(p => p.id === clientInfo.id);
                if (player) {
                    player.status = 'offline';
                    console.log(`[WS适配器] 玩家 ${player.name} 离线`);
                }
                
                broadcastRoomUpdate(clientInfo.currentRoom);
            }
        }
    }
    
    // 处理事件
    function handleEvent(ws, clientInfo, event, data) {
        console.log('[WS适配器] 处理事件:', event);
        
        switch (event) {
            case 'getRooms':
                handleGetRooms(ws);
                break;
            case 'createRoom':
                handleCreateRoom(ws, clientInfo, data);
                break;
            case 'joinRoom':
                handleJoinRoom(ws, clientInfo, data);
                break;
            case 'leaveRoom':
                handleLeaveRoom(clientInfo);
                break;
            case 'playerReady':
                handlePlayerReady(clientInfo, data);
                break;
            case 'startGame':
                handleStartGame(clientInfo);
                break;
            case 'getRoomInfo':
                handleGetRoomInfo(ws, data);
                break;
            case 'getRoomList':
                handleGetRooms(ws);
                break;
            default:
                console.log('[WS适配器] 未知事件:', event);
        }
    }
    
    // 获取房间列表
    function handleGetRooms(ws) {
        const roomList = [];
        rooms.forEach((room, code) => {
            if (room.status === 'waiting' || room.status === 'playing') {
                roomList.push({
                    code: room.code,
                    name: room.name,
                    status: room.status,
                    playerCount: room.players.filter(p => p.status !== 'offline').length,
                    maxPlayers: room.maxPlayers,
                    isPrivate: room.isPrivate || false
                });
            }
        });
        sendMessage(ws, 'roomList', roomList);
    }

    // 获取房间信息
    function handleGetRoomInfo(ws, data) {
        const { roomCode } = data || {};
        const room = rooms.get(roomCode);
        if (room) {
            sendMessage(ws, 'roomUpdate', getRoomSnapshot(room));
        } else {
            sendMessage(ws, 'error', { message: '房间不存在' });
        }
    }
    
    // 创建房间
    function handleCreateRoom(ws, clientInfo, data) {
        // 验证参数
        const validation = validateRoomOptions(data);
        if (!validation.valid) {
            sendMessage(ws, 'error', { message: validation.message });
            return;
        }
        
        // 生成房间码
        let roomCode;
        do {
            roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        } while (rooms.has(roomCode));
        
        // 创建房间
        const room = {
            code: roomCode,
            name: data.name,
            isPrivate: data.isPrivate || false,
            password: data.password || '',
            hostId: clientInfo.id,
            maxPlayers: data.maxPlayers,
            roundTime: data.roundTime,
            gameMode: data.gameMode || 'classic',
            status: ROOM_STATUS.WAITING,
            players: [],
            scores: {},
            currentRound: 0,
            maxRounds: data.maxPlayers, // 每人一轮
            currentPainter: null,
            currentWord: null,
            strokeHistory: [],
            guessRankings: [],
            lastSnapshot: null,
            createdAt: Date.now()
        };
        
        // 创建房主玩家
        const player = {
            id: clientInfo.id,
            name: data.playerName,
            isHost: true,
            status: 'ready', // 房主默认准备状态
            score: 0,
            avatar: data.avatar || 1,
            seatIndex: 0
        };
        
        room.players.push(player);
        room.scores[clientInfo.id] = 0;
        rooms.set(roomCode, room);
        
        // 更新客户端信息
        clientInfo.currentRoom = roomCode;
        clientInfo.playerData = player;
        
        // 发送成功消息
        sendMessage(ws, 'roomCreated', {
            success: true,
            room: getRoomSnapshot(room),
            playerId: clientInfo.id
        });
        
        console.log(`[WS适配器] 房间创建: ${roomCode} by ${player.name}`);
    }
    
    // 加入房间
    function handleJoinRoom(ws, clientInfo, data) {
        const { roomCode, playerName, password } = data;
        const room = rooms.get(roomCode);
        
        if (!room) {
            sendMessage(ws, 'error', { message: '房间不存在' });
            return;
        }
        
        if (room.status !== ROOM_STATUS.WAITING) {
            sendMessage(ws, 'error', { message: '游戏已开始，无法加入' });
            return;
        }
        
        if (room.players.filter(p => p.status !== 'offline').length >= room.maxPlayers) {
            sendMessage(ws, 'error', { message: '房间已满' });
            return;
        }
        
        if (room.isPrivate && room.password !== password) {
            sendMessage(ws, 'error', { message: '密码错误' });
            return;
        }
        
        // 创建玩家
        const seatIndex = room.players.length;
        const player = {
            id: clientInfo.id,
            name: playerName,
            isHost: false,
            status: 'waiting',
            score: 0,
            avatar: data.avatar || 1,
            seatIndex: seatIndex
        };
        
        room.players.push(player);
        room.scores[clientInfo.id] = 0;
        
        // 更新客户端信息
        clientInfo.currentRoom = roomCode;
        clientInfo.playerData = player;
        
        // 发送成功消息
        sendMessage(ws, 'roomJoined', {
            success: true,
            room: getRoomSnapshot(room),
            playerId: clientInfo.id
        });
        
        // 广播房间更新
        broadcastToRoom(roomCode, 'roomUpdate', getRoomSnapshot(room));
        
        console.log(`[WS适配器] 玩家 ${playerName} 加入房间 ${roomCode}`);
    }
    
    // 离开房间
    function handleLeaveRoom(clientInfo) {
        if (!clientInfo.currentRoom) return;
        
        const room = rooms.get(clientInfo.currentRoom);
        if (!room) return;
        
        // 移除玩家
        const playerIndex = room.players.findIndex(p => p.id === clientInfo.id);
        if (playerIndex > -1) {
            room.players.splice(playerIndex, 1);
        }
        
        // 广播更新
        broadcastToRoom(clientInfo.currentRoom, 'roomUpdate', getRoomSnapshot(room));
        
        // 如果房间为空，删除房间
        if (room.players.length === 0) {
            rooms.delete(clientInfo.currentRoom);
            console.log(`[WS适配器] 房间 ${clientInfo.currentRoom} 已删除`);
        }
        
        clientInfo.currentRoom = null;
        clientInfo.playerData = null;
    }
    
    // 玩家准备
    function handlePlayerReady(clientInfo, data) {
        if (!clientInfo.currentRoom) return;
        
        const room = rooms.get(clientInfo.currentRoom);
        if (!room) return;
        
        const player = room.players.find(p => p.id === clientInfo.id);
        if (!player) return;
        
        // 切换准备状态
        player.status = player.status === 'ready' ? 'waiting' : 'ready';
        
        // 广播更新
        broadcastToRoom(clientInfo.currentRoom, 'roomUpdate', getRoomSnapshot(room));
    }
    
    // 开始游戏
    function handleStartGame(clientInfo) {
        if (!clientInfo.currentRoom) return;
        
        const room = rooms.get(clientInfo.currentRoom);
        if (!room) return;
        
        // 检查是否是房主
        if (room.hostId !== clientInfo.id) {
            sendMessage(clientInfo.ws, 'error', { message: '只有房主可以开始游戏' });
            return;
        }
        
        // 检查是否所有玩家都已准备
        const allReady = room.players.every(p => p.isHost || p.status === 'ready');
        if (!allReady) {
            sendMessage(clientInfo.ws, 'error', { message: '还有玩家未准备' });
            return;
        }
        
        // 开始游戏
        if (!transitionRoomStatus(room, ROOM_STATUS.PLAYING)) {
            return;
        }
        
        room.currentRound = 0;
        room.strokeHistory = [];
        room.lastSnapshot = null;
        
        // 广播游戏开始
        broadcastToRoom(clientInfo.currentRoom, 'gameStarted', {
            room: getRoomSnapshot(room)
        });
        
        console.log(`[WS适配器] 房间 ${clientInfo.currentRoom} 游戏开始`);
        
        // 触发第一轮（这里需要与主服务器的逻辑集成）
        handleNextRound(clientInfo.currentRoom);
    }
    
    wss.on('close', () => {
        clearInterval(heartbeatInterval);
    });
    
    return {
        wss,
        wsClients,
        sendMessage,
        broadcastToRoom
    };
}

module.exports = { createWebSocketAdapter };