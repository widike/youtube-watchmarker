export function verifyPopupHistory(popup, assert) {
  const cards = [...popup.querySelectorAll(".video-item")];
  const first = cards[0];
  const date = first.querySelector(".video-watch-date");
  assert(date?.dateTime, "Popup lacks the time the video was watched");
  assert(
    date.querySelector(".fa-clock"),
    "Watch timestamp lacks its clock icon",
  );
  assert(
    first.querySelector(".video-duration").textContent.includes("10:00"),
    "Popup lacks video duration",
  );
  assert(
    getComputedStyle(first.querySelector(".video-duration > i")).display ===
      "none",
    "Duration badge still shows the metadata icon",
  );
  const measured = first.querySelector(".video-watched-time");
  assert(
    measured.textContent.includes("2:00"),
    "Popup lacks measured viewing time",
  );
  assert(
    measured.querySelector(".fa-play"),
    "Viewing time cannot be distinguished from the watch timestamp",
  );
  assert(
    first.querySelector(".video-percentage").textContent.includes("50%"),
    "Popup lacks accessible percentage watched",
  );
  const percentage = first.querySelector(".video-percentage");
  assert(
    getComputedStyle(percentage).clipPath === "inset(50%)",
    "Popup still shows a numeric percentage",
  );
  assert(
    first.querySelector(".video-progress > span").style.width === "50%",
    "Popup progress bar does not match the percentage",
  );
  for (const card of cards.slice(0, 2)) {
    const thumbnail = card
      .querySelector(".video-thumbnail")
      .getBoundingClientRect();
    const badge = card.querySelector(".video-duration").getBoundingClientRect();
    const progress = card
      .querySelector(".video-progress")
      .getBoundingClientRect();
    assert(
      badge.left >= thumbnail.left &&
        badge.right <= thumbnail.right &&
        badge.top >= thumbnail.top &&
        badge.bottom <= thumbnail.bottom,
      "Duration badge is outside the thumbnail",
    );
    assert(
      Math.abs(progress.left - thumbnail.left) <= 1 &&
        Math.abs(progress.right - thumbnail.right) <= 1 &&
        Math.abs(progress.bottom - thumbnail.bottom) <= 1,
      "Progress line does not follow the thumbnail's bottom edge",
    );
  }
  assert(
    !cards[2].querySelector(
      ".video-duration, .video-watched-time, .video-percentage, .video-progress",
    ),
    "An imported watch invents missing playback statistics",
  );
  for (const card of cards.slice(0, 2)) {
    const copy = card.querySelector(".video-copy").getBoundingClientRect();
    const button = card.querySelector(".video-delete").getBoundingClientRect();
    assert(
      copy.right <= button.left,
      "Delete button overlaps the video details",
    );
    const title = card.querySelector(".video-title").getBoundingClientRect();
    const meta = card.querySelector(".video-meta").getBoundingClientRect();
    assert(meta.top >= title.bottom, "Video statistics overlap the title");
    for (const metric of card.querySelector(".video-meta").children) {
      if (metric.matches(".video-duration, .video-percentage")) continue;
      const rect = metric.getBoundingClientRect();
      assert(
        rect.left >= copy.left && rect.right <= copy.right + 1,
        "A video statistic is clipped at popup width",
      );
    }
  }
  assert(
    popup.getBoundingClientRect().top >=
      document.querySelector(".search-box").getBoundingClientRect().bottom,
    "Popup history overlaps the search control",
  );
  return first.querySelector(".video-meta").innerHTML;
}
