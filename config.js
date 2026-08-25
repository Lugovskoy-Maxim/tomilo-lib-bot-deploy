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

const parseTimeOfDay = (v, fallback) => {
  const value = String(v || fallback);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return fallback;
  return value;
};

const parseBoundedInt = (v, fallback, min, max) => {
  const parsed = parseInt(v, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

module.exports = {
  telegramBotToken: required('TELEGRAM_BOT_TOKEN').trim(),
  telegramChatId: String(required('TELEGRAM_CHAT_ID')).trim(),
  /** Дублировать публичные уведомления в MAX. Нужны MAX_BOT_TOKEN и MAX_CHAT_ID. */
  maxEnabled: parseBool(process.env.MAX_ENABLED, false),
  maxBotToken: (process.env.MAX_BOT_TOKEN || '').trim(),
  maxChatId: (process.env.MAX_CHAT_ID || '').trim(),
  apiUrl: (process.env.API_URL || 'http://localhost:3001/api').replace(/\/$/, ''),
  siteUrl: (process.env.SITE_URL || 'https://tomilo-lib.ru').replace(/\/$/, ''),
  /** Базовый URL для картинок с сервера. По умолчанию = siteUrl. */
  imageBaseUrl: (process.env.IMAGE_BASE_URL || process.env.SITE_URL || 'https://tomilo-lib.ru').replace(/\/$/, ''),
  /** Базовый URL для картинок из облака (например S3). Если задан, при относительном coverImage пробуем оба варианта. */
  imageCloudBaseUrl: process.env.IMAGE_CLOUD_BASE_URL
    ? String(process.env.IMAGE_CLOUD_BASE_URL).replace(/\/$/, '')
    : 'https://s3.regru.cloud/tomilolib',
  pollIntervalMs: Math.max(60_000, parseInt(process.env.POLL_INTERVAL_MS || '300000', 10)),
  /** Ночные тихие часы по Москве. Одинаковые значения отключают паузу. */
  quietHoursStart: parseTimeOfDay(process.env.QUIET_HOURS_START, '00:00'),
  quietHoursEnd: parseTimeOfDay(process.env.QUIET_HOURS_END, '08:00'),
  /** Ограничение одной волны, чтобы накопившиеся обновления не стали спамом. */
  maxPublicNotificationsPerRun: parseBoundedInt(process.env.MAX_PUBLIC_NOTIFICATIONS_PER_RUN, 5, 1, 20),
  maxPersonalNotificationsPerRun: parseBoundedInt(process.env.MAX_PERSONAL_NOTIFICATIONS_PER_RUN, 5, 1, 20),
  statePath: process.env.STATE_PATH || '.bot-state.json',

  // --- Оповещения (вкл/выкл в конфиге) ---
  /** Оповещения о новых главах в канал */
  notifyNewChapters: parseBool(process.env.NOTIFY_NEW_CHAPTERS, true),
  /** Личные уведомления о главах в закладках (очередь API) */
  notifyPersonalBookmarks: parseBool(process.env.NOTIFY_PERSONAL_BOOKMARKS, true),
  /** Секрет для /telegram/bot/* (тот же, что TELEGRAM_BOT_API_SECRET на API) */
  botApiSecret: (process.env.BOT_API_SECRET || process.env.TELEGRAM_BOT_API_SECRET || '').trim(),
  /** Оповещения «Новый тайтл на сайте» — когда к тайтлу, созданному сегодня, добавляются главы */
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

  /** Использовать улучшенные обложки с информацией о сайте */
  useEnhancedCovers: parseBool(process.env.USE_ENHANCED_COVERS, false),
};
