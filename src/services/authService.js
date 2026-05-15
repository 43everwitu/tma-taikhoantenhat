const bcrypt = require('bcrypt');
const db = require('../database');
const config = require('../config');
const twofaPolicy = require('./twofaPolicy');

const SALT_ROUNDS = 12;
const ADMIN_TOKEN_EXPIRY = '24h';
const CHALLENGE_TOKEN_EXPIRY = '5m';
const ENROLL_TOKEN_EXPIRY = '15m';
const CUSTOMER_TOKEN_EXPIRY = '30d';
const MAX_2FA_ATTEMPTS = 5;
const LOCK_MINUTES = 5;

// Thin wrapper over twofaPolicy so call sites in this file keep their name.
function effectiveRequired(admin) {
  return twofaPolicy.isEnrollmentRequired(admin);
}

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
   * Admin login — returns one of:
   *   { ok: false }                                     — bad creds / inactive
   *   { ok: true, requires2fa: true, challengeToken }   — password ok, TOTP next
   *   { ok: true, requiresEnroll: true, enrollToken, admin } — must enroll first
   *   { ok: true, token, admin }                        — full session
   */
  async adminLogin(username, password) {
    const admin = db.prepare(
      'SELECT * FROM admins WHERE username = ? AND is_active = 1'
    ).get(username);

    if (!admin) return { ok: false };

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return { ok: false };

    const { SignJWT } = await getJose();
    const sign = (claims, ttl) => new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(ttl)
      .sign(getSecretKey());

    // Already enrolled → require TOTP challenge before issuing full token.
    if (admin.totp_enabled) {
      const challengeToken = await sign(
        { adminId: admin.id, step: '2fa' },
        CHALLENGE_TOKEN_EXPIRY,
      );
      return { ok: true, requires2fa: true, challengeToken };
    }

    // Must enroll first → enrollment-step token, limited middleware access.
    if (effectiveRequired(admin)) {
      const enrollToken = await sign(
        { adminId: admin.id, role: admin.role, username: admin.username, step: 'enroll' },
        ENROLL_TOKEN_EXPIRY,
      );
      return {
        ok: true,
        requiresEnroll: true,
        enrollToken,
        admin: {
          id: admin.id,
          username: admin.username,
          displayName: admin.display_name,
          role: admin.role,
        },
      };
    }

    // No 2FA required, no enrollment — direct full session.
    db.prepare('UPDATE admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(admin.id);
    const token = await sign(
      { adminId: admin.id, role: admin.role, username: admin.username },
      ADMIN_TOKEN_EXPIRY,
    );
    return {
      ok: true,
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
   * Verify the 2FA challenge token + code, return full admin token + lockout
   * state. Counts failed attempts in admin_2fa_attempts and locks for 5 min
   * after 5 fails.
   */
  async verifyAdminTwoFactor(challengeToken, code) {
    const { jwtVerify } = await getJose();
    let payload;
    try { ({ payload } = await jwtVerify(challengeToken, getSecretKey())); }
    catch { return { ok: false, code: 'INVALID_CHALLENGE' }; }
    if (payload.step !== '2fa' || !payload.adminId) return { ok: false, code: 'INVALID_CHALLENGE' };

    const admin = db.prepare('SELECT * FROM admins WHERE id = ? AND is_active = 1').get(payload.adminId);
    if (!admin || !admin.totp_enabled) return { ok: false, code: 'NOT_ENROLLED' };

    const lock = db.prepare('SELECT attempts, locked_until FROM admin_2fa_attempts WHERE admin_id = ?').get(admin.id);
    if (lock?.locked_until && new Date(lock.locked_until) > new Date()) {
      return { ok: false, code: 'LOCKED', lockedUntil: lock.locked_until };
    }

    const totpService = require('./totpService');
    const secret = admin.totp_secret ? totpService.decryptSecret(admin.totp_secret) : null;
    let success = secret ? totpService.verifyCode(secret, code) : false;
    let consumedBackup = false;
    let newBackupHashes = null;

    if (!success && admin.totp_backup_codes) {
      const hashes = JSON.parse(admin.totp_backup_codes);
      const r = await totpService.verifyBackupCode(hashes, code);
      if (r.ok) {
        success = true;
        consumedBackup = true;
        newBackupHashes = r.remaining;
      }
    }

    if (!success) {
      const attempts = (lock?.attempts || 0) + 1;
      const locked_until = attempts >= MAX_2FA_ATTEMPTS
        ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
        : null;
      db.prepare(`
        INSERT INTO admin_2fa_attempts (admin_id, attempts, locked_until)
        VALUES (?, ?, ?)
        ON CONFLICT(admin_id) DO UPDATE SET attempts = ?, locked_until = ?
      `).run(admin.id, attempts, locked_until, attempts, locked_until);
      return { ok: false, code: locked_until ? 'LOCKED' : 'BAD_CODE', attempts, lockedUntil: locked_until };
    }

    // Reset attempts + consume backup if used + update last login
    db.prepare('DELETE FROM admin_2fa_attempts WHERE admin_id = ?').run(admin.id);
    if (consumedBackup) {
      db.prepare('UPDATE admins SET totp_backup_codes = ? WHERE id = ?').run(JSON.stringify(newBackupHashes), admin.id);
    }
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
      ok: true,
      token,
      consumedBackup,
      admin: {
        id: admin.id,
        username: admin.username,
        displayName: admin.display_name,
        role: admin.role,
      },
    };
  },

  /**
   * Issue a full admin token for an already-authenticated admin (used after
   * a successful enrollment from the enroll-step token).
   */
  async issueFullAdminToken(admin) {
    const { SignJWT } = await getJose();
    db.prepare('UPDATE admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(admin.id);
    return new SignJWT({
      adminId: admin.id,
      role: admin.role,
      username: admin.username,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(ADMIN_TOKEN_EXPIRY)
      .sign(getSecretKey());
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
