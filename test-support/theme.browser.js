import { setButtonBusy, clearButtonBusy } from "../ui/button-state.js";
import { ToastService } from "../ui/toast-service.js";
import { videoCard } from "../ui/history-library.js";
import { verifyDisclosureLayout } from "./sync-layout.browser.js";
import { verifyPageTemplates } from "./page-templates.browser.js";
import { verifySyncStates } from "./sync-status.browser.js";

const fixture = window.fixture;
const results = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await pause();
  }
  throw new Error(`UI did not initialize: ${fixture.errors.join("\n")}`);
}
async function check(name, run) {
  try {
    await run();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.stack });
    throw error;
  }
}
const element = (selector) => document.querySelector(selector);
const style = (selector) => getComputedStyle(element(selector));
const forced = matchMedia("(forced-colors: active)").matches;
function contrast(foreground, background) {
  const luminance = (color) => {
    const rgb = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number);
    const linear = rgb.map((value) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}
try {
  await check("options initialize with no framework runtime", async () => {
    await waitFor(
      () =>
        element("#panel-preferences") &&
        element("#idSearch_Results").getAttribute("aria-busy") === "false",
    );
    assert(!window.bootstrap, "Framework runtime is still loaded");
    if (fixture.expected === "forced colors")
      assert(forced, "Chrome did not enable forced colors");
    if (fixture.expected === "narrow dark reduced motion") {
      assert(
        matchMedia("(prefers-color-scheme: dark)").matches,
        "Chrome did not enable dark mode",
      );
      assert(
        matchMedia("(prefers-reduced-motion: reduce)").matches,
        "Chrome did not enable reduced motion",
      );
    }
    assert(
      style("#search-spinner").display === "none",
      "Idle spinner is visible",
    );
    assert(
      style("#panel-preferences").display === "none",
      "Hidden panel is visible",
    );
    await verifyPageTemplates(assert);
  });
  await check(
    "light, dark and system themes style shared controls with readable text",
    async () => {
      const backgrounds = [];
      for (const theme of ["light", "dark", "system"]) {
        element("#theme-toggle").click();
        await waitFor(() => fixture.local.theme === theme);
        const expected =
          theme === "system"
            ? matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light"
            : theme;
        assert(
          document.documentElement.dataset.theme === expected,
          "Theme preference did not apply",
        );
        assert(
          forced || style("html").colorScheme === expected,
          "Native controls use the wrong scheme",
        );
        if (!forced) {
          const button = style(".primary-button");
          assert(
            contrast(button.color, button.backgroundColor) >= 4.5,
            `Low primary contrast in ${theme}`,
          );
          assert(
            contrast(style("body").color, style("body").backgroundColor) >= 4.5,
            `Low body contrast in ${theme}`,
          );
        }
        backgrounds.push(style("body").backgroundColor);
      }
      if (!forced)
        assert(backgrounds[0] !== backgrounds[1], "Themes look identical");
    },
  );
  await check(
    "settings switches save, retain labels and show checked state",
    async () => {
      location.hash = "preferences";
      await waitFor(() => !element("#panel-preferences").hidden);
      const toggle = element("#idCondition_Brownav");
      assert(toggle.labels.length === 1, "Switch lost its label");
      const unchecked = getComputedStyle(toggle, "::before").transform;
      toggle.click();
      await waitFor(() => fixture.sync.idCondition_Brownav === true);
      await new Promise((resolve) => setTimeout(resolve, 160));
      if (!forced)
        assert(
          unchecked !== getComputedStyle(toggle, "::before").transform,
          "Switch thumb did not move",
        );
      assert(
        element("#operation-status").textContent === "",
        "Setting added redundant success text",
      );
      assert(
        element("#errorToast").hidden,
        "Success displayed an error notification",
      );
    },
  );
  await check(
    "busy import retains the input and its event listener",
    async () => {
      const input = element('input[type="file"]');
      const label = input.parentElement;
      let events = 0;
      input.addEventListener("fixture-event", () => events++);
      setButtonBusy(label, "Importing…");
      setButtonBusy(label, "Duplicate");
      assert(
        input.disabled && label.getAttribute("aria-busy") === "true",
        "Import was not disabled",
      );
      assert(
        label.querySelector("input") === input,
        "Import input was replaced",
      );
      clearButtonBusy(label);
      input.dispatchEvent(new Event("fixture-event"));
      assert(!input.disabled && events === 1, "Import input did not recover");
      assert(
        label.querySelector("#idDatabase_Import"),
        "Import label was not restored",
      );
      assert(!label.hasAttribute("aria-busy"), "Busy state was not cleared");
    },
  );
  await check(
    "native error notification opens, dismisses and reopens safely",
    async () => {
      const feedback = new ToastService({
        errorToastElement: element("#errorToast"),
        errorMessageElement: element("#errorToastMessage"),
        statusElement: element("#operation-status"),
      });
      feedback.error("<strong>Offline</strong>");
      assert(style("#errorToast").display !== "none", "Error remained hidden");
      assert(
        !element("#errorToastMessage strong"),
        "Message was interpreted as HTML",
      );
      element("[data-dismiss-error]").click();
      assert(element("#errorToast").hidden, "Dismiss failed");
      feedback.error("Try again");
      assert(!element("#errorToast").hidden, "Error did not reopen");
      element("[data-dismiss-error]").click();
    },
  );
  await check(
    "sync forms fit the viewport with visible keyboard focus",
    async () => {
      location.hash = "sync";
      await waitFor(() => !element("#panel-sync").hidden);
      await verifySyncStates(fixture, assert);
      await verifyDisclosureLayout(element("#project-setup-label"), [
        element("#cloud-heading"),
        element("#sync-summary"),
        element("#connect-device-form"),
        element("#project-setup-label"),
      ]);
      element("#project-settings").open = true;
      await pause();
      assert(
        !element("#connect-device-form").hidden,
        "Opening setup removed the connection-code row",
      );
      const input = element("#supabase_project_id");
      input.focus();
      assert(
        getComputedStyle(input).outlineStyle !== "none",
        "Keyboard focus is invisible",
      );
      assert(
        document.documentElement.scrollWidth <= innerWidth,
        "Page overflows horizontally",
      );
      assert(input.getBoundingClientRect().width > 100, "Text field collapsed");
      if (matchMedia("(prefers-reduced-motion: reduce)").matches)
        assert(
          getComputedStyle(element(".switch-input"), "::before")
            .transitionDuration === "0s",
          "Reduced motion was ignored",
        );
      if (forced)
        assert(
          style(".switch-input").appearance === "auto",
          "Forced-colors switch is not native",
        );
      assert(fixture.errors.length === 0, fixture.errors.join("\n"));
    },
  );
  await check(
    "connecting supports retries, stable setup controls and copying",
    async () => {
      const setup = element("#project-settings");
      setup.open = false;
      await waitFor(() => !element("#connect-device-form").hidden);
      assert(
        element("#sync-connected").hidden,
        "Connected actions appeared before connection",
      );
      assert(
        element("#idDatabase_Sync").hidden,
        "Manual sync appeared before connection",
      );
      assert(
        element("#connect-device").disabled,
        "Empty code could be submitted",
      );
      const input = element("#connection-code");
      input.value = "fixture-connection-code";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      fixture.connectionError = "This code has expired";
      element("#connect-device-form").requestSubmit();
      await waitFor(() =>
        element("#sync-feedback").textContent.includes("expired"),
      );
      assert(
        !element("#sync-setup").hidden,
        "Failed connection hid retry controls",
      );
      assert(
        input.value === "fixture-connection-code",
        "Failed connection discarded input",
      );
      fixture.connectionError = null;
      element("#connect-device-form").requestSubmit();
      await waitFor(
        () =>
          !element("#sync-connected").hidden &&
          !element("#create-link").disabled,
      );
      assert(
        element("#sync-setup").hidden,
        "Connection form remained after success",
      );
      assert(
        !element("#idDatabase_Sync").hidden,
        "Manual sync remained hidden after connection",
      );
      assert(input.value === "", "Submitted code was retained");
      assert(
        document.activeElement === element("#create-link"),
        "Keyboard focus was lost after connection",
      );
      await verifyDisclosureLayout(element("#sync-setup-toggle"), [
        element("#cloud-heading"),
        element("#sync-summary"),
        element("#create-link"),
      ]);
      element("#sync-setup-toggle").click();
      await waitFor(() => element("#project-settings").open);
      assert(
        !element("#sync-setup").hidden,
        "Database maintenance became inaccessible after connecting",
      );
      assert(
        element("#project-fields").hidden && element("#start-sync").hidden,
        "Database maintenance exposed first-device creation controls",
      );
      element("#sync-setup-toggle").click();
      element("#create-link").click();
      await waitFor(
        () =>
          !element("#device-link-panel").hidden &&
          !element("#create-link").disabled,
      );
      assert(
        element("#generated-connection-code").value.startsWith(
          "watchmarker:1:",
        ),
        "No code was available to copy",
      );
      assert(
        element("#connection-code-expiry").textContent.includes("valid until"),
        "Code expiry was not shown",
      );
      assert(
        element("#sync-feedback").textContent.includes("code") ||
          element("#sync-feedback").textContent.includes("Code"),
        "No copy guidance was shown",
      );
      const sent = fixture.requests.find(
        ({ action }) => action === "supabase-connect",
      );
      assert(
        sent.connectionCode === "fixture-connection-code" &&
          !sent.configuration,
        "Device linking included hidden project fields",
      );
      assert(fixture.errors.length === 0, fixture.errors.join("\n"));
    },
  );
  await check("all sections fit a 320px viewport", async () => {
    const frame = document.createElement("iframe");
    frame.title = "Narrow viewport regression fixture";
    frame.style.cssText =
      "position:fixed;inset:0;width:320px;height:850px;border:0";
    const markup = document.documentElement.cloneNode(true);
    markup.querySelectorAll("script").forEach((node) => node.remove());
    const base = document.createElement("base");
    base.href = new URL("/content/index.html", location.href).href;
    markup.querySelector("head").prepend(base);
    const loaded = new Promise((resolve) =>
      frame.addEventListener("load", resolve, { once: true }),
    );
    frame.srcdoc = "<!doctype html>" + markup.outerHTML;
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument;
    const history = doc.querySelector("#idSearch_Results");
    history.innerHTML = `<ul class="video-list">${videoCard({ strIdent: "abcdefghijk", strTitle: "A long video title that should remain readable on a narrow screen", intTimestamp: Date.now(), entryId: "watch:1", watchNumber: 2 }, true, true, 0, 1)}</ul>`;
    for (const id of ["history", "preferences", "sync"]) {
      doc.querySelectorAll(".app-panel").forEach((panel) => {
        panel.hidden = panel.id !== `panel-${id}`;
      });
      assert(
        doc.documentElement.scrollWidth <= 320,
        `${id} overflows at 320px: ${doc.documentElement.scrollWidth}`,
      );
      if (id === "sync") {
        const row = doc.querySelector(".source-row");
        const copy = row.querySelector("div").getBoundingClientRect();
        const action = row.querySelector("button").getBoundingClientRect();
        assert(copy.width >= 160, "Source text is cramped on narrow screens");
        assert(
          action.top >= copy.bottom,
          "Source action competes with its text",
        );
      }
    }
    doc.querySelectorAll(".app-panel").forEach((panel) => {
      panel.hidden = panel.id !== "panel-history";
    });
    for (const view of ["list", "grid"]) {
      history.dataset.view = view;
      const meta = history.querySelector(".video-meta");
      assert(
        meta.scrollWidth <= meta.clientWidth,
        `${view} video metadata overflows at 320px: ${meta.scrollWidth} > ${meta.clientWidth}`,
      );
    }
    frame.remove();
  });
} catch {
  /* Each check records the actionable failure. */
}
await fetch("/results", { method: "POST", body: JSON.stringify(results) });
