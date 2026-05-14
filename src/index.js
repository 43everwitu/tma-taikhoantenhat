const config = require('./config');
const db = require('./database');
const express = require('express');
const helmet = require('helmet');
const path = require('node:path');
const { createBot } = require('./bot');

// ============================================================
// 1. Express API Server
// ============================================================
const app = express();

// Trust the first hop in front of us (Next.js dev rewrite proxy in dev,
// Cloudflare Tunnel / nginx in prod). Required so express-rate-limit can
// read the real client IP from X-Forwarded-For instead of throwing
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR. Tighten to specific IP ranges in
// production once the front-end IP set is known.
app.set('trust proxy', 1);

// Security headers. CSP keeps things tight while allowing the Telegram Mini
// App SDK script + framing from web.telegram.org / t.me. Static /uploads is
// served below — image rendering depends on default img-src 'self'.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'", 'https://telegram.org'],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'connect-src': ["'self'", 'https://telegram.org', 'https:'],
      'frame-ancestors': ["'self'", 'https://web.telegram.org', 'https://t.me'],
      'object-src': ["'none'"],
    },
  },
  // Cloudflare Tunnel handles TLS; let HSTS live there.
  hsts: false,
  // Allow cross-origin embedding of /uploads images from TMA.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Static uploads (product images, etc.) served with long-lived cache.
app.use('/uploads', express.static(path.resolve(__dirname, '..', 'data', 'uploads'), {
  maxAge: '30d',
  immutable: true,
  fallthrough: false,
}));

// API routes
const { createApiRouter } = require('./api/server');
app.use('/api/v1', createApiRouter());

// ============================================================
// 2. Telegram Bot
// ============================================================
const bot = createBot();

// ============================================================
// 3. Payment Poller (lazy-loaded, event-driven)
// ============================================================
let paymentPoller = null;

function getPaymentPoller() {
  if (!paymentPoller) {
    const { PaymentPoller } = require('./services/paymentPoller');
    paymentPoller = new PaymentPoller(db, bot);
    // Attach singleton to bot so handlers can access it
    bot._paymentPoller = paymentPoller;
  }
  return paymentPoller;
}

// Make services accessible to routes via app.locals and app.get/set
app.locals.getPaymentPoller = getPaymentPoller;
app.locals.bot = bot;
app.set('bot', bot);

// ============================================================
// Start everything
// ============================================================
async function start() {
  // Start Express
  const port = config.API_PORT;
  app.listen(port, () => {
    console.log(`🌐 API Server running on port ${port}`);
  });

  // Start Telegram bot — fire-and-forget. `bot.launch()` returns a Promise that
  // only resolves on stop (long-polling), so awaiting it blocks all subsequent
  // setup. Catch retry conflicts (409 from old long-poll session under
  // node --watch) without crashing the process.
  bot.launch().catch((err) => {
    console.error('⚠️ Bot launch error:', err.message || err);
  });
  console.log(`🤖 ${config.SHOP_NAME} Bot đã khởi động!`);
  console.log(`👤 Admin ID: ${config.ADMIN_ID}`);
  console.log(`🏦 Bank: ${config.BANK.NAME} - ${config.BANK.ACCOUNT}`);

  // Sync the chat menu button to MINIAPP_URL so /env is single source of truth.
  // Otherwise BotFather's stored URL (set manually once) goes stale every time
  // the tunnel host changes, leaving the in-Telegram WebApp blank.
  const miniappUrl = (process.env.MINIAPP_URL || '').replace(/\/$/, '');
  if (miniappUrl) {
    try {
      await bot.telegram.setChatMenuButton({
        menuButton: { type: 'web_app', text: 'Mở shop', web_app: { url: miniappUrl } },
      });
      console.log(`🔘 Menu button → ${miniappUrl}`);
    } catch (err) {
      console.error('⚠️ Failed to set menu button:', err.message || err);
    }
  }

  // Seed initial admin account
  const authService = require('./services/authService');
  await authService.seedAdmin();

  // Wire admin notification dispatcher to the bot instance
  require('./services/adminNotifyService').init(bot);
  require('./services/orderChannelService').init(bot);
  require('./services/keyExpiryReminderService').start(bot);
  console.log('⏰ Key expiry reminder armed (daily 09:00 ICT)');

  // Initialize notification service
  const { NotificationService } = require('./services/notificationService');
  const notificationService = new NotificationService(bot);
  app.locals.notificationService = notificationService;
  notificationService.startLowStockMonitor();

  // Initialize payment poller singleton (so bot handlers can access it)
  if (config.PAYMENT_POLL_ENABLED && config.MBBANK_API_TOKEN) {
    getPaymentPoller();
    console.log(`💳 Auto-payment enabled (poll interval: ${config.PAYMENT_POLL_INTERVAL}ms)`);

    // Check for pending orders on startup — wake poller if any exist
    const orderService = require('./services/orderService');
    const pending = orderService.getActivePending();
    if (pending.length > 0) {
      console.log(`💳 ${pending.length} pending orders found, starting payment poller...`);
      paymentPoller.ensureRunning();
    }
  } else {
    console.log('⚠️  Auto-payment disabled (set MBBANK_API_TOKEN and PAYMENT_POLL_ENABLED=true)');
  }
}

start().catch((err) => {
  console.error('❌ Không thể khởi động:', err.message);
  console.error('💡 Kiểm tra lại BOT_TOKEN trong file .env');
  process.exit(1);
});

// Prevent crash on network errors
process.on('unhandledRejection', (err) => {
  console.error('⚠️ Unhandled rejection (ignored):', err.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught exception:', err.message || err);
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
    console.log('🔄 Network error, continuing...');
    return;
  }
  process.exit(1);
});

// Graceful shutdown
process.once('SIGINT', () => {
  if (paymentPoller) paymentPoller.stop();
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  if (paymentPoller) paymentPoller.stop();
  bot.stop('SIGTERM');
});

module.exports = { app, bot, getPaymentPoller };
