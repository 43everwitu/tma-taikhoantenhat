# Low Stock Done Snooze Design

## Bối cảnh

Thông báo tồn kho thấp hiện được gửi vào Telegram channel/topic qua `adminNotifyService.notify('low_stock', ...)`. Message có nút `Thêm kho cho #ID` để mở dashboard. Hệ thống đã chống báo lặp theo một đợt thấp kho bằng `products.last_low_stock_alert_at`, nhưng khi admin nhập thêm stock thì `notifyStockReplenished()` xóa marker này. Nếu tồn kho mới vẫn chưa vượt ngưỡng, lượt `checkLowStock()` kế tiếp có thể gửi lại cảnh báo.

Admin muốn có nút `Đã up Stock` ngay trên message low-stock. Khi bấm nút này, message được xóa khỏi channel và sản phẩm đó không báo lại trong 24 giờ.

## Mục tiêu

- Thêm nút callback `✅ Đã up Stock` vào message `low_stock`.
- Khi bấm nút, bot xóa chính message low-stock khỏi channel/topic.
- Khi bấm nút, sản phẩm được snooze 24 giờ để `checkLowStock()` không báo lại trong thời gian đó.
- Sau 24 giờ, nếu tồn kho vẫn thấp và marker cho phép, hệ thống được báo lại.
- Không thay đổi nút `📥 Thêm kho cho #ID`.
- Không thay đổi thông báo có hàng cho khách.

## Không làm

- Không thêm UI web/admin mới.
- Không thêm phân quyền Telegram callback theo admin id trong lần này.
- Không đổi logic tính ngưỡng tồn kho thấp.
- Không xóa hoặc đổi template `admin.low_stock`.

## Thiết kế dữ liệu

Thêm cột nullable vào bảng `products`:

```sql
low_stock_snoozed_until DATETIME
```

Giá trị `NULL` nghĩa là không snooze. Giá trị lớn hơn thời điểm hiện tại nghĩa là tạm bỏ qua cảnh báo low-stock cho sản phẩm đó.

## Thiết kế hành vi

### Gửi cảnh báo low-stock

`NotificationService.checkLowStock()` vẫn dùng `effectiveLowStockProducts()`, nhưng query sẽ loại các sản phẩm đang có `low_stock_snoozed_until > CURRENT_TIMESTAMP`.

Message low-stock sẽ có inline keyboard:

- Nếu có public `WEB_URL`: nút `📥 Thêm kho cho #ID` mở dashboard như hiện tại.
- Luôn có nút `✅ Đã up Stock` với callback data dạng `lowstock_done:<productId>`.

### Bấm `Đã up Stock`

Handler callback mới:

1. Đọc `productId` từ callback data.
2. Set `products.low_stock_snoozed_until = datetime('now', '+24 hours')`.
3. Xóa message hiện tại bằng `ctx.deleteMessage()` hoặc `bot.telegram.deleteMessage(chatId, messageId)`.
4. Gọi `ctx.answerCbQuery('Đã ẩn cảnh báo 24h')`.

Nếu sản phẩm không tồn tại, vẫn answer callback và thử xóa message để dọn channel.

Handler phải được register trước fallback `callback_query` trong `src/bot/index.js`.

## File ảnh hưởng

- `src/database/migrations/050_low_stock_snooze.js`
  - Thêm cột `products.low_stock_snoozed_until` nếu chưa có.

- `src/services/lowStockQuery.js`
  - Loại sản phẩm đang snooze khỏi `effectiveLowStockProducts()`.

- `src/services/notificationService.js`
  - Thêm nút callback `✅ Đã up Stock` vào keyboard low-stock.

- `src/bot/lowStockActions.js`
  - Handler callback `lowstock_done:<productId>`.

- `src/bot/index.js`
  - Register low-stock callback trước fallback.

- Tests
  - Query không trả product đang snooze.
  - Message low-stock có nút `Đã up Stock`.
  - Callback set snooze 24h và xóa message.

## Rủi ro và giảm thiểu

- Bất kỳ member có quyền thấy message trong channel/topic có thể bấm nút. Đây là chấp nhận được cho vận hành nội bộ; nếu cần giới hạn theo Telegram admin id sẽ làm ở task riêng.
- Telegram có thể không cho bot xóa message nếu bot thiếu quyền. Handler vẫn set snooze và answer callback; lỗi xóa message được log thay vì làm crash bot.
- Timestamp dùng SQLite `datetime('now', '+24 hours')`, nhất quán với các timestamp DB hiện đang dùng UTC.

## Tiêu chí hoàn thành

- Low-stock message có nút `✅ Đã up Stock`.
- Bấm nút xóa message và set snooze 24 giờ.
- Product đang snooze không được gửi cảnh báo low-stock.
- Sau khi snooze hết hạn, product đủ điều kiện có thể được cảnh báo lại.
- Tests liên quan pass.
