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
      fontFamily: 'Arial',
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
      path.join(__dirname, 'fonts', 'Roboto-Bold.ttf'),
      path.join(__dirname, 'fonts', 'Roboto-Regular.ttf'),
      path.join(__dirname, 'fonts', 'Arial.ttf'),
    ];

    fontPaths.forEach(fontPath => {
      if (fs.existsSync(fontPath)) {
        try {
          const fontName = path.basename(fontPath, '.ttf');
          registerFont(fontPath, { family: fontName });
          if (fontName.includes('Roboto')) {
            this.options.fontFamily = fontName;
          }
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
      fallbackGradient.addColorStop(0, '#172554');
      fallbackGradient.addColorStop(1, '#312e81');
      ctx.fillStyle = fallbackGradient;
      ctx.fillRect(coverX, 0, coverWidth, height);
      ctx.font = `bold 180px ${fontFamily}`;
      ctx.fillStyle = 'rgba(248, 250, 252, 0.10)';
      ctx.textAlign = 'center';
      ctx.fillText('TL', coverX + coverWidth * 0.62, height * 0.58);
      ctx.textAlign = 'left';
    }

    const logo = await this.loadLogo();
    const logoSize = 74;
    if (logo) ctx.drawImage(logo, 54, 46, logoSize, logoSize);
    ctx.font = `bold 28px ${fontFamily}`;
    ctx.fillStyle = secondaryColor;
    ctx.fillText(this.options.siteName, 148, 92);

    ctx.fillStyle = 'rgba(248, 250, 252, 0.68)';
    ctx.font = `bold 23px ${fontFamily}`;
    ctx.fillText('НОВАЯ ГЛАВА', 58, 205);

    ctx.textAlign = 'left';
    ctx.font = `bold 52px ${fontFamily}`;
    ctx.fillStyle = 'rgba(248, 250, 252, 0.88)';
    const titleBottom = this.drawWrappedText(ctx, titleInfo.name || 'Без названия', 58, 282, 630, 62, 3);

    const chapterNumber = titleInfo.chapterNumber ?? titleInfo.latestChapter ?? titleInfo.chapter;
    const chapterLabel = chapterNumber != null ? `Глава ${chapterNumber}` : 'Новая глава';
    ctx.font = `bold 58px ${fontFamily}`;
    ctx.fillStyle = 'rgba(167, 139, 250, 0.72)';
    ctx.fillText(chapterLabel, 58, Math.min(titleBottom + 88, 560));

    const meta = [
      titleInfo.type ? this.translateType(titleInfo.type) : '',
      titleInfo.releaseYear ? String(titleInfo.releaseYear) : '',
    ].filter(Boolean).join(' · ');
    if (meta) {
      ctx.font = `22px ${fontFamily}`;
      ctx.fillStyle = 'rgba(248, 250, 252, 0.62)';
      ctx.fillText(meta, 58, 592);
    }

    return canvas.toBuffer('image/jpeg', { quality: 0.9 });
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
    mask.addColorStop(0.42, 'rgba(255, 255, 255, 0.12)');
    mask.addColorStop(0.64, 'rgba(255, 255, 255, 1)');
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

    // QR код или дополнительная информация
    const qrX = width * 0.7;
    const qrY = footerY + 10;
    const qrSize = 60;

    // Простой QR-код (заглушка)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(qrX, qrY, qrSize, qrSize);
    ctx.fillStyle = '#000000';
    ctx.font = `bold 12px ${fontFamily}`;
    ctx.fillText('QR', qrX + qrSize/2 - 10, qrY + qrSize/2 + 5);
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

    // Градиентный фон
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(1, '#16213e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Заголовок
    ctx.font = `bold 64px ${fontFamily}`;
    ctx.fillStyle = secondaryColor;
    ctx.textAlign = 'center';
    ctx.fillText('Tomilo Lib', width / 2, height * 0.2);

    // Подзаголовок
    ctx.font = `28px ${fontFamily}`;
    ctx.fillStyle = primaryColor;
    ctx.fillText('Крупнейшая библиотека манги, манхвы и маньхуа', width / 2, height * 0.3);

    // Статистика
    const statsY = height * 0.45;
    const statSpacing = width / 4;

    const statistics = [
      { label: 'Тайтлов', value: stats.titlesCount || '5000+', icon: '📚' },
      { label: 'Глав', value: stats.chaptersCount || '100000+', icon: '📖' },
      { label: 'Пользователей', value: stats.usersCount || '10000+', icon: '👥' },
      { label: 'Ежедневно', value: stats.dailyViews || '50000+', icon: '🔥' }
    ];

    statistics.forEach((stat, index) => {
      const x = statSpacing * (index + 0.5);
      
      ctx.font = `bold 48px ${fontFamily}`;
      ctx.fillStyle = accentColor;
      ctx.fillText(stat.icon, x - 30, statsY);
      
      ctx.font = `bold 36px ${fontFamily}`;
      ctx.fillStyle = secondaryColor;
      ctx.fillText(stat.value, x + 20, statsY);
      
      ctx.font = `20px ${fontFamily}`;
      ctx.fillStyle = primaryColor;
      ctx.fillText(stat.label, x, statsY + 50);
    });

    // Призыв к действию
    ctx.font = `bold 32px ${fontFamily}`;
    ctx.fillStyle = secondaryColor;
    ctx.fillText('Присоединяйтесь к нашему сообществу!', width / 2, height * 0.7);

    // URL сайта
    ctx.font = `28px ${fontFamily}`;
    ctx.fillStyle = primaryColor;
    ctx.fillText('https://tomilo-lib.ru', width / 2, height * 0.8);

    // Нижняя часть с логотипом
    await this.drawSiteFooter(ctx, width, height);

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
