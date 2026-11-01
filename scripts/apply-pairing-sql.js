import { readFile } from "node:fs/promises";

const project = process.env.PAIRING_DIRECTORY_PROJECT_ID;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!/^[a-z]{20}$/.test(project || "") || !accessToken)
  throw new Error(
    "Configure PAIRING_DIRECTORY_PROJECT_ID and SUPABASE_ACCESS_TOKEN for deployment.",
  );
const files = ["supabase/directory/setup.sql"];
if (process.env.UPGRADE_SOURCE === "true")
  files.push("supabase/migrations/20261101070000_short_connection_codes.sql");
for (const file of files) {
  const query = await readFile(file, "utf8");
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Database setup failed with HTTP ${response.status}: ${file}`,
    );
  console.info(`Applied ${file}`);
}
process.exit(0);
