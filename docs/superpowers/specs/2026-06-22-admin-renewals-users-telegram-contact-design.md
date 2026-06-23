# Admin renewals, users, and Telegram contact design

## Mục tiêu

Sửa ba vấn đề trong admin:

1. `/admin/renewals` phải phản ánh đúng lịch sử nhắc gia hạn, kể cả dữ liệu cũ đã có `stock.reminder_sent_at` nhưng chưa có `renewal_reminder_logs`.
2. `/admin/users` phải hiển thị đủ người dùng bằng pagination rõ ràng, có thống kê tổng và cảnh báo nếu có order trỏ tới user thiếu hồ sơ.
3. `/admin/orders` và `/admin/users` có nút “Nhắn tin” để mở Telegram chat trực tiếp với khách. Nút này chỉ điều hướng sang Telegram, không gửi tin qua bot và không ghi message trong hệ thống.

## Ngoài scope

- Không xây hệ thống inbox/CRM trong admin.
- Không gửi tin nhắn chủ động từ backend khi admin bấm “Nhắn tin”.
- Không tự tạo user thật từ user ảo.
- Không thay đổi checkout, payment matching, hoặc renewal purchase flow.
- Không tự chạy backfill trong migration. Backfill dữ liệu runtime phải qua script dry-run/apply có backup.

## Hiện trạng đã khảo sát

- `src/services/keyExpiryReminderService.js` đang gửi reminder daily/catch-up, tạo notification và log khi sweep chạy thành công.
- Bảng `renewal_reminder_logs` được tạo ở migration `051_renewal_reminder_logs`.
- Local DB có `stock.reminder_sent_at` nhiều hơn `renewal_reminder_logs`, tức có dữ liệu cũ đã đánh dấu nhắc nhưng thiếu audit log.
- `/admin/users` API hiện trả trực tiếp array từ bảng `users`, mặc định `limit=20`; frontend chưa có pagination/meta nên admin dễ thấy như thiếu nhiều user.
- Local DB hiện không có order-user orphan (`orders.user_id` đều có row trong `users`), nhưng vẫn cần guard để phát hiện lệch dữ liệu sau này.
- `/admin/orders` đã trả `userId`, `userName`, `username`; frontend có cột “Thao tác” phù hợp để thêm nút “Nhắn tin”.
- `/admin/renewals/page.tsx` hiện có markup lỗi lặp `<input`; cần sửa trong phạm vi UI cleanup của feature.

## Renewal sweep và logging

### Auto sweep

`keyExpiryReminderService.sweep()` tiếp tục là owner của job auto daily 09:00 ICT và catch-up sau boot. Logic mới:

- Chọn stock sắp hết hạn như hiện tại.
- Bỏ qua stock đã có `reminder_sent_at`.
- Bỏ qua stock đã có log `exhausted`.
- Nếu Telegram gửi thành công:
  - tạo TMA notification nếu có order/lifecycle hợp lệ;
  - insert log `sent`;
  - set `stock.reminder_sent_at = CURRENT_TIMESTAMP`.
- Nếu template `bot.expiry_reminder` disabled:
  - insert log `skipped`;
  - set `reminder_sent_at` để không nhắc lại cùng stock.
- Nếu gửi Telegram lỗi:
  - insert log `failed`;
  - không set `reminder_sent_at`;
  - lần auto/manual sau retry lại nếu chưa quá giới hạn.
- Failed retry limit:
  - đếm số log `failed` theo `stock_id`;
  - retry tối đa 3 lần;
  - khi đạt 3 lần, ghi log `exhausted` và các auto sweep sau bỏ qua stock đó.

### Manual sweep

Thêm endpoint admin để bấm “Quét gia hạn ngay”:

- `POST /admin/renewals/sweep`
- Yêu cầu permission `orders.write`.
- Nếu bot chưa sẵn sàng: trả `BOT_UNAVAILABLE`, không tạo log giả.
- Nếu bot sẵn sàng: gọi cùng service sweep như auto job.
- Response trả summary: `scanned`, `sent`, `skipped`, `failed`, `exhausted`.

Manual sweep dùng cùng retry/exhausted policy. Khi đã `exhausted`, nút manual không tự retry tiếp; admin xử lý thủ công ngoài hệ thống.

## Backfill renewal logs cũ

Thêm helper service và script:

- Helper: tìm `stock` có `reminder_sent_at IS NOT NULL` nhưng không có `renewal_reminder_logs.stock_id`.
- Script: `scripts/backfill-renewal-logs.js`
  - chạy không flag là dry-run;
  - `--apply` tạo backup `data/shop.db.bak-pre-renewal-log-backfill-<timestamp>`;
  - apply trong transaction;
  - không stage/commit DB hoặc backup.

Log backfill:

- `status = 'sent_legacy'`
- `created_at = stock.reminder_sent_at`
- `telegram_sent = 1`
- `web_notification_id` best-effort nếu tìm được notification liên quan, không bắt buộc.
- `order_id`, `expiry_date`, `days_before_expiry` tính best-effort từ stock/order lifecycle.
- Không set lại `reminder_sent_at`.
- Chạy lại script không tạo duplicate log.

## Admin renewals UI/API

API `GET /admin/renewals`:

- Giữ pagination và search hiện có.
- Hỗ trợ status mới: `sent`, `sent_legacy`, `skipped`, `failed`, `exhausted`.
- Không thêm summary counts vào route list trong scope này; summary chỉ nằm ở response của manual sweep.

UI `/admin/renewals`:

- Sửa markup lỗi lặp `<input`.
- Hiển thị status labels:
  - `sent`: Đã gửi
  - `sent_legacy`: Đã gửi (khôi phục)
  - `skipped`: Bỏ qua
  - `failed`: Lỗi
  - `exhausted`: Dừng retry
- Thêm nút “Quét gia hạn ngay” ở đầu trang.
- Khi bấm nút, hiển thị summary kết quả và refetch list.
- Nếu có failed/exhausted, hiển thị rõ để admin xử lý thủ công.

## Admin users API và UI

### API list

Đổi `GET /admin/users` response từ array sang:

```json
{
  "success": true,
  "data": {
    "users": [],
    "stats": {
      "totalUsers": 0,
      "buyers": 0,
      "missingProfiles": 0
    }
  },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

User thật lấy từ bảng `users`. Nếu có `orders.user_id` không có row trong `users`, API thêm “user ảo” read-only vào danh sách khi phù hợp với search/page.

User ảo shape:

- `telegram_id`
- `username: null`
- `full_name: "ID <telegram_id>"`
- `balance: 0`
- `order_count`
- `created_at`: dùng thời điểm order gần nhất để sort theo hoạt động mới nhất.
- `is_virtual: true`

Search tìm theo full name, username, Telegram ID; với user ảo tìm theo Telegram ID.

### API detail

`GET /admin/users/:telegramId`:

- Nếu có user thật: trả như hiện tại, thêm `is_virtual: false`.
- Nếu không có user thật nhưng có orders:
  - trả synthetic user `is_virtual: true`;
  - trả danh sách orders;
  - trả recentTopups nếu có theo `wallet_topups.user_id`, nếu không thì array rỗng.
- Nếu không có user và không có orders: 404.

### UI

Trang `/admin/users`:

- Thêm statistic cards: tổng users, người từng mua, thiếu hồ sơ.
- Nếu `missingProfiles > 0`, hiện cảnh báo nổi bật: “Có X người mua thiếu hồ sơ user; chỉ xem được đơn, không chỉnh ví.”
- Thêm pagination:
  - Trước/Sau
  - hiển thị page/total
  - chọn limit 20/50/100.
- Với user ảo:
  - badge “Thiếu hồ sơ”;
  - không hiện nút điều chỉnh số dư;
  - vẫn xem được orders;
  - vẫn có nút “Nhắn tin” fallback bằng Telegram ID.

## Nút “Nhắn tin” Telegram

Tạo helper frontend dùng chung, ví dụ `buildTelegramContactUrl({ username, telegramId })`:

- Nếu có username:
  - strip leading `@`;
  - link `https://t.me/<username>`.
- Nếu không có username:
  - link `tg://user?id=<telegram_id>`.

UI:

- `/admin/orders`: thêm nút “Nhắn tin” trong cột “Thao tác” theo lựa chọn đã duyệt.
- `/admin/users`: thêm nút “Nhắn tin” trong cột “Thao tác”; trong drawer chi tiết cũng có nút cạnh thông tin user.
- Link mở bằng `target="_blank"` và `rel="noreferrer"`.
- Tooltip:
  - có username: “Mở Telegram @username”
  - không username: “Mở Telegram bằng ID — có thể không hoạt động nếu Telegram không cho”.

Không gọi backend, không gửi qua bot, không ghi audit log.

## Error handling

- Sweep xử lý từng stock độc lập; lỗi một stock không làm fail toàn bộ batch.
- Manual sweep trả summary thay vì chỉ báo success/fail chung.
- Failed Telegram attempt không set `reminder_sent_at`, để retry được.
- `exhausted` là trạng thái cuối sau 3 failed attempts.
- Backfill thiếu dữ liệu order/lifecycle vẫn tạo `sent_legacy` với dữ liệu tốt nhất từ stock/product.
- User ảo không cho chỉnh ví để tránh tạo dữ liệu tài chính trên hồ sơ không đầy đủ.

## Testing

Backend/service:

- `keyExpiryReminderService`:
  - success tạo `sent`, notification, và `reminder_sent_at`;
  - Telegram failure tạo `failed`, không set `reminder_sent_at`;
  - failed đủ 3 lần tạo `exhausted` và auto sweep sau bỏ qua;
  - template disabled tạo `skipped` và set `reminder_sent_at`.
- Backfill:
  - dry-run đếm đúng;
  - apply tạo `sent_legacy` với `created_at = stock.reminder_sent_at`;
  - chạy lại không duplicate.
- Admin renewals API:
  - status filter mới;
  - manual sweep route yêu cầu `orders.write`;
  - response summary đúng.
- Admin users API:
  - pagination/meta/stats;
  - user thật vẫn hoạt động;
  - user ảo từ order orphan read-only detail.

Frontend:

- Telegram link helper:
  - username có/không có `@`;
  - fallback `tg://user?id=...`.
- Users page render stats, warning, pagination, virtual badge.
- Orders/users render nút “Nhắn tin” trong cột thao tác.
- Renewals page render status mới và manual sweep summary.

## Deploy/runbook

1. Deploy code.
2. Chạy dry-run:
   `node scripts/backfill-renewal-logs.js`
3. Nếu count đúng, chạy apply:
   `node scripts/backfill-renewal-logs.js --apply`
4. Không commit `data/shop.db` hoặc backup.
5. Mở `/admin/renewals`, kiểm tra `sent_legacy` xuất hiện.
6. Dùng nút “Quét gia hạn ngay” chỉ khi cần xác nhận job đang hoạt động hoặc vừa fix lỗi bot/API.
