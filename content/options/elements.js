// @ts-check

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element;
}

export function createOptionsElements() {
  return {
    themeToggle: requireElement("theme-toggle"),
    themeIcon: requireElement("theme-icon"),
    databaseSize: requireElement("idDatabase_Size"),
    providerIndexedDB: requireElement("provider_indexeddb"),
    providerSupabase: requireElement("provider_supabase"),
    enableAutoSync: requireElement("enable_auto_sync"),
    supabaseConfig: requireElement("supabase-config"),
    supabaseUrl: requireElement("supabase_url"),
    supabaseApiKey: requireElement("supabase_api_key"),
    supabaseStatus: requireElement("supabase-status"),
    supabaseStatusIcon: requireElement("supabase-status-icon"),
    supabaseStatusText: requireElement("supabase-status-text"),
    supabaseSetupInstructions: requireElement("supabase-setup-instructions"),
    copySqlButton: requireElement("copy-sql-button"),
    currentConfig: requireElement("current-config"),
    currentUrl: requireElement("current-url"),
    currentApiKey: requireElement("current-api-key"),
    searchInput: requireElement("idSearch_Query"),
    searchButton: requireElement("idSearch_Lookup"),
    searchResults: requireElement("idSearch_Results"),
    searchIcon: requireElement("search-icon"),
    searchSpinner: requireElement("search-spinner"),
    exportButton: requireElement("idDatabase_Export"),
    importInput:
      requireElement("idDatabase_Import").parentElement.querySelector(
        "input[type=file]",
      ),
    importLabel: requireElement("idDatabase_Import").parentElement,
    resetButton: requireElement("idDatabase_Reset"),
    syncDatabaseButton: requireElement("idDatabase_Sync"),
    integrityButton: requireElement("idDatabase_Integrity"),
    syncHistoryButton: requireElement("sync-history"),
    syncYouTubeButton: requireElement("sync-youtube"),
    syncLikesButton: requireElement("sync-youtube-likes"),
    syncAllButton: requireElement("sync-all"),
    saveSupabaseButton: requireElement("supabase_save"),
    testSupabaseButton: requireElement("supabase_test"),
    clearSupabaseButton: requireElement("supabase_clear"),
    successToast: requireElement("successToast"),
    errorToast: requireElement("errorToast"),
    successToastMessage: requireElement("successToastMessage"),
    errorToastMessage: requireElement("errorToastMessage"),
    screenReaderAnnouncements: requireElement("sr-announcements"),
  };
}
