const sharp = require('sharp');
const path = require('path');

async function main() {
  const file = path.join(__dirname, '..', 'src', 'assets', 'qr-template.png');
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Find the QR box by looking for a solid black rectangle on the sign.
  // Strategy: scan the center-lower region (where the sign is) and find
  // the densest dark region that is roughly square.

  let bestScore = 0;
  let bestBox = { x: 0, y: 0, width: 0, height: 0 };

  // Focus on the sign area: roughly x in [300, 1500], y in [800, 2200]
  const scanStartX = 300;
  const scanEndX = 1500;
  const scanStartY = 800;
  const scanEndY = 2200;

  const minSize = 150;
  const maxSize = 800;
  const step = 30;

  for (let y = scanStartY; y < scanEndY - minSize; y += step) {
    for (let x = scanStartX; x < scanEndX - minSize; x += step) {
      for (let sz = minSize; sz <= maxSize; sz += step) {
        if (x + sz > scanEndX || y + sz > scanEndY) continue;

        let darkCount = 0;

        for (let dy = 0; dy < sz; dy++) {
          for (let dx = 0; dx < sz; dx++) {
            const py = y + dy;
            const px = x + dx;
            const i = (py * width + px) * channels;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            if (r < 30 && g < 30 && b < 30) {
              darkCount++;
            }
          }
        }

        // Score: fraction of pixels that are dark (higher = better)
        const darkRatio = darkCount / (sz * sz);
        const score = darkRatio * sz * sz;  // Prefer larger boxes if equally dense

        if (score > bestScore && darkRatio > 0.85) {  // At least 85% should be dark
          bestScore = score;
          bestBox = { x, y, width: sz, height: sz };
        }
      }
    }
  }

  console.log(JSON.stringify({
    templateWidth: width,
    templateHeight: height,
    qrBox: bestBox,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
