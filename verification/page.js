import { isAllowedParent } from "./protocol.js";

const status = document.getElementById("status");
let active;
let widget;

window.addEventListener("message", (event) => {
  if (
    window.parent === window ||
    event.source !== window.parent ||
    !isAllowedParent(event.origin) ||
    event.data?.type !== "watchmarker-captcha-init" ||
    !/^[a-f0-9]{64}$/.test(event.data.nonce || "") ||
    !/^[A-Za-z0-9_-]{10,100}$/.test(event.data.siteKey || "") ||
    active
  )
    return;
  active = {
    origin: event.origin,
    nonce: event.data.nonce,
    siteKey: event.data.siteKey,
  };
  const script = document.createElement("script");
  script.src =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.referrerPolicy = "no-referrer";
  script.addEventListener("load", render, { once: true });
  script.addEventListener(
    "error",
    () => {
      status.textContent =
        "Verification could not load. Check your connection and try again.";
    },
    { once: true },
  );
  document.head.append(script);
});

function render() {
  status.textContent = "Verify to connect this device";
  widget = window.turnstile.render("#widget", {
    sitekey: active.siteKey,
    action: "watchmarker_signup",
    cData: active.nonce,
    theme: "auto",
    "response-field": false,
    callback(token) {
      window.parent.postMessage(
        { type: "watchmarker-captcha-result", nonce: active.nonce, token },
        active.origin,
      );
      status.textContent = "Verified. Connecting…";
    },
    "expired-callback"() {
      status.textContent = "Verification expired. Please verify again.";
      window.turnstile.reset(widget);
    },
    "error-callback"() {
      status.textContent = "Verification failed. Please try again.";
    },
  });
}
