require('dotenv').config();

const optional = (name) => String(process.env[name] || '').trim();

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

const telegramBotToken = optional('TELEGRAM_BOT_TOKEN');
const telegramChatId = optional('TELEGRAM_CHAT_ID');
const maxBotToken = optional('MAX_BOT_TOKEN');
const maxChatId = optional('MAX_CHAT_ID');
const maxEnabled = parseBool(process.env.MAX_ENABLED, false);
const telegramEnabled = parseBool(
  process.env.TELEGRAM_ENABLED,
  Boolean(telegramBotToken && telegramChatId),
);

if (telegramEnabled && (!telegramBotToken || !telegramChatId)) {
  throw new Error('TELEGRAM_ENABLED=true requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID');
}
if (maxEnabled && (!maxBotToken || !maxChatId)) {
  throw new Error('MAX_ENABLED=true requires MAX_BOT_TOKEN and MAX_CHAT_ID');
}
if (!telegramEnabled && !maxEnabled) {
  throw new Error('Enable at least one delivery: TELEGRAM_ENABLED or MAX_ENABLED');
}

module.exports = {
  telegramEnabled,
  telegramBotToken,
  telegramChatId,
  /** Публичные уведомления в MAX. Поддерживается самостоятельный MAX-only режим. */
  maxEnabled,
  maxBotToken,
  maxChatId,
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
  notifyDailyAppPromo: parseBool(process.env.NOTIFY_DAILY_APP_PROMO, true),
  notifyDailySupport: parseBool(process.env.NOTIFY_DAILY_SUPPORT, true),
  /** Еженедельная карточка с пятью лидерами; отключается без изменения кода. */
  notifyMonthlyLeaders: parseBool(process.env.NOTIFY_MONTHLY_LEADERS, true),
  monthlyLeadersIntervalMs: parseBoundedInt(
    process.env.MONTHLY_LEADERS_INTERVAL_HOURS,
    168,
    24,
    24 * 31,
  ) * 60 * 60_000,
  /** Подсказка, как включить отображение скрытых глав; по умолчанию раз в неделю. */
  notifyHiddenChaptersGuide: parseBool(process.env.NOTIFY_HIDDEN_CHAPTERS_GUIDE, true),
  hiddenChaptersGuideIntervalMs: parseBoundedInt(
    process.env.HIDDEN_CHAPTERS_GUIDE_INTERVAL_HOURS,
    168,
    24,
    24 * 30,
  ) * 60 * 60_000,
  /** Пост поддержки — не чаще одного раза за указанный интервал (минимум 4 часа). */
  supportPromoIntervalMs: parseBoundedInt(
    process.env.SUPPORT_PROMO_INTERVAL_MINUTES,
    240,
    240,
    1440,
  ) * 60_000,
  dailyPromotionPauseMs: parseBoundedInt(process.env.DAILY_PROMOTION_PAUSE_MINUTES, 20, 1, 180) * 60_000,
  postReactionsEnabled: parseBool(process.env.POST_REACTIONS_ENABLED, true),
  /** Небольшая доля постов остаётся без реакции, чтобы канал выглядел естественно. */
  postReactionSkipPercent: parseBoundedInt(process.env.POST_REACTION_SKIP_PERCENT, 15, 0, 90),
  rustoreUrl: process.env.RUSTORE_URL || 'https://www.rustore.ru/catalog/app/ru.tomilo.lib.mobile',
  githubReleasesUrl: process.env.GITHUB_RELEASES_URL || 'https://github.com/Lugovskoy-Maxim/tomilo-lib-android/releases',
  donateUrl: (process.env.DONATE_URL || '').trim(),
  donateUrlTbank: (process.env.DONATE_URL_TBANK || '').trim(),
  statePath: process.env.STATE_PATH || '.bot-state.json',
  // v2 не использует старые fallback-карточки с TL как кэш настоящей обложки.
  coverCacheDir: process.env.COVER_CACHE_DIR || '/data/cover-cache-v2',

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
  useEnhancedCovers: parseBool(process.env.USE_ENHANCED_COVERS, true),
};
