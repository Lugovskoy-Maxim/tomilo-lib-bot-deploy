/**
 * Личные уведомления о новых главах в закладках (очередь API tomilo-lib-server).
 */
const config = require('./config');
const { waitForMessageSlot } = require('./message-rate-limiter');

// Старые версии API ещё не имеют очереди личных уведомлений. Не опрашиваем
// несуществующий маршрут каждые несколько минут и не засоряем лог.
let personalQueueUnsupported = false;

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function siteButton(siteUrl, titleSlug, chapterId) {
  const path = titleSlug
    ? `${siteUrl}/titles/${titleSlug}/chapter/${chapterId}`
    : `${siteUrl}`;
  return {
    reply_markup: {
      inline_keyboard: [[{ text: 'Читать на сайте ↗', url: path }]],
    },
  };
}

function formatPersonalChapterMessage(item) {
  const title = escapeHtml(item.titleName || 'Тайтл');
  const chapterNum = item.chapterNumber ?? '?';
  const lines = [
    '<b>✨ Новая глава в закладках</b>',
    '',
    `<b>${title}</b>`,
    `<b>📖 Глава ${chapterNum}</b>`,
  ];
  return lines.join('\n');
}

function getImageUrls(coverImage) {
  if (!coverImage || typeof coverImage !== 'string') return [];
  const path = coverImage.trim();
  if (!path) return [];
  if (path.startsWith('http://') || path.startsWith('https://')) return [path];
  const serverBase = config.imageBaseUrl.replace(/\/$/, '');
  const serverUrl = path.startsWith('/')
    ? serverBase + path
    : serverBase + '/' + path;
  const urls = [];
  if (config.imageCloudBaseUrl) {
    let cloudPath = path.startsWith('/') ? path : '/' + path;
    if (cloudPath.startsWith('/uploads/')) {
      cloudPath = cloudPath.slice('/uploads'.length);
    } else if (cloudPath.startsWith('uploads/')) {
      cloudPath = '/' + cloudPath.slice('uploads'.length);
    }
    const cloudUrl = cloudPath.startsWith('/')
      ? config.imageCloudBaseUrl + cloudPath
      : config.imageCloudBaseUrl + '/' + cloudPath;
    urls.push(cloudUrl);
  }
  urls.push(serverUrl);
  return urls;
}

async function fetchImageBufferFromUrls(urls, timeoutMs = 15000) {
  if (!Array.isArray(urls) || urls.length === 0) return null;
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; TomiloLibBot/1.0; +https://tomilo-lib.ru)',
          Accept: 'image/*',
        },
      });
      clearTimeout(to);
      if (!res.ok) continue;
      return Buffer.from(await res.arrayBuffer());
    } catch (_) {}
  }
  return null;
}

async function apiFetch(path, options = {}) {
  const url = `${config.apiUrl}${path}`;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (config.botApiSecret) {
    headers['X-Bot-Api-Secret'] = config.botApiSecret;
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchPendingNotifications() {
  const json = await apiFetch('/telegram/bot/pending-chapter-notifications?limit=30');
  if (!json.success || !Array.isArray(json.data)) {
    throw new Error('Invalid pending-chapter-notifications response');
  }
  return json.data;
}

async function ackNotifications(notificationIds) {
  if (!notificationIds.length) return;
  await apiFetch('/telegram/bot/pending-chapter-notifications/ack', {
    method: 'POST',
    body: JSON.stringify({ notificationIds }),
  });
}

async function sendPersonalNotification(bot, item) {
  const text = formatPersonalChapterMessage(item);
  const opts = {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...siteButton(config.siteUrl, item.titleSlug, item.chapterId),
  };
  const imageUrls = getImageUrls(item.coverImage);
  const photoPayload = imageUrls.length
    ? await fetchImageBufferFromUrls(imageUrls)
    : null;

  if (photoPayload && text.length <= 1024) {
    try {
      await waitForMessageSlot();
      await bot.sendPhoto(item.chatId, photoPayload, opts, {
        filename: 'cover.jpg',
        contentType: 'image/jpeg',
      });
      return true;
    } catch (e) {
      const msg = e && e.message ? String(e.message) : '';
      if (!msg.toLowerCase().includes('caption is too long')) {
        console.warn(
          `[PERSONAL] sendPhoto failed chat=${item.chatId}:`,
          msg.slice(0, 120),
        );
      }
    }
  }

  await waitForMessageSlot();
  await bot.sendMessage(item.chatId, text, opts);
  return true;
}

async function runPersonalNotifications(bot) {
  if (!config.notifyPersonalBookmarks) return;
  if (personalQueueUnsupported) return;
  if (!config.botApiSecret) {
    console.warn(
      '[PERSONAL] BOT_API_SECRET не задан — личные уведомления отключены',
    );
    return;
  }

  let items;
  try {
    items = await fetchPendingNotifications();
  } catch (e) {
    if (/\s404:/.test(String(e.message))) {
      personalQueueUnsupported = true;
      console.warn(
        '[PERSONAL] Очередь личных уведомлений пока не поддерживается API (404); проверка отключена до перезапуска.',
      );
      return;
    }
    console.error('[PERSONAL] Ошибка загрузки очереди:', e.message);
    return;
  }

  if (!items.length) return;

  const delivered = [];
  for (const item of items.slice(0, config.maxPersonalNotificationsPerRun)) {
    if (!item.chatId || !item.notificationId) continue;
    try {
      await sendPersonalNotification(bot, item);
      delivered.push(item.notificationId);
      console.log(
        `[PERSONAL] Sent: ${item.titleName} ch.${item.chapterNumber} → ${item.chatId}`,
      );
    } catch (e) {
      const msg = e && e.message ? String(e.message) : String(e);
      console.error(
        `[PERSONAL] Failed chat=${item.chatId} notification=${item.notificationId}:`,
        msg.slice(0, 160),
      );
    }
  }

  if (delivered.length > 0) {
    try {
      await ackNotifications(delivered);
    } catch (e) {
      console.error('[PERSONAL] Ack failed:', e.message);
    }
  }
}

module.exports = { runPersonalNotifications };
