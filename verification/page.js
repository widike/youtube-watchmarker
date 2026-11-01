import { isAllowedParent, isCaptchaInitialization } from "./protocol.js";

const status = document.getElementById("status");
let active;
let widget;

window.addEventListener("message", (event) => {
  if (
    window.parent === window ||
    event.source !== window.parent ||
    !isAllowedParent(event.origin) ||
    !isCaptchaInitialization(event.data)
  )
    return;
  initialize(event.data, (result) =>
    window.parent.postMessage(result, event.origin),
  );
});

// Android injects this channel only into the approved HTTPS origin. The native
// listener additionally checks the main frame, per-attempt nonce and token size.
const native = window.watchmarkerNative;
if (window.parent === window && typeof native?.postMessage === "function") {
  native.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (isCaptchaInitialization(data))
      initialize(data, (result) => native.postMessage(JSON.stringify(result)));
  };
  native.postMessage(JSON.stringify({ type: "watchmarker-captcha-ready" }));
}

function initialize(data, send) {
  if (active) return;
  active = {
    nonce: data.nonce,
    siteKey: data.siteKey,
    send,
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
}

function render() {
  status.textContent = "Verify to connect this device";
  widget = window.turnstile.render("#widget", {
    sitekey: active.siteKey,
    action: "watchmarker_signup",
    cData: active.nonce,
    theme: "auto",
    "response-field": false,
    callback(token) {
      active.send({
        type: "watchmarker-captcha-result",
        nonce: active.nonce,
        token,
      });
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
