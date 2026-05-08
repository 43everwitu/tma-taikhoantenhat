const bcrypt = require('bcrypt');
const db = require('../database');
const config = require('../config');

const SALT_ROUNDS = 12;
const ADMIN_TOKEN_EXPIRY = '24h';
const CUSTOMER_TOKEN_EXPIRY = '30d';

// jose is ESM-only — lazy dynamic import
let _jose = null;
async function getJose() {
  if (!_jose) _jose = await import('jose');
  return _jose;
}

function getSecretKey() {
  if (!config.JWT_SECRET) {
    throw new Error('JWT_SECRET not configured. Set it in .env');
  }
  return new TextEncoder().encode(config.JWT_SECRET);
}

const authService = {
  // ============================================================
  // Admin Auth
  // ============================================================

  /**
   * Seed initial super_admin if no admins exist.
   * Called once on startup.
   */
  async seedAdmin() {
    const count = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
    if (count > 0) return;

    if (!config.ADMIN_INITIAL_PASSWORD) {
      console.log('⚠️  No admins exist and ADMIN_INITIAL_PASSWORD not set. Admin dashboard disabled.');
      return;
    }

    const hash = await bcrypt.hash(config.ADMIN_INITIAL_PASSWORD, SALT_ROUNDS);
    db.prepare(`
      INSERT INTO admins (telegram_id, username, password_hash, display_name, role)
      VALUES (?, 'admin', ?, 'Admin', 'super_admin')
    `).run(config.ADMIN_ID || null, hash);

    console.log('👤 Initial admin created (username: admin)');
  },

  /**
   * Admin login — returns JWT or null.
   */
  async adminLogin(username, password) {
    const admin = db.prepare(
      'SELECT * FROM admins WHERE username = ? AND is_active = 1'
    ).get(username);

    if (!admin) return null;

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return null;

    // Update last login
    db.prepare('UPDATE admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(admin.id);

    const { SignJWT } = await getJose();
    const token = await new SignJWT({
      adminId: admin.id,
      role: admin.role,
      username: admin.username,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(ADMIN_TOKEN_EXPIRY)
      .sign(getSecretKey());

    return {
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        displayName: admin.display_name,
        role: admin.role,
      },
    };
  },

  /**
   * Verify admin JWT — returns payload or null.
   */
  async verifyAdminToken(token) {
    try {
      const { jwtVerify } = await getJose();
      const { payload } = await jwtVerify(token, getSecretKey());
      if (!payload.adminId) return null;
      return payload;
    } catch {
      return null;
    }
  },

  /**
   * Get admin by ID.
   */
  getAdmin(adminId) {
    return db.prepare(
      'SELECT id, telegram_id, username, display_name, role, is_active, last_login_at, created_at FROM admins WHERE id = ?'
    ).get(adminId);
  },

  // ============================================================
  // Customer Telegram Linking
  // ============================================================

  /**
   * Generate a 6-digit verification code and store it.
   */
  generateLinkCode(telegramId) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min expiry

    // Store in a simple way — use notification_prefs JSON field
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) return null;

    const prefs = JSON.parse(user.notification_prefs || '{}');
    prefs._link_code = code;
    prefs._link_expires = expiresAt;

    db.prepare('UPDATE users SET notification_prefs = ? WHERE telegram_id = ?')
      .run(JSON.stringify(prefs), telegramId);

    return code;
  },

  /**
   * Verify link code and return customer JWT.
   */
  async verifyLinkCode(telegramId, code) {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) return null;

    const prefs = JSON.parse(user.notification_prefs || '{}');
    if (!prefs._link_code || !prefs._link_expires) return null;

    // Check expiry
    if (new Date(prefs._link_expires) < new Date()) return null;

    // Check code
    if (prefs._link_code !== code) return null;

    // Clear code
    delete prefs._link_code;
    delete prefs._link_expires;
    db.prepare('UPDATE users SET notification_prefs = ? WHERE telegram_id = ?')
      .run(JSON.stringify(prefs), telegramId);

    // Generate customer JWT
    const { SignJWT } = await getJose();
    const token = await new SignJWT({
      telegramId: user.telegram_id,
      fullName: user.full_name,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(CUSTOMER_TOKEN_EXPIRY)
      .sign(getSecretKey());

    return { token, user: { telegramId: user.telegram_id, fullName: user.full_name } };
  },

  // ============================================================
  // Customer email + password (alternative to Telegram link)
  // ============================================================

  /**
   * Set or change a customer's password. Caller must already be authenticated
   * via Telegram link (so we know which telegram_id this email belongs to).
   * Email is required because the login flow keys off email.
   */
  async setCustomerPassword(telegramId, email, newPassword) {
    const user = db.prepare('SELECT telegram_id, email FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) return { ok: false, error: 'USER_NOT_FOUND' };

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return { ok: false, error: 'INVALID_EMAIL' };
    }
    if (newPassword.length < 8) return { ok: false, error: 'PASSWORD_TOO_SHORT' };

    // Email must not be claimed by another telegram user.
    const existing = db.prepare(
      'SELECT telegram_id FROM users WHERE LOWER(email) = ? AND telegram_id != ?'
    ).get(normalizedEmail, telegramId);
    if (existing) return { ok: false, error: 'EMAIL_TAKEN' };

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    db.prepare(
      'UPDATE users SET email = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?'
    ).run(normalizedEmail, hash, telegramId);

    return { ok: true };
  },

  /**
   * Email/password login → customer JWT.
   */
  async customerEmailLogin(email, password) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const user = db.prepare(
      'SELECT * FROM users WHERE LOWER(email) = ? AND password_hash IS NOT NULL'
    ).get(normalizedEmail);
    if (!user) return null;

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return null;

    const { SignJWT } = await getJose();
    const token = await new SignJWT({
      telegramId: user.telegram_id,
      fullName: user.full_name,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(CUSTOMER_TOKEN_EXPIRY)
      .sign(getSecretKey());

    return { token, user: { telegramId: user.telegram_id, fullName: user.full_name } };
  },

  /**
   * Generate a 6-digit password reset code for an email-registered user.
   * Stored in notification_prefs alongside the link code (separate slot).
   * Returns { code, telegramId } so the caller can DM it via the bot.
   */
  generatePasswordResetCode(email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const user = db.prepare(
      'SELECT * FROM users WHERE LOWER(email) = ? AND password_hash IS NOT NULL'
    ).get(normalizedEmail);
    if (!user) return null;

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const prefs = JSON.parse(user.notification_prefs || '{}');
    prefs._reset_code = code;
    prefs._reset_expires = expiresAt;
    db.prepare('UPDATE users SET notification_prefs = ? WHERE telegram_id = ?')
      .run(JSON.stringify(prefs), user.telegram_id);

    return { code, telegramId: user.telegram_id, fullName: user.full_name };
  },

  /**
   * Verify reset code + apply new password. Single-use code (cleared on success).
   */
  async resetCustomerPassword(email, code, newPassword) {
    if (newPassword.length < 8) return { ok: false, error: 'PASSWORD_TOO_SHORT' };

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(normalizedEmail);
    if (!user) return { ok: false, error: 'NOT_FOUND' };

    const prefs = JSON.parse(user.notification_prefs || '{}');
    if (!prefs._reset_code || !prefs._reset_expires) return { ok: false, error: 'NO_PENDING_RESET' };
    if (new Date(prefs._reset_expires) < new Date()) return { ok: false, error: 'CODE_EXPIRED' };
    if (prefs._reset_code !== code) return { ok: false, error: 'CODE_MISMATCH' };

    delete prefs._reset_code;
    delete prefs._reset_expires;

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    db.prepare(
      'UPDATE users SET password_hash = ?, notification_prefs = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?'
    ).run(hash, JSON.stringify(prefs), user.telegram_id);

    return { ok: true, telegramId: user.telegram_id };
  },

  /**
   * Issue a customer JWT for a known telegram user. Used by Mini App initData
   * exchange and any other path that has already authenticated the user out-of-band.
   */
  async issueCustomerToken(telegramId) {
    const user = db.prepare('SELECT telegram_id, full_name FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) return null;

    const { SignJWT } = await getJose();
    const token = await new SignJWT({
      telegramId: user.telegram_id,
      fullName: user.full_name,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(CUSTOMER_TOKEN_EXPIRY)
      .sign(getSecretKey());

    return token;
  },

  /**
   * Verify customer JWT.
   */
  async verifyCustomerToken(token) {
    try {
      const { jwtVerify } = await getJose();
      const { payload } = await jwtVerify(token, getSecretKey());
      if (!payload.telegramId) return null;
      return payload;
    } catch {
      return null;
    }
  },
};

module.exports = authService;
