import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

test(
  "real Chrome accepts and narrowly applies YouTube authentication header rules",
  { timeout: 30000 },
  async (t) => {
    const executable =
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    try {
      await access(executable);
    } catch {
      t.skip("Set CHROME_PATH to test Chrome request headers");
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), "watchmarker-request-"));
    let finish;
    const received = new Promise((resolve) => {
      finish = resolve;
    });
    const server = createServer(async (request, response) => {
      if (request.url === "/echo") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(request.headers));
        return;
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      finish(JSON.parse(body));
      response.end("ok");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await mkdir(join(directory, "test-support"));
    for (const file of [
      "youtube-request.js",
      "youtube-auth.js",
      "constants.js",
      "logger.js",
      "test-support/youtube-request.browser.js",
    ]) {
      await copyFile(join(import.meta.dirname, file), join(directory, file));
    }
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: "Watchmarker request test",
        version: "1.0",
        permissions: [
          "declarativeNetRequestWithHostAccess",
          "declarativeNetRequestFeedback",
        ],
        host_permissions: ["https://www.youtube.com/*", `${origin}/*`],
        background: { service_worker: "test.js", type: "module" },
      }),
    );
    await writeFile(
      join(directory, "test.js"),
      `
    import { checkYouTubeRequests } from './test-support/youtube-request.browser.js';
      void (async () => {
    let result;
    try { result = await checkYouTubeRequests(${JSON.stringify(origin)}); }
    catch (error) { result = { passed: false, error: error.stack }; }
    await fetch(${JSON.stringify(`${origin}/results`)}, { method: 'POST', body: JSON.stringify(result) });
      })();
  `,
    );
    const child = spawn(
      executable,
      [
        "--headless",
        "--no-first-run",
        "--disable-background-networking",
        "--remote-debugging-pipe",
        "--enable-unsafe-extension-debugging",
        `--user-data-dir=${directory}/profile`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
    );
    let buffer = "";
    child.stdio[4].on("data", (chunk) => {
      buffer += chunk.toString();
      let boundary;
      while ((boundary = buffer.indexOf("\0")) >= 0) {
        const message = JSON.parse(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 1);
        if (message.id === 1 && message.error)
          finish({ passed: false, error: message.error.message });
      }
    });
    let timer;
    try {
      child.stdio[3].write(
        JSON.stringify({
          id: 1,
          method: "Extensions.loadUnpacked",
          params: { path: directory },
        }) + "\0",
      );
      const result = await Promise.race([
        received,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Chrome request checks timed out")),
            20000,
          );
        }),
      ]);
      assert.equal(result.passed, true, result.error);
      t.diagnostic(result.networkHeaders);
    } finally {
      clearTimeout(timer);
      child.kill();
      await new Promise((resolve) => child.on("exit", resolve));
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  },
);
