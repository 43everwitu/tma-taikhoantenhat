# Telegram Bot Notification Toggle Design

## Goal

Cho user tự bật/tắt các tin nhắn Telegram bot dạng marketing/cập nhật bằng lệnh `/thongbao`, trong khi các tin giao dịch quan trọng vẫn luôn được gửi.

Tính năng cũng sửa lỗi `/start` im lặng khi template `welcome` bị tắt: `/start` phải luôn phản hồi tối thiểu để user mở Mini App và quản lý thông báo.

## Scope

Trong scope:

- Thêm command `/thongbao`.
- Hiển thị trạng thái hiện tại: thông báo marketing từ bot đang bật hoặc tắt.
- Hiển thị inline button theo trạng thái:
  - Nếu đang bật: `Tắt thông báo` và `Bỏ qua`.
  - Nếu đang tắt: `Bật thông báo` và `Bỏ qua`.
- Cho user đổi trạng thái nhiều lần, không phải lựa chọn cố định một lần.
- Hiển thị trạng thái thông báo trong `/start`.
- Thêm nút quản lý thông báo trong `/start`.
- Các luồng broadcast/cập nhật marketing phải tôn trọng preference này khi gửi Telegram.
- Web/TMA notifications vẫn giữ nguyên, không bị tắt bởi lệnh này.

Ngoài scope:

- Không thêm UI Mini App/Admin cho preference này.
- Không tách nhiều nhóm preference như đơn hàng, khuyến mãi, tồn kho.
- Không tắt thông báo giao dịch quan trọng.

## User-Facing Behavior

### `/thongbao`

Khi user gửi `/thongbao`, bot tạo user nếu chưa tồn tại rồi trả trạng thái:

- `Thông báo từ bot đang bật.`
- hoặc `Thông báo từ bot đang tắt.`

Inline keyboard:

- Đang bật: `Tắt thông báo` + `Bỏ qua`.
- Đang tắt: `Bật thông báo` + `Bỏ qua`.

Khi user bấm bật/tắt, bot cập nhật preference và edit message sang trạng thái mới. Message mới vẫn hiện nút hành động ngược lại và `Bỏ qua`.

Khi user bấm `Bỏ qua`, bot chỉ answer callback và không đổi preference. Message hiện tại được giữ nguyên.

### `/start`

`/start` vẫn là điểm vào Mini App. Nội dung phải có:

- Lời chào hiện tại nếu template `welcome` bật.
- Fallback text tối thiểu nếu template `welcome` bị tắt.
- Dòng trạng thái ngắn: `Thông báo bot: đang bật` hoặc `Thông báo bot: đang tắt`.
- Inline keyboard có nút `Mở cửa hàng` và `Quản lý thông báo`.

`/start` không được im lặng trong bất kỳ trạng thái template nào.

## Data Model

Tận dụng `users.notification_prefs` hiện có, dạng JSON.

Key mới:

```json
{
  "telegramMarketingEnabled": true
}
```

Semantics:

- Missing key hoặc giá trị khác `false` nghĩa là bật, để không làm mất hành vi hiện tại của user cũ.
- `false` nghĩa là không gửi Telegram DM dạng marketing/cập nhật.

Không thêm migration bắt buộc vì cột `notification_prefs` đã tồn tại từ migration platform. Nếu implementation cần helper ổn định, tạo service nhỏ để đọc/ghi JSON an toàn.

## Notification Policy

Preference này chỉ áp dụng cho Telegram DM dạng marketing/cập nhật:

- Announcement/broadcast từ admin.
- Thông báo sản phẩm mới.
- Thông báo cập nhật sản phẩm.
- Thông báo sản phẩm có hàng lại.
- Thông báo mã giảm giá.

Preference này không áp dụng cho các tin quan trọng:

- Giao key/tài khoản sau khi thanh toán.
- Đơn đã thanh toán nhưng backorder/no-stock cần xử lý.
- Đơn hết hạn/thanh toán hết hạn.
- Nạp ví, xác thực/link tài khoản, reset password.
- Tin admin/channel nội bộ.

Khi user tắt Telegram marketing:

- Không gọi Telegram API cho các tin bị tắt.
- Vẫn insert web notification nếu target là `all` hoặc `web`.
- Kết quả thống kê broadcast phân biệt `sent`, `failed`, và `skippedByPreference`. Skipped do preference không được tính là failed.

## Architecture

### Preference Helper

Thêm helper hoặc service nhỏ, ví dụ `userNotificationPreferenceService`:

- `isTelegramMarketingEnabled(telegramId)`: default `true`.
- `setTelegramMarketingEnabled(telegramId, enabled)`: tạo user phải do command layer xử lý; helper chỉ update user đã tồn tại.
- `getNotificationPrefs(rowOrTelegramId)`: parse JSON an toàn, lỗi parse coi như `{}`.

Helper phải giữ nguyên các key sẵn có trong `notification_prefs`, vì auth flow đang dùng cùng JSON cho link/reset code.

### Bot Command

Thêm module command mới cho `/thongbao`, đăng ký trong `src/bot/index.js`.

Callback data dùng prefix riêng:

- `notify_pref:on`
- `notify_pref:off`
- `notify_pref:skip`

Các callback này phải được xử lý trước fallback callback để tránh fallback gửi “Mở cửa hàng” nhầm.

Bot command menu thêm `/thongbao` với mô tả ngắn, giữ `/start`.

### `/start` Fix

`handleStart` hiện dùng `messageTemplateService.renderIfEnabled('welcome', ...)` và return nếu template tắt. Thiết kế mới đổi thành:

- Render template nếu có.
- Nếu không có, dùng fallback text tối thiểu.
- Luôn reply với keyboard.

Keyboard `/start` thêm nút `Quản lý thông báo`, dùng callback `notify_pref:show` và hiển thị cùng màn trạng thái như `/thongbao`.

### Dispatch Filtering

Các send path marketing cần lọc Telegram theo preference:

- `NotificationService.notify(...)` khi type/channel thuộc marketing path phải có cách gọi tôn trọng preference.
- `NotificationService.broadcast(...)` lọc per-user trước khi `sendMessage` hoặc `sendPhoto`.
- `notifyStockReplenished`, `notifyNewProduct`, `notifyProductUpdated`, discount notify phải đi qua logic lọc chung.

Không lọc trong `telegramApiClient` global vì nhiều tin giao dịch quan trọng cũng dùng client này và không được tắt.

## Error Handling

- Nếu `notification_prefs` JSON hỏng, coi như `{}` và default bật.
- Nếu callback đến từ user chưa có trong DB, tạo user bằng `userService.findOrCreate(ctx.from)` rồi xử lý.
- Nếu edit message thất bại do Telegram message cũ/không editable, fallback `ctx.reply` trạng thái mới.
- Nếu Telegram send marketing bị skip do preference, không log error.
- Nếu Telegram API lỗi thật, giữ logging hiện tại.

## Tests

Backend/bot tests:

- `/thongbao` với user default hiển thị đang bật, nút `Tắt thông báo` và `Bỏ qua`.
- Callback tắt cập nhật `notification_prefs.telegramMarketingEnabled = false`.
- Callback bật cập nhật lại `true`.
- Callback `Bỏ qua` không đổi preference.
- `/start` vẫn phản hồi khi `welcome` disabled.
- `/start` hiển thị trạng thái thông báo và nút quản lý thông báo.

Notification tests:

- Broadcast `target='all'` không gửi Telegram cho user đã tắt, vẫn tạo web notification.
- Broadcast không tính skipped preference là failed.
- Stock/product/discount notify đi qua cùng policy.
- Delivery/order/topup/auth notification vẫn gửi Telegram dù user tắt marketing.

## Success Criteria

- User có thể bật/tắt Telegram marketing bằng `/thongbao` nhiều lần.
- `/start` không còn im lặng khi `welcome` bị tắt.
- Tắt thông báo không làm mất tin giao key, thanh toán, nạp ví, hoặc auth.
- Web/TMA notification vẫn hoạt động như trước.
- Không thêm migration không cần thiết và không làm mất dữ liệu JSON cũ trong `notification_prefs`.
