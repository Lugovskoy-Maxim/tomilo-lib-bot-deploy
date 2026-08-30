const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

/**
 * Карточка еженедельного дайджеста лидеров. Аватары могут быть URL, путями
 * к файлам или Buffer; при недоступном аватаре выводятся инициалы пользователя.
 */
class MonthlyLeadersCard {
  constructor(options = {}) {
    this.options = {
      width: 1200,
      height: 1900,
      fontFamily: 'Exo 2',
      ...options,
    };
    const fontPath = path.join(__dirname, 'fonts', 'Exo2[wght].ttf');
    if (fs.existsSync(fontPath)) {
      try {
        registerFont(fontPath, { family: this.options.fontFamily });
      } catch (_) {
        // Canvas использует системный fallback, если шрифт уже зарегистрирован.
      }
    }
  }

  async generate(leaders, options = {}) {
    const { width, height, fontFamily } = this.options;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const cards = Array.isArray(leaders) ? leaders.slice(0, 5) : [];
    const period = options.period || 'ЛИДЕРЫ МЕСЯЦА';

    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#080a12');
    background.addColorStop(0.52, '#15122a');
    background.addColorStop(1, '#090b12');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    this.drawGlow(ctx, 110, 120, 560, 'rgba(255, 95, 87, 0.20)');
    this.drawGlow(ctx, width - 80, height * 0.4, 700, 'rgba(151, 137, 255, 0.18)');
    this.drawHalftone(ctx, width, height);

    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.font = `700 28px "${fontFamily}"`;
    ctx.letterSpacing = '5px';
    ctx.fillText(period, 78, 110);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = '#f6f7fb';
    ctx.font = `800 74px "${fontFamily}"`;
    ctx.fillText('Итоги месяца', 74, 198);
    ctx.fillText('в TOMILO LIB', 74, 278);
    ctx.fillStyle = 'rgba(246,247,251,0.66)';
    ctx.font = `500 29px "${fontFamily}"`;
    ctx.fillText('Пять достижений, которые сделали месяц ярче', 78, 332);

    const loadedVisuals = await Promise.all(
      cards.map(async (leader) => ({
        // Декоративный аватар заменяет обычный, но рамка всегда рисуется поверх.
        avatar: await this.loadAvatar(
          leader?.equippedDecorations?.avatar || leader?.avatarDecoration || leader?.avatar,
        ),
        frame: await this.loadAvatar(
          leader?.equippedDecorations?.frame || leader?.avatarFrame,
        ),
      })),
    );
    const defaults = [
      { metric: 'Время чтения', valueLabel: '0 мин.', accent: '#ff6f67' },
      { metric: 'Серия дней', valueLabel: '0 дней', accent: '#e6ba64' },
      { metric: 'Прочитано глав', valueLabel: '0 глав', accent: '#a690ff' },
      { metric: 'Оценок за месяц', valueLabel: '0 оценок', accent: '#6dd9c3' },
      { metric: 'Комментариев за месяц', valueLabel: '0 комментариев', accent: '#79a8ff' },
    ];
    defaults.forEach((fallback, index) => {
      this.drawLeaderCard(
        ctx,
        {
          ...fallback,
          ...(cards[index] || {}),
          username: cards[index]?.username || 'Лидер сообщества',
        },
        loadedVisuals[index],
        74,
        402 + index * 276,
        width - 148,
        244,
      );
    });

    ctx.fillStyle = 'rgba(246,247,251,0.42)';
    ctx.font = `500 23px "${fontFamily}"`;
    ctx.fillText('Спасибо, что читаете вместе с нами', 78, height - 72);
    return canvas.toBuffer('image/png');
  }

  async loadAvatar(source) {
    if (!source) return null;
    try {
      if (Buffer.isBuffer(source)) return await loadImage(source);
      if (typeof source === 'string' && /^https?:\/\//i.test(source)) {
        const response = await fetch(source, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return null;
        return await loadImage(Buffer.from(await response.arrayBuffer()));
      }
      return await loadImage(source);
    } catch (_) {
      return null;
    }
  }

  drawLeaderCard(ctx, leader, visual, x, y, width, height) {
    const radius = 34;
    const card = ctx.createLinearGradient(x, y, x + width, y + height);
    card.addColorStop(0, 'rgba(31,34,48,0.98)');
    card.addColorStop(1, 'rgba(17,19,29,0.98)');
    this.roundRect(ctx, x, y, width, height, radius);
    ctx.fillStyle = card;
    ctx.fill();
    ctx.strokeStyle = `${leader.accent}66`;
    ctx.lineWidth = 2;
    ctx.stroke();

    this.drawAvatar(ctx, visual?.avatar, visual?.frame, leader.username, x + 34, y + 42, 138, leader.accent);
    ctx.fillStyle = 'rgba(246,247,251,0.58)';
    ctx.font = `700 22px "${this.options.fontFamily}"`;
    ctx.fillText(String(leader.metric).toUpperCase(), x + 204, y + 78);
    ctx.font = `800 43px "${this.options.fontFamily}"`;
    const username = this.ellipsize(ctx, leader.username, width - 270);
    if (this.isPremium(leader)) {
      const premiumGradient = ctx.createLinearGradient(x + 204, y + 105, x + width - 70, y + 150);
      premiumGradient.addColorStop(0, '#fff2b0');
      premiumGradient.addColorStop(0.45, '#e8c07a');
      premiumGradient.addColorStop(1, '#ff8f87');
      ctx.fillStyle = premiumGradient;
      ctx.shadowColor = 'rgba(232,192,122,0.55)';
      ctx.shadowBlur = 14;
      ctx.fillText(username, x + 204, y + 137);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      this.drawCrown(ctx, x + 216 + ctx.measureText(username).width, y + 103);
    } else {
      ctx.fillStyle = '#f6f7fb';
      ctx.fillText(username, x + 204, y + 137);
    }
    ctx.fillStyle = leader.accent;
    ctx.font = `800 48px "${this.options.fontFamily}"`;
    ctx.fillText(String(leader.valueLabel), x + 204, y + 204);
  }

  drawAvatar(ctx, avatar, frame, username, x, y, size, accent) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (avatar) {
      const ratio = avatar.width / avatar.height;
      const sourceSize = ratio > 1 ? avatar.height : avatar.width;
      const sx = ratio > 1 ? (avatar.width - sourceSize) / 2 : 0;
      const sy = ratio > 1 ? 0 : (avatar.height - sourceSize) / 2;
      ctx.drawImage(avatar, sx, sy, sourceSize, sourceSize, x, y, size, size);
    } else {
      const fill = ctx.createLinearGradient(x, y, x + size, y + size);
      fill.addColorStop(0, accent);
      fill.addColorStop(1, '#292d40');
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 58px "${this.options.fontFamily}"`;
      ctx.textAlign = 'center';
      ctx.fillText(this.initials(username), x + size / 2, y + 92);
      ctx.textAlign = 'left';
    }
    ctx.restore();
    if (frame) {
      ctx.drawImage(frame, x - 12, y - 12, size + 24, size + 24);
    } else {
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5;
      ctx.stroke();
    }
  }

  drawGlow(ctx, x, y, radius, color) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.options.width, this.options.height);
  }

  drawHalftone(ctx, width, height) {
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let y = 28; y < height; y += 20) {
      for (let x = (y / 20) % 2 ? 28 : 38; x < width; x += 20) {
        if (x < 250 || x > width - 230) ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  drawCrown(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#e8c07a';
    ctx.shadowColor = 'rgba(232,192,122,0.6)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, 28);
    ctx.lineTo(3, 6);
    ctx.lineTo(12, 16);
    ctx.lineTo(20, 0);
    ctx.lineTo(28, 16);
    ctx.lineTo(38, 6);
    ctx.lineTo(40, 28);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(2, 30, 37, 6);
    ctx.restore();
  }

  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.closePath();
  }

  initials(username) {
    return String(username || '?').trim().slice(0, 2).toUpperCase() || '?';
  }

  isPremium(leader) {
    if (leader?.isPremium === true || leader?.premium === true) return true;
    const expiresAt = leader?.subscriptionExpiresAt;
    return Boolean(expiresAt && new Date(expiresAt).getTime() > Date.now());
  }

  ellipsize(ctx, text, maxWidth) {
    const raw = String(text || 'Лидер сообщества');
    if (ctx.measureText(raw).width <= maxWidth) return raw;
    let cut = raw;
    while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
    return `${cut}…`;
  }
}

module.exports = MonthlyLeadersCard;
