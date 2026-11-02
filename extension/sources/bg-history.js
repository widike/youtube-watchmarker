import { logger } from "../shared/logger.js";
import {
  cleanHistoryTitle,
  extractHistoryVideoId,
} from "./browser-history-parser.js";
import { synchronizeBrowserHistory } from "./browser-history-sync.js";

/** Browser history imports use the local-first database provider. */
export class HistoryManager {
  constructor() {
    this.isInitialized = false;
    this.providerFactory = null;
    this.syncRequests = new Map();
    this.syncTail = Promise.resolve();
  }

  setProviderFactory(factory) {
    this.providerFactory = factory;
  }

  getProvider() {
    if (!this.providerFactory) {
      throw new Error(
        "Provider factory not set. Call setProviderFactory() first.",
      );
    }
    const provider = this.providerFactory.getCurrentProvider();
    if (!provider) throw new Error("No current database provider available");
    return provider;
  }

  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    logger.debug("History module initialized");
  }

  extractVideoId(url) {
    return extractHistoryVideoId(url);
  }

  isYouTubeVideoUrl(url) {
    return this.extractVideoId(url) !== null;
  }

  cleanTitle(title) {
    return cleanHistoryTitle(title);
  }

  preview({ signal } = {}) {
    return synchronizeBrowserHistory(this, 0, false, null, {
      preview: true,
      signal,
    });
  }

  synchronize(startTime = 0, skipExisting = false, onProgress = null) {
    if (!Number.isFinite(startTime) || startTime < 0) {
      return Promise.reject(
        new Error("Invalid startTime - must be a finite non-negative number"),
      );
    }
    // Matching requests share a run; differing manual/automatic options queue so
    // skipExisting does not change the behavior of an overlapping manual import.
    const key = `${startTime}:${skipExisting}`;
    if (!this.syncRequests.has(key)) {
      const run = () =>
        synchronizeBrowserHistory(this, startTime, skipExisting, onProgress);
      const request = this.syncTail.then(run).finally(() => {
        this.syncRequests.delete(key);
      });
      this.syncRequests.set(key, request);
      this.syncTail = request.catch(() => {});
    }
    return this.syncRequests.get(key);
  }
}

export const History = new HistoryManager();
