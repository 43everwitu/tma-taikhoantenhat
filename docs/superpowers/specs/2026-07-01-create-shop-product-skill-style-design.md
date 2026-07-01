# Create Shop Product Skill Style Design

## Mục tiêu

Cập nhật skill `create-shop-product` để Codex tạo sản phẩm phù hợp hơn với style cửa hàng Taikhoantenhat:

- Ảnh sản phẩm dùng màu nhận diện của logo/thương hiệu làm nền gradient.
- Bố cục ảnh giữ cảm giác đồng bộ với các sản phẩm đang bán trên TMA.
- Nội dung sản phẩm được tạo theo template rõ ràng, dựa trên thông tin người dùng cung cấp.
- Chỉ tham khảo mẫu sản phẩm hiện có khi cần thêm ngữ cảnh, không bắt buộc đọc mẫu mỗi lần.

## Phạm vi

Thay đổi nằm trong skill local:

- `/home/peanut/.codex/skills/create-shop-product/SKILL.md`
- `/home/peanut/.codex/skills/create-shop-product/references/taikhoantenhat-product-workflow.md`

Không thay đổi runtime code, DB, sản phẩm, hoặc ảnh sản phẩm hiện có trong repo.

## Thiết kế ảnh sản phẩm

Skill sẽ yêu cầu Codex ưu tiên dùng logo/thương hiệu thật nếu người dùng cung cấp hoặc có nguồn đáng tin cậy. Khi có logo:

- Lấy 1-3 màu chính từ logo để tạo gradient background.
- Nếu logo chỉ có một màu, dùng màu đó làm màu chính và bổ sung một màu tối/trung tính để giữ độ tương phản.
- Nếu màu logo quá sáng hoặc khó đọc, dùng màu logo làm accent và thêm nền tối hơn.
- Không dùng nền gradient chung chung khi có thể suy ra màu thương hiệu.

Bố cục mặc định:

- Ảnh vuông 900x900 WebP.
- Tiêu đề lớn, dễ đọc trên mobile.
- Logo/app tile nổi bật ở giữa.
- Badge ngắn cho gói như `VIP+`, `EDU`, `PRO`, `12M`, `24M`.
- Footer lớn có tên ngắn hoặc biến thể quan trọng.
- Watermark nhỏ `taikhoantenhat.com`.

## Thiết kế nội dung sản phẩm

Skill sẽ hướng Codex tự tạo nội dung theo template tĩnh, dựa trên thông tin yêu cầu:

- Mô tả ngắn: tên gói, thời hạn, lợi ích chính, hình thức giao hàng.
- Mô tả dài: heading HTML, bullet tính năng, thông tin gói, lưu ý quan trọng.
- Hướng dẫn sử dụng: định dạng nhận hàng, bước đăng nhập/kích hoạt, xử lý lỗi thường gặp.

Khi thông tin đầu vào ít, sản phẩm mới lạ, hoặc category chưa rõ, Codex sẽ tham khảo một vài sản phẩm tương tự trong `data/shop.db` hoặc public catalog để học giọng văn, cấu trúc, và mức độ chi tiết. Đây là fallback theo nhu cầu, không phải bước bắt buộc cho mọi sản phẩm.

## Ràng buộc

- Không tự bịa chính sách vendor, bảo hành, hoặc cam kết không được người dùng cung cấp.
- Không nhầm định dạng tài khoản admin giao, ví dụ `email|pass`, với yêu cầu khách phải nhập thông tin.
- Vẫn dùng `data/shop.db` là nguồn runtime nếu cần đọc mẫu.
- Vẫn tạo asset versioned trong `data/uploads/products-inline/` khi tạo ảnh thật.
- Vẫn verify skill bằng `quick_validate.py` sau khi chỉnh.

## Kiểm thử

Sau khi cập nhật skill:

- Chạy validator skill:

```bash
python3 /home/peanut/.codex/skills/.system/skill-creator/scripts/quick_validate.py /home/peanut/.codex/skills/create-shop-product
```

- Đọc lại `SKILL.md` và reference để chắc chắn không có mâu thuẫn giữa rule ảnh, rule copy, và workflow tạo sản phẩm.
