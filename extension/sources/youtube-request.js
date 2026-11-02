import { YOUTUBE } from "../shared/constants.js";
import {
  YOUTUBE_ORIGIN,
  getSapisidCookie,
  computeSapisidHash,
} from "./youtube-auth.js";

const RULE_ID = 1;
let preparedApi;
let preparation;

// Fetch cannot set Origin/Referer itself. Match the browser's request headers
// to the origin used by SAPISIDHASH and YouTube's web API key restrictions.
export function prepareYouTubeRequests() {
  const api = chrome.declarativeNetRequest;
  if (preparedApi === api && preparation) return preparation;
  preparedApi = api;
  preparation = api
    .updateSessionRules({
      removeRuleIds: [RULE_ID],
      addRules: [
        {
          id: RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Origin", operation: "set", value: YOUTUBE_ORIGIN },
              {
                header: "Referer",
                operation: "set",
                value: `${YOUTUBE_ORIGIN}/`,
              },
            ],
          },
          condition: {
            regexFilter:
              "^https://www\\.youtube\\.com/youtubei/v1/(browse|feedback)(\\?|$)",
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ["xmlhttprequest"],
            requestMethods: ["post"],
          },
        },
      ],
    })
    .catch((error) => {
      preparation = null;
      throw error;
    });
  return preparation;
}

export async function requestYouTubeApi(
  endpoint,
  config,
  payload,
  { signal } = {},
) {
  signal?.throwIfAborted();
  if (!Object.values(YOUTUBE.API.ENDPOINTS).includes(endpoint)) {
    throw new Error("Unsupported YouTube API endpoint");
  }
  const sapisid = await getSapisidCookie();
  if (!sapisid)
    throw new Error("YouTube sign-in cookie unavailable; sign in and retry.");
  await prepareYouTubeRequests();
  const headers = {
    "Content-Type": "application/json",
    Authorization: await computeSapisidHash(sapisid),
    "X-Origin": YOUTUBE_ORIGIN,
    "X-Goog-AuthUser": config.authUser,
    "X-Youtube-Bootstrap-Logged-In": "true",
  };
  if (config.clientName)
    headers["X-Youtube-Client-Name"] = String(config.clientName);
  if (config.clientVersion)
    headers["X-Youtube-Client-Version"] = config.clientVersion;
  if (config.delegatedSessionId)
    headers["X-Goog-PageId"] = config.delegatedSessionId;
  if (config.context?.client?.visitorData)
    headers["X-Goog-Visitor-Id"] = config.context.client.visitorData;
  signal?.throwIfAborted();
  return fetch(
    `${YOUTUBE.API.BASE}${endpoint}?key=${encodeURIComponent(config.apiKey)}&prettyPrint=false`,
    {
      method: "POST",
      headers,
      credentials: "include",
      signal: AbortSignal.any([
        AbortSignal.timeout(25_000),
        ...(signal ? [signal] : []),
      ]),
      body: JSON.stringify({ ...payload, context: config.context }),
    },
  );
}
