# Thiết Kế Tìm Kiếm Sản Phẩm Thông Minh Trên TMA

**Ngày:** 2026-07-27

## Mục Tiêu

Mở rộng thanh tìm kiếm trên Telegram Mini App để khách có thể tìm sản phẩm bằng tên, tên biến thể, danh mục và nội dung sản phẩm. Kết quả phải ưu tiên khớp rõ ràng, hỗ trợ tiếng Việt không dấu, lỗi gõ nhẹ và một số từ gần nghĩa phù hợp với catalog mà không dùng dịch vụ AI bên ngoài.

## Phạm Vi

- Áp dụng cho `SearchBox` trên trang chủ, modal tìm kiếm, trang tất cả sản phẩm và trang danh mục.
- Tìm trong:
  - tên và slug sản phẩm;
  - tên, mô tả biến thể đang hoạt động;
  - tên danh mục;
  - mô tả ngắn, mô tả chi tiết và hướng dẫn sử dụng.
- Hiển thị riêng kết quả khớp mạnh và mục **Có thể bạn đang tìm**.
- Giữ nguyên API `GET /products` cho các truy vấn catalog không dùng smart search.
- Không thêm trường từ khóa trong admin, bảng search index, dependency tìm kiếm hoặc API bên ngoài.

## Kiến Trúc

Thêm `src/services/productSearchService.js` làm đơn vị độc lập chịu trách nhiệm:

1. chuyển HTML thành text thuần và decode các HTML entity thông dụng;
2. chuẩn hóa Unicode, chữ thường, khoảng trắng và tiếng Việt có dấu/không dấu;
3. mở rộng query bằng một danh sách nhóm từ đồng nghĩa nhỏ dùng chung;
4. chấm điểm từng tài liệu sản phẩm theo trường dữ liệu;
5. chia kết quả thành `results` và `suggestions`.

Thêm endpoint công khai:

```text
GET /api/v1/products/search
```

Query parameters:

- `q`: bắt buộc, từ 2 đến 100 ký tự sau khi trim;
- `category`: slug danh mục, tùy chọn;
- `priceMin`, `priceMax`: bộ lọc giá hiện tại, tùy chọn;
- `sort`: `default`, `price_asc`, `price_desc`, `newest`, `name_asc`, `name_desc`;
- `limit`: số kết quả chính, tối đa 100;
- `suggestionLimit`: số gợi ý, tối đa 20.

Response:

```json
{
  "success": true,
  "data": {
    "results": [],
    "suggestions": [],
    "total": 0
  }
}
```

Mỗi item sử dụng product summary DTO hiện tại và có thể có thêm `matchLabel` ngắn để giải thích khớp theo biến thể hoặc danh mục. API chỉ trả sản phẩm active và không archive. Biến thể inactive không tham gia tìm kiếm.

## Chuẩn Hóa Và Từ Đồng Nghĩa

Chuỗi tìm kiếm được:

- chuyển về chữ thường;
- chuẩn hóa Unicode NFD và bỏ dấu kết hợp;
- đổi `đ` thành `d`;
- thay ký tự phân cách bằng khoảng trắng;
- gộp khoảng trắng liên tiếp;
- giữ lại chữ, số và các token hữu ích như `3d`, `vpn`, `ai`, `api`.

Nhóm từ đồng nghĩa chỉ bao gồm khái niệm phổ biến, ổn định trong catalog, ví dụ:

- `đạo văn`, `dao van`, `plagiarism`;
- `mạng riêng ảo`, `mang rieng ao`, `vpn`;
- `học ngoại ngữ`, `học tiếng Anh`, `language learning`;
- `chỉnh ảnh`, `sửa ảnh`, `photo editor`;
- `lưu mật khẩu`, `quản lý mật khẩu`, `password manager`;
- `trí tuệ nhân tạo`, `ai`.

Mở rộng từ đồng nghĩa chỉ cộng điểm gợi ý thấp; nó không được vượt một sản phẩm khớp trực tiếp theo tên hoặc biến thể.

## Xếp Hạng

Thứ tự trọng số:

1. tên sản phẩm khớp chính xác hoặc chứa nguyên cụm từ;
2. token khớp trong tên sản phẩm;
3. tên biến thể;
4. slug và danh mục;
5. mô tả ngắn;
6. mô tả chi tiết và mô tả biến thể;
7. hướng dẫn sử dụng.

Điểm được tăng khi toàn bộ token query đều xuất hiện và giảm khi chỉ có một phần nhỏ token khớp. Kết quả có khớp trực tiếp đủ mạnh đi vào `results`.

Fuzzy matching chỉ chạy khi cần tạo gợi ý. Một token được coi là lỗi gõ nhẹ khi khoảng cách chỉnh sửa không quá:

- 1 ký tự với token dài 4-7 ký tự;
- 2 ký tự với token dài từ 8 ký tự;
- không fuzzy với token ngắn hơn 4 ký tự.

Sản phẩm chỉ khớp nhờ fuzzy hoặc từ đồng nghĩa đi vào `suggestions`. Một sản phẩm không xuất hiện đồng thời ở cả hai nhóm.

Khi `sort=default`, kết quả sắp theo điểm giảm dần, sau đó theo `sort_order` và `id`. Khi khách chọn kiểu sắp xếp khác, bộ kết quả mạnh được sắp theo lựa chọn đó; nhóm gợi ý vẫn theo độ gần.

## Giao Diện

`SearchBox` debounce 200 ms và chỉ gọi search khi query có ít nhất 2 ký tự.

Dropdown:

- trạng thái tải ổn định, không làm thay đổi kích thước ô nhập;
- tối đa 5 item trong mục **Kết quả**;
- tối đa 3 item trong mục **Có thể bạn đang tìm**;
- mỗi item có ảnh, tên, giá và `matchLabel` nếu có;
- có hành động **Xem tất cả kết quả** dẫn tới `/san-pham?q=<query>`;
- khi không có cả hai nhóm, hiển thị trạng thái không tìm thấy thay vì dropdown trống.

Trang `/san-pham` đọc `q` từ URL để liên kết xem tất cả hoạt động. Khi có query từ 2 ký tự, trang gọi smart search và hiển thị lưới kết quả mạnh trước, sau đó là một khu vực không lồng card cho **Có thể bạn đang tìm**.

Trang danh mục giữ filter danh mục cho kết quả chính. Gợi ý cũng tuân theo danh mục để tránh đưa sản phẩm ngoài ngữ cảnh khi khách đang duyệt một danh mục cụ thể.

## Xử Lý Lỗi Và Hiệu Năng

- Query thiếu hoặc ngắn hơn 2 ký tự trả `400 INVALID_SEARCH_QUERY`.
- Giá trị filter không hợp lệ được xử lý theo quy tắc hiện tại của `/products`.
- Nếu không có kết quả, API trả hai mảng rỗng và `total: 0`.
- Với khoảng 119 sản phẩm và 396 biến thể, service đọc tập ứng viên đã lọc từ SQLite và chấm điểm trong bộ nhớ cho từng request. Không cache lâu dài để sản phẩm vừa sửa có thể tìm thấy ngay.
- Nội dung sản phẩm chỉ dùng để chấm điểm; response vẫn là DTO gọn, không trả mô tả dài trong danh sách.

## Kiểm Thử

Backend unit tests phải chứng minh:

- tìm không dấu khớp tên có dấu;
- tên sản phẩm xếp trên khớp trong nội dung;
- tên biến thể có thể tìm ra sản phẩm cha;
- từ khóa chỉ có trong mô tả chi tiết hoặc hướng dẫn vẫn tìm được;
- lỗi gõ nhẹ và từ đồng nghĩa nằm trong `suggestions`;
- sản phẩm inactive/archive và biến thể inactive bị loại;
- không có sản phẩm trùng giữa hai nhóm.

API tests phải kiểm tra validation, filter danh mục/giá, giới hạn kết quả và response shape.

Frontend tests phải kiểm tra:

- `SearchBox` gọi endpoint mới;
- hai nhóm có tiêu đề đúng;
- URL **Xem tất cả kết quả** giữ nguyên query;
- trang `/san-pham` đọc query URL và hiển thị gợi ý;
- trạng thái tải, rỗng và lỗi không che hoặc làm lệch ô nhập.

Verification cuối:

```bash
node --test tests/services/productSearchService.test.js tests/api/public-product-search.test.js
node --test tests/web/smartProductSearch.test.mjs
cd web && npm run lint
cd web && npm run build
node scripts/purge-test-data.js
node scripts/purge-test-data.js --apply
```

Không gửi Telegram message trong quá trình kiểm thử.
