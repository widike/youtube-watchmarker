import { ProviderController } from "../../extension/content/options/provider-controller.js";
import { createOptionsElements } from "../../extension/content/options/elements.js";
import { SyncController } from "../../extension/content/options/sync-controller.js";

export async function verifySyncStates(fixture, assert) {
  const elements = createOptionsElements();
  const original = fixture.providerStatus;
  let statusError;
  const controller = new ProviderController({
    elements,
    onDataChanged: async () => {},
    client: {
      sendMessage: async () => {
        if (statusError) throw new Error(statusError);
        return { success: true, status: fixture.providerStatus };
      },
    },
  });
  const label = () =>
    elements.syncSummary.querySelector(".sync-state-label").textContent;
  const detail = () =>
    elements.syncSummary.querySelector(".sync-state-detail").textContent;
  try {
    assert(
      elements.connectionCodeHelp.textContent.includes(
        "Create connection code",
      ),
      "Disconnected setup does not explain where to get a code",
    );
    assert(
      elements.createLinkButton.textContent.includes("Create connection code"),
      "Code generation action is ambiguous",
    );
    for (const [status, state, expectedLabel, expectedDetail] of [
      [
        { configured: false },
        "disconnected",
        "Not connected",
        "this device only",
      ],
      [{ configured: true }, "connected", "Cloud connected", "Ready to sync"],
      [
        { configured: true, pending: 12 },
        "syncing",
        "Syncing history…",
        "12 remaining",
      ],
      [
        { configured: true, inProgress: true },
        "syncing",
        "Syncing history…",
        "Cloud connection active",
      ],
      [
        { configured: true, lastSuccess: Date.now() - 86400000 },
        "connected",
        "Cloud connected",
        "Up to date · last synced",
      ],
      [
        { configured: true, error: "Network unavailable" },
        "attention",
        "Sync needs attention",
        "Network unavailable",
      ],
    ]) {
      fixture.providerStatus = status;
      await controller.updateProviderStatus();
      assert(
        elements.syncSummary.dataset.state === state,
        `Wrong state: ${state}`,
      );
      assert(
        label() === expectedLabel,
        `Missing visible label: ${expectedLabel}`,
      );
      assert(
        detail().includes(expectedDetail),
        `Missing detail: ${expectedDetail}`,
      );
      assert(
        elements.connectionCodeHelp.hidden === status.configured &&
          elements.firstDeviceHelp.hidden === status.configured,
        "Setup guidance does not match connection state",
      );
      const styles = getComputedStyle(elements.syncSummary);
      assert(
        parseFloat(styles.borderInlineStartWidth) >= 4,
        "Status is too subtle",
      );
    }
    statusError = "Background service unavailable";
    await controller.updateProviderStatus();
    assert(
      elements.syncSummary.dataset.state === "attention" &&
        label() === "Connection status unavailable" &&
        detail() === statusError,
      "Unavailable status still looks connected",
    );
    statusError = null;
    fixture.providerStatus = { configured: true };
    await controller.updateProviderStatus();
    assert(
      elements.syncSummary.dataset.state === "connected",
      "Error did not clear",
    );
    const sync = new SyncController({
      elements,
      client: { sendMessage: async () => ({ success: true }) },
      onDataChanged: async () => {},
      refreshSearch: async () => {},
      invalidateSources: () => {},
    });
    await sync.syncProviders();
    assert(
      label() === "Cloud connected" && detail().includes("Up to date"),
      "Manual sync removed the connection status structure",
    );
    const calls = [];
    sync.client.sendMessage = async (request) => {
      calls.push(request);
      if (calls.length === 2) {
        assert(
          elements.syncSummary.dataset.state === "syncing",
          "Sync progress is hidden",
        );
        assert(
          request.forceDownload === false,
          "Continuation restarted completed downloads",
        );
      }
      return { success: true, inProgress: calls.length === 1 };
    };
    await sync.syncProviders();
    assert(
      calls.length === 2 && elements.syncSummary.dataset.state === "connected",
      "Manual sync stopped before the restore completed",
    );
    sync.client.sendMessage = async () => ({
      success: false,
      error: "Sync failed",
    });
    await sync.syncProviders();
    assert(
      elements.syncSummary.dataset.state === "attention" &&
        detail() === "Sync failed",
      "Manual sync failure is hidden",
    );
  } finally {
    statusError = null;
    fixture.providerStatus = original;
    await controller.updateProviderStatus();
  }
}
