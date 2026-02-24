const fs = require('fs');
const path = require('path');

function loadState(statePath) {
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const data = JSON.parse(raw);
    return {
      lastProcessedReleaseDate: data.lastProcessedReleaseDate ? new Date(data.lastProcessedReleaseDate) : null,
      titleMessages: data.titleMessages && typeof data.titleMessages === 'object' ? data.titleMessages : {},
    };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('State load error:', e.message);
    return { lastProcessedReleaseDate: null, titleMessages: {} };
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
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

module.exports = { loadState, saveState };
