const ImageGenerator = require('./image-generator');
const config = require('./config');

/**
 * Улучшенная генерация обложек для тайтлов
 */
class EnhancedCover {
  constructor() {
    this.generator = new ImageGenerator({
      siteName: 'Tomilo Lib',
      siteUrl: config.siteUrl,
      // Можно добавить logoPath: path.join(__dirname, 'assets/logo.png')
    });
  }

  /**
   * Генерирует улучшенную обложку для тайтла
   * @param {Object} titleInfo - Информация о тайтле из API
   * @param {Buffer} [originalCoverBuffer] - Оригинальная обложка (буфер)
   * @returns {Promise<Buffer|null>} Буфер улучшенной обложки или null при ошибке
   */
  async generateEnhancedCover(titleInfo, originalCoverBuffer = null) {
    try {
      // Подготавливаем данные для генератора
      const enhancedTitleInfo = {
        name: titleInfo.name || 'Без названия',
        coverImage: originalCoverBuffer ? `data:image/jpeg;base64,${originalCoverBuffer.toString('base64')}` : null,
        type: titleInfo.type,
        releaseYear: titleInfo.releaseYear,
        status: titleInfo.status,
        genres: Array.isArray(titleInfo.genres) ? titleInfo.genres : [],
        rating: titleInfo.rating,
        viewsCount: titleInfo.viewsCount,
        totalChapters: titleInfo.totalChapters
      };

      // Если есть URL обложки, но нет буфера, попробуем использовать URL
      if (!originalCoverBuffer && titleInfo.coverImage) {
        enhancedTitleInfo.coverImage = titleInfo.coverImage;
      }

      // Генерируем улучшенную обложку
      const enhancedBuffer = await this.generator.generateTitleCover(enhancedTitleInfo);
      return enhancedBuffer;
    } catch (error) {
      console.error('Ошибка при генерации улучшенной обложки:', error.message);
      return null;
    }
  }

  /**
   * Генерирует промо-изображение для сайта
   * @param {Object} stats - Статистика сайта
   * @returns {Promise<Buffer|null>} Буфер промо-изображения
   */
  async generateSitePromo(stats = {}) {
    try {
      const promoBuffer = await this.generator.generateSitePromo(stats);
      return promoBuffer;
    } catch (error) {
      console.error('Ошибка при генерации промо-изображения:', error.message);
      return null;
    }
  }

  /**
   * Создает обложку для нового тайтла на сайте
   * @param {Object} titleInfo - Полная информация о тайтле
   * @returns {Promise<Buffer|null>} Буфер обложки
   */
  async generateNewTitleAnnouncement(titleInfo) {
    try {
      // Специальный шаблон для анонса нового тайтла
      const canvas = require('canvas').createCanvas(1200, 630);
      const ctx = canvas.getContext('2d');

      // Фон
      const gradient = ctx.createLinearGradient(0, 0, 1200, 630);
      gradient.addColorStop(0, '#1a1a2e');
      gradient.addColorStop(1, '#16213e');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1200, 630);

      // Заголовок
      ctx.font = 'bold 64px Arial';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText('✨ НОВЫЙ ТАЙТЛ ✨', 600, 150);

      // Название тайтла
      ctx.font = 'bold 48px Arial';
      ctx.fillStyle = '#00adb5';
      ctx.fillText(titleInfo.name || 'Новый тайтл', 600, 250);

      // Информация
      ctx.font = '28px Arial';
      ctx.fillStyle = '#eeeeee';
      
      const infoLines = [];
      if (titleInfo.type) infoLines.push(`Тип: ${titleInfo.type}`);
      if (titleInfo.releaseYear) infoLines.push(`Год: ${titleInfo.releaseYear}`);
      if (titleInfo.genres && titleInfo.genres.length > 0) {
        infoLines.push(`Жанры: ${titleInfo.genres.slice(0, 3).join(', ')}`);
      }

      infoLines.forEach((line, index) => {
        ctx.fillText(line, 600, 320 + index * 40);
      });

      // Сайт
      ctx.font = 'bold 32px Arial';
      ctx.fillStyle = '#ff2e63';
      ctx.fillText(config.siteUrl, 600, 500);

      // Логотип
      ctx.font = '48px Arial';
      ctx.fillText('📚', 600, 400);

      return canvas.toBuffer('image/jpeg', { quality: 0.9 });
    } catch (error) {
      console.error('Ошибка при генерации анонса:', error.message);
      return null;
    }
  }
}

module.exports = EnhancedCover;