# Admin 30-Day Session Design

## Goal

Admin và quản lý chỉ cần đăng nhập, nhập 2FA một lần, rồi giữ full admin session trong 30 ngày trừ khi token hết hạn, token sai, bị xoá localStorage, hoặc backend đổi `JWT_SECRET`.

## Scope

- Full admin JWT dùng TTL cấu hình từ `.env`, mặc định `30d`.
- TTL này áp dụng cho token phát sau login không cần 2FA, sau verify 2FA, và sau khi hoàn tất enroll 2FA.
- 2FA challenge token vẫn giữ ngắn `5m`.
- Enroll-step token vẫn giữ ngắn `15m`.
- Frontend admin tự xoá `adminToken` và chuyển về `/admin/login` khi API admin trả 401 vì token thiếu, hết hạn, hoặc không hợp lệ.

## Backend Design

Thêm `ADMIN_TOKEN_EXPIRY` vào `src/config.js`, đọc từ `process.env.ADMIN_TOKEN_EXPIRY || '30d'`. `src/services/authService.js` không hard-code `24h` nữa, mà dùng `config.ADMIN_TOKEN_EXPIRY` cho mọi full admin token.

Không thêm session table, refresh token, hay cookie flow. JWT hiện tại vẫn là bearer token trong localStorage, chỉ thay TTL full session và làm TTL cấu hình được.

## Frontend Design

`web/src/lib/api.ts` tiếp tục gắn bearer token cho `/admin/*`. Khi response admin là HTTP 401, helper sẽ:

- gọi `clearAdminToken()`
- redirect browser về `/admin/login` nếu đang ở client và chưa ở trang login
- ném lỗi như hiện tại để caller dừng luồng xử lý

Điều này xử lý trường hợp layout thấy còn token trong localStorage nhưng backend đã reject token. Các admin request không đi qua `apiFetch`, như upload ảnh bằng `FormData`, phải gọi cùng handler khi nhận HTTP 401.

## Testing

- Thêm test Node cho admin JWT expiry:
  - không set `ADMIN_TOKEN_EXPIRY` thì token full admin có TTL khoảng 30 ngày
  - set `ADMIN_TOKEN_EXPIRY=7d` thì token full admin có TTL khoảng 7 ngày
- Chạy test mới bằng `node --test`.
- Chạy `npm run build:web` để kiểm tra TypeScript/frontend compile.

## Non-Goals

- Không bỏ yêu cầu 2FA sau khi token đã hết hạn 30 ngày.
- Không thêm remember-device riêng theo thiết bị.
- Không thêm revoke session theo từng thiết bị.
- Không đổi customer token.
