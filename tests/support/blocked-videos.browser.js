import { MessageRouter } from "../../extension/background/message-router.js";
import {
  BLOCKED_VIDEOS_KEY,
  BlockedVideoStore,
  notifyBlockedVideosChanged,
} from "../../extension/background/blocked-videos.js";
import {
  handleBlockedVideosList,
  handleBlockVideo,
  handleUnblockVideo,
} from "../../extension/handlers/blocked-video-handlers.js";
import { BlockedVideosController } from "../../extension/content/options/blocked-videos-controller.js";

const checks = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  checks.push(message);
};
const waitFor = async (condition) => {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Blocking update timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const errors = [];
window.addEventListener("error", (event) => errors.push(event.message));
window.addEventListener("unhandledrejection", (event) =>
  errors.push(String(event.reason)),
);

try {
  const storageListeners = new Set();
  const values = { local: {}, sync: {} };
  let failWrites = false;
  const storage = (area) => ({
    get: async () => structuredClone(values[area]),
    set: async (updates) => {
      if (area === "local" && failWrites)
        throw new Error("Storage unavailable");
      Object.assign(values[area], structuredClone(updates));
      const changes = Object.fromEntries(
        Object.entries(updates).map(([key, newValue]) => [key, { newValue }]),
      );
      for (const listener of storageListeners) listener(changes, area);
    },
  });
  const id = "abcdefghijklmnopabcdefghijklmnop";
  const extension = { id, url: `chrome-extension://${id}/content/index.html` };
  const content = { id, url: "https://www.youtube.com/" };
  const requests = [];
  const router = new MessageRouter();
  const send = async (message, sender) => {
    requests.push(message);
    return router.handle(message, sender);
  };
  let manager;
  let notifications = 0;
  globalThis.chrome = {
    runtime: {
      id,
      getURL: (path) => `chrome-extension://${id}/${path.replace(/^\//, "")}`,
      sendMessage: (message) => send(message, content),
    },
    storage: {
      local: storage("local"),
      sync: storage("sync"),
      onChanged: {
        addListener: (fn) => storageListeners.add(fn),
        removeListener: (fn) => storageListeners.delete(fn),
      },
    },
    tabs: {
      query: async () => [{ id: 1 }, { id: 2 }],
      sendMessage: async (_id, message) => {
        notifications++;
        if (message.action === "youtube-blocklist-changed") {
          await manager.load();
          await manager.processVideos();
        }
      },
    },
  };
  router.registerMultiple({
    "blocked-videos-list": handleBlockedVideosList,
    "blocked-videos-block": handleBlockVideo,
    "blocked-videos-unblock": handleUnblockVideo,
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[BLOCKED_VIDEOS_KEY])
      void notifyBlockedVideosChanged();
  });
  await import("../../extension/shared/video-identity.js");
  await import("../../extension/youtube/core.js");
  await import("../../extension/youtube/settings-runtime.js");
  await import("../../extension/youtube/blocked-videos.js");
  const wm = globalThis.YouTubeWatchmarkerContent;
  const settings = new wm.ContentSettingsStore();
  await settings.load();
  manager = new wm.BlockedVideoManager(settings, new wm.BackgroundClient());
  await manager.load();
  settings.onChange(() => void manager.processVideos());

  const card = (tag, videoId, title) =>
    `<${tag}><a class="thumb" href="/watch?v=${videoId}"><img alt=""></a><h3><a href="/watch?v=${videoId}">${title}</a></h3></${tag}>`;
  document.body.innerHTML = `<style>
    ytd-rich-item-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer { display:block; width:280px; min-height:160px; }
    .thumb { display:block; height:100px; background:#555; }
    .ytsum-btn { position:absolute; right:8px; bottom:8px; width:32px; height:32px; border:0; border-radius:50%; background:purple; }
  </style><main id="cards">
    <ytd-rich-item-renderer>${card("yt-lockup-view-model", "aaaaaaaaaaa", "They did it…")}</ytd-rich-item-renderer>
    ${card("ytd-video-renderer", "aaaaaaaaaaa", "Duplicate")}
    ${card("ytd-compact-video-renderer", "bbbbbbbbbbb", "Other video")}
    <div id="video-preview">${card("yt-lockup-view-model", "ccccccccccc", "Preview")}</div>
  </main><div id="preferences"></div>`;
  const preferences = document.getElementById("preferences");
  preferences.innerHTML = await fetch(
    "/extension/content/options/preferences.html",
  ).then((res) => res.text());
  preferences.firstElementChild.hidden = false;
  const controller = new BlockedVideosController({
    feedback: { error: (message) => errors.push(message) },
    client: { sendMessage: (message) => send(message, extension) },
  });
  await controller.initialize();
  await manager.processVideos();
  assert(
    !document.querySelector(".youwatch-block-button") &&
      controller.panel.hidden,
    "Blocking defaults off and the list is hidden",
  );
  controller.toggle.click();
  await waitFor(
    () =>
      document.querySelectorAll(".youwatch-block-button").length === 3 &&
      !controller.panel.hidden,
  );
  assert(
    !document.querySelector("#video-preview .youwatch-block-button"),
    "Hover previews do not get duplicate buttons",
  );
  assert(
    controller.status.textContent.includes("No blocked videos"),
    "Enabled settings show an empty-list message",
  );

  const host = document.querySelector("yt-lockup-view-model");
  const button = host.querySelector(".youwatch-block-button");
  assert(
    getComputedStyle(button).right === "8px",
    "The X works without the summary extension",
  );
  const summary = document.createElement("button");
  summary.className = "ytsum-btn";
  host.append(summary);
  assert(
    getComputedStyle(button).right === "48px",
    "Late summary buttons move the X to their left",
  );
  const x = button.getBoundingClientRect();
  const purple = summary.getBoundingClientRect();
  assert(
    x.right < purple.left && x.bottom === purple.bottom,
    "The X and summary button align without overlap",
  );
  button.focus();
  assert(
    getComputedStyle(button).opacity === "1",
    "Keyboard focus reveals the hide button",
  );
  let propagated = 0;
  host.addEventListener("click", () => propagated++);
  for (const type of [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "dblclick",
  ])
    assert(
      !button.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true }),
      ),
      `${type} is cancelled locally`,
    );
  button.click();
  await waitFor(
    () =>
      document.querySelectorAll(".youwatch-blocked").length === 2 &&
      controller.list.children.length === 1,
  );
  assert(
    propagated === 0,
    "Clicking X does not activate YouTube card handlers",
  );
  assert(
    getComputedStyle(host.parentElement).display === "none",
    "Blocking collapses the whole feed item",
  );
  assert(
    getComputedStyle(document.querySelector("ytd-video-renderer")).display ===
      "none",
    "All duplicate thumbnails disappear",
  );
  assert(
    !document
      .querySelector("ytd-compact-video-renderer")
      .classList.contains("youwatch-blocked"),
    "Other videos stay visible",
  );
  assert(
    controller.list.textContent.includes("They did it…"),
    "Settings retain the blocked video's title",
  );
  assert(
    (await new BlockedVideoStore().list()).length === 1,
    "Blocks survive a new storage instance",
  );
  assert(notifications >= 2, "Block changes notify all open YouTube tabs");
  assert(
    requests.every((request) => request.action.startsWith("blocked-videos-")),
    "Blocking never reports a watch or sends YouTube feedback",
  );

  const link = host.querySelector("a.thumb");
  link.href = "/watch?v=ddddddddddd";
  await manager.processVideos();
  assert(
    !host.parentElement.classList.contains("youwatch-blocked"),
    "Recycled cards become visible for a different video",
  );
  link.href = "/watch?v=aaaaaaaaaaa";
  await manager.processVideos();
  controller.toggle.click();
  await waitFor(() => !document.querySelector(".youwatch-block-button"));
  assert(
    !document.querySelector(".youwatch-blocked") &&
      (await new BlockedVideoStore().list()).length === 1,
    "Disabling restores cards and preserves the block list",
  );
  controller.toggle.click();
  await waitFor(
    () =>
      document.querySelector(".youwatch-blocked") &&
      controller.list.querySelector("button"),
  );
  const unblock = controller.list.querySelector("button");
  unblock.focus();
  unblock.click();
  await waitFor(
    () =>
      !document.querySelector(".youwatch-blocked") &&
      !controller.list.children.length,
  );
  assert(
    (await new BlockedVideoStore().list()).length === 0,
    "Unblocking removes the persisted block and restores open cards",
  );
  await waitFor(() => document.activeElement === controller.toggle);

  const malicious = '<img src=x onerror="alert(1)"> Grüße 😀';
  await send(
    {
      action: "blocked-videos-block",
      videoId: "bbbbbbbbbbb",
      title: malicious,
    },
    content,
  );
  await waitFor(() => controller.list.textContent.includes(malicious));
  assert(
    !controller.list.querySelector("img"),
    "Blocked titles are rendered as text, including umlauts and markup",
  );
  const newCard = document.createElement("div");
  newCard.innerHTML = card(
    "ytd-grid-video-renderer",
    "bbbbbbbbbbb",
    "New card",
  );
  document.getElementById("cards").append(newCard);
  await manager.processVideos();
  assert(
    newCard.querySelector(".youwatch-blocked"),
    "Newly inserted cards respect saved blocks",
  );
  newCard.querySelector("a.thumb").href = "/@channel";
  await manager.processVideos();
  assert(
    !newCard.querySelector(".youwatch-blocked, .youwatch-block-button"),
    "Recycling a card into a non-video clears blocking controls",
  );

  failWrites = true;
  const other = document.querySelector("ytd-video-renderer");
  other.querySelector(".youwatch-block-button").click();
  await waitFor(() => !other.querySelector("button").disabled);
  assert(
    !other.classList.contains("youwatch-blocked") &&
      other.querySelector("button").title.includes("Try again"),
    "Storage failures leave the video visible and allow retry",
  );
  failWrites = false;
  other.querySelector("button").click();
  await waitFor(() => other.classList.contains("youwatch-blocked"));
  history.pushState({}, "", "/feed/history");
  await manager.processVideos();
  assert(
    !document.querySelector(".youwatch-blocked, .youwatch-block-button"),
    "YouTube watch history remains visible and free of hide controls",
  );
  assert(errors.length === 0, `No browser errors: ${errors.join(", ")}`);
  await fetch("/results", { method: "POST", body: JSON.stringify({ checks }) });
} catch (error) {
  await fetch("/results", {
    method: "POST",
    body: JSON.stringify({ checks, error: error.stack }),
  });
}
