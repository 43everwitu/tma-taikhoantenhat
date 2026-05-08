const sharp = require('sharp');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'qr-template.png');

// Output width — Telegram displays photos at 1280px max so 700 covers
// fullscreen view comfortably. Smaller = faster encode + faster upload.
const OUT_WIDTH = 700;

// Original template dims (1856×2292) and original calibrated box.
const ORIG_BOX = { x: 630, y: 1520, width: 630, height: 630 };
const ORIG_WIDTH = 1856;

// Pre-scale box to OUT_WIDTH-relative coords. Sharp resize is bilinear
// so we round to the nearest pixel.
const SCALE = OUT_WIDTH / ORIG_WIDTH;
const QR_BOX = {
  x: Math.round(ORIG_BOX.x * SCALE),
  y: Math.round(ORIG_BOX.y * SCALE),
  width: Math.round(ORIG_BOX.width * SCALE),
  height: Math.round(ORIG_BOX.height * SCALE),
};

const COMPOSITE_CACHE_MAX = 128;

// Pre-render template at OUT_WIDTH (raw pixels) at module init. Per-call
// composite skips both PNG decode AND the downscale step.
let templateRaw = null;
let templateMeta = null;
async function loadTemplate() {
  const png = fs.readFileSync(TEMPLATE_PATH);
  const { data, info } = await sharp(png)
    .resize(OUT_WIDTH)
    .raw()
    .toBuffer({ resolveWithObject: true });
  templateRaw = data;
  templateMeta = info;
}
const ready = loadTemplate()
  // Warm libvips by running one trivial op so first user-facing composite is hot.
  .then(() => sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).jpeg().toBuffer())
  .catch((e) => console.error('QR template preload failed:', e.message));

const compositeCache = new Map();

function lruSet(map, key, value, max) {
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value);
}

/**
 * Build a VietQR EMV string locally. NAPAS spec — tag 38 nested with
 * AID + bank BIN + account + service code; tag 62 with addInfo memo;
 * CRC-16-CCITT computed over the whole payload including the "6304"
 * tag-length prefix.
 */
function buildVietQRString({ bin, account, amount, addInfo }) {
  const tag38Inner = tlv('00', 'A000000727')
    + tlv('01', tlv('00', bin) + tlv('01', account))
    + tlv('02', 'QRIBFTTA');

  let payload = '';
  payload += tlv('00', '01');
  payload += tlv('01', amount ? '12' : '11');
  payload += tlv('38', tag38Inner);
  payload += tlv('53', '704');
  if (amount) payload += tlv('54', String(amount));
  payload += tlv('58', 'VN');
  if (addInfo) payload += tlv('62', tlv('08', addInfo));

  payload += '6304';
  const crc = crc16ccitt(payload).toString(16).toUpperCase().padStart(4, '0');
  return payload + crc;
}

function tlv(id, value) {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16ccitt(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc;
}

async function renderQRPng(emvString) {
  return QRCode.toBuffer(emvString, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 0,
    width: QR_BOX.width,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}

/**
 * Local composite — fully offline. ~17ms warm, ~120ms cold.
 * Returns a JPEG Buffer (~96KB).
 */
async function compositeLocal({ bin, account, amount, addInfo }) {
  const cacheKey = `${bin}|${account}|${amount}|${addInfo}`;
  const cached = compositeCache.get(cacheKey);
  if (cached) return cached;

  await ready;
  if (!templateRaw) throw new Error('Template not loaded');

  const emv = buildVietQRString({ bin, account, amount, addInfo });
  const qrPng = await renderQRPng(emv);

  const out = await sharp(templateRaw, { raw: templateMeta })
    .composite([{ input: qrPng, top: QR_BOX.y, left: QR_BOX.x }])
    .jpeg({ quality: 78 })
    .toBuffer();

  lruSet(compositeCache, cacheKey, out, COMPOSITE_CACHE_MAX);
  return out;
}

/**
 * URL-based fallback path — fetch a remote QR image and composite. Only
 * used by callers that already have a VietQR URL. Hot path uses
 * compositeLocal.
 */
async function composite(qrUrl) {
  const cached = compositeCache.get(qrUrl);
  if (cached) return cached;

  await ready;
  if (!templateRaw) throw new Error('Template not loaded');

  const res = await fetch(qrUrl, {
    signal: AbortSignal.timeout(6_000),
    redirect: 'follow',
    headers: { 'user-agent': 'auto-chan-bot/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${qrUrl}`);
  const qrBuffer = Buffer.from(await res.arrayBuffer());

  const resizedQr = await sharp(qrBuffer)
    .resize(QR_BOX.width, QR_BOX.height, { fit: 'contain', background: '#ffffff' })
    .png()
    .toBuffer();

  const out = await sharp(templateRaw, { raw: templateMeta })
    .composite([{ input: resizedQr, top: QR_BOX.y, left: QR_BOX.x }])
    .jpeg({ quality: 78 })
    .toBuffer();

  lruSet(compositeCache, qrUrl, out, COMPOSITE_CACHE_MAX);
  return out;
}

module.exports = { composite, compositeLocal, buildVietQRString, QR_BOX };
