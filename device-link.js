import { credentialStorage } from "./credential-storage.js";

// Shared rendezvous service, never the default database for an installation.
export const PAIRING_DIRECTORY_URL =
  "https://coogjvcuzhgdngjcjmww.supabase.co/functions/v1/pairing-directory";

export function decodeConnection(value) {
  if (typeof value !== "string" || !/^[a-z]{3}-?[a-z]{3}$/i.test(value.trim()))
    throw new Error(
      "Enter the six-letter connection code, for example KMT-PXR",
    );
  return value.trim().replace("-", "").toUpperCase();
}

export function encodeConnection(token) {
  const letters = decodeConnection(token);
  return `${letters.slice(0, 3)}-${letters.slice(3)}`;
}

async function directoryRequest(body) {
  const response = await fetch(PAIRING_DIRECTORY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error("Pairing directory unavailable. Try again shortly.");
  return response.json();
}

export async function loadConnectionProject(code) {
  const payload = await directoryRequest({
    action: "resolve",
    code: decodeConnection(code),
  });
  const { projectId, publishableKey } = payload?.configuration || {};
  const configuration = { projectId, publishableKey };
  if (!credentialStorage.validateConfiguration(configuration).isValid)
    throw new Error(
      "Code incorrect or expired, or too many attempts. Check the code or try again in 10 minutes.",
    );
  return { ...configuration, supabaseUrl: `https://${projectId}.supabase.co` };
}

export async function registerConnection(configuration, invitation) {
  if (
    !credentialStorage.validateConfiguration(configuration).isValid ||
    !/^[A-Z]{6}$/.test(invitation?.code || "") ||
    !/^[a-f0-9]{64}$/.test(invitation?.proof || "")
  )
    throw new Error(
      "Apply the current setup SQL before creating a short code.",
    );
  const { projectId, publishableKey } = configuration;
  const result = await directoryRequest({
    action: "register",
    configuration: { projectId, publishableKey },
    code: invitation.code,
    proof: invitation.proof,
  });
  return result?.registered === true;
}
