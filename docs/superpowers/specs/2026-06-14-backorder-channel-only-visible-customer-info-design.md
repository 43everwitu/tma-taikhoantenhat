# Backorder Channel-Only Visible Customer Info Design

## Bối cảnh

Khi một đơn backorder được thanh toán thành công nhưng chưa có key để giao tự động, hệ thống hiện gửi thông báo theo hai hướng:

- Gửi `admin.backorder_paid` qua `adminNotifyService`.
- Gửi card xử lý thủ công vào order channel qua `orderChannelService`.

Card trong order channel đã chứa thông tin khách, nhưng formatter hiện mask các field nhạy cảm như password thành `••••••`. Điều này làm quản lý không đọc được dữ liệu cần thiết để xử lý đơn thủ công.

## Mục tiêu

- Đơn backorder chỉ thông báo xử lý thủ công vào order channel/topic.
- Không gửi thêm thông báo `backorder_paid` qua admin notify.
- Card order channel vẫn che block thông tin khách bằng Telegram spoiler để tránh lộ khi có người nhìn màn hình.
- Khi quản lý nhấn mở spoiler, tất cả giá trị field phải là text thật, bao gồm password.
- Không thay đổi tin nhắn gửi cho khách hàng khi đơn chờ xử lý thủ công.
- Không thay đổi cách spoiler key/license khi đơn được giao.

## Không làm

- Không xóa template `admin.backorder_paid` trong lần này, vì có thể còn dữ liệu cấu hình hoặc lịch sử admin phụ thuộc.
- Không đổi cấu trúc bảng orders.
- Không đổi logic giao hàng, kiểm tồn kho, hoặc trạng thái order.
- Không thêm UI mới trong admin.

## Thiết kế hành vi

### Backorder sau thanh toán tự động

Trong `PaymentPoller`, nhánh `result.success && result.backorder` sẽ:

1. Ghi nhận match như hiện tại.
2. Gửi tin nhắn chờ xử lý cho khách bằng `bot.backorder_wait` như hiện tại.
3. Gửi card vào order channel bằng `orderChannelService.postOrderCard`.
4. Không gọi `adminNotifyService.notify('backorder_paid', ...)`.

### Backorder khi xác nhận/giao thủ công qua service

Trong `orderFulfillmentService.deliverOrder`, nếu `orderService.confirmAndDeliver` trả về `backorder`, service sẽ:

1. Gửi card vào order channel bằng `orderChannelService.postOrderCard`.
2. Không gọi `adminNotifyService.notify('backorder_paid', ...)`.

### Hiển thị thông tin khách trong order channel

`orderChannelService` tiếp tục render customer input trong một block spoiler:

```html
📋 <b>Thông tin KH</b>:
<tg-spoiler>Email: user@example.com
Password: plaintext-password</tg-spoiler>
```

Khác biệt chính là formatter dùng cho order channel sẽ không mask password hoặc các field có tên giống password. Toàn bộ giá trị được escape HTML trước khi đưa vào Telegram HTML.

Formatter admin hiện tại `buildCustomerInputBlock` vẫn giữ nguyên hành vi mask secret, vì thay đổi này chỉ áp dụng cho channel xử lý nội bộ.

## File ảnh hưởng

- `src/utils/messages.js`
  - Thêm formatter riêng cho order channel, ví dụ `formatCustomerInputForChannel`.
  - Formatter này decrypt `order.input_value`, render label/value dạng text thường, escape HTML, không mask secret.

- `src/services/orderChannelService.js`
  - Dùng formatter mới.
  - Giữ `<tg-spoiler>` bao quanh block thông tin khách.
  - Không thay đổi spoiler của key/license.

- `src/services/paymentPoller.js`
  - Gỡ gọi `adminNotifyService.notify('backorder_paid', ...)` ở nhánh backorder.
  - Giữ customer wait message và order channel card.

- `src/services/orderFulfillmentService.js`
  - Gỡ gọi `adminNotifyService.notify('backorder_paid', ...)` ở nhánh backorder.
  - Giữ order channel card.

- Tests
  - Kiểm tra card channel có spoiler và chứa password thật.
  - Kiểm tra card channel không còn `••••••`.
  - Kiểm tra flow backorder không gọi admin notify.

## Kiểm thử

Các test trọng tâm:

- Unit test formatter/card order channel với `input_value` có email và password.
- Unit test/service test nhánh `orderFulfillmentService.deliverOrder` backorder không gọi `adminNotifyService.notify`.
- Regression scan hoặc test cho `PaymentPoller` để nhánh backorder không còn gọi `adminNotifyService.notify('backorder_paid', ...)`.

Lệnh verify dự kiến:

```bash
node --test --test-concurrency=1 tests/services/orderChannelBackorderCustomerInfo.test.js tests/services/orderFulfillmentBackorderChannelOnly.test.js
```

Nếu có thay đổi import/lint liên quan, chạy thêm test service hiện có cho backorder hoặc payment poller.

## Rủi ro và giảm thiểu

- Thông tin nhạy cảm vẫn tồn tại trong channel message sau khi mở spoiler. Đây là hành vi mong muốn cho quản lý xử lý đơn, nhưng chỉ nên dùng trong channel nội bộ.
- Telegram HTML cần escape đúng để tránh lỗi parse mode khi customer nhập ký tự `<`, `>`, `&`. Formatter mới phải escape toàn bộ label và value.
- Không xóa `admin.backorder_paid` để tránh ảnh hưởng cấu hình hoặc lịch sử template ngoài phạm vi.

## Tiêu chí hoàn thành

- Đơn backorder không còn phát sinh admin notify `backorder_paid`.
- Order channel vẫn nhận card xử lý thủ công.
- Block thông tin khách trong channel vẫn là spoiler.
- Password và các field khác hiển thị giá trị thật sau khi mở spoiler.
- Tests liên quan pass.
