# Admin Stock Keys Smart Filter Design

## Bối cảnh

Trang `/admin/stock/keys` đang dùng hai `<select>` nối tiếp:

- Chọn sản phẩm.
- Sau khi có sản phẩm, chọn biến thể.

Danh sách sản phẩm dài nên admin phải cuộn nhiều. Select sản phẩm cũng không thể tìm trực tiếp theo tên biến thể, tên không dấu, slug hoặc ID.

## Mục tiêu

- Cho phép gõ vài ký tự để tìm sản phẩm hoặc biến thể ngay tại filter sản phẩm.
- Cho phép chọn trực tiếp một sản phẩm hoặc một biến thể từ kết quả.
- Tìm kiếm không phân biệt hoa thường và dấu tiếng Việt.
- Ưu tiên kết quả khớp tên sản phẩm/biến thể hơn category, slug và ID.
- Giữ select biến thể hiện tại để admin vẫn có thể chọn theo luồng sản phẩm rồi biến thể.
- Không đổi contract filter của endpoint `/admin/stock`.

## Phương án

### Được chọn: combobox gộp sản phẩm và biến thể

Thay select sản phẩm bằng một combobox:

- Khi chưa gõ, hiển thị danh sách sản phẩm.
- Khi gõ, hiển thị cả sản phẩm và biến thể phù hợp.
- Chọn sản phẩm đặt `productId` và xóa `variantId`.
- Chọn biến thể đặt đồng thời `productId` và `variantId`.
- Chọn `Tất cả sản phẩm` xóa cả hai filter.

API `GET /admin/products` bổ sung `variantOptions: Array<{ id, name }>` để combobox chọn đúng ID biến thể, không suy luận theo tên và không tạo request N+1.

### Không chọn

- Hai combobox riêng: không tìm được biến thể trước khi chọn sản phẩm.
- HTML `datalist`: hỗ trợ bàn phím và hiển thị nhãn phụ không nhất quán, khó phân biệt sản phẩm với biến thể.

## Tìm kiếm và xếp hạng

Chuỗi tìm kiếm được chuẩn hóa:

- Lowercase.
- Unicode NFD và bỏ dấu kết hợp.
- Chuyển `đ` thành `d`.
- Chuẩn hóa ký tự phân cách thành khoảng trắng.
- Tách query thành token; mọi token phải xuất hiện trong nội dung option.

Thứ tự ưu tiên:

1. Khớp chính xác tên biến thể hoặc tên sản phẩm.
2. Tên bắt đầu bằng query.
3. Mọi token khớp đầu từ.
4. Tên chứa query.
5. Category, slug hoặc ID chứa query.

Kết quả cùng điểm giữ thứ tự sản phẩm/biến thể từ API. Khi query rỗng chỉ render option sản phẩm để danh sách không bị phình bởi toàn bộ biến thể.

## UI và tương tác

- Input giữ style `clay-input`, có icon tìm kiếm và chevron.
- Nhãn đang chọn:
  - Sản phẩm: `<Tên sản phẩm>`.
  - Biến thể: `<Tên sản phẩm> · <Tên biến thể>`.
- Kết quả phân biệt bằng badge `Sản phẩm` hoặc `Biến thể`.
- Dropdown giới hạn chiều cao và cuộn nội bộ.
- Có trạng thái tải và `Không tìm thấy sản phẩm hoặc biến thể`.
- Click ngoài hoặc `Escape` đóng dropdown.
- `ArrowUp`, `ArrowDown`, `Enter` hỗ trợ điều hướng bàn phím.
- Dùng ARIA combobox/listbox/option và giữ focus ở input.
- Khi đổi lựa chọn, reset trang về 1 và xóa bulk selection như filter cũ.

Grid filter tăng chiều rộng cột combobox để nhãn sản phẩm và biến thể không bị bó quá mức.

## Backend

Query tổng hợp sản phẩm bổ sung JSON các biến thể active:

```json
{
  "variantOptions": [
    { "id": "12", "name": "Pro 1 tháng" }
  ]
}
```

`variantNames` hiện tại vẫn được giữ để không ảnh hưởng các màn hình khác.

## Phân tách mã

- `src/api/routes/admin/products.js`: trả `variantOptions`.
- `web/src/lib/adminStockProductFilter.ts`: chuẩn hóa, tạo option và xếp hạng; không chứa React.
- `web/src/app/(admin)/admin/stock/keys/ProductVariantFilterCombobox.tsx`: UI combobox.
- `web/src/app/(admin)/admin/stock/keys/page.tsx`: nối combobox với state filter hiện có.

## Kiểm thử

- API test xác nhận `variantOptions` chứa đúng ID và tên biến thể active.
- Unit test xác nhận:
  - Tìm không dấu.
  - Tìm bằng một phần tên biến thể.
  - Kết quả tên được ưu tiên hơn category/slug.
  - Query rỗng chỉ trả option sản phẩm.
- Source/UI test xác nhận combobox có ARIA, keyboard handlers và được dùng thay select sản phẩm cũ.
- Chạy web lint và build.
- Smoke giao diện desktop/mobile, kiểm tra dropdown không tràn và filter request dùng đúng `productId`/`variantId`.

## Ngoài phạm vi

- Không đổi filter key/text hiện tại.
- Không thay combobox trong modal thêm key hoặc modal sửa key.
- Không thêm dependency UI mới.
- Không sửa dữ liệu sản phẩm, biến thể hoặc stock.
