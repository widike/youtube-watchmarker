import { credentialStorage } from "./credential-storage.js";
import { decodeConnection, loadConnectionProject } from "./device-link.js";
import { validateCaptchaConfiguration } from "../verification/protocol.js";

export async function connectionConfiguration(request) {
  if (request.connectionCode) decodeConnection(request.connectionCode);
  const configuration = request.connectionCode
    ? await loadConnectionProject(request.connectionCode)
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
