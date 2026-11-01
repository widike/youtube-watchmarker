const fixture = (window.statisticsFixture = {
  errors: [],
  calls: [],
  fail: false,
  empty: false,
  local: {},
  sync: {},
  storageListeners: new Set(),
  reconciliation: {
    plan: null,
    approved: 0,
    declined: 0,
    serial: 0,
    ready: true,
  },
  duration: {
    configured: false,
    enabled: false,
    status: "paused",
    total: 3,
    available: 0,
    unavailable: 0,
    remaining: 3,
  },
});
window.addEventListener("error", (event) => fixture.errors.push(event.message));
window.addEventListener("unhandledrejection", (event) =>
  fixture.errors.push(String(event.reason?.stack || event.reason)),
);
const data = import("./statistics-fixture.browser.js");
const storage = (name) => ({
  get: async () => fixture[name],
  set: async (values) => Object.assign(fixture[name], values),
  remove: async (keys) => {
    for (const key of keys) delete fixture[name][key];
  },
});
chrome.storage = {
  local: storage("local"),
  sync: storage("sync"),
  onChanged: {
    addListener: (listener) => fixture.storageListeners.add(listener),
    removeListener: (listener) => fixture.storageListeners.delete(listener),
  },
};
chrome.tabs = {
  create: async ({ url }) => {
    fixture.opened = url;
  },
};
chrome.runtime = {
  getURL: (path) => new URL(path, location.origin).href,
  sendMessage: async (request) => {
    fixture.calls.push(request);
    if (request.action === "history-reconcile") {
      const state = fixture.reconciliation;
      if (request.operation === "preview")
        state.plan = {
          id: `plan-${++state.serial}`,
          status: "preview",
          scanned: 1500,
          videos: 1000,
          removed: 1000,
          before: 2500,
          after: 1500,
          playbacks: 20,
          undated: 15,
          examples: [
            {
              strIdent: "abcdefghijk",
              strTitle: "Affected example",
              before: 2,
              after: 1,
            },
          ],
        };
      if (request.operation === "decline") {
        state.declined++;
        state.plan.status = "declined";
      }
      if (request.operation === "approve") {
        if (!state.ready)
          return { success: false, error: "Supabase migration required" };
        state.approved++;
        state.plan.status = "applied";
      }
      return {
        success: true,
        plan: state.plan,
        report: { removed: 1000 },
        cloud: {
          ready: state.ready,
          error: "Apply the Supabase migration before approval.",
        },
        ...(["approve", "sync"].includes(request.operation)
          ? { sync: { verified: request.operation === "sync" } }
          : {}),
      };
    }
    if (request.action === "duration-status")
      return { success: true, backfill: fixture.duration };
    if (request.action === "duration-control") {
      const enabled = request.command === "start";
      fixture.duration = {
        ...fixture.duration,
        configured: request.command !== "forget",
        enabled,
        status: enabled ? "queued" : "paused",
      };
      return { success: true, backfill: fixture.duration };
    }
    if (request.action === "history-statistics") {
      await new Promise((resolve) =>
        setTimeout(resolve, request.period === "week" ? 80 : 5),
      );
      if (fixture.fail)
        return { success: false, error: "Test connection failure" };
      return {
        success: true,
        statistics: (await data).statistics(
          request.period,
          fixture.empty,
          fixture.noTime,
        ),
      };
    }
    if (request.action === "database-size") return { success: true, size: 24 };
    if (request.action === "database-provider-status")
      return { success: true, status: { configured: false } };
    if (request.action === "supabase-get-credentials") return { success: true };
    return { success: true, objVideos: [], totalResults: 0 };
  },
};
window.close = () => {
  fixture.closed = true;
};
