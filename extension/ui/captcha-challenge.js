import {
  CAPTCHA_ORIGIN,
  CAPTCHA_TIMEOUT_MS,
  isCaptchaReply,
  validateCaptchaConfiguration,
} from "../verification/protocol.js";

export class CaptchaChallenge {
  constructor(container) {
    this.container = container;
    this.cancel = null;
  }

  verify(configuration, { signal } = {}) {
    const config = validateCaptchaConfiguration(configuration);
    this.cancel?.();
    if (signal?.aborted)
      return Promise.reject(new Error("Verification cancelled"));
    return new Promise((resolve, reject) => {
      const nonce = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      const frame = document.createElement("iframe");
      frame.title = "Verify to connect this device";
      frame.src = config.pageUrl;
      frame.referrerPolicy = "no-referrer";
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "quiet-button";
      cancel.textContent = "Cancel verification";
      const finish = (error, token) => {
        clearTimeout(timer);
        window.removeEventListener("message", receive);
        signal?.removeEventListener("abort", abort);
        this.cancel = null;
        this.container.replaceChildren();
        this.container.hidden = true;
        if (error) reject(error);
        else resolve(token);
      };
      const abort = () => finish(new Error("Verification cancelled"));
      const receive = (event) => {
        if (isCaptchaReply(event, { source: frame.contentWindow, nonce }))
          finish(null, event.data.token);
      };
      const timer = setTimeout(
        () => finish(new Error("Verification expired. Try connecting again.")),
        CAPTCHA_TIMEOUT_MS,
      );
      frame.addEventListener(
        "load",
        () => {
          frame.contentWindow.postMessage(
            {
              type: "watchmarker-captcha-init",
              nonce,
              siteKey: config.siteKey,
            },
            CAPTCHA_ORIGIN,
          );
        },
        { once: true },
      );
      window.addEventListener("message", receive);
      signal?.addEventListener("abort", abort, { once: true });
      cancel.addEventListener("click", abort, { once: true });
      this.cancel = abort;
      this.container.replaceChildren(frame, cancel);
      this.container.hidden = false;
    });
  }
}
