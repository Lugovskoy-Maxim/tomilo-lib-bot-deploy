const fs = require('fs/promises');
const MonthlyLeadersCard = require('./monthly-leaders-card');

async function run() {
  const card = new MonthlyLeadersCard();
  const categoryConfigs = [
    { category: 'readingTime', metric: 'Время чтения', accent: '#ff6f67' },
    { category: 'streak', metric: 'Серия дней', accent: '#e6ba64' },
    { category: 'chaptersRead', metric: 'Прочитано глав', accent: '#a690ff' },
    { category: 'ratings', metric: 'Оценок за месяц', accent: '#6dd9c3' },
    { category: 'comments', metric: 'Комментариев за месяц', accent: '#79a8ff' },
  ];
  const responses = await Promise.all(categoryConfigs.map(async (item) => {
    const response = await fetch(
      `https://tomilo-lib.ru/api/users/leaderboard?category=${item.category}&period=month&limit=1`,
    );
    if (!response.ok) throw new Error(`Leaderboard ${item.category}: HTTP ${response.status}`);
    const payload = await response.json();
    const user = payload?.data?.users?.[0] || {};
    const value = item.category === 'readingTime' ? user.readingTimeMinutes
      : item.category === 'streak' ? user.currentStreak
        : item.category === 'chaptersRead' ? user.chaptersRead
          : item.category === 'ratings' ? user.ratingsCount : user.commentsCount;
    const suffix = item.category === 'readingTime' ? 'мин.'
      : item.category === 'streak' ? 'дней'
        : item.category === 'chaptersRead' ? 'глав'
          : item.category === 'ratings' ? 'оценок' : 'комментариев';
    return {
      ...item,
      ...user,
      valueLabel: `${Number(value || 0).toLocaleString('ru-RU')} ${suffix}`,
    };
  }));
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', month: 'long', year: 'numeric',
  }).formatToParts(new Date());
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const year = parts.find((part) => part.type === 'year')?.value || '';
  const image = await card.generate(responses, { period: `${month} ${year} · лидеры`.toUpperCase() });
  await fs.writeFile('test-monthly-leaders.png', image);
  console.log('Saved test-monthly-leaders.png');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
