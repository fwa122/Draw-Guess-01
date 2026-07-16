/**
 * 房间持久化工具模块
 * 处理房间和玩家的数据库操作
 */

const { query, execute } = require('./pool');
const crypto = require('crypto');

// 房间状态枚举
const ROOM_STATUS = {
    WAITING: 'waiting',
    PLAYING: 'playing',
    FINISHED: 'finished'
};

// 玩家状态枚举
const PLAYER_STATUS = {
    WAITING: 'waiting',
    READY: 'ready',
    PLAYING: 'playing',
    OFFLINE: 'offline'
};

// 重连配置
const RECONNECT_CONFIG = {
    tokenExpiryMs: 300000,  // 重连令牌有效期：5分钟
    hostGraceMs: 60000      // 房主掉线宽限期：60秒
};

/**
 * 生成重连令牌
 */
function generateReconnectToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * 创建房间记录
 */
async function createRoom(roomData) {
    const {
        code,
        name,
        hostClientId,
        isPrivate = false,
        password = null,
        gameMode = 'classic',
        maxPlayers = 6,
        roundTime = 90
    } = roomData;

    try {
        const result = await execute(
            `INSERT INTO rooms (code, name, host_client_id, is_private, password, game_mode, max_players, round_time, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`,
            [code, name, hostClientId, isPrivate ? 1 : 0, password, gameMode, maxPlayers, roundTime]
        );
        return { success: true, roomId: result.insertId };
    } catch (error) {
        console.error('[房间持久化] 创建房间失败:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * 更新房间状态
 */
async function updateRoomStatus(roomCode, status, extraData = {}) {
    try {
        const fields = ['status = ?'];
        const values = [status];

        if (extraData.currentRound !== undefined) {
            fields.push('current_round = ?');
            values.push(extraData.currentRound);
        }

        if (extraData.currentPainterClientId !== undefined) {
            fields.push('current_painter_client_id = ?');
            values.push(extraData.currentPainterClientId);
        }

        values.push(roomCode);

        await execute(
            `UPDATE rooms SET ${fields.join(', ')} WHERE code = ?`,
            values
        );
        return { success: true };
    } catch (error) {
        console.error('[房间持久化] 更新房间状态失败:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * 添加玩家到房间
 */
async function addPlayerToRoom(roomCode, playerData) {
    const {
        clientId,
        nickname,
        avatar,
        isHost = false,
        isSpectator = false,
        seatIndex = 0
    } = playerData;

    const reconnectToken = generateReconnectToken();

    try {
        await execute(
            `INSERT INTO room_players (room_code, client_id, nickname, avatar, is_host, is_online, is_spectator, score, status, seat_index, reconnect_token)
             VALUES (?, ?, ?, ?, ?, 1, ?, 0, 'waiting', ?, ?)
             ON DUPLICATE KEY UPDATE
                nickname = VALUES(nickname),
                avatar = VALUES(avatar),
                is_host = VALUES(is_host),
                is_online = 1,
                is_spectator = VALUES(is_spectator),
                status = 'waiting',
                reconnect_token = VALUES(reconnect_token),
                disconnected_at = NULL`,
            [roomCode, clientId, nickname, avatar, isHost ? 1 : 0, isSpectator ? 1 : 0, seatIndex, reconnectToken]
        );

        return { success: true, reconnectToken };
    } catch (error) {
        console.error('[房间持久化] 添加玩家失败:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * 更新玩家状态
 */
async function updatePlayerStatus(roomCode, clientId, updates) {
    const fields = [];
    const values = [];

    if (updates.isOnline !== undefined) {
        fields.push('is_online = ?');
        values.push(updates.isOnline ? 1 : 0);
    }

    if (updates.status !== undefined) {
        fields.push('status = ?');
        values.push(updates.status);
    }

    if (updates.score !== undefined) {
        fields.push('score = ?');
        values.push(updates.score);
    }

    if (updates.isSpectator !== undefined) {
        fields.push('is_spectator = ?');
        values.push(updates.isSpectator ? 1 : 0);
    }

    if (updates.isHost !== undefined) {
        fields.push('is_host = ?');
        values.push(updates.isHost ? 1 : 0);
    }

    if (updates.disconnectedAt !== undefined) {
        fields.push('disconnected_at = ?');
        values.push(updates.disconnectedAt);
    }

    if (updates.reconnectToken !== undefined) {
        fields.push('reconnect_token = ?');
        values.push(updates.reconnectToken);
    }

    if (fields.length === 0) {
        return { success: true };
    }

    values.push(roomCode, clientId);

    try {
        await execute(
            `UPDATE room_players SET ${fields.join(', ')} WHERE room_code = ? AND client_id = ?`,
            values
        );
        return { success: true };
    } catch (error) {
        console.error('[房间持久化] 更新玩家状态失败:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * 标记玩家离线
 */
async function setPlayerOffline(roomCode, clientId) {
    return updatePlayerStatus(roomCode, clientId, {
        isOnline: false,
        status: PLAYER_STATUS.OFFLINE,
        disconnectedAt: new Date()
    });
}

/**
 * 标记玩家重连
 */
async function setPlayerOnline(roomCode, clientId) {
    const reconnectToken = generateReconnectToken();
    const result = await updatePlayerStatus(roomCode, clientId, {
        isOnline: true,
        status: PLAYER_STATUS.WAITING,
        disconnectedAt: null,
        reconnectToken
    });

    if (result.success) {
        result.newReconnectToken = reconnectToken;
    }
    return result;
}

/**
 * 通过重连令牌查找玩家
 */
async function findPlayerByReconnectToken(token) {
    try {
        const players = await query(
            `SELECT rp.*, r.status as room_status, r.name as room_name, r.code as room_code
             FROM room_players rp
             JOIN rooms r ON rp.room_code = r.code
             WHERE rp.reconnect_token = ? AND rp.is_online = 0`,
            [token]
        );

        if (!players || players.length === 0) {
            return { success: false, message: '无效的重连令牌' };
        }

        const player = players[0];

        // 检查令牌是否过期
        if (player.disconnected_at) {
            const disconnectedTime = new Date(player.disconnected_at).getTime();
            const now = Date.now();
            if (now - disconnectedTime > RECONNECT_CONFIG.tokenExpiryMs) {
                return { success: false, message: '重连令牌已过期' };
            }
        }

        return { success: true, player };
    } catch (error) {
        console.error('[房间持久化] 查找玩家失败:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * 房主转让
 */
async function transferHost(roomCode, newHostClientId) {
    try {
        // 获取当前房主
        const currentHosts = await query(
            'SELECT client_id FROM room_players WHERE room_code = ? AND is_host = 1',
            [roomCode]
        );

        // 更新旧房主
        if (currentHosts && currentHosts.length > 0) {
            await execute(
                'UPDATE room_players SET is_host = 0 WHERE room_code = ? AND client_id = ?',
                [roomCode, currentHosts[0].client_id]
            );
        }

        // 设置新房主
        await execute(
            'UPDATE room_players SET is_host = 1 WHERE room_code = ? AND client_id = ?',
            [roomCode, newHostClientId]
        );

        // 更新房间表的房主ID
        await execute(
            'UPDATE rooms SET host_client_id = ? WHERE code = ?',
            [newHostClientId, roomCode]
        );

        return { success: true };
    } catch (error) {
        console.error('[房间持久化] 房主转让失败:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * 获取房间所有玩家
 */
async function getRoomPlayers(roomCode) {
    try {
        const players = await query(
            'SELECT * FROM room_players WHERE room_code = ? ORDER BY seat_index',
            [roomCode]
        );
        return { success: true, players: players || [] };
    } catch (error) {
        console.error('[房间持久化] 获取玩家列表失败:', error.message);
        return { success: false, players: [] };
    }
}

/**
 * 删除房间
 */
async function deleteRoom(roomCode) {
    try {
        // 先删除玩家记录（级联删除会自动处理，但手动删除更明确）
        await execute('DELETE FROM room_players WHERE room_code = ?', [roomCode]);
        await execute('DELETE FROM rooms WHERE code = ?', [roomCode]);
        return { success: true };
    } catch (error) {
        console.error('[房间持久化] 删除房间失败:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * 清理过期房间
 */
async function cleanupExpiredRooms() {
    try {
        // 删除过期的房间
        const result = await execute(
            "DELETE FROM rooms WHERE expires_at < NOW() AND status = 'waiting'"
        );

        if (result.affectedRows > 0) {
            console.log(`[房间持久化] 清理了 ${result.affectedRows} 个过期房间`);
        }

        return { success: true, cleaned: result.affectedRows };
    } catch (error) {
        console.error('[房间持久化] 清理过期房间失败:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * P1 优化：从数据库恢复所有未结束的房间
 */
async function recoverRooms() {
    try {
        // 查询所有未结束的房间（waiting 或 playing 状态）
        const roomsData = await query(
            `SELECT * FROM rooms 
             WHERE status IN ('waiting', 'playing') 
             AND (expires_at IS NULL OR expires_at > NOW())`
        );

        if (!roomsData || roomsData.length === 0) {
            console.log('[房间恢复] 没有需要恢复的房间');
            return { success: true, rooms: [] };
        }

        const recoveredRooms = [];

        for (const roomRow of roomsData) {
            // 获取房间玩家
            const playersData = await query(
                'SELECT * FROM room_players WHERE room_code = ? ORDER BY seat_index',
                [roomRow.code]
            );

            // 构建房间对象
            const room = {
                code: roomRow.code,
                name: roomRow.name,
                isPrivate: roomRow.is_private === 1,
                password: roomRow.password,
                gameMode: roomRow.game_mode || 'classic',
                maxPlayers: roomRow.max_players,
                roundTime: roomRow.round_time,
                status: 'waiting', // 恢复后重置为等待状态
                currentRound: 0,
                currentPainter: null,
                currentWord: null,
                wordCandidates: null,
                refreshLeft: 3,
                players: [],
                spectators: [],
                scores: {},
                guessRankings: [],
                strokeHistory: [],
                lastSnapshot: null,
                hostId: roomRow.host_client_id,
                createdAt: new Date(roomRow.created_at),
                lastActivity: new Date(roomRow.updated_at)
            };

            // 添加玩家
            if (playersData) {
                for (const playerRow of playersData) {
                    const player = {
                        id: null, // socket id 需要重新分配
                        clientId: playerRow.client_id,
                        name: playerRow.nickname,
                        isHost: playerRow.is_host === 1,
                        status: 'offline', // 恢复后标记为离线
                        score: playerRow.score || 0,
                        avatar: playerRow.avatar,
                        seatIndex: playerRow.seat_index,
                        isSpectator: playerRow.is_spectator === 1
                    };

                    if (playerRow.is_spectator === 1) {
                        room.spectators.push(player);
                    } else {
                        room.players.push(player);
                        room.scores[playerRow.client_id] = playerRow.score || 0;
                    }
                }
            }

            recoveredRooms.push(room);
            console.log(`[房间恢复] 房间 ${roomRow.code} 已恢复，玩家数: ${room.players.length}，观战者数: ${room.spectators.length}`);
        }

        return { success: true, rooms: recoveredRooms };
    } catch (error) {
        console.error('[房间恢复] 恢复房间失败:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * 更新房间过期时间
 */
async function updateRoomExpiry(roomCode, expiryMinutes = 30) {
    try {
        await execute(
            'UPDATE rooms SET expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE code = ?',
            [expiryMinutes, roomCode]
        );
        return { success: true };
    } catch (error) {
        console.error('[房间持久化] 更新过期时间失败:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    ROOM_STATUS,
    PLAYER_STATUS,
    RECONNECT_CONFIG,
    generateReconnectToken,
    createRoom,
    updateRoomStatus,
    addPlayerToRoom,
    updatePlayerStatus,
    setPlayerOffline,
    setPlayerOnline,
    findPlayerByReconnectToken,
    transferHost,
    getRoomPlayers,
    deleteRoom,
    cleanupExpiredRooms,
    recoverRooms,
    updateRoomExpiry
};