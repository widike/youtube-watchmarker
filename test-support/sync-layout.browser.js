const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

export async function verifyDisclosureLayout(toggle, anchors) {
  toggle.focus({ preventScroll: true });
  const before = anchors.map((node) => node.getBoundingClientRect());
  const scroll = window.scrollY;
  for (const state of ["opened", "closed"]) {
    toggle.click();
    await settle();
    if (document.activeElement !== toggle)
      throw new Error(`Setup stole focus when ${state}`);
    if (Math.abs(window.scrollY - scroll) > 1)
      throw new Error(`Setup scrolled the page when ${state}`);
    anchors.forEach((node, index) => {
      const after = node.getBoundingClientRect();
      for (const edge of ["x", "y", "width", "height"]) {
        if (Math.abs(after[edge] - before[index][edge]) > 1)
          throw new Error(`${node.id} changed ${edge} when setup ${state}`);
      }
    });
  }
}
