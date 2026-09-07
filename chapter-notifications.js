const { createHash } = require('node:crypto');

function chapterDestinations(config) {
  const destinations = [
    { chatId: config.telegramChatId },
    { chatId: config.telegramChaptersChatId, threadId: config.telegramChaptersThreadId },
  ].filter((target) => target.chatId);
  return destinations.filter((target, index) => destinations.findIndex((other) =>
    String(other.chatId) === String(target.chatId) && other.threadId === target.threadId) === index);
}

function destinationKey(key, target) {
  return JSON.stringify([String(target.chatId), target.threadId || null, key]);
}

function dailyMessage(state, key, today, target) {
  const saved = state.telegramTitleMessages?.[destinationKey(key, target)];
  if (saved?.date === today) return saved;
  // Совместимость с сообщением в топике, сохранённым предыдущей версией.
  const legacy = state.titleMessages?.[key];
  if (!saved && target.threadId && legacy?.date === today &&
      String(legacy.chatId) === String(target.chatId)) return legacy;
  return null;
}

function dailyChapterMessages(state, key, today, destinations) {
  return destinations.map((target) => dailyMessage(state, key, today, target)).filter(Boolean);
}

function isNotModified(error) {
  return /message is not modified/i.test(error?.message || '');
}

function isMissingMessage(error) {
  return /message to edit not found/i.test(error?.message || '');
}

async function syncChapterMessages({ state, key, today, destinations, chapters,
  photoPayload, text, opts, bot, sendPhotoOrMessage, waitForMessageSlot, persist }) {
  state.telegramTitleMessages ||= {};
  // Одинаковый формат для обоих получателей, включая лимиты Telegram.
  const photo = photoPayload && text.length <= 1024 ? photoPayload : null;
  const fingerprint = createHash('sha256').update(text)
    .update(JSON.stringify(opts.reply_markup || {}))
    .update(photo || '').digest('hex');
  for (const target of destinations) {
    const storageKey = destinationKey(key, target);
    const existing = dailyMessage(state, key, today, target);
    if (existing?.fingerprint === fingerprint) continue;
    const { message_thread_id, ...commonOpts } = opts;
    const sendOpts = { ...commonOpts,
      ...(target.threadId ? { message_thread_id: target.threadId } : {}) };
    let result;
    let hasPhoto = !!photo;
    if (existing?.messageId) {
      const editOpts = { ...sendOpts, chat_id: target.chatId, message_id: existing.messageId };
      try {
        await waitForMessageSlot();
        if (photo) {
          result = await bot.editMessageMedia(
            { type: 'photo', media: photo, caption: text, parse_mode: commonOpts.parse_mode },
            editOpts, { filename: 'cover.jpg', contentType: 'image/jpeg' });
        } else if (existing.hasPhoto && text.length <= 1024) {
          result = await bot.editMessageCaption(text, editOpts);
          hasPhoto = true;
        } else if (!existing.hasPhoto) {
          result = await bot.editMessageText(text, { ...editOpts, disable_web_page_preview: true });
        } else {
          // Подпись больше лимита: заменяем фото текстовым сообщением.
          throw new Error('Photo must be replaced with text');
        }
        result ||= { message_id: existing.messageId };
      } catch (error) {
        if (isNotModified(error)) result = { message_id: existing.messageId };
        else if (!isMissingMessage(error) && error.message !== 'Photo must be replaced with text') throw error;
      }
    }
    if (!result) {
      result = await sendPhotoOrMessage({ photoPayload: photo, text, opts: sendOpts,
        chatId: target.chatId,
        fileOpts: Buffer.isBuffer(photo) ? { filename: 'cover.jpg', contentType: 'image/jpeg' } : undefined });
      if (!result?.message_id) throw new Error('No message_id returned');
      hasPhoto = Array.isArray(result.photo) && result.photo.length > 0;
      const previousId = existing?.messageId;
      state.telegramTitleMessages[storageKey] = {
        messageId: result.message_id, ...target, date: today, hasPhoto, chapters, fingerprint,
      };
      // Сохраняем доставку до следующего чата и необязательной очистки старого поста.
      persist();
      if (previousId && previousId !== result.message_id) {
        try { await bot.deleteMessage(target.chatId, previousId); }
        catch (error) { console.warn('Old title post cleanup failed:', error.message); }
      }
    } else {
      state.telegramTitleMessages[storageKey] = {
        messageId: result.message_id || existing.messageId, ...target, date: today, hasPhoto, chapters, fingerprint,
      };
      persist();
    }
  }
}

module.exports = { chapterDestinations, dailyChapterMessages, syncChapterMessages };
