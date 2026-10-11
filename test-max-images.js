const test = require('node:test');
const assert = require('node:assert/strict');
process.env.MAX_ENABLED = 'true';
process.env.MAX_BOT_TOKEN = 'test-token';
process.env.MAX_CHAT_ID = '123';
process.env.TELEGRAM_ENABLED = 'false';
process.env.MESSAGE_COOLDOWN_MS = '0';
const { sendOrEditMaxMessage } = require('./max');

test('MAX uploads PNG, sends token with keyboard, and reads actual message.body.mid receipt', async t => {
  const calls = []; let storedToken;
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('/uploads?')) return Response.json({ url: 'https://iu.oneme.ru/uploadImage?test=1' });
    if (String(url).includes('uploadImage')) {
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get('data').type, 'image/png');
      return Response.json({ photos: { photoId: { token: 'image-token' } } });
    }
    const body = JSON.parse(options.body);
    assert.equal(body.attachments[0].payload.token, 'image-token');
    assert.equal(body.attachments[1].type, 'inline_keyboard');
    return Response.json({ message: { body: { mid: 'mid.123' } } });
  });
  const result = await sendOrEditMaxMessage({ text: 'Хроника', image: Buffer.from('png'), buttons: [{ text: 'Рейтинг', url: 'https://example.com' }],
    onImageUploaded: token => { storedToken = token; } });
  assert.equal(result.messageId, 'mid.123'); assert.equal(storedToken, 'image-token'); assert.equal(calls.length, 3);
});

test('saved MAX image token is reused after failed publication', async t => {
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.ok(String(url).includes('/messages?'));
    assert.equal(JSON.parse(options.body).attachments[0].payload.token, 'saved');
    return Response.json({ message: { body: { mid: 'mid.retry' } } });
  });
  assert.equal((await sendOrEditMaxMessage({ text: 'Хроника', imageToken: 'saved' })).messageId, 'mid.retry');
});

test('MAX upload failure propagates without silently sending text-only', async t => {
  t.mock.method(global, 'fetch', async () => Response.json({ url: 'https://unexpected.example/upload' }));
  await assert.rejects(sendOrEditMaxMessage({ text: 'Хроника', image: Buffer.from('png') }), /unexpected upload host/);
});
