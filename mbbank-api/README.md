# MBBank API

API để kiểm tra giao dịch MBBank dựa trên logic của Discord bot, sử dụng thư viện [mbbank-lib](https://github.com/thedtvn/MBBank).

## Cài đặt

```bash
pip install -r requirements.txt
```

## Cấu hình

Tạo file `.env`:

```bash
# MBBank credentials (optional - có thể dùng endpoint /login thay thế)
MB_USERNAME=your_mbbank_username
MB_PASSWORD=your_mbbank_password
MB_CAPTCHA=optional_captcha_text

# API Security - BẮT BUỘC để bảo mật API
API_ACCESS_TOKEN=your_secure_access_token_here

# Rate Limiting Configuration
RATE_LIMIT_REQUESTS=60    # Requests per minute
RATE_LIMIT_PERIOD=60      # Period in seconds

# Redis Configuration (for rate limiting)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# Logging Configuration
LOG_LEVEL=INFO           # DEBUG, INFO, WARNING, ERROR, CRITICAL
LOG_FORMAT=json          # json or text

# Server Configuration
HOST=0.0.0.0
PORT=8000
DEBUG=false
```

**🛡️ Tính năng bảo mật:**

- ✅ **Rate Limiting:** 60 requests/minute (có thể tùy chỉnh)
- ✅ **Input Validation:** Chống SQL injection, XSS attacks
- ✅ **Structured Logging:** JSON logs với request ID tracking
- ✅ **Security Monitoring:** Tự động phát hiện và log các hành vi đáng ngờ
- ✅ **Error Handling:** Không expose sensitive information
- ✅ **CORS Protection:** Configured cho development/production

**Yêu cầu hệ thống:**

- Redis server (cho rate limiting) - không bắt buộc, sẽ fallback về memory
- `API_ACCESS_TOKEN` - bắt buộc cho production

## Cài đặt và Chạy

### 1. Cài đặt dependencies:

```bash
pip install -r requirements.txt
```

### 2. Tùy chọn: Cài đặt Redis (cho rate limiting tối ưu):

```bash
# Ubuntu/Debian
sudo apt install redis-server

# macOS
brew install redis

# Hoặc chạy với Docker
docker run -d -p 6379:6379 redis:alpine
```

### 3. Chạy server:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## API Endpoints

**Chỉ các endpoints transaction yêu cầu Bearer token trong header:**

```bash
Authorization: Bearer your_access_token
```

### 1. Health Check

```bash
GET /health
# Không yêu cầu token
```

### 2. Đăng nhập

```bash
POST /login
Content-Type: application/json
# Không yêu cầu token

{
  "username": "your_username",
  "password": "your_password",
  "captcha_text": "optional"
}
```

### 3. Lấy giao dịch cộng tiền (Credit)

```bash
POST /transactions/credit
Content-Type: application/json
Authorization: Bearer your_access_token

{
  "from_date": "2025-09-01",  // optional, YYYY-MM-DD
  "to_date": "2025-09-25",    // optional, YYYY-MM-DD
  "captcha_text": "optional"
}
```

### 4. Lấy tất cả giao dịch

```bash
POST /transactions/all
Content-Type: application/json
Authorization: Bearer your_access_token

{
  "from_date": "2025-09-01",  // optional, YYYY-MM-DD
  "to_date": "2025-09-25",    // optional, YYYY-MM-DD
  "captcha_text": "optional"
}
```

### 5. Legacy endpoint

```bash
POST /transactions
Authorization: Bearer your_access_token
# Tương tự /transactions/credit
```

## Response Format

### Success Response

```json
{
  "success": 1,
  "results": [
    {
      "transactionNumber": "GD123456",
      "amount": 100000.0,
      "description": "Transfer from...",
      "type": "IN"
    }
  ]
}
```

### Error Response (Unauthorized)

```json
{
  "detail": "Invalid access token"
}
```

### Error Response (Business Logic)

```json
{
  "detail": "Not logged in. Use /login or set MB_USERNAME/MB_PASSWORD"
}
```

## Ví dụ sử dụng với curl

```bash
# Set access token
export ACCESS_TOKEN="your_secure_token_here"

# Health check (không cần token)
curl -X GET http://localhost:8000/health

# Đăng nhập (không cần token)
curl -X POST http://localhost:8000/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "your_username",
    "password": "your_password"
  }'

# Lấy giao dịch credit
curl -X POST http://localhost:8000/transactions/credit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "from_date": "2025-09-01",
    "to_date": "2025-09-25"
  }'
```

## Logic giống Discord Bot

- Mặc định lấy giao dịch 7 ngày gần nhất nếu không chỉ định `from_date/to_date`
- `/transactions/credit` chỉ lấy giao dịch có `creditAmount > 0` (tiền vào)
- `/transactions/all` lấy tất cả giao dịch (cả vào và ra)
- Auto-login bằng env credentials nếu chưa đăng nhập
- **Bảo mật:** Chỉ các endpoints transaction yêu cầu Bearer token, `/health` và `/login` không cần token
- **Rate Limiting:** Tự động chặn spam requests
- **Monitoring:** Structured logging với request ID tracking
- **Validation:** Tự động phát hiện và chặn injection attacks

## Tham khảo

- Thư viện: [thedtvn/MBBank](https://github.com/thedtvn/MBBank)
- Discord bot gốc được dùng để tham khảo logic xử lý giao dịch
# mbbank-api
