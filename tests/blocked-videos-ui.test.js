import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, extname } from "node:path";
import { spawn } from "node:child_process";

test(
  "local blocking and options unblocking in Chrome",
  { timeout: 30000 },
  async (t) => {
    const chrome =
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    try {
      await access(chrome);
    } catch {
      t.skip("Set CHROME_PATH to run Chrome blocking checks");
      return;
    }
    const root = resolve(import.meta.dirname, "..");
    const profile = await mkdtemp(join(tmpdir(), "watchmarker-blocking-"));
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
      if (req.url === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<!doctype html><html><head><link rel="stylesheet" href="/extension/youtube/blocked-videos.css"><link rel="stylesheet" href="/extension/content/ui.css"><link rel="stylesheet" href="/extension/content/options.css"></head><body><script type="module" src="/tests/support/blocked-videos.browser.js"></script></body></html>',
        );
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
        res.end(await readFile(file));
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
        `http://127.0.0.1:${server.address().port}/`,
      ],
      { stdio: "ignore" },
    );
    let timer;
    try {
      const result = await Promise.race([
        received,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Chrome blocking checks timed out")),
            20000,
          );
        }),
      ]);
      assert.equal(result.error, undefined, result.error);
      for (const check of result.checks) t.diagnostic(check);
      assert.ok(result.checks.length >= 10);
    } finally {
      clearTimeout(timer);
      const stopped = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await stopped;
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
