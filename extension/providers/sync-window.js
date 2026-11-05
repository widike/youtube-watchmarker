// Revisions are decimal strings: Postgres bigint cursors must never pass
// through JavaScript's lossy Number representation.
export function revision(value = "0") {
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new Error("Invalid sync revision");
  return value;
}

export async function downloadChanges({
  storage,
  collection,
  latest = "0",
  page,
  merge,
  key,
  now = Date.now,
  deadline,
}) {
  revision(latest);
  const metadataKey = `syncWindow:${collection}`;
  let window = (await storage.get(metadataKey)) || {
    since: "0",
    until: "0",
    after: "",
  };
  revision(window.since);
  revision(window.until);
  if (BigInt(latest) < BigInt(window.until))
    throw new Error(
      "Cloud sync revisions moved backwards; restore the cloud checkpoint before syncing.",
    );
  if (window.since === window.until) {
    if (BigInt(latest) <= BigInt(window.since))
      return { downloaded: 0, complete: true };
    window = { since: window.since, until: latest, after: "" };
    await storage.set(metadataKey, window);
  }
  let downloaded = 0;
  while (now() < deadline) {
    const rows = await page(window.after, 500, window);
    if (
      rows.some((row, i) => key(row) <= (i ? key(rows[i - 1]) : window.after))
    )
      throw new Error(`Invalid ${collection} page order`);
    if (!rows.length) {
      await storage.set(metadataKey, {
        since: window.until,
        until: window.until,
        after: "",
      });
      // Updates that committed while this window was downloading are next.
      return { downloaded, complete: window.until === latest };
    }
    await merge(rows);
    window.after = key(rows.at(-1));
    await storage.set(metadataKey, window);
    downloaded += rows.length;
  }
  return { downloaded, complete: false };
}
