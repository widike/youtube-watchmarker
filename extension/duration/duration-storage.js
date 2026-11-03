import {
  META_STORE,
  readRequest,
  transactionDone,
} from "../history/history-storage.js";
import { WebEncryption } from "../providers/web-encryption.js";
import {
  DURATION_PREFIX as PREFIX,
  DURATION_OUTBOX,
  durationRange,
} from "./duration-records.js";
import { mergeDurations } from "./duration-replication.js";

const CONFIG_KEY = "youtube_duration_config";
const STATE_KEY = "youtube_duration_state";

export class DurationStorage {
  constructor(
    database,
    local = chrome.storage.local,
    encryption = new WebEncryption(),
  ) {
    this.database = database;
    this.local = local;
    this.encryption = encryption;
  }

  async getConfig() {
    return (await this.local.get(CONFIG_KEY))[CONFIG_KEY] || { enabled: false };
  }

  async saveConfig(config) {
    await this.local.set({ [CONFIG_KEY]: config });
  }

  async getKey(config) {
    return config.apiKey ? this.encryption.decrypt(config.apiKey) : "";
  }

  async encryptKey(key) {
    return this.encryption.encrypt(key);
  }

  async getState() {
    return (await this.local.get(STATE_KEY))[STATE_KEY] || {};
  }

  async saveState(state) {
    await this.local.set({ [STATE_KEY]: state });
  }

  async notifyCacheChanged() {
    // Keep metadata notifications separate from backfill quota/retry state.
    await this.local.set({
      youtube_duration_cache_revision: crypto.randomUUID(),
    });
  }

  async readCache(now = Date.now()) {
    const tx = this.database().transaction(META_STORE, "readwrite");
    const done = transactionDone(tx);
    const rows = [];
    const request = tx
      .objectStore(META_STORE)
      .getAll(IDBKeyRange.bound(PREFIX, `${PREFIX}\uffff`));
    request.onsuccess = () => {
      for (const row of request.result) {
        if (row.unavailable === true || row.expiresAt > now) rows.push(row);
        else {
          tx.objectStore(META_STORE).delete(`${PREFIX}${row.strIdent}`);
          tx.objectStore(META_STORE).delete(
            `${DURATION_OUTBOX}${row.strIdent}`,
          );
        }
      }
    };
    await done;
    return rows;
  }

  async writeCache(rows) {
    if (await mergeDurations(this.database(), rows, { pending: true }))
      await this.notifyCacheChanged();
  }

  async clearCache() {
    const tx = this.database().transaction(META_STORE, "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore(META_STORE);
    for (const prefix of [PREFIX, DURATION_OUTBOX]) {
      const keys = await readRequest(store.getAllKeys(durationRange(prefix)));
      for (const key of keys) store.delete(key);
    }
    await done;
    await this.notifyCacheChanged();
  }
}
