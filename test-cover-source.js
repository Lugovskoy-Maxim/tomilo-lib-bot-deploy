const test = require('node:test');
const assert = require('node:assert/strict');
const { originalCoverUrl, downloadCover } = require('./cover-source');

test('cache URL requests original bytes and preserves revision', () => {
  assert.equal(originalCoverUrl('https://api.example/api/shop/images/asset/Y292ZXI?w=640&v=abc'),
    'https://api.example/api/shop/images/asset/Y292ZXI?v=abc');
  assert.equal(originalCoverUrl('https://api.example/api/shop/images/cover.jpg?w=320'),
    'https://api.example/api/shop/images/cover.jpg');
});

test('external URLs and local sources remain unchanged', () => {
  for (const source of ['https://cdn.example/cover.jpg?w=640&signature=a', '/uploads/cover.jpg', 'data:image/png;base64,AA==', Buffer.from('image')]) {
    assert.equal(originalCoverUrl(source), source);
  }
});

test('download avoids WebP cache variant and returns original image bytes', async (t) => {
  const original = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  t.mock.method(global, 'fetch', async (source) => {
    const url = new URL(source);
    assert.equal(url.searchParams.get('v'), 'revision');
    return new Response(url.searchParams.has('w') ? Buffer.from('webp') : original);
  });
  assert.deepEqual(await downloadCover('https://api.example/api/shop/images/asset/abc?w=640&v=revision'), original);
});

test('deadline covers reading image body, not just response headers', async (t) => {
  t.mock.method(global, 'fetch', async (source, { signal }) => ({
    ok: true,
    arrayBuffer: () => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  }));
  await assert.rejects(downloadCover('https://cdn.example/cover.jpg', 20), /aborted/);
});

test('HTTP errors and empty bodies are rejected', async (t) => {
  t.mock.method(global, 'fetch', async () => new Response('', { status: 404 }));
  await assert.rejects(downloadCover('https://cdn.example/cover.jpg'), /HTTP 404/);
  global.fetch = async () => new Response('');
  await assert.rejects(downloadCover('https://cdn.example/cover.jpg'), /Empty image/);
});

test('WebP-capable callers can keep server preview width for large GIFs', async t => {
  t.mock.method(global, 'fetch', async source => {
    assert.equal(new URL(source).searchParams.get('w'), '640');
    return new Response('webp bytes');
  });
  await downloadCover('https://api.example/api/shop/images/cover.gif?w=640', 1000, { original: false });
});
