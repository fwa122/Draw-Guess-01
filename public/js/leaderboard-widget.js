/**
 * 动态排行榜浮动图标管理器
 * 参考 BGM Manager 实现，支持拖拽移动
 */
class LeaderboardWidget {
    constructor() {
        this.widget = null;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.widgetStartX = 0;
        this.widgetStartY = 0;

        // 默认位置（右下角）
        this.defaultX = 20;
        this.defaultY = 100;

        // 边界限制
        this.boundaryPadding = 10;

        this.init();
    }

    init() {
        this.createWidget();
        this.setupEventListeners();
        this.loadPosition();
    }

    createWidget() {
        // 创建容器
        this.widget = document.createElement('div');
        this.widget.className = 'leaderboard-widget';
        this.widget.id = 'leaderboardWidget';

        // 创建HTML结构
        this.widget.innerHTML = `
            <div class="leaderboard-btn-wrapper">
                <button class="leaderboard-icon-btn" id="leaderboardIconBtn" aria-label="排行榜">
                    <div class="leaderboard-btn-face">
                        <!-- 奖杯图标 -->
                        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">
                            <path d="M6 9H4a2 2 0 0 1-2-2V5h4"></path>
                            <path d="M18 9h2a2 2 0 0 0 2-2V5h-4"></path>
                            <path d="M4 5h16v4a6 6 0 0 1-12 0V5z"></path>
                            <path d="M12 15v4"></path>
                            <path d="M8 19h8"></path>
                            <path d="M12 2l1.5 3 3.5.5-2.5 2.5.5 3.5L12 9l-2.5 2 .5-3.5L7.5 5.5l3.5-.5z" fill="currentColor" opacity="0.9"></path>
                        </svg>
                    </div>

                    <!-- 动态光芒 -->
                    <div class="leaderboard-glow">
                        <div class="glow-ray" style="--rotation: 0deg;"></div>
                        <div class="glow-ray" style="--rotation: 60deg;"></div>
                        <div class="glow-ray" style="--rotation: 120deg;"></div>
                        <div class="glow-ray" style="--rotation: 180deg;"></div>
                        <div class="glow-ray" style="--rotation: 240deg;"></div>
                        <div class="glow-ray" style="--rotation: 300deg;"></div>
                    </div>

                    <!-- 闪烁星星 -->
                    <div class="sparkle-star sparkle-1">✦</div>
                    <div class="sparkle-star sparkle-2">✦</div>
                    <div class="sparkle-star sparkle-3">✦</div>

                    <!-- 脉冲光环 -->
                    <div class="leaderboard-pulse"></div>
                </button>

                <!-- 悬浮提示 -->
                <div class="leaderboard-tooltip">查看排行榜</div>
            </div>
        `;

        // 设置初始位置
        this.widget.style.right = `${this.defaultX}px`;
        this.widget.style.bottom = `${this.defaultY}px`;

        // 添加到页面
        document.body.appendChild(this.widget);
    }

    setupEventListeners() {
        // 点击跳转
        const btn = document.getElementById('leaderboardIconBtn');
        btn.addEventListener('click', (e) => {
            // 如果是拖拽，不触发点击
            if (this.isDragging) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // 跳转到排行榜页面
            window.location.href = '/leaderboard.html';
        });

        // 鼠标拖拽
        this.widget.addEventListener('mousedown', (e) => this.startDrag(e));
        document.addEventListener('mousemove', (e) => this.onDrag(e));
        document.addEventListener('mouseup', () => this.endDrag());

        // 触摸拖拽
        this.widget.addEventListener('touchstart', (e) => this.startDrag(e), { passive: false });
        document.addEventListener('touchmove', (e) => this.onDrag(e), { passive: false });
        document.addEventListener('touchend', () => this.endDrag());
    }

    startDrag(e) {
        // 防止默认行为（触摸滚动）
        e.preventDefault();

        this.isDragging = true;
        this.widget.classList.add('dragging');

        // 获取当前触摸/鼠标位置
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        // 记录起始位置
        this.dragStartX = clientX;
        this.dragStartY = clientY;

        // 获取当前widget位置
        const rect = this.widget.getBoundingClientRect();
        this.widgetStartX = rect.left;
        this.widgetStartY = rect.top;

        // 清除right/bottom定位，改用left/top
        this.widget.style.right = 'auto';
        this.widget.style.bottom = 'auto';
        this.widget.style.left = `${this.widgetStartX}px`;
        this.widget.style.top = `${this.widgetStartY}px`;
    }

    onDrag(e) {
        if (!this.isDragging) return;

        e.preventDefault();

        // 获取当前触摸/鼠标位置
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        // 计算位移
        const deltaX = clientX - this.dragStartX;
        const deltaY = clientY - this.dragStartY;

        // 计算新位置
        let newX = this.widgetStartX + deltaX;
        let newY = this.widgetStartY + deltaY;

        // 边界限制
        const widgetRect = this.widget.getBoundingClientRect();
        const maxX = window.innerWidth - widgetRect.width - this.boundaryPadding;
        const maxY = window.innerHeight - widgetRect.height - this.boundaryPadding;

        newX = Math.max(this.boundaryPadding, Math.min(newX, maxX));
        newY = Math.max(this.boundaryPadding, Math.min(newY, maxY));

        // 应用新位置
        this.widget.style.left = `${newX}px`;
        this.widget.style.top = `${newY}px`;
    }

    endDrag() {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.widget.classList.remove('dragging');

        // 保存位置
        this.savePosition();
    }

    savePosition() {
        const rect = this.widget.getBoundingClientRect();
        localStorage.setItem('leaderboard_x', parseInt(rect.left) || this.defaultX);
        localStorage.setItem('leaderboard_y', parseInt(rect.top) || this.defaultY);
    }

    loadPosition() {
        const savedX = localStorage.getItem('leaderboard_x');
        const savedY = localStorage.getItem('leaderboard_y');

        if (savedX !== null && savedY !== null) {
            const x = parseInt(savedX);
            const y = parseInt(savedY);

            // 验证位置是否有效（窗口大小可能变化）
            const maxX = window.innerWidth - 80;
            const maxY = window.innerHeight - 80;

            if (x >= 0 && x <= maxX && y >= 0 && y <= maxY) {
                this.widget.style.left = `${x}px`;
                this.widget.style.top = `${y}px`;
                this.widget.style.right = 'auto';
                this.widget.style.bottom = 'auto';
            }
        }
    }
}

// 全局初始化函数
window.initLeaderboardWidget = function() {
    if (!document.getElementById('leaderboardWidget')) {
        new LeaderboardWidget();
    }
};

// 自动初始化（如果DOM已加载）
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.initLeaderboardWidget();
    });
} else {
    // DOM已加载，延迟初始化以确保其他元素先加载
    setTimeout(() => {
        window.initLeaderboardWidget();
    }, 100);
}