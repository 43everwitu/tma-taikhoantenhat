# Backorder Night Wait Message Design

## Context

Trang chi tiết đơn hàng Mini App (`/don-hang/[id]`) đang hiển thị card `paid` riêng cho đơn backorder:

```text
Thanh toán đã được ghi nhận.
Shop sẽ xử lý đơn hàng và thông báo khi hoàn thành. Thời gian dự kiến: 30-60 phút, hoặc theo mô tả sản phẩm.
Cần hỗ trợ? Liên hệ @taikhoantenhat
```

Khung này áp dụng cho đơn đã thanh toán nhưng cần admin xử lý thủ công. Yêu cầu mới: ngoài giờ xử lý ban ngày, card phải báo rõ đơn sẽ được xử lý lúc 9:00 sáng.

## Goals

- Chỉ đổi nội dung card Mini App cho đơn backorder ở trạng thái `paid`.
- Giữ nguyên nội dung backorder hiện tại trong khung `09:00-22:30` GMT+7.
- Từ `22:31` đến `08:59` GMT+7, hiển thị:

```text
Đơn hàng sẽ được xử lý lúc 9:00 sáng.
Shop sẽ thông báo ngay khi đơn hoàn thành.
```

- Tính thời gian chính xác theo `Asia/Ho_Chi_Minh` / GMT+7, không phụ thuộc timezone hoặc locale của thiết bị khách.
- Không đổi flow giao key tự động của đơn thường không phải backorder.

## Non-Goals

- Không sửa Telegram bot template `bot.backorder_wait`.
- Không thêm setting admin cho giờ làm việc.
- Không đổi trạng thái đơn hàng, poller, hoặc flow manual-deliver.
- Không đổi UI card cho đơn thường không phải backorder.

## Time Rules

Backend là nguồn quyết định thời gian để tránh lệch do timezone thiết bị khách.

- `09:00` đến hết `22:30` GMT+7: `business_hours`.
- `22:31` đến hết `23:59` GMT+7: `after_hours`.
- `00:00` đến hết `08:59` GMT+7: `after_hours`.

Biên phải chính xác:

- `08:59` -> `after_hours`
- `09:00` -> `business_hours`
- `22:30` -> `business_hours`
- `22:31` -> `after_hours`

## Architecture

Backend `GET /customer/orders/:id/status` đã trả `isBackorder` cho frontend. Bổ sung một field nhỏ, ví dụ:

```json
{
  "isBackorder": true,
  "backorderWaitMode": "business_hours"
}
```

Field này chỉ cần có ý nghĩa khi `status === "paid"` và `isBackorder === true`. Giá trị:

- `business_hours`: frontend render nội dung backorder hiện tại.
- `after_hours`: frontend render nội dung xử lý lúc 9:00 sáng.

Backend tính giờ bằng `Intl.DateTimeFormat` với `timeZone: "Asia/Ho_Chi_Minh"`, lấy `hour` và `minute`, đổi sang tổng phút trong ngày:

- `businessStart = 9 * 60`
- `businessEnd = 22 * 60 + 30`
- business nếu `minutes >= businessStart && minutes <= businessEnd`
- after-hours cho các trường hợp còn lại

## Frontend Rendering

Trong `web/src/app/(miniapp)/don-hang/[id]/page.tsx`:

- Nếu `order.status === "paid"` và `order.isBackorder === true`:
  - `backorderWaitMode === "after_hours"` -> hiển thị mẫu đêm.
  - còn lại -> hiển thị nội dung backorder hiện tại.
- Nếu không phải backorder, giữ nguyên nội dung đơn thường hiện tại.

Mẫu ban ngày giữ nguyên:

```text
Thanh toán đã được ghi nhận.
Shop sẽ xử lý đơn hàng và thông báo khi hoàn thành. Thời gian dự kiến: 30-60 phút, hoặc theo mô tả sản phẩm.
Cần hỗ trợ? Liên hệ @taikhoantenhat
```

Mẫu ban đêm:

```text
Đơn hàng sẽ được xử lý lúc 9:00 sáng.
Shop sẽ thông báo ngay khi đơn hoàn thành.
```

## Error Handling

- Nếu `backorderWaitMode` vắng mặt hoặc không nhận diện được, frontend fallback về nội dung backorder hiện tại để tránh báo sai.
- Nếu backend không parse được giờ vì lỗi runtime hiếm gặp, trả `business_hours` như fallback an toàn.

## Testing

Backend:

- Test helper tính mode theo các mốc GMT+7:
  - `08:59` -> `after_hours`
  - `09:00` -> `business_hours`
  - `22:30` -> `business_hours`
  - `22:31` -> `after_hours`
- Test `GET /customer/orders/:id/status` trả `backorderWaitMode` cho đơn `paid` backorder.

Frontend:

- Kiểm tra render card backorder:
  - `business_hours` hiển thị nội dung hiện tại.
  - `after_hours` hiển thị nội dung xử lý lúc 9:00 sáng.
- Chạy `cd web && npm run lint`.

## Success Criteria

- Card Mini App backorder hiển thị đúng nội dung theo giờ GMT+7.
- Mốc biên `09:00`, `22:30`, `22:31`, `08:59` được test rõ.
- Đơn thường không phải backorder không đổi hành vi.
- Không sửa bot Telegram message trong phạm vi này.
