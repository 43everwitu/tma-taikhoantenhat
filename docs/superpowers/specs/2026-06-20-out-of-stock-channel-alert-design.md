# Out-of-Stock Channel Alert

## Mục tiêu

Khi một bucket tồn kho đã gửi cảnh báo low-stock trong đợt hiện tại và sau đó giảm từ còn hàng xuống `0`, hệ thống phải gửi thêm một cảnh báo hết hàng vào channel quản lý.

Cảnh báo hết hàng:

- Không bị chặn bởi snooze 24 giờ của cảnh báo low-stock.
- Chỉ gửi một lần trong mỗi đợt hết hàng.
- Tính riêng theo sản phẩm hoặc từng biến thể.
- Không áp dụng cho biến thể backorder hoặc sản phẩm giao thủ công không dùng stock.
- Không gửi Telegram DM cho admin/khách và không tạo notification TMA.

## Phạm vi

Thay đổi chỉ áp dụng cho luồng kiểm tra tồn kho định kỳ:

- `src/services/lowStockQuery.js`
- `src/services/notificationService.js`
- `src/services/adminNotifyService.js` chỉ được dùng lại để route tới channel quản lý.
- `src/bot/lowStockActions.js`
- Migration và message template liên quan.
- Regression tests cho query, notification và callback.

Không thay đổi:

- Quy trình đặt hàng và giao key.
- Low-stock threshold.
- Cách tính stock khả dụng.
- Notification gửi cho khách.
- TMA.

## Đơn vị theo dõi

Tiếp tục dùng bucket hiện có:

- Sản phẩm không có biến thể stock: `p:<productId>`.
- Sản phẩm có biến thể stock: `v:<variantId>`.

Một biến thể hết hàng không làm các biến thể khác bị đánh dấu hết hàng.

Biến thể có `is_backorder = 1` không được đưa vào query low-stock hoặc out-of-stock vì đây là luồng admin giao thủ công.

## Trạng thái dữ liệu

Thêm cột vào `low_stock_alert_states`:

```sql
out_of_stock_alert_at DATETIME
```

Ý nghĩa:

- `last_alert_at IS NOT NULL`: bucket đã gửi low-stock trong episode hiện tại.
- `out_of_stock_alert_at IS NULL`: chưa gửi cảnh báo hết hàng trong episode hiện tại.
- `out_of_stock_alert_at IS NOT NULL`: đã gửi cảnh báo hết hàng, không gửi lặp.

Không dùng memory trong Node để state vẫn đúng sau restart/deploy.

## Điều kiện gửi

Bucket đủ điều kiện gửi cảnh báo hết hàng khi đồng thời thỏa:

1. Product và variant vẫn active.
2. Variant không phải backorder.
3. `stock_count = 0`.
4. `last_alert_at IS NOT NULL`.
5. `out_of_stock_alert_at IS NULL`.

Điều kiện `last_alert_at IS NOT NULL` bảo đảm:

- Chỉ cảnh báo bucket đã từng còn stock và đã đi qua trạng thái low-stock trong episode hiện tại.
- Không gửi hàng loạt cho các sản phẩm vốn đang bằng `0` khi deploy.
- Không áp dụng cho sản phẩm giao thủ công chưa từng dùng stock.

`snoozed_until` không được xét trong query out-of-stock. Nếu admin đã bấm `Đã up Stock` và snooze low-stock 24 giờ nhưng bucket giảm về `0`, cảnh báo hết hàng vẫn phải gửi ngay.

## Reset episode

Sau khi gửi cảnh báo hết hàng thành công:

```sql
out_of_stock_alert_at = CURRENT_TIMESTAMP
```

Khi stock tăng từ `0` lên `> 0`:

```sql
out_of_stock_alert_at = NULL
```

Giữ `last_alert_at` khi stock mới tăng nhưng vẫn nhỏ hơn hoặc bằng threshold. Điều này tránh gửi lại low-stock trong cùng episode.

Khi stock vượt threshold, recovery hiện có tiếp tục reset:

- `last_alert_at = NULL`
- `snoozed_until = NULL`
- `out_of_stock_alert_at = NULL`

Nếu stock tăng lại `> 0`, sau đó giảm về `0` trong khi vẫn thuộc episode low-stock, hệ thống được phép gửi một cảnh báo hết hàng mới.

## Nội dung cảnh báo

Thêm message template `admin.out_of_stock`, channel `admin`.

Nội dung mặc định:

```html
🔴 <b>Hết hàng</b>

{{productEmoji}} <b>{{productName}}</b>{{variantLine}}
🆔 ID: <code>{{productId}}</code>
📦 Còn lại: <b>0</b>{{stockUrlBlock}}
```

Variables:

- `productEmoji`
- `productName`
- `productId`
- `variantLine`
- `variantName`
- `variantId`
- `targetType`
- `targetKey`
- `stockUrlBlock`

Template có thể chỉnh trong `admin/messages` như các template admin khác.

## Kênh gửi

Cảnh báo dùng:

```js
adminNotifyService.notify('low_stock', body, options)
```

Việc dùng event type `low_stock` bảo đảm tin chỉ đi tới:

- `settings.low_stock_chat_id`
- `settings.low_stock_thread_id`

Không dùng `config.ADMIN_ID`, không broadcast người dùng và không ghi vào bảng `notifications`.

`adminNotifyService.notify()` được chuẩn hóa để trả về:

- `true` khi Telegram gửi thành công.
- `false` khi không có bot/target, event bị bỏ qua hoặc Telegram gửi lỗi.

Các caller hiện có không cần thay đổi nếu không dùng return value. Luồng out-of-stock chỉ set `out_of_stock_alert_at` khi `notify()` trả về `true`.

## Inline keyboard

Tin hết hàng giữ hai nút:

1. `📥 Thêm kho cho #<productId>`
   - Mở URL admin stock hiện có.
   - Nếu là variant, URL kèm `?variantId=<variantId>`.

2. `✅ Đã up Stock`
   - Callback data `outstock_done:p:<productId>` hoặc `outstock_done:v:<variantId>`.
   - Chỉ xóa message và answer callback.
   - Không set `snoozed_until`.
   - Không reset `out_of_stock_alert_at`; state chỉ reset khi stock thực tế tăng lại `> 0`.

Callback trả lời: `Đã xóa cảnh báo. Hệ thống sẽ tự nhận biết khi có stock mới.`

Nếu bot không có quyền xóa message, lỗi được log nhưng callback vẫn được answer.

## Luồng kiểm tra định kỳ

Mỗi lượt `checkLowStock()`:

1. Chạy recovery/reset state theo stock hiện tại.
2. Query bucket hết hàng đủ điều kiện.
3. Gửi cảnh báo hết hàng và đánh dấu `out_of_stock_alert_at`.
4. Query và gửi low-stock như hiện tại.

Out-of-stock được xử lý trước low-stock để state chuyển sang `0` được ưu tiên.

Nếu gửi Telegram lỗi, không set `out_of_stock_alert_at` để lượt kiểm tra sau có thể retry.

## Kiểm thử

### Query/state

- Bucket đã low-stock, sau đó stock bằng `0` được trả về.
- Bucket đang snooze vẫn được trả về khi stock bằng `0`.
- Bucket chưa từng có `last_alert_at` không được trả về.
- Bucket đã có `out_of_stock_alert_at` không được trả về.
- Backorder không được trả về.
- Chỉ variant hết hàng được trả về, variant khác không bị ảnh hưởng.
- Stock tăng lại `> 0` reset `out_of_stock_alert_at`.
- Stock vượt threshold reset toàn bộ episode.

### Notification

- Gửi đúng template `admin.out_of_stock`.
- Route qua event `low_stock` tới channel quản lý.
- Keyboard mở đúng product/variant.
- Gửi thành công mới set `out_of_stock_alert_at`.
- Không gửi lặp trong cùng episode.

### Callback

- Callback out-of-stock xóa message.
- Callback không set snooze 24 giờ.
- Lỗi xóa message không làm handler crash.

## Tiêu chí hoàn thành

- Low-stock đã báo rồi giảm về `0` luôn có cảnh báo hết hàng riêng.
- Snooze low-stock không chặn cảnh báo hết hàng.
- Cảnh báo chỉ gửi một lần cho mỗi lần chuyển sang hết hàng.
- Tính đúng theo variant.
- Backorder/giao thủ công không bị cảnh báo.
- Tin chỉ xuất hiện ở channel quản lý.
- Hai nút hoạt động đúng.
- Tests liên quan pass.
