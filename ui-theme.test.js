import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { spawn } from "node:child_process";

for (const [name, flags, width] of [
  ["desktop", [], 1200],
  [
    "narrow dark reduced motion",
    ["--force-dark-mode", "--force-prefers-reduced-motion"],
    480,
  ],
  ["forced colors", ["--force-high-contrast"], 1200],
]) {
  test(`native themed UI in Chrome: ${name}`, { timeout: 30000 }, async (t) => {
    const chrome =
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    try {
      await access(chrome);
    } catch {
      t.skip("Set CHROME_PATH to run Chrome UI checks");
      return;
    }
    const profile = await mkdtemp(join(tmpdir(), "watchmarker-theme-"));
    const root = resolve(import.meta.dirname);
    let finish;
    const received = new Promise((resolve) => {
      finish = resolve;
    });
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
            ".css": "text/css",
            ".html": "text/html",
            ".woff2": "font/woff2",
          }[extname(file)] || "application/octet-stream",
        );
        let body = await readFile(file);
        if (req.url === "/test-support/theme-runtime.browser.js")
          body =
            body.toString() + `\nfixture.expected = ${JSON.stringify(name)};`;

        if (req.url === "/content/index.html")
          body = body
            .toString()
            .replace(
              "<head>",
              '<head><script type="module" src="/test-support/theme-runtime.browser.js"></script><script type="module" src="/test-support/theme.browser.js"></script>',
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
        `--window-size=${width},900`,
        `--user-data-dir=${profile}`,
        ...flags,
        `http://127.0.0.1:${server.address().port}/content/index.html`,
      ],
      { stdio: "ignore" },
    );
    let timer;
    try {
      const results = await Promise.race([
        received,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Chrome UI checks timed out")),
            20000,
          );
        }),
      ]);
      for (const result of results) {
        t.diagnostic(result.name);
        assert.equal(result.passed, true, result.error || result.name);
      }
      assert.equal(results.length, 8);
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
