import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);

test(
  "blocked-video SQL enforces revision ordering and shared-history isolation",
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
      t.skip("Install PostgreSQL to check block-list policies");
      return;
    }
    const pgRun = (name, args) => run(bin ? join(bin, name) : name, args);
    const root = await mkdtemp("/tmp/watchmarker-blocks-");
    const data = join(root, "data");
    const port = "55439";
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
      const bootstrap = join(root, "bootstrap.sql");
      await writeFile(
        bootstrap,
        `
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
      create function public.watchmarker_history_owner() returns uuid
        language sql stable as $$ select current_setting('test.owner')::uuid $$;
    `,
      );
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
      await psql(bootstrap);
      const migration = fileURLToPath(
        new URL(
          "../supabase/migrations/20261105000000_blocked_video_sync.sql",
          import.meta.url,
        ),
      );
      await psql(migration);
      await psql(migration);
      await psql(
        fileURLToPath(
          new URL("./support/blocked-video-schema.sql", import.meta.url),
        ),
      );
    } finally {
      if (started)
        await pgRun("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      await rm(root, { recursive: true, force: true });
    }
  },
);
