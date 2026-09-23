const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

/**
 * Генератор изображений для обложек тайтлов с информацией о сайте
 */
class ImageGenerator {
  constructor(options = {}) {
    this.options = {
      width: 1200,
      height: 630,
      backgroundColor: '#111827',
      primaryColor: '#60a5fa',
      secondaryColor: '#f8fafc',
      accentColor: '#a78bfa',
      fontFamily: 'Exo 2',
      logoPath: options.logoPath,
      logoUrl: options.logoUrl || 'https://tomilo-lib.ru/favicons/favicon-512x512.png',
      siteName: options.siteName || 'Tomilo Lib',
      siteUrl: options.siteUrl || 'https://tomilo-lib.ru',
      ...options
    };

    // Попробуем зарегистрировать шрифты, если они есть
    this.registerAvailableFonts();
  }

  /**
   * Регистрирует доступные шрифты
   */
  registerAvailableFonts() {
    const fontPaths = [
      path.join(__dirname, 'fonts', 'Exo2[wght].ttf'),
    ];

    fontPaths.forEach(fontPath => {
      if (fs.existsSync(fontPath)) {
        try {
          registerFont(fontPath, { family: 'Exo 2' });
          this.options.fontFamily = 'Exo 2';
        } catch (err) {
          console.warn(`Не удалось зарегистрировать шрифт ${fontPath}:`, err.message);
        }
      }
    });
  }

  /**
   * Создает изображение обложки для тайтла
   * @param {Object} titleInfo - Информация о тайтле
   * @param {string} titleInfo.name - Название тайтла
   * @param {string} titleInfo.coverImage - URL или путь к обложке
   * @param {string} titleInfo.type - Тип (манга, манхва и т.д.)
   * @param {number} titleInfo.releaseYear - Год выпуска
   * @param {string} titleInfo.status - Статус (онгоинг, завершён)
   * @param {string[]} titleInfo.genres - Жанры
   * @param {number} titleInfo.rating - Рейтинг
   * @param {number} titleInfo.viewsCount - Количество просмотров
   * @param {number} titleInfo.totalChapters - Всего глав
   * @returns {Promise<Buffer>} Буфер изображения
   */
  async generateTitleCover(titleInfo) {
    const { width, height, backgroundColor, primaryColor, secondaryColor, accentColor, fontFamily } = this.options;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Многослойный фирменный градиент: глубокий синий слева плавно уходит
    // в цвет карточки у обложки справа.
    const baseGradient = ctx.createLinearGradient(0, 0, width, height);
    baseGradient.addColorStop(0, '#0b1220');
    baseGradient.addColorStop(0.48, '#172554');
    baseGradient.addColorStop(0.72, backgroundColor);
    baseGradient.addColorStop(1, '#0f172a');
    ctx.fillStyle = baseGradient;
    ctx.fillRect(0, 0, width, height);
    const blueGlow = ctx.createRadialGradient(210, 70, 0, 210, 70, 720);
    blueGlow.addColorStop(0, 'rgba(59, 130, 246, 0.34)');
    blueGlow.addColorStop(0.58, 'rgba(30, 64, 175, 0.12)');
    blueGlow.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = blueGlow;
    ctx.fillRect(0, 0, width, height);
    const violetGlow = ctx.createRadialGradient(680, 610, 0, 680, 610, 520);
    violetGlow.addColorStop(0, 'rgba(139, 92, 246, 0.20)');
    violetGlow.addColorStop(1, 'rgba(139, 92, 246, 0)');
    ctx.fillStyle = violetGlow;
    ctx.fillRect(0, 0, width, height);

    let coverImage = null;
    try {
      if (titleInfo.coverImage) coverImage = await this.loadSourceImage(titleInfo.coverImage);
    } catch (err) {
      console.warn('Не удалось загрузить обложку:', err.message);
    }

    // Обложка тайтла занимает правую часть, без искажения пропорций.
    const coverX = 560;
    const coverWidth = width - coverX;
    if (coverImage) this.drawFadedCover(ctx, coverImage, coverX, 0, coverWidth, height);
    else {
      const fallbackGradient = ctx.createLinearGradient(coverX, 0, width, height);
      fallbackGradient.addColorStop(0, '#1e3a8a');
      fallbackGradient.addColorStop(1, '#5b21b6');
      ctx.fillStyle = fallbackGradient;
      ctx.fillRect(coverX, 0, coverWidth, height);
      const fallbackGlow = ctx.createRadialGradient(width * 0.8, height * 0.28, 0, width * 0.8, height * 0.28, 330);
      fallbackGlow.addColorStop(0, 'rgba(196, 181, 253, 0.42)');
      fallbackGlow.addColorStop(1, 'rgba(196, 181, 253, 0)');
      ctx.fillStyle = fallbackGlow;
      ctx.fillRect(coverX, 0, coverWidth, height);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
      ctx.lineWidth = 2;
      for (let offset = -height; offset < coverWidth; offset += 70) {
        ctx.beginPath();
        ctx.moveTo(coverX + offset, height);
        ctx.lineTo(coverX + offset + height, 0);
        ctx.stroke();
      }
    }

    const logo = await this.loadLogo();
    const logoSize = 74;
    if (logo) ctx.drawImage(logo, 54, 46, logoSize, logoSize);
    ctx.font = `600 30px "${fontFamily}"`;
    ctx.fillStyle = secondaryColor;
    this.drawTextShadow(ctx, this.options.siteName, 148, 92, 'rgba(2, 6, 23, 0.30)', 4);

    ctx.fillStyle = 'rgba(226, 232, 240, 0.78)';
    ctx.font = `700 21px "${fontFamily}"`;
    ctx.fillText('НОВАЯ ГЛАВА', 58, 205);
    ctx.fillStyle = 'rgba(167, 139, 250, 0.88)';
    ctx.fillRect(58, 220, 68, 4);

    ctx.textAlign = 'left';
    ctx.font = `700 54px "${fontFamily}"`;
    ctx.fillStyle = '#f8fafc';
    ctx.shadowColor = 'rgba(2, 6, 23, 0.45)';
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 3;
    const titleBottom = this.drawWrappedText(ctx, titleInfo.name || 'Без названия', 58, 286, 600, 64, 3);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    const chapterNumber = titleInfo.chapterNumber ?? titleInfo.latestChapter ?? titleInfo.chapter;
    const chapterLabel = chapterNumber != null ? `Глава ${chapterNumber}` : 'Новая глава';
    const chapterY = Math.min(titleBottom + 100, 548);
    ctx.font = `700 50px "${fontFamily}"`;
    const chapterWidth = ctx.measureText(chapterLabel).width + 48;
    this.drawRoundedRect(ctx, 42, chapterY - 56, chapterWidth, 72, 18);
    ctx.fillStyle = 'rgba(139, 92, 246, 0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(196, 181, 253, 0.42)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#c4b5fd';
    this.drawTextShadow(ctx, chapterLabel, 66, chapterY, 'rgba(2, 6, 23, 0.42)', 5);

    const meta = [
      titleInfo.type ? this.translateType(titleInfo.type) : '',
      titleInfo.releaseYear ? String(titleInfo.releaseYear) : '',
    ].filter(Boolean).join(' · ');
    if (meta) {
      ctx.font = `500 22px "${fontFamily}"`;
      ctx.fillStyle = 'rgba(248, 250, 252, 0.62)';
      ctx.fillText(meta, 58, 592);
    }

    // Явный CTA превращает карточку анонса в переход на чтение; ссылка
    // остаётся в подписи поста, а здесь работает как короткий визуальный якорь.
    const cta = 'ЧИТАТЬ СЕЙЧАС  ↗';
    ctx.font = `700 22px "${fontFamily}"`;
    const ctaWidth = ctx.measureText(cta).width + 42;
    this.drawRoundedRect(ctx, coverX + 28, height - 74, ctaWidth, 48, 16);
    ctx.fillStyle = 'rgba(8, 12, 24, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(cta, coverX + 49, height - 43);

    return canvas.toBuffer('image/jpeg', { quality: 0.9 });
  }

  drawTextShadow(ctx, text, x, y, color, blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetY = 2;
    ctx.fillText(text, x, y);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  async loadSourceImage(source) {
    if (Buffer.isBuffer(source)) return loadImage(source);
    if (typeof source === 'string' && /^https?:\/\//i.test(source)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(source, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return loadImage(Buffer.from(await response.arrayBuffer()));
    }
    return loadImage(source);
  }

  async loadLogo() {
    if (this.logo) return this.logo;
    try {
      if (this.options.logoPath && fs.existsSync(this.options.logoPath)) {
        this.logo = await loadImage(this.options.logoPath);
      } else {
        this.logo = await this.loadSourceImage(this.options.logoUrl);
      }
      return this.logo;
    } catch (error) {
      console.warn('Не удалось загрузить логотип:', error.message);
      return null;
    }
  }

  drawCoverCrop(ctx, image, x, y, width, height) {
    const sourceRatio = image.width / image.height;
    const targetRatio = width / height;
    let sx = 0; let sy = 0; let sw = image.width; let sh = image.height;
    if (sourceRatio > targetRatio) {
      sw = image.height * targetRatio;
      sx = (image.width - sw) / 2;
    } else {
      sh = image.width / targetRatio;
      sy = (image.height - sh) / 2;
    }
    ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
  }

  /** Рисует обложку справа с настоящим альфа-переходом в фон, без жёсткого края. */
  drawFadedCover(ctx, image, x, y, width, height) {
    const layer = createCanvas(width, height);
    const layerCtx = layer.getContext('2d');
    this.drawCoverCrop(layerCtx, image, 0, 0, width, height);

    const mask = layerCtx.createLinearGradient(0, 0, width, 0);
    mask.addColorStop(0, 'rgba(255, 255, 255, 0)');
    // Узкий мягкий переход: не перекрываем заметную часть самой обложки.
    mask.addColorStop(0.28, 'rgba(255, 255, 255, 0.08)');
    mask.addColorStop(0.50, 'rgba(255, 255, 255, 1)');
    mask.addColorStop(1, 'rgba(255, 255, 255, 1)');
    layerCtx.globalCompositeOperation = 'destination-in';
    layerCtx.fillStyle = mask;
    layerCtx.fillRect(0, 0, width, height);
    ctx.drawImage(layer, x, y);
  }

  drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
        if (lines.length === maxLines) break;
      } else line = next;
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (words.join(' ').length > lines.join(' ').length) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/…?$/, '')}…`;
    lines.forEach((lineText, index) => ctx.fillText(lineText, x, y + index * lineHeight));
    return y + Math.max(0, lines.length - 1) * lineHeight;
  }

  /**
   * Рисует нижнюю часть с информацией о сайте
   */
  async drawSiteFooter(ctx, width, height) {
    const { siteName, siteUrl, logoPath, primaryColor, secondaryColor, fontFamily } = this.options;
    
    const footerY = height * 0.85;
    
    // Линия разделителя
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width * 0.1, footerY);
    ctx.lineTo(width * 0.9, footerY);
    ctx.stroke();

    // Логотип сайта
    let logo = null;
    if (logoPath && fs.existsSync(logoPath)) {
      try {
        logo = await loadImage(logoPath);
      } catch (err) {
        console.warn('Не удалось загрузить логотип:', err.message);
      }
    }

    const logoSize = 40;
    const logoX = width * 0.1;
    const logoY = footerY + 20;

    if (logo) {
      ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
    } else {
      // Запасной логотип
      ctx.fillStyle = primaryColor;
      ctx.font = `bold ${logoSize}px ${fontFamily}`;
      ctx.fillText('📚', logoX, logoY + logoSize);
    }

    // Название сайта и URL
    ctx.font = `bold 28px ${fontFamily}`;
    ctx.fillStyle = secondaryColor;
    ctx.fillText(siteName, logoX + logoSize + 20, logoY + 25);

    ctx.font = `20px ${fontFamily}`;
    ctx.fillStyle = primaryColor;
    ctx.fillText(siteUrl, logoX + logoSize + 20, logoY + 55);

    // Не имитируем QR-заглушку: даём читателю реальный адрес сайта.
    ctx.textAlign = 'right';
    ctx.font = `600 20px "${fontFamily}"`;
    ctx.fillStyle = secondaryColor;
    ctx.fillText('ОТКРЫТЬ БИБЛИОТЕКУ ↗', width * 0.9, logoY + 32);
    ctx.textAlign = 'left';
  }

  /**
   * Создает промо-изображение для сайта
   * @param {Object} stats - Статистика сайта
   * @returns {Promise<Buffer>} Буфер изображения
   */
  async generateSitePromo(stats = {}) {
    const { width, height, backgroundColor, primaryColor, secondaryColor, accentColor, fontFamily } = this.options;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Контрастная рекламная композиция: одна ценность, три свойства,
    // призыв к действию. Не подставляем выдуманную статистику.
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#080b16');
    gradient.addColorStop(0.58, '#171538');
    gradient.addColorStop(1, '#26164b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(940, 130, 10, 940, 130, 500);
    glow.addColorStop(0, 'rgba(124, 92, 255, 0.35)');
    glow.addColorStop(1, 'rgba(124, 92, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'left';
    ctx.font = `600 24px "${fontFamily}"`;
    ctx.fillStyle = '#b8aaff';
    ctx.fillText('TOMILO LIB  ·  ЧИТАЙТЕ ОНЛАЙН', 76, 82);
    ctx.font = `800 67px "${fontFamily}"`;
    ctx.fillStyle = secondaryColor;
    ctx.fillText('Найдите свою', 72, 190);
    ctx.fillText('следующую историю', 72, 268);
    ctx.font = `500 27px "${fontFamily}"`;
    ctx.fillStyle = 'rgba(248,250,252,0.76)';
    ctx.fillText('Манга, манхва и маньхуа — в одной библиотеке', 78, 328);

    const features = ['Новые главы', 'Удобная читалка', 'Закладки и прогресс'];
    ctx.font = `600 21px "${fontFamily}"`;
    features.forEach((label, index) => {
      const x = 78 + index * 300;
      this.drawRoundedRect(ctx, x, 374, 270, 54, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(label, x + 18, 408);
    });

    const suppliedStats = [
      ['Тайтлов', stats.titlesCount],
      ['Глав', stats.chaptersCount],
      ['Читателей', stats.usersCount],
    ].filter(([, value]) => value != null && value !== '');
    if (suppliedStats.length) {
      ctx.font = `700 23px "${fontFamily}"`;
      suppliedStats.forEach(([label, value], index) => {
        const x = 82 + index * 230;
        ctx.fillStyle = '#d9d1ff';
        ctx.fillText(String(value), x, 488);
        ctx.font = `500 16px "${fontFamily}"`;
        ctx.fillStyle = 'rgba(248,250,252,0.62)';
        ctx.fillText(label, x, 514);
        ctx.font = `700 23px "${fontFamily}"`;
      });
    }

    this.drawRoundedRect(ctx, 78, 542, 328, 62, 20);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.font = `700 24px "${fontFamily}"`;
    ctx.fillStyle = '#090b14';
    ctx.fillText('ОТКРЫТЬ БИБЛИОТЕКУ  ↗', 101, 581);
    ctx.font = `500 21px "${fontFamily}"`;
    ctx.fillStyle = 'rgba(248,250,252,0.66)';
    ctx.fillText(this.options.siteUrl.replace(/^https?:\/\//, ''), 810, 585);

    return canvas.toBuffer('image/jpeg', { quality: 0.9 });
  }

  /**
   * Вспомогательные методы
   */

  wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let lineY = y;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;

      if (testWidth > maxWidth && i > 0) {
        ctx.fillText(line, x, lineY);
        line = words[i] + ' ';
        lineY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, lineY);
  }

  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  translateType(type) {
    const types = {
      'manhwa': 'Манхва',
      'manga': 'Манга',
      'manhua': 'Маньхуа',
      'webtoon': 'Вебтун',
      'webcomic': 'Вебкомикс'
    };
    return types[type.toLowerCase()] || type;
  }

  translateStatus(status) {
    const statuses = {
      'ongoing': 'Онгоинг',
      'completed': 'Завершён',
      'pause': 'Пауза',
      'cancelled': 'Отменён'
    };
    return statuses[status.toLowerCase()] || status;
  }

  getStatusColor(status) {
    const colors = {
      'ongoing': '#00adb5',
      'completed': '#4CAF50',
      'pause': '#FF9800',
      'cancelled': '#F44336'
    };
    return colors[status.toLowerCase()] || '#eeeeee';
  }

  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }
}

module.exports = ImageGenerator;
