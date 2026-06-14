# Stock Variant Announcement Image Design

## Mục tiêu

Chuẩn hóa thông báo “sản phẩm đã có hàng” để phản ánh đúng biến thể vừa được nhập kho, đồng thời cho phép thông báo trong `admin/announcements` có ảnh chỉ khi gửi qua Telegram bot.

## Phạm vi

- Khi admin add stock có chọn biến thể, thông báo stock phải dùng tên `Tên sản phẩm - Tên biến thể`, giá của biến thể, và tồn kho của đúng biến thể đó.
- Khi admin add stock không chọn biến thể, thông báo stock giữ logic cấp sản phẩm: tên sản phẩm, giá sản phẩm, và tồn kho legacy không gắn biến thể.
- `admin/announcements` có thêm ảnh Telegram bằng URL hoặc chọn từ Media Library hiện có.
- Ảnh announcement chỉ dùng cho Telegram bot. TMA/web notification vẫn chỉ nhận title/body text.

## Thiết kế thông báo stock

`POST /admin/stock/:productId` đã có `variantId` trong payload. Route sẽ truyền `variantId` này vào `notificationService.notifyStockReplenished(productId, variantId)`.

`notifyStockReplenished` sẽ:

- Query product theo `productId`.
- Nếu có `variantId`, query `product_variants` theo ID và product ID.
- Tạo biến template:
  - `productName`: nếu có variant thì `product.name - variant.name`, nếu không thì `product.name`.
  - `productPrice`: nếu có variant thì `variant.price`, fallback `product.price`; nếu không có variant thì `product.price`.
  - `stockCount`: nếu có variant thì đếm `stock` chưa bán của đúng `variant_id`; nếu không có variant thì đếm stock chưa bán với `variant_id IS NULL`.
- Render template `bot.stock_replenished` và `web.stock_replenished` với các biến trên.

Template mặc định của `bot.stock_replenished` sẽ có dạng:

```text
🔔 <b>{{productName}} đã có hàng!</b>
Giá: <b>{{productPrice}}</b>
Số lượng trong kho: <b>{{stockCount}}</b>
```

Template `web.stock_replenished` cũng nhận thêm `productPrice` để nội dung text đồng bộ, nhưng vẫn là notification text trong Mini App.

## Thiết kế ảnh announcement

DB thêm cột:

```sql
ALTER TABLE announcements ADD COLUMN image_url TEXT;
```

API admin announcements:

- `GET /admin/announcements` trả `imageUrl`.
- `POST /admin/announcements` nhận `imageUrl?: string | null`.
- `PATCH /admin/announcements/:id` cập nhật `imageUrl`.
- `POST /admin/announcements/:id/resend` gửi lại kèm `image_url` đã lưu.

Frontend `admin/announcements`:

- Form tạo và form sửa có field “Ảnh Telegram”.
- Admin có thể dán URL hoặc chọn từ `MediaLibrary`.
- Khi lưu/gửi, payload dùng `imageUrl`.
- Danh sách lịch sử hiển thị ảnh đã chọn ở mức metadata admin.

`notificationService.broadcast(title, body, target, adminId, webBody, options)` nhận thêm `options.imageUrl`.

- Nếu target là `telegram` hoặc `all` và có `imageUrl`, bot gửi bằng `sendPhoto(chatId, photoUrl, { caption: body, parse_mode: 'HTML' })`.
- Nếu không có ảnh, giữ `sendMessage`.
- Nếu `imageUrl` là path nội bộ `/uploads/...`, service chuyển thành URL public bằng `config.WEB_URL`.
- Web/TMA notification tiếp tục chỉ insert `title/body`, không lưu ảnh vào notification body.

## Lỗi và giới hạn

- Nếu gửi ảnh Telegram lỗi, lỗi được ghi vào `error_details` như lỗi gửi text hiện tại.
- Không thêm ảnh vào public `/announcements` hoặc Mini App announcement carousel.
- Không đổi policy target hiện có: `all`, `telegram`, `web` giữ nguyên.

## Kiểm thử

- Test stock notification có variant: bot message chứa `Product - Variant`, giá variant, và tồn kho variant.
- Test stock notification không variant: bot message chứa tên/giá sản phẩm và tồn kho legacy.
- Test announcement broadcast có ảnh: Telegram dùng `sendPhoto`, web notification vẫn lưu body text.
- Test announcement API shape nhận/trả `imageUrl`.
