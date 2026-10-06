export async function acknowledgeRenewalNotification({
  notificationId,
  url,
  markRead,
  removeFromCache,
  navigate,
}) {
  removeFromCache(notificationId);
  try {
    await markRead(notificationId);
  } catch {
    // Không chặn điều hướng nếu thao tác ghi nhận nền thất bại.
  }
  navigate(url);
}
