# Taikhoantenhat — Fork Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a runnable, brand-stripped fork of `starizzi-shop-bot` named `taikhoantenhat-bot`, with a fresh empty SQLite database, a new Telegram bot, the Next.js `(miniapp)` and `(admin)` route groups in place as empty placeholders, a Vietnamese `/start` greeting in the bot, and zero remaining brand strings from the parent project.

**Architecture:** Single Node process (Express + Telegraf + paymentPoller + eventBus) plus Next.js webapp under `web/` with two route groups (`(miniapp)` owns `/`, `(admin)` owns `/admin/*`), plus the existing Python `mbbank-api/` sidecar. SQLite WAL via `better-sqlite3`. All user-facing strings in Vietnamese, served through `messageTemplateService`.

**Tech Stack:** Node.js 20+, Express, Telegraf 4, better-sqlite3, Next.js 16, React 19, Tailwind CSS 4, Python (sidecar only).

---

## Conventions for this plan

- **Source repo (parent):** `/Users/peanut/Users/peanut/Project Local/telegram-shop-bot`
- **Target repo (this fork):** `/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot`
- All paths in tasks below are relative to the **target repo** unless prefixed with `[parent]`.
- All commit messages are in English imperative mood. User-facing copy is in Vietnamese.
- Tests use Node's built-in `node:test` runner (matches existing `tests/` setup).
- After every task you commit. The commit makes the work checkpointable.

---

## File map (what gets touched)

### Files created
- `package.json` — fork metadata
- `web/package.json` — fork metadata
- `.env.example` — new keys (`MINIAPP_URL`, `ENCRYPTION_KEY`), brand-neutral
- `README.md` — Vietnamese-only short README for the fork
- `web/src/app/(miniapp)/layout.tsx` — Mini App root layout (Vietnamese, mobile-only meta)
- `web/src/app/(miniapp)/page.tsx` — Mini App home placeholder
- `web/src/app/(admin)/layout.tsx` — admin group layout wrapper
- `tests/brand-strip.test.js` — verifies no parent-project brand strings remain
- `tests/bot-start.test.js` — verifies `/start` produces the Vietnamese greeting

### Files modified
- `src/config.js` — replace brand strings, drop Auto-chan token
- `src/database/migrations/002_platform.js` — replace default seeded settings
- `src/services/messageTemplateService.js` — update `welcome` template content
- `src/bot/index.js` (or wherever `/start` is wired) — point users at `MINIAPP_URL` button
- `web/src/app/layout.tsx` — drop brand title and metadata
- `scripts/dev-all.sh` — printed names only

### Files moved
- `web/src/app/admin/*` → `web/src/app/(admin)/admin/*` (route group; URL unchanged)

### Files deleted (in this sub-project)
- `web/src/app/page.tsx` — replaced by `(miniapp)/page.tsx`
- Parent's `PLAN.md` at the repo root — historical doc, irrelevant in fork

### Files deleted (deferred to sub-project #8)
- `web/src/app/san-pham/`, `dang-nhap/`, `tai-khoan/`, `thanh-toan/`, `lien-ket/`, `quen-mat-khau/` — left in place; unreachable in production once geo-block lands but coexist locally

---

## Task 1: Bootstrap fork directory

**Files:**
- Create: `/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/` (whole repo)

- [ ] **Step 1: Confirm parent repo is on the expected branch**

The fork inherits whatever the parent's working tree has, so the branch matters. The platform spec specifies forking from `feat/platform-overhaul` (it has the wallet, events SSE, and admin polish features the new platform expects).

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot"
git rev-parse --abbrev-ref HEAD
```

Expected: `feat/platform-overhaul`. If the parent is on a different branch, switch with `git checkout feat/platform-overhaul` before continuing. Note: the parent has uncommitted WIP — that's fine; rsync copies the working-tree state, which is what the new platform wants.

- [ ] **Step 2: Copy parent repo to fork location, excluding generated dirs and migration sources**

```bash
SRC="/Users/peanut/Users/peanut/Project Local/telegram-shop-bot"
DST="/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
mkdir -p "$DST"
rsync -a --exclude='node_modules' --exclude='.next' --exclude='data/db.sqlite' \
  --exclude='data/db.sqlite-shm' --exclude='data/db.sqlite-wal' \
  --exclude='data/db.sqlite.fresh' \
  --exclude='.git' --exclude='logs' \
  --exclude='taikhoantenhat.com__2026-05-06T15_42_06+0700' \
  --exclude='taikho35_taikhoan_wp_lmbr8.sql' \
  --exclude='mbbank-api/__pycache__' --exclude='mbbank-api/*.pkl' \
  --exclude='mbbank-api/sessions' \
  "$SRC/" "$DST/"
```

The WordPress dump and uploads tarball are intentionally excluded — they will be referenced from the parent repo by the migration sub-project (#2). The mbbank-api pickled session state is excluded too: stale sessions tied to the parent's bank login would silently authenticate as that account. The Python sidecar regenerates session state on first login.

- [ ] **Step 3: Initialize fresh git history**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git init -b main
git add -A
git commit -m "chore: initial fork from starizzi-shop-bot @ feat/platform-overhaul"
```

Expected: a single commit on `main` with all parent files (minus excludes).

- [ ] **Step 4: Verify the fork boots dependencies**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
npm install
cd web && npm install && cd ..
```

Expected: both installs succeed without errors. The `npm install` runs may regenerate `package-lock.json` files because the project rename in Task 2 hasn't happened yet — the lockfile still references the parent name. That's fine; it gets corrected in Task 2.

- [ ] **Step 5: Commit the lockfiles if they changed**

```bash
git status
git add -A
git diff --cached --quiet || git commit -m "chore: refresh lockfiles after fork bootstrap"
```

If `git diff --cached --quiet` exits 0, there's nothing to commit; skip the commit. Otherwise commit it.

---

## Task 2: Update root package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace name and description**

Open `package.json` and change these two top-level fields:

```diff
-    "name": "starizzi-shop-bot",
+    "name": "taikhoantenhat-bot",
     "version": "1.0.0",
-    "description": "Telegram Shop Bot - Starizzi Shop",
+    "description": "Taikhoantenhat — Telegram Mini App shop",
```

- [ ] **Step 2: Refresh root lockfile**

```bash
npm install --package-lock-only
```

This rewrites the top-level `name` field in `package-lock.json` without re-resolving dependencies, so the lockfile no longer references `starizzi-shop-bot`.

- [ ] **Step 3: Verify**

```bash
node -e 'const p=require("./package.json"); if(p.name!=="taikhoantenhat-bot")process.exit(1); if(!/Taikhoantenhat/.test(p.description))process.exit(1);'
node -e 'const l=require("./package-lock.json"); if(l.name!=="taikhoantenhat-bot")process.exit(1);'
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: rename package to taikhoantenhat-bot"
```

---

## Task 3: Update web/package.json

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Replace name**

```diff
-  "name": "web",
+  "name": "taikhoantenhat-web",
```

- [ ] **Step 2: Refresh web lockfile**

```bash
cd web && npm install --package-lock-only && cd ..
```

- [ ] **Step 3: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "chore: rename web package to taikhoantenhat-web"
```

---

## Task 4: Strip brand defaults from src/config.js

**Files:**
- Modify: `src/config.js:45-50`

- [ ] **Step 1: Replace shop and brand defaults**

Change lines that look like:

```js
SHOP_NAME: process.env.SHOP_NAME || 'Starizzi Shop',
SUPPORT_CONTACT: process.env.SUPPORT_CONTACT || '@starizzi_support',
BRAND_NAME: 'Auto-chan',
```

To:

```js
SHOP_NAME: process.env.SHOP_NAME || 'Taikhoantenhat',
SUPPORT_CONTACT: process.env.SUPPORT_CONTACT || '@taikhoantenhat_support',
BRAND_NAME: 'Taikhoantenhat',
```

Then grep to confirm `BRAND_NAME` references nothing called Auto-chan elsewhere:

```bash
grep -rni "auto.?chan" --include="*.js" --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git src/ web/src/
```

Expected: no matches. If matches appear, fix them in this task before committing.

- [ ] **Step 2: Commit**

```bash
git add src/config.js
git diff --cached --stat  # eyeball the change
git commit -m "chore: rebrand config defaults to Taikhoantenhat"
```

---

## Task 5: Update default seeded settings in migration 002

**Files:**
- Modify: `src/database/migrations/002_platform.js:170-180`

- [ ] **Step 1: Replace inserted setting values**

Change lines that look like:

```js
insertSetting.run('shop_name', 'Starizzi Shop');
insertSetting.run('support_contact', '@starizzi_support');
```

To:

```js
insertSetting.run('shop_name', 'Taikhoantenhat');
insertSetting.run('support_contact', '@taikhoantenhat_support');
```

These only fire on first-time fresh DB seeding (the migration is INSERT OR IGNORE). Since the fork starts with a fresh DB, the new values apply.

- [ ] **Step 2: Commit**

```bash
git add src/database/migrations/002_platform.js
git commit -m "chore: rebrand seeded shop_name and support_contact"
```

---

## Task 6: Replace .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Write the new env example**

Replace the entire file contents with:

```env
# ================================================
# Taikhoantenhat — Cấu hình môi trường
# ================================================
# Copy file này thành .env và điền thông tin:
#   cp .env.example .env
# ================================================

# Telegram Bot Token (lấy từ @BotFather)
BOT_TOKEN=your_bot_token_here

# Admin Telegram ID (gửi /myid cho bot để lấy ID)
ADMIN_ID=your_telegram_id_here

# (Tùy chọn) Channel/group ID nhận thông báo bị tắt
# BOT_NOISE_CHAT_ID=-1001234567890

# Telegram Mini App URL (đăng ký bằng /newapp với @BotFather)
MINIAPP_URL=https://taikhoantenhat.example.com/

# ================================================
# Ngân hàng (bắt buộc) - Thanh toán QR VietQR
# ================================================
BANK_BIN=970422
BANK_ACCOUNT=your_bank_account_number
BANK_ACCOUNT_NAME=YOUR_FULL_NAME
BANK_NAME=MB

# Bỏ comment để bật ngân hàng thứ 2
# BANK2_BIN=970436
# BANK2_ACCOUNT=your_second_bank_account
# BANK2_ACCOUNT_NAME=YOUR_FULL_NAME
# BANK2_NAME=VCB

# ================================================
# API Server & Web
# ================================================
API_PORT=3000
WEB_URL=http://localhost:3001

# ================================================
# MBBank API - Thanh toán tự động
# ================================================
MBBANK_API_URL=http://localhost:8000
MBBANK_API_TOKEN=your_mbbank_api_bearer_token
PAYMENT_POLL_INTERVAL=15000
PAYMENT_POLL_ENABLED=true

# ================================================
# Authentication
# ================================================
JWT_SECRET=your_random_64_char_secret_here
ADMIN_INITIAL_PASSWORD=change_me_on_first_login

# Khoá mã hoá thông tin khách (AES-256-GCM, 32 bytes hex)
# Sinh: openssl rand -hex 32
ENCRYPTION_KEY=replace_with_64_hex_chars

# ================================================
# Thông tin Shop
# ================================================
SHOP_NAME=Taikhoantenhat
SUPPORT_CONTACT=@taikhoantenhat_support
```

- [ ] **Step 2: Verify the file parses as a valid env file**

```bash
grep -E '^[A-Z_]+=.*' .env.example | wc -l
```

Expected: a positive number (current count — typically 18 or so). The exact count isn't critical; the goal is no malformed lines.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: rewrite .env.example for Taikhoantenhat (adds MINIAPP_URL, ENCRYPTION_KEY)"
```

---

## Task 7: Replace README with a short Vietnamese README

**Files:**
- Modify: `README.md`
- Delete: `README_EN.md` (English version is unnecessary for this fork)
- Delete: `PLAN.md` (parent-project planning doc; not relevant here)

- [ ] **Step 1: Write the new README**

Overwrite `README.md` with this content:

```markdown
# Taikhoantenhat — Telegram Mini App Shop

Cửa hàng số trên Telegram cho khách Việt Nam. Bao gồm:

- **Bot Telegram**: cổng vào duy nhất, gửi thông báo đơn hàng và tin nhắn hỗ trợ.
- **Mini App**: giao diện mua hàng chạy trong ứng dụng Telegram (mobile-first).
- **Bảng điều khiển admin**: quản lý sản phẩm, đơn hàng, kho key, ví khách, tin nhắn.
- **Thanh toán tự động**: đối soát qua MBBank API (sidecar Python).

## Yêu cầu

- Node.js 20+
- Python 3.10+ (cho `mbbank-api/`)
- SQLite (đi kèm `better-sqlite3`)

## Cài đặt nhanh

```bash
cp .env.example .env
# Điền BOT_TOKEN, JWT_SECRET, ENCRYPTION_KEY...
npm install
cd web && npm install && cd ..
./dev.sh
```

Xem `docs/superpowers/specs/` cho thiết kế chi tiết.
```

- [ ] **Step 2: Delete English README and parent PLAN.md**

```bash
rm README_EN.md PLAN.md
```

- [ ] **Step 3: Commit**

```bash
git add README.md README_EN.md PLAN.md
git commit -m "docs: replace README with Taikhoantenhat overview, drop legacy docs"
```

---

## Task 8: Drop top-level brand string from web/src/app/layout.tsx

**Files:**
- Modify: `web/src/app/layout.tsx`

- [ ] **Step 1: Replace metadata**

Open `web/src/app/layout.tsx`. The file currently sets `<title>` and metadata referencing the parent brand. Replace those values with brand-neutral Vietnamese ones, e.g.:

```diff
 export const metadata: Metadata = {
-  title: "Starizzi Shop",
-  description: "Cửa hàng tự động",
+  title: "Taikhoantenhat",
+  description: "Cửa hàng số Telegram",
 };
```

If the file references any Auto-chan or sakura-specific class names, leave the class names alone (they belong to the design system) but change any user-visible string.

- [ ] **Step 2: Commit**

```bash
git add web/src/app/layout.tsx
git commit -m "chore(web): rebrand root layout metadata"
```

---

## Task 9: Move admin pages into `(admin)` route group

**Files:**
- Move: `web/src/app/admin/*` → `web/src/app/(admin)/admin/*`
- Create: `web/src/app/(admin)/layout.tsx`

- [ ] **Step 1: Create the route group directory and move admin pages**

```bash
cd web/src/app
mkdir -p '(admin)'
git mv admin '(admin)/admin'
```

Note: route group names with parentheses must be quoted in the shell because zsh and bash interpret unquoted parens as subshells.

- [ ] **Step 2: Create the group layout**

Write `web/src/app/(admin)/layout.tsx`:

```tsx
export default function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

The existing `web/src/app/(admin)/admin/layout.tsx` keeps its shell (sidebar, JWT gate). The group layout is a no-op pass-through for now — it exists so the group is structurally valid and so future cross-cutting admin concerns (e.g., a dashboard-wide provider) have a home.

- [ ] **Step 3: Verify Next.js still builds**

```bash
cd web && npm run build
```

Expected: build succeeds. The `/admin/*` URLs are unchanged because parentheses don't affect URL paths in Next.js. If the build fails because of imports referencing the old `app/admin` path, fix those imports inline before committing.

- [ ] **Step 4: Commit**

```bash
cd ..
git add -A web/src/app
git commit -m "refactor(web): move admin pages into (admin) route group"
```

---

## Task 10: Create `(miniapp)` route group with placeholder home

**Files:**
- Delete: `web/src/app/page.tsx`
- Create: `web/src/app/(miniapp)/layout.tsx`
- Create: `web/src/app/(miniapp)/page.tsx`

- [ ] **Step 1: Delete the existing root page**

```bash
git rm web/src/app/page.tsx
```

The existing root page is the parent project's customer storefront. The Mini App takes over the root path; the storefront sub-pages (`san-pham`, `thanh-toan`, etc.) remain in place for now and will be deleted in sub-project #8.

- [ ] **Step 2: Create the Mini App group layout**

Write `web/src/app/(miniapp)/layout.tsx`:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Taikhoantenhat",
  description: "Cửa hàng Telegram Mini App",
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
};

export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  return <div className="miniapp-root">{children}</div>;
}
```

- [ ] **Step 3: Create the Mini App home placeholder**

Write `web/src/app/(miniapp)/page.tsx`:

```tsx
export default function MiniAppHome() {
  return (
    <main style={{ padding: "1.5rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Taikhoantenhat</h1>
      <p>Chào mừng đến cửa hàng. Trang đang được hoàn thiện.</p>
    </main>
  );
}
```

This is a deliberately minimal placeholder. The real Mini App home is built in sub-project #3.

- [ ] **Step 4: Verify Next.js builds and the root path renders the placeholder**

```bash
cd web && npm run build && cd ..
```

Expected: build succeeds with `(miniapp)` route group present. To do a quick runtime check:

```bash
cd web && npm run dev &
DEV_PID=$!
sleep 8
curl -s http://localhost:3001/ | grep -o "Taikhoantenhat"
kill $DEV_PID
cd ..
```

Expected: `curl` returns at least one match for `Taikhoantenhat`.

- [ ] **Step 5: Commit**

```bash
git add -A web/src/app
git commit -m "feat(web): add (miniapp) route group with Vietnamese placeholder home"
```

---

## Task 11: Update bot welcome template to Vietnamese Taikhoantenhat copy

**Files:**
- Modify: `src/services/messageTemplateService.js` (the `welcome` template)

- [ ] **Step 1: Find the current welcome template**

```bash
grep -n "welcome" src/services/messageTemplateService.js | head -20
```

Locate the default `welcome` template body. It currently contains Auto-chan / Starizzi flavored copy.

- [ ] **Step 2: Replace it with brand-neutral Vietnamese copy**

The replacement body must keep the same template variable names so the service test suite still passes (`name`, `username`, `balance`). Use:

```
Xin chào {{name}}!

Chào mừng đến với Taikhoantenhat.
Số dư hiện tại: {{balance}} ₫

Bấm nút "Mở cửa hàng" bên dưới để bắt đầu.
```

The exact JS edit depends on how the templates are declared in the file (object literal, switch, or seeded into DB). Whatever the structure, the constraint is: the rendered output for `welcome` must contain "Taikhoantenhat" and must NOT contain "Starizzi", "Auto-chan", or "autochan".

- [ ] **Step 3: Run the existing template service tests**

```bash
node --test tests/messageTemplateService.test.js
```

Expected: all tests pass. The existing test (`render leaves no curly placeholders for known templates`) will catch a mistake where a placeholder is left unfilled.

- [ ] **Step 4: Commit**

```bash
git add src/services/messageTemplateService.js
git commit -m "feat(templates): rewrite welcome template in Vietnamese for Taikhoantenhat"
```

---

## Task 12: Wire `/start` to send the Mini App button

**Files:**
- Modify: `src/bot/index.js` (find the `/start` handler)

- [ ] **Step 1: Locate the existing `/start` handler**

```bash
grep -n "command('start'\|onText.*\\/start\|start.*command" src/bot/index.js
```

Or if the bot wires commands somewhere else:

```bash
grep -rn "/start" src/bot/ src/handlers/ | head -20
```

- [ ] **Step 2: Replace the handler body**

Whatever the existing structure, the handler must do exactly two things:
1. Render the `welcome` message via `messageTemplateService.render('welcome', {...})`.
2. Reply with that text and a single-button reply markup that opens the Mini App URL.

A minimal Telegraf handler looks like:

```js
const messageTemplateService = require('../services/messageTemplateService');
const config = require('../config');

bot.start(async (ctx) => {
  const name = ctx.from?.first_name || ctx.from?.username || 'bạn';
  const username = ctx.from?.username || '';
  // balance is unknown without a DB lookup; leave 0 here
  const text = messageTemplateService.render('welcome', { name, username, balance: '0' });

  await ctx.reply(text, {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Mở cửa hàng', web_app: { url: process.env.MINIAPP_URL } }
      ]]
    }
  });
});
```

If the file already wires `/start` differently (e.g., calls a function in `src/handlers/start.js`), edit that file instead so the same two effects happen.

- [ ] **Step 3: Manually smoke-test against the bot**

After filling `.env` with a real `BOT_TOKEN` and `MINIAPP_URL`:

```bash
node src/index.js
```

Expected: the process starts without throwing. Send `/start` to the bot from your Telegram account; expect the Vietnamese welcome message and a "Mở cửa hàng" button.

If you don't have a real bot token yet, skip the live test and rely on Task 13's automated test instead.

- [ ] **Step 4: Commit**

```bash
git add src/bot/index.js src/handlers/
git commit -m "feat(bot): /start renders Vietnamese welcome and Mini App button"
```

---

## Task 13: Add an automated test for the `/start` handler

**Files:**
- Create: `tests/bot-start.test.js`

This test covers the `/start` handler in isolation by stubbing the Telegraf `ctx`. It guarantees the handler renders the brand-neutral Vietnamese welcome and attaches a `web_app` button pointing at `MINIAPP_URL`.

- [ ] **Step 1: Write the failing test first**

Create `tests/bot-start.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');

// The handler module must export a single function: handleStart(ctx)
// We export it from src/bot/index.js (or wherever the handler lives) for testability.
const { handleStart } = require('../src/bot/start-handler');

test('/start replies with Vietnamese Taikhoantenhat greeting', async () => {
  const sent = [];
  const ctx = {
    from: { first_name: 'Khoa', username: 'khoa' },
    reply: async (text, extra) => { sent.push({ text, extra }); }
  };

  process.env.MINIAPP_URL = 'https://taikhoantenhat.example.com/';
  await handleStart(ctx);

  assert.strictEqual(sent.length, 1, 'expected one reply');
  assert.match(sent[0].text, /Taikhoantenhat/);
  assert.doesNotMatch(sent[0].text, /Starizzi/i);
  assert.doesNotMatch(sent[0].text, /auto.?chan/i);

  const buttons = sent[0].extra?.reply_markup?.inline_keyboard ?? [];
  assert.strictEqual(buttons.length, 1);
  assert.strictEqual(buttons[0].length, 1);
  assert.strictEqual(buttons[0][0].text, 'Mở cửa hàng');
  assert.strictEqual(buttons[0][0].web_app.url, 'https://taikhoantenhat.example.com/');
});
```

- [ ] **Step 2: Run the test to verify it fails for the right reason**

```bash
node --test tests/bot-start.test.js
```

Expected: failure with "Cannot find module '../src/bot/start-handler'". Anything else (e.g., a syntax error) means fix the test before continuing.

- [ ] **Step 3: Extract the handler into its own module**

Create `src/bot/start-handler.js`:

```js
const messageTemplateService = require('../services/messageTemplateService');

async function handleStart(ctx) {
  const name = ctx.from?.first_name || ctx.from?.username || 'bạn';
  const username = ctx.from?.username || '';
  const text = messageTemplateService.render('welcome', { name, username, balance: '0' });

  await ctx.reply(text, {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Mở cửa hàng', web_app: { url: process.env.MINIAPP_URL } }
      ]]
    }
  });
}

module.exports = { handleStart };
```

Then in `src/bot/index.js` replace the inline body wired in Task 12 with:

```js
const { handleStart } = require('./start-handler');
bot.start(handleStart);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/bot-start.test.js
```

Expected: 1 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add tests/bot-start.test.js src/bot/start-handler.js src/bot/index.js
git commit -m "test(bot): cover /start Vietnamese greeting and Mini App button"
```

---

## Task 14: Add a brand-strip regression test and sweep remaining strings

**Files:**
- Create: `tests/brand-strip.test.js`
- Likely modified during the sweep:
  - `web/DESIGN.md` (Auto-chan / sakura references)
  - `web/public/` favicon, logo, OG image (delete or replace)
  - `src/services/notificationService.js` (any hardcoded brand strings in admin notifications)
  - Anything else the test surfaces

This test runs grep across the source tree and fails if parent-project brand strings remain. It's both the cleanup driver for this task and the regression safety net for later commits.

- [ ] **Step 1: Write the test**

Create `tests/brand-strip.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function grepMatches(pattern) {
  // -r recurse, -I skip binary, -i case-insensitive, --include lists active
  // extensions, --exclude prunes generated/auto files, --exclude-dir prunes
  // dirs. `|| true` swallows grep's exit-1-on-no-match.
  const cmd = `grep -rIni "${pattern}" \
    --include="*.js" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" --include="*.css" --include="*.html" --include="*.svg" \
    --exclude="package-lock.json" \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=docs --exclude-dir=tests \
    "${ROOT}" || true`;
  const out = execSync(cmd, { encoding: 'utf8' });
  return out.trim() ? out.trim().split('\n') : [];
}

test('no Starizzi brand strings outside docs', () => {
  const matches = grepMatches('starizzi');
  assert.strictEqual(matches.length, 0, `unexpected matches:\n${matches.join('\n')}`);
});

test('no Auto-chan brand strings outside docs', () => {
  const matches = grepMatches('auto.\\?chan');
  assert.strictEqual(matches.length, 0, `unexpected matches:\n${matches.join('\n')}`);
});
```

The test excludes:
- `docs/` because spec and plan documents legitimately reference the parent brand while describing the migration.
- `tests/` because this file itself contains the brand strings as patterns.
- `package-lock.json` because npm regenerates it and its content is not human-authored.

- [ ] **Step 2: Run the test and capture every match**

```bash
node --test tests/brand-strip.test.js
```

Expected: failures listing one or more offending files. Common locations the test will surface (sweep these as you encounter them — do not pre-judge, let the failure output drive):

- `web/DESIGN.md` — design doc with parent-brand callouts; rewrite the brand-specific paragraphs to be brand-neutral while keeping the design tokens and component descriptions.
- `web/public/` — any text-format file that mentions the parent brand (favicons themselves are binary and excluded by `-I`, but `manifest.json`, `og-image.svg`, etc. may have strings). Replace or delete as appropriate. If `web/public/favicon.ico`, `web/public/logo.png`, or other binary assets need replacing, do so now and stage the new files; binaries don't appear in grep output but should be replaced for the rebrand to feel complete.
- `src/services/notificationService.js` and other service modules — hardcoded brand-referencing message bodies.
- `src/services/messageTemplateService.js` — any template body other than `welcome` that still references the parent brand. Update each to brand-neutral Vietnamese copy.

- [ ] **Step 3: Fix each surfaced match**

For each `path:line:content` line in the failure output:
- If the file is intended to ship with the fork (e.g., `web/DESIGN.md`, a service file), edit the content to replace the brand string with `Taikhoantenhat` (or remove the surrounding sentence if the brand reference was decorative).
- If the file is no longer needed (an old asset, a sample doc), delete it.
- If the match is genuinely a false positive from a vendored snippet that must stay, add a more specific exclusion to the test rather than expanding `--exclude-dir` broadly.

- [ ] **Step 4: Re-run until clean**

```bash
node --test tests/brand-strip.test.js
```

Expected: 2 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: sweep remaining brand strings; add brand-strip regression test"
```

---

## Task 15: Verify migrations apply on a fresh database

**Files:**
- (none modified) — this is a verification gate

- [ ] **Step 1: Remove any existing dev database**

```bash
rm -f data/db.sqlite data/db.sqlite-shm data/db.sqlite-wal
```

- [ ] **Step 2: Trigger migrations by starting the API process briefly**

The migration runner runs at API startup. Use a timed run:

```bash
( node src/index.js & echo $! > /tmp/api.pid; sleep 3; kill $(cat /tmp/api.pid) ) || true
```

- [ ] **Step 3: Inspect the resulting migrations table**

```bash
sqlite3 data/db.sqlite "SELECT name FROM migrations ORDER BY name;"
```

Expected: 14 rows, names `001_initial.js` through `014_topup_actual_amount.js`.

- [ ] **Step 4: Spot-check the seeded settings reflect the rebrand**

```bash
sqlite3 data/db.sqlite "SELECT key, value FROM settings WHERE key IN ('shop_name', 'support_contact');"
```

Expected:
```
shop_name|Taikhoantenhat
support_contact|@taikhoantenhat_support
```

- [ ] **Step 5: Snapshot the fresh DB for fast resets during dev**

```bash
cp data/db.sqlite data/db.sqlite.fresh
```

`data/db.sqlite.fresh` is gitignored along with `data/db.sqlite` (verify by running `git status data/`); it acts as a pristine reset point during later sub-projects.

- [ ] **Step 6: Commit any incidental changes (likely none)**

```bash
git status
git diff --quiet || git commit -am "chore: verification cycle artifacts (if any)"
```

If there's nothing to commit, skip the commit. The verification itself doesn't require a commit; this step exists only to capture stragglers.

---

## Task 16: Update dev script printed names

**Files:**
- Modify: `dev.sh`

- [ ] **Step 1: Update the trailing echoes**

```diff
-echo "✅ Started 3 services in Terminal tabs"
+echo "✅ Taikhoantenhat — started 3 services in Terminal tabs"
```

(`scripts/dev-all.sh` prints service names but no brand string — leave it alone.)

- [ ] **Step 2: Commit**

```bash
git add dev.sh
git commit -m "chore: rebrand dev.sh banner"
```

---

## Task 17: Final verification + tag v0

**Files:**
- (none modified)

- [ ] **Step 1: Run the full test suite**

```bash
node --test tests/
```

Expected: all tests pass — `messageTemplateService.test.js`, `bot-start.test.js`, `brand-strip.test.js`.

- [ ] **Step 2: Run the brand-strip grep one more time, manually**

```bash
grep -rIni "starizzi\|auto.\\?chan" \
  --include="*.js" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" --include="*.css" --include="*.html" --include="*.svg" \
  --exclude="package-lock.json" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=docs --exclude-dir=tests .
```

Expected: zero output.

- [ ] **Step 3: Confirm the Next.js build still passes**

```bash
cd web && npm run build && cd ..
```

Expected: build succeeds.

- [ ] **Step 4: Tag the foundation milestone**

```bash
git tag -a v0-fork-foundation -m "Fork foundation complete: brand stripped, route groups in place, /start renders Vietnamese welcome"
```

- [ ] **Step 5: Print the smoke-test checklist for the human**

The plan calls for the human to verify these manually before declaring done; print them so the engineer knows what to hand back to the user:

```text
Smoke checks (run on a clean clone):
  1. cp .env.example .env && fill BOT_TOKEN, JWT_SECRET, ENCRYPTION_KEY
  2. npm install && (cd web && npm install)
  3. ./dev.sh starts mbbank-api, api, web without errors
  4. curl http://localhost:3001/ contains "Taikhoantenhat"
  5. curl -I http://localhost:3001/admin returns 200 or a redirect to /admin/login
  6. /start to the bot replies with Vietnamese welcome + "Mở cửa hàng" button
  7. node --test tests/ passes
  8. grep -rIni "starizzi\|auto.?chan" --exclude="package-lock.json" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=docs --exclude-dir=tests .  → zero matches
```

This concludes sub-project #1. The fork is now an empty-but-runnable platform ready for sub-projects #2 (data migration) and #3 (Mini App MVP), which can proceed in parallel.
