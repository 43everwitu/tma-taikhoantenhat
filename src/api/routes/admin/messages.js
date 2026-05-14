const { Router } = require('express');
const { z } = require('zod');
const { validate } = require('../../middleware/validate');
const messageTemplateService = require('../../../services/messageTemplateService');
const auditService = require('../../../services/auditService');
const { toTelegramHtml } = require('../../../utils/richHtml');

const router = Router();

// GET /admin/messages — list all 18 templates
router.get('/', (req, res) => {
  res.json({ success: true, data: messageTemplateService.list() });
});

// GET /admin/messages/:key — single template detail
router.get('/:key', (req, res) => {
  const t = messageTemplateService.get(req.params.key);
  if (!t) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  // get() returns { body, variables } — include the key in the response
  res.json({ success: true, data: { key: req.params.key, ...t } });
});

// PUT /admin/messages/:key — admin saves an edited body
router.put('/:key', validate(z.object({ body: z.string().min(1).max(4000) })), (req, res) => {
  try {
    const tpl = messageTemplateService.get(req.params.key);
    if (!tpl) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    const all = messageTemplateService.list();
    const meta = all.find((t) => t.key === req.params.key);
    const channel = meta ? meta.channel : 'bot';
    // admin and group bodies are also sent via bot.telegram.sendMessage with
    // parse_mode: 'HTML' — they need the same Telegram-HTML allowlist as 'bot'.
    // Only 'web' channel skips sanitisation here (passes through unchanged).
    const sanitized = channel === 'web' ? req.body.body : toTelegramHtml(req.body.body);
    messageTemplateService.update(req.params.key, sanitized);
    auditService.log(req.admin.adminId, 'message.update', 'message_template', req.params.key, { body: sanitized }, req.ip);
    res.json({ success: true, data: { sanitized } });
  } catch (e) {
    res.status(500).json({ success: false, error: { code: 'UPDATE_FAILED', message: e.message } });
  }
});

// POST /admin/messages/:key/reset — restore body from default_body
router.post('/:key/reset', (req, res) => {
  try {
    messageTemplateService.reset(req.params.key);
    auditService.log(req.admin.adminId, 'message.reset', 'message_template', req.params.key, {}, req.ip);
    res.json({ success: true });
  } catch (e) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: e.message } });
  }
});

// POST /admin/messages/:key/preview — render with sample vars (no DB write)
router.post('/:key/preview',
  validate(z.object({ vars: z.record(z.any()).default({}) })),
  (req, res) => {
    try {
      const text = messageTemplateService.render(req.params.key, req.body.vars);
      res.json({ success: true, data: { text } });
    } catch (e) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: e.message } });
    }
  }
);

module.exports = router;
