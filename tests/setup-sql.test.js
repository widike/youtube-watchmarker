import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSetupSql } from "../extension/content/options/setup-sql.js";

const run = promisify(execFile);

function setupResources(t) {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { runtime: { getURL: (path) => path } };
  t.after(() => {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  });
  t.mock.method(
    globalThis,
    "fetch",
    async (path) =>
      new Response(
        await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
      ),
  );
}

test("setup SQL refuses incomplete resources before copying anything", async (t) => {
  setupResources(t);
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("", { status: 404 }),
  );
  await assert.rejects(loadSetupSql(), /could not be loaded/);
  t.mock.method(globalThis, "fetch", async () => new Response("select 1;"));
  await assert.rejects(loadSetupSql(), /invalid transaction/);
});

test(
  "copied SQL safely upgrades existing data and sets up a fresh database",
  { timeout: 30000 },
  async (t) => {
    setupResources(t);
    const sql = await loadSetupSql();
    assert.equal([...sql.matchAll(/^commit;$/gm)].length, 1);
    assert.equal(
      [...sql.matchAll(/^notify pgrst, 'reload schema';$/gm)].length,
      1,
    );
    let bin;
    for (const candidate of [
      process.env.PG_BINDIR,
      "",
      "/opt/homebrew/opt/postgresql@18/bin",
    ].filter((value) => value !== undefined)) {
      try {
        await run(candidate ? join(candidate, "postgres") : "postgres", [
          "--version",
        ]);
        bin = candidate;
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (bin === undefined) {
      t.skip("Install PostgreSQL to verify setup preserves existing data");
      return;
    }
    const pgRun = (name, args) =>
      run(bin ? join(bin, name) : name, args, { maxBuffer: 2 ** 20 });
    const root = await mkdtemp("/tmp/watchmarker-setup-");
    const data = join(root, "data");
    const connection = ["-h", root, "-p", "55440"];
    let started = false;
    try {
      await pgRun("initdb", ["-D", data, "-A", "trust", "--no-locale"]);
      await pgRun("pg_ctl", [
        "-D",
        data,
        "-l",
        join(root, "server.log"),
        "-o",
        `-F -k ${root} -h '' -p 55440`,
        "-w",
        "start",
      ]);
      started = true;
      const setupFile = join(root, "setup.sql");
      const failedFile = join(root, "failed.sql");
      await writeFile(setupFile, sql);
      await writeFile(
        failedFile,
        sql.replace(/commit;$/, "select 1/0;\ncommit;"),
      );
      const psql = (database, args) =>
        pgRun("psql", [
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          ...connection,
          "-d",
          database,
          ...args,
        ]);
      await psql("postgres", [
        "-v",
        `setup_file=${setupFile}`,
        "-v",
        `failed_setup_file=${failedFile}`,
        "-f",
        fileURLToPath(new URL("./support/setup-reapply.sql", import.meta.url)),
      ]);
      await pgRun("createdb", [...connection, "fresh"]);
      await psql("fresh", [
        "-c",
        `
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema auth to authenticated, anon;
    `,
      ]);
      await psql("fresh", ["-f", setupFile]);
      await psql("fresh", ["-f", setupFile]);
      const result = await psql("fresh", [
        "-Atc",
        `
      select public.watchmarker_sync_version()=4
        and public.watchmarker_event_merge_version()=1
        and to_regclass('public.youtube_blocked_videos') is not null;
    `,
      ]);
      assert.equal(result.stdout.trim(), "t");
    } finally {
      if (started)
        await pgRun("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      await rm(root, { recursive: true, force: true });
    }
  },
);
