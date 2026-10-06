export function getVisibleRenewalNotifications(notifications, limit = 3) {
  return (notifications ?? [])
    .filter((item) => item?.type === 'renewal_reminder' && Number(item?.is_read ?? 0) !== 1)
    .slice(0, limit);
}

export function removeNotificationById(notifications, id) {
  return (notifications ?? []).filter((item) => Number(item?.id) !== Number(id));
}
