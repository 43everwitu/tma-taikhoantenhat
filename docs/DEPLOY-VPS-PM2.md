# Deploy VPS — Taikhoantenhat (PM2 + Nginx)

Hướng dẫn deploy production trên VPS Linux. Stack:

| Thành phần | Process | Port (nội bộ) | PM2 |
|------------|---------|---------------|-----|
| Node API + Telegram bot | `src/index.js` | `API_PORT` (mặc định 3000) | `taikhoantenhat-api` |
| Next.js web (Mini App + admin) | `next start` | `WEB_PORT` (mặc định 3001) | `taikhoantenhat-web` |
| MBBank API | **process có sẵn trên VPS** | tùy bạn (vd. 8000) | **không** quản lý bằng PM2 |

Nginx nhận HTTPS public (port 443 hoặc port tùy chỉnh) và proxy vào Next `:WEB_PORT`. Next rewrite `/api/*` và `/uploads/*` về Node `:API_PORT` (same-origin như dev).

---

## 1. Yêu cầu VPS

- Ubuntu 22.04+ / Debian 12+
- Node.js **22+** ([nvm](https://github.com/nvm-sh/nvm) khuyến nghị)
- PM2: `npm install -g pm2`
- Nginx + SSL (Let's Encrypt / cert có sẵn)
- Git clone repo vào thư mục deploy (vd. `/var/www/taikhoantenhat-bot`)

**MBBank**: giả định bạn đã có FastAPI sidecar chạy sẵn. Chỉ cần set `MBBANK_API_URL` trong `.env` trỏ đúng URL nội bộ (vd. `http://127.0.0.1:8000`).

---

## 2. Clone & cài dependency

```bash
cd /var/www/taikhoantenhat-bot
git clone <repo-url> .
nvm install 22 && nvm use 22
npm ci
cd web && npm ci && cd ..
```

---

## 3. File `.env` production

```bash
cp .env.example .env
nano .env
```

Mẫu tối thiểu:

```env
NODE_ENV=production

# Ports nội bộ (không mở firewall ra internet)
API_PORT=3000
WEB_PORT=3001

# Domain public HTTPS (trùng nhau nếu một domain cho cả Mini App + admin)
WEB_URL=https://shop.example.com
MINIAPP_URL=https://shop.example.com

# Next rewrite → Node API (localhost only)
API_BACKEND_URL=http://127.0.0.1:3000

# MBBank — URL process đang chạy sẵn trên VPS
MBBANK_API_URL=http://127.0.0.1:8000
MBBANK_API_TOKEN=your_bearer_token
MB_USERNAME=...
MB_PASSWORD=...
PAYMENT_POLL_ENABLED=true
PAYMENT_POLL_INTERVAL=30000

BOT_TOKEN=...
ADMIN_ID=123456789
JWT_SECRET=...          # openssl rand -hex 32
ENCRYPTION_KEY=...      # openssl rand -hex 32
ADMIN_INITIAL_PASSWORD='your_secure_password'

BANK_BIN=970422
BANK_ACCOUNT=...
BANK_ACCOUNT_NAME=...
BANK_NAME=MB

SHOP_NAME=Taikhoantenhat
SUPPORT_CONTACT=@your_support

# Tùy chọn
# ORDER_CHANNEL_CHAT_ID=-100...
# ORDER_CHANNEL_THREAD_ID=2
# FEATURE_TOPUPS=false
# FEATURE_BROADCAST=false
# FEATURE_TELEGRAM_NOTIFY=order_only
```

**Lưu ý**: giá trị có ký tự `#` phải bọc quote: `KEY='value#with#hash'`.

---

## 4. Database & uploads (không có trong git)

Runtime data không commit lên git. Từ máy dev, copy lên VPS:

```bash
# Trên máy dev
rsync -avz data/shop.db user@vps:/var/www/taikhoantenhat-bot/data/
rsync -avz data/uploads/ user@vps:/var/www/taikhoantenhat-bot/data/uploads/
```

Hoặc trên VPS lần đầu (DB trống — migrations chạy khi start API):

```bash
mkdir -p data/uploads logs
# Sau npm start lần đầu, chạy migrate:wp hoặc import catalog nếu cần
```

---

## 5. Build & khởi động PM2

```bash
npm run build:web
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs taikhoantenhat-api --lines 50
```

Lần đầu API chạy sẽ apply migrations SQLite tự động.

Đăng ký auto-start khi reboot:

```bash
pm2 save
pm2 startup   # làm theo lệnh systemd mà PM2 in ra
```

Lệnh hữu ích:

```bash
pm2 reload ecosystem.config.cjs   # deploy mới
pm2 restart taikhoantenhat-api     # chỉ API+bot
pm2 restart taikhoantenhat-web    # chỉ Next
```

---

## 6. Nginx (HTTPS → Next, port app tùy chỉnh)

Thay `shop.example.com`, `3001`, đường dẫn cert theo VPS của bạn.

```nginx
# /etc/nginx/sites-available/taikhoantenhat
upstream taikhoantenhat_web {
    server 127.0.0.1:3001;   # = WEB_PORT trong .env
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name shop.example.com;

    ssl_certificate     /etc/letsencrypt/live/shop.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/shop.example.com/privkey.pem;

    client_max_body_size 20m;

    location / {
        proxy_pass http://taikhoantenhat_web;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 80;
    server_name shop.example.com;
    return 301 https://$host$request_uri;
}
```

Kích hoạt:

```bash
sudo ln -s /etc/nginx/sites-available/taikhoantenhat /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**Không** expose `:3000` (API) hay port MBBank ra internet. Chỉ Nginx `:443` public.

Nếu dùng **port public khác 443** (vd. `:8443`):

```nginx
listen 8443 ssl http2;
```

---

## 7. BotFather & Mini App

1. `@BotFather` → Bot Settings → Menu Button → URL = `MINIAPP_URL` (HTTPS).
2. Mini App URL đăng ký `/newapp` trùng domain.
3. Sau deploy, API tự gọi `setChatMenuButton` khi boot (theo `MINIAPP_URL` trong `.env`).

---

## 8. Kiểm tra sau deploy

```bash
# Health qua Next rewrite
curl -s https://shop.example.com/api/v1/health

# PM2
pm2 logs taikhoantenhat-api --lines 30
# Kỳ vọng: migrations, bot launch, poller (nếu MBBANK_API_TOKEN có)

# Admin login
# https://shop.example.com/dang-nhap
# Nếu hash lệch: npm run admin:reset-password admin 'NewPassword'
```

Checklist:

- [ ] Mini App mở từ Telegram, đăng nhập initData OK
- [ ] Admin `/admin` login OK
- [ ] Upload ảnh sản phẩm OK (`data/uploads/` writable)
- [ ] Đặt thử đơn → QR → poller match (MBBANK_API_URL đúng)
- [ ] Bot gửi tin giao hàng

---

## 9. Cập nhật phiên bản mới

```bash
cd /var/www/taikhoantenhat-bot
git pull
npm ci && cd web && npm ci && cd ..
npm run build:web
pm2 reload ecosystem.config.cjs
```

Backup trước khi pull nếu có migration mới:

```bash
cp data/shop.db "data/shop.db.bak-$(date +%Y%m%d-%H%M)"
```

---

## 10. Backup định kỳ

```bash
# Cron ví dụ — hàng ngày 3h sáng
0 3 * * * cp /var/www/taikhoantenhat-bot/data/shop.db /backup/shop.db.$(date +\%Y\%m\%d)
```

Backup cả `data/uploads/` nếu có ảnh sản phẩm upload qua admin.

---

## 11. Troubleshooting

| Triệu chứng | Gợi ý |
|-------------|--------|
| 502 Bad Gateway | `pm2 status` — web/api có running? `WEB_PORT` khớp Nginx? |
| API 404 qua domain | `API_BACKEND_URL` trong `.env` + rebuild/restart web |
| Bot 409 conflict | Chỉ **1** instance API (`instances: 1`). Kill process cũ: `pm2 delete all` rồi start lại |
| Poller không match | `MBBANK_API_URL`, `MBBANK_API_TOKEN`, log `taikhoantenhat-api` |
| CORS lỗi | Set `WEB_URL=https://shop.example.com` (khớp Origin) |
| Admin không login | `npm run admin:reset-password` |
| Upload 413 | Tăng `client_max_body_size` Nginx |

---

## 12. Kiến trúc tóm tắt

```
Internet :443 (Nginx)
    └── Next.js :WEB_PORT  (PM2 taikhoantenhat-web)
            ├── /api/*     → rewrite → Node :API_PORT
            └── /uploads/* → rewrite → Node :API_PORT
    Node :API_PORT (PM2 taikhoantenhat-api)
            ├── Express REST + SQLite data/shop.db
            ├── Telegraf bot long-polling
            └── Payment poller → MBBank :8000 (process ngoài PM2)
```
