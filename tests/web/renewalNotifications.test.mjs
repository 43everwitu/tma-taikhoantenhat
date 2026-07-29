import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getVisibleRenewalNotifications,
  removeNotificationById,
} from '../../web/src/lib/renewalNotifications.js';

test('getVisibleRenewalNotifications returns only unread renewal reminders', () => {
  const notifications = [
    { id: 1, type: 'renewal_reminder', is_read: 0 },
    { id: 2, type: 'renewal_reminder', is_read: 1 },
    { id: 3, type: 'stock_low', is_read: 0 },
    { id: 4, type: 'renewal_reminder', is_read: null },
    null,
  ];

  assert.deepEqual(getVisibleRenewalNotifications(notifications), [
    { id: 1, type: 'renewal_reminder', is_read: 0 },
    { id: 4, type: 'renewal_reminder', is_read: null },
  ]);
});

test('getVisibleRenewalNotifications applies default and custom limits', () => {
  const notifications = [
    { id: 1, type: 'renewal_reminder', is_read: 0 },
    { id: 2, type: 'renewal_reminder', is_read: 0 },
    { id: 3, type: 'renewal_reminder', is_read: 0 },
    { id: 4, type: 'renewal_reminder', is_read: 0 },
  ];

  assert.deepEqual(
    getVisibleRenewalNotifications(notifications).map((item) => item.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    getVisibleRenewalNotifications(notifications, 2).map((item) => item.id),
    [1, 2],
  );
});

test('removeNotificationById removes only the matching id', () => {
  const notifications = [
    { id: 1, type: 'renewal_reminder', is_read: 0 },
    { id: '2', type: 'renewal_reminder', is_read: 0 },
    { id: 3, type: 'stock_low', is_read: 0 },
  ];

  assert.deepEqual(removeNotificationById(notifications, 2), [
    { id: 1, type: 'renewal_reminder', is_read: 0 },
    { id: 3, type: 'stock_low', is_read: 0 },
  ]);
});
