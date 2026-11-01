import { credentialStorage } from "../credential-storage.js";
import { databaseProviderFactory } from "../database-provider-factory.js";
import { createHandler } from "../handler-wrapper.js";
import { supabaseAuthClient } from "../supabase-auth-client.js";
import { supabaseDatabaseProvider } from "../supabase-database-provider.js";
import { decodeConnection, encodeConnection } from "../device-link.js";
import {
  connectionConfiguration,
  loadCaptchaConfiguration,
} from "../supabase-captcha.js";

let connecting = false;

export const handleSupabaseCaptchaConfiguration = createHandler(
  async (request) => ({
    captcha: await loadCaptchaConfiguration(connectionConfiguration(request)),
  }),
  { name: "handleSupabaseCaptchaConfiguration" },
);

export const handleProviderStatus = createHandler(
  async () => ({ status: await databaseProviderFactory.getProviderStatus() }),
  { name: "handleProviderStatus" },
);

export const handleSupabaseConnect = createHandler(
  async (request) => {
    if (connecting)
      throw new Error("A device connection is already in progress");
    connecting = true;
    try {
      if (databaseProviderFactory.sync.running)
        throw new Error(
          "Sync is running. Wait for it to finish before changing the connection.",
        );
      const link = request.connectionCode
        ? decodeConnection(request.connectionCode)
        : null;
      const saved = await credentialStorage.getConfiguration();
      const configuration =
        link?.configuration || request.configuration || saved;
      const validation = credentialStorage.validateConfiguration(configuration);
      if (!validation.isValid) throw new Error(validation.errors.join(". "));
      const active = {
        ...configuration,
        supabaseUrl: `https://${configuration.projectId}.supabase.co`,
      };
      const current = await credentialStorage.getSession();
      if (!link && current)
        throw new Error(
          "Already connected. Use Create connection code to link another device.",
        );
      // Do not replace an established device identity with a new anonymous user.
      if (!link && !(await databaseProviderFactory.canCreateHistory()))
        throw new Error(
          "Link this history using a connection code from another connected device.",
        );
      const session =
        saved?.projectId === active.projectId && current
          ? {
              ...current,
              accessToken: await supabaseAuthClient.getAccessToken(),
            }
          : await supabaseAuthClient.createDeviceSession(
              active,
              request.captchaToken,
            );
      session.historyOwnerId = await supabaseAuthClient.deviceRpc(
        active,
        session,
        link ? "watchmarker_claim_link" : "watchmarker_history_owner",
        link ? { p_token: link.token } : {},
      );
      if (typeof session.historyOwnerId !== "string" || !session.historyOwnerId)
        throw new Error("The sync service did not return a history identity");
      await databaseProviderFactory.assertIdentity(configuration, session);
      await credentialStorage.storeAuthenticatedConfiguration(
        configuration,
        session,
      );
      await supabaseDatabaseProvider.close();
      // Local recording stays available while the initial cloud restore runs.
      void databaseProviderFactory.performDeltaSync().catch(() => {});
      return { auth: { authenticated: true } };
    } finally {
      connecting = false;
    }
  },
  { name: "handleSupabaseConnect" },
);

export const handleSupabaseCreateLink = createHandler(
  async () => {
    const configuration = await credentialStorage.getConfiguration();
    const session = await credentialStorage.getSession();
    if (!configuration || !session)
      throw new Error("Connect this device first");
    session.accessToken = await supabaseAuthClient.getAccessToken();
    const token = await supabaseAuthClient.deviceRpc(
      configuration,
      session,
      "watchmarker_create_link",
    );
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new Error("Invalid connection code returned by sync service");
    return { connectionCode: encodeConnection(configuration, token) };
  },
  { name: "handleSupabaseCreateLink" },
);

export const handleSupabaseTest = createHandler(
  async () => {
    await supabaseAuthClient.testSession();
    await supabaseDatabaseProvider.testConnection();
    return {};
  },
  { name: "handleSupabaseTest" },
);

export const handleSupabaseGetCredentials = createHandler(
  async () => ({ credentials: await credentialStorage.getMaskedCredentials() }),
  { name: "handleSupabaseGetCredentials" },
);

export const handleSupabaseGetStatus = createHandler(
  async () => ({ status: await credentialStorage.getCredentialStatus() }),
  { name: "handleSupabaseGetStatus" },
);

export const handleSupabaseCheckTable = createHandler(
  async () => {
    const tableStatus = await supabaseDatabaseProvider.checkTableStatus();
    return { tableExists: tableStatus.exists, tableStatus };
  },
  { name: "handleSupabaseCheckTable" },
);
