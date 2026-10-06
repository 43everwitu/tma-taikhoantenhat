import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOME_NOTIFICATIONS_PATH,
  getStockAlertUrl,
  getVisibleStockAlerts,
} from '../../web/src/lib/renewalNotifications.js';
import { dismissNotification } from '../../web/src/lib/renewalNotificationActions.js';

test('home notifications request asks the server for the two kinds it renders, unread only', () => {
  assert.equal(HOME_NOTIFICATIONS_PATH, '/notifications/my?type=renewal_reminder,stock_alert&unread=1');
});

test('getVisibleStockAlerts returns only unread stock alerts and applies the limit', () => {
  const notifications = [
    { id: 1, type: 'stock_alert', is_read: 0 },
    { id: 2, type: 'stock_alert', is_read: 1 },
    { id: 3, type: 'renewal_reminder', is_read: 0 },
    { id: 4, type: 'stock_alert', is_read: null },
    { id: 5, type: 'stock_alert', is_read: 0 },
    { id: 6, type: 'stock_alert', is_read: 0 },
    null,
  ];
  assert.deepEqual(getVisibleStockAlerts(notifications).map((item) => item.id), [1, 4, 5]);
  assert.deepEqual(getVisibleStockAlerts(notifications, 2).map((item) => item.id), [1, 4]);
  assert.deepEqual(getVisibleStockAlerts(undefined), []);
});

test('getStockAlertUrl builds the product link from the notification data', () => {
  assert.equal(getStockAlertUrl({ data: JSON.stringify({ product_id: 5, product_slug: 'goi-netflix' }) }), '/san-pham/goi-netflix');
  assert.equal(getStockAlertUrl({ data: JSON.stringify({ product_slug: 'a b/c' }) }), '/san-pham/a%20b%2Fc');
  assert.equal(getStockAlertUrl({ data: JSON.stringify({ product_id: 5 }) }), null);
  assert.equal(getStockAlertUrl({ data: 'not json' }), null);
  assert.equal(getStockAlertUrl({ data: null }), null);
  assert.equal(getStockAlertUrl(null), null);
});

test('dismissNotification removes from cache then marks read, never navigates', async () => {
  const calls = [];
  await dismissNotification({
    notificationId: 9,
    removeFromCache: (id) => calls.push(['removeFromCache', id]),
    markRead: async (id) => calls.push(['markRead', id]),
  });
  assert.deepEqual(calls, [['removeFromCache', 9], ['markRead', 9]]);
});

test('dismissNotification still resolves when mark-read fails', async () => {
  const calls = [];
  await dismissNotification({
    notificationId: 9,
    removeFromCache: (id) => calls.push(['removeFromCache', id]),
    markRead: async () => { throw new Error('network'); },
  });
  assert.deepEqual(calls, [['removeFromCache', 9]]);
});
