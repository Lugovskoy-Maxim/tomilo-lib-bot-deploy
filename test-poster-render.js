const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const ImageGenerator = require('./image-generator');

for (const format of ['webp', 'avif', 'jpeg']) {
  test(`renders ${format} cover into poster pixels`, async () => {
    const cover = await sharp({ create: { width: 240, height: 360, channels: 3,
      background: { r: 240, g: 20, b: 20 } } })[format]().toBuffer();
    const generator = new ImageGenerator();
    const poster = await generator.generateTitleCover({ name: 'Тест обложки', coverImage: cover, chapterNumber: 1 });
    const { data, info } = await sharp(poster).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 1200);
    assert.equal(info.height, 630);
    const offset = (200 * info.width + 1000) * info.channels;
    assert.ok(data[offset] > data[offset + 1] * 2, 'red cover must be visible in the poster');
  });
}

test('invalid supplied cover fails instead of producing a cacheable blank poster', async () => {
  const generator = new ImageGenerator();
  await assert.rejects(generator.generateTitleCover({ name: 'Ошибка', coverImage: Buffer.from('<html>error</html>') }));
});
