/** Личный кабинет Telegram. Канальные публикации остаются в index.js. */
const COMMANDS = [
  { command: 'start', description: 'Начать работу' },
  { command: 'link', description: 'Привязать профиль' },
  { command: 'profile', description: 'Информация о профиле' },
  { command: 'notifications', description: 'Уведомления и звук' },
];
const LINK_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/i;
function profileText(info) {
  if (!info.linked) return '👤 Профиль не привязан.\n\nПолучите код на сайте: Профиль → Настройки → Telegram. Отправьте /link КОД или откройте ссылку привязки.';
  return ['👤 Профиль', '', `Имя: ${info.username || '—'}`,
    `Уровень: ${info.level ?? '—'}`, `Монеты активности: ${info.balance ?? '—'}`,
    `Премиум: ${info.isPremium ? 'активен' : 'не активен'}`, '',
    `🔔 Новые главы в закладках: ${info.notificationsEnabled !== false ? 'включены' : 'выключены'}`,
    `🔊 Звук: ${info.soundEnabled !== false ? 'включён' : 'выключен'}`].join('\n');
}
function profileKeyboard(info, siteUrl) {
  const rows = [];
  if (info.linked) {
    rows.push([{ text: info.notificationsEnabled !== false ? '🔕 Выключить уведомления' : '🔔 Включить уведомления', callback_data: `profile:enabled:${info.notificationsEnabled !== false ? 0 : 1}` }]);
    rows.push([{ text: info.soundEnabled !== false ? '🔇 Выключить звук' : '🔊 Включить звук', callback_data: `profile:sound:${info.soundEnabled !== false ? 0 : 1}` }]);
  }
  rows.push([{ text: info.linked ? 'Профиль на сайте' : 'Привязать профиль', url: `${siteUrl}/profile?tab=settings&section=telegram` }]);
  return { inline_keyboard: rows };
}
function setupProfileBot(bot, { apiFetch, config, waitForMessageSlot = async () => {} }) {
  const unwrap = json => json.data ?? json;
  const send = async (chatId, text, options = {}) => {
    await waitForMessageSlot();
    return bot.sendMessage(chatId, text, options);
  };
  const show = async (chatId, info) => send(chatId, profileText(info), { reply_markup: profileKeyboard(info, config.siteUrl) });
  const get = async id => unwrap(await apiFetch(`/telegram/bot/user/${id}`));
  const privateChat = (msg, from) => msg?.chat?.type === 'private' && msg.chat.id === from?.id;
  const fail = async (chatId, error) => {
    console.warn('[PROFILE] Request failed:', error.status || error.code || 'unknown');
    await send(chatId, [400, 409].includes(error.status) && error.apiMessage
      ? String(error.apiMessage)
      : 'Не удалось выполнить действие. Попробуйте позже.').catch(() => {});
  };
  async function onMessage(msg) {
    if (!privateChat(msg, msg.from) || typeof msg.text !== 'string') return;
    try {
      const command = msg.text.trim().match(/^\/(start|link|profile|notifications|status|help)(?:@\w+)?(?:\s+(.*))?$/i);
      const name = command?.[1].toLowerCase();
      const argument = command?.[2]?.trim() || '';
      const plainCode = !command && LINK_CODE_RE.test(msg.text.trim()) ? msg.text.trim() : '';
      const code = name === 'link'
        ? argument
        : name === 'start' && argument.toLowerCase().startsWith('link_')
          ? argument.slice(5)
          : plainCode;
      if (code) {
        await apiFetch('/telegram/bot/link', { method: 'POST', body: JSON.stringify({ code: code.toUpperCase(), telegramUserId: msg.from.id, chatId: msg.chat.id, username: msg.from.username }) });
        await send(msg.chat.id, '✅ Профиль привязан. Здесь будут приходить персональные уведомления о новых главах в закладках.', { reply_markup: { keyboard: [['👤 Профиль', '🔔 Уведомления']], resize_keyboard: true } });
      } else if (name === 'link') {
        return show(msg.chat.id, { linked: false });
      } else if (name === 'start' || name === 'help') {
        await send(msg.chat.id, 'Tomilo Lib\n\nЧтобы привязать аккаунт, отправьте сюда 8-значный код с сайта или команду /link КОД.\n\n/profile — профиль\n/notifications — уведомления и звук', { reply_markup: { keyboard: [['👤 Профиль', '🔔 Уведомления']], resize_keyboard: true } });
      } else if (!command) {
        return send(msg.chat.id, 'Отправьте 8-значный код привязки из профиля на сайте или откройте /profile.');
      }
      await show(msg.chat.id, await get(msg.from.id));
    } catch (error) { await fail(msg.chat.id, error); }
  }
  async function onCallback(query) {
    if (!privateChat(query.message, query.from)) {
      await bot.answerCallbackQuery(query.id, { text: 'Откройте личный чат с ботом.' }).catch(() => {});
      return;
    }
    try {
      const match = query.data?.match(/^profile:(enabled|sound):([01])$/);
      await bot.answerCallbackQuery(query.id, match ? {} : { text: 'Меню устарело. Откройте /profile.' });
      if (!match) return;
      const settings = match[1] === 'enabled' ? { enabled: match[2] === '1' } : { soundEnabled: match[2] === '1' };
      const info = unwrap(await apiFetch('/telegram/bot/notifications', { method: 'POST', body: JSON.stringify({ telegramUserId: query.from.id, ...settings }) }));
      try {
        await bot.editMessageText(profileText(info), { chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: profileKeyboard(info, config.siteUrl) });
      } catch (error) {
        if (!String(error.message).includes('message is not modified')) throw error;
      }
    } catch (error) { await fail(query.message.chat.id, error); }
  }
  bot.on('message', onMessage);
  bot.on('callback_query', onCallback);
  return { onMessage, onCallback };
}
module.exports = { setupProfileBot, profileText, profileKeyboard, COMMANDS };
