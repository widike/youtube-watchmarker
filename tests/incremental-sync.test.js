import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);

test(
  "incremental SQL tracks changed rows, no-op retries, event precision, checkpoints and isolation",
  { timeout: 30000 },
  async (t) => {
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
      t.skip("Install PostgreSQL to check incremental sync");
      return;
    }
    const pgRun = (name, args) => run(bin ? join(bin, name) : name, args);
    const root = await mkdtemp("/tmp/watchmarker-delta-");
    const data = join(root, "data");
    const port = "55441";
    let started = false;
    try {
      await pgRun("initdb", ["-D", data, "-A", "trust", "--no-locale"]);
      await pgRun("pg_ctl", [
        "-D",
        data,
        "-l",
        join(root, "server.log"),
        "-o",
        `-F -k ${root} -h '' -p ${port}`,
        "-w",
        "start",
      ]);
      started = true;
      const psql = (file) =>
        pgRun("psql", [
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          "-h",
          root,
          "-p",
          port,
          "-d",
          "postgres",
          "-f",
          file,
        ]);
      await psql(
        fileURLToPath(
          new URL("./support/incremental-sync.sql", import.meta.url),
        ),
      );
      const args = [
        "-X",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        root,
        "-p",
        port,
        "-d",
        "postgres",
      ];
      const auth =
        "set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';";
      const query = (sql) => pgRun("psql", [...args, "-c", sql]);
      const before = JSON.parse(
        (await query(`${auth} select public.watchmarker_sync_state();`)).stdout
          .trim()
          .split("\n")
          .at(-1),
      );
      const slow = spawn(bin ? join(bin, "psql") : "psql", args);
      const done = new Promise((resolve, reject) => {
        slow.on("error", reject);
        slow.on("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`Concurrent writer exited ${code}`)),
        );
      });
      const ready = new Promise((resolve, reject) => {
        slow.on("error", reject);
        slow.stdout.on("data", (data) => {
          if (data.toString().includes("ready")) resolve();
        });
      });
      slow.stdin.end(
        `begin;\n${auth}\ninsert into public.youtube_watch_history(str_ident,int_timestamp) values('concurrentA',1);\nselect 'ready';\nselect pg_sleep(0.8);\ncommit;\n`,
      );
      await ready;
      let fastCommitted = false;
      const fast = query(
        `${auth} insert into public.youtube_watch_history(str_ident,int_timestamp) values('concurrentB',1);`,
      ).then(() => {
        fastCommitted = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        fastCommitted,
        false,
        "A later revision committed ahead of the earlier writer",
      );
      await Promise.all([done, fast]);
      const after = JSON.parse(
        (await query(`${auth} select public.watchmarker_sync_state();`)).stdout
          .trim()
          .split("\n")
          .at(-1),
      );
      const rows = await query(
        `${auth} select count(*) from public.watchmarker_sync_page('history',${before.revisions.history},${after.revisions.history});`,
      );
      assert.equal(
        rows.stdout.trim().split("\n").at(-1),
        "2",
        "Concurrent changes were lost behind a checkpoint",
      );
    } finally {
      if (started)
        await pgRun("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      await rm(root, { recursive: true, force: true });
    }
  },
);
