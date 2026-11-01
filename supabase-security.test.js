import assert from "node:assert/strict";
import test from "node:test";
import { credentialStorage } from "./credential-storage.js";
import { supabaseAuthClient } from "./supabase-auth-client.js";
import { SupabaseDatabaseProvider } from "./supabase-database-provider.js";

const projectId = "abcdefghijklmnopqrst";
const publishableKey = "sb_publishable_test_public_key";

test("client configuration accepts only modern publishable keys", () => {
  for (const key of [
    "eyJhbGciOiJIUzI1NiJ9.legacy.jwt",
    "sb_secret_server_only",
    "sb_publishable_",
    "sb_publishable_bad key",
  ]) {
    assert.equal(
      credentialStorage.validateConfiguration({
        projectId,
        publishableKey: key,
      }).isValid,
      false,
    );
  }
  assert.equal(
    credentialStorage.validateConfiguration({ projectId, publishableKey })
      .isValid,
    true,
  );
});

test("PostgREST sends the publishable key separately from the user's JWT and fetches tombstones", async (t) => {
  t.mock.method(credentialStorage, "getConfiguration", async () => ({
    supabaseUrl: `https://${projectId}.supabase.co`,
    publishableKey,
  }));
  t.mock.method(supabaseAuthClient, "getAccessToken", async () => "user-jwt");
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, ...options });
    if (url.includes("/youtube_watch_events")) return new Response("[]");
    return new Response(
      JSON.stringify([
        {
          str_ident: "abcdefghijk",
          int_timestamp: 100,
          int_deleted_at: 200,
          int_count: 1,
        },
      ]),
    );
  });
  const rows = await new SupabaseDatabaseProvider().getVideoPage("previous000");
  assert.equal(requests[0].headers.apikey, publishableKey);
  assert.equal(requests[0].headers.Authorization, "Bearer user-jwt");
  assert.match(requests[0].url, /order=str_ident.asc/);
  assert.match(requests[0].url, /str_ident=gt.previous000/);
  assert.match(requests[0].url, /int_deleted_at/);
  assert.equal(rows[0].intDeletedAt, 200);
});
