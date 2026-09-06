process.env.TELEGRAM_ENABLED = 'true';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_ID = '-100123';
process.env.MESSAGE_COOLDOWN_MS = '500';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendPersonalNotification } = require('./personal-notifications');
for (const soundEnabled of [true, false]) {
  test(`text honours sound=${soundEnabled}`, async () => {
    let options;
    await sendPersonalNotification({ sendMessage: async (_, __, opts) => { options = opts; } }, { chatId: 42, soundEnabled });
    assert.equal(options.disable_notification, !soundEnabled);
  });
}
test('photo includes chapter caption and respects muted setting', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(3) });
  let options;
  try {
    await sendPersonalNotification({ sendPhoto: async (_, __, opts) => { options = opts; } }, { chatId: 42, soundEnabled: false, titleName: '<Title>', chapterNumber: 5, coverImage: 'https://example.com/cover.jpg' });
    assert.match(options.caption, /&lt;Title&gt;/);
    assert.match(options.caption, /Глава 5/);
    assert.equal(options.disable_notification, true);
  } finally { global.fetch = original; }
});
test('personal delivery rejects group chat', async () => {
  assert.equal(await sendPersonalNotification({}, { chatId: -100123 }), false);
});
