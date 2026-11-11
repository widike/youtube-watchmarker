import { logger } from "../shared/logger.js";

const VISUAL_TARGET =
  '.youwatch-mark img, img.youwatch-mark, .youwatch-mark .ytp-videowall-still-image, .youwatch-mark .ytp-modern-videowall-still-image, .youwatch-mark .ytp-ce-covering-image, .youwatch-mark .ytp-ce-covering-overlay[style*="background-image"], .youwatch-mark .ytp-autonav-endscreen-upnext-thumbnail';
const stylesheets = {
  Fadeout: `${VISUAL_TARGET} { opacity: 0.34 !important; }`,
  Grayout: `${VISUAL_TARGET} { filter: grayscale(1) !important; }`,
  Showbadge: `
    .ytp-autonav-endscreen-link-container.youwatch-mark,
    .ytp-modern-videowall-still.youwatch-mark { position:relative; }
    .youwatch-mark::after {
      align-items:center;
      backdrop-filter:blur(8px);
      background:rgb(15 15 15 / 0.82);
      border:1px solid rgb(255 255 255 / 0.08);
      border-radius:999px;
      box-sizing:border-box;
      color:#fff;
      content:"WATCHED" var(--youwatch-count, "") var(--youwatch-date, "");
      display:inline-flex;
      font:500 11px/1.2 Roboto, Arial, sans-serif;
      inset:8px auto auto 8px;
      width:max-content;
      height:auto;
      max-width:calc(100% - 16px);
      letter-spacing:0.02em;
      padding:5px 8px;
      pointer-events:none;
      position:absolute;
      text-transform:uppercase;
      white-space:nowrap;
      z-index:20;
    }
  `,
  Showdate: ".youwatch-mark::after { --youwatch-date:attr(watchdate); }",
  Showcount: ".youwatch-mark::after { --youwatch-count:attr(watchcount); }",
  Hideprogress:
    ".youwatch-mark :is(ytd-thumbnail-overlay-resume-playback-renderer, ytm-thumbnail-overlay-resume-playback-renderer) { display:none !important; }",
  Hidepaidpromotion: `
    .ytp-paid-content-overlay,
    ytm-paid-content-overlay-renderer,
    .YtmPaidContentOverlayHost { display:none !important; }
  `,
};
const defaults = {
  idBlocking_Enabled: false,
  idCondition_Brownav: true,
  idCondition_Browhist: true,
  idCondition_Youprog: true,
  idCondition_Youhist: true,
  idCondition_Yourating: true,
  ...Object.fromEntries(
    Object.entries(stylesheets).flatMap(([name, css]) => [
      [`stylesheet_${name}`, css],
      [`idVisualization_${name}`, true],
    ]),
  ),
};

export class SettingsManager {
  async initialize() {
    if (this.isInitialized) return;
    const existing = await chrome.storage.sync.get(Object.keys(defaults));
    const updates = Object.fromEntries(
      Object.entries(defaults).filter(
        ([key, value]) =>
          existing[key] === undefined ||
          (key.startsWith("stylesheet_") && existing[key] !== value),
      ),
    );
    if (Object.keys(updates).length) await chrome.storage.sync.set(updates);
    this.isInitialized = true;
    logger.info("Settings initialized");
  }

  async getSetting(key) {
    return (await chrome.storage.sync.get(key))[key];
  }

  async setSetting(key, value) {
    await chrome.storage.sync.set({ [key]: value });
  }
}

export const settingsManager = new SettingsManager();
