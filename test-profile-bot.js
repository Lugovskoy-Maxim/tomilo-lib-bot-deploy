const test = require('node:test');
const assert = require('node:assert/strict');
const { setupProfileBot, profileKeyboard, profileText } = require('./profile-bot');
function fixture() {
  const calls = [];
  const bot = { on() {}, sendMessage: async (...args) => calls.push(['send', ...args]), answerCallbackQuery: async (...args) => calls.push(['answer', ...args]), editMessageText: async (...args) => calls.push(['edit', ...args]) };
  const handlers = setupProfileBot(bot, { config: { siteUrl: 'https://tomilo-lib.ru' }, apiFetch: async (path, options) => { calls.push(['api', path, options && JSON.parse(options.body)]); return { data: { linked: true, username: '<reader>_*', notificationsEnabled: false, soundEnabled: true } }; } });
  return { calls, ...handlers };
}
const message = text => ({ text, chat: { type: 'private', id: 42 }, from: { id: 42, username: 'reader' } });
test('links profile by deep link with sender identity', async () => {
  const f = fixture(); await f.onMessage(message('/start link_abcdefgh'));
  assert.deepEqual(f.calls[0], ['api', '/telegram/bot/link', { code: 'ABCDEFGH', telegramUserId: 42, chatId: 42, username: 'reader' }]);
  assert.ok(f.calls.some(c => c[1] === '/telegram/bot/user/42'));
});
test('link command accepts bot username', async () => {
  const f = fixture(); await f.onMessage(message('/link@tomilo_bot ABCDEFGH'));
  assert.equal(f.calls[0][2].code, 'ABCDEFGH');
});
test('group updates cannot link or read profile', async () => {
  const f = fixture(); const msg = message('/link ABCDEFGH'); msg.chat = { type: 'group', id: -123 };
  await f.onMessage(msg); assert.equal(f.calls.length, 0);
});
for (const [field, expected] of [['enabled', { enabled: false }], ['sound', { soundEnabled: false }]]) {
  test(`saves explicit ${field} value for callback sender`, async () => {
    const f = fixture(); await f.onCallback({ id: 'query', from: { id: 42 }, message: { ...message(''), message_id: 7 }, data: `profile:${field}:0` });
    assert.deepEqual(f.calls.find(c => c[0] === 'api'), ['api', '/telegram/bot/notifications', { telegramUserId: 42, ...expected }]);
    assert.ok(f.calls.some(c => c[0] === 'edit'));
  });
}
test('foreign callback cannot change settings', async () => {
  const f = fixture(); await f.onCallback({ id: 'query', from: { id: 99 }, message: message(''), data: 'profile:enabled:0' });
  assert.ok(f.calls.every(c => c[0] !== 'api'));
});
test('unlinked profile has only link button and names are plain text', () => {
  assert.equal(profileKeyboard({ linked: false }, 'https://tomilo-lib.ru').inline_keyboard.length, 1);
  assert.match(profileText({ linked: true, username: '<reader>_*' }), /<reader>_\*/);
});
