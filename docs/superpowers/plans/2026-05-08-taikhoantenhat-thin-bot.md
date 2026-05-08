# Taikhoantenhat — Thin Bot Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cull the Telegraf bot down to its three remaining responsibilities — `/start` as the Mini App entry point, outbound notifications (delivery, payment confirmations, admin alerts), and a "everything else opens the Mini App" fallback. Remove customer purchase commands and the in-bot purchase flow (productSelect → quantitySelect → paymentConfirm), and remove the in-bot admin tools (admin actions handler) since admin functions move entirely to the dashboard. The notification surface (notificationService + adminNotifyService) stays intact and is exercised by the migrated /start + the admin dashboard.

**Architecture:** Same single Node process as before. The bot module shrinks: `src/bot/index.js` registers exactly two command handlers (`/start`, `/myid`), one fallback handler ("any other input nudges to Mini App"), and the existing notification dispatchers. Everything purchase-related moves out of the codebase. The Mini App handles all customer-facing flows already (sub-project #3); the admin dashboard handles stock/refund/product editing already (existing `/api/v1/admin/*` routes). What remains is exactly what the umbrella spec calls "thin": entry point + DM channel.

**Tech Stack:** Node.js 20+, Telegraf 4 (already installed), `node:test`. No new dependencies.

---

## Conventions for this plan

- **Repo root:** `/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/`. Paths below relative.
- This sub-project is **independent of #2 and #3** — it can land in parallel. The only shared touchpoint is `messageTemplateService` (templates `welcome`, `cmd_myid`, `cmd_support`), which #1 already brought to a brand-neutral Vietnamese baseline.
- "Customer purchase flow" = the chain `/menu` → `product_<id>` action → `qty_*` action → `confirm_payment` action. All four pieces go.
- "In-bot admin tools" = `src/handlers/adminActions.js`. Replaced functionally by `(admin)` route group in the dashboard. Its 681 lines disappear.
- Keep notifications working. The bot DMs the customer when an order is delivered (`notificationService.sendDelivery` / `notifyOrderDelivered`). That code path stays untouched; only the *trigger* surface (purchase flow) is removed. Triggers now come from the Mini App's `POST /orders` and the existing payment poller.
- Commit messages in English imperative mood. No code comments unless rationale is non-obvious.

---

## File map (what gets touched)

### Files deleted
- `src/commands/balance.js`
- `src/commands/info.js`
- `src/commands/nap.js`
- `src/commands/orders.js`
- `src/commands/products.js`
- `src/commands/refund.js`
- `src/commands/website.js`
- `src/commands/support.js` *(deleted in this sub-project; the support contact lives in the Mini App and admin dashboard now)*
- `src/handlers/productSelect.js`
- `src/handlers/quantitySelect.js`
- `src/handlers/paymentConfirm.js` *(but the file currently exports `deliverOrder`, used by `adminActions.js`. See Task 4 — `deliverOrder` migrates to a service before the file is deleted)*
- `src/handlers/adminActions.js`
- `src/utils/keyboard.js` — only if no remaining file imports it. Audit in Task 9.

### Files modified
- `src/bot/index.js` — slim registration: only `/start`, `/myid`, the fallback handler, and the notification dispatcher init
- `src/commands/start.js` — handle `start_param` deep-links (`order_<id>` → button to that order page in the Mini App)
- `src/commands/myid.js` — unchanged content; verify it still loads
- `src/services/messageTemplateService.js` — drop templates that only existed for purged commands (e.g. `cmd_balance`, `cmd_account_info`, `cmd_orders_*`). Keep `welcome`, `cmd_myid`, fallback nudge

### Files created
- `src/services/orderFulfillmentService.js` — wraps the `deliverOrder` logic that previously lived in `paymentConfirm.js`, so deleting the handler doesn't break callers
- `src/bot/fallback.js` — single handler for any non-`/start`, non-`/myid` input
- `tests/bot/start-deep-link.test.js`
- `tests/bot/fallback.test.js`
- `tests/bot/registration.test.js` — asserts `setMyCommands` payload and that no purged commands are registered

---

## Pre-flight

1. Sub-project #1 done (tag `v0-fork-foundation`). Required.
2. Sub-projects #2 and #3 are *not* required to start this plan, but: the smoke test in Task 11 confirms an end-to-end purchase via Mini App and a delivery DM, so it presumes either #3 has landed or you skip the live-purchase verification and rely on automated tests.
3. Verify the dashboard already has the routes the bot is shedding:

```bash
ls src/api/routes/admin/
```

Expected: `stock.js`, `products.js`, `orders.js`, `topups.js`, `transactions.js`. If any required admin function is missing, **stop** — admin can't lose access; that's a regression. Make a follow-up task to add the missing route to the dashboard before culling the bot tool.

---

## Task 1: Audit deliverOrder usage and isolate it

**Files:**
- Read-only audit. No edits in this task.

`paymentConfirm.js` exports `deliverOrder(bot, orderId)`. Multiple files import it. We need a clean inventory before removing the file.

- [ ] **Step 1: Audit imports of `paymentConfirm` and `deliverOrder`**

```bash
grep -rn "paymentConfirm\|deliverOrder" src/ tests/ --exclude-dir=node_modules
```

Capture the output verbatim into the task's commit message later. Typical hits:
- `src/handlers/paymentConfirm.js` itself
- `src/handlers/adminActions.js` requires `deliverOrder`
- `src/services/paymentPoller.js` likely calls `deliverOrder` when a payment is matched

- [ ] **Step 2: Audit imports of files we plan to delete**

```bash
grep -rn "require.*commands/balance\|commands/info\|commands/nap\|commands/orders\|commands/products\|commands/refund\|commands/website\|commands/support\|handlers/productSelect\|handlers/quantitySelect\|handlers/adminActions" src/ tests/ --exclude-dir=node_modules
```

Expected: only `src/bot/index.js` requires the commands and handlers. If anything else imports them, surface those callers in the next task before deletion.

- [ ] **Step 3: No commit — this is a read-only audit step**

The findings drive Tasks 4 and 7. If unexpected imports surfaced, add a note to the implementation order before continuing.

---

## Task 2: Strip purchase commands

**Files:**
- Delete: `src/commands/balance.js`
- Delete: `src/commands/info.js`
- Delete: `src/commands/nap.js`
- Delete: `src/commands/orders.js`
- Delete: `src/commands/products.js`
- Delete: `src/commands/refund.js`
- Delete: `src/commands/website.js`
- Delete: `src/commands/support.js`

`src/bot/index.js` will be edited in Task 7 to stop requiring these. Deleting now produces a deliberately broken bot start until Task 7 — that's fine for a sub-project worktree, but if the engineer is running `npm run dev` continuously, they should expect the bot to fail to start until Task 7 lands.

- [ ] **Step 1: Delete the eight command files**

```bash
git rm src/commands/balance.js src/commands/info.js src/commands/nap.js \
       src/commands/orders.js src/commands/products.js src/commands/refund.js \
       src/commands/website.js src/commands/support.js
```

- [ ] **Step 2: Verify no other source file imports them**

```bash
grep -rn "require.*commands/\(balance\|info\|nap\|orders\|products\|refund\|website\|support\)" src/ tests/ --exclude-dir=node_modules
```

Expected: matches only in `src/bot/index.js`. If anything else matches, fix or delete that file in this same commit before moving on.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(bot): drop customer purchase + admin commands (moved to Mini App + dashboard)"
```

---

## Task 3: Strip purchase handlers

**Files:**
- Delete: `src/handlers/productSelect.js`
- Delete: `src/handlers/quantitySelect.js`

These are pure customer purchase flow — the Mini App now creates orders via `POST /api/v1/orders`. Their callback patterns (`product_<id>`, `qty_*`) won't be triggered anymore.

- [ ] **Step 1: Delete**

```bash
git rm src/handlers/productSelect.js src/handlers/quantitySelect.js
```

- [ ] **Step 2: Audit for stragglers**

```bash
grep -rn "productSelect\|quantitySelect" src/ tests/ --exclude-dir=node_modules
```

Expected: only `src/bot/index.js` (cleaned in Task 7).

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(bot): drop purchase handlers (productSelect, quantitySelect)"
```

---

## Task 4: Move deliverOrder out of the handler before deleting it

**Files:**
- Create: `src/services/orderFulfillmentService.js`
- Modify: `src/services/paymentPoller.js` — import path change
- Modify: `src/handlers/adminActions.js` — *will be deleted in Task 5*; if the file still references `deliverOrder`, point it at the new service first so the lift is mechanical
- Delete: `src/handlers/paymentConfirm.js` (only after the new service is wired)

`deliverOrder` is doing real work — moving stock to sold, sending the delivery DM, updating order status. It belongs in a service, not in a Telegraf handler module.

- [ ] **Step 1: Read the current `deliverOrder` body**

```bash
cat src/handlers/paymentConfirm.js
```

It probably reads roughly:

```js
async function deliverOrder(bot, orderId) {
  const order = orderService.getById(orderId);
  // ... mark stock sold, set delivered_at, send DM via notificationService
}
```

- [ ] **Step 2: Create the service**

Write `src/services/orderFulfillmentService.js`. Copy the body of `deliverOrder` verbatim from `paymentConfirm.js`. Replace any imports relative to `../services` with relative paths from `services/`:

```js
const orderService = require('./orderService');
const productService = require('./productService');
const { sendDelivery } = require('./notificationService');

async function deliverOrder(bot, orderId) {
  // ... copy from paymentConfirm.js, fix relative paths ...
}

module.exports = { deliverOrder };
```

The intent is a verbatim move: behavior identical, location different. Resist the urge to refactor while moving — refactor later if you want, in a separate commit.

- [ ] **Step 3: Update callers of `deliverOrder`**

```bash
grep -rn "require.*handlers/paymentConfirm\|require.*paymentConfirm.*deliverOrder" src/
```

For each match, change the import to:

```js
const { deliverOrder } = require('../services/orderFulfillmentService');
```

If `adminActions.js` is among the callers, edit it in this task even though it's about to be deleted — that keeps the diff in this commit clean.

- [ ] **Step 4: Run any existing tests for the payment flow**

```bash
node --test tests/
```

Expected: existing tests pass. If `paymentConfirm` was covered by tests, fix their imports here.

- [ ] **Step 5: Delete `paymentConfirm.js` once nothing imports it**

```bash
grep -rn "require.*handlers/paymentConfirm" src/
git rm src/handlers/paymentConfirm.js
```

The grep should return zero matches before the `rm`. If matches remain, fix them first.

- [ ] **Step 6: Commit**

```bash
git add src/services/orderFulfillmentService.js src/services/paymentPoller.js src/handlers/adminActions.js
git commit -m "refactor(bot): move deliverOrder into orderFulfillmentService; drop paymentConfirm handler"
```

---

## Task 5: Drop the in-bot admin handler

**Files:**
- Delete: `src/handlers/adminActions.js`

The admin dashboard owns stock entry, refunds, product edits, transaction matching. The bot's 681-line admin handler module is fully redundant.

- [ ] **Step 1: Verify the dashboard covers what the handler did**

For each major capability in `adminActions.js`, confirm a dashboard route exists. The audit needs to be verbatim — list each block in the file:

```bash
grep -nE "^(async )?function |bot\.(action|command|hears|on)" src/handlers/adminActions.js | head -80
```

Cross-reference to `src/api/routes/admin/`. The expected mapping is:

| Bot capability | Dashboard route |
|----------------|-----------------|
| Add stock to product | `POST /api/v1/admin/stock` |
| Refund order | `POST /api/v1/admin/orders/:id/refund` (or similar — verify) |
| List orders | `GET /api/v1/admin/orders` |
| Manage products | `*/api/v1/admin/products` |
| Bulk topup match | `POST /api/v1/admin/transactions/match` (or similar) |

If any row above maps to a missing dashboard route, **stop**. Add a TODO note in the plan and either (a) implement the missing route in this sub-project (out of scope for thin-bot, but acceptable if blocking), or (b) hand back to the user with the gap surfaced.

- [ ] **Step 2: Delete**

```bash
git rm src/handlers/adminActions.js
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(bot): drop in-bot admin handler — dashboard owns admin actions"
```

---

## Task 6: Add deep-link handling to /start

**Files:**
- Modify: `src/commands/start.js`
- Create: `tests/bot/start-deep-link.test.js`

When the customer follows a link like `https://t.me/<bot>?startapp=order_42`, Telegram opens the bot with the message `/start order_42`. The Mini App spec also supports `start_param` via `web_app_data.button_text`. The simplest behavior: parse the `start_param` from `ctx.startPayload`, and if it matches `order_<n>`, render a Mini App button that deep-links to the order page (`MINIAPP_URL + /don-hang/<n>`).

- [ ] **Step 1: Write the failing test**

Create `tests/bot/start-deep-link.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');

process.env.MINIAPP_URL = 'https://taikhoantenhat.example.com/';

const { handleStart } = require('../../src/commands/start');

function makeCtx({ payload, from = { id: 1, first_name: 'Khoa' }, sentRef }) {
  return {
    from,
    startPayload: payload || '',
    reply: async (text, extra) => { sentRef.push({ text, extra }); },
    replyWithHTML: async (text, extra) => { sentRef.push({ text, extra, html: true }); },
  };
}

test('/start with no payload renders default welcome + root Mini App button', async () => {
  const sent = [];
  await handleStart(makeCtx({ sentRef: sent }));
  assert.strictEqual(sent.length, 1);
  const button = sent[0].extra.reply_markup.inline_keyboard[0][0];
  assert.strictEqual(button.web_app.url, 'https://taikhoantenhat.example.com/');
});

test('/start order_42 renders a button to the order page', async () => {
  const sent = [];
  await handleStart(makeCtx({ payload: 'order_42', sentRef: sent }));
  const button = sent[0].extra.reply_markup.inline_keyboard[0][0];
  assert.match(button.web_app.url, /\/don-hang\/42$/);
});

test('/start with malformed payload falls back to default', async () => {
  const sent = [];
  await handleStart(makeCtx({ payload: '../../etc/passwd', sentRef: sent }));
  const button = sent[0].extra.reply_markup.inline_keyboard[0][0];
  assert.strictEqual(button.web_app.url, 'https://taikhoantenhat.example.com/');
});
```

- [ ] **Step 2: Run to fail**

```bash
node --test tests/bot/start-deep-link.test.js
```

Expected: failures (current handler ignores `startPayload`).

- [ ] **Step 3: Implement**

Edit `src/commands/start.js`:

```js
const userService = require('../services/userService');
const messageTemplateService = require('../services/messageTemplateService');

const ORDER_PAYLOAD = /^order_(\d{1,12})$/;

function resolveDeepLink(payload) {
  const base = (process.env.MINIAPP_URL || '').replace(/\/$/, '');
  const m = ORDER_PAYLOAD.exec(payload || '');
  if (m) return `${base}/don-hang/${m[1]}`;
  return process.env.MINIAPP_URL;
}

async function handleStart(ctx) {
  const user = userService.findOrCreate(ctx.from);

  const name = user.full_name || ctx.from?.first_name || ctx.from?.username || 'bạn';
  const username = user.username || ctx.from?.username || '';
  const balance = user.balance ?? 0;

  const text = messageTemplateService.render('welcome', {
    name, username, balance: String(balance),
  });

  const url = resolveDeepLink(ctx.startPayload);

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{ text: 'Mở cửa hàng', web_app: { url } }]],
    },
  });
}

module.exports = (bot) => {
  bot.start(handleStart);
};
module.exports.handleStart = handleStart;
```

- [ ] **Step 4: Run all bot tests**

```bash
node --test tests/bot/
```

Expected: all green, including the existing `/start` test from sub-project #1 and the new deep-link tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/start.js tests/bot/start-deep-link.test.js
git commit -m "feat(bot): /start parses start_param=order_<id> for Mini App deep link"
```

---

## Task 7: Slim `src/bot/index.js`

**Files:**
- Modify: `src/bot/index.js`

This is the touchpoint that ties the file map together. Drop every reference to deleted modules, drop the bulk command list, register only what the thin bot needs.

- [ ] **Step 1: Replace the file**

Overwrite `src/bot/index.js`:

```js
const { Telegraf, session } = require('telegraf');
const config = require('../config');

function createBot() {
  if (!config.BOT_TOKEN || config.BOT_TOKEN === 'your_bot_token_here') {
    console.error('❌ BOT_TOKEN chưa được cấu hình! Hãy cập nhật file .env');
    process.exit(1);
  }

  const bot = new Telegraf(config.BOT_TOKEN);
  bot.use(session());

  bot.catch((err, ctx) => {
    console.error(`❌ Error for ${ctx.updateType}:`, err.message);
    try { ctx.reply('❌ Đã xảy ra lỗi. Vui lòng thử lại sau.'); } catch {}
  });

  // Two real commands: entry point + identity utility.
  require('../commands/start')(bot);
  require('../commands/myid')(bot);

  // Fallback: any other input nudges the user back to the Mini App.
  require('./fallback')(bot);

  // Replace the menu — only /start and /myid show in the slash UI.
  const COMMANDS = [
    { command: 'start', description: 'Mở cửa hàng' },
    { command: 'myid',  description: 'Lấy ID của bạn' },
  ];
  (async () => {
    try {
      await bot.telegram.deleteMyCommands();
      await bot.telegram.setMyCommands(COMMANDS);
      console.log(`📋 Telegram bot menu updated (${COMMANDS.length} commands)`);
    } catch (err) {
      console.error('⚠️ setMyCommands failed:', err.message);
    }
  })();

  return bot;
}

module.exports = { createBot };
```

- [ ] **Step 2: Boot the bot to confirm it loads cleanly**

```bash
( node src/index.js & echo $! > /tmp/bot.pid; sleep 4; kill $(cat /tmp/bot.pid) ) || true
```

Expected log lines: `📋 Telegram bot menu updated (2 commands)` and `🤖 Taikhoantenhat Bot đã khởi động!`. No "Cannot find module" errors. If a require fails, the bot file map drift is the bug — track it down by re-running the audits from Task 1.

- [ ] **Step 3: Commit (the fallback file doesn't exist yet — that's Task 8; commit only `src/bot/index.js` here, the bot will fail to boot until Task 8 lands)**

Actually: the fallback handler is required-in. Combine Tasks 7 and 8 into one commit if you prefer; otherwise stage the changes and write the fallback file before committing.

For clarity, do **Task 8 immediately** before committing this task.

---

## Task 8: Fallback handler

**Files:**
- Create: `src/bot/fallback.js`
- Create: `tests/bot/fallback.test.js`

The fallback handler responds to any message Telegram sends to the bot that isn't `/start` or `/myid`. It sends a short Vietnamese nudge with the Mini App button. This covers commands removed in Task 2 (e.g. someone typing `/balance` after the migration), random text DMs, and inline button taps that no longer have handlers.

- [ ] **Step 1: Write the failing test**

Create `tests/bot/fallback.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');

process.env.MINIAPP_URL = 'https://taikhoantenhat.example.com/';

const { handleFallback } = require('../../src/bot/fallback');

function makeCtx({ text, sentRef }) {
  return {
    from: { id: 7, first_name: 'X' },
    message: text ? { text } : undefined,
    reply: async (t, extra) => { sentRef.push({ text: t, extra }); },
  };
}

test('fallback nudges user to Mini App with a button', async () => {
  const sent = [];
  await handleFallback(makeCtx({ text: 'gì cũng được', sentRef: sent }));
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text, /Mini App|cửa hàng/i);
  const btn = sent[0].extra.reply_markup.inline_keyboard[0][0];
  assert.strictEqual(btn.web_app.url, 'https://taikhoantenhat.example.com/');
});

test('fallback ignores its own /start and /myid (those have explicit handlers)', async () => {
  // The handler is registered for unmatched updates only; we still verify
  // the function itself does the right thing if called with /start.
  const sent = [];
  await handleFallback(makeCtx({ text: '/start', sentRef: sent }));
  // Behaviour: still nudge, since this function is the catch-all.
  // The bot wiring in Task 7 ensures /start never reaches us.
  assert.strictEqual(sent.length, 1);
});
```

- [ ] **Step 2: Run to fail**

```bash
node --test tests/bot/fallback.test.js
```

- [ ] **Step 3: Implement**

Create `src/bot/fallback.js`:

```js
const NUDGE_TEXT =
  'Mọi tính năng đã chuyển vào Mini App.\nBấm nút bên dưới để mở cửa hàng.';

async function handleFallback(ctx) {
  const url = process.env.MINIAPP_URL;
  await ctx.reply(NUDGE_TEXT, {
    reply_markup: {
      inline_keyboard: [[{ text: 'Mở cửa hàng', web_app: { url } }]],
    },
  });
}

module.exports = (bot) => {
  // Match any text/command that wasn't already handled by /start or /myid.
  bot.on('text', handleFallback);
  // Stale callback queries from old inline buttons — answer + nudge.
  bot.on('callback_query', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch {}
    await handleFallback(ctx);
  });
};

module.exports.handleFallback = handleFallback;
```

`bot.on('text', ...)` runs after `bot.start(...)` and `bot.command('myid', ...)` if those are registered first (Telegraf evaluates in registration order). Task 7 registers them first, so this is safe.

- [ ] **Step 4: Run all bot tests**

```bash
node --test tests/bot/
```

Expected: all green.

- [ ] **Step 5: Commit (combined with Task 7's index.js)**

```bash
git add src/bot/index.js src/bot/fallback.js tests/bot/fallback.test.js
git commit -m "feat(bot): slim index to /start + /myid + fallback nudge"
```

---

## Task 9: Drop unused utility module(s)

**Files:**
- Delete (conditionally): `src/utils/keyboard.js`

`src/utils/keyboard.js` historically held `productListKeyboard`, `quantityKeyboard`, and `formatPrice`. The first two are dead with the purchase commands gone. `formatPrice` may still be imported elsewhere (e.g. `notificationService`).

- [ ] **Step 1: Audit imports**

```bash
grep -rn "require.*utils/keyboard" src/ tests/ --exclude-dir=node_modules
```

- [ ] **Step 2: Decide**

- If only one or two callers remain and they use only `formatPrice`, move `formatPrice` into `src/utils/format.js` and update those callers, then delete `src/utils/keyboard.js`.
- If no callers remain, delete `src/utils/keyboard.js` directly.
- If many callers remain, leave the file in place; just delete the unused exports inside it.

Pick the path with the smallest diff.

- [ ] **Step 3: Apply the chosen change**

Example for "many callers, just trim exports":

```js
// src/utils/keyboard.js — keep only formatPrice
function formatPrice(amount) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(amount);
}
module.exports = { formatPrice };
```

- [ ] **Step 4: Run tests**

```bash
node --test tests/
```

- [ ] **Step 5: Commit**

```bash
git add src/utils/keyboard.js src/utils/format.js
git commit -m "chore(bot): trim utils/keyboard to formatPrice (or delete if unused)"
```

---

## Task 10: Trim message templates that lost their callers

**Files:**
- Modify: `src/services/messageTemplateService.js`

Templates seeded for purged commands (e.g. `cmd_balance`, `cmd_account_info`, `cmd_orders_*`, `cmd_support`) no longer have callers. Removing them keeps the admin "edit copy" UI clean and avoids future confusion.

- [ ] **Step 1: List current templates**

```bash
node -e 'const s = require("./src/services/messageTemplateService"); console.log(s.list().map(t => t.key));'
```

- [ ] **Step 2: Cross-reference**

For each template key, grep for `render('<key>'`:

```bash
for key in $(node -e 'const s = require("./src/services/messageTemplateService"); console.log(s.list().map(t => t.key).join(" "))'); do
  count=$(grep -rn "render('$key'" src/ --exclude-dir=node_modules | wc -l)
  echo "$count $key"
done | sort -n
```

Templates with `0` callers are candidates for removal. Confirm with the engineer before removing — admin may want to keep some as future template scaffolding.

- [ ] **Step 3: Edit the seed list**

Open `src/services/messageTemplateService.js` and remove the unused templates from the seed array (or DB-seeding migration if seeded in `012_message_templates.js`). Keep at minimum: `welcome`, `cmd_myid`.

- [ ] **Step 4: Run any tests for the service**

```bash
node --test tests/messageTemplateService.test.js
```

If the test asserts a specific count, update that assertion to the new lower count. The existing test (`tests/templates.test.js` per recent commit history) was relaxed to `>= 18` in commit `fabfeb8` — adjust the floor down to match the new template set.

- [ ] **Step 5: Commit**

```bash
git add src/services/messageTemplateService.js src/database/migrations/012_message_templates.js tests/templates.test.js
git commit -m "chore(templates): drop templates whose commands were removed"
```

If the migration is already-applied on a real DB, the deleted templates remain as rows in `message_templates`. Either accept that (a row admin can ignore) or add a small migration `015_thin_bot_template_cleanup.js` that deletes them by key. Decide based on whether stale rows would confuse the admin UI.

---

## Task 11: Smoke test + tag

**Files:**
- (none modified)

- [ ] **Step 1: Run all tests**

```bash
node --test tests/
```

Expected: green.

- [ ] **Step 2: Boot the bot and probe Telegram**

```bash
node src/index.js
```

In Telegram (real bot, real account):
1. `/start` — returns Vietnamese welcome + "Mở cửa hàng" button.
2. Tap the button — Mini App opens.
3. `/myid` — returns the user's Telegram ID.
4. Type random text "ahihi" — bot replies with the nudge + button.
5. Type `/balance` (a removed command) — bot replies with the nudge + button (not "command not found").
6. Tap the slash menu in Telegram — the menu shows exactly two entries: `start`, `myid`.

If all six pass, kill the process.

- [ ] **Step 3: Verify a delivered order DM still arrives**

Use the Mini App (sub-project #3) or a manual `POST /api/v1/orders` to create an order, transfer the matching amount via MBBank, and wait. The notification path (`paymentPoller` → `orderFulfillmentService.deliverOrder` → `notificationService.sendDelivery`) should DM the user the keys + usage instructions. If the DM doesn't arrive:
- Check the API logs for "deliverOrder" errors.
- Confirm `orderFulfillmentService.js` is the canonical source (Task 4).

- [ ] **Step 4: Tag the milestone**

```bash
git tag -a v0.7-thin-bot -m "Bot reduced to /start + /myid + fallback; notifications and delivery DMs intact"
```

- [ ] **Step 5: Hand-back checklist**

```text
Smoke checks:
  1. node --test tests/ → green
  2. /start → Vietnamese welcome + Mini App button
  3. /myid → returns ID
  4. Any other input → nudge + Mini App button
  5. Slash-menu shows only /start, /myid
  6. Delivered order produces a DM with keys (paymentPoller still wired)
  7. grep -rn "productSelect\|quantitySelect\|adminActions\|paymentConfirm" src/ → zero
  8. wc -l src/handlers/*.js → only handlers that remain (probably zero, or only what we kept)
```

This concludes sub-project #7. The bot is now thin per the umbrella spec. Sub-project #6 (per-order chat + DM bridge) extends the bot's outbound surface; sub-project #8 (cleanup) deletes the legacy public web pages.

---

## Risks and notes

- **Hidden admin dependency on a bot command.** If admin operates day-to-day from the bot today, removing it disrupts their workflow even if the dashboard has the equivalent feature. Surface this in the user handoff: confirm the admin is comfortable using the dashboard before merging this sub-project.
- **Refunds.** `src/commands/refund.js` was the admin's interactive refund flow. The dashboard equivalent must exist; if `POST /api/v1/admin/orders/:id/refund` (or similar) is missing, this sub-project introduces a regression. Task 5's audit covers this — do not skip it.
- **Stock entry UX.** `adminActions.js` had a multi-step "paste many lines, confirm" stock entry flow that's quite ergonomic in the bot. The dashboard's stock route accepts a JSON payload; if the dashboard doesn't yet have the multi-line paste UI, admin loses an ergonomic. That's a UX regression worth flagging, not a correctness one.
- **Old customers with active inline buttons.** Anyone who had the bot's inline product menu open in their Telegram chat will tap a `product_<id>` button and get the fallback nudge. This is expected behavior — the fallback handler is exactly there to absorb stale callbacks.
- **Sub-project #6 (chat) reuses the bot's outbound DM channel.** The thin bot still has a Telegram client (`bot.telegram.sendMessage`) — sub-project #6 hooks into that to bridge admin↔customer messages. Don't remove `bot.launch()` or the `notificationService.init(bot)` wiring; those are load-bearing for #6.
- **Setting `setMyCommands` does not remove old commands from running clients.** Telegram clients cache the menu. The `deleteMyCommands` + `setMyCommands` pair handles the server side; clients will refresh within minutes. If a tester sees old commands in the menu after restart, ask them to restart Telegram or clear the chat — server-side state is correct.
