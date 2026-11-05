// @ts-check

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element;
}

export function createHistoryElements() {
  return {
    themeToggle: requireElement("theme-toggle"),
    themeIcon: requireElement("theme-icon"),
    databaseSize: requireElement("idDatabase_Size"),
    searchInput: requireElement("idSearch_Query"),
    searchButton: requireElement("idSearch_Lookup"),
    searchResults: requireElement("idSearch_Results"),
    searchIcon: requireElement("search-icon"),
    searchSpinner: requireElement("search-spinner"),
    errorToast: requireElement("errorToast"),
    errorToastMessage: requireElement("errorToastMessage"),
    screenReaderAnnouncements: requireElement("sr-announcements"),
  };
}

export function createOptionsElements() {
  return {
    ...createHistoryElements(),
    syncSummary: requireElement("sync-summary"),
    syncSetup: requireElement("sync-setup"),
    syncConnected: requireElement("sync-connected"),
    connectDeviceForm: requireElement("connect-device-form"),
    connectDeviceButton: requireElement("connect-device"),
    projectSetup: requireElement("project-settings"),
    projectSetupForm: requireElement("project-setup-form"),
    startSyncButton: requireElement("start-sync"),
    setupSqlButton: requireElement("setup-sql"),
    supabaseProjectId: requireElement("supabase_project_id"),
    supabaseApiKey: requireElement("supabase_api_key"),
    connectionCode: requireElement("connection-code"),
    createLinkButton: requireElement("create-link"),
    generatedConnectionCode: requireElement("generated-connection-code"),
    deviceLinkPanel: requireElement("device-link-panel"),
    copyConnectionCodeButton: requireElement("copy-connection-code"),
    connectionCodeExpiry: requireElement("connection-code-expiry"),
    syncFeedback: requireElement("sync-feedback"),
    captchaContainer: requireElement("captcha-container"),
    exportButton: requireElement("idDatabase_Export"),
    importInput:
      requireElement("idDatabase_Import").parentElement.querySelector(
        "input[type=file]",
      ),
    importLabel: requireElement("idDatabase_Import").parentElement,
    syncDatabaseButton: requireElement("idDatabase_Sync"),
    syncHistoryButton: requireElement("sync-history"),
    syncYouTubeButton: requireElement("sync-youtube"),
    syncLikesButton: requireElement("sync-youtube-likes"),
    syncAllButton: requireElement("sync-all"),
  };
}
