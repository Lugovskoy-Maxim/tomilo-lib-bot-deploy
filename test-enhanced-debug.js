#!/usr/bin/env node

/**
 * Тест с отладкой для проверки генерации улучшенных обложек
 * Запуск: DEBUG=true node test-enhanced-debug.js
 */

process.env.DEBUG = 'true';
process.env.ENABLE_ENHANCED_COVERS = 'true';

const { initEnhancedModule } = require('./index-enhanced');

async function runDebugTest() {
  console.log('=== ТЕСТ ОТЛАДКИ УЛУЧШЕННЫХ ОБЛОЖЕК ===\n');
  
  const enhanced = initEnhancedModule({
    enableCovers: true,
    debug: true,
  });
  
  // Тестовые данные
  const testTitle = {
    name: 'Реинкарнация безработного: История о другом мире',
    slug: 'reincarnation-of-the-unemployed',
    coverImage: '/covers/reincarnation-of-the-unemployed.jpg',
    type: 'Манга',
    genres: ['Фэнтези', 'Приключения', 'Исекай', 'Комедия'],
    status: 'Онгоинг',
    rating: 4.7,
    viewsCount: 250000,
    totalChapters: 175,
    releaseYear: 2018,
  };
  
  console.log('1. Тест генерации улучшенной обложки...');
  
  try {
    const startTime = Date.now();
    const coverBuffer = await enhanced.generateEnhancedCover(testTitle, {
      totalChapters: 176,
      isNew: false,
    });
    const endTime = Date.now();
    
    if (coverBuffer) {
      console.log(`✅ Успешно сгенерирована за ${endTime - startTime}мс`);
      console.log(`   Размер: ${coverBuffer.length} байт`);
      
      // Сохраняем для визуальной проверки
      const fs = require('fs').promises;
      await fs.writeFile('debug-enhanced-cover.jpg', coverBuffer);
      console.log('   Сохранено в debug-enhanced-cover.jpg');
      
      // Проверяем кэш
      console.log('   Кэш содержит:', enhanced.clearCoverCache ? 'очищен' : 'не очищен');
    } else {
      console.log('❌ Генерация вернула null');
      console.log('   Возможные причины:');
      console.log('   - Ошибка загрузки оригинальной обложки');
      console.log('   - Ошибка в enhancedCover.generateEnhancedCover');
      console.log('   - Отсутствуют шрифты или ресурсы');
    }
  } catch (error) {
    console.error('❌ Ошибка при генерации:', error.message);
    console.error('Стек:', error.stack);
  }
  
  console.log('\n2. Тест отправки уведомления (без реальной отправки в Telegram)...');
  
  // Мокаем отправку в Telegram
  const originalSendPhotoOrMessage = enhanced.sendPhotoOrMessage;
  let lastPhotoPayload = null;
  enhanced.sendPhotoOrMessage = async function({ photoPayload, text, opts }) {
    console.log('   📤 Мок отправки сообщения:');
    console.log('   Текст:', text.substring(0, 100) + '...');
    console.log('   Есть обложка:', !!photoPayload);
    if (photoPayload) {
      console.log('   Размер обложки:', photoPayload.length, 'байт');
      lastPhotoPayload = photoPayload;
    }
    return { message_id: 1 };
  };
  
  try {
    await enhanced.sendEnhancedNotification({
      title: testTitle.name,
      message: `<b>${testTitle.name}</b>\nТестовое уведомление с улучшенной обложкой`,
      coverImage: testTitle.coverImage,
      titleInfo: testTitle,
      useEnhancedCover: true,
      additionalData: { totalChapters: 176 },
    });
    
    if (lastPhotoPayload) {
      console.log('   ✅ Уведомление подготовлено с обложкой');
    } else {
      console.log('   ⚠️ Уведомление подготовлено БЕЗ обложки');
    }
  } catch (error) {
    console.error('   ❌ Ошибка отправки:', error.message);
  }
  
  // Восстанавливаем оригинальную функцию
  enhanced.sendPhotoOrMessage = originalSendPhotoOrMessage;
  
  console.log('\n3. Проверка конфигурации...');
  console.log('   ENABLE_ENHANCED_COVERS:', process.env.ENABLE_ENHANCED_COVERS);
  console.log('   DEBUG:', process.env.DEBUG);
  console.log('   IMAGE_BASE_URL:', process.env.IMAGE_BASE_URL || 'не установлен');
  console.log('   IMAGE_CLOUD_BASE_URL:', process.env.IMAGE_CLOUD_BASE_URL || 'не установлен');
  
  console.log('\n=== ТЕСТ ЗАВЕРШЕН ===\n');
  console.log('Рекомендации:');
  console.log('1. Проверьте файл debug-enhanced-cover.jpg (если создан)');
  console.log('2. Убедитесь, что оригинальная обложка доступна по URL');
  console.log('3. Проверьте логи выше для диагностики проблем');
}

runDebugTest().catch(error => {
  console.error('Фатальная ошибка:', error);
  process.exit(1);
});