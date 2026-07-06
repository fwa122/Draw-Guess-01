// ===== 客户端状态机 =====
// 用于校验当前页面与房间状态是否匹配，非法时自动修正跳转

const GameState = {
    STATUS: {
        WAITING: 'waiting',
        PLAYING: 'playing',
        FINISHED: 'finished'
    },

    /**
     * 校验当前页面是否应该停留在此页
     * @param {Object} room - 房间数据
     * @param {string} currentPlayerId - 当前玩家 socket id
     * @param {string} currentPage - 当前页面标识：'room-lobby' | 'painter' | 'guesser'
     * @returns {Object} { valid: boolean, redirect?: string }
     */
    validatePage(room, currentPlayerId, currentPage) {
        if (!room || !room.status) {
            return { valid: false, redirect: 'lobby.html' };
        }

        const status = room.status;
        const painterId = room.currentPainter;

        // 房间页：只应在等待或结束状态
        if (currentPage === 'room-lobby') {
            if (status === this.STATUS.PLAYING) {
                const target = currentPlayerId === painterId ? 'painter.html' : 'guesser.html';
                return { valid: false, redirect: target };
            }
            return { valid: true };
        }

        // 绘画页：只应在游戏中且当前玩家是绘画者
        if (currentPage === 'painter') {
            if (status === this.STATUS.WAITING || status === this.STATUS.FINISHED) {
                return { valid: false, redirect: 'room-lobby.html' };
            }
            if (status === this.STATUS.PLAYING && currentPlayerId !== painterId) {
                return { valid: false, redirect: 'guesser.html' };
            }
            return { valid: true };
        }

        // 竞猜页：只应在游戏中且当前玩家不是绘画者
        if (currentPage === 'guesser') {
            if (status === this.STATUS.WAITING || status === this.STATUS.FINISHED) {
                return { valid: false, redirect: 'room-lobby.html' };
            }
            if (status === this.STATUS.PLAYING && currentPlayerId === painterId) {
                return { valid: false, redirect: 'painter.html' };
            }
            return { valid: true };
        }

        return { valid: true };
    },

    /**
     * 执行状态校验并自动跳转
     * @param {Object} room
     * @param {string} currentPlayerId
     * @param {string} currentPage
     * @param {Object} urlParams - 需要透传到目标页的参数
     */
    enforce(room, currentPlayerId, currentPage, urlParams = {}) {
        const result = this.validatePage(room, currentPlayerId, currentPage);
        if (!result.valid) {
            const params = new URLSearchParams(urlParams).toString();
            const url = params ? `${result.redirect}?${params}` : result.redirect;
            window.location.replace(url);
            return false;
        }
        return true;
    }
};
