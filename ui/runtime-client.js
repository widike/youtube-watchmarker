// @ts-check

const RETRYABLE_ERROR_PATTERNS = [
  "Receiving end does not exist",
  "Extension context invalidated",
  "context invalidated",
];

function isRetryableRuntimeError(error) {
  return RETRYABLE_ERROR_PATTERNS.some((pattern) =>
    error?.message?.includes(pattern),
  );
}

export class RuntimeClient {
  async sendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (!isRetryableRuntimeError(error)) {
        throw error;
      }

      return await chrome.runtime.sendMessage(message);
    }
  }

  async openOptionsPage() {
    await chrome.runtime.openOptionsPage();
  }
}

export const runtimeClient = new RuntimeClient();
