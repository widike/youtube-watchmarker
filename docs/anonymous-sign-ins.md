# Anonymous sign-in security

Anonymous Supabase Auth users have a durable UUID and the `authenticated` role.
The `anon` role is for requests without a signed-in user. Neither the public
project ID nor its publishable key authorizes access to someone else's history.

## Database boundary

Apply `supabase/migrations/20261101050000_anonymous_access_hardening.sql` after
the other setup migrations. Existing projects need this migration too. The
extension's **Copy setup SQL** includes it last. Reapplying it preserves history,
invitations and memberships.

- History, events and playback time require a non-null authenticated subject
  and the server-resolved history owner. A restrictive policy ANDs this condition
  with all permissive policies, preventing an old broad policy from bypassing it.
- Anonymous and permanent users have the same ownership boundary. No permission
  depends on user-editable metadata or merely having the `authenticated` role.
- Browser roles cannot delete or truncate tables, edit existing events, access
  private membership/invitation tables, or call old administrative helpers.
- Device-link RPCs have fixed empty search paths. Invitations use six random
  letters, expire after ten minutes and are stored as hashes, with durable
  server-side guessing limits. Registration proofs use separate high-entropy
  secrets. See [device pairing](device-pairing.md). Invitations connect one
  independent Auth identity; retrying by that identity is idempotent.

Each device keeps an encrypted refresh token and an access token in trusted
extension session storage. Content scripts cannot request connection codes or
credentials. Refresh replies must contain complete tokens, a positive lifetime
and the same device identity before they can replace a session. Access tokens
remain opaque; Supabase validates their signatures and claims.

The migration covers Watchmarker-owned tables and known historical RPCs. If the
same project hosts other applications, review their `public` and `authenticated`
policies and exposed definer functions separately: anonymous users can reach any
resource those grants and policies allow.

## CAPTCHA and signup abuse

CAPTCHA is recommended for preventing automated account creation and associated
database/MAU growth. It does not replace ownership policies. Keep Supabase's
server-side anonymous-signup rate limit enabled and monitor Auth usage. A client
delay cannot prevent attackers from calling the public signup endpoint directly.

Both clients use the same hosted Turnstile page. The extension displays an isolated
iframe during connection; SmartTube embeds an Android WebView directly in its
Cloud sync screen after the six-letter code is entered. No LAN Phone setup or
numeric phone-pairing PIN is needed for cloud sync. Routine syncing and session
refresh use existing Auth sessions.

The verification page receives only a public widget key and a random per-attempt nonce.
It never receives connection codes, project credentials, history or Auth tokens.
Its replies require the exact origin, frame and nonce. Challenges time out after
three minutes; cancellation, edited connection details and page closure discard
the attempt. Tokens remain in memory, are submitted immediately, and never enter
URLs, logs, connection codes, exports or persistent storage.

The page accepts iframe messages only from Chrome extension parents. The removed
LAN phone flow is no longer an allowed parent. SmartTube uses a separate native WebMessage
channel injected only into the approved HTTPS origin; native replies additionally
require the main frame and current nonce. Navigation cannot leave the approved
page, and cancellation destroys the channel. Remote JavaScript runs inside the
hosted page. Supabase Auth
verifies the submitted `gotrue_meta_security.captcha_token` using its configured
provider secret. The provider secret never enters either client or this repository.

Setup order:

1. Create a managed Cloudflare Turnstile widget restricted to `widike.github.io`.
2. Publish `verification/` using `.github/workflows/verification.yml`. The page
   URL is `https://widike.github.io/youtube-watchmarker/verification/`. Only the
   static verification files are published; no keys are embedded in the page.
3. Apply `supabase/migrations/20261101060000_captcha_configuration.sql`, then
   register the widget's **public site key** in the SQL Editor:

   ```sql
   insert into private.watchmarker_captcha_configuration(singleton, site_key)
   values (true, 'YOUR_TURNSTILE_SITE_KEY')
   on conflict (singleton) do update set site_key = excluded.site_key;
   ```

   The read-only `watchmarker_captcha_config()` RPC exposes just the public site
   key and the approved page URL. Browser roles cannot change this configuration.

4. Reload the extension and install the updated SmartTube release. Check
   connection, cancellation and expiry in both clients before enabling enforcement.
5. In Supabase **Authentication → Attack Protection**, enable CAPTCHA, select
   Turnstile, and enter its **secret key** there. Verify that signup without a
   CAPTCHA token is rejected and complete a real new-device connection.

Each Supabase project needs the matching site-key/secret pair. Clients fail
closed when public CAPTCHA configuration is absent or points to another page;
they never retry signup without verification. Provider test keys belong only
in isolated tests. Keep Supabase's server-side rate limiting enabled as well.

Do not delete anonymous users as disposable guests: they own durable histories
and memberships. Keep a connected device available to link replacements. If all
sessions are lost, public configuration cannot recover ownership; administrator
assistance is required.

## Local regression checks

Run `psql -f test-support/anonymous-access.sql` only in a disposable local
PostgreSQL database. It creates fixture roles/schema, exercises device linking
and playback, installs deliberately broad policies/grants, applies the hardening
twice, then verifies ownership, ACLs, missing subjects and administrative RPC
denials. Claims are simulated locally; this does not validate production Auth
configuration, JWT signatures or CAPTCHA.

Run `node --test supabase-auth-client.test.js supabase-security.test.js
device-connection.test.js device-link.test.js message-router.test.js` for the
client-side security checks.

`captcha-challenge.test.js` and `captcha-security.test.js` cover spoofed frame
messages, cancelled/expired attempts, invalid origins and missing tokens.
`psql -f test-support/captcha-configuration.sql` checks the configuration RPC and
private table permissions in a disposable local database.

Sources: [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha), and
[Chrome MV3 content security policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy).
