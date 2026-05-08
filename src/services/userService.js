const db = require('../database');

const userService = {
    /**
     * Find or create user
     */
    findOrCreate(telegramUser) {
        const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramUser.id);
        if (existing) return existing;

        const fullName = [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ');
        db.prepare(
            'INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)'
        ).run(telegramUser.id, telegramUser.username || null, fullName);

        return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramUser.id);
    },

    /**
     * Get user by telegram ID
     */
    get(telegramId) {
        return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    },

    /**
     * Update balance
     */
    addBalance(telegramId, amount) {
        db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?').run(amount, telegramId);
    },

    /**
     * Deduct balance
     */
    deductBalance(telegramId, amount) {
        const user = this.get(telegramId);
        if (!user || user.balance < amount) return false;
        db.prepare('UPDATE users SET balance = balance - ? WHERE telegram_id = ?').run(amount, telegramId);
        return true;
    },

    /**
     * Find or create user from Telegram Mini App initData.user payload.
     * The shape matches Telegraf's ctx.from (snake_case keys), so we delegate
     * directly to findOrCreate.
     */
    findOrCreateFromInitData(user) {
        return this.findOrCreate({
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name,
            username: user.username,
        });
    },
};

module.exports = userService;
