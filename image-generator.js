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
      backgroundColor: '#1a1a2e',
      primaryColor: '#00adb5',
      secondaryColor: '#eeeeee',
      accentColor: '#ff2e63',
      fontFamily: 'Arial',
      logoPath: options.logoPath,
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

    // Фон
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Градиент сверху
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, 'rgba(0, 173, 181, 0.3)');
    gradient.addColorStop(1, 'rgba(255, 46, 99, 0.3)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height * 0.15);

    // Загружаем обложку тайтла, если есть
    let coverImage = null;
    if (titleInfo.coverImage) {
      try {
        coverImage = await loadImage(titleInfo.coverImage);
      } catch (err) {
        console.warn('Не удалось загрузить обложку:', err.message);
      }
    }

    // Рисуем обложку
    if (coverImage) {
      // Обложка слева
      const coverWidth = width * 0.35;
      const coverHeight = height * 0.7;
      const coverX = width * 0.05;
      const coverY = height * 0.15;

      // Скругленные углы для обложки
      ctx.save();
      this.roundRect(ctx, coverX, coverY, coverWidth, coverHeight, 20);
      ctx.clip();
      ctx.drawImage(coverImage, coverX, coverY, coverWidth, coverHeight);
      ctx.restore();

      // Рамка вокруг обложки
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 3;
      this.roundRect(ctx, coverX, coverY, coverWidth, coverHeight, 20);
      ctx.stroke();
    }

    // Информация справа
    const infoX = coverImage ? width * 0.45 : width * 0.1;
    const infoY = height * 0.2;
    const infoWidth = width * 0.5;

    // Название тайтла
    ctx.font = `bold 48px ${fontFamily}`;
    ctx.fillStyle = secondaryColor;
    ctx.textAlign = 'left';
    this.wrapText(ctx, titleInfo.name || 'Без названия', infoX, infoY, infoWidth, 60);

    // Тип и год
    const typeYearY = infoY + 80;
    ctx.font = `24px ${fontFamily}`;
    ctx.fillStyle = primaryColor;
    
    const typeYearText = [
      titleInfo.type ? this.translateType(titleInfo.type) : null,
      titleInfo.releaseYear ? titleInfo.releaseYear.toString() : null
    ].filter(Boolean).join(' · ');
    
    if (typeYearText) {
      ctx.fillText(typeYearText, infoX, typeYearY);
    }

    // Статус
    const statusY = typeYearY + 40;
    if (titleInfo.status) {
      ctx.font = `20px ${fontFamily}`;
      ctx.fillStyle = this.getStatusColor(titleInfo.status);
      ctx.fillText(this.translateStatus(titleInfo.status), infoX, statusY);
    }

    // Жанры
    const genresY = statusY + 40;
    if (titleInfo.genres && titleInfo.genres.length > 0) {
      ctx.font = `20px ${fontFamily}`;
      ctx.fillStyle = secondaryColor;
      const genresText = titleInfo.genres.slice(0, 3).join(' • ');
      ctx.fillText(genresText, infoX, genresY);
    }

    // Рейтинг и просмотры
    const statsY = genresY + 60;
    ctx.font = `bold 22px ${fontFamily}`;
    
    if (titleInfo.rating) {
      ctx.fillStyle = accentColor;
      ctx.fillText(`★ ${titleInfo.rating.toFixed(1)}`, infoX, statsY);
    }

    if (titleInfo.viewsCount) {
      ctx.fillStyle = primaryColor;
      const viewsText = `👁 ${this.formatNumber(titleInfo.viewsCount)}`;
      const viewsWidth = ctx.measureText(viewsText).width;
      ctx.fillText(viewsText, infoX + 150, statsY);
    }

    // Всего глав
    if (titleInfo.totalChapters) {
      ctx.fillStyle = secondaryColor;
      const chaptersText = `Глав: ${titleInfo.totalChapters}`;
      const chaptersWidth = ctx.measureText(chaptersText).width;
      ctx.fillText(chaptersText, infoX + 300, statsY);
    }

    // Логотип и информация о сайте внизу
    await this.drawSiteFooter(ctx, width, height);

    // Возвращаем буфер
    return canvas.toBuffer('image/jpeg', { quality: 0.9 });
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