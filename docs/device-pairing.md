# Six-letter device pairing

Codes contain six letters, displayed as `KMT-PXR`. Both clients accept lowercase
and an omitted hyphen. Codes expire after ten minutes, connect one independent
device identity and are replaced when their issuer creates another code. Existing
sessions and history survive the update; old long codes are no longer accepted.

## Installation settings stay per installation

Each installation keeps its configured Supabase project ID and publishable key.
The shared directory is a rendezvous service, not a default history database.
For example, `KMT-PXR` can resolve to one project's settings and `ABC-DEF` to
another project's settings. The service URL is fixed in both clients; the
destination database is resolved separately for each code.

1. A connected computer creates a short invitation in its configured database.
   The database also returns a random registration proof, stored only as a hash.
2. The computer sends its public project settings, code and proof to the shared
   directory. It sends no device access or refresh token.
3. The directory verifies the proof with that exact project's
   `watchmarker_link_registration` RPC. Only then does it reserve the code.
   Collisions trigger a fresh invitation. Existing mappings cannot be overwritten
   by a different project or issuer.
4. The new device resolves the code to public project settings, completes the
   configured CAPTCHA and creates its own Auth identity in that project.
5. The issuing database atomically claims the invitation and links that identity
   to the shared history. Local history identity checks precede credential storage
   and upload. Wrong, expired, consumed or rate-limited codes cannot connect.

SmartTube accepts the code directly in **Settings → Extensions → Cloud sync**.
Verification runs inside the TV app in an origin-restricted Android WebView.
Cloud sync does not open the LAN Phone setup screen or require its numeric PIN.
The general Phone setup service remains available for other TV settings and backups.

## Data and limits

The directory stores code hashes, public project IDs/keys, hashed issuer IDs and
expiry times. It never receives watch history or device Auth tokens. Proofs pass
through registration but are not stored by the directory. Request bodies are
bounded, responses are not cached, and neither codes nor proofs enter URLs.
Source verification accepts only exact managed Supabase hosts and rejects redirects.

Expired mappings are unusable immediately and removed on the next directory
request. Reissuing a code replaces that issuer's directory mapping. A successful
claim is single-use in the source database; the directory's public settings may
remain resolvable until expiry. No browser role can read directory tables or call
its internal RPCs directly; only its server-side function can.

The source database allows five claims per device and 100 claims across all device
identities per rolling ten minutes. Failures return normally so counters commit;
lost successful replies remain retryable by the same identity. The directory
allows 100 resolutions per rolling ten minutes, 20 registrations per source
project and 1,000 registrations overall, with 10,000 live mappings maximum.
These are deliberately conservative limits for this deployment. Exhaustion
temporarily prevents pairing; existing connections and history sync continue.

## Deploy the directory

Directory infrastructure lives separately in `supabase/directory/setup.sql` and
`supabase/functions/pairing-directory/`. Ordinary installations need only the
eight source migrations copied by **Copy setup SQL**, not the directory setup.

The directory currently targets Supabase project `coogjvcuzhgdngjcjmww`. This is
infrastructure routing, not a default value for any installation's history
settings. Hosting it elsewhere requires updating the service URL in both clients
and the project ID in the deployment workflow. No publishable key is baked into
the clients for this service.

1. Add a Supabase management access token as the GitHub Actions repository secret
   **SUPABASE_ACCESS_TOKEN**. Do not put it in source, Pages, client configuration
   or chat. The project publishable key cannot deploy SQL or functions.
2. Run **Deploy pairing directory** in GitHub Actions. It applies the directory
   SQL and deploys the function using the pinned Supabase CLI. Leave
   **upgrade_source** enabled when this project also hosts the existing Watchmarker
   history; disable it for a standalone directory project without the source schema.
3. Apply `20261101070000_short_connection_codes.sql` to every other source project.
   It requires the preceding device-linking migrations. Existing memberships and
   history are retained. The workflow never modifies other installations.
4. Reload the unpacked extension and install the updated SmartTube release after
   deployment. Test a real new-device connection before relying on it for recovery.

The function's gateway JWT check is disabled because requests come from unrelated
Supabase projects and unconfigured devices. Registration instead requires the
source-issued random proof. The directory's service-role key is an automatic
server environment secret and never enters either client or a response.

## Local verification

- `node --test device-link.test.js device-connection.test.js pairing-directory.test.js`
- `psql -f test-support/pairing-directory.sql` in a disposable local PostgreSQL
  database. This includes the prior history/RLS checks and verifies independent
  destinations, replacement, collisions, expiry, persistent rate limits and ACLs.
- SmartTube's Watchmarker, pairing coordinator, native verification channel and
  Phone setup unit tests. Native messages require the approved main frame, an
  attempt-specific nonce and a bounded token; cancelled attempts are ignored.

Local tests simulate Auth claims and network responses. They do not establish
production deployment, CAPTCHA configuration or acceptance on a physical TV.
