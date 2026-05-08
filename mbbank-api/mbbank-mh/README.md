# MBBank Gateway - MH

Plugin cổng thanh toán MBBank cho WooCommerce, được xây dựng dựa trên API MBBank không chính thức.

## Tính năng

- ✅ Tích hợp WooCommerce Gateway
- ✅ Hiển thị QR Code VietQR cho thanh toán nhanh
- ✅ Tự động đồng bộ giao dịch từ MBBank
- ✅ Tự động cập nhật trạng thái đơn hàng
- ✅ Giao diện admin thân thiện
- ✅ Không sử dụng mã hóa (full source code)

## Yêu cầu

- WordPress 5.0+
- WooCommerce 3.0+
- PHP 7.4+
- API Server MBBank (sử dụng [MBBank Python Library](https://github.com/thedtvn/MBBank))

## Cài đặt

1. Upload thư mục `mbbank-mh` vào `/wp-content/plugins/`
2. Kích hoạt plugin trong WordPress Admin
3. Cấu hình plugin tại **MBBank MH** trong menu admin
4. Bật gateway trong **WooCommerce > Settings > Payments**

## Cấu hình

### 1. Cấu hình cơ bản

- **Số tài khoản MBBank**: Tài khoản nhận tiền
- **Tên chủ tài khoản**: Hiển thị trên trang thanh toán
- **Prefix/Suffix**: Định dạng nội dung chuyển khoản
- **Trạng thái đơn hàng**: Trạng thái sau khi thanh toán thành công
- **API Endpoint**: URL API server của bạn

### 2. API Server

Bạn cần tạo một API server sử dụng [MBBank Python Library](https://github.com/thedtvn/MBBank).

Ví dụ endpoint trả về:

```json
{
  "success": 1,
  "results": [
    {
      "transactionNumber": "TX123456",
      "amount": 150000,
      "description": "DH1234",
      "type": "IN"
    }
  ]
}
```

### 3. Đăng nhập API

Cấu hình thông tin đăng nhập để kết nối với API server MBBank của bạn.

## Workflow

1. **Khách hàng thanh toán**: Chọn MBBank Gateway tại checkout
2. **Hiển thị QR**: Trang cảm ơn hiển thị QR Code và thông tin chuyển khoản
3. **Polling**: Frontend tự động kiểm tra trạng thái thanh toán
4. **Đồng bộ**: Server đồng bộ giao dịch từ MBBank API
5. **Đối soát**: Tự động ghép giao dịch với đơn hàng dựa trên nội dung
6. **Cập nhật**: Cập nhật trạng thái đơn hàng khi thanh toán thành công

## Bảo mật

- Thông tin đăng nhập được mã hóa đơn giản (base64 + key)
- Khuyến nghị sử dụng HTTPS cho API endpoint
- Không lưu trữ thông tin nhạy cảm trong database

## Hỗ trợ

- Tạo issue trên GitHub
- Email: support@example.com

## License

GPL-2.0+

## Credits

- Dựa trên [MBBank Python Library](https://github.com/thedtvn/MBBank)
- UI/UX tham khảo từ ACB Gateway plugin
