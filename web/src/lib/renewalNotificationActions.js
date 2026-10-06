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

// Hide a notification card without opening anything.
export async function dismissNotification({ notificationId, markRead, removeFromCache }) {
  removeFromCache(notificationId);
  try {
    await markRead(notificationId);
  } catch {
    // Không chặn thao tác ẩn nếu ghi nhận nền thất bại.
  }
}
