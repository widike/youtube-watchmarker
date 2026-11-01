// Count unique importable videos without changing history or the sync outbox.
export async function summarizeSource(videoIds, provider, { signal } = {}) {
  signal?.throwIfAborted();
  const ids = [...new Set(videoIds)];
  let existingCount = 0;
  // Bound concurrent IndexedDB reads even for very large histories.
  for (let offset = 0; offset < ids.length; offset += 100) {
    signal?.throwIfAborted();
    const records = await Promise.all(
      ids
        .slice(offset, offset + 100)
        .map((id) => provider.getVideo(id, { includeDeleted: true })),
    );
    signal?.throwIfAborted();
    existingCount += records.filter(Boolean).length;
  }
  return {
    totalCount: ids.length,
    existingCount,
    newCount: ids.length - existingCount,
    checkedAt: Date.now(),
  };
}
