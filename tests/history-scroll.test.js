import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { spawn } from "node:child_process";

const mockRuntime = `
window.fixture = { calls: [], total: 420, failOffset: null, deleted: new Set(), errors: [], now: Date.now(), storageListeners: new Set() };
window.addEventListener('error', (event) => fixture.errors.push(event.message));
window.addEventListener('unhandledrejection', (event) => fixture.errors.push(String(event.reason?.stack || event.reason)));
chrome.storage = { local: { get: async () => ({}), set: async () => {} }, onChanged: {
  addListener: listener => fixture.storageListeners.add(listener),
  removeListener: listener => fixture.storageListeners.delete(listener)
} };
chrome.runtime = { sendMessage: async (request) => {
  if (request.action === 'history-statistics') return { success: true,
    statistics: (await import('/history-statistics.js')).summarizeHistory([]) };
  fixture.calls.push(request);
  if (request.action === 'search-delete') { fixture.deleted.add(request.videoId); return { success: true }; }
  if (request.offset === fixture.failOffset) return { success: false, error: 'offline' };
  const records = Array.from({ length: fixture.total }, (_, i) => ({
    strIdent: String(i).padStart(11, 'a'), strTitle: 'Video ' + i,
    intTimestamp: fixture.now - Math.floor(i / 40) * 86400000, intCount: i % 5 + 1,
    watchPrecision: 'exact',
    ...(fixture.durationsReady ? { durationSeconds: 600 } : {}),
    ...(i < 2 ? { durationSeconds: i ? 14459 : 600,
      watchedMilliseconds: i ? 7565000 : 120000, watchedPercent: i ? 98 : 50 } : {})
  })).filter(video => !fixture.deleted.has(video.strIdent));
  return { success: true, totalResults: request.query ? 0 : records.length,
    objVideos: request.query ? [] : records.slice(request.offset, request.offset + request.limit) };
} };
`;

test(
  "real Chrome infinite scrolling and bounded virtual lists",
  { timeout: 60000 },
  async (t) => {
    const chrome =
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    try {
      await access(chrome);
    } catch {
      t.skip("Set CHROME_PATH to run Chrome scroll checks");
      return;
    }
    const profile = await mkdtemp(join(tmpdir(), "watchmarker-scroll-"));
    const root = resolve(import.meta.dirname, "..");
    let finish;
    const received = new Promise((resolve) => {
      finish = resolve;
    });
    const server = createServer(async (req, res) => {
      if (req.url === "/results") {
        let data = "";
        for await (const chunk of req) data += chunk;
        finish(JSON.parse(data));
        res.end("ok");
        return;
      }
      if (req.url === "/mock-runtime.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(mockRuntime);
        return;
      }
      if (req.url.startsWith("/thumbnails/")) {
        res.setHeader("Content-Type", "image/png");
        res.end(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
            "base64",
          ),
        );
        return;
      }
      const file = resolve(root, `.${req.url.split("?")[0]}`);
      if (!file.startsWith(`${root}/`)) {
        res.writeHead(403).end();
        return;
      }
      try {
        const mime =
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
            ".woff2": "font/woff2",
          }[extname(file)] || "application/octet-stream";
        res.setHeader("Content-Type", mime);
        let data = await readFile(file);
        if (req.url === "/extension/popup.html")
          data = data
            .toString()
            .replace(
              "<head>",
              '<head><script src="/mock-runtime.js"></script><script type="module" src="/tests/support/history-scroll.browser.js"></script>',
            );
        if (req.url === "/ui/history-library.js")
          data = data
            .toString()
            .replace(
              "https://i.ytimg.com",
              `http://127.0.0.1:${server.address().port}/thumbnails`,
            );
        res.end(data);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const child = spawn(
      chrome,
      [
        "--headless",
        "--no-first-run",
        "--disable-background-networking",
        "--disable-extensions",
        "--window-size=1200,900",
        `--user-data-dir=${profile}`,
        `http://127.0.0.1:${server.address().port}/extension/popup.html`,
      ],
      { stdio: "ignore" },
    );
    let timer;
    try {
      const results = await Promise.race([
        received,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Chrome scroll checks timed out")),
            50000,
          );
        }),
      ]);
      for (const result of results) {
        t.diagnostic(result.name);
        assert.equal(result.passed, true, result.error || result.name);
      }
      assert.equal(results.length, 9);
    } finally {
      clearTimeout(timer);
      child.kill();
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
