// Preserve nodes and listeners, especially the import file input.
const busyButtons = new WeakMap();

export function setButtonBusy(button, label = "Loading…") {
  if (!button || busyButtons.has(button)) return;
  const input = button.querySelector("input");
  busyButtons.set(button, {
    nodes: [...button.childNodes],
    disabled: button.disabled,
    input,
    inputDisabled: input?.disabled,
  });
  const spinner = document.createElement("span");
  spinner.className = "busy-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = label;
  button.replaceChildren(spinner, text, ...(input ? [input] : []));
  button.setAttribute("aria-busy", "true");
  if (input) input.disabled = true;
  else button.disabled = true;
}

export function clearButtonBusy(button) {
  const state = button && busyButtons.get(button);
  if (!state) return;
  button.replaceChildren(...state.nodes);
  button.removeAttribute("aria-busy");
  if (state.input) state.input.disabled = state.inputDisabled;
  else button.disabled = state.disabled;
  busyButtons.delete(button);
}
