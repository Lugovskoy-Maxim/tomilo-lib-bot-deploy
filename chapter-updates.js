/** Keep the publishing feed and the overnight cover queue on the same sources. */
async function fetchChapterUpdates({ fetchPublic, fetchHidden, warn = console.warn }) {
  const publicUpdates = await fetchPublic();
  let hiddenUpdates = [];
  try {
    hiddenUpdates = await fetchHidden();
  } catch (error) {
    // A temporary failure must not stop public releases. Hidden releases will
    // be retried on the next scan; delivery is tracked per title and chapter.
    warn('Hidden chapter updates skipped:', error.message);
  }
  return [...publicUpdates, ...hiddenUpdates];
}

module.exports = { fetchChapterUpdates };
