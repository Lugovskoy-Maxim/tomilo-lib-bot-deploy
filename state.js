const fs = require('fs');
const path = require('path');

function loadState(statePath) {
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const data = JSON.parse(raw);
    return {
      lastProcessedReleaseDate: data.lastProcessedReleaseDate ? new Date(data.lastProcessedReleaseDate) : null,
      titleMessages: data.titleMessages && typeof data.titleMessages === 'object' ? data.titleMessages : {},
      // Таблица лидеров: [{ slug, name, position, value }] для сравнения позиций
      lastLeaderboard: Array.isArray(data.lastLeaderboard) ? data.lastLeaderboard : [],
      // Юбилейные главы: { [titleSlug]: [50, 100, ...] } — уже оповещённые пороги
      notifiedMilestones: data.notifiedMilestones && typeof data.notifiedMilestones === 'object' ? data.notifiedMilestones : {},
      // Для "просмотров за день": дата и снимок просмотров по slug (для следующего расчёта дельты)
      lastViewsDate: data.lastViewsDate || null,
      lastViewsBySlug: data.lastViewsBySlug && typeof data.lastViewsBySlug === 'object' ? data.lastViewsBySlug : {},
    };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('State load error:', e.message);
    return {
      lastProcessedReleaseDate: null,
      titleMessages: {},
      lastLeaderboard: [],
      notifiedMilestones: {},
      lastViewsDate: null,
      lastViewsBySlug: {},
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
    lastLeaderboard: state.lastLeaderboard,
    notifiedMilestones: state.notifiedMilestones,
    lastViewsDate: state.lastViewsDate,
    lastViewsBySlug: state.lastViewsBySlug,
  };
  fs.writeFileSync(statePath, JSON.stringify(toSave, null, 2), 'utf8');
}

module.exports = { loadState, saveState };
