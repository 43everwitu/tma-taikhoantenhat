# Thiết Kế Thông Báo Gia Hạn TMA Chỉ Hiển Thị Một Lần

## Mục Tiêu

Card nhắc gia hạn trên trang chủ Telegram Mini App chỉ hiển thị cho đến khi khách tương tác một lần. Tương tác được tính khi khách bấm `Gia hạn ngay` hoặc `Xem đơn`. Khách không cần hoàn tất mua gia hạn thì lần sau card vẫn không hiện lại.

## Bối Cảnh Hiện Tại

- Reminder gia hạn đã được tạo trong bảng `notifications` với `type = 'renewal_reminder'`.
- Trang chủ TMA đã đọc `GET /notifications/my`, lọc reminder gia hạn và hiển thị CTA từ `data.renewUrl` / `data.orderUrl`.
- Bảng `notifications` đã có `is_read INTEGER DEFAULT 0`.
- Customer API đã có `PATCH /notifications/:id/read`, nhưng endpoint hiện chưa trả `data`, chưa khớp với contract của helper `apiFetch`.

## Hành Vi Sản Phẩm

Trang chủ TMA chỉ hiển thị reminder gia hạn chưa đọc:

- `type === 'renewal_reminder'`
- `is_read !== 1`

Khi khách bấm một trong hai CTA:

- đánh dấu notification đó là đã đọc
- xóa card khỏi cache local của trang chủ ngay lập tức
- điều hướng tới URL tương ứng

Không thêm nút `Ẩn`. Việc xem đơn được tính là đã ghi nhận reminder, kể cả khi khách quyết định không gia hạn.

## Thiết Kế Backend

Giữ model hiện có bằng `notifications.is_read`. Không thêm bảng suppression riêng.

Sửa `PATCH /notifications/:id/read` để:

- chỉ update row có `id = :id` và `user_id = req.customer.telegramId`
- trả `data: { id, isRead: true }` khi thành công
- không để lộ notification của user khác có tồn tại hay không

Việc này giúp endpoint tương thích với `apiFetch`, vì helper này kỳ vọng response thành công luôn có `data`.

## Thiết Kế Frontend

Trong `web/src/app/(miniapp)/page.tsx`:

- lọc card gia hạn chỉ còn item chưa đọc
- truyền handler `onAction` vào card
- khi bấm CTA, chặn hành vi mặc định của `Link`, gọi mark-read, optimistic remove notification khỏi query cache, rồi điều hướng bằng Next router

Nếu request mark-read lỗi:

- vẫn điều hướng tới trang người dùng muốn mở
- không hiện toast lỗi vì đây là thao tác ghi nhận nền
- card có thể hiện lại ở lần tải sau nếu backend chưa lưu được trạng thái đã đọc

## Luồng Dữ Liệu

1. Daily renewal sweep insert `notifications(type='renewal_reminder', is_read=0, data={ renewUrl, orderUrl, ... })`.
2. Trang chủ TMA fetch `/notifications/my`.
3. Trang chủ chỉ render reminder gia hạn chưa đọc.
4. Khách bấm `Gia hạn ngay` hoặc `Xem đơn`.
5. TMA gọi `PATCH /notifications/:id/read`.
6. TMA xóa card khỏi cache local và điều hướng tới trang đích.
7. Những lần gọi `/notifications/my` sau vẫn có thể trả row đó, nhưng trang chủ bỏ qua vì `is_read=1`.

## Không Làm

- Không thêm nút ẩn/dismiss riêng.
- Không tự động gia hạn.
- Không đổi Telegram DM reminder.
- Không đổi admin renewal logs.
- Không đổi thời điểm tạo renewal reminder.

## Kiểm Thử

Backend:

- `PATCH /notifications/:id/read` trả `data`.
- Route đánh dấu notification của đúng customer đang đăng nhập là đã đọc.
- Route không đánh dấu notification của customer khác.

Frontend:

- Card gia hạn loại bỏ item `is_read = 1`.
- Bấm CTA gọi mark-read và điều hướng đúng URL.
- Mark-read lỗi vẫn điều hướng tới URL đích.

Kiểm tra thủ công:

- Seed hoặc dùng một renewal notification chưa đọc.
- Mở trang chủ TMA và xác nhận card xuất hiện.
- Bấm `Xem đơn` hoặc `Gia hạn ngay`.
- Quay lại trang chủ và xác nhận cùng card đó không còn xuất hiện.
