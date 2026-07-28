# Thiết Kế Khôi Phục Trạng Thái Đơn Hàng Đã Hủy

## Mục tiêu

Cho phép admin xử lý lại đơn có trạng thái `cancelled` tại `/admin/orders` theo
hai hướng:

- Đưa về `paid`, hiển thị là **Đang xử lý**.
- Giao thủ công và chỉ chuyển sang `delivered` sau khi admin nhập nội dung/key.

Đơn `#104079` là trường hợp tham chiếu: đã có `paid_at`, chưa có
`delivered_at` và chưa có `delivered_keys_json`.

## Quyết định

### Trạng thái

Không thêm status DB mới. `paid` tiếp tục là trạng thái nghiệp vụ cho đơn đã
thanh toán và đang chờ shop xử lý.

Chỉ cho phép chuyển trực tiếp:

- `cancelled → paid`

Không cho endpoint khôi phục đổi trực tiếp sang `delivered`. Nhánh **Đã giao**
phải đi qua giao thủ công để bảo đảm có dữ liệu giao hàng.

### Backend

Thêm phương thức service khôi phục đơn hủy về `paid` theo điều kiện nguyên tử
`WHERE status = 'cancelled'`. Giữ `paid_at` cũ nếu đã có; nếu trống thì điền
`CURRENT_TIMESTAMP`. Xóa `delivered_at` và `delivered_keys_json` để trạng thái
khôi phục không mang dữ liệu giao hàng cũ.

Thêm endpoint admin:

```http
POST /api/v1/admin/orders/:id/restore
Content-Type: application/json

{ "status": "paid" }
```

Endpoint yêu cầu quyền `orders.write`, trả `404` nếu không có đơn và `409` nếu
đơn không còn ở trạng thái `cancelled`. Mọi lần khôi phục thành công được ghi
audit `order.restore_status`.

Endpoint giao thủ công hiện có được mở rộng để nhận `cancelled`. Trước khi ghi
giao hàng, backend khôi phục nguyên tử sang `paid`; sau đó dùng luồng hiện có
để lưu snapshot key, tạo stock đã bán, ghi audit và gửi thông báo tới đúng
khách của đơn. Không gửi broadcast.

### Giao diện

Đơn `cancelled` có thêm nút **Khôi phục**. Nút mở hộp chọn:

- **Đang xử lý**: gọi endpoint restore và đưa đơn về `paid`.
- **Đã giao**: đóng hộp chọn và mở form **Giao thủ công** hiện có.
- **Bỏ qua**: đóng hộp chọn, không thay đổi dữ liệu.

Form giao thủ công tiếp tục yêu cầu ít nhất một dòng nội dung/key. Không có
thao tác đánh dấu `delivered` rỗng.

Trong admin, nhãn của `paid` được hiển thị là **Đang xử lý** để phản ánh đúng
vai trò trạng thái hiện có.

## Xử lý lỗi

- Đơn bị thay đổi bởi admin khác trước khi xác nhận: API trả `409`, UI hiển thị
  lỗi và refetch danh sách.
- Giao thủ công thiếu nội dung: validation hiện có trả `400`.
- Gửi Telegram lỗi sau khi đã lưu giao hàng: giữ hành vi hiện có, ghi lỗi
  server; không rollback trạng thái đã giao.

## Kiểm thử

- Service chỉ khôi phục `cancelled → paid`, giữ `paid_at` cũ và từ chối trạng
  thái khác.
- API restore trả đúng `200`, `404`, `409` và ghi audit.
- API giao thủ công chấp nhận đơn `cancelled`, lưu key và chuyển `delivered`.
- UI chỉ hiện nút khôi phục cho đơn hủy và nhánh **Đã giao** mở form giao thủ
  công.
- Chạy test tập trung, ESLint các file liên quan và Next.js production build.
