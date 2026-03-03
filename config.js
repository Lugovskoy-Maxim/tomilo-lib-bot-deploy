require('dotenv').config();

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
};

const parseBool = (v, def) => {
  if (v === undefined || v === '') return def;
  return v === '1' || String(v).toLowerCase() === 'true' || v === 'yes';
};

const parseMilestoneChapters = (v) => {
  if (!v || typeof v !== 'string') return [50, 100, 200, 500, 1000];
  return v
    .split(/[,\s]+/)
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)
    .filter((n, i, arr) => arr.indexOf(n) === i);
};

module.exports = {
  telegramBotToken: required('TELEGRAM_BOT_TOKEN').trim(),
  telegramChatId: String(required('TELEGRAM_CHAT_ID')).trim(),
  apiUrl: (process.env.API_URL || 'http://localhost:3001/api').replace(/\/$/, ''),
  siteUrl: (process.env.SITE_URL || 'https://tomilo-lib.ru').replace(/\/$/, ''),
  /** Базовый URL для картинок (обложки, страницы). По умолчанию = siteUrl. Если картинки отдаёт только API-сервер — задай IMAGE_BASE_URL. */
  imageBaseUrl: (process.env.IMAGE_BASE_URL || process.env.SITE_URL || 'https://tomilo-lib.ru').replace(/\/$/, ''),
  pollIntervalMs: Math.max(60_000, parseInt(process.env.POLL_INTERVAL_MS || '300000', 10)),
  statePath: process.env.STATE_PATH || '.bot-state.json',

  // --- Оповещения (вкл/выкл в конфиге) ---
  /** Оповещения о новых главах */
  notifyNewChapters: parseBool(process.env.NOTIFY_NEW_CHAPTERS, true),
  /** Оповещения о новых тайтлах (добавленных сегодня) */
  notifyNewTitles: parseBool(process.env.NOTIFY_NEW_TITLES, true),
  /** Таблица лидеров: уведомлять об изменении позиций в рейтинге (sortBy: rating или views) */
  notifyLeaderboard: parseBool(process.env.NOTIFY_LEADERBOARD, false),
  leaderboardSize: Math.min(50, Math.max(5, parseInt(process.env.LEADERBOARD_SIZE || '10', 10))),
  leaderboardSort: (process.env.LEADERBOARD_SORT || 'rating').toLowerCase() === 'views' ? 'views' : 'rating',
  /** Юбилейные главы: уведомлять при выходе 50-й, 100-й, 200-й и т.д. */
  notifyMilestoneChapters: parseBool(process.env.NOTIFY_MILESTONE_CHAPTERS, false),
  milestoneChapters: parseMilestoneChapters(process.env.MILESTONE_CHAPTERS),
  /** Тайтл набрал за день не меньше N просмотров (требует поддержки views в API) */
  notifyDailyViews: parseBool(process.env.NOTIFY_DAILY_VIEWS, false),
  dailyViewsMin: Math.max(1, parseInt(process.env.DAILY_VIEWS_MIN || '1000', 10)),
};

