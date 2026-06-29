# Brevo Email Template Design

## Mục tiêu

Tạo lại `taikhoantenhat_brevo_email_template.html` thành email marketing cho khách cũ, ưu tiên kéo người nhận mở Telegram bot `@taikhoantenhat_bot` để dùng hệ thống mua hàng mới của Taikhoantenhat Shop.

## Phạm vi

- Cập nhật một file HTML email tương thích Brevo.
- Dùng layout email 640px, table-based, CSS inline hoặc CSS trong `<style>` tối thiểu cho responsive.
- Upload ảnh marketing vào project để email dùng URL tuyệt đối từ domain public.
- Không thay đổi backend, frontend Next.js, database, logic bot, hoặc nội dung campaign ngoài template email.

## Nội dung chính

- Preheader: nhấn mua hàng nhanh trên Telegram, giao key tự động, ưu đãi 10% tối đa 100.000đ.
- Header: nhận diện `TAIKHOANTENHAT SHOP`, tông đen/vàng theo brand.
- Hero HTML:
  - Headline: `Hệ thống mua hàng mới`.
  - Thông điệp: mua hàng nhanh trên Telegram, nhận key tự động, áp dụng ưu đãi ngay.
  - Ưu đãi: `Giảm 10%`, tối đa `100.000đ`.
  - CTA chính: `Mở bot ngay`, link `https://t.me/taikhoantenhat_bot`.
- Ảnh minh họa:
  - Dùng hướng hybrid: chữ/CTA quan trọng là HTML, ảnh chỉ hỗ trợ thị giác.
  - Ảnh đặt bằng URL tuyệt đối dưới `https://tenhatshop.taikhoantenhat.me/uploads/email/...`.
- Lợi ích ngắn:
  - Mua trên Telegram.
  - Giao key tự động.
  - Bảo hành toàn thời hạn.
- Hướng dẫn 3 bước:
  - Mở bot và tìm sản phẩm.
  - Thanh toán QR hoặc chuyển khoản theo thông tin hiển thị.
  - Nhận thông tin đơn hàng.
- Footer:
  - Giữ biến Brevo `{{ mirror }}` và `{{ unsubscribe }}`.
  - Dòng lý do nhận mail cho khách đã từng mua hàng hoặc đăng ký nhận thông tin.

## Thiết kế giao diện

Email dùng phong cách hiện đại, đơn giản, phù hợp font Tiếng Việt trong email client. Nền tổng thể sáng để dễ đọc, các khối nhấn dùng đen/vàng. Không phụ thuộc ảnh để truyền tải CTA hoặc ưu đãi, vì nhiều email client có thể chặn ảnh mặc định.

Trên desktop, hero dùng bố cục hai cột: nội dung HTML bên trái và ảnh minh họa nhỏ bên phải. Trên mobile, các cột xếp dọc, CTA full-width, chữ không vượt khung.

## Asset

Ảnh nguồn người dùng cung cấp:

- `image.png`: banner hệ thống mua hàng mới.
- `telegram-cloud-photo-size-5-6134253230989447249-y.jpg`: banner mini app/khuyến mãi 6%.
- `telegram-cloud-photo-size-5-6138549976401908332-y.jpg`: hướng dẫn mua hàng.

Template dùng `image.png` làm ảnh minh họa chính trong hero sau khi copy/nén vào `data/uploads/email/taikhoantenhat-system-new.png`. Nội dung hướng dẫn mua hàng từ Image #3 được chuyển thành HTML trong block 3 bước, không nhúng nguyên ảnh hướng dẫn để tránh email quá nặng. HTML trỏ tới URL public `https://tenhatshop.taikhoantenhat.me/uploads/email/taikhoantenhat-system-new.png`.

## Tương thích Brevo

- Không dùng JavaScript.
- Không dùng CSS phức tạp cần browser hiện đại.
- Link CTA là link tuyệt đối.
- Ảnh có `alt`, `width`, style responsive.
- Giữ placeholder Brevo đúng cú pháp.

## Kiểm thử

- Mở file HTML local để kiểm tra bố cục desktop.
- Kiểm tra responsive bằng viewport mobile hoặc devtools.
- Kiểm tra file có CTA `https://t.me/taikhoantenhat_bot`.
- Kiểm tra ảnh dùng URL tuyệt đối `https://tenhatshop.taikhoantenhat.me/uploads/email/...`.
- Không stage runtime DB, backup DB, upload product hiện có, log, hoặc dữ liệu test.
