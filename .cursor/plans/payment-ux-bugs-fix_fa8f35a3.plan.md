---
name: payment-ux-bugs-fix
overview: "Redesign payment QR page with copy buttons for account number + payment code, download-QR action, instant render via cached order payload, and fix three runtime bugs: MBBank 401, Telegram v6.0 BackButton warnings, Next/Image aspect-ratio warning."
todos:
  - id: fix-mbbank-401
    content: Xóa dòng API_ACCESS_TOKEN trùng lặp trong .env
    status: completed
  - id: switch-qr-only
    content: Đổi paymentService.generateQRUrl từ compact2.png → qr_only.png
    status: completed
  - id: api-expose-account
    content: Thêm accountNumber/accountName vào response của POST /orders và GET /orders/:id/status
    status: completed
  - id: redesign-qrpanel
    content: "Viết lại QrPanel.tsx: QR vuông 240×240 + 4 dòng info với copy buttons + nút Tải QR"
    status: completed
  - id: cache-order-payload
    content: Trong dat-hang setQueryData(['order', id], ...) và preload QR image trước router.push
    status: completed
  - id: order-page-new-props
    content: Extend OrderStatus interface + truyền accountNumber/Name xuống QrPanel
    status: completed
  - id: fix-discount-placeholder
    content: Bỏ class uppercase, thêm placeholder:normal-case + opacity-60 cho input mã giảm giá
    status: completed
  - id: version-gate-backbutton
    content: Gate BackButton.show/hide bằng version >= 6.1 trong useTelegramBackButton.ts
    status: completed
  - id: version-gate-swipes
    content: Gate disableVerticalSwipes bằng version >= 7.7 trong telegram.ts useTmaViewport
    status: completed
  - id: i18n-strings
    content: Thêm 5 string mới vào vi.ts (accountNumber, accountName, downloadQr, copyHint, copied)
    status: completed
  - id: verify-runtime
    content: Restart ./dev.sh, đặt test order, kiểm console + API log sạch warning và 401
    status: completed
isProject: false
---

# Payment UX Polish + Bug Fixes

## 1. Bugs

### 1a. MBBank 401 (env conflict)
[mbbank-api/app/config.py:46](mbbank-api/app/config.py) prefers `API_ACCESS_TOKEN` over `MBBANK_API_TOKEN`, nhưng `.env` đặt 2 giá trị khác nhau (dòng 45 vs 52). Node client gửi `MBBANK_API_TOKEN=44d4bd16...`, sidecar verify với `API_ACCESS_TOKEN=c731b9fd...` → 401.

**Fix**: xoá dòng 52 `API_ACCESS_TOKEN=...` trong [.env](.env). Sidecar sẽ fallback về `MBBANK_API_TOKEN` (đã có comment ở dòng 43 giải thích flow này).

### 1b. Telegram v6.0 unsupported method spam
Client cũ không support `BackButton.show/hide` (v6.1+) và `disableVerticalSwipes` (v7.7+) → log spam mỗi lần navigate.

**Fix**:
- [web/src/lib/useTelegramBackButton.ts](web/src/lib/useTelegramBackButton.ts): gate bằng `parseFloat(wa.version ?? '0') >= 6.1` trước khi gọi `bb.show/hide/onClick/offClick`.
- [web/src/lib/telegram.ts](web/src/lib/telegram.ts) trong `useTmaViewport` (dòng 148): chỉ gọi `wa.disableVerticalSwipes?.()` khi `parseFloat(wa.version ?? '0') >= 7.7`.

### 1c. Next/Image aspect-ratio warning
Resolved bởi item 2a — chuyển sang QR vuông `qr_only.png` 540×540, declare width/height 1:1.

## 2. Backend — expose bank account info

[src/api/routes/customer.js](src/api/routes/customer.js):

**POST /orders** (dòng 166-177): thêm `accountNumber`, `accountName` vào `payment` block. Đã có sẵn ở `paymentService.buildPayment()` (dòng 89-90 của [src/services/paymentService.js](src/services/paymentService.js)).

**GET /orders/:id/status** (dòng 210-222): thêm `accountNumber: bank.ACCOUNT`, `accountName: bank.ACCOUNT_NAME`.

**Đổi QR endpoint sang qr_only**: thêm helper `generateBareQRUrl` đã có sẵn (dòng 43-50 [paymentService.js](src/services/paymentService.js)), nhưng hiện chưa nhúng `accountName` query param. Tạo method mới `generateCleanQRUrl(amount, content, bank)` trả về `qr_only.png?amount=&addInfo=&accountName=` (qr_only chấp nhận cùng query string). Hoặc đơn giản: sửa `generateQRUrl` đổi suffix `compact2` → `qr_only`. Chọn **sửa `generateQRUrl`** để mọi caller (web + bot fallback) đều chuyển sang QR sạch, brand được render in-app.

## 3. Front-end — Payment UI redesign

### 3a. New [QrPanel.tsx](web/src/app/(miniapp)/components/QrPanel.tsx)

Cấu trúc mới:
```
+--------------------------------+
| MB Bank          [tải QR ↓]    |  ← brand row + download
+--------------------------------+
|        [QR vuông 240×240]      |  ← qr_only.png, priority, 1:1
+--------------------------------+
| Số tài khoản    0936089684 [copy] |
| Chủ tài khoản   Do Thi Thu Mai    |
| Nội dung CK     PNS100218   [copy] |
| Số tiền         9.000 đ     [copy] |
+--------------------------------+
| Quét QR hoặc CK đúng nội dung. |
| Tự động giao key trong 1–2 phút.|
+--------------------------------+
```

Props mở rộng: `accountNumber`, `accountName` thêm vào interface.

State: `copied: 'account' | 'code' | 'amount' | null`.

Download QR: button gọi `fetch(qrUrl).then(r => r.blob())` → tạo `<a download="QR-PNS100218.png">` → trigger click → revoke object URL. Nếu Telegram WebView không cho download (iOS quirks), fallback `wa.openLink(qrUrl)` để mở tab mới.

Image fix: `<Image src={qrUrl} alt="QR" width={240} height={240} priority unoptimized />` — qr_only là PNG vuông native nên không còn aspect-ratio warning.

### 3b. Instant load — cache order payload trước khi navigate

[web/src/app/(miniapp)/dat-hang/page.tsx](web/src/app/(miniapp)/dat-hang/page.tsx) `placeOrder()` (dòng 41-73):

Sau khi nhận `resp` từ POST `/orders`, trước `router.push`:
```ts
qc.setQueryData(['order', String(resp.order.id)], {
  id: String(resp.order.id),
  status: resp.order.status,
  totalPrice: resp.payment.amount,
  paymentCode: resp.payment.paymentCode,
  qrUrl: resp.payment.qrUrl,
  bankName: resp.payment.bankName,
  accountNumber: resp.payment.accountNumber,
  accountName: resp.payment.accountName,
  expiresAt: resp.order.expiresAt,
  productName: cart.items[i].name,
  quantity: cart.items[i].quantity,
})
// Preload QR image so the network fetch happens during route transition
if (typeof window !== 'undefined') { const i = new window.Image(); i.src = resp.payment.qrUrl }
```

Cần `import { useQueryClient } from '@tanstack/react-query'`.

Kết quả: trang `/don-hang/{id}` mở ra render ngay với data đã cache → không còn flash "Đang tải…", QR PNG cũng đã warm trong browser cache, hiển thị tức thì.

### 3c. Order detail page — không hiển thị "Đang tải…" khi đã có cache

[web/src/app/(miniapp)/don-hang/[id]/page.tsx](web/src/app/(miniapp)/don-hang/[id]/page.tsx) dòng 26-33: thêm `staleTime: 0` (đã có default 60s nhưng pending order cần fresh), hoặc đơn giản giữ nguyên — TanStack sẽ ưu tiên cached data từ `setQueryData`. Cập nhật interface `OrderStatus` thêm `accountNumber?: string; accountName?: string`. Truyền 2 prop mới xuống `<QrPanel />`.

## 4. Mã giảm giá

[dat-hang/page.tsx:111-117](web/src/app/(miniapp)/dat-hang/page.tsx) — giữ nguyên `placeholder="VD: SUMMER10"` theo confirm của user. Cải thiện độ nổi:
- Bỏ `uppercase` class (input value đã được `toUpperCase()` ở `onChange` — Tailwind `uppercase` không cần thiết và có thể làm placeholder lệch ở 1 số browser).
- Thêm `placeholder:opacity-60 placeholder:normal-case` để placeholder rõ ràng, không bị uppercase nuốt format "VD:".

## 5. i18n strings

Thêm vào [web/src/i18n/vi.ts](web/src/i18n/vi.ts) (section `order`):
- `accountNumber: 'Số tài khoản'`
- `accountName: 'Chủ tài khoản'`
- `downloadQr: 'Tải QR'`
- `copyHint: 'Bấm để chép'`
- `copied: 'Đã chép'`

## 6. Files touched

- [.env](.env) — xoá 1 dòng (API_ACCESS_TOKEN)
- [src/services/paymentService.js](src/services/paymentService.js) — đổi `compact2` → `qr_only` trong `generateQRUrl`
- [src/api/routes/customer.js](src/api/routes/customer.js) — expose `accountNumber`/`accountName` trên cả `POST /orders` và `GET /orders/:id/status`
- [web/src/app/(miniapp)/components/QrPanel.tsx](web/src/app/(miniapp)/components/QrPanel.tsx) — redesign hoàn toàn
- [web/src/app/(miniapp)/don-hang/[id]/page.tsx](web/src/app/(miniapp)/don-hang/[id]/page.tsx) — extend interface + pass new props
- [web/src/app/(miniapp)/dat-hang/page.tsx](web/src/app/(miniapp)/dat-hang/page.tsx) — `setQueryData` + preload + placeholder styling fix
- [web/src/lib/useTelegramBackButton.ts](web/src/lib/useTelegramBackButton.ts) — version gate
- [web/src/lib/telegram.ts](web/src/lib/telegram.ts) — version gate cho `disableVerticalSwipes`
- [web/src/i18n/vi.ts](web/src/i18n/vi.ts) — 5 string mới

## 7. Verification

Sau khi apply:
- Kill node + restart `./dev.sh`, đặt 1 đơn test trong TMA dev tunnel → trang `/don-hang/{id}` mở instant, QR vuông, 4 trường có copy, nút "Tải QR" download `.png`.
- Console log: không còn `BackButton is not supported`, không còn `Image with src ... has either width or height modified`.
- API log: không còn `❌ MBBank API error: 401` (sidecar accept token).
- Mã giảm giá `SUMMER10`-style: placeholder hiển thị rõ trong field; nhập text bị uppercase ngay khi gõ.