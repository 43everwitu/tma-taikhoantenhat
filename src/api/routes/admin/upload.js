const { Router } = require('express');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const { cacheImageBuffer } = require('../../../services/imageCacheService');

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.mimetype);
    cb(ok ? null : new Error('Only image uploads allowed'), ok);
  },
});

router.post('/', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: 30 },
]), async (req, res) => {
  const files = [
    ...((req.files && req.files.file) || []),
    ...((req.files && req.files.files) || []),
  ];
  if (files.length === 0) return res.status(400).json({ success: false, error: { code: 'NO_FILE' } });

  try {
    const items = [];
    for (const file of files) {
      items.push(await cacheImageBuffer(file.buffer, { originalName: file.originalname }));
    }
    const first = items[0];
    res.json({
      success: true,
      data: {
        ...first,
        items,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || 'UPLOAD_FAILED', message: err.message },
    });
  }
});

router.get('/', (req, res) => {
  const dirs = ['products-inline', 'products'];
  const root = path.resolve(__dirname, '../../../../data/uploads');
  const items = [];
  const q = String(req.query.q || '').trim().toLowerCase();
  const sort = String(req.query.sort || 'newest');
  for (const d of dirs) {
    const full = path.join(root, d);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      if (!f.endsWith('-original.webp')) continue;
      const stat = fs.statSync(path.join(full, f));
      items.push({
        url: `/uploads/${d}/${f}`,
        dir: d,
        name: f,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs,
      });
    }
  }
  const filtered = q
    ? items.filter((item) =>
      item.name.toLowerCase().includes(q)
      || item.dir.toLowerCase().includes(q)
      || item.url.toLowerCase().includes(q)
    )
    : items;
  filtered.sort((a, b) => {
    if (sort === 'oldest') return a.mtimeMs - b.mtimeMs;
    if (sort === 'az') return a.name.localeCompare(b.name, 'vi');
    if (sort === 'za') return b.name.localeCompare(a.name, 'vi');
    if (sort === 'size_desc') return b.size - a.size;
    if (sort === 'size_asc') return a.size - b.size;
    return b.mtimeMs - a.mtimeMs;
  });
  res.json({ success: true, data: filtered.slice(0, 300) });
});

module.exports = router;
