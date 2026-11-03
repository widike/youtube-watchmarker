const fixture = (window.startupFixture = { errors: [], calls: [] });
for (const name of ["panels", "local", "preferences", "sidebar"]) {
  fixture[`${name}Ready`] = new Promise((resolve) => {
    fixture[`release${name}`] = resolve;
  });
}
window.addEventListener("error", (event) => fixture.errors.push(event.message));
window.addEventListener("unhandledrejection", (event) =>
  fixture.errors.push(String(event.reason?.stack || event.reason)),
);
const fetchResource = window.fetch.bind(window);
window.fetch = async (url, ...args) => {
  if (/\/options\/(statistics|sync|preferences)\.html$/.test(String(url)))
    await fixture.panelsReady;
  return fetchResource(url, ...args);
};
fixture.local = { theme: "dark", historyDisplay: { view: "list" } };
chrome.storage = {
  local: {
    get: async () => {
      const saved = structuredClone(fixture.local);
      await fixture.localReady;
      return saved;
    },
    set: async (values) => Object.assign(fixture.local, values),
  },
  sync: {
    get: async () => {
      await fixture.preferencesReady;
      return {};
    },
    set: async () => {},
  },
  onChanged: { addListener() {}, removeListener() {} },
};
chrome.runtime = {
  sendMessage: async (request) => {
    fixture.calls.push(request);
    if (request.action === "search-videos")
      return {
        success: true,
        totalResults: 1,
        objVideos: [
          {
            strIdent: "abcdefghijk",
            strTitle: "History loads first",
            intTimestamp: Date.now(),
            entryId: "first-watch",
          },
        ],
      };
    if (request.action === "database-size") {
      await fixture.sidebarReady;
      return { success: true, size: 1 };
    }
    if (request.action === "database-provider-status") {
      await fixture.sidebarReady;
      return { success: true, status: { configured: false } };
    }
    return { success: true };
  },
};
