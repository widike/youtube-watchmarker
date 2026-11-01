import { logger } from "./logger.js";

/**
 * Extract a balanced JSON object starting at the opening brace at startIdx.
 * Handles strings (and escapes) so braces inside strings don't break nesting.
 * @param {string} text
 * @param {number} startIdx - Index of the opening '{'
 * @returns {string|null} JSON object substring, or null if unbalanced
 */
function extractBalancedObject(text, startIdx) {
  if (text[startIdx] !== "{") {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

/**
 * Extract and parse ytInitialData from a YouTube HTML page.
 * @param {string} responseText - Raw HTML response
 * @returns {Object|null} Parsed ytInitialData, or null when unavailable
 */
export function extractYtInitialData(responseText) {
  const patterns = [
    /\b(?:var\s+)?ytInitialData\s*=/g,
    /window\["ytInitialData"\]\s*=/g,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(responseText);
    if (!match) {
      continue;
    }

    const objStart = responseText.indexOf("{", match.index + match[0].length);
    if (objStart < 0) {
      continue;
    }

    const objStr = extractBalancedObject(responseText, objStart);
    if (!objStr) {
      continue;
    }

    try {
      return JSON.parse(objStr);
    } catch (error) {
      logger.warn("Failed to parse ytInitialData:", error);
    }
  }

  return null;
}

/**
 * Extract the InnerTube API key and request context from a YouTube HTML page.
 * Both values are needed to call /youtubei/v1/browse for paginated continuation.
 * @param {string} responseText - Raw HTML response
 * @returns {{apiKey: string|null, context: Object|null, clientName: string|null, clientVersion: string|null}}
 */
export function extractInnerTubeConfig(responseText) {
  let apiKey = null;
  let context = null;
  let clientName = null;
  let clientVersion = null;

  const apiKeyMatch = responseText.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/);
  if (apiKeyMatch) {
    apiKey = apiKeyMatch[1];
  }

  const contextClientNameMatch = responseText.match(
    /"INNERTUBE_CONTEXT_CLIENT_NAME":\s*(?:"([^"]+)"|(\d+))/,
  );
  if (contextClientNameMatch) {
    clientName = contextClientNameMatch[1] || contextClientNameMatch[2];
  }

  const ctxIdx = responseText.search(/"INNERTUBE_CONTEXT"\s*:/);
  if (ctxIdx >= 0) {
    const objStart = responseText.indexOf("{", ctxIdx);
    if (objStart >= 0) {
      const objStr = extractBalancedObject(responseText, objStart);
      if (objStr) {
        try {
          context = JSON.parse(objStr);
          clientName = clientName || context?.client?.clientName || null;
          clientVersion = context?.client?.clientVersion || null;
        } catch (error) {
          logger.warn("Failed to parse INNERTUBE_CONTEXT:", error);
        }
      }
    }
  }

  if (!clientName) {
    const m = responseText.match(/"INNERTUBE_CLIENT_NAME":\s*"([^"]+)"/);
    if (m) clientName = m[1];
  }
  if (!clientVersion) {
    const m = responseText.match(/"INNERTUBE_CLIENT_VERSION":\s*"([^"]+)"/);
    if (m) clientVersion = m[1];
  }

  const sessionIndex = responseText.match(
    /"SESSION_INDEX":\s*(?:"([^"\s]+)"|(\d+))/,
  );
  const delegatedSessionId = responseText.match(
    /"DELEGATED_SESSION_ID":\s*"([^"]+)"/,
  );
  return {
    apiKey,
    context,
    clientName,
    clientVersion,
    authUser: sessionIndex?.[1] || sessionIndex?.[2] || "0",
    delegatedSessionId: delegatedSessionId?.[1] || null,
  };
}
