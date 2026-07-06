/**
 * 背景音乐管理器
 * 用于在不同页面控制 BGM 播放、音量和开关
 */
class BGMManager {
    constructor(audioId = 'bgm') {
        this.audio = document.getElementById(audioId);
        this.controlsCreated = false;
        this.isMuted = localStorage.getItem('bgm_muted') === 'true';
        this.volume = parseFloat(localStorage.getItem('bgm_volume')) || 0.5;

        // 拖拽相关属性
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.controlStartX = 0;
        this.controlStartY = 0;

        if (this.audio) {
            this.audio.volume = this.isMuted ? 0 : this.volume;
            this.init();
        }
    }

    init() {
        this.createControls();
        this.setupEventListeners();
        this.setupDragListeners();

        // 处理自动播放限制
        const playBGM = () => {
            if (!this.isMuted) {
                this.audio.play().catch(err => console.log('BGM 自动播放受阻，等待用户交互'));
            }
            document.removeEventListener('click', playBGM);
            document.removeEventListener('touchstart', playBGM);
        };

        document.addEventListener('click', playBGM);
        document.addEventListener('touchstart', playBGM);
    }

    createControls() {
        if (this.controlsCreated) return;

        const controls = document.createElement('div');
        controls.className = 'bgm-controls';
        controls.innerHTML = `
            <div class="volume-slider-container">
                <input type="range" min="0" max="1" step="0.01" value="${this.volume}" class="volume-slider" id="volumeSlider">
            </div>
            <div class="bgm-btn-wrapper">
                <button class="bgm-btn ${this.isMuted ? 'muted' : 'playing'}" id="bgmToggleBtn" title="切换背景音乐">
                    <div class="bgm-btn-face">
                        <svg class="icon-music" viewBox="0 0 24 24" id="musicIcon">
                            <path d="M9 18V5l12-2v13" fill="none" stroke="currentColor"></path>
                            <circle cx="6" cy="18" r="3" fill="none" stroke="currentColor"></circle>
                            <circle cx="18" cy="16" r="3" fill="none" stroke="currentColor"></circle>
                        </svg>
                    </div>
                </button>
                <div class="music-notes">
                    <span class="note note-1">♫</span>
                    <span class="note note-2">♪</span>
                    <span class="note note-3">♫</span>
                </div>
            </div>
        `;

        document.body.appendChild(controls);
        this.controlsCreated = true;
        this.updateButtonUI();
        this.loadPosition();
    }

    setupEventListeners() {
        const toggleBtn = document.getElementById('bgmToggleBtn');
        const slider = document.getElementById('volumeSlider');

        toggleBtn.addEventListener('click', (e) => {
            // 如果是拖拽，不触发点击
            if (this.isDragging) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            this.isMuted = !this.isMuted;
            localStorage.setItem('bgm_muted', this.isMuted);

            if (this.isMuted) {
                this.audio.pause();
                this.audio.volume = 0;
            } else {
                this.audio.volume = this.volume;
                this.audio.play();
            }
            this.updateButtonUI();
        });

        slider.addEventListener('input', (e) => {
            this.volume = parseFloat(e.target.value);
            localStorage.setItem('bgm_volume', this.volume);
            
            if (!this.isMuted) {
                this.audio.volume = this.volume;
                if (this.volume > 0 && this.audio.paused) {
                    this.audio.play();
                }
            }
        });
    }

    updateButtonUI() {
        const btn = document.getElementById('bgmToggleBtn');
        if (!btn) return;

        if (this.isMuted) {
            btn.classList.add('muted');
            btn.classList.remove('playing');
        } else {
            btn.classList.remove('muted');
            btn.classList.add('playing');
        }
    }

    loadPosition() {
        const controls = document.querySelector('.bgm-controls');
        if (!controls) return;

        const savedX = localStorage.getItem('bgm_x');
        const savedY = localStorage.getItem('bgm_y');

        if (savedX !== null && savedY !== null) {
            controls.style.left = savedX + 'px';
            controls.style.top = savedY + 'px';
        } else {
            // 默认位置：右下角
            const btnSize = 60;
            const gap = 15;
            const margin = 25;
            controls.style.right = margin + 'px';
            controls.style.bottom = margin + 'px';
        }
    }

    savePosition() {
        const controls = document.querySelector('.bgm-controls');
        if (!controls) return;

        localStorage.setItem('bgm_x', parseInt(controls.style.left) || 0);
        localStorage.setItem('bgm_y', parseInt(controls.style.top) || 0);
    }

    setupDragListeners() {
        const controls = document.querySelector('.bgm-controls');
        if (!controls) return;

        // 鼠标拖拽
        controls.addEventListener('mousedown', (e) => this.startDrag(e));
        document.addEventListener('mousemove', (e) => this.onDrag(e));
        document.addEventListener('mouseup', () => this.endDrag());

        // 触摸拖拽
        controls.addEventListener('touchstart', (e) => this.startDrag(e), { passive: false });
        document.addEventListener('touchmove', (e) => this.onDrag(e), { passive: false });
        document.addEventListener('touchend', () => this.endDrag());
    }

    startDrag(e) {
        e.preventDefault();
        this.isDragging = false;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        this.dragStartX = clientX;
        this.dragStartY = clientY;

        const controls = document.querySelector('.bgm-controls');
        const rect = controls.getBoundingClientRect();

        // 如果没有 left/top，从当前位置计算
        if (!controls.style.left) {
            controls.style.left = rect.left + 'px';
            controls.style.top = rect.top + 'px';
            controls.style.right = 'auto';
            controls.style.bottom = 'auto';
        }

        this.controlStartX = parseInt(controls.style.left) || rect.left;
        this.controlStartY = parseInt(controls.style.top) || rect.top;
    }

    onDrag(e) {
        if (this.dragStartX === 0 && this.dragStartY === 0) return;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const deltaX = clientX - this.dragStartX;
        const deltaY = clientY - this.dragStartY;

        // 如果移动超过 5px，才算拖拽
        if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
            this.isDragging = true;
            e.preventDefault();

            const controls = document.querySelector('.bgm-controls');
            const rect = controls.getBoundingClientRect();

            // 计算新位置
            let newX = this.controlStartX + deltaX;
            let newY = this.controlStartY + deltaY;

            // 限制在窗口范围内
            newX = Math.max(0, Math.min(newX, window.innerWidth - rect.width));
            newY = Math.max(0, Math.min(newY, window.innerHeight - rect.height));

            controls.style.left = newX + 'px';
            controls.style.top = newY + 'px';
        }
    }

    endDrag() {
        if (this.isDragging) {
            this.savePosition();
        }
        this.dragStartX = 0;
        this.dragStartY = 0;

        // 延迟重置拖拽状态，防止触发点击
        setTimeout(() => {
            this.isDragging = false;
        }, 10);
    }
}

// 导出单例初始化函数
window.initBGM = (audioId) => {
    return new BGMManager(audioId);
};
