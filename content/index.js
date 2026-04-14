import { OptionsPage } from "./options-page.js";

const page = new OptionsPage();

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      void page.initialize();
    },
    { once: true },
  );
} else {
  void page.initialize();
}
