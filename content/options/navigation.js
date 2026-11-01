export function initializeNavigation() {
  const sections = {
    history: "Watch history",
    statistics: "Statistics",
    sync: "Sync & data",
    preferences: "Preferences",
  };
  const showSection = () => {
    const section =
      location.hash.slice(1) in sections ? location.hash.slice(1) : "history";
    document.querySelectorAll(".app-panel").forEach((panel) => {
      panel.hidden = panel.id !== `panel-${section}`;
    });
    document.querySelectorAll("[data-section]").forEach((link) => {
      if (link.dataset.section === section)
        link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    document.title = `Watchmarker · ${sections[section]}`;
  };
  showSection();
  window.addEventListener("hashchange", () => {
    showSection();
    document
      .querySelector(".app-panel:not([hidden]) h1")
      ?.setAttribute("tabindex", "-1");
    document.querySelector(".app-panel:not([hidden]) h1")?.focus();
    window.scrollTo({ top: 0 });
  });
}
