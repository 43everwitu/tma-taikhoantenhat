// Telegraf's Telegraf.stop() throws synchronously if the bot was never
// launched, or is currently between launchBot()'s retry-backoff attempts
// (see node_modules/telegraf/lib/telegraf.js — `this.polling === undefined`).
// Calling it unguarded from a SIGINT/SIGTERM handler turns that into an
// uncaught exception, which src/index.js's uncaughtException handler then
// treats as fatal (process.exit(1)) — crashing the whole app on an ordinary
// restart that happened to land during a launch retry gap.
function safeBotStop(bot, reason) {
  try {
    bot.stop(reason);
  } catch (err) {
    if (err.message === 'Bot is not running!') return;
    throw err;
  }
}

module.exports = { safeBotStop };
