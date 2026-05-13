const { Router } = require('express');
const { z } = require('zod');
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
    createdAt: c.created_at,
  };
}

router.get('/', (req, res) => {
  res.json({ success: true, data: discountService.listAll().map(shape) });
});

router.post('/', validate(body), (req, res) => {
  try {
    const { id } = discountService.create(req.validated);
    auditService.log(req.admin.adminId, 'discount.create', 'discount', id, req.validated, req.ip);
    res.status(201).json({ success: true, data: { id } });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: 'Mã đã tồn tại' } });
    throw e;
  }
});

router.put('/:id', validate(body.partial()), (req, res) => {
  const r = discountService.update(parseInt(req.params.id), req.validated);
  if (r.changes === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  auditService.log(req.admin.adminId, 'discount.update', 'discount', req.params.id, req.validated, req.ip);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const r = discountService.remove(parseInt(req.params.id));
  if (r.changes === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  auditService.log(req.admin.adminId, 'discount.delete', 'discount', req.params.id, null, req.ip);
  res.json({ success: true });
});

module.exports = router;
