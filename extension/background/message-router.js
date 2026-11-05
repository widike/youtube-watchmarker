import { logger } from "../shared/logger.js";
import { ErrorUtils, ValidationError } from "../shared/error-handler.js";
import { isValidVideoId } from "../shared/validation.js";

const CONTENT_ACTIONS = new Set([
  "youtube-lookup",
  "youtube-watch",
  "youtube-watch-time",
  "blocked-videos-list",
  "blocked-videos-block",
]);
const VIDEO_ACTIONS = new Set([
  "youtube-lookup",
  "youtube-watch",
  "youtube-watch-time",
  "blocked-videos-block",
  "blocked-videos-unblock",
  "search-delete",
]);
const CONTENT_ORIGINS = new Set([
  "https://www.youtube.com",
  "https://m.youtube.com",
]);

function validateMessage(message, sender) {
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    typeof message.action !== "string"
  ) {
    throw new ValidationError("Message must include an action");
  }
  if (sender?.id !== chrome.runtime.id) {
    throw new ValidationError("Untrusted message sender");
  }

  let url;
  try {
    url = new URL(sender.url);
  } catch {
    throw new ValidationError("Missing or invalid sender URL");
  }
  const extensionPage = url.href.startsWith(chrome.runtime.getURL("/"));
  if (
    !extensionPage &&
    (!CONTENT_ORIGINS.has(url.origin) || !CONTENT_ACTIONS.has(message.action))
  ) {
    throw new ValidationError("This action is restricted to extension pages");
  }
  if (VIDEO_ACTIONS.has(message.action)) {
    if (!isValidVideoId(message.videoId)) {
      throw new ValidationError("A valid 11-character video ID is required");
    }
    if (
      message.title !== undefined &&
      (typeof message.title !== "string" || message.title.length > 2000)
    ) {
      throw new ValidationError(
        "Video title must be a string of at most 2000 characters",
      );
    }
    for (const key of ["timestamp", "count"]) {
      if (
        message[key] !== undefined &&
        (!Number.isSafeInteger(message[key]) || message[key] < 0)
      ) {
        throw new ValidationError(`Invalid video ${key}`);
      }
    }
  }
  // A page may report a watch, but cannot choose historical dates or view counts.
  if (
    !extensionPage &&
    message.action === "youtube-watch" &&
    (message.timestamp !== undefined || message.count !== undefined)
  ) {
    throw new ValidationError("Content scripts cannot override watch metadata");
  }
}

// One request/response transport. No callers use long-lived runtime ports.
export class MessageRouter {
  constructor() {
    this.handlers = new Map();
    this.listenersInitialized = false;
  }

  registerMultiple(handlers) {
    for (const [action, handler] of Object.entries(handlers)) {
      this.handlers.set(action, handler);
    }
  }

  async handle(message, sender) {
    try {
      validateMessage(message, sender);
      const handler = this.handlers.get(message.action);
      if (!handler)
        throw new ValidationError(`Unknown action: ${message.action}`);
      const result = await handler(message, sender);
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("Handler returned an invalid response");
      }
      return { success: true, ...result };
    } catch (error) {
      // Log the action only: requests may contain passwords or private history.
      logger.warn("Message request failed", {
        action: message?.action,
        message: error?.message,
      });
      return ErrorUtils.createErrorResponse(error);
    }
  }

  setupListeners() {
    if (this.listenersInitialized) return;
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      void this.handle(message, sender).then(sendResponse);
      return true;
    });
    this.listenersInitialized = true;
  }
}

export const messageRouter = new MessageRouter();
