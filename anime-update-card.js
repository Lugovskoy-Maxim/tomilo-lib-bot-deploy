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

function drawHalftone(ctx, x, y, width, height, radius, gap, color = '#151515') {
  ctx.fillStyle = color;
  for (let row = 0, py = y; py < y + height; row += 1, py += gap) {
    for (let px = x + (row % 2 ? gap / 2 : 0); px < x + width; px += gap) {
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

async function generateAnimeUpdateCard({ poster, title, episodeNumber, episodeName, sourceLabel }) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7f5ef';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Left panel uses the actual anime poster, converted to ink-like grayscale.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 430, HEIGHT);
  ctx.clip();
  if (poster) {
    const inkPoster = await sharp(poster).rotate().resize(860, 1260, { fit: 'cover', position: 'centre' })
      .greyscale().normalize().jpeg({ quality: 86 }).toBuffer();
    const image = await loadImage(inkPoster);
    const scale = Math.max(430 / image.width, HEIGHT / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, (430 - width) / 2, (HEIGHT - height) / 2, width, height);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(0, 0, 430, HEIGHT);
  } else {
    ctx.fillStyle = '#dedbd3';
    ctx.fillRect(0, 0, 430, HEIGHT);
    drawHalftone(ctx, 15, 15, 400, HEIGHT - 30, 2.4, 16, '#777');
  }
  // Comic speed lines and a hard black panel gutter.
  ctx.strokeStyle = 'rgba(10,10,10,.72)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 15; i += 1) {
    ctx.beginPath();
    ctx.moveTo(-80 + i * 42, 0);
    ctx.lineTo(430, 260 + i * 20);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#111';
  ctx.fillRect(422, 0, 12, HEIGHT);

  // Right panel is laid out like a clean manga page with a screentone corner.
  drawHalftone(ctx, 945, 0, 255, 164, 2.1, 15, '#777');
  ctx.fillStyle = '#f7f5ef';
  ctx.fillRect(910, 0, 290, 172);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 6;
  ctx.strokeRect(456, 38, 690, 86);
  ctx.fillStyle = '#111';
  ctx.font = '700 34px "Exo 2", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('速報  /  TOMILO ANI', 482, 82);

  ctx.fillStyle = '#111';
  ctx.font = '700 52px "Exo 2", sans-serif';
  const titleLines = wrapText(ctx, title || 'Новое аниме', 660).slice(0, 3);
  let y = 205;
  for (const line of titleLines) {
    ctx.fillText(line, 470, y, 670);
    y += 62;
  }

  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(470, 420, 420, 88, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.font = '700 40px "Exo 2", sans-serif';
  ctx.fillText(`СЕРИЯ ${episodeNumber}`, 494, 465, 370);
  if (episodeName) {
    ctx.font = '500 24px "Exo 2", sans-serif';
    ctx.fillText(episodeName, 472, 548, 670);
  }

  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.moveTo(1050, 482); ctx.lineTo(1178, 515); ctx.lineTo(1084, 606); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '700 20px "Exo 2", sans-serif';
  ctx.fillText('Новая', 1072, 526);
  ctx.fillText('серия', 1080, 553);
  if (sourceLabel) {
    ctx.fillStyle = '#111';
    ctx.font = '500 18px "Exo 2", sans-serif';
    ctx.fillText(String(sourceLabel).slice(0, 56), 470, 594, 520);
  }
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, WIDTH - 6, HEIGHT - 6);
  return canvas.toBuffer('image/jpeg', { quality: 88 });
}

module.exports = { generateAnimeUpdateCard };
