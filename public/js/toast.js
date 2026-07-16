/**
 * 通用 Toast 提示组件
 * 支持 success、error、warning、info 四种类型
 */

const Toast = {
    // 默认配置
    config: {
        duration: 3000,      // 默认显示时间
        position: 'top',     // 位置：top, center
        maxCount: 3          // 最大同时显示数量
    },

    // 容器元素
    container: null,

    // 当前显示的 toast 数量
    count: 0,

    /**
     * 初始化容器
     */
    init() {
        if (this.container) return;
        
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        this.container.className = 'toast-container';
        document.body.appendChild(this.container);
    },

    /**
     * 显示 Toast
     * @param {string} message - 消息内容
     * @param {string} type - 类型：success, error, warning, info
     * @param {object} options - 配置选项
     */
    show(message, type = 'info', options = {}) {
        this.init();

        const { duration = this.config.duration } = options;

        // 创建 toast 元素
        const toast = document.createElement('div');
        toast.className = `toast-item toast-${type}`;
        
        // 获取图标
        const icon = this.getIcon(type);
        
        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-content">${this.escapeHtml(message)}</div>
            <button class="toast-close" onclick="Toast.hide(this.parentElement)">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <div class="toast-progress"></div>
        `;

        // 添加到容器
        this.container.appendChild(toast);
        this.count++;

        // 触发动画
        requestAnimationFrame(() => {
            toast.classList.add('toast-show');
        });

        // 进度条动画
        const progress = toast.querySelector('.toast-progress');
        progress.style.animationDuration = `${duration}ms`;
        progress.style.animationName = 'toastProgress';

        // 自动关闭
        const timer = setTimeout(() => {
            this.hide(toast);
        }, duration);

        // 鼠标悬停暂停
        toast.addEventListener('mouseenter', () => {
            progress.style.animationPlayState = 'paused';
            clearTimeout(timer);
        });

        toast.addEventListener('mouseleave', () => {
            progress.style.animationPlayState = 'running';
            const remaining = parseFloat(progress.style.animationDuration) - 
                              (progress.getBoundingClientRect().width / progress.parentElement.getBoundingClientRect().width) * parseFloat(progress.style.animationDuration);
            setTimeout(() => this.hide(toast), remaining);
        });

        // 限制最大数量
        if (this.count > this.config.maxCount) {
            const firstToast = this.container.firstChild;
            if (firstToast) {
                this.hide(firstToast);
            }
        }

        return toast;
    },

    /**
     * 隐藏 Toast
     * @param {HTMLElement} toast - Toast 元素
     */
    hide(toast) {
        if (!toast || !toast.parentElement) return;
        
        toast.classList.remove('toast-show');
        toast.classList.add('toast-hide');
        
        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
                this.count--;
            }
        }, 300);
    },

    /**
     * 成功提示
     */
    success(message, options = {}) {
        return this.show(message, 'success', options);
    },

    /**
     * 错误提示
     */
    error(message, options = {}) {
        return this.show(message, 'error', options);
    },

    /**
     * 警告提示
     */
    warning(message, options = {}) {
        return this.show(message, 'warning', options);
    },

    /**
     * 信息提示
     */
    info(message, options = {}) {
        return this.show(message, 'info', options);
    },

    /**
     * 获取图标
     */
    getIcon(type) {
        const icons = {
            success: `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>`,
            error: `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>`,
            warning: `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>`,
            info: `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>`
        };
        return icons[type] || icons.info;
    },

    /**
     * HTML 转义
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }
};

// 确认弹窗
const Confirm = {
    /**
     * 显示确认弹窗
     * @param {string} message - 消息内容
     * @param {object} options - 配置选项
     * @returns {Promise<boolean>}
     */
    show(message, options = {}) {
        return new Promise((resolve) => {
            const {
                title = '提示',
                confirmText = '确定',
                cancelText = '取消',
                type = 'warning'
            } = options;

            // 创建遮罩
            const overlay = document.createElement('div');
            overlay.className = 'confirm-overlay';
            
            // 获取图标
            const icon = Toast.getIcon(type);
            
            // 创建弹窗
            const popup = document.createElement('div');
            popup.className = 'confirm-popup';
            popup.innerHTML = `
                <div class="confirm-icon confirm-icon-${type}">${icon}</div>
                <div class="confirm-title">${Toast.escapeHtml(title)}</div>
                <div class="confirm-message">${Toast.escapeHtml(message)}</div>
                <div class="confirm-buttons">
                    <button class="confirm-btn confirm-btn-cancel">${Toast.escapeHtml(cancelText)}</button>
                    <button class="confirm-btn confirm-btn-confirm">${Toast.escapeHtml(confirmText)}</button>
                </div>
            `;

            overlay.appendChild(popup);
            document.body.appendChild(overlay);

            // 触发动画
            requestAnimationFrame(() => {
                overlay.classList.add('confirm-show');
            });

            // 关闭函数
            const close = (result) => {
                overlay.classList.remove('confirm-show');
                setTimeout(() => {
                    if (overlay.parentElement) {
                        overlay.parentElement.removeChild(overlay);
                    }
                }, 300);
                resolve(result);
            };

            // 绑定事件
            popup.querySelector('.confirm-btn-cancel').addEventListener('click', () => close(false));
            popup.querySelector('.confirm-btn-confirm').addEventListener('click', () => close(true));
            
            // 点击遮罩关闭
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close(false);
            });

            // ESC 关闭
            const handleEsc = (e) => {
                if (e.key === 'Escape') {
                    close(false);
                    document.removeEventListener('keydown', handleEsc);
                }
            };
            document.addEventListener('keydown', handleEsc);
        });
    },

    /**
     * 删除确认
     */
    async delete(message = '确定要删除吗？') {
        return this.show(message, {
            title: '删除确认',
            type: 'error',
            confirmText: '删除',
            cancelText: '取消'
        });
    },

    /**
     * 警告确认
     */
    async warn(message, title = '警告') {
        return this.show(message, {
            title,
            type: 'warning'
        });
    }
};

// 导出（兼容不同模块系统）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Toast, Confirm };
}