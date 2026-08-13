const express = require('express');
const { Router } = require('express');
const config = require('../../config');
const { verifySignedPayload } = require('../../services/twofaIntegrationAuth');
const { processAccountUpdatedEvent } = require('../../services/twofaWebhookService');

const router = Router();
const rawJson = express.raw({ type: 'application/json', limit: '100kb' });

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

router.post('/twofa/account-updated', rawJson, async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const timestamp = req.get('x-tktn-timestamp');
  const signature = req.get('x-tktn-signature');

  // Xác minh chữ ký trên bytes gốc trước khi parse JSON hoặc truy vấn DB.
  const verified = verifySignedPayload({
    secret: config.TWOFA_TMA_SHARED_SECRET,
    timestamp,
    signature,
    rawBody,
  });
  if (!verified) {
    return fail(res, 401, 'INVALID_SIGNATURE', 'Chữ ký không hợp lệ');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return fail(res, 400, 'INVALID_JSON', 'JSON không hợp lệ');
  }

  try {
    const result = await processAccountUpdatedEvent(payload);
    return res.json({ success: true, data: result });
  } catch (err) {
    const status = err.status || 503;
    const code = err.code || 'DELIVERY_FAILED';
    const message = status >= 500 ? 'Nguồn gửi nên thử lại sau' : err.message;
    return fail(res, status, code, message);
  }
});

module.exports = router;
