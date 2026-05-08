const db = require('../database');
const config = require('../config');
const messageTemplateService = require('../services/messageTemplateService');
const { Markup } = require('telegraf');

function readSetting(key, fallback) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r?.value || fallback;
}

module.exports = (bot) => {
    bot.command('website', (ctx) => {
        const url = readSetting('website_url', config.WEB_URL || '');
        const desc = readSetting('website_description', '');
        const cleanUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const fullUrl = url.startsWith('http') ? url : `https://${url}`;

        const isPublic = /^https?:\/\/(?!(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/.test(fullUrl);

        const text = messageTemplateService.render('cmd_website', {
            description: desc,
            url: fullUrl,
            cleanUrl: cleanUrl || fullUrl,
        });

        if (isPublic) {
            ctx.replyWithHTML(text, {
                disable_web_page_preview: false,
                ...Markup.inlineKeyboard([
                    [Markup.button.url('🛍️ Mở website', fullUrl)],
                ]),
            });
        } else {
            ctx.replyWithHTML(text, { disable_web_page_preview: false });
        }
    });
};
