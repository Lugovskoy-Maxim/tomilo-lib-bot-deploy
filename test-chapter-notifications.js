const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadState, saveState } = require('./state');
const { chapterDestinations, dailyChapterMessages, syncChapterMessages } = require('./chapter-notifications');
const destinations = chapterDestinations({ telegramChatId: '-1', telegramChaptersChatId: '-2', telegramChaptersThreadId: 44 });
function fixture() {
  const calls = [];
  const state = { titleMessages: {} };
  let id = 10;
  const args = { state, key: 'title', today: '2026-09-07', destinations,
    chapters: [{ chapterNumber: 1 }], photoPayload: Buffer.from('cover'), text: 'Chapter 1',
    opts: { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Read', url: 'https://tomilo-lib.ru' }]] } },
    waitForMessageSlot: async () => {}, persist: () => {},
    sendPhotoOrMessage: async (payload) => { calls.push(['send', payload]); return { message_id: ++id, photo: payload.photoPayload ? [{}] : undefined }; },
    bot: {
      editMessageMedia: async (media, opts) => { calls.push(['media', media, opts]); return { message_id: opts.message_id }; },
      editMessageCaption: async (text, opts) => { calls.push(['caption', text, opts]); return { message_id: opts.message_id }; },
      editMessageText: async (text, opts) => { calls.push(['text', text, opts]); return { message_id: opts.message_id }; },
      deleteMessage: async (...args) => calls.push(['delete', ...args]),
    },
  };
  return { args, calls, state };
}

test('same message, cover and buttons go to both chats; thread only in second', async () => {
  const { args, calls } = fixture();
  await syncChapterMessages(args);
  assert.equal(calls.length, 2);
  const [a, b] = calls.map((call) => call[1]);
  assert.equal(a.chatId, '-1'); assert.equal(b.chatId, '-2');
  assert.equal(a.text, b.text); assert.deepEqual(a.photoPayload, b.photoPayload);
  assert.deepEqual(a.opts.reply_markup, b.opts.reply_markup);
  assert.equal(a.opts.message_thread_id, undefined); assert.equal(b.opts.message_thread_id, 44);
});

test('later chapters edit the daily message in both chats without new posts', async () => {
  const { args, calls, state } = fixture();
  await syncChapterMessages(args); calls.length = 0;
  await syncChapterMessages({ ...args, text: 'Chapters 1–2', chapters: [{ chapterNumber: 1 }, { chapterNumber: 2 }] });
  assert.deepEqual(calls.map((call) => call[0]), ['media', 'media']);
  assert.deepEqual(calls.map((call) => call[2].message_id), [11, 12]);
  assert.equal(dailyChapterMessages(state, 'title', args.today, destinations).length, 2);
});

test('partial delivery survives restart and only retries the failed chat', async () => {
  const { args, calls, state } = fixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'title-delivery-'));
  try {
    const file = path.join(dir, 'state.json');
    const send = args.sendPhotoOrMessage;
    args.persist = () => saveState(file, state);
    await assert.rejects(syncChapterMessages({ ...args, sendPhotoOrMessage: async (payload) => {
      if (payload.chatId === '-2') throw new Error('timeout');
      return send(payload);
    } }), /timeout/);
    assert.equal(calls.length, 1);
    const restored = loadState(file);
    calls.length = 0;
    await syncChapterMessages({ ...args, state: restored, persist: () => {} });
    assert.equal(calls.length, 1); assert.equal(calls[0][1].chatId, '-2');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('old topic state is edited and primary chat receives a copy', async () => {
  const { args, calls, state } = fixture();
  state.titleMessages.title = { chatId: '-2', messageId: 9, date: args.today, hasPhoto: true, chapters: [{ chapterNumber: 1 }] };
  await syncChapterMessages(args);
  assert.deepEqual(calls.map((call) => call[0]), ['send', 'media']);
  assert.equal(calls[1][2].message_id, 9);
});

test('transient edit errors do not create duplicate posts', async () => {
  const { args, calls } = fixture();
  await syncChapterMessages(args); calls.length = 0;
  args.bot.editMessageMedia = async () => { throw new Error('429 retry later'); };
  await assert.rejects(syncChapterMessages({ ...args, text: 'Chapter 2' }), /429/);
  assert.equal(calls.length, 0);
});

test('not modified is successful; identical retries do nothing; next day posts again', async () => {
  const { args, calls } = fixture();
  await syncChapterMessages(args); calls.length = 0;
  await syncChapterMessages(args); assert.equal(calls.length, 0);
  args.bot.editMessageMedia = async () => { throw new Error('Bad Request: message is not modified'); };
  await syncChapterMessages({ ...args, text: 'Chapter 2' });
  assert.equal(calls.length, 0);
  await syncChapterMessages({ ...args, today: '2026-09-08' });
  assert.equal(calls.length, 2);
});

test('long captions use text in both chats and repeated updates stay text', async () => {
  const { args, calls } = fixture();
  args.text = 'a'.repeat(1100);
  await syncChapterMessages(args);
  assert.ok(calls.every((call) => call[1].photoPayload === null)); calls.length = 0;
  await syncChapterMessages({ ...args, text: 'b'.repeat(1100) });
  assert.deepEqual(calls.map((call) => call[0]), ['text', 'text']);
});

test('deduplicates identical destinations but keeps separate topics', () => {
  assert.equal(chapterDestinations({ telegramChatId: '-1', telegramChaptersChatId: '-1' }).length, 1);
  assert.equal(chapterDestinations({ telegramChatId: '-1', telegramChaptersChatId: '-1', telegramChaptersThreadId: 44 }).length, 2);
});
