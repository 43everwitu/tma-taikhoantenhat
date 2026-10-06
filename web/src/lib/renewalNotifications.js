export function getVisibleRenewalNotifications(notifications, limit = 3) {
  return (notifications ?? [])
    .filter((item) => item?.type === 'renewal_reminder' && Number(item?.is_read ?? 0) !== 1)
    .slice(0, limit);
}

export function removeNotificationById(notifications, id) {
  return (notifications ?? []).filter((item) => Number(item?.id) !== Number(id));
}

// Home screen shows only these kinds; asking the server to filter keeps older
// renewal reminders from being pushed out of the newest-50 window by bulk rows.
export const HOME_NOTIFICATIONS_PATH = '/notifications/my?type=renewal_reminder,stock_alert&unread=1';

export function getVisibleStockAlerts(notifications, limit = 3) {
  return (notifications ?? [])
    .filter((item) => item?.type === 'stock_alert' && Number(item?.is_read ?? 0) !== 1)
    .slice(0, limit);
}

export function getStockAlertUrl(item) {
  try {
    const slug = JSON.parse(item?.data ?? 'null')?.product_slug;
    return typeof slug === 'string' && slug ? `/san-pham/${encodeURIComponent(slug)}` : null;
  } catch {
    return null;
  }
}
