const test = require('node:test');
const assert = require('node:assert');
const { safeBotStop } = require('../src/utils/safeBotStop');

// Mirrors telegraf's Telegraf.stop(): throws synchronously when the bot
// was never launched (or is between launch retries) — see
// node_modules/telegraf/lib/telegraf.js.
function makeBot({ running }) {
  return {
    stop(reason) {
      if (!running) throw new Error('Bot is not running!');
      this.stoppedWith = reason;
    },
  };
}

test('safeBotStop swallows "Bot is not running!" instead of throwing', () => {
  const bot = makeBot({ running: false });
  assert.doesNotThrow(() => safeBotStop(bot, 'SIGTERM'));
});

test('safeBotStop calls bot.stop with the given reason when the bot is running', () => {
  const bot = makeBot({ running: true });
  safeBotStop(bot, 'SIGINT');
  assert.strictEqual(bot.stoppedWith, 'SIGINT');
});

test('safeBotStop re-throws any other error', () => {
  const bot = { stop() { throw new Error('boom'); } };
  assert.throws(() => safeBotStop(bot, 'SIGTERM'), /boom/);
});
