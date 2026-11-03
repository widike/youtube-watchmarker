import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "../../extension/background/settings-manager.js";

test(
  "end-screen recommendations obey appearance settings in Chrome and fullscreen",
  {
    timeout: 30000,
  },
  async (t) => {
    const chrome =
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    try {
      await access(chrome);
    } catch {
      t.skip("Set CHROME_PATH to run Chrome end-screen checks");
      return;
    }
    const original = globalThis.chrome;
    // Existing users must receive the new end-card styles on initialization.
    const settings = {
      stylesheet_Fadeout: "old styles",
      idVisualization_Fadeout: true,
    };
    globalThis.chrome = {
      storage: {
        sync: {
          get: async () => ({ ...settings }),
          set: async (updates) => Object.assign(settings, updates),
        },
      },
    };
    try {
      await new SettingsManager().initialize();
    } finally {
      globalThis.chrome = original;
    }
    const profile = await mkdtemp(join(tmpdir(), "watchmarker-endscreen-"));
    const child = spawn(
      chrome,
      [
        "--headless",
        "--no-first-run",
        "--disable-background-networking",
        "--disable-extensions",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--window-size=1100,800",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let socket;
    let timer;
    try {
      const endpoint = await new Promise((resolve, reject) => {
        let output = "";
        timer = setTimeout(
          () => reject(new Error("Chrome did not start")),
          10000,
        );
        child.once("error", reject);
        child.stderr.on("data", (chunk) => {
          output += chunk;
          const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
          if (match) resolve(new URL(match[1]));
        });
      });
      clearTimeout(timer);
      const targets = await fetch(`http://${endpoint.host}/json/list`).then(
        (res) => res.json(),
      );
      socket = new WebSocket(
        targets.find((target) => target.type === "page").webSocketDebuggerUrl,
      );
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      let sequence = 0;
      const pending = new Map();
      socket.addEventListener("message", ({ data }) => {
        const response = JSON.parse(data);
        const operation = pending.get(response.id);
        if (!operation) return;
        pending.delete(response.id);
        if (response.error) operation.reject(new Error(response.error.message));
        else operation.resolve(response.result);
      });
      const evaluate = (expression) =>
        new Promise((resolve, reject) => {
          const id = ++sequence;
          pending.set(id, { resolve, reject });
          socket.send(
            JSON.stringify({
              id,
              method: "Runtime.evaluate",
              params: {
                expression,
                awaitPromise: true,
                returnByValue: true,
                userGesture: true,
              },
            }),
          );
        });
      const files = [
        "shared/video-identity.js",
        "youtube/core.js",
        "youtube/settings-runtime.js",
        "youtube/rendering.js",
        "youtube/interactions.js",
        "../tests/support/endscreen.browser.js",
      ];
      const source = await Promise.all(
        files.map((file) =>
          readFile(new URL(`../../extension/${file}`, import.meta.url), "utf8"),
        ),
      );
      const loaded = await evaluate(source.join("\n"));
      assert.equal(loaded.exceptionDetails, undefined);
      for (const fullscreen of [false, true]) {
        const result = await evaluate(
          `verifyEndscreen(${JSON.stringify(settings)}, ${fullscreen})`,
        );
        assert.equal(
          result.exceptionDetails,
          undefined,
          result.exceptionDetails?.exception?.description,
        );
        assert.equal(result.result.value.fullscreen, fullscreen);
        t.diagnostic(
          `${fullscreen ? "Fullscreen" : "Normal"}: ${result.result.value.tiles} tile layouts, toggles, dynamic insertions and recycled links passed`,
        );
      }
    } finally {
      clearTimeout(timer);
      socket?.close();
      const stopped = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await stopped;
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  },
);
