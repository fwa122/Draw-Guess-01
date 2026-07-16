CREATE TABLE IF NOT EXISTS users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(64) UNIQUE NOT NULL COMMENT '客户端唯一标识',
    nickname VARCHAR(32) NOT NULL COMMENT '玩家昵称',
    avatar TEXT DEFAULT NULL COMMENT '头像URL或字符',
    email VARCHAR(64) DEFAULT NULL COMMENT '绑定邮箱',
    email_verified TINYINT(1) DEFAULT 0 COMMENT '邮箱是否验证',
    password VARCHAR(255) DEFAULT NULL COMMENT '密码（bcrypt加密）',
    has_password TINYINT(1) DEFAULT 0 COMMENT '是否设置密码',
    total_games INT DEFAULT 0 COMMENT '总游戏次数',
    total_score INT DEFAULT 0 COMMENT '累计总分数',
    best_score INT DEFAULT 0 COMMENT '单局最高分',
    is_blacklisted TINYINT(1) DEFAULT 0 COMMENT '是否在黑名单中',
    blacklist_reason VARCHAR(255) DEFAULT NULL COMMENT '黑名单原因',
    blacklist_time DATETIME DEFAULT NULL COMMENT '加入黑名单时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_client_id (client_id),
    INDEX idx_email (email),
    INDEX idx_email_password (email, has_password),
    INDEX idx_blacklist (is_blacklisted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

CREATE TABLE IF NOT EXISTS blacklist_records (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL COMMENT '用户ID',
    client_id VARCHAR(64) NOT NULL COMMENT '客户端ID',
    nickname VARCHAR(32) NOT NULL COMMENT '玩家昵称',
    reason VARCHAR(255) NOT NULL COMMENT '黑名单原因',
    cheat_count INT DEFAULT 0 COMMENT '作弊次数',
    last_cheat_time DATETIME DEFAULT NULL COMMENT '最后作弊时间',
    game_id BIGINT DEFAULT NULL COMMENT '相关对局ID',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '加入黑名单时间',
    INDEX idx_user_id (user_id),
    INDEX idx_client_id (client_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='黑名单记录表';

CREATE TABLE IF NOT EXISTS cheat_detection (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT DEFAULT NULL COMMENT '用户ID',
    client_id VARCHAR(64) NOT NULL COMMENT '客户端ID',
    room_code VARCHAR(8) NOT NULL COMMENT '房间码',
    answer_time INT DEFAULT 0 COMMENT '答题用时(毫秒)',
    is_correct TINYINT(1) DEFAULT 0 COMMENT '是否正确',
    round_number INT DEFAULT 0 COMMENT '回合数',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
    INDEX idx_client_id (client_id),
    INDEX idx_room_code (room_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='作弊检测记录表';

CREATE TABLE IF NOT EXISTS game_records (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_code VARCHAR(8) NOT NULL COMMENT '房间码',
    room_name VARCHAR(64) NOT NULL COMMENT '房间名称',
    room_password VARCHAR(32) DEFAULT NULL COMMENT '房间密码',
    game_mode VARCHAR(16) DEFAULT 'classic' COMMENT '游戏模式',
    round_time INT DEFAULT 90 COMMENT '每轮时间(秒)',
    total_rounds INT DEFAULT 0 COMMENT '总轮数',
    winner_id BIGINT COMMENT '获胜者用户ID',
    winner_name VARCHAR(32) COMMENT '获胜者昵称',
    winner_score INT DEFAULT 0 COMMENT '获胜者分数',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
    ended_at DATETIME DEFAULT NULL COMMENT '结束时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
    INDEX idx_room_code (room_code),
    INDEX idx_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对局记录表';

CREATE TABLE IF NOT EXISTS game_players (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    game_id BIGINT NOT NULL COMMENT '对局记录ID',
    user_id BIGINT DEFAULT NULL COMMENT '用户ID',
    client_id VARCHAR(64) NOT NULL COMMENT '客户端ID',
    nickname VARCHAR(32) NOT NULL COMMENT '玩家昵称',
    avatar TEXT DEFAULT NULL COMMENT '头像',
    is_host TINYINT(1) DEFAULT 0 COMMENT '是否房主',
    score INT DEFAULT 0 COMMENT '本局得分',
    `rank` INT DEFAULT 0 COMMENT '本局排名',
    is_winner TINYINT(1) DEFAULT 0 COMMENT '是否获胜',
    INDEX idx_game_id (game_id),
    INDEX idx_user_id (user_id),
    FOREIGN KEY (game_id) REFERENCES game_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对局玩家表';

CREATE TABLE IF NOT EXISTS leaderboard (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL COMMENT '用户ID',
    nickname VARCHAR(32) NOT NULL COMMENT '玩家昵称',
    avatar TEXT DEFAULT NULL COMMENT '头像',
    total_games INT DEFAULT 0 COMMENT '总游戏次数',
    total_score INT DEFAULT 0 COMMENT '累计分数',
    `rank` INT DEFAULT 0 COMMENT '当前排名',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_total_score (total_score DESC),
    INDEX idx_rank (`rank`),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='排行榜表';

-- ===== P0 优化：房间持久化表 =====

CREATE TABLE IF NOT EXISTS rooms (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(8) UNIQUE NOT NULL COMMENT '房间码',
    name VARCHAR(64) NOT NULL COMMENT '房间名称',
    host_client_id VARCHAR(64) COMMENT '房主客户端ID',
    is_private TINYINT(1) DEFAULT 0 COMMENT '是否私密房间',
    password VARCHAR(64) COMMENT '房间密码',
    game_mode VARCHAR(16) DEFAULT 'classic' COMMENT '游戏模式',
    max_players INT DEFAULT 6 COMMENT '最大玩家数',
    round_time INT DEFAULT 90 COMMENT '每轮时间(秒)',
    status VARCHAR(16) DEFAULT 'waiting' COMMENT '房间状态: waiting, playing, finished',
    current_round INT DEFAULT 0 COMMENT '当前回合',
    current_painter_client_id VARCHAR(64) COMMENT '当前绘画者客户端ID',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    expires_at DATETIME COMMENT '房间过期时间（用于清理）',
    INDEX idx_code (code),
    INDEX idx_status (status),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='房间表';

CREATE TABLE IF NOT EXISTS room_players (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_code VARCHAR(8) NOT NULL COMMENT '房间码',
    client_id VARCHAR(64) NOT NULL COMMENT '客户端ID',
    nickname VARCHAR(32) NOT NULL COMMENT '玩家昵称',
    avatar TEXT COMMENT '头像',
    is_host TINYINT(1) DEFAULT 0 COMMENT '是否房主',
    is_online TINYINT(1) DEFAULT 1 COMMENT '是否在线',
    is_spectator TINYINT(1) DEFAULT 0 COMMENT '是否观战者',
    score INT DEFAULT 0 COMMENT '当前分数',
    status VARCHAR(16) DEFAULT 'waiting' COMMENT '玩家状态: waiting, ready, playing, offline',
    seat_index INT DEFAULT 0 COMMENT '座位索引',
    disconnected_at DATETIME COMMENT '断开时间',
    reconnect_token VARCHAR(64) COMMENT '重连令牌',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_room_client (room_code, client_id),
    INDEX idx_room_code (room_code),
    INDEX idx_client_id (client_id),
    INDEX idx_reconnect (reconnect_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='房间玩家表';

-- ===== 五子棋游戏表 =====

CREATE TABLE IF NOT EXISTS gobang_records (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_code VARCHAR(8) NOT NULL COMMENT '房间码',
    winner_client_id VARCHAR(64) COMMENT '获胜者客户端ID',
    winner_color VARCHAR(8) COMMENT '获胜方颜色: black/white',
    total_moves INT DEFAULT 0 COMMENT '总手数',
    duration INT DEFAULT 0 COMMENT '对局时长(秒)',
    board_snapshot TEXT COMMENT '棋盘快照(JSON)',
    move_history TEXT COMMENT '落子历史(JSON)',
    status VARCHAR(16) DEFAULT 'finished' COMMENT '对局状态',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_room_code (room_code),
    INDEX idx_winner (winner_client_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='五子棋对局记录表';

CREATE TABLE IF NOT EXISTS gobang_players (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    game_id BIGINT NOT NULL COMMENT '对局ID',
    client_id VARCHAR(64) NOT NULL COMMENT '客户端ID',
    nickname VARCHAR(32) NOT NULL COMMENT '玩家昵称',
    avatar TEXT COMMENT '头像',
    color VARCHAR(8) NOT NULL COMMENT '执子颜色: black/white',
    is_winner TINYINT(1) DEFAULT 0 COMMENT '是否获胜',
    move_count INT DEFAULT 0 COMMENT '落子数',
    time_used INT DEFAULT 0 COMMENT '用时(秒)',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_game_id (game_id),
    INDEX idx_client_id (client_id),
    FOREIGN KEY (game_id) REFERENCES gobang_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='五子棋对局玩家表';

CREATE TABLE IF NOT EXISTS gobang_leaderboard (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL COMMENT '用户ID',
    client_id VARCHAR(64) NOT NULL COMMENT '客户端ID',
    nickname VARCHAR(32) NOT NULL COMMENT '玩家昵称',
    avatar TEXT COMMENT '头像',
    total_games INT DEFAULT 0 COMMENT '总对局数',
    wins INT DEFAULT 0 COMMENT '胜场数',
    losses INT DEFAULT 0 COMMENT '负场数',
    draws INT DEFAULT 0 COMMENT '平局数',
    win_rate DECIMAL(5,2) DEFAULT 0 COMMENT '胜率',
    total_moves INT DEFAULT 0 COMMENT '总落子数',
    avg_moves DECIMAL(6,2) DEFAULT 0 COMMENT '平均落子数',
    rating INT DEFAULT 1000 COMMENT '积分(类似ELO)',
    `rank` INT DEFAULT 0 COMMENT '排名',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_wins (wins DESC),
    INDEX idx_rating (rating DESC),
    INDEX idx_rank (`rank`),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='五子棋排行榜表';