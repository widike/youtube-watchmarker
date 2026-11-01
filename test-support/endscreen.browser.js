globalThis.verifyEndscreen = async (settings, fullscreen) => {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const waitFor = async (condition) => {
    const deadline = Date.now() + 3000;
    while (!condition()) {
      if (Date.now() > deadline)
        throw new Error("End-screen refresh timed out");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  document.head.innerHTML = `<style>
    #movie_player { position:relative; width:960px; height:600px; background:#111; }
    .tile { position:absolute; width:300px; height:160px; }
    .ytp-ce-covering-image, .ytp-ce-covering-overlay,
    .ytp-videowall-still-image, .ytp-autonav-endscreen-upnext-thumbnail {
      position:absolute; inset:0; background-image:linear-gradient(red, blue);
    }
    .ytp-ce-covering-overlay { background-image:none; z-index:12; }
    .ytp-autonav-endscreen-link-container { display:flex; position:static; }
    .ytp-videowall-still::after { content:""; position:absolute; inset:0; }
    ytd-thumbnail-overlay-resume-playback-renderer { display:block; height:4px; background:red; }
  </style>`;
  document.body.innerHTML = `<div id="movie_player">
    <div id="creator" class="tile ytp-ce-element ytp-ce-video">
      <div class="ytp-ce-covering-image"></div>
      <a class="ytp-ce-covering-overlay" href="https://youtu.be/aaaaaaaaaaa"></a>
    </div>
    <a id="wall" class="tile ytp-videowall-still" style="left:320px"
       href="https://www.youtube.com/watch?list=next&v=aaaaaaaaaaa">
      <div class="ytp-videowall-still-image"></div>
      <ytd-thumbnail-overlay-resume-playback-renderer></ytd-thumbnail-overlay-resume-playback-renderer>
    </a>
    <div class="tile ytp-autonav-endscreen-upnext-container" style="top:180px">
      <a id="upnext" class="ytp-autonav-endscreen-link-container"
         style="width:300px;height:160px" href="https://www.youtube.com/watch?v=aaaaaaaaaaa">
        <div class="ytp-autonav-endscreen-upnext-thumbnail"></div>
      </a>
    </div>
    <a id="unwatched" class="tile ytp-videowall-still" style="left:320px;top:180px"
       href="https://www.youtube.com/watch?v=bbbbbbbbbbb">
      <div class="ytp-videowall-still-image"></div>
      <ytd-thumbnail-overlay-resume-playback-renderer></ytd-thumbnail-overlay-resume-playback-renderer>
    </a>
    <div id="overlay-image" class="tile ytp-ce-video" style="top:360px">
      <a class="ytp-ce-covering-overlay" href="https://www.youtube.com/shorts/aaaaaaaaaaa"
         style="background-image:linear-gradient(red,blue)"></a>
    </div>
    <a id="channel" class="ytp-ce-covering-overlay"
       href="https://www.youtube.com/@channel"></a>
  </div>`;
  const player = document.getElementById("movie_player");
  if (fullscreen) await player.requestFullscreen();
  assert(
    Boolean(document.fullscreenElement) === fullscreen,
    "Player fullscreen state is incorrect",
  );
  const stored = { ...settings };
  globalThis.chrome = {
    runtime: { id: "watchmarker-fixture" },
    storage: { sync: { get: async () => ({ ...stored }) } },
  };
  const {
    core,
    ContentSettingsStore,
    ContentStyleManager,
    VideoMarkerManager,
  } = globalThis.YouTubeWatchmarkerContent;
  const store = new ContentSettingsStore();
  await store.load();
  const styles = new ContentStyleManager(store);
  await styles.render();
  const marker = new VideoMarkerManager({
    send: async ({ videoId }) => ({
      success: true,
      strIdent: videoId === "aaaaaaaaaaa" ? videoId : null,
      intTimestamp: new Date(2026, 9, 31).getTime(),
      intCount: 4,
    }),
  });
  await marker.processVideos(core.findVideos());
  const tile = (id) => document.getElementById(id);
  const image = (id) => tile(id).firstElementChild;
  const badge = (id) => getComputedStyle(tile(id), "::after");
  const watched = ["creator", "wall", "upnext", "overlay-image"];
  for (const id of watched) {
    assert(
      tile(id).classList.contains("youwatch-mark"),
      `${id} was not marked`,
    );
    assert(player.contains(tile(id)), `${id} escaped the fullscreen player`);
    assert(
      getComputedStyle(image(id)).opacity === "0.34",
      `${id} did not fade`,
    );
    assert(
      getComputedStyle(image(id)).filter === "grayscale(1)",
      `${id} did not turn grayscale`,
    );
    assert(badge(id).content.includes("WATCHED"), `${id} has no watched badge`);
    assert(badge(id).content.includes("2026"), `${id} has no watch date`);
    assert(badge(id).pointerEvents === "none", `${id} badge blocks clicks`);
    assert(
      Number(badge(id).zIndex) > 12,
      `${id} badge is behind the player overlay`,
    );
    assert(
      parseFloat(badge(id).height) < tile(id).clientHeight / 2,
      `${id} badge fills the tile`,
    );
    const bounds = tile(id).getBoundingClientRect();
    if (id === "upnext") {
      assert(
        getComputedStyle(tile(id)).position === "relative",
        "Up-next badge has no positioning context",
      );
      assert(badge(id).top === "8px", "Up-next badge escaped its tile");
    }
    const hit = document.elementFromPoint(bounds.left + 12, bounds.top + 12);
    assert(
      hit.closest("a[href]"),
      `${id} recommendation link is not clickable`,
    );
  }
  assert(
    !image("creator").classList.contains("youwatch-mark"),
    "Creator image was marked instead of its card",
  );
  assert(
    !tile("channel").classList.contains("youwatch-mark"),
    "Channel marked",
  );
  assert(
    !tile("unwatched").classList.contains("youwatch-mark"),
    "Unwatched marked",
  );
  assert(
    getComputedStyle(image("unwatched")).opacity === "1",
    "Unwatched faded",
  );
  assert(
    getComputedStyle(tile("wall").lastElementChild).display === "none",
    "Watched progress remains visible",
  );
  assert(
    getComputedStyle(tile("unwatched").lastElementChild).display !== "none",
    "Unwatched progress was hidden",
  );

  store.cache.idVisualization_Fadeout = false;
  await styles.render();
  assert(
    getComputedStyle(image("creator")).opacity === "1",
    "Fade toggle failed",
  );
  assert(
    getComputedStyle(image("creator")).filter === "grayscale(1)",
    "Fade toggle disabled grayscale",
  );
  store.cache.idVisualization_Showdate = false;
  await styles.render();
  assert(!badge("creator").content.includes("2026"), "Date toggle failed");
  assert(badge("creator").content.includes("WATCHED"), "Date toggle hid badge");
  store.cache.idVisualization_Showbadge = false;
  store.cache.idVisualization_Showdate = true;
  store.cache.idVisualization_Grayout = false;
  store.cache.idVisualization_Hideprogress = false;
  await styles.render();
  assert(
    ["none", "normal"].includes(badge("creator").content),
    "Badge toggle failed",
  );
  assert(
    getComputedStyle(image("creator")).filter === "none",
    "Grayscale toggle failed",
  );
  assert(
    getComputedStyle(tile("wall").lastElementChild).display !== "none",
    "Progress toggle failed",
  );

  const observer = new globalThis.YouTubeWatchmarkerContent.PageObserverManager(
    () => void marker.processVideos(core.findVideos()),
  );
  observer.initialize();
  const dynamic = tile("wall").cloneNode(true);
  dynamic.id = "dynamic";
  dynamic.classList.remove("youwatch-mark");
  player.append(dynamic);
  await waitFor(() => dynamic.classList.contains("youwatch-mark"));
  const creatorLink = tile("creator").querySelector("a");
  creatorLink.href = "https://www.youtube.com/watch?v=bbbbbbbbbbb";
  await waitFor(() => !tile("creator").classList.contains("youwatch-mark"));
  assert(!tile("creator").hasAttribute("watchdate"), "Recycled card kept date");
  assert(
    !tile("creator").hasAttribute("watchcount"),
    "Recycled card kept count",
  );
  creatorLink.href = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
  await waitFor(() => tile("creator").classList.contains("youwatch-mark"));
  creatorLink.href = "https://www.youtube.com/@channel";
  await waitFor(() => !tile("creator").classList.contains("youwatch-mark"));
  return { fullscreen, tiles: watched.length, dynamic: true, recycled: true };
};
