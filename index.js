process.env.NTBA_FIX_350 = true; // убирает DeprecationWarning при отправке Buffer
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { loadState, saveState } = require('./state');

const bot = new TelegramBot(config.telegramBotToken, { polling: false });

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

// Telegram limits (practical): photo caption <= 1024 chars, message text <= 4096 chars.
const TG_MAX_CAPTION_LEN = 1024;
const TG_MAX_MESSAGE_LEN = 4096;

function clampText(s, maxLen) {
  if (!s) return '';
  const str = String(s);
  if (str.length <= maxLen) return str;
  return str.slice(0, Math.max(0, maxLen - 1)) + '…';
}

function stripHtmlTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '');
}

function looksLikeCaptionTooLongError(msg) {
  const m = String(msg || '').toLowerCase();
  return m.includes('caption is too long') || m.includes('message caption is too long');
}

async function sendMessageSafe(text, opts) {
  const raw = String(text || '');
  if (raw.length <= TG_MAX_MESSAGE_LEN) {
    return bot.sendMessage(config.telegramChatId, raw, {
      disable_web_page_preview: true,
      ...opts,
    });
  }

  // Если текст слишком длинный, лучше отправить как plain-text, чтобы не словить ошибки HTML entities.
  const plain = clampText(stripHtmlTags(raw), TG_MAX_MESSAGE_LEN);
  const { parse_mode, ...rest } = opts || {};
  if (DEBUG) console.log(`Message too long (${raw.length}), sending plain-text truncated`);
  return bot.sendMessage(config.telegramChatId, plain, {
    disable_web_page_preview: true,
    ...rest,
  });
}

async function sendPhotoOrMessage({ photoPayload, text, opts, fileOpts }) {
  const caption = String(text || '');
  const usePhoto = !!photoPayload && caption.length <= TG_MAX_CAPTION_LEN;

  if (!usePhoto) {
    if (photoPayload && caption.length > TG_MAX_CAPTION_LEN && DEBUG) {
      console.log(`Caption too long for sendPhoto (${caption.length}), sending text-only`);
    }
    return sendMessageSafe(caption, opts);
  }

  try {
    return await bot.sendPhoto(
      config.telegramChatId,
      photoPayload,
      { caption, ...opts },
      fileOpts,
    );
  } catch (e) {
    const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : '';
    if (looksLikeCaptionTooLongError(msg)) {
      if (DEBUG) console.log('sendPhoto failed: caption too long, retrying as text-only');
      return sendMessageSafe(caption, opts);
    }
    throw e;
  }
}

function formatChaptersLine(chapters) {
  if (!Array.isArray(chapters) || chapters.length === 0) return 'Главы —';
  const nums = chapters.map((ch) => ch.chapterNumber).sort((a, b) => a - b);
  const latest = chapters.reduce((acc, ch) => {
    const t = ch.releaseDate ? new Date(ch.releaseDate).getTime() : 0;
    const accT = acc.releaseDate ? new Date(acc.releaseDate).getTime() : 0;
    return t > accT ? ch : acc;
  }, chapters[0]);
  const dateStr = latest.releaseDate
    ? new Date(latest.releaseDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    : '';
  if (nums.length === 1) {
    const line = dateStr ? `Глава ${nums[0]} 💎 · ${dateStr}` : `Глава ${nums[0]} 💎`;
    return line;
  }
  const consecutive = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  const range = consecutive ? `Главы ${nums[0]}–${nums[nums.length - 1]}` : `Главы ${nums.join(', ')}`;
  const line = dateStr ? `${range} 💎 · ${dateStr}` : `${range} 💎`;
  return line;
}

/** Возрастное ограничение: 0–18 из схемы тайтла → "0+", "6+", "12+", "16+", "18+" */
function formatAgeLimit(ageLimit) {
  if (ageLimit === undefined || ageLimit === null) return '';
  const n = Number(ageLimit);
  if (Number.isNaN(n) || n < 0) return '';
  if (n >= 18) return '18+';
  if (n >= 16) return '16+';
  if (n >= 12) return '12+';
  if (n >= 6) return '6+';
  return '0+';
}

const STATUS_LABELS = {
  ongoing: 'Онгоинг',
  completed: 'Завершён',
  pause: 'Пауза',
  cancelled: 'Отменён',
};

const TYPE_LABELS = {
  manhwa: 'Манхва',
  manga: 'Манга',
  manhua: 'Маньхуа',
  webtoon: 'Вебтун',
  webcomic: 'Вебкомикс',
};

function translateType(type) {
  if (!type || typeof type !== 'string') return '';
  const key = String(type).trim().toLowerCase();
  return TYPE_LABELS[key] || escapeHtml(type);
}

function formatChapterMessage(chapters, titleName, titleInfo = {}) {
  const title = titleName || 'Без названия';
  const isPlural = (Array.isArray(chapters) ? chapters.length : 1) > 1;
  const header = isPlural ? '<b>✨ НОВЫЕ ГЛАВЫ ✨</b>' : '<b>✨ НОВАЯ ГЛАВА ✨</b>';
  const chapterLine = formatChaptersLine(Array.isArray(chapters) ? chapters : [chapters]);
  const ageStr = formatAgeLimit(titleInfo.ageLimit);
  const titleLine = ageStr ? `<b>${escapeHtml(title)}</b> (${ageStr})` : `<b>${escapeHtml(title)}</b>`;

  const typeStr = titleInfo.type ? translateType(titleInfo.type) : '';
  const yearStr = titleInfo.releaseYear != null && Number(titleInfo.releaseYear) >= 1900 ? String(Number(titleInfo.releaseYear)) : '';
  const statusStr = titleInfo.status && STATUS_LABELS[String(titleInfo.status).toLowerCase()];
  const metaParts = [typeStr, yearStr, statusStr].filter(Boolean);
  const metaLine = metaParts.length ? `<i>${metaParts.join(' · ')}</i>` : '';

  const genres = Array.isArray(titleInfo.genres) ? titleInfo.genres : [];
  const genreStr = genres.slice(0, 3).map((g) => escapeHtml(String(g).trim())).filter(Boolean).join(', ');

  const author = titleInfo.author && String(titleInfo.author).trim() ? `Автор: ${escapeHtml(String(titleInfo.author).trim())}` : '';
  const artist = titleInfo.artist && String(titleInfo.artist).trim() ? `Художник: ${escapeHtml(String(titleInfo.artist).trim())}` : '';

  const totalCh = titleInfo.totalChapters != null && Number(titleInfo.totalChapters) > 0 ? Number(titleInfo.totalChapters) : 0;
  const totalLine = totalCh ? `<i>Всего глав: ${totalCh}</i>` : '';

  const lines = [
    header,
    '',
    titleLine,
    chapterLine,
    '─────────────────',
    ...(metaLine ? [metaLine] : []),
    ...(genreStr ? [genreStr] : []),
    ...(author ? [author] : []),
    ...(artist ? [artist] : []),
    ...(totalLine ? [totalLine] : []),
    '',
    'Оставьте впечатления в комментариях 👇',
  ].filter((line) => line !== undefined && line !== null);
  return lines.join('\n');
}

function siteButton(siteUrl, titleSlug) {
  const url = `${siteUrl}/titles/${titleSlug || ''}`;
  return { reply_markup: { inline_keyboard: [[{ text: 'Читать ↗', url }]] } };
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Дата в формате YYYY-MM-DD (UTC) для сравнения "сегодня". */
function getTodayString() {
  return new Date().toISOString().slice(0, 10);
}

/** true, если дата создания тайтла совпадает с сегодняшним днём (UTC). */
function isTitleCreatedToday(createdAt) {
  if (!createdAt) return false;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === getTodayString();
}

/** Короткое описание (обрезаем по длине). */
const NEW_TITLE_DESCRIPTION_MAX_LEN = 280;

function formatNewTitleMessage(titleName, titleInfo = {}) {
  const name = titleName || 'Без названия';
  const ageStr = formatAgeLimit(titleInfo.ageLimit);
  const titleLine = ageStr ? `<b>${escapeHtml(name)}</b> (${ageStr})` : `<b>${escapeHtml(name)}</b>`;
  const typeStr = titleInfo.type ? translateType(titleInfo.type) : '';
  const yearStr = titleInfo.releaseYear != null && Number(titleInfo.releaseYear) >= 1900 ? String(Number(titleInfo.releaseYear)) : '';
  const metaParts = [typeStr, yearStr].filter(Boolean);
  const metaLine = metaParts.length ? `<i>${metaParts.join(' · ')}</i>` : '';
  const totalCh = titleInfo.totalChapters != null && Number(titleInfo.totalChapters) >= 0 ? Number(titleInfo.totalChapters) : null;
  const totalLine = totalCh != null ? `Глав: ${totalCh}` : '';
  let descLine = '';
  const rawDesc = titleInfo.description || titleInfo.shortDescription || '';
  if (rawDesc && typeof rawDesc === 'string') {
    const trimmed = rawDesc.trim();
    if (trimmed) {
      const short = trimmed.length > NEW_TITLE_DESCRIPTION_MAX_LEN
        ? trimmed.slice(0, NEW_TITLE_DESCRIPTION_MAX_LEN).trim() + '…'
        : trimmed;
      descLine = escapeHtml(short);
    }
  }
  const lines = [
    '<b>✨ Новый тайтл на сайте ✨</b>',
    '',
    titleLine,
    ...(metaLine ? [metaLine] : []),
    ...(totalLine ? [totalLine] : []),
    ...(descLine ? ['', descLine] : []),
    '',
    'Оставьте впечатления в комментариях 👇',
  ].filter(Boolean);
  return lines.join('\n');
}

/** Объединяет уже показанные главы с новыми, без дубликатов по chapterNumber. */
function mergeChapters(existing, newChapters) {
  const byNum = new Map(existing.map((c) => [c.chapterNumber, c]));
  for (const c of newChapters) {
    byNum.set(c.chapterNumber, { chapterNumber: c.chapterNumber, releaseDate: c.releaseDate });
  }
  return [...byNum.values()].sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));
}

function getImageUrl(title) {
  const raw = title && title.coverImage;
  if (!raw || typeof raw !== 'string') return null;
  const path = raw.trim();
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = config.imageBaseUrl.replace(/\/$/, '');
  return path.startsWith('/') ? base + path : base + '/' + path;
}

/** Скачиваем картинку сами и отдаём буфер — так Telegram не таймаутит по чужому URL. */
async function fetchImageBuffer(url, timeoutMs = 15000) {
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'TomiloLibBot/1.0' },
    });
    clearTimeout(to);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return Buffer.from(buf);
  } catch {
    return null;
  }
}

async function fetchLatestChapters() {
  const url = `${config.apiUrl}/chapters?page=1&limit=100&sortBy=releaseDate&sortOrder=desc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.success || !json.data || !Array.isArray(json.data.chapters)) {
    throw new Error('Invalid API response');
  }
  return json.data.chapters;
}

async function fetchLatestTitles() {
  const url = `${config.apiUrl}/titles?page=1&limit=100&sortBy=createdAt&sortOrder=desc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API titles ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.success || !json.data || !Array.isArray(json.data.titles)) {
    throw new Error('Invalid API response for titles');
  }
  return json.data.titles;
}

/** Подгружаем тайтл по slug — в списке глав не всегда есть coverImage. */
async function fetchTitleBySlug(slug) {
  if (!slug) return null;
  try {
    const url = `${config.apiUrl}/titles/slug/${encodeURIComponent(slug)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success || !json.data) return null;
    return json.data;
  } catch {
    return null;
  }
}

/** Лидерборд: топ тайтлов по рейтингу или просмотрам. Возвращает [{ slug, name, position, value }]. */
async function fetchLeaderboard(sortBy, limit) {
  const url = `${config.apiUrl}/titles?page=1&limit=${limit}&sortBy=${encodeURIComponent(sortBy)}&sortOrder=desc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API leaderboard ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.success || !json.data || !Array.isArray(json.data.titles)) return [];
  const list = [];
  const valueKey = sortBy === 'views' ? 'viewsCount' : 'rating';
  json.data.titles.forEach((t, i) => {
    const slug = t.slug || '';
    const name = t.name || 'Без названия';
    const value = t[valueKey] != null ? Number(t[valueKey]) : 0;
    list.push({ slug, name, position: i + 1, value });
  });
  return list;
}

/** Сообщение об изменениях в таблице лидеров (кто поднялся/опустился). */
function formatLeaderboardChangesMessage(changes, sortLabel) {
  const lines = ['<b>📊 Изменения в рейтинге</b>', ''];
  for (const c of changes) {
    const name = escapeHtml(c.name);
    if (c.prevPosition != null && c.newPosition != null) {
      if (c.newPosition < c.prevPosition) {
        lines.push(`🟢 ${name}: с ${c.prevPosition} на ${c.newPosition} место`);
      } else {
        lines.push(`🔴 ${name}: с ${c.prevPosition} на ${c.newPosition} место`);
      }
    } else if (c.prevPosition == null) {
      lines.push(`🆕 ${name}: ${c.newPosition} место (новый в топе)`);
    }
  }
  if (sortLabel) lines.push('', `<i>${escapeHtml(sortLabel)}</i>`);
  return lines.join('\n');
}

/** Сообщение о юбилейной главе (50, 100, 200...). */
function formatMilestoneChapterMessage(titleName, chapterNum, titleSlug) {
  const name = escapeHtml(titleName || 'Без названия');
  return [
    '<b>🎉 Юбилейная глава!</b>',
    '',
    `Тайтл <b>${name}</b> достиг ${chapterNum} глав.`,
    '',
    'Поздравляем автора и читателей 👏',
  ].join('\n');
}

async function run() {
  const state = loadState(config.statePath);
  let lastProcessed = state.lastProcessedReleaseDate
    ? new Date(state.lastProcessedReleaseDate).getTime()
    : null;
  let lastProcessedTitle = state.lastProcessedTitleCreatedAt
    ? new Date(state.lastProcessedTitleCreatedAt).getTime()
    : null;
  const initialLastProcessedStr =
    state.lastProcessedReleaseDate && typeof state.lastProcessedReleaseDate.toISOString === 'function'
      ? state.lastProcessedReleaseDate.toISOString()
      : state.lastProcessedReleaseDate
        ? String(state.lastProcessedReleaseDate)
        : null;
  const initialLastProcessedTitleStr =
    state.lastProcessedTitleCreatedAt && typeof state.lastProcessedTitleCreatedAt.toISOString === 'function'
      ? state.lastProcessedTitleCreatedAt.toISOString()
      : state.lastProcessedTitleCreatedAt
        ? String(state.lastProcessedTitleCreatedAt)
        : null;

  const today = getTodayString();
  if (!state.titleMessages) state.titleMessages = {};

  // ======== Обработка новых тайтлов (независимо от глав) ========
  let maxSeenTitle = lastProcessedTitle;
  let maxNotifiedTitle = lastProcessedTitle;
  if (config.notifyNewTitles) {
  try {
    const titles = await fetchLatestTitles();
    const newTitles = [];

    if (DEBUG) {
      console.log(`Fetched ${titles.length} titles, lastProcessedTitle: ${lastProcessedTitle ? new Date(lastProcessedTitle).toISOString() : 'null'}`);
    }

    for (const title of titles) {
      const createdTime = title.createdAt ? new Date(title.createdAt).getTime() : 0;
      if (createdTime > 0) maxSeenTitle = Math.max(maxSeenTitle || 0, createdTime);
      if (lastProcessedTitle != null && createdTime <= lastProcessedTitle) continue;
      // При первом запуске (lastProcessedTitle === null) оповещаем только тайтлы "созданы сегодня" (UTC), чтобы не слать старые.
      // При последующих — любой тайтл новее lastProcessedTitle считаем новым (часовой пояс/формат API не мешают).
      if (lastProcessedTitle == null && !isTitleCreatedToday(title.createdAt)) {
        if (DEBUG) console.log(`Skipping "${title.name}" - not created today (${title.createdAt})`);
        continue;
      }
      if (DEBUG) console.log(`New title candidate: "${title.name}" created at ${title.createdAt}`);
      newTitles.push(title);
    }

    newTitles.reverse();

    if (newTitles.length > 0) {
      console.log(`Found ${newTitles.length} new title(s) to notify`);
    }

    for (const title of newTitles) {
      const titleName = title.name || 'Без названия';
      const titleSlug = title.slug || '';
      const key = titleSlug || titleName;
      const createdTime = title.createdAt ? new Date(title.createdAt).getTime() : 0;

      const existing = state.titleMessages[key];
      if (existing && existing.date === today && existing.messageId) {
        if (DEBUG) console.log(`Skipping already notified title: ${titleName}`);
        continue;
      }

      const titleInfo = {
        ageLimit: title.ageLimit,
        releaseYear: title.releaseYear,
        type: title.type,
        status: title.status,
        genres: title.genres,
        author: title.author,
        artist: title.artist,
        totalChapters: title.totalChapters || 0,
        description: title.description,
        shortDescription: title.shortDescription,
      };

      const text = formatNewTitleMessage(titleName, titleInfo);
      const imageUrl = getImageUrl(title);
      let photoPayload = imageUrl;
      if (imageUrl) {
        const buf = await fetchImageBuffer(imageUrl);
        if (buf) photoPayload = buf;
      }

      const opts = { parse_mode: 'HTML', ...siteButton(config.siteUrl, titleSlug) };

      try {
        const result = await sendPhotoOrMessage({
          photoPayload,
          text,
          opts,
          fileOpts: Buffer.isBuffer(photoPayload) ? { filename: 'cover.jpg', contentType: 'image/jpeg' } : undefined,
        });
        const messageId = result && result.message_id;
        if (messageId) {
          state.titleMessages[key] = {
            messageId,
            chatId: config.telegramChatId,
            date: today,
            hasPhoto: !!photoPayload,
            isNewTitle: true,
            chapters: [],
          };
        }
        if (createdTime > 0) maxNotifiedTitle = Math.max(maxNotifiedTitle || 0, createdTime);
        console.log(`Posted (new title): ${titleName}`);
      } catch (e) {
        console.error('Telegram send error (new title):', e.message);
      }
    }
  } catch (e) {
    console.error('Fetch titles error:', e.message);
  }
  }

  // ======== Обработка новых глав ========
  const chapters = await fetchLatestChapters();
  const toPost = [];
  let maxSeen = lastProcessed;
  let maxNotified = lastProcessed;

  for (const ch of chapters) {
    const title = ch.titleId || {};
    const titleName = title.name || 'Без названия';
    const titleSlug = title.slug || '';
    const releaseTime = ch.releaseDate ? new Date(ch.releaseDate).getTime() : 0;
    if (releaseTime > 0) maxSeen = Math.max(maxSeen || 0, releaseTime);
    if (lastProcessed != null && releaseTime <= lastProcessed) continue;
    toPost.push({ chapter: ch, titleName, titleSlug, title: ch.titleId || {}, releaseTime });
  }

  // Newest first in API, then group by title so one message per title
  toPost.reverse();
  const byTitle = new Map();
  for (const item of toPost) {
    const key = item.titleSlug || item.titleName;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(item);
  }

  for (const [, items] of byTitle) {
    const first = items[0];
    const { titleName, titleSlug, title } = first;
    const key = titleSlug || titleName;
    const groupMaxReleaseTime = items.reduce((acc, it) => Math.max(acc, it.releaseTime || 0), 0);
    const newChapters = items.map((i) => ({
      chapterNumber: i.chapter.chapterNumber,
      releaseDate: i.chapter.releaseDate,
    }));
    const existing = state.titleMessages[key];

    let chaptersToShow;
    let isEdit = false;
    if (existing && existing.date === today && existing.messageId && existing.chapters) {
      chaptersToShow = mergeChapters(existing.chapters, newChapters);
      isEdit = true;
    } else {
      chaptersToShow = newChapters;
    }

    // Подгружаем тайтл по slug (coverImage и createdAt могут быть только в полном ответе)
    let titleForCover = title;
    if (titleSlug) {
      const full = await fetchTitleBySlug(titleSlug);
      if (full) titleForCover = full;
    }
    const t = titleForCover ?? title;
    const titleInfo = {
      ageLimit: t?.ageLimit,
      releaseYear: t?.releaseYear,
      type: t?.type,
      status: t?.status,
      genres: t?.genres,
      author: t?.author,
      artist: t?.artist,
      totalChapters: t?.totalChapters,
      description: t?.description,
      shortDescription: t?.shortDescription,
    };

    // Юбилейные главы (50, 100, 200…): оповещение один раз на порог
    if (config.notifyMilestoneChapters && config.milestoneChapters.length > 0) {
      const key = titleSlug || titleName;
      const notified = state.notifiedMilestones[key] || [];
      for (const ch of newChapters) {
        const num = ch.chapterNumber;
        if (config.milestoneChapters.includes(num) && !notified.includes(num)) {
          const text = formatMilestoneChapterMessage(titleName, num, titleSlug);
          try {
            await sendMessageSafe(text, { parse_mode: 'HTML', ...siteButton(config.siteUrl, titleSlug) });
            state.notifiedMilestones[key] = [...(state.notifiedMilestones[key] || []), num];
            console.log(`Posted (milestone): ${titleName} — ${num} глав`);
          } catch (e) {
            console.error('Milestone send error:', e.message);
          }
        }
      }
    }

    const isNewTitleToday = isTitleCreatedToday(t?.createdAt);
    if (isNewTitleToday) {
      const opts = { parse_mode: 'HTML', ...siteButton(config.siteUrl, titleSlug) };
      const isEditNewTitle = existing && existing.date === today && existing.messageId && existing.isNewTitle;

      if (isEditNewTitle) {
        const mergedChapters = (existing.chapters && existing.chapters.length)
          ? mergeChapters(existing.chapters, newChapters)
          : newChapters;
        const updatedTitle = await fetchTitleBySlug(titleSlug);
        const updatedT = updatedTitle || t;
        const updatedInfo = {
          ...titleInfo,
          totalChapters: updatedT?.totalChapters != null ? updatedT.totalChapters : (mergedChapters.length || titleInfo.totalChapters),
          description: updatedT?.description ?? titleInfo.description,
          shortDescription: updatedT?.shortDescription ?? titleInfo.shortDescription,
        };
        const text = formatNewTitleMessage(titleName, updatedInfo);
        try {
          if (existing.hasPhoto) {
            await bot.editMessageCaption(text, {
              chat_id: config.telegramChatId,
              message_id: existing.messageId,
              ...opts,
            });
          } else {
            await bot.editMessageText(text, {
              chat_id: config.telegramChatId,
              message_id: existing.messageId,
              disable_web_page_preview: true,
              ...opts,
            });
          }
          state.titleMessages[key] = {
            ...existing,
            chapters: mergedChapters,
          };
          if (groupMaxReleaseTime > 0) maxNotified = Math.max(maxNotified || 0, groupMaxReleaseTime);
          console.log(`Updated (new title): ${titleName}, глав: ${updatedInfo.totalChapters}`);
          continue;
        } catch (editErr) {
          if (DEBUG) console.log('Edit new-title message failed:', editErr.message);
        }
      }

      if (existing && existing.date === today && existing.messageId && !existing.isNewTitle) {
        continue;
      }
      if (isEditNewTitle) {
        // редактирование не сработало — отправляем как новое не будем, уже есть сообщение
        continue;
      }

      const text = formatNewTitleMessage(titleName, titleInfo);
      const imageUrl = getImageUrl(titleForCover);
      let photoPayload = imageUrl;
      if (imageUrl) {
        const buf = await fetchImageBuffer(imageUrl);
        if (buf) photoPayload = buf;
      }
      try {
        const result = await sendPhotoOrMessage({
          photoPayload,
          text,
          opts,
          fileOpts: Buffer.isBuffer(photoPayload) ? { filename: 'cover.jpg', contentType: 'image/jpeg' } : undefined,
        });
        const messageId = result && result.message_id;
        if (messageId) {
          state.titleMessages[key] = {
            messageId,
            chatId: config.telegramChatId,
            date: today,
            hasPhoto: !!photoPayload,
            isNewTitle: true,
            chapters: newChapters,
          };
        }
        if (groupMaxReleaseTime > 0) maxNotified = Math.max(maxNotified || 0, groupMaxReleaseTime);
        console.log(`Posted (new title today): ${titleName}`);
      } catch (e) {
        console.error('Telegram send error:', e.message);
      }
      continue;
    }

    if (config.notifyNewChapters) {
    const text = formatChapterMessage(chaptersToShow, titleName, titleInfo);
    const imageUrl = getImageUrl(titleForCover);
    if (DEBUG) console.log(imageUrl ? `Image: ${imageUrl}` : `No image (cover: ${!!(titleForCover && titleForCover.coverImage)})`);
    let photoPayload = imageUrl;
    if (imageUrl) {
      const buf = await fetchImageBuffer(imageUrl);
      if (buf) photoPayload = buf;
      else {
        if (DEBUG) console.log('Image fetch failed, will try URL');
        else console.log('Cover fetch failed (check IMAGE_BASE_URL / cover URL):', imageUrl.slice(0, 60) + '…');
      }
    } else {
      console.log('No cover for this title (set cover in admin for the title)');
    }
    const opts = { parse_mode: 'HTML', ...siteButton(config.siteUrl, titleSlug) };

    if (isEdit && existing) {
      try {
        if (existing.hasPhoto) {
          await bot.editMessageCaption(text, {
            chat_id: config.telegramChatId,
            message_id: existing.messageId,
            ...opts,
          });
        } else {
          await bot.editMessageText(text, {
            chat_id: config.telegramChatId,
            message_id: existing.messageId,
            disable_web_page_preview: true,
            ...opts,
          });
        }
        state.titleMessages[key] = {
          messageId: existing.messageId,
          chatId: config.telegramChatId,
          date: today,
          hasPhoto: existing.hasPhoto,
          chapters: chaptersToShow,
        };
        if (groupMaxReleaseTime > 0) maxNotified = Math.max(maxNotified || 0, groupMaxReleaseTime);
        const chNums = chaptersToShow.map((c) => c.chapterNumber).join(', ');
        console.log(`Updated: ${titleName} ch.${chNums}`);
        continue;
      } catch (editErr) {
        const errMsg = (editErr && typeof editErr === 'object' && 'message' in editErr) ? String(editErr.message) : '';
        if (DEBUG) console.log('Edit failed, will send new message:', errMsg);
        isEdit = false;
      }
    }

    try {
      const result = await sendPhotoOrMessage({
        photoPayload,
        text,
        opts,
        fileOpts: Buffer.isBuffer(photoPayload) ? { filename: 'cover.jpg', contentType: 'image/jpeg' } : undefined,
      });
      const messageId = result && result.message_id;
      if (messageId) {
        state.titleMessages[key] = {
          messageId,
          chatId: config.telegramChatId,
          date: today,
          hasPhoto: !!photoPayload,
          chapters: chaptersToShow,
        };
      }
      if (groupMaxReleaseTime > 0) maxNotified = Math.max(maxNotified || 0, groupMaxReleaseTime);
      const chNums = chaptersToShow.map((c) => c.chapterNumber).join(', ');
      console.log(`Posted: ${titleName} ch.${chNums}${photoPayload ? ' (with cover)' : ' (no cover)'}`);
    } catch (e) {
      const errMsg = (e && typeof e === 'object' && 'message' in e) ? String(e.message) : '';
      if (photoPayload && (errMsg.includes('wrong file') || errMsg.includes('failed to get'))) {
        try {
          const result = await sendMessageSafe(text, opts);
          const messageId = result && result.message_id;
          if (messageId) {
            state.titleMessages[key] = {
              messageId,
              chatId: config.telegramChatId,
              date: today,
              hasPhoto: false,
              chapters: chaptersToShow,
            };
          }
          if (groupMaxReleaseTime > 0) maxNotified = Math.max(maxNotified || 0, groupMaxReleaseTime);
          console.log(`Posted (no photo): ${titleName} ch.${chaptersToShow.map((c) => c.chapterNumber).join(', ')}`);
        } catch (e2) {
          console.error('Telegram send error:', e2.message);
        }
      } else {
        console.error('Telegram send error:', e.message);
      }
    }
    } else {
      if (groupMaxReleaseTime > 0) maxNotified = Math.max(maxNotified || 0, groupMaxReleaseTime);
    }
  }

  // ======== Таблица лидеров: изменения позиций в рейтинге ========
  if (config.notifyLeaderboard && config.leaderboardSize > 0) {
    try {
      const newList = await fetchLeaderboard(config.leaderboardSort, config.leaderboardSize);
      const oldBySlug = new Map((state.lastLeaderboard || []).map((e) => [e.slug, e]));
      const changes = [];
      for (let i = 0; i < newList.length; i++) {
        const curr = newList[i];
        const prev = oldBySlug.get(curr.slug);
        if (prev && prev.position !== curr.position) {
          changes.push({
            name: curr.name,
            prevPosition: prev.position,
            newPosition: curr.position,
          });
        } else if (!prev && curr.position <= config.leaderboardSize) {
          changes.push({ name: curr.name, prevPosition: null, newPosition: curr.position });
        }
      }
      if (changes.length > 0) {
        const sortLabel = config.leaderboardSort === 'views' ? 'По просмотрам' : 'По рейтингу';
        const text = formatLeaderboardChangesMessage(changes, sortLabel);
        await sendMessageSafe(text, { parse_mode: 'HTML' });
        console.log(`Posted (leaderboard): ${changes.length} изменений`);
      }
      state.lastLeaderboard = newList;
    } catch (e) {
      console.error('Leaderboard error:', e.message);
    }
  }

  // ======== Тайтл набрал за день N+ просмотров (требует views в API) ========
  if (config.notifyDailyViews) {
    try {
      const titlesWithViews = await fetchLeaderboard('views', 200);
      const todayViews = {};
      for (const t of titlesWithViews) {
        if (t.slug && t.value != null) todayViews[t.slug] = t.value;
      }
      const prevDate = state.lastViewsDate;
      const prevBySlug = state.lastViewsBySlug || {};
      const isNewDay = prevDate !== today;
      if (isNewDay && Object.keys(prevBySlug).length > 0) {
        for (const [slug, viewsNow] of Object.entries(todayViews)) {
          const viewsPrev = prevBySlug[slug] != null ? Number(prevBySlug[slug]) : 0;
          const delta = Math.max(0, viewsNow - viewsPrev);
          if (delta >= config.dailyViewsMin) {
            const name = titlesWithViews.find((x) => x.slug === slug)?.name || slug;
            const text = [
              '<b>🔥 Рекорд просмотров за день</b>',
              '',
              `Тайтл <b>${escapeHtml(name)}</b> набрал <b>${delta.toLocaleString('ru-RU')}</b> просмотров за сутки.`,
              '',
              `Минимум для оповещения: ${config.dailyViewsMin.toLocaleString('ru-RU')}`,
            ].join('\n');
            await sendMessageSafe(text, {
              parse_mode: 'HTML',
              ...siteButton(config.siteUrl, slug),
            });
            console.log(`Posted (daily views): ${name} +${delta}`);
          }
        }
      }
      state.lastViewsDate = today;
      state.lastViewsBySlug = todayViews;
    } catch (e) {
      console.error('Daily views check error:', e.message);
    }
  }

  // Оставляем в state только сообщения за сегодня, чтобы не раздувать файл
  const prunedTitleMessages = {};
  for (const [k, v] of Object.entries(state.titleMessages || {})) {
    if (v && v.date === today) prunedTitleMessages[k] = v;
  }

  const lastProcessedStr =
    maxNotified > 0 ? new Date(maxNotified).toISOString() : initialLastProcessedStr;
  const lastProcessedTitleStr =
    maxNotifiedTitle > 0 ? new Date(maxNotifiedTitle).toISOString() : initialLastProcessedTitleStr;
  saveState(config.statePath, {
    ...state,
    lastProcessedReleaseDate: lastProcessedStr || undefined,
    lastProcessedTitleCreatedAt: lastProcessedTitleStr || undefined,
    titleMessages: prunedTitleMessages,
  });
}

async function loop() {
  console.log('Checking for new titles and chapters...');
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
