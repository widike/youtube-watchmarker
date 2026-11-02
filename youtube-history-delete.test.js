import test from "node:test";
import assert from "node:assert/strict";
import { deleteFromHistory } from "./youtube-history-delete.js";

const id = "aaaaaaaaaaa";
const card = (videoId, token) => ({
  videoRenderer: {
    videoId,
    menu: {
      menuRenderer: {
        items: token
          ? [
              {
                menuServiceItemRenderer: {
                  icon: { iconType: "DELETE" },
                  serviceEndpoint: {
                    feedbackEndpoint: { feedbackToken: token },
                  },
                },
              },
            ]
          : [],
      },
    },
  },
});
const continuation = (token) => ({
  continuationItemRenderer: {
    continuationEndpoint: { continuationCommand: { token } },
  },
});
const html = (items) =>
  `ytcfg.set(${JSON.stringify({
    INNERTUBE_API_KEY: "fixture",
    INNERTUBE_CONTEXT: { client: {} },
    SESSION_INDEX: 2,
  })}); var ytInitialData = ${JSON.stringify({
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              selected: true,
              content: { sectionListRenderer: { contents: items } },
            },
          },
        ],
      },
    },
  })};`;
const page = (items) => ({
  onResponseReceivedActions: [
    {
      appendContinuationItemsAction: { continuationItems: items },
    },
  ],
});
function fixture(
  t,
  initial,
  pages = {},
  feedback = { feedbackResponses: [{ isProcessed: true }] },
) {
  const previous = globalThis.chrome;
  globalThis.chrome = {
    runtime: { id: "fixture" },
    cookies: { get: (_details, cb) => cb({ value: "cookie" }) },
    declarativeNetRequest: { updateSessionRules: async () => {} },
  };
  t.after(() => {
    globalThis.chrome = previous;
  });
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (!options?.body) return { ok: true, text: async () => initial };
    const body = JSON.parse(options.body);
    sent.push({ url, body, headers: options.headers });
    if (body.continuation) {
      const result = pages[body.continuation];
      if (result?.status) return { ok: false, status: result.status };
      return { ok: true, json: async () => result };
    }
    return { ok: true, json: async () => feedback };
  });
  return sent;
}

test("deletion reaches older pages, removes every occurrence and uses the signed-in account", async (t) => {
  const sent = fixture(
    t,
    html([card("bbbbbbbbbbb", "other"), continuation("older")]),
    {
      older: page([card(id, "first"), continuation("oldest")]),
      oldest: page([card(id, "second")]),
    },
  );
  assert.deepEqual(await deleteFromHistory(id), { success: true });
  assert.deepEqual(
    sent.filter((r) => r.body.feedbackTokens).map((r) => r.body.feedbackTokens),
    [["first"], ["second"]],
  );
  assert.ok(sent.every((r) => r.headers["X-Goog-AuthUser"] === "2"));
});

test("old-history scan resumes its durable cursor on the next worker attempt", async (t) => {
  const sent = fixture(t, html([continuation("older")]), {
    older: page([card(id, "remove")]),
  });
  let state;
  const checkpoint = async (value) => {
    state = value;
  };
  assert.equal(
    (await deleteFromHistory(id, { maxPages: 1, checkpoint })).success,
    false,
  );
  assert.equal(state.nextToken, "older");
  assert.equal(
    (await deleteFromHistory(id, { state, checkpoint })).success,
    true,
  );
  assert.equal(sent.filter((r) => r.body.continuation).length, 1);
});

test("already absent is success only after all history pages are checked", async (t) => {
  const sent = fixture(t, html([continuation("older")]), { older: page([]) });
  assert.equal((await deleteFromHistory(id)).success, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.continuation, "older");
});

for (const [name, feedback] of [
  ["unprocessed", { feedbackResponses: [{ isProcessed: false }] }],
  ["missing acknowledgement", {}],
  ["error", { error: { code: 401 } }],
])
  test(`YouTube ${name} cannot report deletion success`, async (t) => {
    fixture(t, html([card(id, "remove")]), {}, feedback);
    await assert.rejects(deleteFromHistory(id), /confirm/);
  });

test("missing deletion tokens, signed-out pages and failed pagination stay failures", async (t) => {
  fixture(t, html([card(id)]));
  await assert.rejects(deleteFromHistory(id), /deletion token/);
  await assert.rejects(deleteFromHistory("invalid"), /Invalid/);
});

test("failed continuation is not mistaken for an absent video", async (t) => {
  fixture(t, html([continuation("older")]), { older: { status: 503 } });
  await assert.rejects(deleteFromHistory(id), /503/);
});

test("signed-out and malformed histories cannot acknowledge a deletion", async (t) => {
  fixture(t, "<html>Sign in</html>");
  await assert.rejects(deleteFromHistory(id), /Sign in/);
});

test("continuation loops cannot acknowledge an incomplete scan", async (t) => {
  fixture(t, html([continuation("loop")]), {
    loop: page([continuation("loop")]),
  });
  await assert.rejects(deleteFromHistory(id), /repeated/);
});

test("a queued deletion is not applied after switching YouTube account slots", async (t) => {
  const sent = fixture(t, html([card(id, "remove")]));
  await assert.rejects(
    deleteFromHistory(id, { state: { account: "0:" } }),
    /Switch back/,
  );
  assert.equal(sent.length, 0);
});

test("only removal feedback from the targeted history card is submitted", async (t) => {
  const target = card(id, "remove");
  target.videoRenderer.menu.menuRenderer.items.unshift({
    menuServiceItemRenderer: {
      icon: { iconType: "NOT_INTERESTED" },
      serviceEndpoint: { feedbackEndpoint: { feedbackToken: "unrelated" } },
    },
  });
  const sent = fixture(t, html([target, card("bbbbbbbbbbb", "other")]));
  assert.equal((await deleteFromHistory(id)).success, true);
  assert.deepEqual(sent[0].body.feedbackTokens, ["remove"]);
});

test("an empty feed without a sign-in cookie cannot clear a queued deletion", async (t) => {
  fixture(t, html([]));
  chrome.cookies.get = (_details, cb) => cb(null);
  await assert.rejects(deleteFromHistory(id), /sign-in cookie/);
});
