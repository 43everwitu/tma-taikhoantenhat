const assert = require('node:assert');
const test = require('node:test');
const { encryptString } = require('../../src/utils/secrets');
const { formatCustomerInputForChannel } = require('../../src/utils/messages');
const { buildCard } = require('../../src/services/orderChannelService');

test('order channel customer info stays spoilered but shows password value after reveal', () => {
  const inputValue = encryptString(JSON.stringify({
    'Email Coursera': 'linh@example.com',
    'Password Coursera': 'P@ss<123>&',
  }));

  const customerInfo = formatCustomerInputForChannel(inputValue);
  const text = buildCard({
    order: {
      id: 100603,
      payment_code: '100603',
      quantity: 1,
      total_price: 450260,
    },
    product: { name: 'Tài Khoản Claude Pro/Claude Max' },
    variant: null,
    keys: null,
    customerInfo,
  });

  assert.match(text, /<tg-spoiler>/);
  assert.match(text, /Email Coursera: linh@example\.com/);
  assert.match(text, /Password Coursera: P@ss&lt;123&gt;&amp;/);
  assert.doesNotMatch(text, /••••••/);
});
