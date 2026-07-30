const https = require('https');

let telegramRequest = telegramJsonRequest;

function telegramJsonRequest(method, payload) {
  const token = process.env.BOT_TOKEN;
  if (!token) return Promise.reject(new Error('BOT_TOKEN is not set'));

  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      family: 4,
      timeout: 15000,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        let data;
        try {
          data = JSON.parse(responseBody);
        } catch {
          reject(new Error(`Telegram ${method} returned invalid JSON (${res.statusCode})`));
          return;
        }

        if (!data.ok) {
          const error = new Error(data.description || `Telegram ${method} failed (${res.statusCode})`);
          error.isTelegramApiError = true;
          reject(error);
          return;
        }
        resolve(data.result);
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Telegram ${method} timed out`));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function callApi(method, payload) {
  return telegramRequest(method, payload);
}

function sendMessage(chatId, text, opts = {}) {
  return callApi('sendMessage', {
    chat_id: chatId,
    text,
    ...opts,
  });
}

function editMessageText(chatId, messageId, text, opts = {}) {
  return callApi('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...opts,
  });
}

function setTelegramRequestForTest(fn) {
  telegramRequest = fn || telegramJsonRequest;
}

module.exports = {
  callApi,
  sendMessage,
  editMessageText,
  setTelegramRequestForTest,
};
