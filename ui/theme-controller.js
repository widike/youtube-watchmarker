// @ts-check

const THEME_STORAGE_KEY = "theme";

export class ThemeController {
  constructor({ toggleButton, iconElement }) {
    this.toggleButton = toggleButton;
    this.iconElement = iconElement;
    this.systemThemeListener = null;
  }

  async initialize() {
    const savedTheme = await this.readSavedTheme();
    const theme = savedTheme || this.getSystemTheme();

    this.applyTheme(theme);

    if (!savedTheme) {
      this.bindSystemTheme();
    }

    if (this.toggleButton) {
      this.toggleButton.addEventListener("click", () => {
        void this.toggleTheme();
      });
    }
  }

  async toggleTheme() {
    const currentTheme =
      document.documentElement.getAttribute("data-bs-theme") || "light";
    const nextTheme = currentTheme === "dark" ? "light" : "dark";

    this.applyTheme(nextTheme);
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: nextTheme });
  }

  applyTheme(theme) {
    const normalizedTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-bs-theme", normalizedTheme);

    if (this.iconElement) {
      this.iconElement.className =
        normalizedTheme === "dark" ? "fas fa-moon" : "fas fa-sun";
    }
  }

  async readSavedTheme() {
    try {
      const result = await chrome.storage.local.get([THEME_STORAGE_KEY]);
      return result[THEME_STORAGE_KEY] || null;
    } catch (_error) {
      return null;
    }
  }

  getSystemTheme() {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  bindSystemTheme() {
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mediaQuery) {
      return;
    }

    this.systemThemeListener = (event) =>
      this.applyTheme(event.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", this.systemThemeListener);
  }
}
