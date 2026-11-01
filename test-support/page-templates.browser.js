// Check rendered consistency, including nested CSS imports, in real Chrome.
export async function verifyPageTemplates(assert) {
  const panels = [...document.querySelectorAll(".app-panel")];
  const original = panels.map((panel) => panel.hidden);
  const scroll = { left: scrollX, top: scrollY };
  window.scrollTo(0, 0);
  const snapshot = (element, properties) => {
    const style = getComputedStyle(element);
    return properties.map((property) => style[property]).join("|");
  };
  const headings = [];
  const positions = [];
  const cards = [];
  try {
    for (const panel of panels) {
      panels.forEach((item) => (item.hidden = item !== panel));
      const heading = panel.querySelector("h1");
      assert(
        heading.getBoundingClientRect().height > 0,
        "Page title is hidden",
      );
      headings.push(
        snapshot(heading, [
          "fontSize",
          "lineHeight",
          "fontWeight",
          "letterSpacing",
        ]),
      );
      const { x, y } = heading.getBoundingClientRect();
      positions.push(`${x}|${y}`);
      for (const card of panel.querySelectorAll(".settings-card, .stats-card"))
        cards.push(
          snapshot(card, [
            "padding",
            "borderRadius",
            "borderWidth",
            "backgroundColor",
          ]),
        );
      assert(
        document.documentElement.scrollWidth <= innerWidth,
        `${panel.id} overflows the viewport`,
      );
    }
    assert(
      headings.every((value) => value === headings[0]),
      "Page title typography differs between sections",
    );
    assert(
      positions.every((value) => value === positions[0]),
      "Page titles shift when switching sections",
    );
    assert(
      cards.length > 1 && cards.every((value) => value === cards[0]),
      "Settings cards use different surface styles",
    );
    const input = getComputedStyle(document.querySelector(".text-input"));
    const button = getComputedStyle(document.querySelector(".primary-button"));
    assert(
      input.minBlockSize === button.minBlockSize,
      "Inputs and action buttons use different control heights",
    );
    assert(
      button.display.includes("flex"),
      "Shared control styles did not load",
    );
  } finally {
    panels.forEach((panel, index) => (panel.hidden = original[index]));
    window.scrollTo(scroll);
  }
}
