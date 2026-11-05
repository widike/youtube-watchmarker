import assert from "node:assert/strict";
import test from "node:test";
import { MessageRouter } from "../extension/background/message-router.js";

const id = "abcdefghijklmnopabcdefghijklmnop";
let listener;
globalThis.chrome = {
  runtime: {
    id,
    getURL: (path) => `chrome-extension://${id}/${path.replace(/^\//, "")}`,
    onMessage: {
      addListener: (callback) => {
        listener = callback;
      },
    },
  },
};
const extension = { id, url: chrome.runtime.getURL("content/index.html") };
const content = {
  id,
  url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  tab: { id: 1 },
};
const videoId = "aaaaaaaaaaa";

function routerWithHandlers() {
  const router = new MessageRouter();
  router.registerMultiple({
    "youtube-lookup": async (request) => ({ strIdent: request.videoId }),
    "youtube-watch": async () => ({ data: { strIdent: videoId } }),
    "blocked-videos-list": async () => ({ videos: [] }),
    "blocked-videos-block": async () => ({}),
    "blocked-videos-unblock": async () => ({}),
    "search-delete": async () => ({}),
    "supabase-get-credentials": async () => ({ credentials: "private" }),
    "supabase-captcha-config": async () => ({ captcha: {} }),
    "set-setting": async () => ({}),
    "history-statistics": async () => ({ statistics: {} }),
    "duration-status": async () => ({ backfill: {} }),
    "duration-control": async () => ({ backfill: {} }),
  });
  return router;
}

test("YouTube content scripts can look up videos and report watches", async () => {
  const router = routerWithHandlers();
  for (const hostname of ["www.youtube.com", "m.youtube.com"]) {
    const sender = {
      ...content,
      url: `https://${hostname}/watch?v=${videoId}`,
    };
    assert.equal(
      (await router.handle({ action: "youtube-lookup", videoId }, sender))
        .strIdent,
      videoId,
    );
    assert.equal(
      (await router.handle({ action: "youtube-watch", videoId }, sender))
        .success,
      true,
    );
  }
});

test("credential and settings actions are restricted to extension pages", async () => {
  const router = routerWithHandlers();
  for (const action of [
    "supabase-get-credentials",
    "supabase-captcha-config",
    "set-setting",
    "history-statistics",
    "duration-status",
    "duration-control",
  ]) {
    assert.equal((await router.handle({ action }, content)).success, false);
    assert.equal((await router.handle({ action }, extension)).success, true);
  }
});

test("content can list and block videos while only options can unblock", async () => {
  const router = routerWithHandlers();
  assert.equal(
    (await router.handle({ action: "blocked-videos-list" }, content)).success,
    true,
  );
  for (const sender of [content, extension]) {
    assert.equal(
      (
        await router.handle(
          { action: "blocked-videos-block", videoId, title: "Title" },
          sender,
        )
      ).success,
      true,
    );
    assert.equal(
      (
        await router.handle(
          { action: "blocked-videos-block", videoId: "invalid" },
          sender,
        )
      ).success,
      false,
    );
  }
  assert.equal(
    (
      await router.handle(
        { action: "blocked-videos-unblock", videoId },
        content,
      )
    ).success,
    false,
  );
  assert.equal(
    (
      await router.handle(
        { action: "blocked-videos-unblock", videoId },
        extension,
      )
    ).success,
    true,
  );
  assert.equal(
    (await router.handle({ action: "blocked-videos-unblock" }, extension))
      .success,
    false,
  );
});

test("sender IDs and exact origins are checked before privileged work", async () => {
  const router = routerWithHandlers();
  for (const sender of [
    undefined,
    {},
    { ...extension, id: "another-extension" },
    {
      ...content,
      url: "https://www.youtube.com.attacker.example/watch?v=aaaaaaaaaaa",
    },
    { ...content, url: "http://www.youtube.com/watch?v=aaaaaaaaaaa" },
    { ...content, url: "https://example.com" },
    { ...content, url: "invalid" },
  ]) {
    assert.equal(
      (await router.handle({ action: "youtube-lookup", videoId }, sender))
        .success,
      false,
    );
  }
});

test("malformed messages and invalid video metadata return structured errors", async () => {
  const router = routerWithHandlers();
  for (const request of [
    null,
    [],
    "youtube-lookup",
    {},
    { action: 42 },
    { action: "missing" },
    { action: "youtube-lookup" },
    { action: "youtube-lookup", videoId: "aaaaaaaaaaaa" },
    { action: "youtube-lookup", videoId, title: {} },
    { action: "youtube-lookup", videoId, title: "a".repeat(2001) },
    { action: "youtube-watch", videoId, timestamp: NaN },
    { action: "youtube-watch", videoId, count: -1 },
  ]) {
    const response = await router.handle(request, extension);
    assert.equal(response.success, false);
    assert.equal(typeof response.error, "string");
  }
});

test("content scripts cannot override dates or counts", async () => {
  const router = routerWithHandlers();
  for (const action of ["youtube-watch", "search-delete"]) {
    for (const metadata of [{ timestamp: 42 }, { count: 5 }]) {
      assert.equal(
        (await router.handle({ action, videoId, ...metadata }, content))
          .success,
        false,
      );
    }
  }
});

test("content scripts cannot bypass watch detection with direct writes", async () => {
  assert.equal(
    (
      await routerWithHandlers().handle(
        {
          action: "search-delete",
          videoId,
        },
        content,
      )
    ).success,
    false,
  );
});

test("non-Error failures and invalid handler responses still resolve safely", async () => {
  const router = routerWithHandlers();
  for (const handler of [
    async () => {
      throw null;
    },
    async () => [],
    async () => undefined,
  ]) {
    router.registerMultiple({ "set-setting": handler });
    const response = await router.handle({ action: "set-setting" }, extension);
    assert.equal(response.success, false);
    assert.equal(typeof response.error, "string");
  }
});

test("listener keeps asynchronous responses open and preserves handler errors", async () => {
  const router = routerWithHandlers();
  let registrations = 0;
  chrome.runtime.onMessage.addListener = (callback) => {
    listener = callback;
    registrations++;
  };
  router.setupListeners();
  router.setupListeners();
  assert.equal(registrations, 1);
  let resolveResponse;
  const response = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  assert.equal(
    listener({ action: "youtube-lookup", videoId }, content, resolveResponse),
    true,
  );
  assert.equal((await response).strIdent, videoId);
  router.registerMultiple({
    "set-setting": async () => {
      throw new Error("write failed");
    },
  });
  assert.equal(
    (await router.handle({ action: "set-setting" }, extension)).error,
    "write failed",
  );
});
