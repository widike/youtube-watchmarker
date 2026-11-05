import { runtimeClient } from "../../ui/runtime-client.js";

const ENABLED_KEY = "idBlocking_Enabled";
const STORAGE_KEY = "watchmarker_blocked_videos";

export class BlockedVideosController {
  constructor({ feedback, client = runtimeClient }) {
    this.feedback = feedback;
    this.client = client;
    this.generation = 0;
  }

  async initialize() {
    this.toggle = document.getElementById(ENABLED_KEY);
    this.panel = document.getElementById("blocked-videos-panel");
    if (!this.toggle || !this.panel) return;
    this.list = this.panel.querySelector("[data-blocked-list]");
    this.status = this.panel.querySelector("[data-blocked-status]");
    this.retry = this.panel.querySelector("[data-blocked-retry]");
    this.retry.addEventListener("click", () => void this.load());
    this.toggle.addEventListener("change", () => void this.setEnabled());
    this.list.addEventListener("click", (event) => {
      const button = event.target.closest("[data-unblock]");
      if (button && !button.disabled) void this.unblock(button);
    });
    const onChange = (changes, area) => {
      if (area === "sync" && changes[ENABLED_KEY]) {
        this.toggle.checked = changes[ENABLED_KEY].newValue === true;
        void this.renderEnabled();
      } else if (
        area === "local" &&
        changes[STORAGE_KEY] &&
        this.toggle.checked
      ) {
        void this.load();
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    window.addEventListener(
      "pagehide",
      () => chrome.storage.onChanged.removeListener(onChange),
      { once: true },
    );
    this.toggle.checked =
      (await chrome.storage.sync.get(ENABLED_KEY))[ENABLED_KEY] === true;
    await this.renderEnabled();
  }

  async setEnabled() {
    this.toggle.disabled = true;
    try {
      await chrome.storage.sync.set({ [ENABLED_KEY]: this.toggle.checked });
      await this.renderEnabled();
    } catch (error) {
      this.toggle.checked = !this.toggle.checked;
      await this.renderEnabled();
      this.feedback.error(
        `Failed to update local video blocking: ${error.message}`,
      );
    } finally {
      this.toggle.disabled = false;
    }
  }

  async renderEnabled() {
    this.panel.hidden = !this.toggle.checked;
    if (this.toggle.checked) await this.load();
    else {
      this.generation++;
      this.list.replaceChildren();
    }
  }

  async load() {
    const generation = ++this.generation;
    this.retry.hidden = true;
    this.status.textContent = "Loading blocked videos…";
    try {
      const response = await this.client.sendMessage({
        action: "blocked-videos-list",
      });
      if (!response?.success)
        throw new Error(response?.error || "Could not load blocked videos");
      if (generation !== this.generation) return;
      const videos = response.videos || [];
      this.list.replaceChildren(
        ...videos.map((video) => this.createRow(video)),
      );
      this.status.textContent = videos.length
        ? `${videos.length.toLocaleString()} blocked ${videos.length === 1 ? "video" : "videos"}`
        : "No blocked videos. Use the X on a YouTube video card to hide it here.";
    } catch (error) {
      if (generation !== this.generation) return;
      this.status.textContent = error.message;
      this.retry.hidden = false;
    }
  }

  createRow({ videoId, title }) {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = title || videoId;
    label.title = title ? `${title} (${videoId})` : videoId;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-secondary";
    button.dataset.unblock = videoId;
    button.textContent = "Unblock";
    button.setAttribute("aria-label", `Unblock ${title || videoId}`);
    row.append(label, button);
    return row;
  }

  async unblock(button) {
    const focusWithin = this.list.contains(document.activeElement);
    const nextButton =
      button.parentElement.nextElementSibling?.querySelector("button") ||
      button.parentElement.previousElementSibling?.querySelector("button");
    const nextId = nextButton?.dataset.unblock;
    button.disabled = true;
    try {
      const response = await this.client.sendMessage({
        action: "blocked-videos-unblock",
        videoId: button.dataset.unblock,
      });
      if (!response?.success)
        throw new Error(response?.error || "Could not unblock video");
      await this.load();
      if (focusWithin) {
        const next = [...this.list.querySelectorAll("button")].find(
          (item) => item.dataset.unblock === nextId,
        );
        (next || this.toggle).focus();
      }
    } catch (error) {
      button.disabled = false;
      this.feedback.error(`Failed to unblock video: ${error.message}`);
    }
  }
}
