# Улучшенная генерация и интеграция обложек

Модуль `index-enhanced.js` предоставляет расширенные возможности для генерации и отправки обложек тайтлов в Telegram с улучшенным дизайном и автоматической интеграцией.

## Основные возможности

1. **Генерация улучшенных обложек** – создание профессионально оформленных изображений с информацией о тайтле
2. **Интеграция с Telegram** – автоматическая отправка обложек с корректной обработкой ошибок
3. **Кэширование** – избежание повторной генерации одинаковых обложек
4. **Поддержка нескольких источников изображений** – загрузка обложек с локального сервера, облака или по URL
5. **Гибкая конфигурация** – настройка через переменные окружения

## Установка и настройка

### 1. Зависимости

Убедитесь, что установлены все необходимые пакеты:

```bash
npm install node-telegram-bot-api canvas
# или для Node.js < 18
npm install node-fetch
```

### 2. Переменные окружения

Добавьте в `.env` файл:

```env
# Основные настройки Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# URL сайта и изображений
SITE_URL=https://tomilo-lib.ru
IMAGE_BASE_URL=https://tomilo-lib.ru
IMAGE_CLOUD_BASE_URL=https://s3.regru.cloud/tomilolib

# Включение улучшенных обложек (по умолчанию true)
ENABLE_ENHANCED_COVERS=true

# Отладка
DEBUG=true
```

### 3. Импорт и использование

#### Базовое использование:

```javascript
const { 
  sendEnhancedNotification,
  handleNewChaptersWithEnhancedCovers,
  handleNewTitleWithEnhancedCover 
} = require('./index-enhanced');

// Уведомление о новых главах
await handleNewChaptersWithEnhancedCovers(chapters, titleInfo);

// Уведомление о новом тайтле
await handleNewTitleWithEnhancedCover(titleInfo);

// Прямая отправка с улучшенной обложкой
await sendEnhancedNotification({
  title: 'Название тайтла',
  message: 'Текст сообщения с HTML-разметкой',
  coverImage: '/covers/title.jpg',
  titleInfo: { /* полная информация о тайтле */ },
  useEnhancedCover: true,
});
```

#### Расширенное использование с инициализацией:

```javascript
const { initEnhancedModule } = require('./index-enhanced');

const enhanced = initEnhancedModule({
  enableCovers: true,
  debug: process.env.DEBUG === 'true'
});

// Использование методов
const coverBuffer = await enhanced.generateEnhancedCover(titleInfo, additionalData);
enhanced.clearCoverCache();
```

## Примеры

### Пример 1: Интеграция с существующим ботом

```javascript
const { handleNewChaptersWithEnhancedCovers } = require('./index-enhanced');

async function onNewChaptersDetected(newChapters, titleInfo) {
  try {
    await handleNewChaptersWithEnhancedCovers(newChapters, titleInfo);
    console.log('Уведомление отправлено с улучшенной обложкой');
  } catch (error) {
    console.error('Ошибка отправки:', error);
  }
}
```

### Пример 2: Генерация обложки без отправки

```javascript
const { generateEnhancedCover } = require('./index-enhanced');

async function createCoverForTitle(titleInfo) {
  const buffer = await generateEnhancedCover(titleInfo, {
    totalChapters: titleInfo.totalChapters,
    rating: titleInfo.rating,
    isNew: false,
  });
  
  if (buffer) {
    // Сохранение в файл
    await require('fs').promises.writeFile('cover.jpg', buffer);
    return buffer;
  }
  return null;
}
```

## Структура данных

### Информация о тайтле (titleInfo)

```javascript
{
  name: 'Название тайтла',
  slug: 'title-slug',
  coverImage: '/covers/title.jpg', // URL или путь к обложке
  type: 'Манга', // Тип контента
  genres: ['Фэнтези', 'Приключения'],
  status: 'Онгоинг',
  rating: 4.8, // Рейтинг от 0 до 5
  viewsCount: 125000, // Количество просмотров
  totalChapters: 150, // Всего глав
  releaseYear: 2020,
  // Дополнительные поля по необходимости
}
```

### Главы (chapters)

```javascript
[
  {
    chapterNumber: 151,
    releaseDate: '2024-01-15T10:30:00Z' // ISO строка
  },
  // ...
]
```

## Конфигурация

### Переменные окружения

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `ENABLE_ENHANCED_COVERS` | `true` | Включить генерацию улучшенных обложек |
| `DEBUG` | `false` | Режим отладки с подробным логированием |
| `IMAGE_BASE_URL` | `SITE_URL` | Базовый URL для загрузки изображений |
| `IMAGE_CLOUD_BASE_URL` | `https://s3.regru.cloud/tomilolib` | Облачный URL для изображений |

### Программная конфигурация

При инициализации модуля можно передать параметры:

```javascript
initEnhancedModule({
  enableCovers: true,    // Включить обложки
  debug: true,           // Отладка
  cacheTTL: 3600000,     // Время жизни кэша (1 час)
});
```

## Обработка ошибок

Модуль включает встроенную обработку ошибок:

1. **Ошибки загрузки изображений** – автоматический переход к следующему источнику
2. **Ошибки Telegram** – повторные попытки и отправка текстовых сообщений
3. **Ошибки генерации** – возврат к оригинальным обложкам

```javascript
const { handleNotificationError } = require('./index-enhanced');

try {
  await sendEnhancedNotification(options);
} catch (error) {
  await handleNotificationError(error, 'sendEnhancedNotification');
}
```

## Тестирование

Для проверки работы модуля используйте тестовый скрипт:

```bash
node test-enhanced-integration.js
```

Или запустите пример использования:

```javascript
const { exampleUsage } = require('./index-enhanced');
await exampleUsage();
```

## Интеграция с существующим кодом

Если у вас уже есть работающий бот на основе `index.js`, вы можете постепенно внедрять улучшенные обложки:

1. Замените импорт `index.js` на `index-enhanced.js`
2. Обновите вызовы функций отправки уведомлений
3. Настройте переменные окружения для включения обложек

## Производительность

- **Кэширование**: Сгенерированные обложки кэшируются в памяти
- **Ленивая загрузка**: Изображения загружаются только при необходимости
- **Параллельная обработка**: Поддержка асинхронных операций

## Лицензия

Модуль является частью проекта Tomilo Lib Bot и распространяется под той же лицензией.

## Поддержка

При возникновении проблем:
1. Проверьте наличие всех зависимостей
2. Убедитесь в корректности переменных окружения
3. Включите режим отладки (`DEBUG=true`)
4. Проверьте логи в консоли