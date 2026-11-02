import { YoutubeManager } from "../../extension/sources/bg-youtube.js";

export const likedVideo = (id, title = "Liked video") => ({
  playlistVideoRenderer: { videoId: id, title: { runs: [{ text: title }] } },
});
export const continuation = (token) => ({
  continuationItemRenderer: {
    continuationEndpoint: { continuationCommand: { token } },
  },
});
export const playlistResponse = (items) => ({
  onResponseReceivedActions: [
    {
      appendContinuationItemsAction: { continuationItems: items },
    },
  ],
});
export function likedPage(items, overrides = {}) {
  const data = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          { tabRenderer: { title: "Other tab" } },
          {
            tabRenderer: {
              selected: true,
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      itemSectionRenderer: {
                        contents: [
                          { playlistVideoListRenderer: { contents: items } },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
    ...overrides,
  };
  return `<script>ytcfg.set(${JSON.stringify({
    INNERTUBE_API_KEY: "test-key",
    INNERTUBE_CONTEXT_CLIENT_NAME: 1,
    INNERTUBE_CONTEXT: { client: { clientName: "WEB", clientVersion: "1" } },
    SESSION_INDEX: "2",
    DELEGATED_SESSION_ID: "test-channel",
  })});var ytInitialData = ${JSON.stringify(data)};</script>`;
}

export function setupLikedSync(t, html, pages = {}, existing = []) {
  const records = new Map(existing.map((v) => [v.strIdent, v]));
  const requests = [];
  const writes = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, ...options });
    if (!options?.body) return { ok: true, text: async () => html };
    const token = JSON.parse(options.body).continuation;
    const page = pages[token];
    if (page instanceof Error) throw page;
    return page?.ok === false ? page : { ok: true, json: async () => page };
  });
  const oldChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: { id: "fixture-extension", getPlatformInfo: async () => ({}) },
    declarativeNetRequest: { updateSessionRules: async () => {} },
    cookies: { get: (_details, cb) => cb({ value: "test-cookie" }) },
  };
  t.after(() => {
    globalThis.chrome = oldChrome;
  });
  const manager = new YoutubeManager();
  const provider = {
    getVideo: async (id) => records.get(id),
    putVideo: async (v) => {
      records.set(v.strIdent, v);
      writes.push(v);
    },
  };
  manager.setProviderFactory({ getCurrentProvider: () => provider });
  return { manager, provider, records, requests, writes };
}
