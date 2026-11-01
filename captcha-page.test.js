import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {
  isAllowedParent,
  isCaptchaInitialization,
} from "./verification/protocol.js";

const source = (
  await readFile(new URL("./verification/page.js", import.meta.url), "utf8")
).replace(/^import .*;\n/, "");
const init = {
  type: "watchmarker-captcha-init",
  nonce: "a".repeat(64),
  siteKey: "0x4public-widget-key",
};

function setup({ native = false, framed = false } = {}) {
  const sent = [];
  const scripts = [];
  const handlers = {};
  const status = {};
  let widget;
  const window = {
    addEventListener: (name, callback) => {
      handlers[name] = callback;
    },
    turnstile: {
      render: (_selector, options) => {
        widget = options;
        return 1;
      },
      reset() {},
    },
    parent: { postMessage: (data, origin) => sent.push({ data, origin }) },
  };
  if (!framed) window.parent = window;
  if (native)
    window.watchmarkerNative = {
      postMessage: (value) => sent.push(JSON.parse(value)),
    };
  vm.runInNewContext(source, {
    window,
    isAllowedParent,
    isCaptchaInitialization,
    document: {
      getElementById: () => status,
      createElement: () => ({
        handlers: {},
        addEventListener(name, callback) {
          this.handlers[name] = callback;
        },
      }),
      head: { append: (script) => scripts.push(script) },
    },
  });
  return {
    window,
    sent,
    scripts,
    handlers,
    get widget() {
      return widget;
    },
  };
}

test("native verification handshakes with the restricted host channel and returns only nonce and proof", () => {
  const fixture = setup({ native: true });
  assert.deepEqual(fixture.sent, [{ type: "watchmarker-captcha-ready" }]);
  fixture.window.watchmarkerNative.onmessage({ data: JSON.stringify(init) });
  assert.equal(fixture.scripts.length, 1);
  fixture.scripts[0].handlers.load();
  assert.equal(fixture.widget.sitekey, init.siteKey);
  fixture.widget.callback("native-proof");
  assert.deepEqual(fixture.sent[1], {
    type: "watchmarker-captcha-result",
    nonce: init.nonce,
    token: "native-proof",
  });
  fixture.window.watchmarkerNative.onmessage({ data: JSON.stringify(init) });
  assert.equal(fixture.scripts.length, 1);
});

test("native initialization rejects malformed messages and never activates inside an iframe", () => {
  const fixture = setup({ native: true });
  for (const value of [
    "invalid",
    "{}",
    JSON.stringify({ ...init, nonce: "bad" }),
    JSON.stringify({ ...init, siteKey: [init.siteKey] }),
  ])
    fixture.window.watchmarkerNative.onmessage({ data: value });
  assert.equal(fixture.scripts.length, 0);
  const framed = setup({ native: true, framed: true });
  assert.equal(framed.sent.length, 0);
  assert.equal(framed.window.watchmarkerNative.onmessage, undefined);
});

test("extension iframe verification still requires its exact parent source and permitted origin", () => {
  const fixture = setup({ framed: true });
  const event = {
    data: init,
    source: fixture.window.parent,
    origin: "chrome-extension://" + "a".repeat(32),
  };
  fixture.handlers.message({ ...event, source: {} });
  fixture.handlers.message({ ...event, origin: "https://attacker.example" });
  assert.equal(fixture.scripts.length, 0);
  fixture.handlers.message(event);
  fixture.scripts[0].handlers.load();
  fixture.widget.callback("extension-proof");
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.sent[0])), {
    origin: event.origin,
    data: {
      type: "watchmarker-captcha-result",
      nonce: init.nonce,
      token: "extension-proof",
    },
  });
});
