const DAY = 86_400_000;
const METRICS = {
  chaptersRead: { key: 'chaptersRead', label: 'Прочитано глав', unit: 'глав', accent: '#ad9aff' },
  comments: { key: 'commentsCount', label: 'Комментарии', unit: 'комментариев', accent: '#7abaff' },
  ratings: { key: 'ratingsCount', label: 'Оценки тайтлов', unit: 'оценок', accent: '#79dcc1' },
  streak: { key: 'currentStreak', label: 'Серия активности', unit: 'дней подряд', accent: '#ff987c' },
  likesReceived: { key: 'likesReceivedCount', label: 'Получено лайков', unit: 'лайков', accent: '#f2a2cb' },
};
const BOARDS = ['chaptersRead:week', 'comments:week', 'ratings:week', 'chaptersRead:all', 'streak:all', 'likesReceived:all'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (n) => Number(n || 0).toLocaleString('ru-RU');
const userId = (u) => String(u?._id || u?.id || '');

function moscowClock(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}`, weekday: new Date(`${date}T12:00:00Z`).getUTCDay() };
}

async function fetchJson(apiUrl, route, fetcher = fetch) {
  const response = await fetcher(`${apiUrl.replace(/\/$/, '')}/${route}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${route.split('?')[0]}: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.success === false || payload.data == null) throw new Error(`${route.split('?')[0]}: unsuccessful API response`);
  return payload.data;
}

async function fetchChronicleData(config, weekday, fetcher = fetch) {
  const boards = {};
  const results = await Promise.allSettled(BOARDS.map(async key => {
    const [category, period] = key.split(':');
    const data = await fetchJson(config.apiUrl, `users/leaderboard?category=${category}&period=${period}&limit=100&page=1`, fetcher);
    if (!Array.isArray(data.users)) throw new Error(`Invalid leaderboard ${key}`);
    // Keep API positions before filtering out malformed or non-public profiles.
    boards[key] = data.users.map((u, i) => ({ ...u, rank: i + 1 }))
      .filter(u => userId(u) && u.username && u.showStats !== false && u.isProfilePublic !== false && u.isBanned !== true);
  }));
  const errors = results.flatMap((r, i) => r.status === 'rejected' ? [`${BOARDS[i]}: ${r.reason.message}`] : []);
  let suggestions = [], comments = [];
  if (weekday === 3) {
    try {
      const data = await fetchJson(config.apiUrl, 'shop/suggestions', fetcher);
      if (!Array.isArray(data)) throw new Error('Invalid suggestions response');
      suggestions = data.filter(s => s.status === 'pending' && s.id && s.name && s.imageUrl);
    } catch (e) { errors.push(e.message); }
  }
  if (weekday === 4) {
    try {
      const data = await fetchJson(config.apiUrl, 'comments?entityType=title&entityId=all&sortOrder=newest&limit=100', fetcher);
      comments = Array.isArray(data.comments) ? data.comments : [];
    } catch (e) { errors.push(e.message); }
  }
  return { boards, suggestions, comments, errors };
}

function freshUser(user, featured, now) {
  const last = featured[userId(user)];
  return !last || now.getTime() - new Date(`${last}T00:00:00+03:00`).getTime() >= 7 * DAY;
}

function selectStory(data, history, featured, now) {
  const { date, weekday } = moscowClock(now);
  const boards = data.boards;
  const eligible = key => (boards[key] || []).filter(u => freshUser(u, featured, now));
  const weeklyIndex = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / (7 * DAY));
  const categories = ['chaptersRead', 'comments', 'ratings'];
  const category = categories[weeklyIndex % categories.length];
  const makePerson = (kind, title, user, key, extra = {}) => {
    const metric = METRICS[key.split(':')[0]];
    return { kind, title, date, users: [user], category: key, accent: metric.accent,
      metric: metric.label, value: user[metric.key], unit: metric.unit,
      period: key.endsWith(':week') ? 'Последние 7 дней' : 'Текущий результат', ...extra };
  };
  if (weekday === 1) {
    const movers = categories.flatMap(c => eligible(`${c}:week`)
      .filter(u => Number.isInteger(u.rankChange?.week) && u.rankChange.week >= 5)
      .map(u => ({ u, c }))).sort((a, b) => b.u.rankChange.week - a.u.rankChange.week);
    if (movers.length) {
      const { u, c } = movers[0];
      return makePerson('rise', 'Рывок недели', u, `${c}:week`, {
        value: u.rankChange.week, unit: 'позиций вверх', fromRank: u.rank + u.rankChange.week,
        toRank: u.rank, period: 'Сравнение с позицией 7 дней назад',
      });
    }
  }
  if (weekday === 2) {
    const previous = [...history].reverse().find(s => now - new Date(s.at) >= 20 * 3_600_000 && now - new Date(s.at) <= 30 * 3_600_000);
    if (previous?.boards?.['chaptersRead:all']) {
      const values = new Map(previous.boards['chaptersRead:all'].map(u => [userId(u), u.chaptersRead]));
      const readers = eligible('chaptersRead:all').filter(u => values.has(userId(u)))
        .map(u => ({ u, delta: Number(u.chaptersRead) - Number(values.get(userId(u))) }))
        .filter(row => row.delta > 0).sort((a, b) => b.delta - a.delta);
      if (readers.length) return makePerson('reader', 'Читатель дня', readers[0].u, 'chaptersRead:all', {
        value: readers[0].delta, period: 'Между ежедневными снимками рейтинга',
      });
    }
  }
  if (weekday === 3 && data.suggestions.length) {
    const items = [...data.suggestions].sort((a, b) => Number(b.votesCount || 0) - Number(a.votesCount || 0)).slice(0, 3);
    return { kind: 'vote', title: 'Выбор сообщества', date, accent: '#79dcc1', users: [], items,
      period: 'Предложения магазина', metric: 'Ваш голос решает', unit: '', value: items.length };
  }
  if (weekday === 4) {
    const publicUsers = new Map(Object.values(boards).flat().map(u => [userId(u), u]));
    const comments = data.comments.filter(c => !c.hiddenBySystem && !c.isSystemHidden && c.isVisible !== false &&
      !c.isSpoiler && c.moderationStatus === 'approved' && typeof c.content === 'string' && c.content.length >= 30 &&
      now - new Date(c.createdAt) <= 7 * DAY && now >= new Date(c.createdAt))
      .map(c => ({ c, u: publicUsers.get(userId(c.userId)) || publicUsers.get(String(c.userId)) }))
      .filter(row => row.u && freshUser(row.u, featured, now));
    if (comments.length) {
      const { c, u } = comments[0];
      return makePerson('quote', 'Голос сообщества', u, 'comments:week', {
        quote: c.content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').slice(0, 240),
        period: 'Комментарий за последние 7 дней', commentId: c._id,
      });
    }
    const user = eligible('comments:week').find(u => u.commentsCount > 0);
    if (user) return makePerson('voice', 'Голос сообщества', user, 'comments:week');
  }
  if (weekday === 5) {
    const key = `${category}:week`;
    const users = (boards[key] || []).slice(0, 3);
    if (users.length === 3 && users.every(u => u[METRICS[category].key] > 0 && freshUser(u, featured, now))) {
      return { ...makePerson('podium', 'Тройка недели', users[0], key), users };
    }
  }
  if (weekday === 6) {
    const previous = [...history].reverse().find(s => s.date < date && now - new Date(s.at) <= 2 * DAY);
    if (previous) {
      for (const [key, thresholds] of [['chaptersRead:all', [100, 500, 1000, 2500, 5000, 10000]], ['streak:all', [7, 30, 60, 100, 365]]]) {
        const metric = METRICS[key.split(':')[0]];
        const values = new Map((previous.boards[key] || []).map(u => [userId(u), Number(u[metric.key])]));
        for (const u of eligible(key)) {
          const before = values.get(userId(u));
          const crossed = thresholds.filter(n => before != null && before < n && Number(u[metric.key]) >= n).pop();
          if (crossed) return makePerson('milestone', 'Новый рубеж', u, key, { value: crossed, period: 'Достижение между ежедневными снимками' });
        }
      }
    }
  }
  if (weekday === 0 && categories.every(c => boards[`${c}:week`]?.length)) {
    const stats = categories.map(c => ({ label: METRICS[c].label, value: boards[`${c}:week`].reduce((sum, u) => sum + Number(u[METRICS[c].key] || 0), 0) }));
    const users = categories.map(c => eligible(`${c}:week`).find(u => u[METRICS[c].key] > 0)).filter(Boolean)
      .filter((u, i, all) => all.findIndex(other => userId(other) === userId(u)) === i).slice(0, 3);
    return { kind: 'summary', title: 'Неделя в цифрах', date, accent: '#e6ba64', users, stats,
      period: 'Последние 7 дней', metric: 'Участники публичных рейтингов',
      note: 'Сумма результатов до 100 участников каждой категории. Не общая статистика сайта.' };
  }
  // No fabricated nomination: a factual metric spotlight replaces an unavailable event.
  const rotation = (weeklyIndex + weekday) % 3;
  for (const c of [...categories.slice(rotation), ...categories.slice(0, rotation), 'streak', 'likesReceived']) {
    const key = `${c}:${['streak', 'likesReceived'].includes(c) ? 'all' : 'week'}`;
    const u = eligible(key).find(row => row[METRICS[c].key] > 0);
    if (u) return makePerson('spotlight', { chaptersRead: 'Герой чтения', comments: 'Голос сообщества', ratings: 'Вкус сообщества', streak: 'Без пропусков', likesReceived: 'Заметный участник' }[c], u, key);
  }
  return null;
}

function storyCaption(story) {
  const lines = [`<b>${esc(story.title)} · TOMILO LIB</b>`, '', esc(story.period)];
  if (story.kind === 'vote') {
    lines.push('', ...story.items.map(s => `${esc(String(s.name).slice(0, 40))} · ${num(s.votesCount)} голосов`), '', 'Выберите декорацию или карточку на сайте. Голоса Telegram и MAX учитываются вместе.');
  } else if (story.kind === 'summary') {
    lines.push('', ...story.stats.map(s => `${esc(s.label)}: ${num(s.value)}`), '', esc(story.note));
  } else if (story.kind === 'podium') {
    lines.push('', esc(story.metric), ...story.users.map(u => `№${u.rank} ${esc(String(u.username).slice(0, 30))} · ${num(u[METRICS[story.category.split(':')[0]].key])} ${esc(story.unit)}`));
  } else {
    lines.push('', `<b>${esc(String(story.users[0].username).slice(0, 30))}</b>`,
      story.kind === 'rise' ? `№${story.fromRank} → №${story.toRank} · +${num(story.value)} позиций` : `${num(story.value)} ${esc(story.unit)}`, esc(story.metric));
    if (story.quote) lines.push('', `«${esc(story.quote.slice(0, 100))}${story.quote.length > 100 ? '…' : ''}»`);
  }
  return lines.join('\n');
}

async function runChronicle({ state, config, now = new Date(), save, fetcher = fetch, render, deliver, logger = console }) {
  if (!config.notifyDailyChronicle) return false;
  const clock = moscowClock(now);
  const chronicle = state.communityChronicle ||= { history: [], featured: {}, post: null };
  chronicle.history ||= []; chronicle.featured ||= {};
  if (clock.time < config.chronicleTime || chronicle.post?.date === clock.date && chronicle.post.complete) return false;
  const data = await fetchChronicleData(config, clock.weekday, fetcher);
  if (data.errors.length) logger.warn('Chronicle API:', data.errors.join('; '));
  if (!chronicle.post || chronicle.post.date !== clock.date) {
    const story = selectStory(data, chronicle.history, chronicle.featured, now);
    // Store only the numeric comparison data, never private profile payloads or avatar bytes.
    const boards = Object.fromEntries(Object.entries(data.boards).map(([key, users]) => [key, users.map(u => ({
      _id: userId(u), rank: u.rank, [METRICS[key.split(':')[0]].key]: u[METRICS[key.split(':')[0]].key],
    }))]));
    chronicle.history = [...chronicle.history.filter(s => s.date !== clock.date), { date: clock.date, at: now.toISOString(), boards }].slice(-15);
    chronicle.featured = Object.fromEntries(Object.entries(chronicle.featured).filter(([, d]) => now - new Date(`${d}T00:00:00+03:00`) < 30 * DAY));
    if (!story) { save(); logger.warn('Chronicle skipped: no eligible public activity'); return false; }
    // Persist only the fields actually shown on the card.
    story.users = story.users.map(u => Object.fromEntries(['_id', 'id', 'username', 'rank', 'avatar', 'avatarDecoration',
      'avatarFrame', 'equippedDecorations', 'subscriptionExpiresAt', 'isPremium', 'chaptersRead', 'commentsCount',
      'ratingsCount', 'currentStreak', 'likesReceivedCount'].filter(k => u[k] !== undefined).map(k => [k, u[k]])));
    chronicle.post = { date: clock.date, story, deliveries: {}, complete: false };
    save();
  }
  const post = chronicle.post;
  // If a profile leaves the public response, do not replay its stored data after restart.
  const publicIds = new Set(Object.values(data.boards).flat().map(userId));
  if (post.story.users.some(u => !publicIds.has(userId(u)))) {
    logger.warn('Chronicle waits: selected users unavailable in public leaderboard');
    return false;
  }
  const channels = [config.telegramEnabled && 'telegram', config.maxEnabled && 'max'].filter(Boolean);
  if (!channels.length) return false;
  if (post.story.kind === 'vote') {
    const pending = new Set(data.suggestions.map(s => s.id));
    post.story.items = post.story.items.filter(s => pending.has(s.id));
    if (!post.story.items.length) {
      logger.warn('Chronicle waits: selected suggestions are no longer pending');
      return false;
    }
  }
  const image = await render(post.story);
  save(); // Renderer may remove suggestions whose artwork could not be loaded.
  const text = storyCaption(post.story);
  const buttons = post.story.kind === 'vote'
    ? [{ text: 'Проголосовать в магазине', url: `${config.siteUrl}/tomilo-shop?tab=suggestions` }]
    : [{ text: 'Открыть рейтинг', url: `${config.siteUrl}/leaderboard` },
      ...(post.story.users.length === 1 ? [{ text: 'Профиль участника', url: `${config.siteUrl}/user/${encodeURIComponent(post.story.users[0].username)}` }] : [])];
  for (const channel of channels) {
    if (post.deliveries[channel]) continue;
    try {
      const receipt = await deliver(channel, { image, text, buttons, story: post.story });
      if (!receipt) throw new Error('Delivery did not return a message receipt');
      post.deliveries[channel] = receipt;
      for (const u of post.story.users) chronicle.featured[userId(u)] = clock.date;
      save();
    } catch (e) { logger.error(`Chronicle ${channel}:`, e.message); }
  }
  post.complete = channels.every(c => Boolean(post.deliveries[c]));
  save();
  return post.complete;
}

module.exports = { METRICS, moscowClock, fetchChronicleData, selectStory, storyCaption, runChronicle };
