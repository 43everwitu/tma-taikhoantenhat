const { Router } = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const sharp = require('sharp');

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.mimetype);
    cb(ok ? null : new Error('Only image uploads allowed'), ok);
  },
});

const OUT_DIR = path.resolve(__dirname, '../../../../data/uploads/products-inline');

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: { code: 'NO_FILE' } });
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex').slice(0, 16);

    const targets = [
      { file: path.join(OUT_DIR, `${hash}-original.webp`), width: 800, fmt: 'webp', q: 80 },
      { file: path.join(OUT_DIR, `${hash}-original.avif`), width: 800, fmt: 'avif', q: 60 },
      { file: path.join(OUT_DIR, `${hash}-thumb.webp`), width: 400, fmt: 'webp', q: 80 },
      { file: path.join(OUT_DIR, `${hash}-thumb.avif`), width: 400, fmt: 'avif', q: 60 },
    ];

    for (const t of targets) {
      if (fs.existsSync(t.file)) continue;
      const pipeline = sharp(req.file.buffer).resize({ width: t.width, withoutEnlargement: true });
      if (t.fmt === 'avif') pipeline.avif({ quality: t.q });
      else pipeline.webp({ quality: t.q });
      await pipeline.toFile(t.file);
    }

    res.json({
      success: true,
      data: {
        url: `/uploads/products-inline/${hash}-original.webp`,
        avifUrl: `/uploads/products-inline/${hash}-original.avif`,
        thumbUrl: `/uploads/products-inline/${hash}-thumb.webp`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'UPLOAD_FAILED', message: err.message } });
  }
});

router.get('/', (req, res) => {
  const dirs = ['products-inline', 'products'];
  const root = path.resolve(__dirname, '../../../../data/uploads');
  const items = [];
  for (const d of dirs) {
    const full = path.join(root, d);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      if (!f.endsWith('-original.webp')) continue;
      items.push({
        url: `/uploads/${d}/${f}`,
        dir: d,
        name: f,
        size: fs.statSync(path.join(full, f)).size,
      });
    }
  }
  items.sort((a, b) => b.name.localeCompare(a.name));
  res.json({ success: true, data: items.slice(0, 200) });
});

module.exports = router;
