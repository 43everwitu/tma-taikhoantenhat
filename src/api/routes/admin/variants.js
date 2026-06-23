// Admin variant CRUD + reorder routes.
const { Router } = require('express');
const { z } = require('zod');
const db = require('../../../database');
const variantService = require('../../../services/variantService');
const auditService = require('../../../services/auditService');
const { validate } = require('../../middleware/validate');

const router = Router({ mergeParams: true });

const variantBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(20000).nullable().optional(),
  price: z.number().int().nonnegative(),
  sortOrder: z.number().int().optional(),
  requiresInput: z.boolean().optional(),
  inputLabel: z.string().max(80).nullable().optional(),
  inputPlaceholder: z.string().max(200).nullable().optional(),
  inputType: z.enum(['text', 'email', 'password', 'tel', 'url', 'number', 'textarea']).optional(),
  inputFields: z.array(z.object({
    // Label is optional — a single field often needs no caption. Empty strings
    // are kept (not required) and rendered without a label on the storefront.
    label: z.string().max(80).optional().default(''),
    placeholder: z.string().max(200).nullable().optional(),
    type: z.enum(['text', 'email', 'password', 'tel', 'url', 'number', 'textarea']),
    required: z.boolean(),
  })).max(10).nullable().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  isBackorder: z.boolean().optional(),
  defaultDurationDays: z.number().int().min(1).max(36500).nullable().optional(),
});

const variantPatch = variantBody.partial().extend({
  isActive: z.boolean().optional(),
});

const reorderBody = z.object({
  items: z.array(z.object({ id: z.number().int(), sortOrder: z.number().int() })).min(1),
});

function shapeVariant(v) {
  let inputFields = null;
  if (v.input_fields_json) {
    try { inputFields = JSON.parse(v.input_fields_json); } catch { inputFields = null; }
  }
  return {
    id: String(v.id),
    productId: String(v.product_id),
    name: v.name,
    description: v.description || '',
    price: v.price,
    sortOrder: v.sort_order,
    isActive: !!v.is_active,
    requiresInput: !!v.requires_input,
    inputLabel: v.input_label || null,
    inputPlaceholder: v.input_placeholder || null,
    inputType: v.input_type || 'text',
    inputFields,
    imageUrl: v.image_url || null,
    isBackorder: !!v.is_backorder,
    defaultDurationDays: v.default_duration_days ?? null,
    stock: variantService.countAvailableStock(db, v.product_id, v.id),
  };
}

router.get('/', (req, res) => {
  const productId = parseInt(req.params.productId);
  const includeInactive = req.query.includeInactive === '1';
  const rows = variantService.listByProduct(db, productId, { includeInactive });
  res.json({ success: true, data: rows.map(shapeVariant) });
});

router.post('/', validate(variantBody), (req, res) => {
  const productId = parseInt(req.params.productId);
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ success: false, error: { code: 'PRODUCT_NOT_FOUND' } });
  const { id } = variantService.create(db, { productId, ...req.validated });
  auditService.log(req.admin?.adminId, 'variant.create', 'variant', id, { productId }, req.ip);
  res.status(201).json({ success: true, data: { id } });
});

router.put('/:id', validate(variantPatch), (req, res) => {
  const productId = parseInt(req.params.productId);
  const variantId = parseInt(req.params.id);
  const r = variantService.update(db, productId, variantId, req.validated);
  if (r.changes === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  auditService.log(req.admin?.adminId, 'variant.update', 'variant', variantId, { productId, fields: Object.keys(req.validated) }, req.ip);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const productId = parseInt(req.params.productId);
  const variantId = parseInt(req.params.id);
  const existing = db.prepare('SELECT id, name FROM product_variants WHERE id = ? AND product_id = ?').get(variantId, productId);
  if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  variantService.hardDelete(db, productId, variantId);
  auditService.log(req.admin?.adminId, 'variant.delete', 'variant', variantId, {
    entityLabel: existing?.name ?? null,
    productId,
    hard: true,
  }, req.ip);
  res.json({ success: true });
});

router.patch('/reorder', validate(reorderBody), (req, res) => {
  const productId = parseInt(req.params.productId);
  variantService.reorder(db, productId, req.validated.items);
  auditService.log(req.admin?.adminId, 'variant.reorder', 'variant', null, { productId, count: req.validated.items.length }, req.ip);
  res.json({ success: true });
});

module.exports = router;
