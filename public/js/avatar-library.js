// ===== 头像库 - 30个SVG头像 =====

const avatarLibrary = [
    // 动物主题
    { id: 'cat', svg: '<svg viewBox="0 0 24 24" stroke="#8b5cf6"><path d="M12 5c-1.5 0-3 .5-4 1.5l-3-3v6l3-3c1 .5 2 1 4 1s3-.5 4-1l3 3v-6l-3 3c-1-1-2.5-1.5-4-1.5z"></path><circle cx="9" cy="13" r="1"></circle><circle cx="15" cy="13" r="1"></circle><path d="M9 17c1 1 2 1 3 1s2 0 3-1"></path></svg>' },
    { id: 'dog', svg: '<svg viewBox="0 0 24 24" stroke="#ec4899"><path d="M10 5v3l-5-5v7l5 5v4h4v-4l5-5v-7l-5 5v-3"></path><circle cx="9" cy="14" r="1"></circle><circle cx="15" cy="14" r="1"></circle><ellipse cx="12" cy="17" rx="2" ry="1"></ellipse></svg>' },
    { id: 'bird', svg: '<svg viewBox="0 0 24 24" stroke="#14b8a6"><path d="M16 7h-3l-5 6-5-4-3 3v3l5 5h8l4-7v-2l-1-1z"></path><circle cx="14" cy="10" r="1"></circle><path d="M4 16l3-1"></path></svg>' },
    { id: 'fish', svg: '<svg viewBox="0 0 24 24" stroke="#3b82f6"><ellipse cx="12" cy="12" rx="6" ry="4"></ellipse><path d="M18 12l4-3v6l-4-3"></path><circle cx="9" cy="11" r="1"></circle><path d="M6 12c0-1 1-2 2-2"></path></svg>' },
    { id: 'rabbit', svg: '<svg viewBox="0 0 24 24" stroke="#f59e0b"><path d="M18 8l-2 2v8h-8v-8l-2-2"></path><path d="M6 8v-4c0-1 1-2 2-2h2c1 0 2 1 2 2v4"></path><circle cx="10" cy="14" r="1"></circle><circle cx="14" cy="14" r="1"></circle><ellipse cx="12" cy="17" rx="1" ry="1.5"></ellipse></svg>' },
    { id: 'panda', svg: '<svg viewBox="0 0 24 24" stroke="#1f2937"><circle cx="12" cy="12" r="8"></circle><circle cx="7" cy="10" r="2" fill="#1f2937"></circle><circle cx="17" cy="10" r="2" fill="#1f2937"></circle><circle cx="10" cy="13" r="1"></circle><circle cx="14" cy="13" r="1"></circle><ellipse cx="12" cy="16" rx="2" ry="1" fill="#1f2937"></ellipse></svg>' },
    { id: 'fox', svg: '<svg viewBox="0 0 24 24" stroke="#f97316"><path d="M12 4l-6 6v8l6 4 6-4v-8l-6-6z"></path><path d="M6 10l-4-6v4l4 2"></path><path d="M18 10l4-6v4l-4 2"></path><circle cx="9" cy="12" r="1"></circle><circle cx="15" cy="12" r="1"></circle><ellipse cx="12" cy="16" rx="2" ry="1"></ellipse></svg>' },
    { id: 'lion', svg: '<svg viewBox="0 0 24 24" stroke="#eab308"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="14" r="4"></circle><circle cx="10" cy="13" r="1"></circle><circle cx="14" cy="13" r="1"></circle><ellipse cx="12" cy="16" rx="1.5" ry="0.5"></ellipse></svg>' },

    // 表情主题
    { id: 'happy', svg: '<svg viewBox="0 0 24 24" stroke="#22c55e"><circle cx="12" cy="12" r="9"></circle><circle cx="9" cy="10" r="1.5" fill="#22c55e"></circle><circle cx="15" cy="10" r="1.5" fill="#22c55e"></circle><path d="M8 14c1.5 2 4 3 4 3s2.5-1 4-3"></path></svg>' },
    { id: 'cool', svg: '<svg viewBox="0 0 24 24" stroke="#3b82f6"><circle cx="12" cy="12" r="9"></circle><path d="M4 10h6c1 0 2 1 2 2s-1 2-2 2h-6"></path><path d="M14 10h6c1 0 2 1 2 2s-1 2-2 2h-6"></path><path d="M9 15c1.5 1.5 3 2 3 2s1.5-.5 3-2"></path></svg>' },
    { id: 'love', svg: '<svg viewBox="0 0 24 24" stroke="#ec4899"><circle cx="12" cy="12" r="9"></circle><circle cx="9" cy="10" r="2" fill="#ec4899"></circle><circle cx="15" cy="10" r="2" fill="#ec4899"></circle><path d="M9 15c1 2 3 2.5 3 2.5s2-.5 3-2.5"></path></svg>' },
    { id: 'think', svg: '<svg viewBox="0 0 24 24" stroke="#8b5cf6"><circle cx="12" cy="12" r="9"></circle><circle cx="9" cy="10" r="1.5" fill="#8b5cf6"></circle><circle cx="15" cy="10" r="1.5" fill="#8b5cf6"></circle><path d="M9 16c1-1 2-1.5 3-1.5s2 .5 3 1.5"></path></svg>' },
    { id: 'wink', svg: '<svg viewBox="0 0 24 24" stroke="#f59e0b"><circle cx="12" cy="12" r="9"></circle><circle cx="9" cy="10" r="1.5" fill="#f59e0b"></circle><path d="M15 10c0 1-1 1.5-1.5 1.5s-1.5-.5-1.5-1.5"></path><path d="M8 14c1 1.5 2.5 2 4 2s3-.5 4-2"></path></svg>' },
    { id: 'sad', svg: '<svg viewBox="0 0 24 24" stroke="#ef4444"><circle cx="12" cy="12" r="9"></circle><circle cx="9" cy="10" r="1.5" fill="#ef4444"></circle><circle cx="15" cy="10" r="1.5" fill="#ef4444"></circle><path d="M9 16c1.5-1 3-1.5 3-1.5s1.5.5 3 1.5"></path></svg>' },

    // 物品主题
    { id: 'star', svg: '<svg viewBox="0 0 24 24" stroke="#fbbf24"><polygon points="12,2 15,9 22,9 17,14 19,22 12,18 5,22 7,14 2,9 9,9" fill="none"></polygon></svg>' },
    { id: 'heart', svg: '<svg viewBox="0 0 24 24" stroke="#ec4899"><path d="M12 21c-5-4.5-9-8-9-12C3 6.5 5.5 4 8 4c1.5 0 3 .5 4 2 1-1.5 2.5-2 4-2 2.5 0 5 2.5 5 5 0 4-4 7.5-9 12z" fill="none"></path></svg>' },
    { id: 'moon', svg: '<svg viewBox="0 0 24 24" stroke="#6366f1"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="none"></path></svg>' },
    { id: 'sun', svg: '<svg viewBox="0 0 24 24" stroke="#f97316"><circle cx="12" cy="12" r="5" fill="none"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>' },
    { id: 'flower', svg: '<svg viewBox="0 0 24 24" stroke="#ec4899"><circle cx="12" cy="12" r="3"></circle><circle cx="12" cy="6" r="2"></circle><circle cx="12" cy="18" r="2"></circle><circle cx="6" cy="12" r="2"></circle><circle cx="18" cy="12" r="2"></circle><path d="M12 9v-3M12 15v3M9 12h-3M15 12h3"></path></svg>' },
    { id: 'cloud', svg: '<svg viewBox="0 0 24 24" stroke="#94a3b8"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="none"></path></svg>' },
    { id: 'diamond', svg: '<svg viewBox="0 0 24 24" stroke="#8b5cf6"><polygon points="12,2 22,12 12,22 2,12" fill="none"></polygon><line x1="12" y1="2" x2="12" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg>' },
    { id: 'music', svg: '<svg viewBox="0 0 24 24" stroke="#3b82f6"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3" fill="none"></circle><circle cx="18" cy="16" r="3" fill="none"></circle></svg>' },

    // 人物主题
    { id: 'user1', svg: '<svg viewBox="0 0 24 24" stroke="#8b5cf6"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>' },
    { id: 'user2', svg: '<svg viewBox="0 0 24 24" stroke="#ec4899"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle><path d="M12 11v4M10 13h4"></path></svg>' },
    { id: 'user3', svg: '<svg viewBox="0 0 24 24" stroke="#14b8a6"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle><path d="M9 9l3 3 3-3"></path></svg>' },
    { id: 'user4', svg: '<svg viewBox="0 0 24 24" stroke="#f59e0b"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle><circle cx="12" cy="5" r="1"></circle></svg>' },

    // 其他主题
    { id: 'rocket', svg: '<svg viewBox="0 0 24 24" stroke="#ef4444"><path d="M4.5 16.5c-1.5 1.5-3 3-3 5.5h5.5c0-2.5 1.5-4 3-5.5l6-6c2-2 4-3.5 6.5-4l1-4-4 1c-.5 2.5-2 4.5-4 6.5l-6 6z" fill="none"></path><path d="M9 17l-2 2"></path></svg>' },
    { id: 'coffee', svg: '<svg viewBox="0 0 24 24" stroke="#78350f"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>' },
    { id: 'book', svg: '<svg viewBox="0 0 24 24" stroke="#3b82f6"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" fill="none"></path></svg>' },
    { id: 'camera', svg: '<svg viewBox="0 0 24 24" stroke="#8b5cf6"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="none"></path><circle cx="12" cy="13" r="4"></circle></svg>' },
    { id: 'gamepad', svg: '<svg viewBox="0 0 24 24" stroke="#6366f1"><rect x="2" y="6" width="20" height="12" rx="2" fill="none"></rect><line x1="6" y1="12" x2="6" y2="12"></line><line x1="10" y1="12" x2="10" y2="12"></line><circle cx="17" cy="12" r="1"></circle><path d="M6 9v6M9 12h6"></path></svg>' },
    { id: 'pizza', svg: '<svg viewBox="0 0 24 24" stroke="#f97316"><path d="M12 2L2 19h20L12 2z" fill="none"></path><circle cx="7" cy="15" r="1.5" fill="#f97316"></circle><circle cx="11" cy="12" r="1.5" fill="#f97316"></circle><circle cx="15" cy="15" r="1.5" fill="#f97316"></circle><circle cx="12" cy="17" r="1" fill="#f97316"></circle></svg>' },
    { id: 'icecream', svg: '<svg viewBox="0 0 24 24" stroke="#ec4899"><path d="M12 2c-3 0-6 2-6 5v2h12V7c0-3-3-5-6-5z" fill="none"></path><path d="M6 9l6 15 6-15"></path><line x1="12" y1="24" x2="12" y2="24"></line></svg>' },
    { id: 'planet', svg: '<svg viewBox="0 0 24 24" stroke="#3b82f6"><circle cx="12" cy="12" r="6"></circle><ellipse cx="12" cy="12" rx="10" ry="3" fill="none" stroke-width="1"></ellipse></svg>' }
];

// ===== 随机分配头像 =====
function getRandomAvatar() {
    const randomIndex = Math.floor(Math.random() * avatarLibrary.length);
    return avatarLibrary[randomIndex];
}

// 导出
window.avatarLibrary = avatarLibrary;
window.getRandomAvatar = getRandomAvatar;