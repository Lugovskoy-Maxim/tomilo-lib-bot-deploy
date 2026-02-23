const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { loadState, saveState } = require('./state');

const bot = new TelegramBot(config.telegramBotToken, { polling: false });

function formatChapterMessage(chapter, titleName) {
  const title = titleName || 'Без названия';
  const num = chapter.chapterNumber;
  const name = chapter.name ? ` — ${chapter.name}` : '';
  const date = chapter.releaseDate
    ? new Date(chapter.releaseDate).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';
  return `📖 <b>${escapeHtml(title)}</b>\nГлава ${num}${escapeHtml(name)}\n${date ? date + '\n' : ''}`;
}

function siteButton(siteUrl, titleSlug) {
  const url = `${siteUrl}/titles/${titleSlug || ''}`;
  return { reply_markup: { inline_keyboard: [[{ text: 'Читать на сайте', url }]] } };
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getImageUrl(title, chapter) {
  const path =
    (title && title.coverImage) ||
    (chapter.pages && chapter.pages[0]) ||
    '';
  if (!path || typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  const base = config.siteUrl.replace(/\/$/, '');
  return trimmed.startsWith('/') ? base + trimmed : base + '/' + trimmed;
}

async function fetchLatestChapters() {
  const url = `${config.apiUrl}/chapters?page=1&limit=20&sortBy=releaseDate&sortOrder=desc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.success || !json.data || !Array.isArray(json.data.chapters)) {
    throw new Error('Invalid API response');
  }
  return json.data.chapters;
}

async function run() {
  const state = loadState(config.statePath);
  let lastProcessed = state.lastProcessedReleaseDate
    ? new Date(state.lastProcessedReleaseDate).getTime()
    : null;

  const chapters = await fetchLatestChapters();
  const toPost = [];
  let maxSeen = lastProcessed;

  for (const ch of chapters) {
    const title = ch.titleId || {};
    const titleName = title.name || 'Без названия';
    const titleSlug = title.slug || '';
    const releaseTime = ch.releaseDate ? new Date(ch.releaseDate).getTime() : 0;
    if (releaseTime > 0) maxSeen = Math.max(maxSeen || 0, releaseTime);
    if (lastProcessed != null && releaseTime <= lastProcessed) continue;
    toPost.push({ chapter: ch, titleName, titleSlug, title: ch.titleId || {} });
  }

  // Newest first in API, so post in reverse so oldest new chapter is first in Telegram
  toPost.reverse();

  for (const { chapter, titleName, titleSlug, title } of toPost) {
    const text = formatChapterMessage(chapter, titleName, titleSlug);
    const imageUrl = getImageUrl(title, chapter);
    const opts = { parse_mode: 'HTML', ...siteButton(config.siteUrl, titleSlug) };
    try {
      if (imageUrl) {
        await bot.sendPhoto(config.telegramChatId, imageUrl, {
          caption: text,
          ...opts,
        });
      } else {
        await bot.sendMessage(config.telegramChatId, text, {
          disable_web_page_preview: true,
          ...opts,
        });
      }
      console.log(`Posted: ${titleName} ch.${chapter.chapterNumber}`);
    } catch (e) {
      const errMsg = (e && typeof e === 'object' && 'message' in e) ? String(e.message) : '';
      if (imageUrl && (errMsg.includes('wrong file') || errMsg.includes('failed to get'))) {
        try {
          await bot.sendMessage(config.telegramChatId, text, {
            disable_web_page_preview: true,
            ...opts,
          });
          console.log(`Posted (no photo): ${titleName} ch.${chapter.chapterNumber}`);
        } catch (e2) {
          console.error('Telegram send error:', e2.message);
        }
      } else {
        console.error('Telegram send error:', e.message);
      }
    }
  }

  if (maxSeen > 0) {
    saveState(config.statePath, {
      lastProcessedReleaseDate: new Date(maxSeen).toISOString(),
    });
  }
}

async function loop() {
  console.log('Checking for new chapters...');
  try {
    await run();
  } catch (e) {
    console.error('Run error:', e.message);
  }
  setTimeout(loop, config.pollIntervalMs);
}

async function checkChat() {
  try {
    await bot.getChat(config.telegramChatId);
    console.log('Chat OK:', config.telegramChatId);
    return true;
  } catch (e) {
    console.error('\n  TELEGRAM_CHAT_ID недоступен (chat not found).');
    console.error('  Текущее значение:', config.telegramChatId);
    console.error('\n  Как получить правильный Chat ID:');
    console.error('  • Личный чат: напиши боту /start, затем открой в браузере:');
    console.error('    https://api.telegram.org/bot<ТВОЙ_ТОКЕН>/getUpdates');
    console.error('    В ответе найди "chat":{"id": ЧИСЛО} — это и есть TELEGRAM_CHAT_ID.');
    console.error('  • Канал: добавь бота в канал как админа, затем в getUpdates');
    console.error('    будет запись с "chat":{"id": -100...} — используй этот id.');
    console.error('  • Убедись, что в .env нет кавычек и пробелов: TELEGRAM_CHAT_ID=-1001234567890\n');
    return false;
  }
}

async function main() {
  console.log('Tomilo Lib Bot — new chapters notifier');
  console.log('API:', config.apiUrl, '| Site:', config.siteUrl, '| Poll:', config.pollIntervalMs / 1000, 's');
  if (!(await checkChat())) process.exit(1);
  loop();
}
main();
