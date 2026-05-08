# Taikhoantenhat — Telegram Mini App Shop

Cửa hàng số trên Telegram cho khách Việt Nam. Bao gồm:

- **Bot Telegram**: cổng vào duy nhất, gửi thông báo đơn hàng và tin nhắn hỗ trợ.
- **Mini App**: giao diện mua hàng chạy trong ứng dụng Telegram (mobile-first).
- **Bảng điều khiển admin**: quản lý sản phẩm, đơn hàng, kho key, ví khách, tin nhắn.
- **Thanh toán tự động**: đối soát qua MBBank API (sidecar Python).

## Yêu cầu

- Node.js 20+
- Python 3.10+ (cho `mbbank-api/`)
- SQLite (đi kèm `better-sqlite3`)

## Cài đặt nhanh

```bash
cp .env.example .env
# Điền BOT_TOKEN, JWT_SECRET, ENCRYPTION_KEY...
npm install
cd web && npm install && cd ..
./dev.sh
```

Xem `docs/superpowers/specs/` cho thiết kế chi tiết.
