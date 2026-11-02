import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { spawn } from "node:child_process";
import { mergeVideoData } from "../extension/history/history-records.js";

test("merge preserves membership, latest watch, count and nonempty title in either direction", () => {
  const old = {
    strIdent: "abcdefghijk",
    intTimestamp: 10,
    intCount: 4,
    strTitle: "Title",
  };
  const next = { ...old, intTimestamp: 20, intCount: 1, strTitle: "" };
  assert.deepEqual(
    mergeVideoData([old], [next]),
    mergeVideoData([next], [old]),
  );
  const merged = mergeVideoData([old, old], [next]);
  assert.partialDeepStrictEqual(merged, [
    { ...next, intCount: 4, strTitle: "Title", intDeletedAt: 0 },
  ]);
  assert.deepEqual(
    merged[0].watchEvents.map((event) => event.watchedAt),
    [10, 20],
  );
  assert.equal(merged[0].intUnknownCount, 2);
});

test(
  "real Chrome IndexedDB durability and multi-device sync",
  { timeout: 40_000 },
  async (t) => {
    const chrome =
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    try {
      await access(chrome);
    } catch {
      t.skip("Set CHROME_PATH to run real IndexedDB checks");
      return;
    }
    const profile = await mkdtemp(join(tmpdir(), "watchmarker-idb-"));
    let resolveResults;
    const received = new Promise((resolve) => {
      resolveResults = resolve;
    });
    const root = resolve(import.meta.dirname, "..");
    const server = createServer(async (req, res) => {
      if (req.url === "/results") {
        let data = "";
        for await (const chunk of req) data += chunk;
        resolveResults(JSON.parse(data));
        res.end("ok");
        return;
      }
      if (req.url === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<script type="module" src="/tests/support/history-sync.browser.js"></script>',
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
          extname(file) === ".js" ? "text/javascript" : "text/plain",
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
        `--user-data-dir=${profile}`,
        `http://127.0.0.1:${server.address().port}/`,
      ],
      { stdio: "ignore" },
    );
    let timer;
    try {
      const results = await Promise.race([
        received,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Chrome IndexedDB tests timed out")),
            30_000,
          );
        }),
      ]);
      for (const result of results) {
        t.diagnostic(result.name);
        assert.equal(result.passed, true, result.error || result.name);
      }
      assert.equal(results.length, 34);
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
