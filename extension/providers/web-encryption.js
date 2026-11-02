const DATABASE_NAME = "youtube-watchmarker-secure-storage";
const STORE_NAME = "encryption-keys";
const KEY_ID = "supabase-credentials";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readKey() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    return await requestResult(transaction.objectStore(STORE_NAME).get(KEY_ID));
  } finally {
    database.close();
  }
}

async function writeKey(key) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).put(key, KEY_ID));
  } finally {
    database.close();
  }
}

/**
 * Encrypt extension-local tokens with a non-exportable AES key stored
 * separately in IndexedDB. A compromised extension context could still ask
 * the browser to decrypt them, so public clients must never store privileged
 * server keys here.
 */
export class WebEncryption {
  constructor() {
    this.keyPromise = null;
  }

  getKey() {
    if (!this.keyPromise) {
      this.keyPromise = this.loadOrCreateKey();
    }
    return this.keyPromise;
  }

  async loadOrCreateKey() {
    await chrome.storage.local.remove([
      "encryption_salt",
      "encryption_key_material",
    ]);
    const storedKey = await readKey();
    if (storedKey) return storedKey;

    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await writeKey(key);
    return key;
  }

  async encrypt(text) {
    if (!text) return "";

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await this.getKey(),
      new TextEncoder().encode(text),
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  }

  async decrypt(encryptedText) {
    if (!encryptedText) return "";

    const combined = Uint8Array.from(atob(encryptedText), (character) =>
      character.charCodeAt(0),
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: combined.slice(0, 12) },
      await this.getKey(),
      combined.slice(12),
    );
    return new TextDecoder().decode(decrypted);
  }
}
