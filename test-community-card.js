const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const CommunityCard = require('./community-card');
const { sampleStories } = require('./preview-community');

test('all chronicle layouts render PNGs; WebP avatar is visible rather than initials', async () => {
  const card = new CommunityCard(), stories = await sampleStories();
  for (const story of stories) {
    const output = await card.generate(story);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.width, 1200); assert.equal(metadata.format, 'png');
    if (story.kind === 'reader') {
      const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
      const pixel = (450 * info.width + 210) * info.channels;
      assert.ok(data[pixel] > data[pixel + 1] * 2, 'red WebP avatar must render');
    }
  }
});

test('long usernames, huge counters and unavailable art still render', async () => {
  const card = new CommunityCard(), stories = await sampleStories();
  const story = stories[1];
  story.users[0].username = 'Очень длинное имя пользователя '.repeat(6); story.users[0].avatar = Buffer.from('bad');
  story.value = 123456789;
  const output = await card.generate(story);
  assert.equal((await sharp(output).metadata()).height, 1350);
});

test('voting showcases drop unavailable artwork instead of publishing empty slots', async () => {
  const card = new CommunityCard(), stories = await sampleStories();
  const story = stories[2];
  story.items[0].imageUrl = Buffer.from('invalid');
  await card.generate(story);
  assert.equal(story.items.length, 2);
  for (const item of story.items) item.imageUrl = Buffer.from('invalid');
  await assert.rejects(card.generate(story), /No available suggestion previews/);
});
