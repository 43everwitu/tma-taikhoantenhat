# Taikhoantenhat — Telegram Mini App Shop

Cửa hàng số trên Telegram cho khách Việt Nam. Bao gồm:

- **Bot Telegram**: cổng vào duy nhất, gửi thông báo đơn hàng và tin nhắn hỗ trợ.
- **Mini App**: giao diện mua hàng chạy trong ứng dụng Telegram (mobile-first).
- **Bảng điều khiển admin**: quản lý sản phẩm, đơn hàng, kho key, tin nhắn.
- **Thanh toán tự động**: đối soát qua MBBank API (sidecar Python).

## Yêu cầu

- Node.js **22+** (xem [`.nvmrc`](.nvmrc))
- Python 3.10+ (cho `mbbank-api/` — dev local; VPS có thể dùng process MBBank có sẵn)
- SQLite (đi kèm `better-sqlite3`)

## Cài đặt nhanh (dev)

```bash
cp .env.example .env
# Điền BOT_TOKEN, JWT_SECRET, ENCRYPTION_KEY...
npm install
cd web && npm install && cd ..
npm run dev:all   # hoặc ./dev.sh (macOS Terminal tabs)
```

Ports mặc định: API `:3000`, Web `:3001`, MBBank `:8000`.

## Deploy production (VPS + PM2)

Xem hướng dẫn chi tiết: **[docs/DEPLOY-VPS-PM2.md](docs/DEPLOY-VPS-PM2.md)**

Tóm tắt:

```bash
npm ci && cd web && npm ci && cd ..
npm run build:web
pm2 start ecosystem.config.cjs
pm2 save
```

Runtime data (`data/shop.db`, `data/uploads/`) **không** nằm trong git — copy riêng lên VPS.

## Thiết kế chi tiết

Xem `docs/superpowers/specs/` cho spec và plan lịch sử.
