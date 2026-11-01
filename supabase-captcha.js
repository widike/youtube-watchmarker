import { credentialStorage } from "./credential-storage.js";
import { decodeConnection } from "./device-link.js";
import { validateCaptchaConfiguration } from "./verification/protocol.js";

export function connectionConfiguration(request) {
  const configuration = request.connectionCode
    ? decodeConnection(request.connectionCode).configuration
    : request.configuration;
  const validation = credentialStorage.validateConfiguration(configuration);
  if (!validation.isValid) throw new Error(validation.errors.join(". "));
  return {
    ...configuration,
    supabaseUrl: `https://${configuration.projectId}.supabase.co`,
  };
}

export async function loadCaptchaConfiguration(configuration) {
  const response = await fetch(
    `${configuration.supabaseUrl}/rest/v1/rpc/watchmarker_captcha_config`,
    {
      method: "POST",
      headers: {
        apikey: configuration.publishableKey,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    throw new Error(
      "CAPTCHA setup is unavailable. Apply the current setup SQL in Supabase.",
    );
  return validateCaptchaConfiguration(await response.json());
}
