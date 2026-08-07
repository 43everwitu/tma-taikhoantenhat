# Thiết kế sản phẩm Nâng cấp Locket Gold chính chủ

## Mục tiêu

Tạo sản phẩm nâng cấp Locket Gold chính chủ dành riêng cho iOS. Khách chỉ cung cấp link hồ sơ Locket, shop xử lý thủ công và không yêu cầu email, mật khẩu hoặc tài khoản iCloud.

## Dữ liệu sản phẩm

- Tên: `Nâng cấp Locket Gold chính chủ`
- Slug: `nang-cap-locket-gold-chinh-chu`
- Danh mục: `Giải trí`
- Giá sản phẩm: `179.000đ`
- Trạng thái: `is_active=1`, `is_archived=0`
- Hình thức giao hàng: backorder, admin xử lý thủ công
- Nền tảng hỗ trợ: chỉ iOS
- Khách phải cung cấp link hồ sơ dạng `locket.cam/username`

## Biến thể

Sản phẩm có một biến thể:

- Tên: `Nâng cấp Locket Gold 12 tháng - iOS`
- Giá: `179.000đ`
- Thời hạn: `365 ngày`
- Bảo hành: `12 tháng` theo chính sách của shop
- `is_backorder=1`
- `requires_input=1`
- Trường nhập: link Locket, kiểu text, bắt buộc
- Không tạo stock trong tác vụ này

## Nội dung

Mô tả ngắn nêu rõ đây là dịch vụ nâng cấp Locket Gold 12 tháng cho iOS, xử lý trên tài khoản của khách và chỉ cần link hồ sơ Locket.

Mô tả chi tiết gồm:

- Hỗ trợ Locket trên iOS.
- Không cần email, mật khẩu hoặc iCloud.
- Không cần app/web bên thứ ba hoặc DNS.
- Xóa app, đăng xuất hoặc đổi thiết bị vẫn giữ Gold theo thông tin người bán cung cấp.
- Kích hoạt thủ công và bảo hành 12 tháng theo chính sách shop.
- Cảnh báo khách phải sao chép đúng link hồ sơ từ ứng dụng Locket.

Hướng dẫn sử dụng phải ghi rõ:

- Mở ứng dụng Locket và sao chép link hồ sơ.
- Nhập đúng định dạng `locket.cam/username`, ví dụ `locket.cam/ngoanxinhyeu`.
- Không gửi email, mật khẩu hoặc thông tin iCloud.
- Chờ shop xử lý thủ công sau khi thanh toán.

## Ảnh sản phẩm

- Dùng ảnh nguồn do người dùng cung cấp: `https://cdn11.dienmaycholon.vn/filewebdmclnew/public/userupload/files/Knms/dien-thoai-di-dong/nguoi-dung-can-nang-cap-locket-gold-de-quay-video-dai-hon-15-giay.jpg`.
- Tạo ảnh WebP 900x900 tại `data/uploads/products-inline/nang-cap-locket-gold-chinh-chu-cover-v1.webp`.
- Nền gradient vàng đậm đến vàng sáng theo nhận diện Locket Gold, có vùng tối bảo đảm tương phản.
- Tiêu đề lớn `Nâng cấp Locket Gold` ở góc trên trái.
- Badge góc trên phải: `iOS`.
- Hình Locket Gold thật, lớn, căn giữa trong app tile rộng và không bị crop.
- Dòng phụ: `Nâng cấp chính chủ`.
- Footer: `179K | 12 tháng`.
- Watermark nhỏ: `taikhoantenhat.com`.

## Upsert và kiểm tra

- Upsert theo slug, không tạo sản phẩm trùng.
- Khi sản phẩm đã tồn tại, cập nhật nội dung và biến thể mục tiêu; ẩn các biến thể cũ không thuộc thiết kế này thay vì xóa.
- Không gửi thông báo Telegram hoặc broadcast khi tạo sản phẩm.
- Chạy purge test data dry-run trước và sau khi thay đổi dữ liệu.
- Xác nhận ảnh đúng 900x900 WebP.
- Xác nhận public shape có giá min/max `179.000đ`, `hasBackorder=true`, ảnh đúng phiên bản và danh mục `Giải trí`.
- Không stage hoặc commit runtime DB và ảnh upload.
