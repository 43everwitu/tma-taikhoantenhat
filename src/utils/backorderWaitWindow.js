const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const BUSINESS_START_MINUTES = 9 * 60;
const BUSINESS_END_MINUTES = 22 * 60 + 30;

function getTimePartsInVietnam(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return { hour: 9, minute: 0 };
  }

  return { hour, minute };
}

function getBackorderWaitMode(date = new Date()) {
  const { hour, minute } = getTimePartsInVietnam(date);
  const minutes = hour * 60 + minute;
  return minutes >= BUSINESS_START_MINUTES && minutes <= BUSINESS_END_MINUTES
    ? 'business_hours'
    : 'after_hours';
}

module.exports = {
  getBackorderWaitMode,
};
