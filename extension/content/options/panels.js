// Keep settings markup separate from the history shell. Only bundled files load.
export async function loadSettingsPanels() {
  await Promise.all(
    [...document.querySelectorAll("[data-settings-panel]")].map(
      async (placeholder) => {
        const name = placeholder.dataset.settingsPanel;
        if (!["sync", "preferences", "statistics"].includes(name)) return;
        const response = await fetch(
          new URL(`./${name}.html`, import.meta.url),
        );
        if (!response.ok) throw new Error(`Could not load ${name} settings`);
        placeholder.outerHTML = await response.text();
      },
    ),
  );
}
