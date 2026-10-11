const { createCanvas } = require('canvas');
const MonthlyLeadersCard = require('./monthly-leaders-card');
const { METRICS } = require('./community-chronicle');

/** Daily editorial layouts inherit the weekly digest's font, avatars and frame treatment. */
class CommunityCard extends MonthlyLeadersCard {
  constructor(options = {}) { super({ width: 1200, ...options }); }

  text(ctx, value, x, y, size = 32, color = '#f6f7fb', weight = 700, maxWidth = 1040) {
    ctx.font = `${weight} ${size}px "${this.options.fontFamily}"`;
    ctx.fillStyle = color;
    ctx.fillText(this.ellipsize(ctx, String(value), maxWidth), x, y);
  }

  async visual(user) {
    return {
      avatar: await this.loadAvatar(user.equippedDecorations?.avatar || user.avatarDecoration || user.avatar),
      frame: await this.loadAvatar(user.equippedDecorations?.frame || user.avatarFrame),
    };
  }

  async generate(story) {
    const width = 1200, height = story.kind === 'podium' ? 1440 : 1350;
    const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
    const accent = story.accent || '#ad9aff';
    ctx.fillStyle = '#0c0e18'; ctx.fillRect(0, 0, width, height);
    // Inherit the weekly halftone; the angled accent is the chronicle's editorial signature.
    this.drawHalftone(ctx, width, height);
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.moveTo(930, 0); ctx.lineTo(1200, 0); ctx.lineTo(1200, 210); ctx.closePath(); ctx.fill();
    this.text(ctx, story.title, 74, 145, 76, '#f6f7fb', 800, 980);
    this.text(ctx, story.period, 78, 210, 28, '#bbc0d2', 500);
    ctx.strokeStyle = '#303547'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(78, 255); ctx.lineTo(1122, 255); ctx.stroke();

    const visuals = [];
    for (const u of story.users) visuals.push(await this.visual(u));
    if (story.kind === 'vote') await this.drawVote(ctx, story);
    else if (story.kind === 'podium') this.drawPodium(ctx, story, visuals);
    else if (story.kind === 'summary') this.drawSummary(ctx, story, visuals);
    else this.drawPerson(ctx, story, visuals[0]);

    ctx.strokeStyle = '#303547';
    ctx.beginPath(); ctx.moveTo(78, height - 135); ctx.lineTo(1122, height - 135); ctx.stroke();
    this.text(ctx, 'TOMILO LIB', 78, height - 80, 30, '#f6f7fb', 800, 400);
    this.text(ctx, 'ХРОНИКА СООБЩЕСТВА', 78, height - 42, 19, '#a7aec5', 600, 500);
    ctx.textAlign = 'right';
    this.text(ctx, story.date.split('-').reverse().join('.'), 1122, height - 80, 28, '#bbc0d2', 500, 400);
    ctx.textAlign = 'left';
    return canvas.toBuffer('image/png');
  }

  drawPerson(ctx, story, visual) {
    const user = story.users[0];
    this.drawAvatar(ctx, visual?.avatar, visual?.frame, user.username, 78, 325, 270, story.accent);
    this.text(ctx, user.username, 400, 420, 61, this.isPremium(user) ? '#e6ba64' : '#f6f7fb', 800, 710);
    this.text(ctx, story.metric, 402, 480, 30, '#bbc0d2', 500, 700);
    if (story.kind === 'rise') {
      this.text(ctx, `+${Number(story.value).toLocaleString('ru-RU')}`, 74, 840, 190, story.accent, 800, 550);
      this.text(ctx, 'ПОЗИЦИЙ ВВЕРХ', 80, 910, 36, '#f6f7fb', 700, 550);
      ctx.strokeStyle = story.accent; ctx.lineWidth = 12; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(720, 950); ctx.lineTo(1020, 710); ctx.lineTo(920, 710);
      ctx.moveTo(1020, 710); ctx.lineTo(1020, 810); ctx.stroke();
      this.text(ctx, `№${story.fromRank} → №${story.toRank}`, 80, 1080, 70, '#f6f7fb', 800);
    } else if (story.kind === 'quote') {
      this.text(ctx, '«', 76, 735, 130, story.accent, 800);
      ctx.font = `600 43px "${this.options.fontFamily}"`;
      const words = String(story.quote).split(' '), lines = [];
      let line = '';
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > 950 && line) { lines.push(line); line = word; }
        else line = next;
      }
      if (line) lines.push(line);
      lines.slice(0, 5).forEach((value, i) => this.text(ctx, i === 4 && lines.length > 5 ? `${value}…` : value, 80, 770 + i * 63, 43, '#f6f7fb', 600, 1040));
      this.text(ctx, 'Слова, которыми делятся в сообществе', 80, 1130, 28, '#bbc0d2', 500);
    } else {
      this.text(ctx, Number(story.value).toLocaleString('ru-RU'), 74, 840, 176, story.accent, 800);
      this.text(ctx, story.unit, 80, 920, 52, '#f6f7fb', 700);
      this.text(ctx, story.kind === 'milestone' ? 'Ещё одна отметка в личной истории' : `Место в категории: №${user.rank}`, 80, 1090, 36, '#bbc0d2', 500);
    }
  }

  drawPodium(ctx, story, visuals) {
    const metric = METRICS[story.category.split(':')[0]];
    this.text(ctx, story.metric, 80, 320, 34, story.accent, 700);
    story.users.forEach((u, i) => {
      const y = 380 + i * 280;
      this.text(ctx, `0${u.rank}`, 80, y + 75, 69, i === 0 ? '#e6ba64' : '#a7aec5', 800, 130);
      this.drawAvatar(ctx, visuals[i]?.avatar, visuals[i]?.frame, u.username, 245, y, 148, story.accent);
      this.text(ctx, u.username, 440, y + 60, 48, this.isPremium(u) ? '#e6ba64' : '#f6f7fb', 800, 660);
      this.text(ctx, `${Number(u[metric.key]).toLocaleString('ru-RU')} ${metric.unit}`, 440, y + 125, 38, story.accent, 700, 660);
      ctx.strokeStyle = '#303547'; ctx.beginPath(); ctx.moveTo(245, y + 208); ctx.lineTo(1122, y + 208); ctx.stroke();
    });
  }

  async drawVote(ctx, story) {
    const types = { card: 'Карточка', avatar: 'Аватар', frame: 'Рамка', background: 'Фон', badge: 'Значок' };
    const previews = [];
    for (const item of story.items) {
      const image = await this.loadAvatar(item.imageUrl);
      if (image) previews.push({ item, image });
      else console.warn(`Chronicle suggestion preview unavailable: ${item.name}`);
    }
    if (!previews.length) throw new Error('No available suggestion previews');
    // A voting showcase must contain real artwork, never empty image placeholders.
    story.items = previews.map(p => p.item);
    const count = story.items.length, gap = 26, tileWidth = (1044 - gap * (count - 1)) / count;
    for (let i = 0; i < count; i++) {
      const item = story.items[i], x = 78 + i * (tileWidth + gap), y = 340, h = 500;
      ctx.fillStyle = '#1b2030'; this.roundRect(ctx, x, y, tileWidth, h, 16); ctx.fill();
      const img = previews[i].image;
      if (img) {
        const scale = Math.min((tileWidth - 32) / img.width, (h - 32) / img.height);
        ctx.drawImage(img, x + (tileWidth - img.width * scale) / 2, y + (h - img.height * scale) / 2, img.width * scale, img.height * scale);
      }
      this.text(ctx, types[item.type] || 'Декорация', x, 895, 24, story.accent, 600, tileWidth);
      this.text(ctx, item.name, x, 940, 32, '#f6f7fb', 800, tileWidth);
      this.text(ctx, `${Number(item.votesCount || 0).toLocaleString('ru-RU')} голосов`, x, 986, 28, '#bbc0d2', 500, tileWidth);
    }
    this.text(ctx, 'Что появится в магазине?', 78, 1090, 44, '#f6f7fb', 800);
    this.text(ctx, 'Проголосуйте по кнопке под постом', 80, 1145, 30, '#bbc0d2', 500);
  }

  drawSummary(ctx, story, visuals) {
    story.stats.forEach((s, i) => {
      const y = 395 + i * 200;
      this.text(ctx, Number(s.value).toLocaleString('ru-RU'), 74, y + 40, 94, i === 0 ? story.accent : '#f6f7fb', 800, 600);
      this.text(ctx, s.label, 650, y + 20, 32, '#bbc0d2', 600, 460);
      ctx.strokeStyle = '#303547'; ctx.beginPath(); ctx.moveTo(78, y + 95); ctx.lineTo(1122, y + 95); ctx.stroke();
    });
    story.users.forEach((u, i) => {
      const x = 80 + i * 360;
      this.drawAvatar(ctx, visuals[i]?.avatar, visuals[i]?.frame, u.username, x, 950, 100, story.accent);
      this.text(ctx, u.username, x, 1100, 27, '#f6f7fb', 700, 330);
    });
    this.text(ctx, 'Результаты до 100 участников каждой категории', 80, 1160, 25, '#bbc0d2', 500);
  }
}

module.exports = CommunityCard;
