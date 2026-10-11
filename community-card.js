const { createCanvas } = require('canvas');
const MonthlyLeadersCard = require('./monthly-leaders-card');
const { METRICS, storyCopy, resultLabel, plural } = require('./community-chronicle');

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
    this.drawHalftone(ctx, width, height);
    this.text(ctx, story.title, 68, 155, 94, '#f6f7fb', 800, 1060);
    this.text(ctx, story.period?.startsWith('Пример оформления') ? story.period : storyCopy(story).subtitle, 74, 222, 29, '#bbc0d2', 500);

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

  panel(ctx, x, y, width, height, color, radius = 24) {
    ctx.fillStyle = color; this.roundRect(ctx, x, y, width, height, radius); ctx.fill();
  }

  drawPerson(ctx, story, visual) {
    const user = story.users[0], accent = story.accent;
    if (story.kind === 'quote') {
      this.panel(ctx, 70, 310, 1060, 680, '#f1ebdf');
      this.text(ctx, '«', 106, 448, 170, '#34303d', 800);
      ctx.font = `600 51px "${this.options.fontFamily}"`;
      const words = String(story.quote).split(' '), lines = []; let line = '';
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > 920 && line) { lines.push(line); line = word; }
        else line = next;
      }
      if (line) lines.push(line);
      lines.slice(0, 6).forEach((value, i) => this.text(ctx, i === 5 && lines.length > 6 ? `${value}…` : value, 110, 495 + i * 67, 51, '#26222e', 600, 970));
      this.drawAvatar(ctx, visual?.avatar, visual?.frame, user.username, 80, 1030, 132, accent);
      this.text(ctx, user.username, 250, 1090, 49, '#f6f7fb', 800, 850);
      this.text(ctx, 'Из обсуждений сообщества', 252, 1140, 27, '#bbc0d2', 500);
      return;
    }
    if (visual?.avatar) {
      ctx.save();
      this.roundRect(ctx, 70, 300, 1060, 400, 24); ctx.clip();
      const img = visual.avatar, side = Math.min(img.width, img.height);
      ctx.globalAlpha = 0.24;
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 70, 0, 1060, 1060);
      ctx.restore();
    } else this.panel(ctx, 70, 300, 1060, 400, '#1e2233');
    this.drawAvatar(ctx, visual?.avatar, visual?.frame, user.username, 105, 335, 300, accent);
    this.text(ctx, user.username, 455, 475, 65, this.isPremium(user) ? '#f2d793' : '#f6f7fb', 800, 640);
    this.text(ctx, story.metric, 459, 535, 32, '#d9dbea', 500, 620);
    if (story.kind === 'rise') {
      this.text(ctx, `+${Number(story.value).toLocaleString('ru-RU')}`, 68, 970, 245, accent, 800, 620);
      this.text(ctx, 'ПОЗИЦИЙ ВВЕРХ', 80, 1040, 34, '#f6f7fb', 700, 600);
      ctx.strokeStyle = accent; ctx.lineWidth = 27; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(770, 1030); ctx.lineTo(1070, 790); ctx.lineTo(915, 790);
      ctx.moveTo(1070, 790); ctx.lineTo(1070, 945); ctx.stroke();
      this.text(ctx, `№${story.fromRank} → №${story.toRank}`, 80, 1140, 64, '#f6f7fb', 800);
    } else {
      this.panel(ctx, 70, 755, 1060, 325, accent);
      this.text(ctx, Number(story.value).toLocaleString('ru-RU'), 105, 960, 192, '#171525', 800, 990);
      this.text(ctx, resultLabel(story.value, story.category).slice(Number(story.value).toLocaleString('ru-RU').length + 1), 114, 1035, 47, '#171525', 700, 940);
      this.text(ctx, storyCopy(story).footer, 80, 1150, 31, '#d9dbea', 500);
    }
  }

  drawPodium(ctx, story, visuals) {
    const metric = METRICS[story.category.split(':')[0]];
    const first = story.users[0];
    this.panel(ctx, 70, 300, 1060, 400, '#ead09a');
    this.text(ctx, '1', 94, 555, 225, '#332616', 800, 240);
    this.drawAvatar(ctx, visuals[0]?.avatar, visuals[0]?.frame, first.username, 750, 360, 260, '#76521c');
    this.text(ctx, first.username, 320, 435, 54, '#332616', 800, 410);
    this.text(ctx, resultLabel(first[metric.key], story.category), 325, 520, 44, '#332616', 700, 410);
    this.text(ctx, 'ПЕРВОЕ МЕСТО', 326, 610, 24, '#574326', 700, 400);
    story.users.slice(1).forEach((u, i) => {
      const x = 70 + i * 545, y = 755;
      this.panel(ctx, x, y, 515, 435, i === 0 ? '#242b40' : '#342738');
      this.text(ctx, String(u.rank), x + 28, y + 107, 94, '#d9dbea', 800, 130);
      this.drawAvatar(ctx, visuals[i + 1]?.avatar, visuals[i + 1]?.frame, u.username, x + 285, y + 44, 170, story.accent);
      this.text(ctx, u.username, x + 30, y + 298, 43, '#f6f7fb', 800, 455);
      this.text(ctx, resultLabel(u[metric.key], story.category), x + 32, y + 362, 35, story.accent, 700, 455);
    });
    this.text(ctx, storyCopy(story).footer, 80, 1255, 28, '#bbc0d2', 500);
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
      const item = story.items[i], x = 78 + i * (tileWidth + gap), y = 320 + (i % 2) * 35, h = 525;
      ctx.save();
      ctx.translate(x + tileWidth / 2, y + h / 2);
      ctx.rotate(count > 1 ? (i % 2 ? 0.025 : -0.025) : 0);
      ctx.translate(-x - tileWidth / 2, -y - h / 2);
      ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 25; ctx.shadowOffsetY = 16;
      ctx.fillStyle = '#283341'; this.roundRect(ctx, x, y, tileWidth, h, 20); ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      const img = previews[i].image;
      if (img) {
        const scale = Math.min((tileWidth - 32) / img.width, (h - 32) / img.height);
        ctx.drawImage(img, x + (tileWidth - img.width * scale) / 2, y + (h - img.height * scale) / 2, img.width * scale, img.height * scale);
      }
      ctx.restore();
      this.text(ctx, types[item.type] || 'Декорация', x, 895, 24, story.accent, 600, tileWidth);
      this.text(ctx, item.name, x, 940, 32, '#f6f7fb', 800, tileWidth);
      this.text(ctx, `${Number(item.votesCount || 0).toLocaleString('ru-RU')} ${plural(item.votesCount, ['голос', 'голоса', 'голосов'])}`, x, 986, 28, '#bbc0d2', 500, tileWidth);
    }
    this.text(ctx, 'Что хотите увидеть в магазине?', 78, 1090, 44, '#f6f7fb', 800);
    this.text(ctx, 'Проголосуйте по кнопке под постом', 80, 1145, 30, '#bbc0d2', 500);
  }

  drawSummary(ctx, story, visuals) {
    const colors = ['#ad9aff', '#86c2d4', '#e9ce98'];
    story.stats.forEach((stat, i) => {
      const y = 300 + i * 235;
      this.panel(ctx, 70, y, 1060, 210, colors[i]);
      this.text(ctx, Number(stat.value).toLocaleString('ru-RU'), 102, y + 143, 126, '#171525', 800, 610);
      this.text(ctx, stat.label, 750, y + 103, 32, '#171525', 700, 345);
    });
    story.users.forEach((u, i) => {
      const x = 80 + i * 360;
      this.drawAvatar(ctx, visuals[i]?.avatar, visuals[i]?.frame, u.username, x, 1040, 95, colors[i]);
      this.text(ctx, u.username, x + 115, 1097, 26, '#f6f7fb', 700, 225);
    });
    this.text(ctx, storyCopy(story).footer, 80, 1175, 27, '#bbc0d2', 500);
  }

}

module.exports = CommunityCard;
