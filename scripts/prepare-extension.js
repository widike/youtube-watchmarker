import { copyFile, cp, mkdir, rm } from "node:fs/promises";

const target = new URL("../extension/supabase/", import.meta.url);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(
  new URL("../supabase/migrations/", import.meta.url),
  new URL("migrations/", target),
  { recursive: true },
);
await copyFile(
  new URL("../LICENSE", import.meta.url),
  new URL("../extension/LICENSE", import.meta.url),
);
process.exit(0);
