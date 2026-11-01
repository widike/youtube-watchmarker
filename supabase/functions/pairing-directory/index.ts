import { createDirectoryHandler } from "./directory.js";

Deno.serve(
  createDirectoryHandler({
    url: Deno.env.get("SUPABASE_URL")!,
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  }),
);
