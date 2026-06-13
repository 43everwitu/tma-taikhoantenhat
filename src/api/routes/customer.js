const { Router } = require('express');
const { z } = require('zod');
const db = require('../../database');
const orderService = require('../../services/orderService');
const paymentService = require('../../services/paymentService');
const userService = require('../../services/userService');
const topupService = require('../../services/topupService');
const discountService = require('../../services/discountService');
const { getBackorderWaitMode } = require('../../utils/backorderWaitWindow');
const { requireCustomer, optionalCustomer } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = Router();

const orderBody = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(10),
  bankIndex: z.number().int().min(0).max(1).optional().default(0),
  variantId: z.number().int().positive().nullable().optional(),
  inputValue: z.string().min(1).max(200).nullable().optional(),
  discountCode: z.string().max(40).nullable().optional(),
});

const getDiscountCode = db.prepare('SELECT code FROM discount_codes WHERE id = ?');

function apiError(status, code, message) {
  const err = new Error(code);
  err.status = status;
  err.body = { success: false, error: { code, message } };
  return err;
}

function createOrderPayload(telegramId, payload) {
  const { productId, quantity, bankIndex, variantId, inputValue, discountCode } = payload;

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(productId);
  if (!product) throw apiError(404, 'NOT_FOUND', 'Sản phẩm không tồn tại');

  let variant = null;
  if (variantId) {
    variant = db.prepare('SELECT * FROM product_variants WHERE id = ? AND product_id = ? AND is_active = 1').get(variantId, productId);
    if (!variant) throw apiError(404, 'VARIANT_NOT_FOUND', 'Biến thể không tồn tại');
    if (variant.requires_input && !inputValue) {
      throw apiError(400, 'INPUT_REQUIRED', `Vui lòng cung cấp ${variant.input_label || 'thông tin'}`);
    }
  }

  if (!(variant && variant.is_backorder)) {
    let available;
    if (variant) {
      available = db.prepare(
        'SELECT COUNT(*) as c FROM stock WHERE product_id = ? AND variant_id = ? AND is_sold = 0 AND reserved_for_order_id IS NULL'
      ).get(productId, variantId).c;
    } else {
      const stockCount = db.prepare(
        'SELECT COUNT(*) as c FROM stock WHERE product_id = ? AND variant_id IS NULL AND is_sold = 0 AND reserved_for_order_id IS NULL'
      ).get(productId).c;
      available = stockCount > 0 ? stockCount : (product.sheet_stock || 0);
    }
    if (available < quantity) {
      throw apiError(400, 'INSUFFICIENT_STOCK', `Chỉ còn ${available} sản phẩm`);
    }
  }

  const unitPrice = variant ? variant.price : product.price;
  const subtotal = unitPrice * quantity;
  const r = discountService.resolveBestForOrder(discountCode, subtotal, telegramId);
  if (!r.ok) throw apiError(400, 'DISCOUNT_INVALID', r.reason);

  const discountCodeId = r.code?.id ?? null;
  const discountAmount = r.discount;
  const totalPrice = Math.max(0, subtotal - r.discount);

  const order = orderService.create(
    telegramId, productId, quantity, totalPrice,
    {
      source: 'web',
      bankName: paymentService.getBank(bankIndex).NAME,
      variantId: variantId ?? null,
      inputValue: inputValue ?? null,
      discountCodeId,
      discountAmount,
    }
  );

  const payment = paymentService.buildPayment(order.id, totalPrice, bankIndex);

  return {
    order: { id: order.id, status: order.status, expiresAt: order.expires_at },
    payment: {
      qrUrl: payment.qrUrl,
      paymentCode: payment.paymentCode,
      bankName: payment.bankName,
      accountNumber: payment.accountNumber,
      accountName: payment.accountName,
      amount: totalPrice,
      discountCode: discountCodeId ? getDiscountCode.get(discountCodeId)?.code : null,
      discountAmount,
    },
  };
}

function wakePoller(req) {
  const poller = req.app.locals.getPaymentPoller?.();
  if (poller) poller.ensureRunning();
}

const createOrderBatch = db.transaction((telegramId, items) => (
  items.map((item, index) => (
    createOrderPayload(telegramId, {
      ...item,
      discountCode: index === 0 ? item.discountCode : null,
    })
  ))
));

// GET /me — return logged-in customer profile (balance + identity)
router.get('/me', requireCustomer, (req, res) => {
  const u = userService.get(req.customer.telegramId);
  if (!u) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  res.json({ success: true, data: {
    telegramId: u.telegram_id,
    username: u.username || null,
    fullName: u.full_name || '',
    balance: u.balance || 0,
    createdAt: u.created_at,
    email: u.email || null,
    hasPassword: !!u.password_hash,
  }});
});

// POST /topups — create a wallet topup (QR + memo PNS<username>|PNSU<id>)
router.post('/topups', requireCustomer, validate(z.object({
  amount: z.coerce.number().int().positive(),
})), (req, res) => {
  const { amount } = req.validated;
  const minAmount = topupService.getMinAmount();
  if (amount < minAmount) {
    return res.status(400).json({
      success: false,
      error: { code: 'BELOW_MIN', message: `Số tiền tối thiểu ${minAmount.toLocaleString('vi')}đ` },
    });
  }

  const user = userService.get(req.customer.telegramId);
  if (!user) return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND' } });

  const topup = topupService.create({
    telegram_id: user.telegram_id,
    username: user.username,
    amount,
  });
  const qrUrl = paymentService.generateQRUrl(amount, topup.memo);

  // Wake the poller so the credit lands without waiting for the next idle tick.
  const poller = req.app.locals.getPaymentPoller?.();
  if (poller) poller.ensureRunning();

  res.json({ success: true, data: {
    id: topup.id,
    memo: topup.memo,
    amount,
    qrUrl,
    expiresAt: topup.expiresAt,
  }});
});

// GET /topups — recent wallet topups for this customer
router.get('/topups', requireCustomer, (req, res) => {
  const rows = db.prepare(`
    SELECT id, amount, memo, status, requested_at, matched_at, expires_at
    FROM wallet_topups
    WHERE user_id = ?
    ORDER BY requested_at DESC
    LIMIT 20
  `).all(req.customer.telegramId);
  res.json({ success: true, data: rows });
});

// POST /discounts/preview — Validate code + compute discount for given subtotal
router.post('/discounts/preview', requireCustomer, validate(z.object({
  code: z.string().min(1).max(40),
  subtotal: z.number().int().nonnegative(),
})), (req, res) => {
  const r = discountService.resolveBestForOrder(req.validated.code, req.validated.subtotal, req.customer.telegramId);
  if (!r.ok) return res.status(400).json({ success: false, error: { code: 'DISCOUNT_INVALID', message: r.reason } });
  res.json({ success: true, data: {
    discount: r.discount,
    total: req.validated.subtotal - r.discount,
    code: r.code?.code || null,
    source: r.source,
  } });
});

// POST /orders — Create order (requires customer auth)
router.post('/orders', requireCustomer, validate(orderBody), (req, res) => {
  try {
    const data = createOrderPayload(req.customer.telegramId, req.validated);
    wakePoller(req);
    res.json({ success: true, data });
  } catch (e) {
    if (e.body) return res.status(e.status || 400).json(e.body);
    throw e;
  }
});

// POST /orders/batch — create multiple cart orders in one request.
router.post('/orders/batch', requireCustomer, validate(z.object({
  items: z.array(orderBody).min(1).max(10),
})), (req, res) => {
  try {
    const data = createOrderBatch(req.customer.telegramId, req.validated.items);
    wakePoller(req);
    res.json({ success: true, data });
  } catch (e) {
    if (e.body) return res.status(e.status || 400).json(e.body);
    throw e;
  }
});

// GET /orders/:id/status — Poll order status (for payment page)
router.get('/orders/:id/status', (req, res) => {
  const id = parseInt(req.params.id);
  const order = orderService.getById(id);
  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(order.product_id);
  const variant = order.variant_id
    ? db.prepare('SELECT is_backorder FROM product_variants WHERE id = ?').get(order.variant_id)
    : null;
  const isBackorder = !!variant?.is_backorder;
  const backorderWaitMode = isBackorder ? getBackorderWaitMode() : undefined;

  // Derive QR from the stored payment_code so what the customer scans matches
  // what the poller searches for in MBBank transactions.
  const banks = paymentService.getBanks();
  const bank = banks.find(b => b.NAME === order.bank_name) || banks[0];
  const qrUrl = paymentService.generateQRUrl(order.total_price, order.payment_code, bank);

  // Prefer per-order snapshot in delivered_keys_json (admin edits + manual
  // delivery write here); fall back to stock scan for legacy orders.
  let accounts;
  if (order.status === 'delivered') {
    const snapshot = orderService.getDeliveredKeys(order.id);
    if (snapshot && snapshot.length > 0) {
      accounts = snapshot;
    } else if (order.delivered_at) {
      accounts = db.prepare(`
        SELECT data FROM stock
        WHERE sold_to = ? AND product_id = ? AND sold_at <= ?
        ORDER BY sold_at DESC LIMIT ?
      `).all(order.user_id, order.product_id, order.delivered_at, order.quantity).map(r => r.data);
    }
  }

  res.json({ success: true, data: {
    id: String(order.id),
    status: order.status,
    totalPrice: order.total_price,
    paymentCode: order.payment_code,
    qrUrl,
    bankName: order.bank_name,
    accountNumber: bank.ACCOUNT,
    accountName: bank.ACCOUNT_NAME,
    expiresAt: order.expires_at,
    productName: product ? product.name : '',
    quantity: order.quantity,
    isBackorder,
    backorderWaitMode,
    accounts,
    usageInstructions: order.status === 'delivered' && product ? (product.usage_instructions || null) : undefined,
  }});
});

// GET /orders/my — Customer order history
router.get('/orders/my', requireCustomer, (req, res) => {
  const orders = orderService.getRecentByUser(req.customer.telegramId, 20);
  res.json({ success: true, data: orders });
});

// GET /orders/:id — Order detail
router.get('/orders/:id', requireCustomer, (req, res) => {
  const order = orderService.getById(parseInt(req.params.id));
  if (!order || order.user_id !== req.customer.telegramId) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Đơn hàng không tìm thấy' } });
  }
  res.json({ success: true, data: order });
});

// POST /products/:id/follow
router.post('/products/:id/follow', requireCustomer, (req, res) => {
  const productId = parseInt(req.params.id);
  try {
    db.prepare('INSERT OR IGNORE INTO product_follows (user_id, product_id) VALUES (?, ?)').run(req.customer.telegramId, productId);
    res.json({ success: true, data: { following: true } });
  } catch {
    res.status(400).json({ success: false, error: { code: 'FOLLOW_FAILED', message: 'Không thể theo dõi sản phẩm' } });
  }
});

// DELETE /products/:id/follow
router.delete('/products/:id/follow', requireCustomer, (req, res) => {
  db.prepare('DELETE FROM product_follows WHERE user_id = ? AND product_id = ?').run(req.customer.telegramId, parseInt(req.params.id));
  res.json({ success: true, data: { following: false } });
});

// GET /notifications/my
router.get('/notifications/my', requireCustomer, (req, res) => {
  const notifications = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(req.customer.telegramId);

  res.json({ success: true, data: notifications });
});

// PATCH /notifications/:id/read
router.patch('/notifications/:id/read', requireCustomer, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(parseInt(req.params.id), req.customer.telegramId);
  res.json({ success: true });
});

module.exports = router;
