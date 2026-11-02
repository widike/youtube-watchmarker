import { CaptchaChallenge } from "../../extension/ui/captcha-challenge.js";
CaptchaChallenge.prototype.verify = async () => "fixture-captcha-proof";

const fixture = (window.fixture = {
  errors: [],
  local: {},
  sync: {},
  providerStatus: { configured: false },
  requests: [],
});
window.addEventListener("error", (event) => fixture.errors.push(event.message));
window.addEventListener("unhandledrejection", (event) =>
  fixture.errors.push(String(event.reason?.stack || event.reason)),
);
const storage = (name) => ({
  get: async () => fixture[name],
  set: async (values) => Object.assign(fixture[name], values),
});
chrome.storage = {
  local: storage("local"),
  sync: storage("sync"),
  onChanged: { addListener() {}, removeListener() {} },
};
chrome.runtime = {
  sendMessage: async (request) => {
    const { action } = request;
    fixture.requests.push(request);
    if (action === "source-preview") {
      if (fixture.delaySources) {
        await new Promise((resolve) => {
          (fixture.pendingSourceChecks ||= []).push(resolve);
        });
      }
      if (fixture.sourceError === request.source)
        return { success: false, error: "Sign in to YouTube" };
      return {
        success: true,
        preview: {
          totalCount: 1200,
          existingCount: 900 + (fixture.imported ? 300 : 0),
          newCount: fixture.imported ? 0 : 300,
          checkedAt: Date.now(),
        },
      };
    }
    if (action === "history-synchronize") {
      fixture.imported = true;
      return { success: true, response: { newCount: 300 } };
    }
    if (action === "database-size") return { success: true, size: 0 };
    if (action === "database-provider-status")
      return { success: true, status: fixture.providerStatus };
    if (action === "supabase-connect") {
      if (fixture.connectionError)
        return { success: false, error: fixture.connectionError };
      fixture.providerStatus = { configured: true, pending: 0 };
      return { success: true };
    }
    if (action === "supabase-captcha-config")
      return { success: true, captcha: {} };
    if (action === "supabase-create-link")
      return {
        success: true,
        connectionCode: "KMT-PXR",
      };
    return { success: true, objVideos: [], totalResults: 0 };
  },
};
