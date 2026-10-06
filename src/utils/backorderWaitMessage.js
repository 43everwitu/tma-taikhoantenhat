const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const OPEN_MINUTE = 9 * 60;
const OFFLINE_MINUTE = 22 * 60 + 30;

function minutesInVietnam(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isShopOffline(date = new Date()) {
  const minutes = minutesInVietnam(date);
  return minutes < OPEN_MINUTE || minutes >= OFFLINE_MINUTE;
}

function getBackorderPaidMessage(date = new Date()) {
  if (isShopOffline(date)) {
    return 'Shop đang offline, đơn hàng của bạn sẽ được xử lý vào 9h30 sáng mai.';
  }
  return 'Shop sẽ xử lý thủ công trong khoảng 30-60 phút, hoặc theo thời gian ghi trên sản phẩm.';
}

module.exports = {
  getBackorderPaidMessage,
  isShopOffline,
};
