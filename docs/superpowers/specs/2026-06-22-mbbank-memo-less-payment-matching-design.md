# Đối chiếu giao dịch MBBank không có mã đơn

## Bối cảnh

`PaymentPoller` hiện chỉ yêu cầu các giao dịch có nội dung chứa `PNS`. Cách lọc này bỏ qua thanh toán qua cổng trung gian hoặc chuyển đổi ngoại tệ nếu ngân hàng chỉ ghi tên đơn vị thanh toán.

Đơn `100908` là trường hợp đại diện:

- Giá trị đơn: `431.460đ`.
- Giao dịch nhận được: `432.000đ`.
- Độ lệch: `+540đ`.
- Nội dung: `9PAY JSC. TaptapSendVNpayment`.
- Giao dịch không chứa `PNS100908`.

Mục tiêu là tự xác nhận một giao dịch không mã khi hệ thống chỉ tìm thấy một đơn hợp lý. Hệ thống phải chuyển trường hợp thiếu tiền hoặc có nhiều ứng viên cho admin, không tự chọn theo phỏng đoán.

## Quyết định nghiệp vụ

- Áp dụng cho mọi giao dịch tiền vào không chứa mã `PNS`, không giới hạn theo tên cổng thanh toán.
- Dùng cả số tiền và thời điểm giao dịch để tìm đơn.
- Khoảng tiền dùng để tìm ứng viên là `±10.000đ`.
- Chỉ tự xác nhận nếu số tiền nhận bằng hoặc cao hơn giá đơn, tối đa cao hơn `10.000đ`.
- Giao dịch thiếu tiền không được tự xác nhận, kể cả chỉ thiếu `1đ`.
- Chỉ tự xác nhận khi toàn bộ khoảng `±10.000đ` có đúng một đơn ứng viên.
- Nếu có từ hai ứng viên trở lên, hệ thống lưu giao dịch ở trạng thái chờ duyệt và báo admin.
- Cửa sổ thời gian của một đơn bắt đầu tại `created_at` và kết thúc sau `expires_at` 24 giờ.
- Nhánh có mã `PNS` tiếp tục được ưu tiên và giữ policy hiện tại.

## Phạm vi

Thay đổi gồm:

- Chuẩn hóa timestamp giao dịch trong `mbbank-api`.
- Mở rộng request của `PaymentPoller` để lấy cả giao dịch không có `PNS`.
- Thêm matcher theo số tiền và thời gian.
- Lưu timestamp, lý do match và danh sách ứng viên để audit.
- Báo admin khi giao dịch cần duyệt.
- Thêm tests cho timezone, matcher, idempotency và regression của nhánh `PNS`.

Không thay đổi:

- Chính sách giao key, backorder và hết stock.
- Chính sách topup.
- Cửa sổ late-payment recovery 24 giờ.
- Cách xử lý giao dịch có mã `PNS`.
- Cách admin xác nhận hoặc giao đơn thủ công hiện có.
- Không tự cộng phần tiền dư vào ví.

## Kiến trúc

### `mbbank-api`

Sidecar tiếp tục chịu trách nhiệm lấy và chuẩn hóa dữ liệu ngân hàng. Sidecar không tìm hoặc cập nhật đơn hàng.

Mỗi credit transaction trả thêm:

```json
{
  "transactionNumber": "FT26173165960097",
  "amount": 432000,
  "description": "9PAY JSC. TaptapSendVNpayment",
  "type": "IN",
  "transactionTime": "2026-06-21T21:30:12Z",
  "transactionDateRaw": "22/06/2026 04:30:12",
  "postingDateRaw": "22/06/2026 04:30:14"
}
```

`mbbank-lib` cung cấp `transactionDate` và `postingDate` dưới dạng chuỗi. Sidecar:

1. Ưu tiên `transactionDate`.
2. Dùng `postingDate` nếu `transactionDate` trống.
3. Nếu chuỗi không có UTC offset, coi chuỗi đó là giờ ngân hàng Việt Nam, `Asia/Ho_Chi_Minh`.
4. Chuyển instant sang ISO 8601 UTC và trả qua `transactionTime`.
5. Giữ hai giá trị raw để chẩn đoán.
6. Trả `transactionTime: null` nếu không parse được. Sidecar không tự dùng thời điểm request làm timestamp thay thế.

Parser chấp nhận:

- `dd/MM/yyyy HH:mm:ss`
- `dd/MM/yyyy HH:mm`
- ISO 8601 có UTC offset hoặc hậu tố `Z`

Chuỗi chỉ có ngày, không có giờ, không đủ điều kiện auto-match và phải tạo `transactionTime: null`. Tests dùng fixture cho từng định dạng trên và không phụ thuộc timezone của máy chạy.

### `PaymentPoller`

Poller xử lý theo thứ tự:

1. Giao dịch đã `matched` hoặc `review` được bỏ qua.
2. Nếu nội dung có mã `PNS`, chạy matcher hiện tại.
3. Nếu không có mã `PNS`, chạy matcher số tiền và thời gian.
4. Nếu matcher trả `unique`, dùng lại flow `_processOrderMatch()`.
5. Nếu matcher trả `review`, lưu lý do và báo admin.
6. Nếu matcher trả `none`, lưu `unmatched` để poller có thể xét lại ở lượt sau.

Matcher số tiền và thời gian là một hàm riêng, không gọi API, không ghi DB và không gửi Telegram. Hàm nhận transaction cùng danh sách order rồi trả kết quả xác định. Ranh giới này cho phép test đầy đủ mà không cần mock toàn bộ poller.

## Chuẩn thời gian

### Nguyên tắc

- MBBank query theo ngày lịch Việt Nam.
- `transactionTime` truyền giữa sidecar và Node dưới dạng ISO 8601 UTC.
- SQLite `CURRENT_TIMESTAMP`, `datetime('now')`, `orders.created_at` và `orders.expires_at` tiếp tục lưu UTC.
- Node phải parse timestamp SQLite bằng cách gắn UTC rõ ràng. Không dùng parser phụ thuộc timezone process.
- Chỉ chuyển instant sang `Asia/Ho_Chi_Minh` khi tính `from_date`, `to_date` cho MBBank hoặc hiển thị.
- Không dùng `toISOString().slice(0, 10)` để tính ngày ngân hàng.

### Khoảng ngày truy vấn

Poller không còn gửi `description_contains: "PNS"`.

`from_date` là ngày Việt Nam của `created_at` sớm nhất trong các order/topup đang cần đối chiếu. `to_date` là ngày hiện tại tại `Asia/Ho_Chi_Minh`. Với recovery 24 giờ, request thường bao phủ một hoặc hai ngày lịch.

`min_amount` bằng giá trị nhỏ nhất cần xét trừ `10.000đ`, chặn dưới tại `0`. Cách tính này giữ được giao dịch thiếu tiền cần admin duyệt.

Poller không đặt `limit` thấp làm mất giao dịch trong khoảng ngày. Sidecar trả toàn bộ credit transaction thỏa `min_amount`; idempotency dựa trên `transactionNumber`.

Validation `from_date` và `to_date` trong sidecar so sánh với ngày hiện tại tại `Asia/Ho_Chi_Minh`, không dùng `datetime.now()` naive. Điều này tránh từ chối ngày Việt Nam mới trong khoảng `00:00-06:59` khi host chạy UTC.

## Thuật toán tìm ứng viên

Matcher chỉ xét order thỏa tất cả điều kiện:

- `deleted_at IS NULL`.
- `payment_method = "bank"`.
- Status là `pending`, hoặc `expired` và còn trong recovery 24 giờ.
- Có `created_at` và `expires_at` parse được.
- `order.created_at <= transactionTime`.
- `transactionTime <= order.expires_at + 24 giờ`.
- `abs(transaction.amount - order.total_price) <= 10.000`.

Gọi tập trên là `reviewCandidates`.

Kết quả:

1. `reviewCandidates.length === 0`
   - Trả `none`.
   - Poller lưu `unmatched`.

2. `reviewCandidates.length > 1`
   - Trả `review` với reason `ambiguous`.
   - Không tự chọn theo độ lệch tiền hoặc thời gian.

3. Có đúng một ứng viên nhưng `transaction.amount < order.total_price`
   - Trả `review` với reason `short_payment`.

4. Có đúng một ứng viên và:

   ```text
   order.total_price <= transaction.amount <= order.total_price + 10.000
   ```

   - Trả `unique`.
   - Poller chạy flow xác nhận và giao hàng hiện có.

5. Giao dịch không có `transactionTime` hợp lệ
   - Trả `review` với reason `missing_transaction_time`.
   - Không dùng `detected_at` để auto-match.

Việc đếm ứng viên dùng toàn bộ khoảng `±10.000đ`. Ví dụ một giao dịch trả đủ cho đơn A nhưng đồng thời chỉ thiếu dưới `10.000đ` so với đơn B vẫn là `ambiguous`.

## Trạng thái và audit

Migration bổ sung vào `transactions`:

```sql
bank_transaction_at DATETIME;
match_reason TEXT;
candidate_order_ids_json TEXT;
```

`bank_transaction_at` lưu UTC theo định dạng SQLite `YYYY-MM-DD HH:mm:ss`.

Các `match_status` dùng cho feature:

- `matched`: transaction đã gắn với order và đã đi qua flow thanh toán.
- `review`: cần admin quyết định; poller không tự xét lại.
- `unmatched`: chưa có ứng viên; poller được phép xét lại.

`match_reason` dùng các giá trị:

- `payment_code`
- `amount_time_unique`
- `ambiguous`
- `short_payment`
- `missing_transaction_time`
- `no_candidate`

`candidate_order_ids_json` lưu mảng ID tại thời điểm matcher quyết định. Poller không dựa vào mảng này để auto-match ở lượt sau.

Giao dịch `review` là trạng thái terminal đối với auto-matcher. Việc một ứng viên hết hạn hoặc được xử lý sau đó không làm poller tự chọn ứng viên còn lại.

## Xử lý giao dịch unique

Trước khi xác nhận, poller đọc lại order từ DB và kiểm tra status vẫn là `pending` hoặc `expired` còn recoverable. Nếu status đã đổi, poller chạy matcher lại đúng một lần trên snapshot order mới:

- Kết quả `unique`: xử lý ứng viên mới.
- Kết quả `review`: lưu `review` cùng reason do matcher trả về.
- Kết quả `none`: lưu `unmatched/no_candidate`.

Poller gọi flow `_processOrderMatch()` hiện có với:

- Order đã chọn.
- `matched_payment_code` là payment code của order để giữ liên kết audit.
- `match_reason = "amount_time_unique"`.

Flow hiện có tiếp tục xử lý:

- Recovery order expired.
- Đánh dấu payment timestamp.
- Giao stock tự động.
- Backorder.
- Hết stock.
- Notification cho khách và admin.
- Ghi nhận tiền dư nhưng không cộng ví.

## Admin review

Khi transaction chuyển sang `review`, admin nhận thông báo gồm:

- Mã giao dịch ngân hàng.
- Timestamp theo giờ Việt Nam.
- Số tiền nhận.
- Nội dung giao dịch.
- Lý do cần duyệt.
- Danh sách candidate order với giá đơn, độ lệch tiền, thời điểm tạo và trạng thái.

Admin dùng thao tác xác nhận/giao thủ công hiện có trên trang đơn hàng. Feature này không thêm một cơ chế tự chọn thay admin.

Thông báo lỗi không được gửi lặp ở mỗi poll vì transaction `review` bị loại khỏi các lượt auto-match tiếp theo.

## Idempotency và cạnh tranh trạng thái

- `mb_transaction_number` tiếp tục là unique key.
- `matched` và `review` không được xử lý lại.
- `unmatched` được xét lại để giữ behavior chống race hiện có.
- Poller chỉ ghi `matched` sau khi đã claim được order còn hợp lệ.
- Nếu admin hoặc request khác xử lý order giữa lúc match và lúc confirm, poller chạy lại matcher đúng một lần theo quy tắc ở phần xử lý `unique`.
- Một transaction không được gắn với nhiều order.
- Một order rời trạng thái `pending`/`expired` sẽ không còn là ứng viên cho transaction khác.

## Error handling

- MBBank API lỗi: giữ retry hiện tại, không đổi trạng thái transaction.
- Timestamp parse lỗi: sidecar trả raw fields và `transactionTime: null`; Node chuyển transaction sang `review`.
- Dữ liệu amount không hợp lệ: sidecar bỏ transaction như behavior credit hiện tại.
- Ghi DB lỗi: không gọi delivery.
- Notification admin lỗi: transaction vẫn ở `review`; log phải chứa transaction number để vận hành tra cứu.
- Delivery lỗi sau khi nhận payment: dùng flow paid/no-stock hiện tại, không chạy lại matcher.

## Kiểm thử

### Sidecar

- Chuẩn hóa `transactionDate` giờ Việt Nam thành UTC đúng.
- Fallback sang `postingDate`.
- ISO timestamp có offset được giữ đúng instant.
- Chuỗi lỗi trả `transactionTime: null`.
- Boundary `00:30 Asia/Ho_Chi_Minh` thuộc ngày UTC trước.
- Validation chấp nhận ngày hiện tại của Việt Nam khi host vẫn ở ngày UTC trước.
- Response giữ `transactionDateRaw` và `postingDateRaw`.

### Matcher Node

- Một order, đúng tiền: `unique`.
- Một order, dư `540đ`: `unique`.
- Một order, dư đúng `10.000đ`: `unique`.
- Dư `10.001đ`: `none`.
- Thiếu `1đ`: `review/short_payment`.
- Thiếu đúng `10.000đ`: `review/short_payment`.
- Thiếu `10.001đ`: `none`.
- Hai order trong khoảng `±10.000đ`: `review/ambiguous`.
- Một order được trả đủ và một order bị trả thiếu trong cùng khoảng: `review/ambiguous`.
- Transaction trước `created_at`: không phải ứng viên.
- Transaction đúng tại `created_at`: là ứng viên.
- Transaction đúng tại `expires_at + 24 giờ`: là ứng viên.
- Transaction sau boundary một giây: không phải ứng viên.
- Expired order trong recovery được match.
- Expired order ngoài recovery không được match.
- Order đã paid/delivered/deleted không được match.
- Thiếu timestamp: `review/missing_transaction_time`.

### Poller integration

- Nhánh `PNS` được ưu tiên và không chạy matcher không mã.
- Request không còn `description_contains: "PNS"`.
- Request dùng khoảng ngày Việt Nam và `min_amount` đã trừ `10.000đ`.
- `unique` đi qua flow delivery hiện có.
- `review` chỉ notify một lần và không được retry.
- `unmatched` được retry.
- Transaction đã `matched` không giao lại.
- Hai giao dịch cạnh tranh cùng order không giao hai lần.
- Fixture tương đương đơn `100908`, `431.460đ` nhận `432.000đ`, chỉ có một ứng viên, được auto-match.

### Regression

- Late-payment recovery có mã `PNS`.
- Short payment có mã `PNS`.
- Overpayment có mã `PNS`.
- Topup matching.
- Poller timezone Việt Nam.
- Backorder và no-stock delivery.

## Triển khai

1. Chạy migration trước khi bật code poller mới.
2. Deploy sidecar trước để Node nhận được `transactionTime`.
3. Kiểm tra sidecar response bằng một giao dịch thật, chỉ log timestamp và transaction number.
4. Deploy Node API.
5. Theo dõi các transaction `review`, `unmatched` và `amount_time_unique` trong 24 giờ đầu.
6. Không commit `data/shop.db`, backup DB hoặc log giao dịch.

Nếu Node mới chạy với sidecar cũ, giao dịch không mã thiếu `transactionTime` chỉ được đưa vào `review`; hệ thống không auto-match. Đây là chế độ fail-safe trong lúc rolling deploy.

## Tiêu chí hoàn thành

- Giao dịch không `PNS` có một order ứng viên duy nhất, không thiếu tiền và không dư quá `10.000đ` được xử lý bằng flow thanh toán hiện có.
- Giao dịch thiếu tiền hoặc có nhiều ứng viên không tự xác nhận.
- Timestamp được chuẩn hóa UTC và so sánh độc lập với timezone host.
- Ngày query MBBank dùng `Asia/Ho_Chi_Minh`.
- `matched` và `review` không bị xử lý lặp.
- Admin nhận đủ dữ liệu để xử lý trường hợp review.
- Tests sidecar, matcher, poller và regression pass.
