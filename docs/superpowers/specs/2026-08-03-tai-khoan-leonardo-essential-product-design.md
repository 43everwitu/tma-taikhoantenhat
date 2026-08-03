# Thiết kế sản phẩm Tài khoản Leonardo Essential

## Mục tiêu

Tạo sản phẩm Leonardo Essential cấp sẵn, giao thủ công theo luồng đặt trước hiện có của cửa hàng. Sản phẩm cần có nội dung ngắn gọn trên card, hướng dẫn đăng nhập rõ ràng và ảnh đồng bộ với các cover sản phẩm gần đây.

## Dữ liệu sản phẩm

- Tên: `Tài khoản Leonardo Essential`
- Slug: `tai-khoan-leonardo-essential`
- Danh mục: `Tiện ích`
- Giá sản phẩm: `79.000đ`
- Trạng thái: `is_active=1`, `is_archived=0`
- Hình thức giao hàng: backorder, admin xử lý thủ công
- Không yêu cầu khách cung cấp thông tin khi đặt hàng

## Biến thể

Sản phẩm có một biến thể:

- Tên: `Leonardo Essential 8.500 Credit - 1 tháng`
- Giá: `79.000đ`
- Thời hạn: `30 ngày`
- Bảo hành: `3 ngày` theo chính sách của shop
- `is_backorder=1`
- `requires_input=0`
- Không tạo stock trong tác vụ này

## Nội dung

Mô tả ngắn chỉ nêu gói Essential, 8.500 credit, thời hạn một tháng, bảo hành ba ngày và hình thức tài khoản cấp sẵn. Không đưa định dạng tài khoản vào mô tả ngắn để card sản phẩm gọn.

Mô tả chi tiết gồm:

- Thông tin gói và thời hạn sử dụng.
- Tài khoản cấp sẵn.
- Giao thủ công theo luồng đặt trước.
- Đăng nhập qua Canva.
- Bảo hành ba ngày theo chính sách của shop.

Hướng dẫn đăng nhập phải ghi rõ:

- `Định dạng tài khoản: Mail|Pass`.
- Dùng email và mật khẩu được cấp để đăng nhập qua Canva.
- Liên hệ shop nếu không đăng nhập được trong thời gian bảo hành.

## Ảnh sản phẩm

- Dùng logo nguồn do người dùng cung cấp: `https://www.bworldonline.com/wp-content/uploads/2024/07/Leonardo-AI-logo.jpg`.
- Tạo ảnh WebP 900x900 tại `data/uploads/products-inline/tai-khoan-leonardo-essential-cover-v1.webp`.
- Nền gradient xanh tím lấy từ màu nhận diện của logo, có vùng tối bảo đảm tương phản.
- Tiêu đề lớn `Tài khoản Leonardo Essential` ở góc trên trái.
- Badge góc trên phải: `8.500 CREDIT`.
- Logo Leonardo AI thật, lớn, căn giữa trong app tile rộng.
- Dòng phụ: `Tài khoản cấp sẵn`.
- Footer: `79K | 1 tháng`.
- Watermark nhỏ: `taikhoantenhat.com`.

## Upsert và kiểm tra

- Upsert theo slug, không tạo sản phẩm trùng.
- Khi sản phẩm đã tồn tại, cập nhật nội dung và biến thể mục tiêu; ẩn các biến thể cũ không thuộc thiết kế này thay vì xóa.
- Không gửi thông báo Telegram hoặc broadcast khi tạo sản phẩm.
- Chạy purge test data dry-run trước và sau khi thay đổi dữ liệu.
- Xác nhận ảnh đúng 900x900 WebP.
- Xác nhận public shape có giá min/max `79.000đ`, `hasBackorder=true`, ảnh đúng phiên bản và danh mục `Tiện ích`.
- Không stage hoặc commit runtime DB và ảnh upload.
