// Keep settings markup separate from the history shell. Only bundled files load.
async function loadFragments(attribute, allowed) {
  await Promise.all(
    [...document.querySelectorAll(`[${attribute}]`)].map(
      async (placeholder) => {
        const name = placeholder.getAttribute(attribute);
        if (!allowed.includes(name)) return;
        const response = await fetch(
          new URL(`./${name}.html`, import.meta.url),
        );
        if (!response.ok) throw new Error(`Could not load ${name} settings`);
        placeholder.outerHTML = await response.text();
      },
    ),
  );
}

export async function loadSettingsPanels() {
  await loadFragments("data-settings-panel", [
    "sync",
    "preferences",
    "statistics",
  ]);
  await loadFragments("data-settings-fragment", ["reconciliation"]);
}
