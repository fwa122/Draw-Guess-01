class SocketClient {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.roomCode = null;
        this.playerId = null;
        this.eventHandlers = {};
        this.clientId = SocketClient.getClientId();
    }

    // 生成并持久化客户端唯一标识，用于断线重连
    static getClientId() {
        let id = null;
        try {
            id = localStorage.getItem('draw_guess_client_id');
        } catch (e) {
            // localStorage 不可用时回退到内存
        }
        if (!id) {
            id = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
            try {
                localStorage.setItem('draw_guess_client_id', id);
            } catch (e) {
                // ignore
            }
        }
        return id;
    }

    connect(url = '/') {
        return new Promise((resolve, reject) => {
            if (typeof io === 'undefined') {
                reject(new Error('Socket.io not loaded'));
                return;
            }

            this.socket = io(url);

            this.socket.on('connect', () => {
                this.isConnected = true;
                this.playerId = this.socket.id;
                resolve({ success: true, playerId: this.playerId });
            });

            this.socket.on('disconnect', () => {
                this.isConnected = false;
                this.triggerEvent('disconnected');
            });

            this.socket.on('connect_error', (error) => {
                reject(new Error(`连接失败: ${error.message}`));
            });

            this.setupEventListeners();
        });
    }

    setupEventListeners() {
        const events = [
            'roomCreated',
            'joinSuccess',
            'joinFailed',
            'playerJoined',
            'playerLeft',
            'playerReady',
            'gameStarted',
            'startFailed',
            'canvasUpdate',
            'guessCorrect',
            'guessAttempt',
            'chatMessage',
            'roundStarted',
            'timerUpdate',
            'painterWord',
            'wordCandidates',
            'wordSelected',
            'gameEnded',
            'roomList',
            'roomUpdate',
            'roundEnded',
            'roomDestroyed',
            // 矢量笔迹同步事件
            'stroke',
            'strokeIncrement',
            'strokeBatch',
            'canvasSnapshot',
            'clearCanvas',
            'areaErase'
        ];

        events.forEach(event => {
            this.socket.on(event, (data) => {
                this.triggerEvent(event, data);
            });
        });
    }

    on(event, callback) {
        if (!this.eventHandlers[event]) {
            this.eventHandlers[event] = [];
        }
        this.eventHandlers[event].push(callback);
        return this;
    }

    off(event, callback) {
        if (this.eventHandlers[event]) {
            if (callback) {
                this.eventHandlers[event] = this.eventHandlers[event].filter(cb => cb !== callback);
            } else {
                this.eventHandlers[event] = [];
            }
        }
        return this;
    }

    triggerEvent(event, data) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Event handler error for ${event}:`, error);
                }
            });
        }
    }

    createRoom(options) {
        return new Promise((resolve, reject) => {
            if (!this.socket) {
                reject(new Error('未连接到服务器'));
                return;
            }

            this.socket.emit('createRoom', { ...options, clientId: this.clientId }, (response) => {
                if (response && response.success) {
                    this.roomCode = response.roomCode;
                    resolve(response);
                } else {
                    reject(new Error(response?.message || '创建房间失败'));
                }
            });
        });
    }

    joinRoom(roomCode, playerName, password = null, playerAvatar = null) {
        return new Promise((resolve, reject) => {
            if (!this.socket) {
                reject(new Error('未连接到服务器'));
                return;
            }

            this.socket.emit('joinRoom', { roomCode, playerName, password, playerAvatar, clientId: this.clientId }, (response) => {
                if (response && response.success) {
                    this.roomCode = roomCode;
                    resolve(response);
                } else {
                    reject(new Error(response?.message || '加入房间失败'));
                }
            });
        });
    }

    validateRoomPassword(roomCode, password) {
        return new Promise((resolve, reject) => {
            if (!this.socket) {
                reject(new Error('未连接到服务器'));
                return;
            }

            this.socket.emit('validateRoomPassword', { roomCode, password }, (response) => {
                resolve(response || { success: false, message: '验证失败' });
            });
        });
    }

    leaveRoom(roomCode = this.roomCode) {
        if (this.socket) {
            this.socket.emit('leaveRoom', { roomCode });
            this.roomCode = null;
        }
    }

    setReady(ready, roomCode = this.roomCode) {
        return new Promise((resolve, reject) => {
            if (!this.socket) {
                reject(new Error('未连接到服务器'));
                return;
            }
            this.socket.emit('playerReady', { roomCode, ready }, (response) => {
                if (response && response.success) {
                    resolve(response);
                } else {
                    reject(new Error(response?.message || '操作失败'));
                }
            });
        });
    }

    startGame(roomCode = this.roomCode) {
        return new Promise((resolve, reject) => {
            if (!this.socket) {
                reject(new Error('未连接到服务器'));
                return;
            }

            this.socket.emit('startGame', { roomCode }, (response) => {
                if (response && response.success) {
                    resolve(response);
                } else {
                    reject(new Error(response?.message || '开始游戏失败'));
                }
            });
        });
    }

    sendCanvasUpdate(data, roomCode = this.roomCode) {
        if (this.socket) {
            this.socket.emit('canvasUpdate', { roomCode, data });
        }
    }

    // ===== 矢量笔迹同步方法 =====

    // 发送完整笔迹（笔画结束时）
    sendStroke(stroke, roomCode = this.roomCode) {
        if (this.socket) {
            this.socket.emit('stroke', { roomCode, stroke });
        }
    }

    // 发送笔迹增量（绘画过程中实时）
    sendStrokeIncrement(strokeId, points, tool, color, width, roomCode = this.roomCode) {
        if (this.socket) {
            this.socket.emit('strokeIncrement', { roomCode, strokeId, points, tool, color, width });
        }
    }

    // 发送画布快照（定期同步）
    sendCanvasSnapshot(data, timestamp, roomCode = this.roomCode) {
        if (this.socket) {
            this.socket.emit('canvasSnapshot', { roomCode, data, timestamp });
        }
    }

    // 请求画布同步（中途加入/重连）
    requestCanvasSync(roomCode = this.roomCode) {
        if (this.socket) {
            this.socket.emit('requestCanvasSync', { roomCode });
        }
    }

    // 发送清空画布操作
    sendClearCanvas(timestamp, roomCode = this.roomCode) {
        if (this.socket) {
            this.socket.emit('clearCanvas', { roomCode, timestamp });
        }
    }

    // 发送区域擦除操作
    sendAreaErase(rect, timestamp, roomCode = this.roomCode) {
        if (this.socket) {
            this.socket.emit('areaErase', { roomCode, rect, timestamp });
        }
    }

    sendGuess(guess, roomCode = this.roomCode) {
        console.log('[socket-client] sendGuess called:', { roomCode, guess, connected: this.socket?.connected });
        if (this.socket) {
            this.socket.emit('guess', { roomCode, guess });
        } else {
            console.error('[socket-client] socket is null, cannot send guess');
        }
    }

    selectWord(word, roomCode = this.roomCode) {
        console.log('[socket-client] selectWord called:', { roomCode, word, connected: this.socket?.connected });
        if (this.socket) {
            this.socket.emit('selectWord', { roomCode, word });
        } else {
            console.error('[socket-client] socket is null, cannot select word');
        }
    }

    refreshWords(roomCode = this.roomCode) {
        return new Promise((resolve, reject) => {
            if (!this.socket) {
                reject(new Error('未连接到服务器'));
                return;
            }

            this.socket.emit('refreshWords', { roomCode }, (response) => {
                if (response && response.success) {
                    resolve(response);
                } else {
                    reject(new Error(response?.message || '刷新词汇失败'));
                }
            });
        });
    }

    sendChatMessage(message, roomCode = this.roomCode) {
        if (this.socket) {
            this.socket.emit('chatMessage', { roomCode, message });
        }
    }

    nextRound(roomCode = this.roomCode) {
        if (this.socket) {
            this.socket.emit('nextRound', { roomCode });
        }
    }

    swapSeat(roomCode, fromIndex, toIndex) {
        if (this.socket) {
            this.socket.emit('swapSeat', { roomCode, fromIndex, toIndex });
        }
    }

    getRoomList() {
        return new Promise((resolve, reject) => {
            if (!this.socket) {
                reject(new Error('未连接到服务器'));
                return;
            }

            this.socket.emit('getRooms');
            const handler = (rooms) => {
                this.off('roomList', handler);
                resolve(rooms);
            };
            this.on('roomList', handler);
        });
    }

    quickMatch(callback) {
        if (!this.socket) {
            callback({ success: false, message: '未连接到服务器' });
            return;
        }

        this.socket.emit('quickMatch', (response) => {
            if (response && response.success) {
                this.roomCode = response.room.code;
            }
            callback(response);
        });
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.isConnected = false;
            this.roomCode = null;
            this.playerId = null;
        }
    }

    getStatus() {
        return {
            isConnected: this.isConnected,
            roomCode: this.roomCode,
            playerId: this.playerId
        };
    }
}

const socketClient = new SocketClient();

window.SocketClient = SocketClient;
window.socketClient = socketClient;