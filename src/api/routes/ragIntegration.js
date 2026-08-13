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

module.exports = router;
module.exports._internal = { rawJson, verifyRagAuth, fail };
