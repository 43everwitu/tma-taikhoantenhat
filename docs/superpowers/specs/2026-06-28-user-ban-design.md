# User Ban Design

## Goal

Thêm moderation cho customer theo một trạng thái duy nhất: `active`, `shadow_banned`, hoặc `banned`.

## Decisions

- Dùng cột trạng thái trực tiếp trên bảng `users`, không tạo bảng moderation riêng.
- `shadow_banned`: user vẫn đăng nhập, tạo đơn, tạo topup và thanh toán bình thường. Khi payment match một đơn mới của user shadow banned, hệ thống không auto-deliver key. Đơn được chuyển sang `paid`, khách thấy thông điệp chờ xử lý như backorder, và admin xử lý thủ công.
- `banned`: user bị chặn toàn bộ API customer kể cả token cũ. Mini App/TMA không dùng được. Bot command phải bị chặn ở entrypoint bot.
- Đổi trạng thái ban không retroactive. Đơn/topup đã tồn tại giữ nguyên dữ liệu và không bị hủy tự động.
- Admin đổi trạng thái trong `/admin/users`; mỗi lần đổi ghi audit log.

## Data Model

Thêm vào `users`:

- `account_status TEXT NOT NULL DEFAULT 'active'`
- `ban_reason TEXT`
- `banned_at DATETIME`
- `banned_by INTEGER`

Giá trị hợp lệ ở tầng service:

- `active`
- `shadow_banned`
- `banned`

`ban_reason`, `banned_at`, `banned_by` được set khi trạng thái khác `active`. Khi unban về `active`, các field này được clear.

Thêm vào `orders`:

- `requires_manual_review INTEGER NOT NULL DEFAULT 0`
- `manual_review_reason TEXT`

Hai field này là snapshot tại lúc tạo đơn. Nếu user đang `shadow_banned` khi tạo đơn, đơn mới có `requires_manual_review = 1` và `manual_review_reason = 'shadow_banned'`.

## Backend Flow

### Customer Auth

`requireCustomer` sau khi verify JWT sẽ load user từ DB. Nếu `account_status = 'banned'`, trả `403 USER_BANNED`.

`optionalCustomer` không set `req.customer` nếu user đã bị hard ban.

`/api/v1/auth/miniapp` và `/api/v1/auth/customer/login` cũng chặn banned user trước khi trả token. Điều này tránh phát token mới cho user đã ban, trong khi `requireCustomer` vẫn là lớp chặn token cũ.

### Bot

Thêm middleware bot dùng `ctx.from.id` để kiểm tra `users.account_status`. Nếu `banned`, trả một tin ngắn và không gọi `next()`.

### Shadow Ban Payment

Ở nhánh auto-payment match đủ tiền trong `PaymentPoller._processOrderMatch`:

1. Nếu order có `requires_manual_review = 1`, không gọi `confirmAndDeliver`.
2. Gọi `orderService.markPaid(order.id)` để chuyển `pending -> paid`.
3. Ghi transaction matched như bình thường.
4. Gửi customer message bằng template backorder/chờ xử lý hiện có.
5. Gửi order channel card không có keys để admin thấy cần xử lý thủ công.

Các order đã được tạo trước khi user bị đổi sang shadow ban không bị đổi behavior, vì `requires_manual_review` đã được snapshot khi tạo đơn. Nếu user bị unban sau khi đã tạo một đơn trong thời gian shadow ban, đơn đó vẫn cần xử lý thủ công để tránh thay đổi ngầm dữ liệu cũ.

### Admin API

`GET /admin/users` và `GET /admin/users/:telegramId` trả thêm `account_status`, `ban_reason`, `banned_at`, `banned_by`.

Thêm endpoint:

`PATCH /admin/users/:telegramId/status`

Body:

```json
{
  "status": "active",
  "reason": ""
}
```

Rules:

- Yêu cầu `users.write`.
- `status` phải là `active`, `shadow_banned`, hoặc `banned`.
- User ảo chỉ có order nhưng chưa có row trong `users` không thể ban qua endpoint này; trả `404 USER_NOT_FOUND`.
- Ghi audit action `user.moderation.update`.

## Admin UI

Trong `/admin/users`:

- List hiển thị badge nếu user là `shadow_banned` hoặc `banned`.
- Detail drawer có selector trạng thái và ô lý do.
- Nút lưu gọi `PATCH /admin/users/:telegramId/status`.
- User ảo chỉ hiển thị trạng thái không chỉnh được.

## Error Semantics

Hard ban trả:

```json
{
  "success": false,
  "error": {
    "code": "USER_BANNED",
    "message": "Tài khoản của bạn đã bị hạn chế. Vui lòng liên hệ hỗ trợ."
  }
}
```

Shadow ban không lộ lý do cho khách. Khách thấy đơn đã thanh toán và đang chờ shop xử lý thủ công.

## Tests

- Migration/service test cho trạng thái user.
- Customer auth test: token cũ của banned user bị `403 USER_BANNED`.
- Mini App auth test: banned user không nhận token mới.
- Payment poller test: order có `requires_manual_review = 1` chuyển sang `paid`, không gọi delivery, vẫn post order channel card.
- Order creation test: user `shadow_banned` tạo đơn mới được snapshot `requires_manual_review = 1`; đơn tạo trước khi đổi trạng thái không bị chỉnh.
- Admin users API test: đổi status, list/detail trả status, audit log được ghi.

## Out of Scope

- Ban tạm thời theo `banned_until`.
- Lịch sử nhiều lần ban/unban ngoài audit log hiện có.
- Tự hủy hoặc chỉnh các đơn/topup đã tồn tại khi admin đổi trạng thái.
