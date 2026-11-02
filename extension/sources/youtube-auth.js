import { logger } from "../shared/logger.js";

export const YOUTUBE_ORIGIN = "https://www.youtube.com";
const SAPISID_COOKIE_NAMES = [
  "SAPISID",
  "__Secure-3PAPISID",
  "__Secure-1PAPISID",
];

async function readCookieValue(name) {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: YOUTUBE_ORIGIN, name }, (cookie) => {
      if (chrome.runtime.lastError) {
        logger.warn(
          `Cookie read error for ${name}:`,
          chrome.runtime.lastError.message,
        );
        resolve(null);
        return;
      }
      resolve(cookie?.value || null);
    });
  });
}

export async function getSapisidCookie() {
  for (const name of SAPISID_COOKIE_NAMES) {
    const value = await readCookieValue(name);
    if (value) return value;
  }
  return null;
}

export async function computeSapisidHash(sapisid, origin = YOUTUBE_ORIGIN) {
  const ts = Math.floor(Date.now() / 1000);
  const data = new TextEncoder().encode(`${ts} ${sapisid} ${origin}`);
  const digest = await crypto.subtle.digest("SHA-1", data);
  const hash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `SAPISIDHASH ${ts}_${hash}`;
}
