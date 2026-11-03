import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, extname } from "node:path";
import { spawn } from "node:child_process";

for (const mode of ["saved", "chosen"]) {
  test(
    `options history starts independently of settings: ${mode} layout`,
    { timeout: 20000 },
    async (t) => {
      const chrome =
        process.env.CHROME_PATH ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
      try {
        await access(chrome);
      } catch {
        t.skip("Set CHROME_PATH to run Chrome startup checks");
        return;
      }
      const root = resolve(import.meta.dirname, "..");
      const profile = await mkdtemp(join(tmpdir(), "watchmarker-startup-"));
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
        const path = req.url.split("?")[0];
        const file = resolve(root, `.${path}`);
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
          if (path === "/extension/content/index.html")
            body = body
              .toString()
              .replace(
                "<head>",
                '<head><script src="/tests/support/options-startup-runtime.browser.js"></script><script type="module" src="/tests/support/options-startup.browser.js"></script>',
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
          "--window-size=1200,900",
          `--user-data-dir=${profile}`,
          `http://127.0.0.1:${server.address().port}/extension/content/index.html?${mode}`,
        ],
        { stdio: "ignore" },
      );
      let timer;
      try {
        const results = await Promise.race([
          received,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Chrome startup check timed out")),
              15000,
            );
          }),
        ]);
        for (const result of results) {
          t.diagnostic(result.name);
          assert.equal(result.passed, true, result.error || result.name);
        }
        assert.equal(results.length, 1);
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
}
