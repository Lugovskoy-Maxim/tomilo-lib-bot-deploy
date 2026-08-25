const config = require('./config');

const API_URL = 'https://platform-api2.max.ru/messages';
const MAX_TEXT_LIMIT = 4000;

function isEnabled() {
  return config.maxEnabled && Boolean(config.maxBotToken && config.maxChatId);
}

function clampText(text) {
  const value = String(text || '');
  return value.length <= MAX_TEXT_LIMIT
    ? value
    : `${value.slice(0, MAX_TEXT_LIMIT - 1)}…`;
}

function makeBody(text, titleSlug) {
  const attachments = titleSlug
    ? [{
      type: 'inline_keyboard',
      payload: {
        buttons: [[{
          type: 'link',
          text: 'Читать на сайте ↗',
          url: `${config.siteUrl}/titles/${titleSlug}`,
        }]],
      },
    }]
    : [];

  return {
    text: clampText(text),
    format: 'html',
    ...(attachments.length ? { attachments } : {}),
  };
}

async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: config.maxBotToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch (_) {}
  if (!response.ok || data.success === false) {
    throw new Error(`MAX API ${response.status}: ${String(data.message || raw).slice(0, 200)}`);
  }
  return data;
}

/** Отправляет новое сообщение либо обновляет существующее сообщение бота в MAX. */
async function sendOrEditMaxMessage({ text, titleSlug, messageId }) {
  if (!isEnabled()) return null;
  const body = makeBody(text, titleSlug);
  if (messageId) {
    await request('PUT', `${API_URL}?message_id=${encodeURIComponent(messageId)}`, body);
    return { messageId, edited: true };
  }
  const data = await request(
    'POST',
    `${API_URL}?chat_id=${encodeURIComponent(config.maxChatId)}&disable_link_preview=true`,
    body,
  );
  const newMessageId = data.message_id || data.message?.message_id || data.message?.id;
  if (!newMessageId) throw new Error('MAX API did not return message_id');
  return { messageId: String(newMessageId), edited: false };
}

module.exports = { isMaxEnabled: isEnabled, sendOrEditMaxMessage };
