const fs = require('fs');
const path = require('path');

function loadState(statePath) {
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const data = JSON.parse(raw);
    return {
      lastProcessedReleaseDate: data.lastProcessedReleaseDate ? new Date(data.lastProcessedReleaseDate) : null,
      titleMessages: data.titleMessages && typeof data.titleMessages === 'object' ? data.titleMessages : {},
      // Сообщения в MAX: { [titleSlug]: { messageId, date } } для обновления анонса в течение дня
      maxTitleMessages: data.maxTitleMessages && typeof data.maxTitleMessages === 'object' ? data.maxTitleMessages : {},
      // Таблица лидеров: [{ slug, name, position, value }] для сравнения позиций
      lastLeaderboard: Array.isArray(data.lastLeaderboard) ? data.lastLeaderboard : [],
      // Юбилейные главы: { [titleSlug]: [50, 100, ...] } — уже оповещённые пороги
      notifiedMilestones: data.notifiedMilestones && typeof data.notifiedMilestones === 'object' ? data.notifiedMilestones : {},
      // Уже отправленные в Telegram номера глав по slug (чтобы не дублировать старые из API)
      notifiedChapters: data.notifiedChapters && typeof data.notifiedChapters === 'object' ? data.notifiedChapters : {},
      // Точные отпечатки опубликованных уведомлений: «тайтл + глава».
      // Нужны как вторая линия защиты, если API повторно отдаёт старую запись.
      sentChapterEvents: data.sentChapterEvents && typeof data.sentChapterEvents === 'object' ? data.sentChapterEvents : {},
      // Для "просмотров за день": дата и снимок просмотров по slug (для следующего расчёта дельты)
      lastViewsDate: data.lastViewsDate || null,
      lastViewsBySlug: data.lastViewsBySlug && typeof data.lastViewsBySlug === 'object' ? data.lastViewsBySlug : {},
      dailyPromotions: data.dailyPromotions && typeof data.dailyPromotions === 'object' ? data.dailyPromotions : {},
      supportPromoLastSentAt: Number(data.supportPromoLastSentAt) || 0,
      promotionsPauseUntil: Number(data.promotionsPauseUntil) || 0,
    };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('State load error:', e.message);
    return {
      lastProcessedReleaseDate: null,
      titleMessages: {},
      maxTitleMessages: {},
      lastLeaderboard: [],
      notifiedMilestones: {},
      notifiedChapters: {},
      sentChapterEvents: {},
      lastViewsDate: null,
      lastViewsBySlug: {},
      dailyPromotions: {},
      supportPromoLastSentAt: 0,
      promotionsPauseUntil: 0,
    };
  }
}

function saveState(statePath, state) {
  const dir = path.dirname(statePath);
  if (dir !== '.') {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  const toSave = {
    lastProcessedReleaseDate: state.lastProcessedReleaseDate,
    titleMessages: state.titleMessages,
    maxTitleMessages: state.maxTitleMessages,
    lastLeaderboard: state.lastLeaderboard,
    notifiedMilestones: state.notifiedMilestones,
    notifiedChapters: state.notifiedChapters,
    sentChapterEvents: state.sentChapterEvents,
    lastViewsDate: state.lastViewsDate,
    lastViewsBySlug: state.lastViewsBySlug,
    dailyPromotions: state.dailyPromotions,
    supportPromoLastSentAt: state.supportPromoLastSentAt,
    promotionsPauseUntil: state.promotionsPauseUntil,
  };
  // Запись через rename не оставит повреждённый JSON при рестарте контейнера
  // ровно во время сохранения состояния.
  const temporaryPath = `${statePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(toSave, null, 2), 'utf8');
  fs.renameSync(temporaryPath, statePath);
}

module.exports = { loadState, saveState };
