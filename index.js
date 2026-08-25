process.env.NTBA_FIX_350 = true; // убирает DeprecationWarning при отправке Buffer
const TelegramBot = require("node-telegram-bot-api");
const config = require("./config");
const { loadState, saveState } = require("./state");
const { runPersonalNotifications } = require("./personal-notifications");
const { isMaxEnabled, sendOrEditMaxMessage } = require("./max");

const bot = new TelegramBot(config.telegramBotToken, { polling: false });

const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true";

// Telegram limits (practical): photo caption <= 1024 chars, message text <= 4096 chars.
const TG_MAX_CAPTION_LEN = 1024;
const TG_MAX_MESSAGE_LEN = 4096;

function clampText(s, maxLen) {
  if (!s) return "";
  const str = String(s);
  if (str.length <= maxLen) return str;
  return str.slice(0, Math.max(0, maxLen - 1)) + "…";
}

function stripHtmlTags(s) {
  return String(s || "").replace(/<[^>]*>/g, "");
}

function looksLikeCaptionTooLongError(msg) {
  const m = String(msg || "").toLowerCase();
  return (
    m.includes("caption is too long") ||
    m.includes("message caption is too long")
  );
}

async function sendMessageSafe(text, opts) {
  const raw = String(text || "");
  if (raw.length <= TG_MAX_MESSAGE_LEN) {
    return bot.sendMessage(config.telegramChatId, raw, {
      disable_web_page_preview: true,
      ...opts,
    });
  }

  // Если текст слишком длинный, лучше отправить как plain-text, чтобы не словить ошибки HTML entities.
  const plain = clampText(stripHtmlTags(raw), TG_MAX_MESSAGE_LEN);
  const { parse_mode, ...rest } = opts || {};
  if (DEBUG)
    console.log(
      `Message too long (${raw.length}), sending plain-text truncated`,
    );
  return bot.sendMessage(config.telegramChatId, plain, {
    disable_web_page_preview: true,
    ...rest,
  });
}

async function sendPhotoOrMessage({ photoPayload, text, opts, fileOpts }) {
  const caption = String(text || "");
  const usePhoto = !!photoPayload && caption.length <= TG_MAX_CAPTION_LEN;

  if (!usePhoto) {
    if (photoPayload && caption.length > TG_MAX_CAPTION_LEN && DEBUG) {
      console.log(
        `Caption too long for sendPhoto (${caption.length}), sending text-only`,
      );
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
    const msg =
      e && typeof e === "object" && "message" in e ? String(e.message) : "";
    if (looksLikeCaptionTooLongError(msg)) {
      if (DEBUG)
        console.log(
          "sendPhoto failed: caption too long, retrying as text-only",
        );
      return sendMessageSafe(caption, opts);
    }
    throw e;
  }
}

async function syncMaxTitleMessage(state, key, text, titleSlug, today) {
  if (!isMaxEnabled()) return;
  try {
    const previous = state.maxTitleMessages[key];
    const result = await sendOrEditMaxMessage({
      text,
      titleSlug,
      messageId: previous?.date === today ? previous.messageId : undefined,
    });
    if (result?.messageId) {
      state.maxTitleMessages[key] = { messageId: result.messageId, date: today };
    }
    console.log(`MAX ${result?.edited ? 'updated' : 'posted'}: ${key}`);
  } catch (error) {
    console.error(`MAX send error (${key}):`, error.message);
  }
}

async function sendMaxBroadcast(text, titleSlug) {
  if (!isMaxEnabled()) return;
  try {
    await sendOrEditMaxMessage({ text, titleSlug });
  } catch (error) {
    console.error('MAX broadcast error:', error.message);
  }
}

/**
 * Оформление строки глав: обычный релиз (💎), премиум (🔒), открытие по freeAt (🔓) — как updateHighlight в /titles/latest-updates.
 * @param {object} opts - { forceRange?: boolean, maxChaptersShown?: number=20, maxLineLength?: number=200, updateHighlight?: 'premium'|'went_free' }
 */
function formatChaptersLine(chapters, opts = {}) {
  if (!Array.isArray(chapters) || chapters.length === 0) return "Главы —";
  const nums = chapters.map((ch) => ch.chapterNumber).sort((a, b) => a - b);
  const latest = chapters.reduce((acc, ch) => {
    const t = ch.releaseDate ? new Date(ch.releaseDate).getTime() : 0;
    const accT = acc.releaseDate ? new Date(acc.releaseDate).getTime() : 0;
    return t > accT ? ch : acc;
  }, chapters[0]);
  const dateStr = latest.releaseDate
    ? new Date(latest.releaseDate).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
      })
    : "";
  const maxShown = opts.maxChaptersShown ?? 20;
  const maxLen = opts.maxLineLength ?? 200;
  const highlight = opts.updateHighlight;

  const decorateBody = (body) => {
    if (highlight === "premium") {
      return dateStr ? `🔒 ${body} · ${dateStr}` : `🔒 ${body}`;
    }
    if (highlight === "went_free") {
      return dateStr ? `🔓 ${body} · ${dateStr}` : `🔓 ${body}`;
    }
    return dateStr ? `📖 ${body} · ${dateStr}` : `📖 ${body}`;
  };

  if (nums.length === 1) {
    return clampText(decorateBody(`Глава ${nums[0]}`), maxLen);
  }

  const forceRange = opts.forceRange === true;
  const consecutive =
    !forceRange && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);

  if (forceRange || consecutive) {
    const range = `Главы ${nums[0]}–${nums[nums.length - 1]}`;
    return clampText(decorateBody(range), maxLen);
  }

  // Новое: группировка диапазонов для длинных не-consecutive списков
  if (nums.length > maxShown) {
    const ranges = groupIntoRanges(nums);
    const chaptersStr = formatRanges(ranges, nums.length);
    return clampText(decorateBody(`Главы ${chaptersStr}`), maxLen);
  }

  // Fallback: полный список
  const chaptersStr = nums.join(", ");
  return clampText(decorateBody(`Главы ${chaptersStr}`), maxLen);
}

/** Возрастное ограничение: 0–18 из схемы тайтла → "0+", "6+", "12+", "16+", "18+" */
/** Группирует отсортированные номера глав в диапазоны consecutive чисел */
function groupIntoRanges(nums) {
  if (nums.length === 0) return [];
  const ranges = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === prev + 1) {
      prev = nums[i];
    } else {
      ranges.push([start, prev]);
      start = prev = nums[i];
    }
  }
  ranges.push([start, prev]);
  return ranges;
}

/** Форматирует диапазоны: "854-950, 2270-2371" или сокращает если много */
function formatRanges(ranges, totalCount, maxRanges = 5, maxLen = 150) {
  if (ranges.length === 1) {
    const [start, end] = ranges[0];
    return start === end ? `${start}` : `${start}–${end}`;
  }
  let str = ranges
    .slice(0, maxRanges)
    .map(([s, e]) => (s === e ? `${s}` : `${s}–${e}`))
    .join(", ");
  if (ranges.length > maxRanges) {
    str += ` (+${totalCount - ranges.slice(0, maxRanges).reduce((sum, r) => sum + (r[1] - r[0] + 1), 0)} глав)`;
  }
  return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str;
}

function formatAgeLimit(ageLimit) {
  if (ageLimit === undefined || ageLimit === null) return "";
  const n = Number(ageLimit);
  if (Number.isNaN(n) || n < 0) return "";
  if (n >= 18) return "⛔️ 18+ 🔞";
  if (n >= 16) return "16+";
  if (n >= 12) return "12+";
  if (n >= 6) return "6+";
  return "0+";
}

const STATUS_LABELS = {
  ongoing: "🟢 Онгоинг",
  completed: "🟣 Завершён",
  pause: "🟠 Пауза",
  cancelled: "🔴 Отменён",
};

const TYPE_LABELS = {
  manhwa: "🇰🇷 Манхва",
  manga: "🇯🇵 Манга",
  manhua: "🇨🇳 Маньхуа",
  webtoon: "🇰🇷 Вебтун",
  webcomic: "🇺🇸 Вебкомикс",
};

function translateType(type) {
  if (!type || typeof type !== "string") return "";
  const key = String(type).trim().toLowerCase();
  return TYPE_LABELS[key] || escapeHtml(type);
}

/**
 * @param {object} opts - { milestoneNumbers?: number[], isNewTitleOnSite?: boolean, updateHighlight?: 'premium'|'went_free' }
 *   isNewTitleOnSite: true — заголовок "Новый тайтл на сайте", главы диапазоном, + короткое описание
 */
function formatChapterMessage(chapters, titleName, titleInfo = {}, opts = {}) {
  const title = titleName || "Без названия";
  const isPlural = (Array.isArray(chapters) ? chapters.length : 1) > 1;
  const isNewTitleOnSite = opts.isNewTitleOnSite === true;
  const uh = opts.updateHighlight;
  const header = isNewTitleOnSite
    ? "<b>🆕 Новый тайтл на сайте</b>"
    : uh === "went_free"
      ? isPlural
        ? "<b>🔓 Открыты для всех</b>"
        : "<b>🔓 Открыта для всех</b>"
      : uh === "premium"
        ? isPlural
          ? "<b>🔒 Новые премиум-главы</b>"
          : "<b>🔒 Новая премиум-глава</b>"
        : isPlural
          ? "<b>✨ Новые главы</b>"
          : "<b>✨ Новая глава</b>";
  const chaptersArr = Array.isArray(chapters) ? chapters : [chapters];
  const chapterLine = formatChaptersLine(chaptersArr, {
    forceRange: isNewTitleOnSite,
    updateHighlight: isNewTitleOnSite ? undefined : uh,
  });
  const ageStr = formatAgeLimit(titleInfo.ageLimit);
  const titleLine = ageStr
    ? `<b>${escapeHtml(title)}</b> · ${ageStr}`
    : `<b>${escapeHtml(title)}</b>`;

  const typeStr = titleInfo.type ? translateType(titleInfo.type) : "";
  const yearStr =
    titleInfo.releaseYear != null && Number(titleInfo.releaseYear) >= 1900
      ? String(Number(titleInfo.releaseYear))
      : "";
  const statusStr =
    titleInfo.status && STATUS_LABELS[String(titleInfo.status).toLowerCase()];
  const metaParts = [typeStr, yearStr, statusStr].filter(Boolean);
  const metaLine = metaParts.length ? `<i>${metaParts.join(" · ")}</i>` : "";

  const genres = Array.isArray(titleInfo.genres) ? titleInfo.genres : [];
  const genreStr = genres
    .slice(0, 3)
    .map((g) => escapeHtml(String(g).trim()))
    .filter(Boolean)
    .join(", ");

  let descLine = "";
  if (isNewTitleOnSite) {
    const rawDesc = titleInfo.description || titleInfo.shortDescription || "";
    if (rawDesc && typeof rawDesc === "string") {
      const trimmed = rawDesc.trim();
      if (trimmed) {
        descLine =
          trimmed.length > NEW_TITLE_DESCRIPTION_MAX_LEN
            ? escapeHtml(
                trimmed.slice(0, NEW_TITLE_DESCRIPTION_MAX_LEN).trim(),
              ) + "…"
            : escapeHtml(trimmed);
      }
    }
  }

  const milestoneNumbers =
    opts.milestoneNumbers && Array.isArray(opts.milestoneNumbers)
      ? opts.milestoneNumbers
      : [];
  const milestoneLine =
    milestoneNumbers.length > 0
      ? `🎉 Юбилейная глава! Достигли ${milestoneNumbers.join(", ")} глав.`
      : "";

  const accessHint =
    !isNewTitleOnSite && uh === "went_free"
      ? "<i>По расписанию доступна бесплатно всем читателям.</i>"
      : !isNewTitleOnSite && uh === "premium"
        ? "<i>Премиум: по подписке или бесплатно позже по расписанию на сайте.</i>"
        : "";

  const lines = [
    header,
    titleLine,
    chapterLine,
    ...(accessHint ? [accessHint] : []),
    ...(milestoneLine ? [milestoneLine] : []),
    ...(metaLine ? [metaLine] : []),
    ...(genreStr ? [genreStr] : []),
    ...(isNewTitleOnSite && descLine ? [descLine] : []),
  ].filter(Boolean);
  return lines.join("\n");
}

function siteButton(siteUrl, titleSlug) {
  const url = `${siteUrl}/titles/${titleSlug || ""}`;
  return {
    reply_markup: { inline_keyboard: [[{ text: "Читать на сайте ↗", url }]] },
  };
}

function escapeHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  const name = titleName || "Без названия";
  const ageStr = formatAgeLimit(titleInfo.ageLimit);
  const titleLine = ageStr
    ? `<b>${escapeHtml(name)}</b> (${ageStr})`
    : `<b>${escapeHtml(name)}</b>`;
  const typeStr = titleInfo.type ? translateType(titleInfo.type) : "";
  const yearStr =
    titleInfo.releaseYear != null && Number(titleInfo.releaseYear) >= 1900
      ? String(Number(titleInfo.releaseYear))
      : "";
  const metaParts = [typeStr, yearStr].filter(Boolean);
  const metaLine = metaParts.length ? `<i>${metaParts.join(" · ")}</i>` : "";
  let descLine = "";
  const rawDesc = titleInfo.description || titleInfo.shortDescription || "";
  if (rawDesc && typeof rawDesc === "string") {
    const trimmed = rawDesc.trim();
    if (trimmed) {
      const short =
        trimmed.length > NEW_TITLE_DESCRIPTION_MAX_LEN
          ? trimmed.slice(0, NEW_TITLE_DESCRIPTION_MAX_LEN).trim() + "…"
          : trimmed;
      descLine = escapeHtml(short);
    }
  }
  const lines = [
    "<b>🆕 Новый тайтл на сайте</b>",
    "",
    titleLine,
    ...(metaLine ? [metaLine] : []),
    ...(descLine ? ["", descLine] : []),
  ].filter(Boolean);
  return lines.join("\n");
}

/** Номера глав, о которых уже уходило уведомление (по slug тайтла). */
function getNotifiedChapterSet(state, titleKey) {
  const list = state.notifiedChapters?.[titleKey];
  return new Set(
    Array.isArray(list)
      ? list.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : [],
  );
}

function recordNotifiedChapters(state, titleKey, chapterNumbers) {
  if (!titleKey || !Array.isArray(chapterNumbers) || chapterNumbers.length === 0)
    return;
  if (!state.notifiedChapters) state.notifiedChapters = {};
  const prev = state.notifiedChapters[titleKey] || [];
  const merged = [
    ...new Set([
      ...prev.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0),
      ...chapterNumbers
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0),
    ]),
  ].sort((a, b) => a - b);
  // Не раздуваем state: храним последние 200 номеров
  state.notifiedChapters[titleKey] =
    merged.length > 200 ? merged.slice(-200) : merged;
}

/**
 * API в latest-updates отдаёт несколько «недавних» глав тайтла разом (группировка на сервере).
 * Для премиум / went_free оставляем только реально новые номера; старые из пачки отбрасываем.
 */
function resolveChapterNumbersToNotify(row, sortedNums, alreadyNotified) {
  let fresh = sortedNums.filter((n) => !alreadyNotified.has(n));
  if (fresh.length === 0) return [];

  const highlight =
    row.updateHighlight === "premium" || row.updateHighlight === "went_free"
      ? row.updateHighlight
      : undefined;

  if (!highlight) return fresh;

  // В ленте к премиум-событию часто «прилипают» старые номера тайтла — берём только главу из chapterNumber.
  const maxFromApi =
    row.chapterNumber != null ? Number(row.chapterNumber) : NaN;
  if (Number.isFinite(maxFromApi) && fresh.includes(maxFromApi)) {
    return [maxFromApi];
  }
  return [Math.max(...fresh)];
}

/** Объединяет уже показанные главы с новыми, без дубликатов по chapterNumber. */
function mergeChapters(existing, newChapters) {
  const byNum = new Map(existing.map((c) => [c.chapterNumber, c]));
  for (const c of newChapters) {
    byNum.set(c.chapterNumber, {
      chapterNumber: c.chapterNumber,
      releaseDate: c.releaseDate,
    });
  }
  return [...byNum.values()].sort(
    (a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0),
  );
}

/**
 * Возвращает один URL обложки (для обратной совместимости и логов).
 * Предпочтение: сервер (imageBaseUrl), если передан только один вариант.
 */
function getImageUrl(title) {
  const urls = getImageUrls(title);
  return urls.length > 0 ? urls[0] : null;
}

/**
 * Возвращает массив URL обложки для проверки: с сервера и/или из облака.
 * Если coverImage — полный URL (http/https), возвращается только он.
 * В облаке нет папки uploads: при сборке облачного URL префикс uploads/ или /uploads/ убирается.
 */
function getImageUrls(title) {
  const raw = title && title.coverImage;
  if (!raw || typeof raw !== "string") return [];
  const path = raw.trim();
  if (!path) return [];
  if (path.startsWith("http://") || path.startsWith("https://")) return [path];
  const serverBase = config.imageBaseUrl.replace(/\/$/, "");
  const serverUrl = path.startsWith("/")
    ? serverBase + path
    : serverBase + "/" + path;
  const urls = [];
  if (config.imageCloudBaseUrl) {
    let cloudPath = path.startsWith("/") ? path : "/" + path;
    if (cloudPath.startsWith("/uploads/"))
      cloudPath = cloudPath.slice("/uploads".length);
    else if (cloudPath.startsWith("uploads/"))
      cloudPath = "/" + cloudPath.slice("uploads".length);
    const cloudUrl = cloudPath.startsWith("/")
      ? config.imageCloudBaseUrl + cloudPath
      : config.imageCloudBaseUrl + "/" + cloudPath;
    urls.push(cloudUrl);
  }
  urls.push(serverUrl);
  return urls;
}

/** Скачиваем картинку по одному URL, возвращаем буфер или null. */
async function fetchImageBuffer(url, timeoutMs = 15000) {
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; TomiloLibBot/1.0; +https://tomilo-lib.ru)",
        Accept: "image/*",
      },
    });
    clearTimeout(to);
    if (!res.ok) {
      if (DEBUG)
        console.log("Image fetch failed:", res.status, url.slice(0, 70) + "…");
      return null;
    }
    const buf = await res.arrayBuffer();
    return Buffer.from(buf);
  } catch (e) {
    if (DEBUG)
      console.log("Image fetch error:", e && e.message, url.slice(0, 70) + "…");
    return null;
  }
}

/** Пробует скачать картинку по списку URL (сервер, облако); возвращает буфер первого успешного. */
async function fetchImageBufferFromUrls(urls, timeoutMs = 15000) {
  if (!Array.isArray(urls) || urls.length === 0) return null;
  for (const url of urls) {
    const buf = await fetchImageBuffer(url, timeoutMs);
    if (buf) return buf;
  }
  return null;
}

/**
 * Лента как на сайте: lastUpdate учитывает freeAt (открытие всем) и премиум (updatedAt до freeAt),
 * плюс updateHighlight — см. GET /titles/latest-updates на сервере.
 */
async function fetchLatestUpdatesTitles() {
  const q = new URLSearchParams({
    page: "1",
    limit: "100",
    includeAdult: "true",
  });
  const url = `${config.apiUrl}/titles/latest-updates?${q}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API latest-updates ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.success || !Array.isArray(json.data)) {
    throw new Error("Invalid API response (latest-updates)");
  }
  return json.data;
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
  if (!res.ok)
    throw new Error(`API leaderboard ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.success || !json.data || !Array.isArray(json.data.titles))
    return [];
  const list = [];
  const valueKey = sortBy === "views" ? "viewsCount" : "rating";
  json.data.titles.forEach((t, i) => {
    const slug = t.slug || "";
    const name = t.name || "Без названия";
    const value = t[valueKey] != null ? Number(t[valueKey]) : 0;
    list.push({ slug, name, position: i + 1, value });
  });
  return list;
}

/** Сообщение об изменениях в таблице лидеров (кто поднялся/опустился). */
function formatLeaderboardChangesMessage(changes, sortLabel) {
  const lines = ["<b>📊 Изменения в рейтинге</b>", ""];
  for (const c of changes) {
    const name = escapeHtml(c.name);
    if (c.prevPosition != null && c.newPosition != null) {
      if (c.newPosition < c.prevPosition) {
        lines.push(`🟢 ${name}: ${c.prevPosition} → ${c.newPosition} место`);
      } else {
        lines.push(`🔴 ${name}: ${c.prevPosition} → ${c.newPosition} место`);
      }
    } else if (c.prevPosition == null) {
      lines.push(`🆕 ${name}: ${c.newPosition} место (новый в топе)`);
    }
  }
  if (sortLabel) lines.push("", `<i>${escapeHtml(sortLabel)}</i>`);
  return lines.join("\n");
}

async function run() {
  const state = loadState(config.statePath);
  let lastProcessed = state.lastProcessedReleaseDate
    ? new Date(state.lastProcessedReleaseDate).getTime()
    : null;
  const initialLastProcessedStr =
    state.lastProcessedReleaseDate &&
    typeof state.lastProcessedReleaseDate.toISOString === "function"
      ? state.lastProcessedReleaseDate.toISOString()
      : state.lastProcessedReleaseDate
        ? String(state.lastProcessedReleaseDate)
        : null;

  const today = getTodayString();
  if (!state.titleMessages) state.titleMessages = {};
  if (!state.maxTitleMessages) state.maxTitleMessages = {};
  if (!state.notifiedChapters) state.notifiedChapters = {};

  // ======== Обработка новых глав ========
  // Сообщения отправляем как обычно. Если тайтл создан сегодня — в сообщении пишем "Новый тайтл на сайте"
  // и в течение дня обновляем это сообщение при добавлении новых глав.
  const updates = await fetchLatestUpdatesTitles();
  const toPost = [];
  let maxSeen = lastProcessed;
  let maxNotified = lastProcessed;

  for (const row of updates) {
    const activityTime = row.lastUpdate ? new Date(row.lastUpdate).getTime() : 0;
    if (!Number.isFinite(activityTime) || activityTime <= 0) continue;
    if (activityTime > 0) maxSeen = Math.max(maxSeen || 0, activityTime);
    if (lastProcessed != null && activityTime <= lastProcessed) continue;

    const numsRaw =
      Array.isArray(row.chapters) && row.chapters.length > 0
        ? row.chapters
        : row.chapterNumber != null
          ? [row.chapterNumber]
          : [];
    const nums = numsRaw
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length === 0) continue;

    const sortedNums = [...new Set(nums)].sort((a, b) => a - b);
    const titleKey = row.slug || row.title || "";
    const alreadyNotified = getNotifiedChapterSet(state, titleKey);
    const numsToNotify = resolveChapterNumbersToNotify(
      row,
      sortedNums,
      alreadyNotified,
    );
    if (numsToNotify.length === 0) {
      if (activityTime > 0) maxNotified = Math.max(maxNotified || 0, activityTime);
      continue;
    }

    const lastIso = row.lastUpdate
      ? typeof row.lastUpdate === "string"
        ? row.lastUpdate
        : new Date(row.lastUpdate).toISOString()
      : null;
    const newChapters = numsToNotify.map((chapterNumber) => ({
      chapterNumber,
      releaseDate: lastIso,
    }));
    const highlight =
      row.updateHighlight === "premium" || row.updateHighlight === "went_free"
        ? row.updateHighlight
        : undefined;

    toPost.push({
      titleName: row.title || "Без названия",
      titleSlug: row.slug || "",
      title: {
        name: row.title,
        slug: row.slug,
        coverImage: row.cover,
      },
      releaseTime: activityTime,
      updateHighlight: highlight,
      newChapters,
    });
  }

  // Как раньше: API отдаёт от новых к старым — переворачиваем, чтобы слать в хронологическом порядке
  toPost.reverse();

  for (const bundle of toPost) {
    const {
      titleName,
      titleSlug,
      title,
      releaseTime: groupMaxReleaseTime,
      updateHighlight,
      newChapters,
    } = bundle;
    const key = titleSlug || titleName;
    const existing = state.titleMessages[key];

    let chaptersToShow;
    let isEdit = false;

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

    // Тайтл создан сегодня — в сообщении пишем "Новый тайтл на сайте"; в течение дня сообщение обновляем при новых главах
    const isNewTitleOnSite =
      isTitleCreatedToday(t?.createdAt) && config.notifyNewTitles;

    if (
      isNewTitleOnSite &&
      existing &&
      existing.date === today &&
      existing.messageId &&
      existing.chapters
    ) {
      chaptersToShow = mergeChapters(existing.chapters, newChapters);
      isEdit = true;
    } else {
      chaptersToShow = newChapters;
    }

    if (config.notifyNewChapters) {
      const keyCh = titleSlug || titleName;
      let milestoneNumbers = [];
      if (
        config.notifyMilestoneChapters &&
        config.milestoneChapters.length > 0
      ) {
        const notified = state.notifiedMilestones[keyCh] || [];
        milestoneNumbers = chaptersToShow
          .map((c) => c.chapterNumber)
          .filter(
            (num) =>
              config.milestoneChapters.includes(num) && !notified.includes(num),
          );
      }
      // При редактировании за сегодня подтягиваем свежие данные тайтла (totalChapters и т.д.)
      let finalTitleInfo = titleInfo;
      if (isEdit && titleSlug) {
        const updatedTitle = await fetchTitleBySlug(titleSlug);
        if (updatedTitle) {
          finalTitleInfo = {
            ageLimit: updatedTitle?.ageLimit ?? titleInfo.ageLimit,
            releaseYear: updatedTitle?.releaseYear ?? titleInfo.releaseYear,
            type: updatedTitle?.type ?? titleInfo.type,
            status: updatedTitle?.status ?? titleInfo.status,
            genres: updatedTitle?.genres ?? titleInfo.genres,
            author: updatedTitle?.author ?? titleInfo.author,
            artist: updatedTitle?.artist ?? titleInfo.artist,
            totalChapters:
              updatedTitle?.totalChapters != null
                ? updatedTitle.totalChapters
                : chaptersToShow.length || titleInfo.totalChapters,
            description: updatedTitle?.description ?? titleInfo.description,
            shortDescription:
              updatedTitle?.shortDescription ?? titleInfo.shortDescription,
          };
        }
      }
      const text = formatChapterMessage(
        chaptersToShow,
        titleName,
        finalTitleInfo,
        {
          milestoneNumbers,
          isNewTitleOnSite,
          updateHighlight,
        },
      );
      const imageUrls = getImageUrls(titleForCover);
      if (DEBUG && imageUrls.length > 0)
        console.log("Image URLs:", imageUrls[0].slice(0, 80) + "…");
      let photoPayload = null;
      if (imageUrls.length > 0) {
        photoPayload = await fetchImageBufferFromUrls(imageUrls);
        if (photoPayload) {
          if (DEBUG)
            console.log("Cover downloaded, size:", photoPayload.length);
        } else {
          if (DEBUG) console.log("Image fetch failed for all URLs");
          else
            console.log(
              "Cover fetch failed (check IMAGE_BASE_URL / IMAGE_CLOUD_BASE_URL):",
              imageUrls[0].slice(0, 60) + "…",
            );
        }
      } else {
        console.log(
          "No cover for this title (set cover in admin for the title)",
        );
      }
      const opts = {
        parse_mode: "HTML",
        ...siteButton(config.siteUrl, titleSlug),
      };
      if (isEdit && existing) {
        try {
          if (existing.hasPhoto) {
            await bot.editMessageCaption(text, {
              chat_id: config.telegramChatId,
              message_id: existing.messageId,
              ...opts,
            });
            state.titleMessages[key] = {
              messageId: existing.messageId,
              chatId: config.telegramChatId,
              date: today,
              hasPhoto: true,
              chapters: chaptersToShow,
            };
            if (milestoneNumbers.length > 0) {
              state.notifiedMilestones[keyCh] = [
                ...(state.notifiedMilestones[keyCh] || []),
                ...milestoneNumbers,
              ];
            }
            if (groupMaxReleaseTime > 0)
              maxNotified = Math.max(maxNotified || 0, groupMaxReleaseTime);
            recordNotifiedChapters(
              state,
              keyCh,
              newChapters.map((c) => c.chapterNumber),
            );
            const chNums = chaptersToShow
              .map((c) => c.chapterNumber)
              .join(", ");
            console.log(`Updated: ${titleName} ch.${chNums}`);
            await syncMaxTitleMessage(state, key, text, titleSlug, today);
            continue;
          }
          if (!existing.hasPhoto && photoPayload) {
            // Восстанавливаем сообщение с картинкой: отправляем новое с обложкой и удаляем старое
            const result = await sendPhotoOrMessage({
              photoPayload,
              text,
              opts,
              fileOpts: { filename: "cover.jpg", contentType: "image/jpeg" },
            });
            if (result && result.message_id) {
              try {
                await bot.deleteMessage(
                  config.telegramChatId,
                  existing.messageId,
                );
              } catch (delErr) {
                if (DEBUG)
                  console.log(
                    "Could not delete old message:",
                    delErr && delErr.message,
                  );
              }
              state.titleMessages[key] = {
                messageId: result.message_id,
                chatId: config.telegramChatId,
                date: today,
                hasPhoto: true,
                chapters: chaptersToShow,
              };
              if (milestoneNumbers.length > 0) {
                state.notifiedMilestones[keyCh] = [
                  ...(state.notifiedMilestones[keyCh] || []),
                  ...milestoneNumbers,
                ];
              }
              if (groupMaxReleaseTime > 0)
                maxNotified = Math.max(maxNotified || 0, groupMaxReleaseTime);
              recordNotifiedChapters(
                state,
                keyCh,
                newChapters.map((c) => c.chapterNumber),
              );
              const chNums = chaptersToShow
                .map((c) => c.chapterNumber)
                .join(", ");
              console.log(
                `Updated (restored with cover): ${titleName} ch.${chNums}`,
              );
              await syncMaxTitleMessage(state, key, text, titleSlug, today);
              continue;
            }
          }
          await bot.editMessageText(text, {
            chat_id: config.telegramChatId,
            message_id: existing.messageId,
            disable_web_page_preview: true,
            ...opts,
          });
          state.titleMessages[key] = {
            messageId: existing.messageId,
            chatId: config.telegramChatId,
            date: today,
            hasPhoto: existing.hasPhoto,
            chapters: chaptersToShow,
          };
          if (milestoneNumbers.length > 0) {
            state.notifiedMilestones[keyCh] = [
              ...(state.notifiedMilestones[keyCh] || []),
              ...milestoneNumbers,
            ];
          }
          if (groupMaxReleaseTime > 0)
            maxNotified = Math.max(maxNotified || 0, groupMaxReleaseTime);
          recordNotifiedChapters(
            state,
            keyCh,
            newChapters.map((c) => c.chapterNumber),
          );
          const chNums = chaptersToShow.map((c) => c.chapterNumber).join(", ");
          console.log(`Updated: ${titleName} ch.${chNums}`);
          await syncMaxTitleMessage(state, key, text, titleSlug, today);
          continue;
        } catch (editErr) {
          const errMsg =
            editErr && typeof editErr === "object" && "message" in editErr
              ? String(editErr.message)
              : "";
          if (DEBUG) console.log("Edit failed, will send new message:", errMsg);
          isEdit = false;
        }
      }

      try {
        const result = await sendPhotoOrMessage({
          photoPayload,
          text,
          opts,
          fileOpts: Buffer.isBuffer(photoPayload)
            ? { filename: "cover.jpg", contentType: "image/jpeg" }
            : undefined,
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
          if (milestoneNumbers.length > 0) {
            state.notifiedMilestones[keyCh] = [
              ...(state.notifiedMilestones[keyCh] || []),
              ...milestoneNumbers,
            ];
          }
        }
        if (groupMaxReleaseTime > 0)
          maxNotified = Math.max(maxNotified || 0, groupMaxReleaseTime);
        recordNotifiedChapters(
          state,
          keyCh,
          newChapters.map((c) => c.chapterNumber),
        );
        const chNums = chaptersToShow.map((c) => c.chapterNumber).join(", ");
        console.log(
          `Posted: ${titleName} ch.${chNums}${photoPayload ? " (with cover)" : " (no cover)"}`,
        );
        await syncMaxTitleMessage(state, key, text, titleSlug, today);
      } catch (e) {
        const errMsg =
          e && typeof e === "object" && "message" in e ? String(e.message) : "";
        if (
          photoPayload &&
          (errMsg.includes("wrong file") || errMsg.includes("failed to get"))
        ) {
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
              if (milestoneNumbers.length > 0) {
                state.notifiedMilestones[keyCh] = [
                  ...(state.notifiedMilestones[keyCh] || []),
                  ...milestoneNumbers,
                ];
              }
            }
            if (groupMaxReleaseTime > 0)
              maxNotified = Math.max(maxNotified || 0, groupMaxReleaseTime);
            recordNotifiedChapters(
              state,
              keyCh,
              newChapters.map((c) => c.chapterNumber),
            );
            console.log(
              `Posted (no photo): ${titleName} ch.${chaptersToShow.map((c) => c.chapterNumber).join(", ")}`,
            );
            await syncMaxTitleMessage(state, key, text, titleSlug, today);
          } catch (e2) {
            console.error("Telegram send error:", e2.message);
          }
        } else {
          console.error("Telegram send error:", e.message);
        }
      }
    } else {
      if (groupMaxReleaseTime > 0)
        maxNotified = Math.max(maxNotified || 0, groupMaxReleaseTime);
    }
  }

  // ======== Таблица лидеров: изменения позиций в рейтинге ========
  if (config.notifyLeaderboard && config.leaderboardSize > 0) {
    try {
      const newList = await fetchLeaderboard(
        config.leaderboardSort,
        config.leaderboardSize,
      );
      const oldBySlug = new Map(
        (state.lastLeaderboard || []).map((e) => [e.slug, e]),
      );
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
          changes.push({
            name: curr.name,
            prevPosition: null,
            newPosition: curr.position,
          });
        }
      }
      if (changes.length > 0) {
        const sortLabel =
          config.leaderboardSort === "views" ? "По просмотрам" : "По рейтингу";
        const text = formatLeaderboardChangesMessage(changes, sortLabel);
        await sendMessageSafe(text, { parse_mode: "HTML" });
        await sendMaxBroadcast(text);
        console.log(`Posted (leaderboard): ${changes.length} изменений`);
      }
      state.lastLeaderboard = newList;
    } catch (e) {
      console.error("Leaderboard error:", e.message);
    }
  }

  // ======== Тайтл набрал за день N+ просмотров (требует views в API) ========
  if (config.notifyDailyViews) {
    try {
      const titlesWithViews = await fetchLeaderboard("views", 200);
      const todayViews = {};
      for (const t of titlesWithViews) {
        if (t.slug && t.value != null) todayViews[t.slug] = t.value;
      }
      const prevDate = state.lastViewsDate;
      const prevBySlug = state.lastViewsBySlug || {};
      const isNewDay = prevDate !== today;
      if (isNewDay && Object.keys(prevBySlug).length > 0) {
        for (const [slug, viewsNow] of Object.entries(todayViews)) {
          const viewsPrev =
            prevBySlug[slug] != null ? Number(prevBySlug[slug]) : 0;
          const delta = Math.max(0, viewsNow - viewsPrev);
          if (delta >= config.dailyViewsMin) {
            const name =
              titlesWithViews.find((x) => x.slug === slug)?.name || slug;
            const text = [
              "<b>🔥 Рекорд просмотров за день</b>",
              "",
              `<b>${escapeHtml(name)}</b> набрал <b>${delta.toLocaleString("ru-RU")}</b> просмотров за сутки.`,
              "",
              `Минимум для оповещения: ${config.dailyViewsMin.toLocaleString("ru-RU")}`,
            ].join("\n");
            await sendMessageSafe(text, {
              parse_mode: "HTML",
              ...siteButton(config.siteUrl, slug),
            });
            await sendMaxBroadcast(text, slug);
            console.log(`Posted (daily views): ${name} +${delta}`);
          }
        }
      }
      state.lastViewsDate = today;
      state.lastViewsBySlug = todayViews;
    } catch (e) {
      console.error("Daily views check error:", e.message);
    }
  }

  // Оставляем в state только сообщения за сегодня, чтобы не раздувать файл
  const prunedTitleMessages = {};
  for (const [k, v] of Object.entries(state.titleMessages || {})) {
    if (v && v.date === today) prunedTitleMessages[k] = v;
  }
  const prunedMaxTitleMessages = {};
  for (const [k, v] of Object.entries(state.maxTitleMessages || {})) {
    if (v && v.date === today) prunedMaxTitleMessages[k] = v;
  }

  const lastProcessedStr =
    maxNotified > 0
      ? new Date(maxNotified).toISOString()
      : initialLastProcessedStr;
  saveState(config.statePath, {
    ...state,
    lastProcessedReleaseDate: lastProcessedStr || undefined,
    titleMessages: prunedTitleMessages,
    maxTitleMessages: prunedMaxTitleMessages,
  });
}

async function loop() {
  console.log("Checking for new titles and chapters...");
  try {
    await run();
    await runPersonalNotifications(bot);
  } catch (e) {
    console.error("Run error:", e.message);
  }
  setTimeout(loop, config.pollIntervalMs);
}

async function checkChat() {
  try {
    await bot.getChat(config.telegramChatId);
    console.log("Chat OK:", config.telegramChatId);
    return true;
  } catch (e) {
    console.error("\n  TELEGRAM_CHAT_ID недоступен (chat not found).");
    console.error("  Текущее значение:", config.telegramChatId);
    console.error("\n  Как получить правильный Chat ID:");
    console.error(
      "  • Личный чат: напиши боту /start, затем открой в браузере:",
    );
    console.error("    https://api.telegram.org/bot<ТВОЙ_ТОКЕН>/getUpdates");
    console.error(
      '    В ответе найди "chat":{"id": ЧИСЛО} — это и есть TELEGRAM_CHAT_ID.',
    );
    console.error(
      "  • Канал: добавь бота в канал как админа, затем в getUpdates",
    );
    console.error(
      '    будет запись с "chat":{"id": -100...} — используй этот id.',
    );
    console.error(
      "  • Убедись, что в .env нет кавычек и пробелов: TELEGRAM_CHAT_ID=-1001234567890\n",
    );
    return false;
  }
}

async function main() {
  console.log("Tomilo Lib Bot — new chapters notifier");
  console.log(
    "API:",
    config.apiUrl,
    "| Site:",
    config.siteUrl,
    "| Poll:",
    config.pollIntervalMs / 1000,
    "s",
    "| Personal bookmarks:",
    config.notifyPersonalBookmarks && config.botApiSecret ? "on" : "off",
  );
  if (!(await checkChat())) process.exit(1);
  loop();
}
main();
