import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../extension/", import.meta.url));
async function checkReference(file, value) {
  if (!value || /^(?:[a-z]+:|#|\/\/)/i.test(value)) return;
  const clean = value.split(/[?#]/)[0];
  const target = resolve(
    value.startsWith("/") ? root : dirname(file),
    clean.replace(/^\//, ""),
  );
  assert(
    !relative(root, target).startsWith(`..${sep}`),
    `${relative(root, file)} references a file outside extension/: ${value}`,
  );
  await access(target).catch(() => {
    throw new Error(
      `${relative(root, file)} references missing file: ${value}`,
    );
  });
}
const manifestFile = resolve(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
const assets = [
  manifest.background.service_worker,
  manifest.options_ui.page,
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap(({ js = [], css = [] }) => [
    ...js,
    ...css,
  ]),
];
for (const asset of assets) await checkReference(manifestFile, asset);
await access(resolve(root, "LICENSE"));
const files = await readdir(root, { recursive: true, withFileTypes: true });
for (const entry of files) {
  if (!entry.isFile()) continue;
  const file = resolve(entry.parentPath, entry.name);
  assert(!entry.name.endsWith(".test.js"), `Test in extension/: ${file}`);
  if (![".js", ".html", ".css"].includes(extname(file))) continue;
  // Font Awesome includes optional font variants that are not distributed.
  if (relative(root, file) === "content/fontawesome.css") continue;
  const source = await readFile(file, "utf8");
  const patterns =
    extname(file) === ".js"
      ? [
          /\b(?:from\s*|import\s*(?:\(\s*)?)["'](\.[^"']+)["']/g,
          /new URL\(["'](\.[^"']+)["'],\s*import\.meta\.url\)/g,
        ]
      : extname(file) === ".html"
        ? [/\b(?:src|href)=["']([^"']+)["']/g]
        : [/url\(["']?([^\s)'";]+)["']?\)/g];
  for (const pattern of patterns)
    for (const [, value] of source.matchAll(pattern))
      await checkReference(file, value);
  for (const [, value] of source.matchAll(
    /chrome\.runtime\.getURL\(\s*["']([^"']+)["']/g,
  ))
    await checkReference(manifestFile, value);
}
console.info(
  "Extension manifest, imports and local assets resolve within extension/.",
);
process.exit(0);
