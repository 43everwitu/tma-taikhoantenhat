// 041_drop_myid.js
// Removes the /myid bot command's template. The command itself was deleted from
// the bot (src/commands/myid.js + bot menu); this drops the now-orphaned row so
// /admin/messages no longer lists it.

function up(db) {
  db.prepare(`DELETE FROM message_templates WHERE key = 'cmd_myid'`).run();
}

module.exports = { up };
