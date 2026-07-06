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
            'wordSelected',
            'gameEnded',
            'roomList',
            'roomUpdate',
            'roundEnded',
            'roomDestroyed'
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

    leaveRoom(roomCode = this.roomCode) {
        if (this.socket) {
            this.socket.emit('leaveRoom', { roomCode });
            this.roomCode = null;
        }
    }

    setReady(ready, roomCode = this.roomCode) {
        if (this.socket) {
            this.socket.emit('playerReady', { roomCode, ready });
        }
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