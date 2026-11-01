import { META_STORE, readRequest, transactionDone } from "./history-storage.js";
import { WebEncryption } from "./web-encryption.js";

const PREFIX = "video-duration:";
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

  async readCache(now = Date.now()) {
    const tx = this.database().transaction(META_STORE, "readwrite");
    const done = transactionDone(tx);
    const rows = [];
    const request = tx
      .objectStore(META_STORE)
      .openCursor(IDBKeyRange.bound(PREFIX, `${PREFIX}\uffff`));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.unavailable === true || cursor.value.expiresAt > now)
        rows.push(cursor.value);
      else cursor.delete();
      cursor.continue();
    };
    await done;
    return rows;
  }

  async writeCache(rows) {
    const tx = this.database().transaction(META_STORE, "readwrite", {
      durability: "strict",
    });
    const done = transactionDone(tx);
    for (const row of rows)
      tx.objectStore(META_STORE).put(row, `${PREFIX}${row.strIdent}`);
    await done;
  }

  async clearCache() {
    const tx = this.database().transaction(META_STORE, "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore(META_STORE);
    const keys = await readRequest(
      store.getAllKeys(IDBKeyRange.bound(PREFIX, `${PREFIX}\uffff`)),
    );
    for (const key of keys) store.delete(key);
    await done;
  }
}
