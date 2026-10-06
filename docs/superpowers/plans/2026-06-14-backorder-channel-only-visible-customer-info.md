# Backorder Channel-Only Visible Customer Info Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa thông báo backorder về order channel thôi và cho quản lý mở spoiler để đọc đầy đủ customer input, gồm password thật.

**Architecture:** Tách formatter customer input dành riêng cho order channel khỏi formatter admin hiện đang mask secret. Backorder flow chỉ gọi `orderChannelService.postOrderCard`, còn customer wait message giữ nguyên.

**Tech Stack:** Node.js CommonJS, SQLite runtime DB, Telegram HTML parse mode, `node:test`.

---

## File Structure

- Modify: `src/utils/messages.js`
  - Thêm `formatCustomerInputForChannel(inputValueEncrypted)` để decrypt và render customer input không mask secret.
  - Giữ `buildCustomerInputBlock` và `formatCustomerInputPlain` để không ảnh hưởng admin/template hiện có.

- Modify: `src/services/orderChannelService.js`
  - Import formatter mới.
  - Render customer info đã escape HTML bên trong `<tg-spoiler>`.

- Modify: `src/services/paymentPoller.js`
  - Gỡ admin notify trong nhánh `result.success && result.backorder`.

- Modify: `src/services/orderFulfillmentService.js`
  - Gỡ admin notify trong nhánh `result.backorder`.

- Create: `tests/services/orderChannelBackorderCustomerInfo.test.js`
  - Kiểm tra card order channel giữ spoiler nhưng hiển thị giá trị thật.

- Create: `tests/services/orderFulfillmentBackorderChannelOnly.test.js`
  - Kiểm tra `deliverOrder` backorder không gọi `adminNotifyService.notify` và vẫn gọi `orderChannelService.postOrderCard`.

## Task 1: Customer Input Formatter For Channel

**Files:**
- Create: `tests/services/orderChannelBackorderCustomerInfo.test.js`
- Modify: `src/utils/messages.js`
- Modify: `src/services/orderChannelService.js`

- [ ] **Step 1: Write failing test**

Create `tests/services/orderChannelBackorderCustomerInfo.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const { encryptString } = require('../../src/utils/secrets');
const { formatCustomerInputForChannel } = require('../../src/utils/messages');
const { buildCard } = require('../../src/services/orderChannelService');

test('order channel customer info stays spoilered but shows password value after reveal', () => {
  const inputValue = encryptString(JSON.stringify({
    'Email Coursera': 'linh@example.com',
    'Password Coursera': 'P@ss<123>&',
  }));

  const customerInfo = formatCustomerInputForChannel(inputValue);
  const text = buildCard({
    order: {
      id: 100603,
      payment_code: '100603',
      quantity: 1,
      total_price: 450260,
    },
    product: { name: 'Tài Khoản Claude Pro/Claude Max' },
    variant: null,
    keys: null,
    customerInfo,
  });

  assert.match(text, /<tg-spoiler>/);
  assert.match(text, /Email Coursera: linh@example\.com/);
  assert.match(text, /Password Coursera: P@ss&lt;123&gt;&amp;/);
  assert.doesNotMatch(text, /••••••/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/services/orderChannelBackorderCustomerInfo.test.js
```

Expected: FAIL because `formatCustomerInputForChannel` is not exported.

- [ ] **Step 3: Implement formatter and channel usage**

In `src/utils/messages.js`, add this function near `formatCustomerInputPlain`:

```js
function formatCustomerInputForChannel(inputValueEncrypted) {
  if (!inputValueEncrypted) return null;
  try {
    const { decryptString } = require('./secrets');
    const raw = decryptString(inputValueEncrypted);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return escapeHtml(String(raw));
    const lines = [];
    for (const [label, value] of Object.entries(parsed)) {
      if (!value) continue;
      const labelless = !label || /^__field_\d+$/.test(label);
      const shown = escapeHtml(String(value));
      lines.push(labelless ? shown : `${escapeHtml(label)}: ${shown}`);
    }
    return lines.length > 0 ? lines.join('\n') : null;
  } catch {
    return null;
  }
}
```

Export it:

```js
module.exports.formatCustomerInputForChannel = formatCustomerInputForChannel;
```

In `src/services/orderChannelService.js`, replace `formatCustomerInputPlain` with `formatCustomerInputForChannel`, and change `customerLine` to avoid double-escaping:

```js
const { formatCustomerInputForChannel } = require('../utils/messages');

const customerLine = customerInfo
  ? `\n📋 <b>Thông tin KH</b>:\n<tg-spoiler>${customerInfo}</tg-spoiler>`
  : '';

const customerInfo = formatCustomerInputForChannel(order.input_value);
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/services/orderChannelBackorderCustomerInfo.test.js
```

Expected: PASS.

## Task 2: Backorder Fulfillment Sends Channel Only

**Files:**
- Create: `tests/services/orderFulfillmentBackorderChannelOnly.test.js`
- Modify: `src/services/orderFulfillmentService.js`

- [ ] **Step 1: Write failing test**

Create `tests/services/orderFulfillmentBackorderChannelOnly.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');

function fresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('deliverOrder backorder posts to order channel without admin notify', async (t) => {
  const orderService = require('../../src/services/orderService');
  const productService = require('../../src/services/productService');
  const adminNotifyService = require('../../src/services/adminNotifyService');
  const orderChannelService = require('../../src/services/orderChannelService');

  const originalConfirmAndDeliver = orderService.confirmAndDeliver;
  const originalGetProduct = productService.getById;
  const originalNotify = adminNotifyService.notify;
  const originalPostOrderCard = orderChannelService.postOrderCard;

  const channelCalls = [];
  const adminCalls = [];

  t.after(() => {
    orderService.confirmAndDeliver = originalConfirmAndDeliver;
    productService.getById = originalGetProduct;
    adminNotifyService.notify = originalNotify;
    orderChannelService.postOrderCard = originalPostOrderCard;
  });

  orderService.confirmAndDeliver = () => ({
    success: true,
    backorder: true,
    order: {
      id: 100603,
      product_id: 55,
      variant_id: null,
      quantity: 1,
      total_price: 450260,
      user_id: 480794224,
    },
  });
  productService.getById = () => ({ id: 55, name: 'Tài Khoản Claude Pro/Claude Max' });
  adminNotifyService.notify = async (...args) => {
    adminCalls.push(args);
  };
  orderChannelService.postOrderCard = async (...args) => {
    channelCalls.push(args);
  };

  const { deliverOrder } = fresh('../../src/services/orderFulfillmentService');
  const result = await deliverOrder({}, 100603);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.backorder, true);
  assert.strictEqual(adminCalls.length, 0);
  assert.strictEqual(channelCalls.length, 1);
  assert.strictEqual(channelCalls[0][0].keys, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/services/orderFulfillmentBackorderChannelOnly.test.js
```

Expected: FAIL because `adminNotifyService.notify` is still called.

- [ ] **Step 3: Remove admin notify from backorder branch**

In `src/services/orderFulfillmentService.js`, remove unused imports:

```js
const adminNotifyService = require('./adminNotifyService');
const { richifyText, buildCustomerInputBlock } = require('../utils/messages');
const messageTemplateService = require('./messageTemplateService');
```

Replace them with:

```js
const { richifyText } = require('../utils/messages');
```

Then reduce the backorder branch to:

```js
if (result.backorder) {
    await orderChannelService.postOrderCard({ order, product, variant, keys: null });
    return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/services/orderFulfillmentBackorderChannelOnly.test.js
```

Expected: PASS.

## Task 3: Payment Poller Backorder Sends Channel Only

**Files:**
- Modify: `src/services/paymentPoller.js`

- [ ] **Step 1: Add static regression check before implementation**

Run:

```bash
rg -n "adminNotifyService\\.notify\\('backorder_paid'|admin\\.backorder_paid|buildCustomerInputBlock" src/services/paymentPoller.js
```

Expected: output includes the current backorder admin notify lines.

- [ ] **Step 2: Remove admin notify code from payment poller**

In `src/services/paymentPoller.js`, remove `buildCustomerInputBlock` from the messages import if it becomes unused.

In the `if (result.success && result.backorder)` branch, delete the block that builds `inputBlock` and calls:

```js
adminNotifyService.notify('backorder_paid', ...)
```

Keep `this.matchCount++`, customer wait message, and `orderChannelService.postOrderCard`.

- [ ] **Step 3: Verify static regression check**

Run:

```bash
rg -n "adminNotifyService\\.notify\\('backorder_paid'|admin\\.backorder_paid|buildCustomerInputBlock" src/services/paymentPoller.js
```

Expected: no output.

## Task 4: Final Verification

**Files:**
- Verify changed backend files and new tests.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test --test-concurrency=1 tests/services/orderChannelBackorderCustomerInfo.test.js tests/services/orderFulfillmentBackorderChannelOnly.test.js
```

Expected: both tests pass.

- [ ] **Step 2: Run syntax/import smoke check**

Run:

```bash
node -e "require('./src/utils/messages'); require('./src/services/orderChannelService'); require('./src/services/orderFulfillmentService'); require('./src/services/paymentPoller'); console.log('imports ok')"
```

Expected: prints `imports ok`.

- [ ] **Step 3: Check diff scope**

Run:

```bash
git diff -- src/utils/messages.js src/services/orderChannelService.js src/services/orderFulfillmentService.js src/services/paymentPoller.js tests/services/orderChannelBackorderCustomerInfo.test.js tests/services/orderFulfillmentBackorderChannelOnly.test.js
```

Expected: diff only covers backorder channel-only notification and channel customer input formatter.
