# Thiết kế sản phẩm Tài khoản Miro Edu

Ngày: 2026-06-30

## Mục tiêu

Tạo một sản phẩm mới trên Telegram Mini App cho gói `Tài khoản Miro Edu`, bán theo 3 biến thể cấp riêng. Sản phẩm phải khớp pattern catalog hiện có: một product chính, nhiều variant, ảnh vuông 900x900 theo style các sản phẩm học tập/tiện ích đang có, và đơn hàng được admin giao thủ công.

## Phạm vi

Trong scope:

- Tạo product `Tài khoản Miro Edu` trong category `Học tập`.
- Bật `is_featured=1`, `is_active=1`.
- Tạo 3 biến thể backorder/cấp thủ công.
- Viết mô tả ngắn, long description, bảng so sánh Edu với các gói Miro phổ biến.
- Tạo ảnh sản phẩm mới dựa trên style ảnh TMA hiện có.

Ngoài scope:

- Không thay đổi schema hay flow checkout.
- Không gửi broadcast/thông báo sản phẩm mới khi tạo.
- Không tạo stock key tự động, vì sản phẩm được giao thủ công.
- Không thêm UI/admin feature mới.

## Dữ liệu sản phẩm

Product:

- Tên: `Tài khoản Miro Edu`
- Slug dự kiến: `tai-khoan-miro-edu`
- Category: `Học tập`
- Giá base: `149000`
- Active: có
- Featured: có
- Notify on create: không
- Contact only: không

Variants:

| Tên biến thể | Giá | Duration | Fulfillment |
| --- | ---: | ---: | --- |
| Miro Edu cấp riêng 12 tháng | 149000 | 365 ngày | Backorder, admin giao thủ công |
| Miro Edu cấp riêng 24 tháng | 249000 | 730 ngày | Backorder, admin giao thủ công |
| Miro Edu vĩnh viễn - bảo hành 3 năm | 349000 | 1095 ngày | Backorder, admin giao thủ công |

Tất cả biến thể:

- `is_backorder=1`
- `requires_input=0`
- Không tạo stock row.
- Không yêu cầu khách nhập email/password khi đặt.

## Nội dung sản phẩm

Mô tả ngắn cần truyền tải:

- Miro Edu là tài khoản Miro cấp riêng cho học tập, brainstorming, teamwork, workshop, mindmap, diagram.
- Có private boards, unlimited active boards, template, export chất lượng cao, voting/timer và các công cụ cộng tác phù hợp học nhóm.
- Giao thủ công sau thanh toán.

Long description gồm các phần:

1. Giới thiệu Miro Edu.
2. Các điểm nổi bật của gói Edu.
3. Ai nên dùng: sinh viên, giáo viên, nhóm học tập, nhóm làm dự án, workshop online.
4. Bảng so sánh Edu với Free, Starter, Business, Enterprise.
5. Lưu ý khi mua: tài khoản cấp riêng, bảo hành theo từng gói, gói vĩnh viễn được shop bảo hành 3 năm.

Không diễn giải “vĩnh viễn bảo hành 3 năm” là chính sách chính thức của Miro. Đây là chính sách bán hàng của shop.

## Bảng so sánh gói

Bảng trên trang sản phẩm sẽ tóm tắt theo hướng bán hàng, không cần bê nguyên bảng pricing chính thức.

| Tiêu chí | Free | Starter | Business | Enterprise | Education |
| --- | --- | --- | --- | --- | --- |
| Phù hợp | Dùng thử/cá nhân | Nhóm nhỏ | Team cần cộng tác nâng cao | Tổ chức lớn | Học tập, lớp học, dự án sinh viên |
| Editable boards | Giới hạn board đang edit | Không giới hạn | Không giới hạn | Không giới hạn | Không giới hạn active boards |
| Private boards | Không | Có | Có | Có | Có |
| Export chất lượng cao | Không/giới hạn | Có | Có | Có | Có |
| Timer/Voting | Cơ bản/giới hạn | Có | Có | Có | Có |
| Guest/visitor collaboration | Cơ bản | Public visitor editing | Guest editing nâng cao | Governance nâng cao | Viewer/commenter và visitor phù hợp lớp học |
| AI | Explore/giới hạn | Credit theo plan | AI Workflows nâng cao hơn | Quản trị/AI theo doanh nghiệp | AI Workflows giới hạn theo Education |
| Quản trị doanh nghiệp | Không | Cơ bản | SSO/multiple teams | Security/governance nâng cao | Một team Edu, giới hạn theo Education |

Nguồn tham chiếu khi viết nội dung:

- Miro Pricing: https://miro.com/pricing/
- Miro Education Plan: https://help.miro.com/hc/en-us/articles/360017730473-Education-plan
- Plans and features available: https://help.miro.com/hc/en-us/articles/360017730233-Plans-and-features-available
- Understanding Miro plans and pricing: https://help.miro.com/hc/en-us/articles/360014270500-Understanding-Miro-plans-and-pricing

## Ảnh sản phẩm

Ảnh cần giống style các ảnh sản phẩm TMA hiện có:

- Vuông 900x900.
- Nền gradient đậm, có chiều sâu.
- Tiêu đề trắng phía trên: `Tài khoản Miro Edu`.
- Logo/tile Miro lớn ở trung tâm.
- Badge nhỏ `EDU` ở góc gần tiêu đề.
- Footer nhỏ: `12M | 24M | Vĩnh viễn`.
- Có thể giữ watermark shop rất nhỏ nếu cần đồng bộ, nhưng footer chính ưu tiên nhãn biến thể.

Ảnh không dùng layout whiteboard mockup phức tạp. Ưu tiên đọc rõ trên card nhỏ trong grid TMA.

## Kiểm thử và xác nhận

Sau khi implement:

- Kiểm tra product/variant tồn tại trong `data/shop.db`, category đúng `Học tập`.
- Kiểm tra variant đều backorder và không require input.
- Kiểm tra product public API trả ảnh, mô tả, long description và variants.
- Kiểm tra ảnh file tồn tại trong upload path được product tham chiếu.
- Chạy dry-run rồi apply `scripts/purge-test-data.js` nếu phát hiện dữ liệu test thuộc danh sách bắt buộc.
- Không stage DB, backup DB, `.superpowers/`, upload tạm, hoặc file ảnh ngoài scope.
