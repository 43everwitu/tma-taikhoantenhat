# Announcement Markdown Lite

## Mục tiêu

Cho phép admin nhập nội dung thông báo trong `admin/announcements` bằng Markdown nhẹ cho các đoạn khuyến mãi ngắn, đồng thời vẫn hiển thị đúng trên Telegram và Telegram Mini App.

Ví dụ input hợp lệ:

```text
🔥 6 tháng: **99K** ~~149K~~
🔥 12 tháng: **149K** ~~189K~~
🎁 Giảm thêm **6%** khi mua hàng tại **@taikhoantenhat_bot**
```

Nội dung sau khi lưu/gửi phải trở thành HTML an toàn:

```html
🔥 6 tháng: <b>99K</b> <s>149K</s>
🔥 12 tháng: <b>149K</b> <s>189K</s>
🎁 Giảm thêm <b>6%</b> khi mua hàng tại <b>@taikhoantenhat_bot</b>
```

## Phạm vi

Chỉ áp dụng cho `admin/announcements`.

Không áp dụng cho:

- `admin/messages`.
- Product description, variant description, usage instructions.
- Message template variables hoặc template rendering.

## Thiết kế backend

Thêm một helper nhỏ cho announcement body:

1. Nhận chuỗi admin nhập.
2. Convert Markdown nhẹ:
   - `**text**` thành `<b>text</b>`.
   - `~~text~~` thành `<s>text</s>`.
3. Chạy qua `sanitizeRich()` để giữ HTML được phép và loại bỏ tag không an toàn.
4. Lưu body HTML an toàn vào bảng `announcements`.

Các endpoint cần dùng cùng helper:

- `POST /admin/announcements`
- `PATCH /admin/announcements/:id` khi cập nhật `body`

`POST /admin/announcements/:id/resend` không convert lại Markdown vì body cũ đã được lưu ở dạng HTML an toàn.

`notificationService.broadcast()` vẫn nhận body HTML an toàn. Khi gửi Telegram, service chuyển body qua `toTelegramHtml()` để auto-link URL và đổi `<br>` thành newline Telegram hiểu được. Web notification và DB vẫn giữ HTML an toàn cho TMA render.

## HTML được hỗ trợ

Announcement dùng cùng rich HTML allow-list hẹp đã có cho Telegram/TMA:

- `<b>`, `<strong>`
- `<i>`, `<em>`
- `<u>`
- `<s>`
- `<a href="...">`
- `<code>`, `<pre>`
- `<br>`
- `<tg-spoiler>`

Nếu admin nhập HTML hợp lệ trực tiếp, HTML đó vẫn được giữ sau sanitize. Nếu admin nhập tag ngoài allow-list, tag bị loại bỏ như hiện tại.

## Telegram và TMA

Telegram vẫn gửi với `parse_mode: 'HTML'`. Body đã lưu phải tương thích với Telegram HTML.

TMA vẫn render announcement qua `RichText`, dùng sanitizer client-side hiện có. Vì body đã là HTML an toàn nên `<b>` và `<s>` render đúng trên web.

Luồng public announcement hiện strip emoji và URL cho rail compact. Thay đổi này không sửa behavior đó.

## Lỗi và an toàn

- Không thêm parser Markdown đầy đủ để tránh hỗ trợ ngoài ý muốn.
- Không hỗ trợ nested Markdown phức tạp.
- Không cho phép raw script/style/event handler vì sanitizer chung vẫn là lớp bảo vệ cuối.
- Nếu pattern Markdown không đóng đủ cặp, giữ nguyên text sau sanitize.

## Kiểm thử

Thêm hoặc mở rộng test cho announcement:

- `POST /admin/announcements` convert `**99K**` thành `<b>99K</b>`.
- `POST /admin/announcements` convert `~~149K~~` thành `<s>149K</s>`.
- HTML `<s>` nhập trực tiếp không bị strip.
- Telegram broadcast nhận body HTML đã normalize.

## Tiêu chí hoàn thành

- Admin nhập nội dung Markdown nhẹ trong `admin/announcements` và DB lưu HTML an toàn.
- Telegram hiển thị bold/gạch ngang đúng.
- TMA hiển thị bold/gạch ngang đúng với body đã lưu.
- Không thay đổi behavior của `admin/messages`.
- Test liên quan announcement pass.
