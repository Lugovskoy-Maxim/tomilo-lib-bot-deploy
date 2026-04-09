process.env.NTBA_FIX_350 = true; // убирает DeprecationWarning при отправке Buffer
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const EnhancedCover = require('./enhanced-cover');
const fs = require('fs').promises;
const path = require('path');

// Динамический импорт fetch (поддерживает Node.js 18+ и node-fetch)
let fetch;
try {
  // Node.js 18+ имеет встроенный fetch
  if (globalThis.fetch) {
    fetch = globalThis.fetch;
  } else {
    // Пытаемся загрузить node-fetch
    fetch = require('node-fetch');
  }
} catch (error) {
  console.warn('Fetch не доступен. Загрузка изображений по URL будет невозможна.');
  fetch = null;
}

const bot = new TelegramBot(config.telegramBotToken, { polling: false });

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';
const ENABLE_ENHANCED_COVERS = process.env.ENABLE_ENHANCED_COVERS !== 'false'; // по умолчанию true

// Telegram limits (practical): photo caption <= 1024 chars, message text <= 4096 chars.
const TG_MAX_CAPTION_LEN = 1024;
const TG_MAX_MESSAGE_LEN = 4096;

// Инициализация улучшенных обложек
const enhancedCover = new EnhancedCover();

// Кэш для уже сгенерированных обложек (чтобы не генерировать повторно)
const coverCache = new Map();

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

/**
 * Загружает изображение по URL или из файла
 * @param {string} imageUrl - URL изображения (может быть относительным)
 * @returns {Promise<Buffer|null>} Буфер изображения или null при ошибке
 */
async function fetchImageBuffer(imageUrl) {
  if (!imageUrl) return null;

  try {
    // Если URL уже абсолютный
    if (imageUrl.startsWith('http')) {
      if (!fetch) {
        throw new Error('Fetch не доступен для загрузки изображений по URL');
      }
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    // Если относительный путь, пробуем оба базовых URL
    if (imageUrl.startsWith('/')) {
      imageUrl = imageUrl.substring(1); // убираем ведущий слэш
    }

    const urlsToTry = [];
    if (config.imageCloudBaseUrl) {
      urlsToTry.push(`${config.imageCloudBaseUrl}/${imageUrl}`);
    }
    if (config.imageBaseUrl) {
      urlsToTry.push(`${config.imageBaseUrl}/${imageUrl}`);
    }
    // Также пробуем оригинальный URL, если он был относительным
    if (!imageUrl.startsWith('http') && !imageUrl.startsWith('.')) {
      urlsToTry.push(`https://tomilo-lib.ru/${imageUrl}`);
    }

    for (const url of urlsToTry) {
      try {
        if (!fetch) continue;
        const response = await fetch(url);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          return Buffer.from(arrayBuffer);
        }
      } catch (err) {
        // Пробуем следующий URL
        continue;
      }
    }

    // Если ничего не сработало, пробуем как локальный файл
    if (imageUrl.startsWith('.') || imageUrl.startsWith('/')) {
      return await fs.readFile(imageUrl);
    }

    throw new Error('Не удалось загрузить изображение ни по одному из URL');
  } catch (error) {
    if (DEBUG) console.warn(`Не удалось загрузить изображение ${imageUrl}:`, error.message);
    return null;
  }
}

/**
 * Генерирует улучшенную обложку для тайтла
 * @param {Object} titleInfo - Информация о тайтле
 * @param {string} titleInfo.name - Название
 * @param {string} titleInfo.coverImage - URL обложки
 * @param {Object} additionalData - Дополнительные данные для генерации
 * @returns {Promise<Buffer|null>} Буфер улучшенной обложки или null
 */
async function generateEnhancedCover(titleInfo, additionalData = {}) {
  if (!ENABLE_ENHANCED_COVERS) {
    if (DEBUG) console.log('Генерация улучшенных обложек отключена (ENABLE_ENHANCED_COVERS=false)');
    return null;
  }

  const cacheKey = `${titleInfo.name}_${titleInfo.coverImage}`;
  if (coverCache.has(cacheKey)) {
    if (DEBUG) console.log(`Используем кэшированную обложку для "${titleInfo.name}"`);
    return coverCache.get(cacheKey);
  }

  try {
    if (DEBUG) console.log(`Начинаем генерацию улучшенной обложки для "${titleInfo.name}"`);
    
    // Загружаем оригинальную обложку
    let originalCoverBuffer = null;
    if (titleInfo.coverImage) {
      if (DEBUG) console.log(`Пытаемся загрузить обложку: ${titleInfo.coverImage}`);
      originalCoverBuffer = await fetchImageBuffer(titleInfo.coverImage);
      if (originalCoverBuffer) {
        if (DEBUG) console.log(`Оригинальная обложка загружена (${originalCoverBuffer.length} байт)`);
      } else {
        if (DEBUG) console.warn(`Не удалось загрузить оригинальную обложку: ${titleInfo.coverImage}`);
      }
    } else {
      if (DEBUG) console.log('У тайтла нет обложки для загрузки');
    }

    // Объединяем данные
    const enhancedData = {
      ...titleInfo,
      ...additionalData,
      // Добавляем статистику, если есть
      viewsCount: additionalData.viewsCount || titleInfo.viewsCount,
      rating: additionalData.rating || titleInfo.rating,
      totalChapters: additionalData.totalChapters || titleInfo.totalChapters,
    };

    if (DEBUG) {
      console.log('Данные для генерации:', {
        name: enhancedData.name,
        hasCover: !!originalCoverBuffer,
        viewsCount: enhancedData.viewsCount,
        rating: enhancedData.rating,
        totalChapters: enhancedData.totalChapters,
      });
    }

    // Генерируем улучшенную обложку
    const enhancedBuffer = await enhancedCover.generateEnhancedCover(enhancedData, originalCoverBuffer);
    
    if (enhancedBuffer) {
      coverCache.set(cacheKey, enhancedBuffer);
      if (DEBUG) console.log(`Сгенерирована улучшенная обложка для "${titleInfo.name}" (${enhancedBuffer.length} байт)`);
    } else {
      if (DEBUG) console.warn(`enhancedCover.generateEnhancedCover вернул null для "${titleInfo.name}"`);
    }
    
    return enhancedBuffer;
  } catch (error) {
    console.error('Ошибка при генерации улучшенной обложки:', error.message);
    if (DEBUG) console.error('Стек ошибки:', error.stack);
    return null;
  }
}

/**
 * Форматирует строку с главами
 * @param {object} opts - { forceRange?: boolean } — при true для нескольких глав всегда показывать диапазон "Главы 1–88", не перечисление
 */
function formatChaptersLine(chapters, opts = {}) {
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
  const forceRange = opts.forceRange === true;
  const consecutive = !forceRange && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  const range = forceRange || consecutive
    ? `Главы ${nums[0]}–${nums[nums.length - 1]}`
    : `Главы ${nums.join(', ')}`;
  const line = dateStr ? `${range} 💎 · ${dateStr}` : `${range} 💎`;
  return line;
}

/**
 * Основная функция для отправки уведомления с улучшенной обложкой
 * @param {Object} options - Параметры уведомления
 * @param {string} options.title - Название тайтла
 * @param {string} options.message - Текст сообщения
 * @param {string} options.coverImage - URL оригинальной обложки
 * @param {Object} options.titleInfo - Полная информация о тайтле для генерации
 * @param {boolean} options.useEnhancedCover - Использовать улучшенную обложку
 * @param {Object} options.additionalData - Дополнительные данные для генерации
 */
async function sendEnhancedNotification(options) {
  const {
    title,
    message,
    coverImage,
    titleInfo = {},
    useEnhancedCover = true,
    additionalData = {},
  } = options;

  let photoPayload = null;
  let finalMessage = message;

  // Если есть обложка и разрешены улучшенные обложки
  if (coverImage && useEnhancedCover) {
    if (DEBUG) console.log(`Попытка генерации улучшенной обложки для "${title}"`);
    
    const enhancedCoverBuffer = await generateEnhancedCover(
      { name: title, coverImage, ...titleInfo },
      additionalData
    );
    
    if (enhancedCoverBuffer) {
      photoPayload = enhancedCoverBuffer;
      if (DEBUG) console.log(`✅ Используем улучшенную обложку для "${title}"`);
    } else {
      if (DEBUG) console.log(`❌ Не удалось сгенерировать улучшенную обложку для "${title}", пробуем оригинальную`);
      // Если не удалось сгенерировать улучшенную, пробуем использовать оригинальную
      try {
        const originalBuffer = await fetchImageBuffer(coverImage);
        if (originalBuffer) {
          photoPayload = originalBuffer;
          if (DEBUG) console.log(`📷 Используем оригинальную обложку для "${title}"`);
        } else {
          if (DEBUG) console.log(`⚠️ Не удалось загрузить и оригинальную обложку для "${title}"`);
        }
      } catch (error) {
        if (DEBUG) console.warn(`Не удалось загрузить оригинальную обложку: ${error.message}`);
      }
    }
  } else {
    if (DEBUG) {
      if (!coverImage) console.log(`Нет обложки для "${title}"`);
      if (!useEnhancedCover) console.log(`Улучшенные обложки отключены для "${title}"`);
    }
  }

  // Отправляем сообщение с обложкой или без
  await sendPhotoOrMessage({
    photoPayload,
    text: finalMessage,
    opts: { parse_mode: 'HTML' },
  });
}

/**
 * Обработка новых глав с улучшенными обложками
 * @param {Array} newChapters - Массив новых глав
 * @param {Object} titleInfo - Информация о тайтле
 */
async function handleNewChaptersWithEnhancedCovers(newChapters, titleInfo) {
  if (!newChapters || newChapters.length === 0) return;

  const chaptersLine = formatChaptersLine(newChapters, { forceRange: newChapters.length > 3 });
  
  const message = `
<b>${titleInfo.name}</b>
${chaptersLine}

<a href="${config.siteUrl}/title/${titleInfo.slug}">Читать на сайте</a>
  `.trim();

  await sendEnhancedNotification({
    title: titleInfo.name,
    message,
    coverImage: titleInfo.coverImage,
    titleInfo,
    useEnhancedCover: true,
    additionalData: {
      totalChapters: titleInfo.totalChapters,
      rating: titleInfo.rating,
      viewsCount: titleInfo.viewsCount,
    },
  });
}

/**
 * Обработка нового тайтла с улучшенной обложкой
 * @param {Object} titleInfo - Информация о новом тайтле
 */
async function handleNewTitleWithEnhancedCover(titleInfo) {
  const message = `
<b>✨ НОВЫЙ ТАЙТЛ ✨</b>

<b>${titleInfo.name}</b>
${titleInfo.type ? `Тип: ${titleInfo.type}` : ''}
${titleInfo.genres ? `Жанры: ${Array.isArray(titleInfo.genres) ? titleInfo.genres.join(', ') : titleInfo.genres}` : ''}
${titleInfo.status ? `Статус: ${titleInfo.status}` : ''}

<a href="${config.siteUrl}/title/${titleInfo.slug}">Открыть на сайте</a>
  `.trim();

  // Генерируем специальную обложку для анонса нового тайтла
  let photoPayload = null;
  if (ENABLE_ENHANCED_COVERS) {
    try {
      const announcementBuffer = await enhancedCover.generateNewTitleAnnouncement(titleInfo);
      if (announcementBuffer) {
        photoPayload = announcementBuffer;
      }
    } catch (error) {
      console.error('Ошибка при генерации обложки анонса:', error.message);
    }
  }

  // Если не удалось сгенерировать специальную обложку, используем обычную улучшенную
  if (!photoPayload) {
    await sendEnhancedNotification({
      title: titleInfo.name,
      message,
      coverImage: titleInfo.coverImage,
      titleInfo,
      useEnhancedCover: true,
    });
  } else {
    // Отправляем сгенерированную обложку анонса
    await sendPhotoOrMessage({
      photoPayload,
      text: message,
      opts: { parse_mode: 'HTML' },
    });
  }
}

/**
 * Очистка кэша обложек
 */
function clearCoverCache() {
  coverCache.clear();
  if (DEBUG) console.log('Кэш обложек очищен');
}

/**
 * Логирование с уровнем важности
 * @param {string} level - Уровень (info, warn, error)
 * @param {string} message - Сообщение
 * @param {any} [data] - Дополнительные данные
 */
function log(level, message, data) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `${prefix} ${message}`,
    data !== undefined ? data : ''
  );
}

/**
 * Обработка ошибок при отправке уведомлений
 * @param {Error} error - Ошибка
 * @param {string} context - Контекст операции
 */
async function handleNotificationError(error, context) {
  log('error', `Ошибка в ${context}:`, error.message);
  
  // Если ошибка связана с Telegram, можно попробовать отправить текстовое сообщение
  if (error.message.includes('ETELEGRAM') || error.message.includes('chat not found')) {
    try {
      await sendMessageSafe(
        `⚠️ Ошибка при отправке уведомления: ${error.message.slice(0, 100)}`,
        { parse_mode: 'HTML' }
      );
    } catch (fallbackError) {
      log('error', 'Не удалось отправить даже сообщение об ошибке:', fallbackError.message);
    }
  }
}

/**
 * Пример использования модуля
 */
async function exampleUsage() {
  log('info', 'Запуск примера использования улучшенных обложек');
  
  const exampleTitle = {
    name: 'Реинкарнация безработного',
    slug: 'reincarnation-of-the-unemployed',
    coverImage: '/covers/reincarnation-of-the-unemployed.jpg',
    type: 'Манга',
    genres: ['Фэнтези', 'Приключения', 'Исекай'],
    status: 'Онгоинг',
    rating: 4.8,
    viewsCount: 125000,
    totalChapters: 150,
  };

  const exampleChapters = [
    { chapterNumber: 151, releaseDate: new Date().toISOString() },
    { chapterNumber: 152, releaseDate: new Date().toISOString() },
  ];

  try {
    // Пример 1: Уведомление о новых главах
    await handleNewChaptersWithEnhancedCovers(exampleChapters, exampleTitle);
    
    // Пример 2: Уведомление о новом тайтле
    await handleNewTitleWithEnhancedCover(exampleTitle);
    
    // Пример 3: Генерация обложки без отправки
    const enhancedBuffer = await generateEnhancedCover(exampleTitle, {
      totalChapters: 152,
      isNew: true,
    });
    
    if (enhancedBuffer) {
      log('info', 'Улучшенная обложка успешно сгенерирована');
      // Можно сохранить в файл для проверки
      await fs.writeFile('example-enhanced-cover.jpg', enhancedBuffer);
    }
    
    log('info', 'Пример использования завершен');
  } catch (error) {
    await handleNotificationError(error, 'exampleUsage');
  }
}

/**
 * Инициализация модуля
 */
function initEnhancedModule(options = {}) {
  const { enableCovers = true, debug = false } = options;
  
  if (debug) {
    console.log('Инициализация модуля улучшенных обложек:', {
      enableCovers,
      hasFetch: !!fetch,
      imageBaseUrl: config.imageBaseUrl,
      imageCloudBaseUrl: config.imageCloudBaseUrl,
    });
  }
  
  // Можно добавить дополнительную инициализацию здесь
  
  return {
    sendEnhancedNotification,
    handleNewChaptersWithEnhancedCovers,
    handleNewTitleWithEnhancedCover,
    generateEnhancedCover,
    clearCoverCache,
    sendMessageSafe,
    sendPhotoOrMessage,
    formatChaptersLine,
    exampleUsage,
  };
}

/**
 * Экспортируемые функции
 */
module.exports = {
  sendEnhancedNotification,
  handleNewChaptersWithEnhancedCovers,
  handleNewTitleWithEnhancedCover,
  generateEnhancedCover,
  clearCoverCache,
  // Реэкспорт полезных утилит
  sendMessageSafe,
  sendPhotoOrMessage,
  formatChaptersLine,
  // Новые функции
  initEnhancedModule,
  exampleUsage,
  handleNotificationError,
  log,
};