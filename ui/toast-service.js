// @ts-check

export class ToastService {
  constructor({
    bootstrap,
    successToastElement,
    errorToastElement,
    successMessageElement,
    errorMessageElement,
    announcerElement = null,
  }) {
    this.successToast = successToastElement
      ? new bootstrap.Toast(successToastElement)
      : null;
    this.errorToast = errorToastElement
      ? new bootstrap.Toast(errorToastElement)
      : null;
    this.successMessageElement = successMessageElement;
    this.errorMessageElement = errorMessageElement;
    this.announcerElement = announcerElement;
  }

  success(message) {
    if (this.successToast && this.successMessageElement) {
      this.successMessageElement.textContent = message;
      this.successToast.show();
    }

    this.announce(message);
  }

  error(message) {
    if (this.errorToast && this.errorMessageElement) {
      this.errorMessageElement.textContent = message;
      this.errorToast.show();
    } else {
      console.error(message);
    }

    this.announce(`Error: ${message}`);
  }

  announce(message) {
    if (!this.announcerElement) {
      return;
    }

    this.announcerElement.textContent = message;
    setTimeout(() => {
      this.announcerElement.textContent = "";
    }, 1000);
  }
}
