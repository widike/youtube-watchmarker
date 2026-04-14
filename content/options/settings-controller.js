// @ts-check

const SETTING_LABELS = {
  idCondition_Brownav: "Browser Navigation",
  idCondition_Browhist: "Browser History",
  idCondition_Youprog: "YouTube Progress",
  idCondition_Youbadge: "YouTube Badge",
  idCondition_Youhist: "YouTube History",
  idCondition_Yourating: "Video Rating",
  idVisualization_Fadeout: "Fade Out",
  idVisualization_Grayout: "Grayscale",
  idVisualization_Showbadge: "Show Badge",
  idVisualization_Showdate: "Show Date",
  idVisualization_Hideprogress: "Hide Progress Bar",
  idVisualization_Showpublishdate: "Show Publication Date",
};

const TOGGLE_IDS = Object.keys(SETTING_LABELS);

export class SettingsController {
  constructor({ feedback }) {
    this.feedback = feedback;
  }

  async initialize() {
    await Promise.all(TOGGLE_IDS.map((id) => this.bindToggle(id)));
  }

  async bindToggle(id) {
    const element = document.getElementById(id);
    if (!element) {
      return;
    }

    const result = await chrome.storage.sync.get([id]);
    element.checked = result[id] || false;

    element.addEventListener("change", async () => {
      try {
        await chrome.storage.sync.set({ [id]: element.checked });
        this.feedback.success(
          `${SETTING_LABELS[id]} ${element.checked ? "enabled" : "disabled"}`,
        );
      } catch (error) {
        element.checked = !element.checked;
        this.feedback.error(
          `Failed to update ${SETTING_LABELS[id]}: ${error.message}`,
        );
      }
    });
  }
}
