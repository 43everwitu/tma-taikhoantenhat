# ElevenLabs Creators Product

## Mục tiêu

Thêm sản phẩm mới `Tài khoản ElevenLabs Creators` vào catalog TMA, hiển thị đồng bộ với các card sản phẩm hiện có và có một biến thể có thời hạn 30 ngày.

## Dữ liệu sản phẩm

- Tên: `Tài khoản ElevenLabs Creators`
- Slug: `tai-khoan-elevenlabs-creators`
- Danh mục: `Tiện ích`
- Giá mặc định: `279000`
- Trạng thái: active
- Emoji: `📦`
- Ảnh cover: dùng ảnh ElevenLabs đã duyệt, copy từ generated image vào thư mục upload của project.
- Tồn kho ban đầu: `0`
- Ngưỡng tồn kho thấp: dùng mặc định hệ thống.

## Biến thể

- Tên: `ElevenLabs Creator 1 tháng - acc cấp sẵn dùng riêng có 100k credit`
- Giá: `279000`
- `default_duration_days`: `30`
- `is_backorder`: `0`
- `requires_input`: `0`
- Hình thức giao: account/key cấp sẵn từ stock.

## Nội dung hiển thị

Mô tả ngắn cần nói rõ:

- Gói Creator dùng riêng trong 1 tháng.
- Có 100K credits.
- Phù hợp tạo voice AI, voiceover, audiobook, podcast, lồng tiếng video.

Hướng dẫn sử dụng ngắn:

- Đăng nhập bằng thông tin shop giao.
- Không đổi email/mật khẩu nếu chưa được hướng dẫn.
- Liên hệ hỗ trợ nếu gặp giới hạn đăng nhập hoặc cần kiểm tra credit.

## Tiêu chí hoàn tất

- Product và variant tồn tại trong DB runtime `data/shop.db`.
- Public API trả sản phẩm theo slug mới.
- Variant có `default_duration_days = 30`.
- Ảnh cover nằm trong workspace, không phụ thuộc vào thư mục generated image ngoài project.
- Không tạo stock test.
