const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const CommunityCard = require('./community-card');

async function sampleStories() {
  const art = await sharp({ create: { width: 300, height: 420, channels: 3, background: '#b385c9' } }).webp().toBuffer();
  const avatar = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#cc4545' } }).webp().toBuffer();
  const users = ['Лунный читатель', 'Мандарин', 'Книжный странник'].map((username, i) => ({
    _id: `demo-${i}`, username, avatar, rank: i + 1, chaptersRead: 286 - i * 60,
    commentsCount: 48 - i * 8, ratingsCount: 27 - i * 5, isPremium: i === 0,
  }));
  const base = { date: '2026-10-11', period: 'Пример оформления · демонстрационные данные',
    accent: '#ad9aff', category: 'chaptersRead:week', metric: 'Прочитано глав', unit: 'глав', value: 286, users: [users[0]] };
  return [
    { ...base, kind: 'rise', title: 'Рывок недели', value: 12, unit: 'позиций вверх', fromRank: 18, toRank: 6 },
    { ...base, kind: 'reader', title: 'Читатель дня', value: 42 },
    { ...base, kind: 'vote', title: 'Выбор сообщества', accent: '#79dcc1', users: [], items: [
      { id: 'a', name: 'Лунная рамка', imageUrl: art, type: 'frame', votesCount: 27 },
      { id: 'b', name: 'Тихий сад', imageUrl: art, type: 'background', votesCount: 19 },
      { id: 'c', name: 'Хранитель истории', imageUrl: art, type: 'card', votesCount: 14 },
    ] },
    { ...base, kind: 'quote', title: 'Голос сообщества', accent: '#7abaff', quote: 'Больше всего запомнилась не битва, а разговор после неё. Именно в этот момент герои перестали быть просто союзниками и стали настоящей командой.' },
    { ...base, kind: 'podium', title: 'Тройка недели', users },
    { ...base, kind: 'milestone', title: 'Новый рубеж', value: 1000, accent: '#ff987c' },
    { ...base, kind: 'summary', title: 'Неделя в цифрах', accent: '#e6ba64', users, stats: [
      { label: 'Прочитано глав', value: 12842 }, { label: 'Комментарии', value: 648 }, { label: 'Оценки тайтлов', value: 1257 },
    ] },
    { ...base, kind: 'spotlight', title: 'Без пропусков', category: 'streak:all', metric: 'Серия активности', value: 30, unit: 'дней подряд', accent: '#ff987c' },
  ];
}

async function preview(output = '/tmp/tomilo-chronicle-preview') {
  fs.mkdirSync(output, { recursive: true });
  const card = new CommunityCard(), stories = await sampleStories(), tiles = [];
  for (let i = 0; i < stories.length; i++) {
    const image = await card.generate(stories[i]);
    fs.writeFileSync(path.join(output, `${i + 1}-${stories[i].kind}.png`), image);
    tiles.push({ input: await sharp(image).resize(300, 360, { fit: 'contain', background: '#151822' }).png().toBuffer(), left: (i % 4) * 300, top: Math.floor(i / 4) * 360 });
  }
  await sharp({ create: { width: 1200, height: 720, channels: 3, background: '#151822' } }).composite(tiles).png().toFile(path.join(output, 'overview.png'));
  console.log(`Saved preview: ${output}`);
}

if (require.main === module) preview(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { sampleStories, preview };
