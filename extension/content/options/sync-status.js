const ICONS = {
  checking: "clock",
  disconnected: "plug",
  connected: "check-circle",
  syncing: "arrows-rotate",
  attention: "exclamation-triangle",
};

export function showSyncStatus(summary, { state, label, detail }) {
  summary.dataset.state = state;
  summary.querySelector(".sync-state-icon").className =
    `fas fa-${ICONS[state]} sync-state-icon`;
  summary.querySelector(".sync-state-label").textContent = label;
  summary.querySelector(".sync-state-detail").textContent = detail;
}

export function renderSyncStatus(summary, status) {
  let state = "disconnected";
  let label = "Not connected";
  let detail = "History is saved on this device only.";
  if (status.error) {
    state = "attention";
    label = "Sync needs attention";
    detail = status.error;
  } else if (status.configured) {
    state = "connected";
    label = "Cloud connected";
    detail = "Ready to sync";
    if (status.pending || status.inProgress) {
      state = "syncing";
      label = "Syncing history…";
      const pending = Number(status.pending) || 0;
      detail = pending
        ? `${pending.toLocaleString()} remaining`
        : "Cloud connection active";
    } else if (status.lastSuccess) {
      detail = `Up to date · last synced ${new Date(status.lastSuccess).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    }
  }
  showSyncStatus(summary, { state, label, detail });
}
