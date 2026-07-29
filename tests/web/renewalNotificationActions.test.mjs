import assert from 'node:assert/strict';
import test from 'node:test';

import { acknowledgeRenewalNotification } from '../../web/src/lib/renewalNotificationActions.js';

test('acknowledgeRenewalNotification removes from cache, marks read, then navigates', async () => {
  const calls = [];

  await acknowledgeRenewalNotification({
    notificationId: 42,
    url: '/dat-hang?renew=42',
    removeFromCache: (notificationId) => {
      calls.push(['removeFromCache', notificationId]);
    },
    markRead: async (notificationId) => {
      calls.push(['markRead', notificationId]);
    },
    navigate: (url) => {
      calls.push(['navigate', url]);
    },
  });

  assert.deepEqual(calls, [
    ['removeFromCache', 42],
    ['markRead', 42],
    ['navigate', '/dat-hang?renew=42'],
  ]);
});

test('acknowledgeRenewalNotification still navigates when mark-read fails', async () => {
  const calls = [];

  await acknowledgeRenewalNotification({
    notificationId: 7,
    url: '/don-hang/100479',
    removeFromCache: (notificationId) => {
      calls.push(['removeFromCache', notificationId]);
    },
    markRead: async (notificationId) => {
      calls.push(['markRead', notificationId]);
      throw new Error('mark-read failed');
    },
    navigate: (url) => {
      calls.push(['navigate', url]);
    },
  });

  assert.deepEqual(calls, [
    ['removeFromCache', 7],
    ['markRead', 7],
    ['navigate', '/don-hang/100479'],
  ]);
});
