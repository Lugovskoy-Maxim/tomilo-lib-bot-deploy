const ImageGenerator = require('./image-generator');
const fs = require('fs').promises;

async function testGeneration() {
  console.log('Тестирование генерации изображений...');

  // Создаем генератор с настройками
  const generator = new ImageGenerator({
    siteName: 'Tomilo Lib',
    siteUrl: 'https://tomilo-lib.ru',
    // logoPath: path.join(__dirname, 'logo.png') // можно добавить логотип
  });

  try {
    // Тест 1: Генерация обложки для тайтла
    console.log('1. Генерация обложки для тайтла...');
    
    const titleInfo = {
      name: 'Владыка Мертвых',
      coverImage: 'https://cdn.tomilo-lib.ru/titles/6a8dff02d8a905b73af922c4/cover.jpeg',
      chapterNumber: 10,
      type: 'manhua',
      releaseYear: 2026,
      status: 'ongoing',
      genres: ['Монстр', 'Выживание', 'Артефакты'],
      rating: 0,
      viewsCount: 0,
      totalChapters: 11,
    };

    const titleCoverBuffer = await generator.generateTitleCover(titleInfo);
    await fs.writeFile('test-title-cover.jpg', titleCoverBuffer);
    console.log('✓ Обложка тайтла сохранена как test-title-cover.jpg');

    // Тест 2: Генерация промо-изображения для сайта
    console.log('2. Генерация промо-изображения для сайта...');
    
    const siteStats = {
      titlesCount: 5237,
      chaptersCount: 124892,
      usersCount: 15432,
      dailyViews: 48765
    };

    const sitePromoBuffer = await generator.generateSitePromo(siteStats);
    await fs.writeFile('test-site-promo.jpg', sitePromoBuffer);
    console.log('✓ Промо-изображение сохранено как test-site-promo.jpg');

    // Тест 3: Генерация без обложки
    console.log('3. Генерация обложки без изображения...');
    
    const titleInfoNoCover = {
      name: 'Великолепный тайтл без обложки',
      chapterNumber: 45,
      type: 'manga',
      releaseYear: 2023,
      status: 'ongoing',
      genres: ['Комедия', 'Романтика'],
      rating: 4.5,
      viewsCount: 50000,
      totalChapters: 45
    };

    const noCoverBuffer = await generator.generateTitleCover(titleInfoNoCover);
    await fs.writeFile('test-no-cover.jpg', noCoverBuffer);
    console.log('✓ Обложка без изображения сохранена как test-no-cover.jpg');

    console.log('\n✅ Все тесты пройдены успешно!');
    console.log('Сгенерированные файлы:');
    console.log('  - test-title-cover.jpg');
    console.log('  - test-site-promo.jpg');
    console.log('  - test-no-cover.jpg');

  } catch (error) {
    console.error('❌ Ошибка при генерации изображений:', error);
    process.exit(1);
  }
}

// Запуск теста
if (require.main === module) {
  testGeneration();
}

module.exports = { testGeneration };
