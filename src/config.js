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
    ADMIN_TOKEN_EXPIRY: process.env.ADMIN_TOKEN_EXPIRY || '30d',
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

    TWOFA_INTERNAL_URL: process.env.TWOFA_INTERNAL_URL || '',
    TWOFA_TMA_SHARED_SECRET: process.env.TWOFA_TMA_SHARED_SECRET || '',
    TWOFA_SYNC_INTERVAL_MS: parseInt(process.env.TWOFA_SYNC_INTERVAL_MS, 10) || 60000,
    TWOFA_WEBHOOK_TIMEOUT_SECONDS: Math.max(
      1,
      parseInt(process.env.TWOFA_WEBHOOK_TIMEOUT_SECONDS, 10) || 10,
    ),

    // RAG-chat-bot integration (separate secret from TWOFA_TMA_SHARED_SECRET)
    RAG_INTEGRATION_SECRET: process.env.RAG_INTEGRATION_SECRET || '',

    // Forward inbound Telegram text to RAG-chat-bot until an operator
    // explicitly opts in for this deployment.
    RAG_BOT_FORWARD_ENABLED: process.env.RAG_BOT_FORWARD_ENABLED === 'true',
    RAG_BOT_INBOUND_URL: process.env.RAG_BOT_INBOUND_URL || 'http://localhost:3100/telegram/inbound',
    RAG_BOT_FORWARD_TIMEOUT_SECONDS: Math.max(
      1,
      parseInt(process.env.RAG_BOT_FORWARD_TIMEOUT_SECONDS, 10) || 10,
    ),

    // Forward Telegram Business messages (customer -> connected personal
    // account) to RAG-chat-bot. Independent from RAG_BOT_FORWARD_ENABLED,
    // which gates direct messages to this bot itself — a separate channel.
    RAG_BUSINESS_FORWARD_ENABLED: process.env.RAG_BUSINESS_FORWARD_ENABLED === 'true',

    // Customers often split one thought across several rapid messages;
    // businessForward.js buffers them per chat and forwards once as a
    // combined turn after this many quiet ms.
    RAG_BUSINESS_DEBOUNCE_MS: Math.max(
      0,
      parseInt(process.env.RAG_BUSINESS_DEBOUNCE_MS, 10) || 4000,
    ),

    // Called once a RAG-created order (source ending "_rag") is delivered —
    // RAG owns notifying that customer instead of this service's own bot,
    // since RAG knows the actual channel/conversation the order came from.
    RAG_ORDERS_DELIVERED_URL: process.env.RAG_ORDERS_DELIVERED_URL || 'http://localhost:3100/orders/delivered',

    // nfshop (Netflix cookies fulfilment) integration API. Remote host: use the real https URL.
    NFSHOP_API_URL: process.env.NFSHOP_API_URL || '',
    NFSHOP_API_KEY: process.env.NFSHOP_API_KEY || '',
    NFSHOP_TIMEOUT_MS: Math.max(1000, parseInt(process.env.NFSHOP_TIMEOUT_MS, 10) || 10000),
};
