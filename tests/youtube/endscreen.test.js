import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
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
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Watchmarker end screen</title>");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;
    const headed = process.env.WATCHMARKER_HEADED_CHROME === "1";
    const child = spawn(
      chrome,
      [
        ...(headed ? [] : ["--headless"]),
        "--no-first-run",
        "--disable-background-networking",
        "--disable-extensions",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--window-size=1100,800",
        fixtureUrl,
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
        targets.find(
          (target) => target.type === "page" && target.url === fixtureUrl,
        ).webSocketDebuggerUrl,
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
      const command = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++sequence;
          pending.set(id, { resolve, reject });
          socket.send(
            JSON.stringify({
              id,
              method,
              params,
            }),
          );
        });
      const evaluate = (expression) =>
        command("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        });
      await command("Page.bringToFront");
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
        await t.test(
          fullscreen ? "fullscreen" : "normal layout",
          async (layout) => {
            const result = await evaluate(
              `verifyEndscreen(${JSON.stringify(settings)}, ${fullscreen})`,
            );
            if (
              fullscreen &&
              !headed &&
              result.exceptionDetails?.exception?.description ===
                "TypeError: not granted"
            ) {
              layout.skip(
                "Chrome denied fullscreen. A visible Chrome window can be requested with WATCHMARKER_HEADED_CHROME=1.",
              );
              return;
            }
            assert.equal(
              result.exceptionDetails,
              undefined,
              result.exceptionDetails?.exception?.description,
            );
            assert.equal(result.result.value.fullscreen, fullscreen);
            layout.diagnostic(
              `${result.result.value.tiles} tile layouts, toggles, dynamic insertions and recycled links passed`,
            );
          },
        );
      }
    } finally {
      clearTimeout(timer);
      socket?.close();
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await stopped;
      }
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  },
);
