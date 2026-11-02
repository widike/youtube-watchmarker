// @ts-check

const THEME_STORAGE_KEY = "theme";
const THEMES = ["system", "light", "dark"];
const THEME_ICONS = {
  system: "fas fa-desktop",
  light: "fas fa-sun",
  dark: "fas fa-moon",
};

export class ThemeController {
  constructor({ toggleButton, iconElement }) {
    this.toggleButton = toggleButton;
    this.iconElement = iconElement;
    this.theme = "system";
    this.systemThemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
  }

  async initialize() {
    this.theme = await this.readSavedTheme();
    this.bindSystemTheme();
    this.applyTheme();

    if (this.toggleButton) {
      this.toggleButton.addEventListener("click", () => {
        void this.toggleTheme();
      });
    }
  }

  async toggleTheme() {
    const nextTheme = THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length];

    this.theme = nextTheme;
    this.applyTheme();
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: nextTheme });
  }

  applyTheme() {
    const resolvedTheme =
      this.theme === "system" ? this.getSystemTheme() : this.theme;
    document.documentElement.setAttribute("data-theme", resolvedTheme);

    if (this.iconElement) {
      this.iconElement.className = THEME_ICONS[this.theme];
    }

    if (this.toggleButton) {
      const currentLabel = this.theme === "system" ? "System" : resolvedTheme;
      const nextTheme =
        THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length];
      const label = `Theme: ${currentLabel}. Switch to ${nextTheme} theme`;
      this.toggleButton.setAttribute("aria-label", label);
      this.toggleButton.title = label;
    }
  }

  async readSavedTheme() {
    try {
      const result = await chrome.storage.local.get([THEME_STORAGE_KEY]);
      const theme = result[THEME_STORAGE_KEY];
      return THEMES.includes(theme) ? theme : "system";
    } catch (_error) {
      return "system";
    }
  }

  getSystemTheme() {
    return this.systemThemeQuery?.matches ? "dark" : "light";
  }

  bindSystemTheme() {
    this.systemThemeQuery?.addEventListener("change", () => {
      if (this.theme === "system") {
        this.applyTheme();
      }
    });
  }
}
