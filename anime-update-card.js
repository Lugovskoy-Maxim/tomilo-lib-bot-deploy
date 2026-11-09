const { createCanvas, loadImage, registerFont } = require('canvas');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const WIDTH = 1200;
const HEIGHT = 630;
const FONT_PATH = path.join(__dirname, 'fonts', 'Exo2[wght].ttf');

if (fs.existsSync(FONT_PATH)) {
  try { registerFont(FONT_PATH, { family: 'Exo 2' }); } catch {}
}

function wrapText(ctx, value, maxWidth) {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function drawGlow(ctx, x, y, radius, color) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, color);
  glow.addColorStop(1, 'rgba(16, 18, 39, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawSpark(ctx, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-size, 0); ctx.lineTo(size, 0);
  ctx.moveTo(0, -size); ctx.lineTo(0, size);
  ctx.stroke();
  ctx.restore();
}

async function generateAnimeUpdateCard({ poster, title, episodeNumber, episodeName, sourceLabel }) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const background = ctx.createLinearGradient(380, 0, WIDTH, HEIGHT);
  background.addColorStop(0, '#172548');
  background.addColorStop(0.48, '#38246f');
  background.addColorStop(1, '#7e2f78');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawGlow(ctx, 860, 95, 470, 'rgba(32, 205, 230, .30)');
  drawGlow(ctx, 1070, 590, 420, 'rgba(255, 73, 145, .32)');

  // The poster remains in full color and carries the artwork for the card.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(14, 14, 420, HEIGHT - 28, 30);
  ctx.clip();
  if (poster) {
    const posterBytes = await sharp(poster).rotate().resize(840, 1260, { fit: 'cover', position: 'centre' })
      .normalize().jpeg({ quality: 90 }).toBuffer();
    const image = await loadImage(posterBytes);
    const scale = Math.max(420 / image.width, (HEIGHT - 28) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, 14 + (420 - width) / 2, 14 + (HEIGHT - 28 - height) / 2, width, height);
  } else {
    const fallback = ctx.createLinearGradient(0, 0, 420, HEIGHT);
    fallback.addColorStop(0, '#32c5d7');
    fallback.addColorStop(1, '#7849df');
    ctx.fillStyle = fallback;
    ctx.fillRect(14, 14, 420, HEIGHT - 28);
    drawSpark(ctx, 220, 250, 46, 'rgba(255,255,255,.88)');
    drawSpark(ctx, 326, 358, 22, 'rgba(255,255,255,.72)');
  }
  const posterShade = ctx.createLinearGradient(275, 0, 440, 0);
  posterShade.addColorStop(0, 'rgba(12,18,42,0)');
  posterShade.addColorStop(1, 'rgba(12,18,42,.32)');
  ctx.fillStyle = posterShade;
  ctx.fillRect(14, 14, 420, HEIGHT - 28);
  ctx.restore();

  // Bright edge and floating light streaks give the layout an anime key-art feel.
  ctx.strokeStyle = 'rgba(112, 239, 255, .92)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(437, 50); ctx.lineTo(437, 580);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.moveTo(800 + i * 78, 0);
    ctx.lineTo(570 + i * 78, HEIGHT);
    ctx.stroke();
  }
  drawSpark(ctx, 1110, 110, 17, 'rgba(255,255,255,.9)');
  drawSpark(ctx, 1015, 270, 9, 'rgba(113,239,255,.95)');

  const panelX = 490;
  ctx.save();
  ctx.shadowColor = 'rgba(255, 68, 137, .45)';
  ctx.shadowBlur = 22;
  ctx.fillStyle = '#ff4f87';
  ctx.beginPath();
  ctx.roundRect(panelX, 48, 294, 58, 29);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = '700 25px "Exo 2", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('НОВАЯ СЕРИЯ', panelX + 26, 77);

  ctx.fillStyle = 'rgba(220, 240, 255, .82)';
  ctx.font = '600 20px "Exo 2", sans-serif';
  ctx.fillText('TOMILO ANI  ·  СВЕЖИЕ ОБНОВЛЕНИЯ', panelX, 151, 625);

  ctx.fillStyle = '#fff';
  ctx.font = '700 51px "Exo 2", sans-serif';
  ctx.shadowColor = 'rgba(8, 12, 30, .38)';
  ctx.shadowBlur = 12;
  const titleLines = wrapText(ctx, title || 'Новое аниме', 650).slice(0, 3);
  let titleY = 238;
  for (const line of titleLines) {
    ctx.fillText(line, panelX, titleY, 660);
    titleY += 62;
  }
  ctx.shadowBlur = 0;

  const badgeY = Math.max(420, titleY + 5);
  ctx.fillStyle = 'rgba(255,255,255,.96)';
  ctx.beginPath();
  ctx.roundRect(panelX, badgeY, 315, 78, 18);
  ctx.fill();
  ctx.fillStyle = '#32225f';
  ctx.font = '700 37px "Exo 2", sans-serif';
  ctx.fillText(`СЕРИЯ ${episodeNumber}`, panelX + 22, badgeY + 39, 275);

  const footerY = Math.min(585, badgeY + 116);
  if (episodeName) {
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.font = '500 23px "Exo 2", sans-serif';
    ctx.fillText(String(episodeName).slice(0, 64), panelX, footerY, 625);
  }
  if (sourceLabel) {
    ctx.fillStyle = 'rgba(185, 239, 255, .88)';
    ctx.font = '500 17px "Exo 2", sans-serif';
    ctx.fillText(String(sourceLabel).slice(0, 72), panelX, 606, 625);
  }

  ctx.strokeStyle = 'rgba(255,255,255,.58)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(3, 3, WIDTH - 6, HEIGHT - 6, 32);
  ctx.stroke();
  return canvas.toBuffer('image/jpeg', { quality: 90 });
}

module.exports = { generateAnimeUpdateCard };
