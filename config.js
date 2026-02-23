require('dotenv').config();

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
};

module.exports = {
  telegramBotToken: required('TELEGRAM_BOT_TOKEN').trim(),
  telegramChatId: String(required('TELEGRAM_CHAT_ID')).trim(),
  apiUrl: (process.env.API_URL || 'http://localhost:3001/api').replace(/\/$/, ''),
  siteUrl: (process.env.SITE_URL || 'https://tomilo-lib.ru').replace(/\/$/, ''),
  pollIntervalMs: Math.max(60_000, parseInt(process.env.POLL_INTERVAL_MS || '300000', 10)),
  statePath: process.env.STATE_PATH || '.bot-state.json',
};
