import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const extension = join(root, "extension");
const { version } = JSON.parse(
  await readFile(join(extension, "manifest.json"), "utf8"),
);
const output = resolve(root, "dist", `youtube-watchmarker-${version}.zip`);
const staging = await mkdtemp(join(tmpdir(), "watchmarker-package-"));
try {
  await cp(extension, staging, {
    recursive: true,
    filter: (path) => {
      const name = basename(path);
      return (
        !name.startsWith(".") &&
        name !== "_metadata" &&
        !name.endsWith(".test.js")
      );
    },
  });
  await mkdir(join(root, "dist"), { recursive: true });
  await rm(output, { force: true });
  const result = spawnSync("zip", ["-qr", output, "."], {
    cwd: staging,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Extension packaging failed");
  console.info(`Created ${output}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
process.exit(0);
