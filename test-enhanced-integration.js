#!/usr/bin/env node

/**
 * Тест интеграции улучшенных обложек
 * Запуск: node test-enhanced-integration.js
 */

const { initEnhancedModule, exampleUsage } = require('./index-enhanced');

async function runTests() {
  console.log('=== Тестирование модуля улучшенных обложек ===\n');
  
  // Инициализация с отладкой
  const enhancedModule = initEnhancedModule({
    enableCovers: true,
    debug: true,
  });
  
  console.log('1. Проверка экспортируемых функций...');
  const requiredFunctions = [
    'sendEnhancedNotification',
    'handleNewChaptersWithEnhancedCovers',
    'handleNewTitleWithEnhancedCover',
    'generateEnhancedCover',
    'clearCoverCache',
    'sendMessageSafe',
    'sendPhotoOrMessage',
    'formatChaptersLine',
  ];
  
  let allFunctionsPresent = true;
  for (const funcName of requiredFunctions) {
    if (typeof enhancedModule[funcName] === 'function') {
      console.log(`   ✓ ${funcName}`);
    } else {
      console.log(`   ✗ ${funcName} отсутствует`);
      allFunctionsPresent = false;
    }
  }
  
  if (!allFunctionsPresent) {
    console.error('\n❌ Не все функции экспортированы');
    process.exit(1);
  }
  
  console.log('\n2. Тест форматирования глав...');
  const testChapters = [
    { chapterNumber: 1, releaseDate: '2024-01-15' },
    { chapterNumber: 2, releaseDate: '2024-01-16' },
    { chapterNumber: 3, releaseDate: '2024-01-17' },
  ];
  
  const formatted = enhancedModule.formatChaptersLine(testChapters);
  console.log(`   Результат: "${formatted}"`);
  
  console.log('\n3. Тест генерации улучшенной обложки (без реальной загрузки изображений)...');
  
  // Мокаем fetch, чтобы не делать реальные HTTP-запросы
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
  });
  
  const mockTitleInfo = {
    name: 'Тестовый тайтл',
    coverImage: '/covers/test.jpg',
    type: 'Манга',
    genres: ['Фэнтези', 'Комедия'],
    status: 'Онгоинг',
    rating: 4.5,
    viewsCount: 10000,
    totalChapters: 50,
  };
  
  try {
    // Этот вызов должен завершиться без ошибок, даже если изображение не загрузится
    const coverBuffer = await enhancedModule.generateEnhancedCover(mockTitleInfo, {
      totalChapters: 51,
    });
    
    if (coverBuffer) {
      console.log('   ✓ Обложка сгенерирована');
      // Можно сохранить для визуальной проверки
      const fs = require('fs').promises;
      await fs.writeFile('test-output-cover.jpg', coverBuffer);
      console.log('   Сохранено в test-output-cover.jpg');
    } else {
      console.log('   ⚠️ Обложка не сгенерирована (ожидаемо при тесте без реальных изображений)');
    }
  } catch (error) {
    console.log(`   ⚠️ Ошибка генерации (ожидаемо): ${error.message}`);
  }
  
  console.log('\n4. Тест очистки кэша...');
  enhancedModule.clearCoverCache();
  console.log('   ✓ Кэш очищен');
  
  console.log('\n5. Запуск примера использования...');
  console.log('   (Этот пример может пытаться отправлять сообщения в Telegram)');
  console.log('   Для реального теста раскомментируйте строку ниже\n');
  // await exampleUsage();
  
  console.log('=== Тестирование завершено ===\n');
  console.log('Рекомендации:');
  console.log('1. Убедитесь, что переменные окружения TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID установлены');
  console.log('2. Для реального теста раскомментируйте вызов exampleUsage()');
  console.log('3. Проверьте наличие зависимостей: node-fetch, canvas');
  console.log('4. Добавьте ENABLE_ENHANCED_COVERS=true в .env для включения генерации обложек');
}

// Обработка ошибок
runTests().catch(error => {
  console.error('❌ Ошибка при тестировании:', error);
  process.exit(1);
});