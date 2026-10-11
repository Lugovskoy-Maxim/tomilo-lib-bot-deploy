const config = require('./config');
const { waitForMessageSlot } = require('./message-rate-limiter');

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

function makeBody(text, titleSlug, buttons = []) {
  const resolvedButtons = buttons.length
    ? buttons
    : titleSlug
    ? [{
      text: 'Читать на сайте ↗',
      url: `${config.siteUrl}/titles/${titleSlug}`,
    }]
    : [];
  const attachments = resolvedButtons.length
    ? [{
      type: 'inline_keyboard',
      payload: {
        buttons: resolvedButtons.map((button) => [{
          type: 'link',
          text: String(button.text || 'Открыть ↗').slice(0, 64),
          url: button.url,
        }]),
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
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch (_) {}
  if (!response.ok || data.success === false) {
    const error = new Error(`MAX API ${response.status}: ${String(data.message || raw).slice(0, 200)}`);
    error.code = data.code;
    throw error;
  }
  return data;
}

async function uploadImage(image) {
  const endpoint = await request('POST', 'https://platform-api2.max.ru/uploads?type=image');
  const uploadUrl = new URL(endpoint.url);
  if (uploadUrl.protocol !== 'https:' || uploadUrl.username || uploadUrl.password ||
      !/(^|\.)(oneme\.ru|max\.ru|okcdn\.ru)$/.test(uploadUrl.hostname)) {
    throw new Error('MAX returned an unexpected upload host');
  }
  const body = new FormData();
  body.append('data', new Blob([image], { type: 'image/png' }), 'community.png');
  const response = await fetch(uploadUrl, {
    method: 'POST', headers: { Authorization: config.maxBotToken }, body,
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`MAX image upload: HTTP ${response.status}`);
  const payload = await response.json();
  const token = payload.token || Object.values(payload.photos || {}).find(photo => photo?.token)?.token;
  if (!token) throw new Error('MAX image upload did not return a token');
  return token;
}

/** Отправляет новое сообщение либо обновляет существующее сообщение бота в MAX. */
async function sendOrEditMaxMessage({ text, titleSlug, messageId, buttons = [], image, imageToken, onImageUploaded }) {
  if (!isEnabled()) return null;
  const body = makeBody(text, titleSlug, buttons);
  if (image || imageToken) {
    const token = imageToken || await uploadImage(image);
    if (!imageToken && onImageUploaded) await onImageUploaded(token);
    body.attachments = [{ type: 'image', payload: { token } }, ...(body.attachments || [])];
  }
  await waitForMessageSlot();
  if (messageId) {
    await request('PUT', `${API_URL}?message_id=${encodeURIComponent(messageId)}`, body);
    return { messageId, edited: true };
  }
  let data;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      data = await request('POST', `${API_URL}?chat_id=${encodeURIComponent(config.maxChatId)}&disable_link_preview=true`, body);
      break;
    } catch (error) {
      if (error.code !== 'attachment.not.ready' || attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  const newMessageId = data.message_id || data.message?.message_id || data.message?.id || data.message?.body?.mid;
  if (!newMessageId) throw new Error('MAX API did not return message_id');
  return { messageId: String(newMessageId), edited: false };
}

module.exports = { isMaxEnabled: isEnabled, sendOrEditMaxMessage };
