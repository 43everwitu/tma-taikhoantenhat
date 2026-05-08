# Security Features & Monitoring Guide

## 🛡️ Implemented Security Features

### 1. Rate Limiting

- **Default:** 60 requests per minute per IP
- **Configurable:** Set `RATE_LIMIT_REQUESTS` and `RATE_LIMIT_PERIOD` in `.env`
- **Storage:** Redis (preferred) or in-memory fallback
- **Response:** 429 status with `Retry-After` header

### 2. Input Validation

- **SQL Injection Protection:** Detects and blocks common SQL injection patterns
- **XSS Protection:** Prevents script injection in input fields
- **Path Traversal Protection:** Blocks directory traversal attempts
- **Format Validation:** Strict validation for dates, account numbers, usernames

### 3. Structured Logging

- **Format:** JSON logs with standardized fields
- **Request Tracking:** Unique request ID for each API call
- **Security Events:** Automatic logging of suspicious activities
- **Business Events:** Transaction and login activity tracking

### 4. Error Handling

- **No Information Leakage:** Generic error messages for production
- **Request ID Tracking:** All errors include request ID for debugging
- **Security Logging:** Automatic logging of all security events
- **Graceful Degradation:** Fallback behaviors for system failures

### 5. Security Monitoring

- **Malicious Bot Detection:** Blocks known attack tools
- **Suspicious Pattern Detection:** Monitors for injection attempts
- **Authentication Monitoring:** Logs all login attempts and token usage
- **Rate Limit Violations:** Automatic logging and blocking

## 📊 Log Types & Examples

### Request/Response Logs

```json
{
  "timestamp": "2025-09-26T10:30:00.123Z",
  "logger": "api.request",
  "level": "info",
  "message": "Request received",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "method": "POST",
  "path": "/transactions/credit",
  "client_ip": "192.168.1.100",
  "user_agent": "curl/7.68.0"
}
```

### Security Event Logs

```json
{
  "timestamp": "2025-09-26T10:31:00.456Z",
  "logger": "security",
  "level": "warning",
  "message": "Security event",
  "event_type": "rate_limit_exceeded",
  "client_ip": "192.168.1.100",
  "path": "/transactions/credit",
  "limit": "60/minute",
  "retry_after": 30
}
```

### Business Event Logs

```json
{
  "timestamp": "2025-09-26T10:32:00.789Z",
  "logger": "business",
  "level": "info",
  "message": "Business event",
  "event_type": "credit_transactions_retrieved",
  "count": 15,
  "client_ip": "192.168.1.100"
}
```

## 🚨 Security Alert Levels

### CRITICAL (Immediate Action Required)

- Malicious bot detection
- Multiple injection attempts
- Authentication bypass attempts
- System compromise indicators

### WARNING (Monitor & Investigate)

- Rate limit violations
- Validation failures
- Suspicious patterns
- Authentication failures

### INFO (Normal Operations)

- Successful requests
- Business transactions
- System events
- Performance metrics

## 📈 Monitoring Best Practices

### 1. Log Aggregation

```bash
# Example with ELK Stack
# Logstash configuration for parsing JSON logs
input {
  file {
    path => "/var/log/mbbank-api/*.log"
    codec => "json"
  }
}

filter {
  if [logger] == "security" {
    mutate {
      add_tag => ["security"]
    }
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "mbbank-api-logs-%{+YYYY.MM.dd}"
  }
}
```

### 2. Alert Rules

```yaml
# Example Prometheus alerting rules
groups:
  - name: mbbank-api
    rules:
      - alert: HighRateLimitViolations
        expr: rate(rate_limit_exceeded_total[5m]) > 10
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High rate limit violations detected"

      - alert: InjectionAttempts
        expr: rate(injection_attempt_total[5m]) > 5
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Multiple injection attempts detected"
```

### 3. Dashboard Metrics

- Request rate and response time
- Error rate by endpoint
- Security events by type
- Rate limit violations
- Geographic distribution of requests

## 🔧 Security Configuration

### Environment Variables

```bash
# Security
API_ACCESS_TOKEN=your_secure_token_here

# Rate Limiting
RATE_LIMIT_REQUESTS=60
RATE_LIMIT_PERIOD=60

# Logging
LOG_LEVEL=INFO
LOG_FORMAT=json

# Redis (for distributed rate limiting)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
```

### Production Recommendations

1. **Use HTTPS:** Always encrypt traffic in production
2. **Strong Tokens:** Use 32+ character random tokens
3. **Rate Limiting:** Adjust based on expected traffic
4. **Log Rotation:** Implement log rotation to manage disk space
5. **Monitoring:** Set up alerts for security events
6. **Regular Updates:** Keep dependencies updated
7. **Access Control:** Restrict server access to authorized personnel

## 🔍 Troubleshooting

### Common Issues

#### 1. Rate Limiting Not Working

- Check Redis connection
- Verify REDIS_HOST and REDIS_PORT
- Check firewall/network connectivity

#### 2. Logs Not Appearing

- Check LOG_LEVEL setting
- Verify write permissions
- Check log file paths

#### 3. False Positive Security Alerts

- Review validation patterns
- Adjust detection thresholds
- Whitelist legitimate patterns

### Debug Commands

```bash
# Check Redis connectivity
redis-cli -h localhost -p 6379 ping

# View recent logs
tail -f /var/log/mbbank-api/app.log

# Check rate limit status
redis-cli -h localhost -p 6379 keys "*rate_limit*"

# Monitor API health
curl -X GET http://localhost:8000/health
```

## 📞 Security Incident Response

### Immediate Actions

1. **Identify:** Determine the nature and scope
2. **Contain:** Block malicious IPs if necessary
3. **Investigate:** Review logs and trace activities
4. **Document:** Record findings and actions taken
5. **Recover:** Restore normal operations
6. **Learn:** Update security measures

### Emergency Contacts

- API Administrator: [your-email@domain.com]
- Security Team: [security@domain.com]
- Infrastructure Team: [infra@domain.com]

Remember: Security is an ongoing process. Regularly review logs, update configurations, and stay informed about new threats and best practices.
