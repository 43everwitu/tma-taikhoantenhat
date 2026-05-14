# Admin 2FA (TOTP)

**Date**: 2026-05-14
**Status**: Spec
**Tag on ship**: `v0.33-2fa`

## Goal

Add RFC-6238 TOTP 2FA to admin login. Super admin can force enrollment per manager + reset 2FA when device lost. Backup codes for recovery.

## Schema (migration `028_admin_2fa.js`)

```sql
ALTER TABLE admins ADD COLUMN totp_secret TEXT;          -- encrypted (AES-GCM, base32 plaintext)
ALTER TABLE admins ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN totp_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN totp_backup_codes TEXT;    -- JSON array of bcrypt(code)

CREATE TABLE admin_2fa_attempts (
  admin_id INTEGER PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until DATETIME
);
```

`super_admin` is implicitly `totp_required` regardless of flag value. `manager` defaults to required.

## Libraries

- `otplib` — RFC-6238 TOTP.
- `qrcode` — server-side QR data URL.

## Login flow

```
POST /auth/login {username, password}
  creds bad → 401
  creds ok, totp_enabled=0, totp_required=0 → 200 {token: <full>}
  creds ok, totp_required && !totp_enabled → 200 {token: <enroll>, requiresEnroll: true}
  creds ok, totp_enabled=1 → 200 {challengeToken: <5min>, requires2fa: true}

POST /auth/login/2fa {challengeToken, code}
  verify TOTP or backup → 200 {token: <full>}
  fail → 401, increment attempts, lock after 5
```

JWT claims include `step`: `'2fa'` for challenge token, `'enroll'` for forced-enroll token, `'full'` (or omitted) for normal access.

## Middleware

`requireFullAuth` placed after `requireAdmin` on every admin route **except** the enrollment endpoints. Rejects tokens with `step !== undefined` (i.e. not full).

Allowed for `step: 'enroll'`:
- `GET /admin/me`
- `GET /admin/me/2fa`
- `POST /admin/me/2fa/setup`
- `POST /admin/me/2fa/enable`

## Endpoints

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/auth/login` (extended) | none | `{username, password}` | full token / challenge token / enroll token |
| POST | `/auth/login/2fa` | none (verifies challengeToken) | `{challengeToken, code}` | full token |
| GET | `/admin/me/2fa` | full or enroll | — | `{enabled, required, backupCount}` |
| POST | `/admin/me/2fa/setup` | full or enroll | — | `{secret, otpauthUrl, qrDataUrl}` |
| POST | `/admin/me/2fa/enable` | full or enroll | `{code}` | `{backupCodes: string[]}` |
| POST | `/admin/me/2fa/disable` | full | `{code}` | `{disabled: true}` |
| POST | `/admin/me/2fa/regenerate-backup` | full | `{code}` | `{backupCodes: string[]}` |
| PATCH | `/admin/admins/:id/2fa` | full + `admins.write` | `{required?, reset?}` | `{updated: true}` |

`disable` refuses when `totp_required=1`.

## Service contract

`src/services/totpService.js`:

```
generateSecret() → { base32, otpauthUrl(label, issuer) }
verifyCode(secret, code) → boolean
generateBackupCodes(n=10) → { plaintext: string[], hashes: string[] }
verifyBackupCode(hashes: string[], code: string) → { ok: boolean, remaining: string[] }
makeQrDataUrl(otpauthUrl) → string (data:image/png;base64,...)
encryptSecret(base32) → string (uses secrets.js)
decryptSecret(blob) → string
```

## Front-end

- `/admin/profile` (new) — self-enrollment, QR display, backup-code reveal, regenerate, disable (if not required).
- `/admin/admins` — new "2FA" column with badge; super_admin actions: force-required toggle, reset.
- `/admin/login` — challenge step after password when `requires2fa: true`.

Login form maintains challenge token in component state; submits second `POST /auth/login/2fa`.

## Audit log

Every action emits `auditService.log` with `event` in: `admin.2fa.enable`, `admin.2fa.disable`, `admin.2fa.reset`, `admin.2fa.force`, `admin.2fa.verify_ok`, `admin.2fa.verify_fail`, `admin.2fa.backup_used`.

## Bootstrap escape

`scripts/admin-reset-2fa.js`:

```
node scripts/admin-reset-2fa.js <username>
```

Clears `totp_secret`, sets `totp_enabled=0`, `totp_required=0`. Direct DB. Used when super_admin loses device.

## Security knobs

- Secret persisted AES-GCM encrypted via existing `secrets.js`.
- Backup codes: 10 × 8-char (`XXXX-XXXX`), bcrypt 12 hashed, single-use (consumed code's hash removed from array on success).
- TOTP window: ±1 step (30 s) for clock skew.
- Rate-limit: 5 fails → lock for 5 min on the `admin_2fa_attempts` row.
- Bot owner CLI bypass documented but not exposed via API.

## Acceptance

- Migration 028 runs idempotently.
- New manager created with `totp_required=1` cannot use admin routes until enrolled.
- TOTP verify with code from Google Authenticator (or `otpauth://` URI tested via `oathtool`) succeeds.
- Backup code works exactly once.
- Super_admin force/reset visible on `/admin/admins`; affected manager logged in next request sees enrollment redirect.
- `node scripts/admin-reset-2fa.js superadmin` clears state.

## Out of scope

WebAuthn, SMS, email recovery, trusted-device, IP allowlist.

## Risk

- Lockout — covered by CLI escape.
- Time skew — TOTP window ±1.
- Backup-code phishing — UI labels emphasize "save offline".
