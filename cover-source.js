/** The image cache converts width variants to WebP, unsupported by our canvas build.
 * Without w the same endpoint serves the original bytes, still using server cache.
 */
function originalCoverUrl(source) {
  if (typeof source !== 'string') return source;
  try {
    const url = new URL(source);
    if (/^https?:$/.test(url.protocol) && /\/shop\/images\/(?:asset\/[^/]+|[^/]+)$/.test(url.pathname)) {
      url.searchParams.delete('w');
      return url.toString();
    }
  } catch {
    // Buffers, local paths, and data URLs are handled by canvas itself.
  }
  return source;
}

async function downloadCover(source, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(originalCoverUrl(source), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TomiloLibBot/1.0; +https://tomilo-lib.ru)',
        Accept: 'image/*',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('Empty image response');
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { originalCoverUrl, downloadCover };
