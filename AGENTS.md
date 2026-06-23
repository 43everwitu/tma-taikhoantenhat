# AGENTS.md

Hướng dẫn này áp dụng cho repo `/home/peanut/tma-taikhoantenhat`. Luôn trả lời bằng Tiếng Việt. Code, tên biến, tên hàm giữ theo convention tiếng Anh.

## Nguyên Tắc Làm Việc

- Đọc `CLAUDE.md`, file docs liên quan trong `docs/`, và `web/AGENTS.md` trước khi sửa phần Next.js.
- Thay đổi tối thiểu, đúng scope. Không refactor, format, hoặc xóa code không liên quan.
- Nếu gặp thay đổi có sẵn trong working tree, coi đó là của người dùng. Không revert nếu không được yêu cầu.
- Runtime DB là `data/shop.db`; `data/db.sqlite` là artifact cũ, không dùng làm nguồn sự thật.
- Không commit `data/shop.db`, backup DB, `data/uploads/`, log, temporary test, hoặc file ảnh local.

## Cấu Trúc Project

- `src/index.js`: entrypoint Node, khởi động Express API, Telegram bot long-polling, static `/uploads`, route wiring, payment poller.
- `src/api/routes/`: REST API. `public.js` cho catalog, `customer.js` cho auth/order, `auth.js` cho Mini App initData, `events.js` cho SSE, `admin/*` cho admin.
- `src/services/`: nghiệp vụ chính. `orderService.js` quản lý order lifecycle/event, `paymentPoller.js` đối soát MBBank, `messageTemplateService.js` render template.
- `src/database/`: kết nối SQLite, migrations, seeds.
- `web/`: Next 16 App Router, React 19. Route groups `(miniapp)` và `(admin)`. Dev port `3001`, rewrite `/api/*` và `/uploads/*` về API `3000`.
- `web/src/app/(miniapp)/`: Telegram Mini App mua hàng.
- `web/src/app/(admin)/admin/`: admin dashboard.
- `web/src/lib/`: API client, cart, Telegram helpers, shared utils.
- `mbbank-api/`: FastAPI sidecar cho MBBank, dev port `8000`.
- `scripts/`: maintenance/deploy/import tools, gồm `dev-all.sh`, `deploy-pm2.sh`, `migrate-wp.js`, `purge-test-data.js`, `verify-message-templates.js`.
- `tests/`: Node built-in test runner tests cho backend/services/API.
- `docs/superpowers/specs/`: design specs.
- `docs/superpowers/plans/`: implementation plans và verification checklist.
- `docs/DEPLOY-VPS-PM2.md`: deploy production VPS + PM2 + Nginx.
- `docs/ANDROID-TMA-LOADING-FIX.md`: ghi chú lỗi Telegram Android WebView/cache đã từng gặp.

## Mục Tiêu Hiện Tại

- Sửa automatic MBBank polling để query theo ngày ngân hàng Việt Nam (`Asia/Ho_Chi_Minh`) thay vì UTC ISO date. Incident gốc: order `100479` ngày `2026-06-12/2026-06-13`; order này đã confirm thủ công, không được reprocess.
- Đặt runtime timezone `TZ=Asia/Ho_Chi_Minh` cho PM2 API/Web và `.env.example`, nhưng vẫn giữ SQLite `CURRENT_TIMESTAMP`/`datetime('now')` là UTC.
- Dọn sạch dữ liệu test/prompt: user `9990001`, product `R`, product `Test`, slug `r-*`, các order/stock/transaction liên quan. Phải dry-run, tạo backup, xóa trong transaction, và không commit DB.
- Hiển thị timestamp frontend theo giờ Hà Nội: parse SQLite timestamp `YYYY-MM-DD HH:mm:ss` như UTC, format với `Asia/Ho_Chi_Minh`.
- Giữ late-payment recovery: đơn `expired` nhưng khách chuyển đúng tiền/đúng memo trong 24 giờ vẫn được xử lý theo flow thanh toán hiện có.

## Các Quyết Định Đã Thống Nhất

- Stack chạy thực tế: Node.js 22 theo `.nvmrc`, `package.json`, README và docs deploy. `CLAUDE.md` vẫn còn dòng cũ "Node 20+"; coi đây là sai lệch tài liệu cần cleanup sau.
- Payment matching nằm trong Node `PaymentPoller`, dữ liệu bank lấy từ Python `mbbank-api`. Không sửa API sidecar cho bug ngày; fix critical path ở Node vì `toISOString()` luôn là UTC.
- Không thay đổi policy thanh toán: pending orders, recently expired orders, topups, amount checks, stock delivery, order expiry/recovery windows giữ nguyên.
- Không publish eventBus trực tiếp từ `paymentPoller.js`; event order phải đi qua `orderService.js`.
- Mini App auth chạy nền; catalog public render được trước, ngoài Telegram fallback `guest`.
- UI dùng brand gold `#ffc200` + ink `#1c222b`, tone Tiếng Việt trung tính/chuyên nghiệp. Không hardcode chuỗi VN trong component nếu đã có `web/src/i18n/vi.ts`.
- Next/Image với `fill` cần parent inline `style={{ position: 'relative' }}`.
- Next 16/Turbopack: Telegram script load bằng plain async `<script>` trong `<head>`, không dùng `<Script beforeInteractive>`.
- Giá trị `.env` có ký tự `#` phải quote, vì `dotenv` cắt phần sau `#`.

## Những File Đã Sửa / Đang Liên Quan

- Timezone payment: `src/services/paymentPoller.js`, `ecosystem.config.cjs`, `.env.example`.
- Late payment recovery: `src/services/orderService.js`, `src/services/paymentPoller.js`, `src/index.js`, `tests/services/paymentPollerLateRecovery.test.js`, `tests/services/orderRecovery.test.js`.
- Purge test data và hiển thị giờ Hà Nội: `scripts/purge-test-data.js`, `web/src/lib/utils.ts`, `web/src/app/(miniapp)/don-hang/page.tsx`.
- Backorder paid message: `src/api/routes/customer.js`, `web/src/app/(miniapp)/don-hang/[id]/page.tsx`, `tests/api/customer-order-status-backorder.test.js`.
- Docs nguồn: `CLAUDE.md`, `README.md`, `docs/DEPLOY-VPS-PM2.md`, `docs/superpowers/specs/2026-06-13-*.md`, `docs/superpowers/plans/2026-06-13-*.md`, `docs/superpowers/plans/2026-06-12-late-payment-recovery.md`.
- File hướng dẫn này: `AGENTS.md`.

## Lệnh Build / Test / Verify

```bash
npm install
cd web && npm install && cd ..
```

```bash
npm run dev:all       # API + web + mbbank sidecar
npm run dev           # API only, port 3000
npm run dev:web       # Next only, port 3001
npm run dev:mbbank    # FastAPI sidecar, port 8000
```

```bash
npm run build:web
cd web && npm run build
cd web && npm run lint
```

```bash
node --test tests/services/paymentPollerLateRecovery.test.js tests/services/orderRecovery.test.js tests/services/pollerInterval.test.js
node --test tests/api/customer-order-status-backorder.test.js
node scripts/verify-message-templates.js
```

```bash
node scripts/purge-test-data.js
node scripts/purge-test-data.js --apply
```

```bash
node -e "const cfg=require('./ecosystem.config.cjs'); const api=cfg.apps.find(a=>a.name==='taikhoantenhat-api'); const web=cfg.apps.find(a=>a.name==='taikhoantenhat-web'); if (api.env.TZ !== 'Asia/Ho_Chi_Minh' || web.env.TZ !== 'Asia/Ho_Chi_Minh') throw new Error('missing TZ'); console.log('pm2 tz ok')"
rg -n "toISOString\\(\\).*split\\('T'\\)|toISOString\\(\\).*slice\\(0, 10\\)" src/services/paymentPoller.js
rg -n "temporary boundary test|boundaryUtcTimestamp|tmp-format-date-vn" tests scripts web
```

Deploy production:

```bash
npm ci && cd web && npm ci && cd ..
npm run build:web
pm2 start ecosystem.config.cjs
pm2 reload ecosystem.config.cjs
```

## Lỗi Còn Tồn Tại / Cần Lưu Ý

- `CLAUDE.md` còn nói runtime Node 20+, trong khi `.nvmrc`, README, `package.json`, và docs deploy đã chốt Node 22+.
- Refund route `POST /api/v1/admin/orders/:id/refund` chưa có.
- Còn 2 comment cũ `paymentConfirm` trong `src/services/notificationService.js`.
- Các follow-up chưa làm: geo-block middleware, custom-info order flow, per-order chat, legacy public web cleanup.
- Trang chi tiết đơn hàng `/don-hang/[id]` chưa hiển thị variant name cho customer; cần `orderService.getById` JOIN `product_variants`.
- `notifyOrderExpired` và `notifyOrderCancelled` trong `NotificationService` chưa có caller; cần wire hoặc xóa.
- Telegram Android WebView có thể cache trang lỗi cũ; xem `docs/ANDROID-TMA-LOADING-FIX.md` khi Android lỗi nhưng Chrome/iOS/PC bình thường.
- Sau khi chạy purge, `data/shop.db` và `data/shop.db.bak-pre-test-purge-*` có thể thay đổi ở local; không stage/commit.

## Việc Cần Làm Tiếp Theo

- Chạy final verification cho timezone/payment: payment tests, PM2 TZ check, và `rg` đảm bảo poller không dùng UTC ISO date để query MBBank.
- Chạy dry-run `scripts/purge-test-data.js`, xem counts, sau đó mới `--apply`; xác nhận dashboard không còn user `9990001 / Test` hoặc product `R/Test`.
- Chạy `cd web && npm run lint` sau thay đổi formatter giờ Hà Nội.
- Kiểm tra không còn temporary test (`tests/tmp-format-date-vn.test.js`, boundary test) trước khi commit.
- Sau deploy/reload PM2, kiểm tra log poller và một giao dịch test để đảm bảo query đúng ngày Việt Nam.
- Tách riêng các commit theo scope: timezone/payment, purge script, frontend time display, docs. Không gom DB vào commit.
