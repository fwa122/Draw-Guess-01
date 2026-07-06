const fs = require('fs');
const path = require('path');

/**
 * WordBank
 * 负责所有与词汇库相关的操作：加载、校验、查询、随机抽取等。
 * 默认在模块加载时读取 server/data/default-words.json。
 */
class WordBank {
    constructor() {
        this.packs = new Map();
        this.defaultPackId = 'default';

        const defaultPath = path.join(__dirname, '../data/default-words.json');
        this.loadPack(this.defaultPackId, defaultPath);
    }

    /**
     * 从本地文件加载一个词包
     * @param {string} id 词包唯一标识
     * @param {string} filePath 文件绝对路径
     */
    loadPack(id, filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`词库文件不存在: ${filePath}`);
        }

        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        this.validatePack(data);

        this.packs.set(id, {
            ...data,
            id
        });
    }

    /**
     * 从 JSON 字符串导入一个词包（预留用于后续用户上传）
     * @param {string} id 词包唯一标识
     * @param {string} jsonString 词库 JSON 字符串
     */
    importPack(id, jsonString) {
        const data = JSON.parse(jsonString);
        this.validatePack(data);

        this.packs.set(id, {
            ...data,
            id
        });

        return {
            id,
            name: data.name,
            categoryCount: data.categories.length,
            wordCount: this.countWords(data)
        };
    }

    /**
     * 校验词包结构是否合法
     * @param {object} data
     */
    validatePack(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('词包数据必须是对象');
        }
        if (!data.name || typeof data.name !== 'string') {
            throw new Error('词包缺少 name 字段');
        }
        if (!Array.isArray(data.categories)) {
            throw new Error('词包缺少 categories 数组');
        }
        if (data.categories.length === 0) {
            throw new Error('词包 categories 不能为空');
        }

        data.categories.forEach((cat, index) => {
            if (!cat.name || typeof cat.name !== 'string') {
                throw new Error(`第 ${index + 1} 个分类缺少 name 字段`);
            }
            if (!Array.isArray(cat.words) || cat.words.length === 0) {
                throw new Error(`分类 "${cat.name}" 的 words 为空或格式错误`);
            }
            cat.words.forEach((item, wIndex) => {
                const word = typeof item === 'string' ? item : item.word;
                if (!word || typeof word !== 'string') {
                    throw new Error(`分类 "${cat.name}" 第 ${wIndex + 1} 个词汇无效`);
                }
            });
        });
    }

    /**
     * 统计词包总词数
     * @param {object} data
     */
    countWords(data) {
        return data.categories.reduce((sum, cat) => sum + cat.words.length, 0);
    }

    /**
     * 获取词包，不存在则返回默认词包
     * @param {string} packId
     */
    getPack(packId) {
        return this.packs.get(packId) || this.packs.get(this.defaultPackId);
    }

    /**
     * 随机抽取一个词
     * @param {string} packId 词包 id，默认使用 default
     * @param {string} [categoryName] 指定分类，不指定则随机分类
     * @returns {{ word: string, hint?: string, category: string }}
     */
    getRandomWord(packId = this.defaultPackId, categoryName) {
        const pack = this.getPack(packId);
        let categories = pack.categories;

        if (categoryName) {
            categories = categories.filter(c => c.name === categoryName);
            if (categories.length === 0) {
                categories = pack.categories;
            }
        }

        const category = categories[Math.floor(Math.random() * categories.length)];
        const item = category.words[Math.floor(Math.random() * category.words.length)];
        const isString = typeof item === 'string';

        return {
            word: isString ? item : item.word,
            hint: isString ? undefined : item.hint,
            category: category.name
        };
    }

    /**
     * 获取指定分类下的所有词汇（字符串数组）
     * @param {string} categoryName
     * @param {string} packId
     */
    getWordsByCategory(categoryName, packId = this.defaultPackId) {
        const pack = this.getPack(packId);
        const category = pack.categories.find(c => c.name === categoryName);
        if (!category) return [];

        return category.words.map(item =>
            typeof item === 'string' ? item : item.word
        );
    }

    /**
     * 获取所有分类名称
     * @param {string} packId
     */
    getAllCategories(packId = this.defaultPackId) {
        const pack = this.getPack(packId);
        return pack.categories.map(c => c.name);
    }

    /**
     * 列出当前已加载的所有词包
     */
    listPacks() {
        return Array.from(this.packs.values()).map(pack => ({
            id: pack.id,
            name: pack.name,
            version: pack.version,
            categoryCount: pack.categories.length,
            wordCount: this.countWords(pack)
        }));
    }
}

module.exports = new WordBank();
