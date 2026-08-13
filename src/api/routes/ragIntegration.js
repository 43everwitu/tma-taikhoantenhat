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

module.exports = router;
module.exports._internal = { rawJson, verifyRagAuth, fail };
