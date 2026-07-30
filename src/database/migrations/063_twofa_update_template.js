const key = 'bot.2fa_order_updated';
const variables = JSON.stringify(['productName', 'orderCode', 'changedAt', 'orderUrl']);
const body = `🔔 <b>Thông tin tài khoản đã được cập nhật</b>

Sản phẩm: {{productName}}
Đơn hàng: #{{orderCode}}
Thời gian: {{changedAt}}

Thông tin đăng nhập của đơn hàng vừa thay đổi. Vui lòng mở trang đơn hàng để xem thông tin mới:

{{orderUrl}}`;

function up(db) {
  db.prepare(`
    INSERT INTO message_templates (
      key, channel, label, variables, body, default_body, is_enabled
    ) VALUES (
      ?, 'bot', 'Bot — cập nhật tài khoản 2FA',
      ?, ?, ?, 1
    )
    ON CONFLICT(key) DO UPDATE SET
      channel = excluded.channel,
      label = excluded.label,
      variables = excluded.variables,
      default_body = excluded.default_body,
      is_enabled = 1,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, variables, body, body);
}

module.exports = { up };
