// @ts-check

export function setButtonBusy(button, label = "Loading...") {
  if (!button) {
    return;
  }

  if (!button.dataset.originalContent) {
    button.dataset.originalContent = button.innerHTML;
  }

  const fileInput = button.querySelector("input");
  const preservedInputMarkup = fileInput ? fileInput.outerHTML : "";

  button.innerHTML = `
        <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        <span class="button-text ms-2">${label}</span>
        ${preservedInputMarkup}
    `;

  if (fileInput) {
    button.classList.add("disabled");
  } else {
    button.disabled = true;
  }
}

export function clearButtonBusy(button) {
  if (!button?.dataset.originalContent) {
    return;
  }

  button.innerHTML = button.dataset.originalContent;
  button.classList.remove("disabled");
  button.disabled = false;
  delete button.dataset.originalContent;
}
