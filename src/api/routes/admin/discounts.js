const { Router } = require('express');
const { z } = require('zod');
const sanitizeHtml = require('sanitize-html');
const discountService = require('../../../services/discountService');
const auditService = require('../../../services/auditService');
const { validate } = require('../../middleware/validate');

const router = Router();

const body = z.object({
  code: z.string().min(2).max(40),
  type: z.enum(['percent', 'fixed']),
  amount: z.number().int().min(1),
  maxDiscount: z.number().int().min(0).nullable().optional(),
  minOrder: z.number().int().min(0).optional(),
  usageLimit: z.number().int().min(0).nullable().optional(),
  perUserLimit: z.number().int().min(0).nullable().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  isGlobal: z.boolean().optional(),
  notifyTitle: z.string().max(120).nullable().optional(),
  appMetaMode: z.enum(['auto', 'custom', 'hidden']).optional(),
  appMetaText: z.string().max(200).nullable().optional(),
  appMessage: z.string().max(500).nullable().optional(),
  botMessage: z.string().max(1000).nullable().optional(),
});

function shape(c) {
  return {
    id: c.id,
    code: c.code,
    type: c.type,
    amount: c.amount,
    maxDiscount: c.max_discount,
    minOrder: c.min_order,
    usageLimit: c.usage_limit,
    usedCount: c.used_count,
    perUserLimit: c.per_user_limit,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    isActive: !!c.is_active,
    isGlobal: !!c.is_global,
    notifyTitle: c.notify_title,
    appMetaMode: c.app_meta_mode || 'auto',
    appMetaText: c.app_meta_text,
    appMessage: c.app_message,
    botMessage: c.bot_message,
    createdAt: c.created_at,
  };
}

function cleanDiscountBody(d) {
  const out = { ...d };
  if (out.appMessage !== undefined && out.appMessage !== null) {
    out.appMessage = sanitizeHtml(out.appMessage, { allowedTags: [], allowedAttributes: {} }).trim();
  }
  if (out.notifyTitle !== undefined && out.notifyTitle !== null) {
    out.notifyTitle = sanitizeHtml(out.notifyTitle, { allowedTags: [], allowedAttributes: {} }).trim();
  }
  if (out.appMetaText !== undefined && out.appMetaText !== null) {
    out.appMetaText = sanitizeHtml(out.appMetaText, { allowedTags: [], allowedAttributes: {} }).trim();
  }
  if (out.botMessage !== undefined && out.botMessage !== null) {
    out.botMessage = sanitizeHtml(out.botMessage, {
      allowedTags: ['b', 'i', 'u', 's', 'a', 'code', 'pre'],
      allowedAttributes: { a: ['href'] },
    }).trim();
  }
  return out;
}

router.get('/', (req, res) => {
  res.json({ success: true, data: discountService.listAll().map(shape) });
});

router.post('/', validate(body), (req, res) => {
  try {
    const payload = cleanDiscountBody(req.validated);
    const { id } = discountService.create(payload);
    auditService.log(req.admin.adminId, 'discount.create', 'discount', id, payload, req.ip);
    res.status(201).json({ success: true, data: { id } });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: 'Mã đã tồn tại' } });
    throw e;
  }
});

router.put('/:id', validate(body.partial()), (req, res) => {
  const payload = cleanDiscountBody(req.validated);
  const r = discountService.update(parseInt(req.params.id), payload);
  if (r.changes === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  auditService.log(req.admin.adminId, 'discount.update', 'discount', req.params.id, payload, req.ip);
  res.json({ success: true });
});

router.post('/:id/notify', async (req, res) => {
  const id = parseInt(req.params.id);
  const code = discountService.getById(id);
  if (!code) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  if (!code.is_global) return res.status(400).json({ success: false, error: { code: 'NOT_GLOBAL', message: 'Chỉ gửi thông báo cho mã global' } });

  const notificationService = req.app.locals.notificationService;
  if (!notificationService) return res.status(500).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } });

  const title = code.notify_title || 'Ưu đãi toàn cửa hàng';
  const body = code.bot_message || code.app_message || `Ưu đãi ${code.code} đang được tự động áp dụng toàn cửa hàng.`;
  const result = await notificationService.broadcast(title, body, 'all', req.admin.adminId);
  auditService.log(req.admin.adminId, 'discount.notify', 'discount', id, { sent: result.sent, failed: result.failed }, req.ip);
  res.json({ success: true, data: result });
});

router.delete('/:id', (req, res) => {
  const existing = discountService.getById(parseInt(req.params.id));
  const r = discountService.remove(parseInt(req.params.id));
  if (r.changes === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  auditService.log(req.admin.adminId, 'discount.delete', 'discount', req.params.id, existing ? {
    entityLabel: existing.code,
    type: existing.type,
    amount: existing.amount,
  } : null, req.ip);
  res.json({ success: true });
});

module.exports = router;
