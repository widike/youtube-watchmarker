// Errors stay visible until dismissed. Routine feedback lives in the page.
export class ToastService {
  constructor({ errorToastElement, errorMessageElement, statusElement }) {
    this.errorElement = errorToastElement;
    this.errorMessageElement = errorMessageElement;
    this.statusElement = statusElement;
    this.errorElement
      ?.querySelector("[data-dismiss-error]")
      ?.addEventListener("click", () => {
        this.errorElement.hidden = true;
      });
  }

  success(message) {
    if (this.statusElement) this.statusElement.textContent = message;
  }

  error(message) {
    if (this.errorElement && this.errorMessageElement) {
      this.errorMessageElement.textContent = message;
      this.errorElement.hidden = false;
    } else {
      console.error(message);
    }
  }
}
