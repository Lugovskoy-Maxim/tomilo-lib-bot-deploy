const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchChapterUpdates } = require('./chapter-updates');

test('publishing feed includes every hidden chapter with its display flag', async () => {
  const publicRow = { slug: 'public', chapters: [1] };
  const hiddenRows = [2, 3].map(chapterNumber => ({
    slug: 'hidden', chapters: [chapterNumber], isHiddenChapter: true,
  }));
  const rows = await fetchChapterUpdates({
    fetchPublic: async () => [publicRow],
    fetchHidden: async () => hiddenRows,
  });
  assert.deepEqual(rows, [publicRow, ...hiddenRows]);
});

test('hidden feed failure preserves public releases and is retried on next scan', async () => {
  let attempts = 0;
  const warnings = [];
  const options = {
    fetchPublic: async () => [{ slug: 'public' }],
    fetchHidden: async () => {
      if (++attempts === 1) throw new Error('503');
      return [{ slug: 'hidden', isHiddenChapter: true }];
    },
    warn: (...args) => warnings.push(args),
  };
  assert.equal((await fetchChapterUpdates(options)).length, 1);
  assert.equal(warnings.length, 1);
  assert.equal((await fetchChapterUpdates(options))[1].slug, 'hidden');
});
