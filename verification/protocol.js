export const CAPTCHA_PAGE_URL =
  "https://widike.github.io/youtube-watchmarker/verification/";
export const CAPTCHA_ORIGIN = new URL(CAPTCHA_PAGE_URL).origin;
export const CAPTCHA_TIMEOUT_MS = 180_000;

export function validateCaptchaConfiguration(value) {
  if (
    value?.pageUrl !== CAPTCHA_PAGE_URL ||
    typeof value.siteKey !== "string" ||
    !/^[A-Za-z0-9_-]{10,100}$/.test(value.siteKey)
  ) {
    throw new Error("Configure Turnstile using the CAPTCHA setup SQL first");
  }
  return { pageUrl: CAPTCHA_PAGE_URL, siteKey: value.siteKey };
}

export function isCaptchaToken(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 2048;
}

export function isCaptchaReply(event, { source, nonce }) {
  return (
    event.origin === CAPTCHA_ORIGIN &&
    event.source === source &&
    event.data?.type === "watchmarker-captcha-result" &&
    event.data.nonce === nonce &&
    isCaptchaToken(event.data.token)
  );
}

export function isAllowedParent(origin) {
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin || url.protocol !== "https:") return false;
  const parts = url.hostname.split(".").map(Number);
  return (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168))
  );
}
