const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function reply(payload, status = 200) {
  return Response.json(payload, { status, headers: CORS });
}

async function boundedJson(message) {
  const reader = message.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new Error("Body too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function validConfiguration(configuration) {
  return (
    typeof configuration?.projectId === "string" &&
    /^[a-z]{20}$/.test(configuration.projectId) &&
    typeof configuration?.publishableKey === "string" &&
    configuration.publishableKey.length <= 300 &&
    /^sb_publishable_[A-Za-z0-9_-]+$/.test(configuration.publishableKey)
  );
}

export function createDirectoryHandler({
  url,
  serviceKey,
  fetch: send = fetch,
  now = Date.now,
}) {
  async function rpc(name, body) {
    const response = await send(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      redirect: "error",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Directory unavailable");
    return boundedJson(response);
  }

  return async (request) => {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "POST") return reply({ error: "Use POST" }, 405);
    let input;
    try {
      input = await boundedJson(request);
    } catch {
      return reply({ error: "Invalid request" }, 400);
    }
    const { action, code, configuration, proof } = input || {};
    if (typeof code !== "string" || !/^[A-Z]{6}$/.test(code))
      return reply({ error: "Invalid code" }, 400);
    try {
      if (action === "resolve") {
        return reply({
          configuration: await rpc("watchmarker_directory_resolve", {
            p_code: code,
          }),
        });
      }
      if (
        action !== "register" ||
        !validConfiguration(configuration) ||
        typeof proof !== "string" ||
        !/^[a-f0-9]{64}$/.test(proof)
      )
        return reply({ error: "Invalid registration" }, 400);
      // Contact only the supplied installation's exact managed Supabase host.
      // This random proof authenticates issuance without forwarding any JWT.
      const { projectId, publishableKey } = configuration;
      const source = await send(
        `https://${projectId}.supabase.co/rest/v1/rpc/watchmarker_link_registration`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            apikey: publishableKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ p_token: code, p_proof: proof }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!source.ok)
        return reply(
          {
            error:
              "Invitation could not be verified. Apply the current setup SQL.",
          },
          400,
        );
      const registration = await boundedJson(source);
      const expires = Date.parse(registration?.expiresAt);
      if (
        !/^[a-f0-9]{64}$/.test(registration?.issuer || "") ||
        !Number.isFinite(expires) ||
        expires <= now() ||
        expires > now() + 600_000
      )
        return reply({ error: "Invitation expired or unverified" }, 400);
      const registered = await rpc("watchmarker_directory_reserve", {
        p_code: code,
        p_project: projectId,
        p_key: publishableKey,
        p_issuer: registration.issuer,
        p_expires: registration.expiresAt,
      });
      return reply({ registered: registered === true });
    } catch {
      return reply({ error: "Pairing directory unavailable" }, 503);
    }
  };
}
