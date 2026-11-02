import { WebEncryption } from "./web-encryption.js";

const CONFIG_VERSION = 5;
const STORAGE_KEY = "supabase_credentials";
const ACCESS_SESSION_KEY = "supabase_access_session";

function isValidProjectId(value) {
  return typeof value === "string" && /^[a-z]{20}$/.test(value);
}

function getProjectUrl(projectId) {
  return `https://${projectId}.supabase.co`;
}

function isPublishableKey(value) {
  return (
    typeof value === "string" && /^sb_publishable_[A-Za-z0-9_-]+$/.test(value)
  );
}

export class CredentialStorage {
  constructor() {
    this.encryption = new WebEncryption();
    this.storageKey = STORAGE_KEY;
  }

  validateConfiguration(configuration) {
    const errors = [];
    if (!isValidProjectId(configuration?.projectId)) {
      errors.push("A valid 20-character Supabase project ID is required");
    }
    if (!isPublishableKey(configuration?.publishableKey)) {
      errors.push(
        "A Supabase publishable key (sb_publishable_...) is required. Secret and service-role keys are forbidden.",
      );
    }
    return { isValid: errors.length === 0, errors };
  }

  async getStoredRecord() {
    const result = await chrome.storage.local.get([this.storageKey]);
    const record = result[this.storageKey];

    if (record && record.version !== CONFIG_VERSION) {
      // Older formats stored a full URL, and version 1 could contain a
      // service-role key. Replace them instead of carrying old credentials
      // into the current public-client configuration.
      await chrome.storage.local.remove([this.storageKey]);
      return null;
    }

    return record || null;
  }

  validateSession(session) {
    if (!session?.accessToken || !session?.refreshToken || !session?.userId) {
      throw new Error("Supabase returned an incomplete Auth session");
    }
  }

  async encryptPersistentSession(session) {
    this.validateSession(session);
    return {
      refreshToken: await this.encryption.encrypt(session.refreshToken),
      userId: await this.encryption.encrypt(session.userId),
      historyOwnerId: session.historyOwnerId
        ? await this.encryption.encrypt(session.historyOwnerId)
        : null,
    };
  }

  async storeAccessSession(session) {
    await chrome.storage.session.set({
      [ACCESS_SESSION_KEY]: {
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        userId: session.userId,
      },
    });
  }

  async storeAuthenticatedConfiguration(configuration, session) {
    const validation = this.validateConfiguration(configuration);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(". "));
    }

    await chrome.storage.local.set({
      [this.storageKey]: {
        version: CONFIG_VERSION,
        projectId: await this.encryption.encrypt(configuration.projectId),
        publishableKey: await this.encryption.encrypt(
          configuration.publishableKey,
        ),
        session: await this.encryptPersistentSession(session),
        storedAt: Date.now(),
      },
    });
    await this.storeAccessSession(session);
  }

  async getConfiguration() {
    try {
      const record = await this.getStoredRecord();
      if (!record?.projectId || !record?.publishableKey) return null;

      const projectId = await this.encryption.decrypt(record.projectId);

      return {
        projectId,
        supabaseUrl: getProjectUrl(projectId),
        publishableKey: await this.encryption.decrypt(record.publishableKey),
        storedAt: record.storedAt,
      };
    } catch (error) {
      console.error("Failed to retrieve Supabase configuration:", error);
      return null;
    }
  }

  async storeSession(session) {
    const record = await this.getStoredRecord();
    if (!record) throw new Error("Supabase is not configured");
    record.session = await this.encryptPersistentSession(session);
    await chrome.storage.local.set({ [this.storageKey]: record });
    await this.storeAccessSession(session);
  }

  async getSession() {
    try {
      const record = await this.getStoredRecord();
      if (!record?.session) return null;

      const userId = await this.encryption.decrypt(record.session.userId);
      const accessResult = await chrome.storage.session.get([
        ACCESS_SESSION_KEY,
      ]);
      const accessSession = accessResult[ACCESS_SESSION_KEY];
      const hasMatchingAccessSession = accessSession?.userId === userId;

      return {
        accessToken: hasMatchingAccessSession
          ? accessSession.accessToken
          : null,
        refreshToken: await this.encryption.decrypt(
          record.session.refreshToken,
        ),
        userId,
        historyOwnerId: record.session.historyOwnerId
          ? await this.encryption.decrypt(record.session.historyOwnerId)
          : userId,
        expiresAt: hasMatchingAccessSession ? accessSession.expiresAt : 0,
      };
    } catch (error) {
      console.error("Failed to retrieve Supabase Auth session:", error);
      return null;
    }
  }

  async clearSession() {
    const record = await this.getStoredRecord();
    if (record) {
      record.session = null;
      await chrome.storage.local.set({ [this.storageKey]: record });
    }
    await chrome.storage.session.remove([ACCESS_SESSION_KEY]);
  }

  async clearCredentials() {
    await Promise.all([
      chrome.storage.local.remove([this.storageKey]),
      chrome.storage.session.remove([ACCESS_SESSION_KEY]),
    ]);
  }

  async hasConfiguration() {
    return Boolean(await this.getConfiguration());
  }

  async hasAuthenticatedSession() {
    return Boolean(await this.getSession());
  }

  maskSensitiveValue(value) {
    if (!value) return "";
    if (value.length <= 12) return "***";
    return `${value.slice(0, 8)}${"*".repeat(12)}${value.slice(-4)}`;
  }

  async getMaskedCredentials() {
    const [configuration, session] = await Promise.all([
      this.getConfiguration(),
      this.getSession(),
    ]);
    if (!configuration) return null;

    return {
      projectId: configuration.projectId,
      publishableKey: this.maskSensitiveValue(configuration.publishableKey),
      authenticated: Boolean(session),
      storedAt: configuration.storedAt,
    };
  }

  async getCredentialStatus() {
    const [configuration, session] = await Promise.all([
      this.getConfiguration(),
      this.getSession(),
    ]);
    return {
      configured: Boolean(configuration),
      authenticated: Boolean(session),
      storedAt: configuration?.storedAt || null,
    };
  }
}

export const credentialStorage = new CredentialStorage();
