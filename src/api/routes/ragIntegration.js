// src/api/routes/ragIntegration.js
const express = require('express');
const { Router } = require('express');
const config = require('../../config');
const { verifySignedPayload } = require('../../services/twofaIntegrationAuth');
const { getBindingsForOrder } = require('../../services/twofaBindingService');

const router = Router();
const rawJson = express.raw({ type: 'application/json', limit: '20kb' });

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

function verifyRagAuth(req, res, next) {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const timestamp = req.get('x-tktn-timestamp');
  const signature = req.get('x-tktn-signature');

  const verified = verifySignedPayload({
    secret: config.RAG_INTEGRATION_SECRET,
    timestamp,
    signature,
    rawBody,
  });
  if (!verified) return fail(res, 401, 'INVALID_SIGNATURE', 'Chữ ký không hợp lệ');

  try {
    req.ragBody = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return fail(res, 400, 'INVALID_JSON', 'JSON không hợp lệ');
  }
  next();
}

router.post('/twofa-uurl', rawJson, verifyRagAuth, (req, res) => {
  const orderId = req.ragBody && req.ragBody.orderId;
  if (!orderId || typeof orderId !== 'string') {
    return fail(res, 400, 'INVALID_ORDER_ID', 'Thiếu orderId');
  }

  const bindings = getBindingsForOrder(orderId, ['active']);
  if (bindings.length === 0) {
    return fail(res, 404, 'NOT_FOUND', 'Không có liên kết 2FA đang hoạt động cho đơn này');
  }
  if (bindings.length > 1) {
    return fail(res, 409, 'AMBIGUOUS_BINDING', 'Đơn hàng có nhiều liên kết 2FA đang hoạt động');
  }

  return res.json({ success: true, data: { uurl: bindings[0].uurl } });
});

const orderService = require('../../services/orderService');

function shapeOrder(o) {
  return {
    id: String(o.id),
    productId: o.product_id,
    productName: o.product_name,
    variantId: o.variant_id,
    quantity: o.quantity,
    totalPrice: o.total_price,
    status: o.status,
    createdAt: o.created_at,
  };
}

router.post('/orders/get', rawJson, verifyRagAuth, (req, res) => {
  const orderId = req.ragBody && req.ragBody.orderId;
  const id = parseInt(orderId, 10);
  if (!Number.isInteger(id)) return fail(res, 400, 'INVALID_ORDER_ID', 'orderId không hợp lệ');

  const order = orderService.getById(id);
  if (!order) return fail(res, 404, 'NOT_FOUND', 'Đơn hàng không tồn tại');

  return res.json({ success: true, data: shapeOrder(order) });
});

router.post('/orders/list-by-customer', rawJson, verifyRagAuth, (req, res) => {
  const customerId = req.ragBody && req.ragBody.customerId;
  const id = parseInt(customerId, 10);
  if (!Number.isInteger(id)) return fail(res, 400, 'INVALID_CUSTOMER_ID', 'customerId không hợp lệ');

  const orders = orderService.getRecentByUser(id, 50);
  return res.json({ success: true, data: orders.map(shapeOrder) });
});

const { createOrderPayload } = require('./customer');

router.post('/orders/create', rawJson, verifyRagAuth, (req, res) => {
  const { customerId, productId, quantity, bankIndex = 0, variantId, inputValue, discountCode } = req.ragBody || {};
  const id = parseInt(customerId, 10);
  if (!Number.isInteger(id)) return fail(res, 400, 'INVALID_CUSTOMER_ID', 'customerId không hợp lệ');
  if (!Number.isInteger(productId) || productId <= 0) {
    return fail(res, 400, 'INVALID_INPUT', 'productId không hợp lệ');
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return fail(res, 400, 'INVALID_INPUT', 'quantity không hợp lệ');
  }
  if (!Number.isInteger(bankIndex) || bankIndex < 0 || bankIndex > 1) {
    return fail(res, 400, 'INVALID_INPUT', 'bankIndex không hợp lệ');
  }

  try {
    const data = createOrderPayload(id, { productId, quantity, bankIndex, variantId, inputValue, discountCode }, { source: 'telegram_rag' });
    req.app.locals.getPaymentPoller?.()?.ensureRunning();
    return res.json({ success: true, data });
  } catch (e) {
    if (e.message === 'DUPLICATE_PENDING') return fail(res, 409, 'DUPLICATE_PENDING', 'Bạn đã có đơn hàng đang chờ');
    if (e.body) return res.status(e.status || 400).json(e.body);
    throw e;
  }
});

const discountService = require('../../services/discountService');

router.post('/discounts/preview', rawJson, verifyRagAuth, (req, res) => {
  const { customerId, code, subtotal } = req.ragBody || {};
  const id = parseInt(customerId, 10);
  const amount = parseInt(subtotal, 10);
  if (!Number.isInteger(id) || !Number.isInteger(amount) || amount < 0) {
    return fail(res, 400, 'INVALID_INPUT', 'customerId hoặc subtotal không hợp lệ');
  }

  const r = discountService.resolveBestForOrder(code, amount, id);
  if (!r.ok) return fail(res, 400, 'DISCOUNT_INVALID', r.reason);

  return res.json({
    success: true,
    data: { discount: r.discount, total: amount - r.discount, code: r.code?.code || null, source: r.source },
  });
});

const userService = require('../../services/userService');

router.post('/admin/orders/cancel', rawJson, verifyRagAuth, (req, res) => {
  const orderId = req.ragBody && req.ragBody.orderId;
  const id = parseInt(orderId, 10);
  if (!Number.isInteger(id)) return fail(res, 400, 'INVALID_ORDER_ID', 'orderId không hợp lệ');

  const order = orderService.getById(id);
  if (!order) return fail(res, 404, 'NOT_FOUND', 'Đơn hàng không tồn tại');

  const cancelled = orderService.cancel(id);
  if (!cancelled) return fail(res, 409, 'INVALID_STATE', 'Đơn không thể hủy');

  return res.json({ success: true, data: { orderId: id, status: 'cancelled' } });
});

router.post('/admin/customers/balance', rawJson, verifyRagAuth, (req, res) => {
  const { customerId, delta, reason } = req.ragBody || {};
  const id = parseInt(customerId, 10);
  const amount = Number(delta);
  if (!Number.isInteger(id) || !Number.isFinite(amount)) {
    return fail(res, 400, 'INVALID_INPUT', 'customerId hoặc delta không hợp lệ');
  }

  const user = userService.get(id);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'Khách hàng không tồn tại');

  userService.addBalance(id, amount);
  const newBalance = userService.get(id).balance;
  return res.json({ success: true, data: { customerId: id, delta: amount, reason: reason || null, newBalance } });
});

module.exports = router;
module.exports._internal = { rawJson, verifyRagAuth, fail };
