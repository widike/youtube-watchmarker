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
- Device-link RPCs have fixed empty search paths. Invitations contain 256 random
  bits, expire after ten minutes and are stored as hashes. They connect one
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

CAPTCHA is not integrated into this extension yet. Enabling it in Supabase now
will make new device sign-ins fail; already connected devices retain their
existing sessions. A complete integration needs:

1. A hosted HTTPS challenge page with a Turnstile or hCaptcha site key, using the
   provider's approved hostname. The extension's MV3 pages prohibit remote
   JavaScript, so the provider widget cannot be inserted into the options page.
2. A challenge handoff bound to the initiating connection attempt, with exact
   origin validation and short expiry. Keep challenge tokens in memory and out
   of logs, connection codes, URLs and persistent storage.
3. The signup request must forward the result as
   `gotrue_meta_security: { captcha_token: token }`. Supabase Auth verifies it
   using the provider secret configured in the Supabase dashboard. The provider
   secret must never enter the extension or the hosted page.
4. Test first-device signup and invitation-based signup on every client,
   including SmartTube, before enabling project-wide CAPTCHA. Cancellation,
   expiry and challenge failure must leave existing credentials/history intact.

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

Sources: [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha), and
[Chrome MV3 content security policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy).
