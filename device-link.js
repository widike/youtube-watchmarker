import { credentialStorage } from "./credential-storage.js";

const PREFIX = "watchmarker:1:";

export function encodeConnection(configuration, token) {
  return `${PREFIX}${configuration.projectId}:${configuration.publishableKey}:${token}`;
}

export function decodeConnection(value) {
  if (typeof value !== "string" || value.length > 1000)
    throw new Error(
      "Paste a Watchmarker connection code from a connected device",
    );
  const [name, version, projectId, publishableKey, token, extra] = value
    .trim()
    .split(":");
  if (
    name !== "watchmarker" ||
    version !== "1" ||
    extra !== undefined ||
    !/^[a-f0-9]{64}$/.test(token || "")
  )
    throw new Error("Invalid Watchmarker connection code");
  const configuration = { projectId, publishableKey };
  const validation = credentialStorage.validateConfiguration(configuration);
  if (!validation.isValid) throw new Error(validation.errors.join(". "));
  return {
    configuration: {
      ...configuration,
      supabaseUrl: `https://${projectId}.supabase.co`,
    },
    token,
  };
}
