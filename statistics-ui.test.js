import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, extname } from "node:path";
import { spawn } from "node:child_process";

for (const [name, width, path, flags] of [
  ["desktop", 1440, "/content/index.html#statistics", []],
  ["narrow dark", 420, "/content/index.html#statistics", ["--force-dark-mode"]],
  [
    "forced colors",
    1200,
    "/content/index.html#statistics",
    ["--force-high-contrast"],
  ],
  ["popup", 620, "/popup.html", []],
  ["popup dark", 620, "/popup.html", ["--force-dark-mode"]],
  ["popup forced colors", 620, "/popup.html", ["--force-high-contrast"]],
]) {
  test(`statistics in real Chrome: ${name}`, { timeout: 30000 }, async (t) => {
    const chrome =
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    try {
      await access(chrome);
    } catch {
      t.skip("Chrome not installed");
      return;
    }
    const profile = await mkdtemp(join(tmpdir(), "watchmarker-statistics-"));
    let finish;
    const received = new Promise((resolve) => {
      finish = resolve;
    });
    const root = resolve(import.meta.dirname);
    const server = createServer(async (req, res) => {
      if (req.url === "/results") {
        let body = "";
        for await (const chunk of req) body += chunk;
        finish(JSON.parse(body));
        res.end("ok");
        return;
      }
      const file = resolve(root, `.${req.url.split("?")[0]}`);
      if (!file.startsWith(`${root}/`)) {
        res.writeHead(403).end();
        return;
      }
      try {
        res.setHeader(
          "Content-Type",
          {
            ".js": "text/javascript",
            ".html": "text/html",
            ".css": "text/css",
            ".woff2": "font/woff2",
          }[extname(file)] || "application/octet-stream",
        );
        let body = await readFile(file);
        if (["/content/index.html", "/popup.html"].includes(req.url))
          body = body
            .toString()
            .replace(
              "<head>",
              '<head><script src="/test-support/statistics-runtime.browser.js"></script><script type="module" src="/test-support/statistics.browser.js"></script>',
            );
        res.end(body);
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
        `--window-size=${width},1000`,
        `--user-data-dir=${profile}`,
        ...flags,
        `http://127.0.0.1:${server.address().port}${path}`,
      ],
      { stdio: "ignore" },
    );
    let timer;
    try {
      const results = await Promise.race([
        received,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Statistics UI timed out")),
            24000,
          );
        }),
      ]);
      for (const result of results) {
        t.diagnostic(result.name);
        assert.equal(result.passed, true, result.error || result.name);
      }
      assert.equal(results.length, path === "/popup.html" ? 2 : 7);
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
  });
}
