export function bindStatisticsTooltips(root) {
  root.querySelectorAll("[data-stats-tooltip-region]").forEach((region) => {
    const tooltip = region.querySelector(".stats-tooltip");
    const selector = "[data-stats-tooltip]";
    let anchor;

    const hide = () => {
      anchor = null;
      tooltip.hidden = true;
    };
    const show = (target) => {
      const area = region.getBoundingClientRect();
      const cell = target.getBoundingClientRect();
      if (cell.right <= area.left || cell.left >= area.right) {
        hide();
        return;
      }
      anchor = target;
      tooltip.textContent =
        target.getAttribute("data-stats-tooltip") ||
        target.getAttribute("aria-label");
      tooltip.hidden = false;
      const width = tooltip.offsetWidth;
      const centered = (cell.left + cell.right - width) / 2 - area.left;
      tooltip.style.left = `${Math.max(0, Math.min(centered, area.width - width))}px`;
      tooltip.style.bottom = `${area.bottom - cell.top + 6}px`;
    };

    for (const event of ["pointerover", "focusin"]) {
      region.addEventListener(event, ({ target }) => {
        const item = target.closest(selector);
        if (item) show(item);
      });
    }
    for (const event of ["pointerout", "focusout"]) {
      region.addEventListener(event, ({ target }) => {
        if (target === anchor) hide();
      });
    }
    region.addEventListener("keydown", ({ key }) => {
      if (key === "Escape") hide();
    });
    region.addEventListener(
      "scroll",
      () => {
        if (anchor) show(anchor);
      },
      true,
    );
  });
}
