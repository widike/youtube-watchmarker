import assert from "node:assert/strict";
import test from "node:test";
import { CaptchaChallenge } from "./ui/captcha-challenge.js";
import { CAPTCHA_ORIGIN, CAPTCHA_PAGE_URL } from "./verification/protocol.js";

function setup(t) {
  const window = new EventTarget();
  const container = {
    hidden: true,
    replaceChildren(...children) {
      this.children = children;
    },
  };
  class Element extends EventTarget {
    setAttribute() {}
  }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  globalThis.window = window;
  globalThis.document = {
    createElement() {
      const element = new Element();
      element.contentWindow = {
        postMessage(data, origin) {
          element.sent = { data, origin };
        },
      };
      return element;
    },
  };
  const challenge = new CaptchaChallenge(container);
  t.after(() => {
    challenge.cancel?.();
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  });
  const send = (
    frame,
    data,
    origin = CAPTCHA_ORIGIN,
    source = frame.contentWindow,
  ) => {
    window.dispatchEvent(
      Object.assign(new Event("message"), { data, origin, source }),
    );
  };
  return { challenge, container, send };
}
const config = { pageUrl: CAPTCHA_PAGE_URL, siteKey: "0x4public-widget-key" };

test("a challenge rejects spoofed messages and consumes the matching frame reply once", async (t) => {
  const { challenge, container, send } = setup(t);
  const pending = challenge.verify(config);
  const [frame] = container.children;
  frame.dispatchEvent(new Event("load"));
  const { nonce } = frame.sent.data;
  assert.equal(frame.sent.origin, CAPTCHA_ORIGIN);
  assert.equal(container.hidden, false);
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  const reply = { type: "watchmarker-captcha-result", nonce, token: "proof" };
  send(frame, reply, "https://attacker.example");
  send(frame, reply, CAPTCHA_ORIGIN, {});
  send(frame, { ...reply, nonce: "wrong-attempt" });
  await Promise.resolve();
  assert.equal(settled, false);
  send(frame, reply);
  assert.equal(await pending, "proof");
  assert.equal(container.hidden, true);
  assert.equal(container.children.length, 0);
  assert.equal(challenge.cancel, null);
});

test("cancellation removes the frame and cannot produce a signup token", async (t) => {
  const { challenge, container } = setup(t);
  const controller = new AbortController();
  const pending = challenge.verify(config, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(container.hidden, true);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    challenge.verify(config, { signal: cancelled.signal }),
    /cancelled/,
  );
});

test("an abandoned verification expires and releases its frame", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { challenge, container } = setup(t);
  const pending = challenge.verify(config);
  t.mock.timers.tick(180001);
  await assert.rejects(pending, /expired/);
  assert.equal(container.hidden, true);
});
