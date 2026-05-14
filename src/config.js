require('dotenv').config();

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    ADMIN_ID: parseInt(process.env.ADMIN_ID) || 0,

    // Optional channel/group ID where muted admin notifications get forwarded
    // for audit. Leave empty/unset to drop muted events entirely.
    BOT_NOISE_CHAT_ID: process.env.BOT_NOISE_CHAT_ID
      ? (parseInt(process.env.BOT_NOISE_CHAT_ID) || process.env.BOT_NOISE_CHAT_ID)
      : null,

    // Bank config for VietQR
    BANK: {
        BIN: process.env.BANK_BIN || '970422',
        ACCOUNT: process.env.BANK_ACCOUNT || '',
        ACCOUNT_NAME: process.env.BANK_ACCOUNT_NAME || '',
        NAME: process.env.BANK_NAME || 'MB',
    },

    BANK2: process.env.BANK2_ACCOUNT ? {
        BIN: process.env.BANK2_BIN || '970436',
        ACCOUNT: process.env.BANK2_ACCOUNT,
        ACCOUNT_NAME: process.env.BANK2_ACCOUNT_NAME || '',
        NAME: process.env.BANK2_NAME || 'VCB',
    } : null,

    // API Server
    API_PORT: parseInt(process.env.API_PORT) || 3000,
    WEB_URL: process.env.WEB_URL || 'http://localhost:3001',

    // MBBank API (auto-payment)
    MBBANK_API_URL: process.env.MBBANK_API_URL || 'http://localhost:8000',
    MBBANK_API_TOKEN: process.env.MBBANK_API_TOKEN || '',
    PAYMENT_POLL_INTERVAL: parseInt(process.env.PAYMENT_POLL_INTERVAL) || 15000,
    PAYMENT_POLL_ENABLED: process.env.PAYMENT_POLL_ENABLED === 'true',

    // Auth
    JWT_SECRET: process.env.JWT_SECRET || '',
    ADMIN_INITIAL_PASSWORD: process.env.ADMIN_INITIAL_PASSWORD || '',

    // Encryption (AES-256-GCM, 32 bytes / 64 hex chars)
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',

    // Shop
    SHOP_NAME: process.env.SHOP_NAME || 'Taikhoantenhat',
    SUPPORT_CONTACT: process.env.SUPPORT_CONTACT || '@taikhoantenhat_support',
    BRAND_NAME: 'Taikhoantenhat',
    BRAND_TAGLINE: 'Cửa hàng tài khoản số',

    // Feature flags (sub-project D)
    FEATURE_TOPUPS: process.env.FEATURE_TOPUPS === 'true',
    FEATURE_BROADCAST: process.env.FEATURE_BROADCAST === 'true',
    FEATURE_TELEGRAM_NOTIFY: process.env.FEATURE_TELEGRAM_NOTIFY || 'order_only',
};
