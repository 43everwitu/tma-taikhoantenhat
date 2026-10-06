# Android TMA "Tải thất bại" — Root Cause & Fix

Ngày: 2026-05-31. Lỗi lớn: Telegram Mini App load lỗi trên Android (màn "Oái... Tải ... thất bại"),
trong khi iOS / PC / Android-Chrome đều bình thường.

## Triệu chứng
- Android Telegram: trang chủ có khi load được, nhưng bấm sản phẩm / link khác hoặc vuốt lên/xuống
  là bung màn lỗi native của Telegram. Có lúc không load được gì.
- iOS, PC, và **Chrome trên chính máy Android đó** đều mở `https://tenhatshop.taikhoantenhat.me/` bình thường.

## Có 3 tầng nguyên nhân (xử lý theo thứ tự)

### 1. HTML bị cache stale → chunk JS 404 (lỗi code, đã fix vĩnh viễn)
- Rule global cũ trong `web/next.config.ts` đặt `Cache-Control: no-transform` cho `source: '/(.*)'`,
  làm **mất** directive chống cache mặc định của Next cho tài liệu HTML. WebView Android cache HTML cũ;
  sau mỗi deploy chunk JS đổi hash (immutable) → HTML cũ trỏ chunk đã xoá → JS 404 → trắng/lỗi.
  Dấu hiệu trong log: `Failed to find Server Action "0000..."`.
- **Fix** (`web/next.config.ts`, tách `headers()` thành 3 rule):
  - HTML/document (`/((?!_next/static|_next/image|uploads|api/).*)`): `Cache-Control: no-store, must-revalidate, no-transform`
  - Static chunks (`/_next/static/:path*`): `public, max-age=31536000, immutable, no-transform`
  - X-Robots-Tag giữ toàn site (`/:path*`)
- Verify: `curl -sI https://.../` → HTML phải `no-store`; `/_next/static/*.js` phải `immutable`.

### 2. Cloudflare SSL mode = Flexible → redirect loop vô hạn (regression, sập MỌI client)
- Khi vào Cloudflare để tắt TLS 1.3, encryption mode bị chuyển sang **Flexible**.
  Flexible: Client→CF dùng HTTPS, nhưng CF→Origin dùng **HTTP:80**. Nginx (Certbot) ép HTTP→HTTPS (301)
  → CF trả 301 → client lại HTTPS → CF lại gọi origin HTTP → **301 lặp vô hạn**.
- Chẩn đoán: qua CF `/` trả `301 Location: chính nó`; origin `:443` trực tiếp trả `200`; origin `:80` trả `301`.
- **Fix**: Cloudflare SSL/TLS → Overview → **Full (strict)** (KHÔNG Flexible). (Tạm thời đã TẮT proxy luôn.)

### 3. Telegram Android cache trạng thái hỏng (nguyên nhân cuối, làm Android vẫn lỗi dù origin đã khỏe)
- Sau khi origin khỏe trở lại (proxy off, `200`, cert full-chain hợp lệ, TLS 1.2+1.3 OK), Chrome trên máy
  Android mở được nhưng **Telegram WebView vẫn lỗi** vì app Telegram cache lại trang redirect-loop cũ và
  không refetch.
- **Fix (một lần)**:
  - Tạm đổi `MINIAPP_URL` thêm version query (vd `?v=20260531`) để ép Telegram coi là URL mới, bỏ qua
    trang lỗi đã cache. Bot tự đồng bộ nút menu khi khởi động (`src/index.js` → `setChatMenuButton`).
  - Trên điện thoại: Telegram → Settings → Data and Storage → Storage Usage → **Clear Cache**;
    Android Settings → Apps → Telegram → Storage → **Clear cache** (KHÔNG Clear data); **Force stop**;
    bật/tắt Airplane mode để flush DNS; mở lại bot và bấm nút "Mở shop".
- Kết quả: Android hoạt động bình thường.
- **QUAN TRỌNG — phải GIỮ version query vĩnh viễn, KHÔNG trả URL về trần.**
  Đã thử trả `MINIAPP_URL` về `https://tenhatshop.taikhoantenhat.me` (trần) → Android **lỗi lại ngay**,
  trong khi `/?v=20260531` vẫn chạy. Kiểm chứng: server trả `200` + `no-store` y hệt cho CẢ HAI URL
  (không redirect), nên khác biệt 100% là **cache tầng app của Telegram Android theo từng URL**:
  URL trần đã bị "nhiễm" trang redirect-loop hỏng từ lúc sự cố và Telegram **không request lại** cho đúng
  URL đó (no-store ở tầng HTTP không cứu được vì Telegram không hề gọi lại). URL có `?v=` là key cache mới
  → sạch.
  → Không thể xóa cache Telegram từ xa trên máy mọi user, nên `MINIAPP_URL` phải mang version query cố định.
  Mỗi lần cần "phá" cache Telegram (vd sau sự cố), **bump số version** (`?v=20260531` → `?v=20260601`).
- Lưu ý phân tầng: `no-store` (tầng 1) lo việc HTML luôn khớp build khi Telegram CÓ request; còn version query
  lo việc ép Telegram request URL mới khi cache app của nó bị kẹt. Hai cái bổ trợ nhau, cần cả hai.

## Cấu hình Cloudflare đúng (nếu bật proxy lại)
Để vừa có CF vừa không tái phát redirect loop và lỗi WebView Android:
- SSL/TLS → Overview: **Full (strict)**
- SSL/TLS → Edge Certificates: **TLS 1.3 = Off**, Minimum TLS = 1.2
- Network: **HTTP/3 (QUIC) = Off**
(WebView Android của Telegram hay fail bắt tay TLS 1.3 / QUIC với Cloudflare — đây là lỗi đã được ghi nhận rộng rãi.)

## Bài học / checklist khi TMA Android lỗi mà iOS/PC ổn
1. Thử mở URL bằng **Chrome trên chính máy Android** → tách lỗi "trang web" vs "ngữ cảnh Telegram".
2. Kiểm tra header HTML: phải `no-store` (không để cache document).
3. Kiểm tra qua CF vs origin trực tiếp (`--resolve domain:443:<VPS_IP>`): phát hiện redirect loop / SSL mode sai.
4. Kiểm tra cert full-chain + TLS 1.2/1.3: `openssl s_client -showcerts`.
5. Telegram cache rất lì → đổi `MINIAPP_URL` (?v=) + Clear Cache + Force stop để ép load tươi.

## Lệnh verify nhanh
```bash
# HTML phải no-store, chunk phải immutable
curl -sI https://tenhatshop.taikhoantenhat.me/ | grep -i cache-control
# Qua CF không được 301 loop (mong đợi 200)
curl -sS -D - -o /dev/null https://tenhatshop.taikhoantenhat.me/ | grep -iE '^HTTP/|^location:'
# Origin trực tiếp (bypass CF)
curl -sS -k --resolve tenhatshop.taikhoantenhat.me:443:14.225.210.62 -D - -o /dev/null https://tenhatshop.taikhoantenhat.me/ | grep -i '^HTTP/'
# Cert full-chain + verify
echo | openssl s_client -connect tenhatshop.taikhoantenhat.me:443 -servername tenhatshop.taikhoantenhat.me 2>/dev/null | grep -i 'Verify return code'
```
