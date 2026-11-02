import { wordCloud } from "../../extension/ui/statistics-word-cloud.js";

export async function verifyWordCloud({ $, assert, waitFor, ready, contrast }) {
  await waitFor(() => $(".stats-word-cloud button") && ready());
  const root = $("#panel-statistics");
  const card = $(".stats-word-card");
  assert(
    card.getBoundingClientRect().bottom -
      card.lastElementChild.getBoundingClientRect().bottom <
      32,
    "Word card stretched beyond its content",
  );
  if (!matchMedia("(forced-colors: active)").matches) {
    const style = getComputedStyle($(".stats-word-cloud button"));
    assert(
      contrast(style.color, getComputedStyle(card).backgroundColor) >= 4.5,
      "Small cloud words have insufficient contrast",
    );
  }

  // Exercise long words, highly skewed counts, and 40 terms at 280px.
  const sample = document.createElement("section");
  sample.className = "stats-card stats-word-card";
  sample.style.width = "280px";
  sample.innerHTML = wordCloud({
    words: Array.from({ length: 40 }, (_, index) => ({
      word: index === 0 ? "Donaudampfschifffahrtskapitän" : `topic${index}`,
      count: index === 0 ? 10000 : 41 - index,
    })),
  });
  root.append(sample);
  try {
    const list = sample.querySelector("ol");
    assert(list.scrollWidth <= list.clientWidth, `Cloud overflows at 280px`);
    const buttons = [...list.querySelectorAll("button")];
    assert(buttons.length === 40, `Cloud silently dropped words`);
    for (const button of buttons) {
      assert(
        parseFloat(getComputedStyle(button).fontSize) >= 14,
        `Cloud shrunk a word below the readable floor`,
      );
      const bounds = button.getBoundingClientRect();
      const container = list.getBoundingClientRect();
      assert(
        bounds.left >= container.left && bounds.right <= container.right,
        `Cloud clipped a long word`,
      );
    }
    for (let i = 0; i < buttons.length; i++) {
      const a = buttons[i].getBoundingClientRect();
      for (const next of buttons.slice(i + 1)) {
        const b = next.getBoundingClientRect();
        assert(
          a.right <= b.left ||
            a.left >= b.right ||
            a.bottom <= b.top ||
            a.top >= b.bottom,
          `Cloud overlaps word targets`,
        );
      }
    }
  } finally {
    sample.remove();
  }
}
