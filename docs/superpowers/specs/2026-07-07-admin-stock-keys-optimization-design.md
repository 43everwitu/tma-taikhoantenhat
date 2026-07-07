# Admin Stock Keys Optimization Design

## Bối cảnh

Trang `/admin/stock/keys` đang dùng bảng chung để xem toàn bộ key trong kho. Dữ liệu đã có `createdAt`, `soldAt`, `durationDays`, `soldTo`, nhưng UI hiện bị phình dòng vì key dài, thao tác copy gắn trực tiếp vào text key nên khó bôi đen chọn một phần, và single edit/delete đang bị backend chặn với key đã bán.

Key đã bán không có `order_id` trực tiếp trong bảng `stock`. Hệ thống hiện suy luận quan hệ order-key bằng `sold_to`, `product_id`, `variant_id`, `sold_at` và `orders.delivered_keys_json`.

## Quyết định đã chốt

- Chọn hướng B backend: thêm endpoint riêng cho all-keys, ví dụ `/admin/stock/items/:itemId`, thay vì nới endpoint cũ `/admin/stock/:productId/:itemId`.
- UI chọn mockup A: bảng compact, key có icon copy riêng, form sửa dạng drawer/modal.
- Sửa/xóa key đã bán chỉ tác động vào dòng `stock`. Không sửa `orders.delivered_keys_json`.
- Bulk sửa/xóa vẫn chỉ áp dụng cho key chưa bán.

## Mục tiêu

- Trang `/admin/stock/keys` hiển thị đủ thông tin thời gian thêm/bán, trạng thái, sản phẩm/biến thể, thời hạn, đơn bán và khách mua nếu có.
- Text key có thể bôi đen chọn một phần; copy toàn bộ key chuyển sang icon copy cạnh value.
- Single edit/delete dùng được cho cả key còn hàng và key đã bán.
- Single edit sửa được `content`, `productId`, `variantId`, `durationDays`.
- Key đã bán hiển thị thêm order id/payment code và thông tin khách mua khi suy luận được.
- Không thay đổi trải nghiệm trang kho theo sản phẩm ngoài việc cache được invalidate đúng.

## Ngoài phạm vi

- Không thêm migration `stock.order_id`.
- Không đồng bộ thay đổi stock ngược vào snapshot đơn đã giao.
- Không cho bulk sửa/xóa key đã bán.
- Không thay đổi flow giao key, nhắc gia hạn, hoặc customer order page.

## API

### `GET /admin/stock`

Mở rộng item response:

- `createdAt`
- `soldAt`
- `durationDays`
- `soldTo`
- `soldOrder`: `null` hoặc `{ id, paymentCode, status, deliveredAt }`
- `soldCustomer`: `null` hoặc `{ telegramId, username, fullName }`

Order match dùng subquery tương tự renewal backfill:

- `o.user_id = s.sold_to`
- `o.product_id = s.product_id`
- variant khớp hoặc cùng `NULL`
- `o.status = 'delivered'`
- `json_valid(o.delivered_keys_json) = 1`
- `json_each(o.delivered_keys_json)` chứa `s.data`

Nếu không match order, API vẫn trả `soldTo` và `soldAt`.

### `PATCH /admin/stock/items/:itemId`

Body:

```json
{
  "content": "email|pass",
  "productId": 123,
  "variantId": 456,
  "durationDays": 30
}
```

Quy tắc:

- `content` bắt buộc, trim và tối đa 2000 ký tự.
- `productId` bắt buộc và phải tồn tại.
- `variantId` optional nullable; nếu khác `null` phải thuộc `productId`.
- `durationDays` optional nullable, từ 1 đến 36500.
- Cho phép key đã bán.
- Ghi audit `stock.item_edit` với before/after cơ bản.
- Publish `stock.change` cho product cũ và product mới nếu khác nhau.
- Không cập nhật order snapshot.

### `DELETE /admin/stock/items/:itemId`

Quy tắc:

- Cho phép key đã bán.
- Ghi audit `stock.item_delete`, gồm `was_sold`, `sold_to`, `sold_at`, product/variant.
- Publish `stock.change` cho product của key.
- Không cập nhật order snapshot.

Endpoint cũ `/admin/stock/:productId/:itemId` giữ nguyên để trang kho theo sản phẩm không đổi behavior.

## UI

Trang `web/src/app/(admin)/admin/stock/keys/page.tsx`:

- Bảng compact với cột:
  - `ID`
  - `Key`
  - `Sản phẩm`
  - `Trạng thái`
  - `Thời gian`
  - `Đơn bán`
  - `Thao tác`
- Cột key:
  - Text monospace trong vùng selectable.
  - Icon copy riêng cạnh key.
  - Không copy khi click trực tiếp vào text.
- `Sửa` mở drawer/modal với:
  - textarea value
  - select sản phẩm
  - select biến thể phụ thuộc sản phẩm, có lựa chọn không biến thể
  - input thời hạn ngày, có nút xóa thời hạn
  - cảnh báo khi key đã bán: chỉ sửa stock, không sửa đơn đã giao
- `Xóa`:
  - key còn hàng dùng confirm ngắn
  - key đã bán dùng confirm rõ tác động: xóa khỏi kho, đơn đã giao vẫn giữ snapshot
- Bulk toolbar:
  - vẫn dùng `_bulk` hiện tại
  - `isRowSelectable` giữ `!row.sold`

## Kiểm thử

- API test cho `GET /admin/stock` trả thông tin sold order/customer khi key nằm trong `delivered_keys_json`.
- API test cho `PATCH /admin/stock/items/:itemId` sửa được key đã bán, đổi product/variant/duration, và không đổi `orders.delivered_keys_json`.
- API test cho `DELETE /admin/stock/items/:itemId` xóa được key đã bán và không đổi `orders.delivered_keys_json`.
- Build web để bắt lỗi type/UI.

## Rủi ro

- Suy luận order có thể không match nếu snapshot cũ bị thiếu hoặc key đã được sửa khác value cũ. UI phải hiển thị fallback `soldTo/soldAt`.
- Sửa product/variant của sold key có thể làm renewal/audit tương lai đọc theo stock mới. Đây là admin correction có chủ ý; order snapshot vẫn là nguồn lịch sử giao hàng.
