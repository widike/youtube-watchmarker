import { revision } from "./sync-window.js";

export async function getSyncState(provider) {
  const state = await (
    await provider.makeRequest("POST", "/rpc/watchmarker_sync_state", {})
  ).json();
  if (
    state?.version !== 1 ||
    typeof state.owner !== "string" ||
    !state.revisions
  )
    throw new Error(
      "Incremental sync setup is missing. Choose Copy setup SQL in Sync & data and run it in Supabase SQL Editor.",
    );
  for (const value of Object.values(state.revisions)) revision(value);
  return state;
}

export async function getSyncPage(provider, collection, after, limit, window) {
  const response = await provider.makeRequest(
    "POST",
    "/rpc/watchmarker_sync_page",
    {
      p_collection: collection,
      p_since: revision(window.since),
      p_until: revision(window.until),
      p_after: after,
      p_limit: limit,
    },
  );
  return response.json();
}
