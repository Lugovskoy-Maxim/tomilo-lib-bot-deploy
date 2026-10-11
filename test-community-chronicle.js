const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { moscowClock, selectStory, storyCaption, runChronicle, fetchChronicleData, resultLabel } = require('./community-chronicle');
const { saveState, loadState } = require('./state');

const makeUser = (id, fields = {}) => ({ _id: id, username: `Читатель ${id}`, rank: 1,
  chaptersRead: 110, commentsCount: 45, ratingsCount: 12, currentStreak: 7, likesReceivedCount: 15, ...fields });
function fixture() {
  return { boards: Object.fromEntries(['chaptersRead:week', 'comments:week', 'ratings:week', 'chaptersRead:all', 'streak:all', 'likesReceived:all']
    .map((key, k) => [key, [0, 1, 2].map(i => makeUser(`${k}-${i}`, { rank: i + 1 }))])),
    suggestions: [{ id: 's', name: 'Рамка', type: 'frame', status: 'pending', imageUrl: 'https://example.com/a.png', votesCount: 10 }], comments: [], errors: [] };
}
const dates = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
const at = date => new Date(`${date}T12:00:00+03:00`);

test('Moscow calendar and noon schedule are independent of host timezone', () => {
  assert.deepEqual(moscowClock(new Date('2026-10-11T21:05:00Z')), { date: '2026-10-12', time: '00:05', weekday: 1 });
  assert.equal(moscowClock(new Date('2026-10-12T09:00:00Z')).time, '12:00');
});

test('all seven weekday stories use factual data and accurate periods', () => {
  const data = fixture();
  data.boards['chaptersRead:week'][0].rankChange = { week: 6 };
  const history = [{ date: '2026-10-12', at: at('2026-10-12').toISOString(), boards: {
    'chaptersRead:all': [makeUser('3-0', { chaptersRead: 90 })],
  }}];
  assert.equal(selectStory(data, [], {}, at(dates[0])).kind, 'rise');
  const reader = selectStory(data, history, {}, at(dates[1]));
  assert.equal(reader.kind, 'reader'); assert.equal(reader.value, 20);
  assert.equal(selectStory(data, [], {}, at(dates[2])).kind, 'vote');
  assert.equal(selectStory(data, [], {}, at(dates[3])).kind, 'voice');
  assert.equal(selectStory(data, [], {}, at(dates[4])).kind, 'podium');
  history[0].date = '2026-10-16'; history[0].at = at('2026-10-16').toISOString();
  assert.equal(selectStory(data, history, {}, at(dates[5])).kind, 'milestone');
  const summary = selectStory(data, [], {}, at(dates[6]));
  assert.equal(summary.kind, 'summary'); assert.match(storyCaption(summary), /Итоги недельных топов/);
});

test('no invented day delta, rank rise or first achievement when history is missing', () => {
  for (const date of [dates[0], dates[1], dates[5]]) assert.equal(selectStory(fixture(), [], {}, at(date)).kind, 'spotlight');
});

test('weekly cooldown applies across categories; true podium does not silently become places 4-6', () => {
  const data = fixture();
  const featured = Object.fromEntries(Object.values(data.boards).flat().map(u => [u._id, '2026-10-15']));
  assert.equal(selectStory(data, [], featured, at(dates[4])), null);
  featured['0-1'] = '2026-10-01';
  const story = selectStory(data, [], featured, at(dates[4]));
  assert.equal(story.kind, 'spotlight'); assert.equal(story.users[0].rank, 2);
});

test('quotes exclude spoilers, hidden comments, unapproved text and nonpublic authors', () => {
  const data = fixture();
  const comment = { content: 'Очень интересный комментарий о прочитанной истории', userId: { _id: '1-0' },
    createdAt: at('2026-10-14').toISOString(), moderationStatus: 'approved', isVisible: true };
  data.comments = [{ ...comment, isSpoiler: true }, { ...comment, hiddenBySystem: true }, { ...comment, moderationStatus: 'unchecked' }];
  assert.equal(selectStory(data, [], {}, at(dates[3])).kind, 'voice');
  data.comments.push(comment);
  assert.equal(selectStory(data, [], {}, at(dates[3])).kind, 'quote');
});

function fakeApi(data) {
  return async source => {
    const url = new URL(source);
    if (url.pathname.endsWith('/shop/suggestions')) return Response.json({ success: true, data: data.suggestions });
    if (url.pathname.endsWith('/comments')) return Response.json({ success: true, data: { comments: data.comments } });
    const key = `${url.searchParams.get('category')}:${url.searchParams.get('period')}`;
    return Response.json({ success: true, data: { users: data.boards[key] || [] } });
  };
}

test('partial delivery persists across restart and retries only failed channel', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-'));
  const statePath = path.join(directory, 'state.json');
  try {
    let state = loadState(statePath), calls = [], failMax = true;
    const config = { notifyDailyChronicle: true, chronicleTime: '12:00', apiUrl: 'https://example.com/api', siteUrl: 'https://example.com', telegramEnabled: true, maxEnabled: true };
    const args = () => ({ state, config, now: at(dates[0]), fetcher: fakeApi(fixture()),
      save: () => saveState(statePath, state), render: async () => Buffer.from('poster'),
      deliver: async (channel) => { calls.push(channel); if (channel === 'max' && failMax) throw new Error('Unavailable'); return { messageId: channel }; },
      logger: { warn() {}, error() {} } });
    assert.equal(await runChronicle(args()), false);
    state = loadState(statePath); failMax = false;
    assert.equal(await runChronicle(args()), true);
    assert.deepEqual(calls, ['telegram', 'max', 'max']);
    assert.equal(await runChronicle(args()), false);
    assert.equal(loadState(statePath).communityChronicle.history.length, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('before noon and when disabled no API calls or publications occur', async () => {
  let called = false;
  const config = { notifyDailyChronicle: true, chronicleTime: '12:00' };
  const args = { state: {}, config, now: new Date('2026-10-12T08:59:00Z'), fetcher: () => { called = true; } };
  assert.equal(await runChronicle(args), false);
  config.notifyDailyChronicle = false; args.now = at(dates[0]);
  assert.equal(await runChronicle(args), false); assert.equal(called, false);
});

test('HTTP 200 with success=false is an API failure, not an empty ranking', async () => {
  const data = await fetchChronicleData({ apiUrl: 'https://example.com/api' }, 1,
    async () => Response.json({ success: false, data: { users: [makeUser('bad')] } }));
  assert.equal(Object.keys(data.boards).length, 0); assert.equal(data.errors.length, 6);
});

test('names and quotes are HTML escaped in captions', () => {
  const story = selectStory(fixture(), [], {}, at(dates[1]));
  story.users[0].username = '<b>&bad';
  assert.match(storyCaption(story), /&lt;b&gt;&amp;bad/);
});

test('selected profile disappearing after partial delivery is not replayed from stored data', async () => {
  const config = { notifyDailyChronicle: true, chronicleTime: '12:00', apiUrl: 'https://example.com/api', siteUrl: 'https://example.com', telegramEnabled: true, maxEnabled: true };
  const state = {}, data = fixture(); let deliveries = 0;
  const args = { state, config, now: at(dates[0]), fetcher: fakeApi(data), save() {},
    render: async () => Buffer.from('poster'), deliver: async channel => { deliveries++; if (channel === 'max') throw new Error('Unavailable'); return { messageId: 'ok' }; },
    logger: { warn() {}, error() {} } };
  await runChronicle(args);
  const hiddenId = state.communityChronicle.post.story.users[0]._id;
  for (const key of Object.keys(data.boards)) data.boards[key] = data.boards[key].filter(u => u._id !== hiddenId);
  await runChronicle(args); assert.equal(deliveries, 2);
});

test('private statistics are filtered even if an older API includes them', async () => {
  const data = fixture(); data.boards['chaptersRead:week'][0].showStats = false;
  const result = await fetchChronicleData({ apiUrl: 'https://example.com/api' }, 1, fakeApi(data));
  assert.equal(result.boards['chaptersRead:week'][0].rank, 2);
});

test('Russian counters agree with their numbers', () => {
  assert.equal(resultLabel(1, 'chaptersRead:week'), '1 глава');
  assert.equal(resultLabel(42, 'chaptersRead:all'), '42 главы');
  assert.equal(resultLabel(11, 'comments:week'), '11 комментариев');
  assert.equal(resultLabel(21, 'ratings:week'), '21 оценка');
  assert.equal(resultLabel(30, 'streak:all'), '30 дней подряд');
});
