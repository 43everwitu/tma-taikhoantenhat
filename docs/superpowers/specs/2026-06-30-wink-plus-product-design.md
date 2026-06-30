# Thiết kế sản phẩm Tài khoản Wink+

Ngày: 2026-06-30

## Mục tiêu

Tạo sản phẩm `Tài khoản Wink+` trên Telegram Mini App theo pattern catalog hiện có: một product, một variant, ảnh vuông 900x900, đơn hàng giao thủ công vì hiện chưa có stock.

## Dữ liệu sản phẩm

Product:

- Tên: `Tài khoản Wink+`
- Slug dự kiến: `tai-khoan-wink-plus`
- Category: `Tiện ích`
- Giá base: `25000`
- Active: có
- Featured: có
- Notify on create: không

Variant:

| Tên biến thể | Giá | Duration | Fulfillment |
| --- | ---: | ---: | --- |
| Wink VIP+ 7 ngày - BHF 100 credits - 1 thiết bị | 25000 | 7 ngày | Backorder, admin giao thủ công |

Variant không yêu cầu khách nhập thông tin khi đặt hàng. Format `email|pass` chỉ xuất hiện trong hướng dẫn đăng nhập/tài khoản admin giao cho khách.

## Nội dung

Mô tả cần nêu rõ:

- Gói Wink VIP+ 7 ngày.
- BHF 100 credits.
- Login 1 thiết bị.
- Giá 25K/account.
- Tài khoản được giao thủ công sau thanh toán.

Hướng dẫn/lưu ý:

- Định dạng tài khoản khi nhận: `email|pass`.
- Nếu đăng nhập đúng tài khoản nhưng app báo Free, thường do thiết bị đã từng đăng ký trial hoặc bị đánh dấu.
- Cách xử lý: vào Cài đặt điện thoại, mục Ứng dụng, tìm app Wink, xoá bộ nhớ và xoá bộ nhớ đệm rồi đăng nhập lại.
- Chỉ sử dụng đúng 1 thiết bị.

## Ảnh sản phẩm

Tạo ảnh `/uploads/products-inline/wink-plus-cover-v1.webp`:

- Kích thước 900x900.
- Style giống sản phẩm TMA: nền gradient đậm, logo chính ở giữa, tiêu đề lớn, badge nhỏ.
- Logo lấy từ nguồn user cung cấp: `https://play-lh.googleusercontent.com/cYoIVsZ9QLGUIqIIFCcGlPhGd-KO4RROuht27Vr4sIFyFivrKVM19BjR-LmoTzKgImTArk1ZyDJzpDyHJE_Mxw=w416-h235-rw`
- Tiêu đề: `Tài khoản Wink+`
- Badge: `VIP+`
- Footer lớn: `7 ngày | 100 credits | 1 thiết bị`

## Verification

- Ảnh WebP tồn tại và đúng 900x900.
- Product public shape trả ảnh mới, category `Tiện ích`, price min/max `25000`.
- Product có đúng 1 variant, `is_backorder=1`, `requires_input=0`, `default_duration_days=7`.
- Không tạo stock row.
