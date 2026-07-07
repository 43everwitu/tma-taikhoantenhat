# Admin Stock Keys Filter Columns Design

## Bối cảnh

Trang `/admin/stock/keys` hiện luôn render thông tin bán hàng trong bảng: `Bán lúc` và `Đơn bán`. Khi filter đang là `Còn hàng`, tất cả key đều chưa bán nên những phần này chỉ hiển thị dấu rỗng hoặc thông tin thừa, làm bảng rộng và khó scan.

## Mục tiêu

- Tối ưu bảng theo filter trạng thái hiện tại.
- Khi đang xem `Còn hàng`, chỉ hiển thị thông tin cần để quản lý tồn kho.
- Khi đang xem `Đã bán`, ưu tiên thông tin lịch sử bán và khách mua.
- Khi đang xem `Tất cả trạng thái`, giữ đủ ngữ cảnh nhưng gom cột để không làm bảng quá rộng.
- Không đổi API, không đổi behavior copy/sửa/xóa/modal edit.

## Thiết kế UI

### Filter `Còn hàng`

Render các cột:

- `ID`
- `Tài khoản`
- `Sản phẩm`
- `Thêm lúc`
- `Thao tác`

Không render `Bán lúc`, `Đơn bán`, hoặc pill `Còn hàng` lặp lại vì filter đã thể hiện trạng thái.

### Filter `Đã bán`

Render các cột:

- `ID`
- `Tài khoản`
- `Sản phẩm`
- `Bán lúc`
- `Đơn/khách`
- `Thao tác`

`Đơn/khách` dùng dữ liệu hiện có từ `soldOrder`, `soldCustomer`, `soldTo`. Nếu không khớp được đơn thì hiển thị `Chưa khớp đơn`, không để cột trống.

### Filter `Tất cả trạng thái`

Render các cột:

- `ID`
- `Tài khoản`
- `Sản phẩm`
- `Trạng thái`
- `Thời gian`
- `Giao dịch`
- `Thao tác`

`Thời gian` gom:

- `Thêm: <createdAt hoặc ->`
- Nếu đã bán: `Bán: <soldAt hoặc ->`

`Giao dịch`:

- Nếu đã bán: hiển thị order/customer như `Đã bán`.
- Nếu còn hàng: hiển thị `Còn hàng` để cột không rỗng.

## Mobile/Card View

`ResponsiveTable` dùng cùng `columns`, nên mobile card cũng sẽ tự ẩn các field thừa theo filter hiện tại. Không thêm component mobile riêng.

## Không thuộc scope

- Không đổi endpoint `/admin/stock`.
- Không đổi schema hoặc migration.
- Không đổi bulk selection: key đã bán vẫn không bulk-select.
- Không đổi modal edit, confirmation delete, hoặc copy behavior.

## Kiểm thử

- Build web để bắt TypeScript/Next errors.
- Smoke bằng source check nhẹ nếu cần: khi `status === 'unsold'`, columns không chứa `Đơn bán`/`Bán lúc`; khi `status === 'sold'` có cột `Đơn/khách`; khi `status === 'all'` có cột `Thời gian`/`Giao dịch`.
