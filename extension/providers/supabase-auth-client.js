import { credentialStorage } from "./credential-storage.js";
import { isCaptchaToken } from "../verification/protocol.js";

const REFRESH_MARGIN_MS = 60_000;

export class SupabaseAuthClient {
  constructor() {
    this.refreshPromise = null;
  }

  async getConfiguration() {
    const configuration = await credentialStorage.getConfiguration();
    if (!configuration) {
      throw new Error(
        "Configure a Supabase project ID and publishable key before signing in",
      );
    }
    return configuration;
  }

  async request(path, { body, accessToken, configuration } = {}) {
    const activeConfiguration =
      configuration || (await this.getConfiguration());
    const headers = {
      apikey: activeConfiguration.publishableKey,
      "Content-Type": "application/json",
      "X-Client-Info": "youtube-watchmarker-extension",
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(
      `${activeConfiguration.supabaseUrl}/auth/v1${path}`,
      {
        method: "POST",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        payload.msg ||
          payload.message ||
          payload.error_description ||
          payload.error ||
          `Supabase Auth failed with HTTP ${response.status}`,
      );
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  createStoredSession(payload, previousSession = null) {
    const user = payload?.user;
    if (
      typeof payload?.access_token !== "string" ||
      !payload.access_token ||
      typeof payload.refresh_token !== "string" ||
      !payload.refresh_token ||
      typeof user?.id !== "string" ||
      !user.id ||
      !Number.isFinite(payload.expires_in) ||
      payload.expires_in <= 0
    ) {
      throw new Error("Supabase returned an incomplete Auth session");
    }
    if (previousSession && user.id !== previousSession.userId) {
      throw new Error("Supabase refresh returned a different device identity");
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
      userId: user.id,
    };
  }

  async createDeviceSession(configuration, captchaToken) {
    if (!isCaptchaToken(captchaToken))
      throw new Error("Verify this device before connecting");
    const payload = await this.request("/signup", {
      body: { gotrue_meta_security: { captcha_token: captchaToken } },
      configuration,
    });
    return this.createStoredSession(payload);
  }

  async deviceRpc(configuration, session, name, body = {}) {
    const response = await fetch(
      `${configuration.supabaseUrl}/rest/v1/rpc/${name}`,
      {
        method: "POST",
        headers: {
          apikey: configuration.publishableKey,
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        payload?.message ||
          "Device linking needs the current database setup SQL",
      );
    return payload;
  }

  refreshSession() {
    if (!this.refreshPromise) {
      this.refreshPromise = this.performSessionRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async performSessionRefresh() {
    const previousSession = await credentialStorage.getSession();
    if (!previousSession?.refreshToken) {
      throw new Error(
        "Sync session is missing. Reconnect with a connection code.",
      );
    }

    try {
      const payload = await this.request("/token?grant_type=refresh_token", {
        body: { refresh_token: previousSession.refreshToken },
      });
      const session = this.createStoredSession(payload, previousSession);
      session.historyOwnerId = previousSession.historyOwnerId;
      await credentialStorage.storeSession(session);
      return session;
    } catch (error) {
      if (error.status === 400 || error.status === 401) {
        await credentialStorage.clearSession();
      }
      throw new Error(`Sync session could not be refreshed: ${error.message}`);
    }
  }

  async getAccessToken() {
    const session = await credentialStorage.getSession();
    if (!session) {
      throw new Error("Connect this device before accessing shared history");
    }

    if (session.expiresAt - Date.now() <= REFRESH_MARGIN_MS) {
      return (await this.refreshSession()).accessToken;
    }
    return session.accessToken;
  }

  async testSession() {
    const configuration = await this.getConfiguration();
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${configuration.supabaseUrl}/auth/v1/user`, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        apikey: configuration.publishableKey,
        Authorization: `Bearer ${accessToken}`,
        "X-Client-Info": "youtube-watchmarker-extension",
      },
    });

    if (!response.ok) {
      if (response.status === 401) await credentialStorage.clearSession();
      throw new Error(
        `Sync connection check failed (HTTP ${response.status}).`,
      );
    }
    return response.json();
  }
}

export const supabaseAuthClient = new SupabaseAuthClient();
