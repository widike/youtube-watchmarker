// @ts-check

/**
 * Chrome MV3 service worker bootstrap.
 * Registers extension listeners synchronously and lazily initializes the
 * extension context before handlers execute.
 */

import { createHistorySynchronization } from "./history-synchronization.js";
import { handleHistoryReconciliation } from "../handlers/reconciliation-handlers.js";
import { durationBackfill, durationStorage } from "./duration-runtime.js";
import { DURATION_ALARM } from "../duration/duration-backfill.js";
import {
  handleDurationStatus,
  handleDurationControl,
} from "../handlers/duration-handlers.js";
import { logger } from "../shared/logger.js";
import { historyImportCutoff } from "../history/history-import-policy.js";
import { recoverMissedPlaybacks } from "../history/playback-recovery.js";
import { readWatchTime } from "../history/watch-time-storage.js";
import { withWatchmarkerRefresh } from "./watch-notifications.js";
import { messageRouter } from "./message-router.js";
import { settingsManager } from "./settings-manager.js";
import { alarmManager } from "./alarm-manager.js";
import { videoTracker } from "./video-tracker.js";
import { Database } from "./bg-database.js";
import { History } from "../sources/bg-history.js";
import { Youtube } from "../sources/bg-youtube.js";
import { Search } from "./bg-search.js";
import { HISTORY_SYNC_ALARM, SyncManagerInstance } from "./bg-sync-manager.js";
import { databaseProviderFactory } from "../providers/database-provider-factory.js";
import {
  handleDatabaseExport,
  handleDatabaseImport,
  handleDatabaseSize,
} from "../handlers/database-handlers.js";
import {
  handleYoutubeLookup,
  handleYoutubeSynchronize,
  handleYoutubeLikedVideos,
  handleYoutubeWatch,
} from "../handlers/youtube-handlers.js";
import {
  handleSearchVideos,
  handleSearchDelete,
} from "../handlers/search-handlers.js";
import {
  handleProviderStatus,
  handleSupabaseConnect,
  handleSupabaseCaptchaConfiguration,
  handleSupabaseCreateLink,
  handleSupabaseTest,
  handleSupabaseGetCredentials,
  handleSupabaseGetStatus,
  handleSupabaseCheckTable,
} from "../handlers/provider-handlers.js";
import { handleHistorySynchronize } from "../handlers/history-handlers.js";
import {
  handleSourcePreview,
  handleSourcePreviewCancel,
} from "../handlers/source-handlers.js";
import {
  handleHistoryStatistics,
  handleYoutubeWatchTime,
} from "../handlers/statistics-handlers.js";
import {
  handleGetSetting,
  handleSetSetting,
} from "../handlers/settings-handlers.js";

let initializationPromise;
let messageHandlersRegistered = false;
let alarmHandlersRegistered = false;

const HISTORY_CHANGES = new Set([
  "history-reconcile",
  "database-import",
  "search-delete",
  "youtube-synchronize",
  "youtube-liked-videos",
  "history-synchronize",
  "sync-manager-sync-now",
]);

function withInitialization(handler) {
  return async (request, sender) => {
    await ensureServiceWorkerReady();
    return HISTORY_CHANGES.has(request.action)
      ? withWatchmarkerRefresh(() => handler(request, sender))
      : handler(request, sender);
  };
}

function registerMessageHandlers() {
  if (messageHandlersRegistered) {
    return;
  }

  messageRouter.registerMultiple({
    "database-export": withInitialization(handleDatabaseExport),
    "history-reconcile": withInitialization(handleHistoryReconciliation),
    "database-import": withInitialization(handleDatabaseImport),
    "database-size": withInitialization(handleDatabaseSize),
    "youtube-lookup": withInitialization(handleYoutubeLookup),
    "youtube-watch": withInitialization(handleYoutubeWatch),
    "youtube-synchronize": withInitialization(handleYoutubeSynchronize),
    "youtube-liked-videos": withInitialization(handleYoutubeLikedVideos),
    "search-delete": withInitialization(handleSearchDelete),
    "search-videos": withInitialization(handleSearchVideos),
    "history-synchronize": withInitialization(handleHistorySynchronize),
    "source-preview": withInitialization(handleSourcePreview),
    "source-preview-cancel": withInitialization(handleSourcePreviewCancel),
    "history-statistics": withInitialization(handleHistoryStatistics),
    "youtube-watch-time": withInitialization(handleYoutubeWatchTime),
    "duration-status": withInitialization(handleDurationStatus),
    "duration-control": withInitialization(handleDurationControl),
    "database-provider-status": withInitialization(handleProviderStatus),
    "supabase-connect": withInitialization(handleSupabaseConnect),
    "supabase-captcha-config": withInitialization(
      handleSupabaseCaptchaConfiguration,
    ),
    "supabase-create-link": withInitialization(handleSupabaseCreateLink),
    "supabase-test": withInitialization(handleSupabaseTest),
    "supabase-get-credentials": withInitialization(
      handleSupabaseGetCredentials,
    ),
    "supabase-get-status": withInitialization(handleSupabaseGetStatus),
    "supabase-check-table": withInitialization(handleSupabaseCheckTable),
    "get-setting": withInitialization(handleGetSetting),
    "set-setting": withInitialization(handleSetSetting),
    "sync-manager-sync-now": withInitialization(async (request) =>
      SyncManagerInstance.syncNow({
        forceDownload: request.forceDownload !== false,
      }),
    ),
    "sync-manager-status": withInitialization(async () =>
      SyncManagerInstance.getStatus(),
    ),
  });

  messageRouter.setupListeners();
  messageHandlersRegistered = true;
}

function registerAlarmHandlers() {
  if (alarmHandlersRegistered) {
    return;
  }

  alarmManager.registerHandler(DURATION_ALARM, async () => {
    await ensureServiceWorkerReady();
    await durationBackfill.tick();
  });
  alarmManager.registerHandler("youtube-duration-expiry", async () => {
    await ensureServiceWorkerReady();
    await durationStorage.readCache();
  });

  alarmManager.registerHandler("synchronize", async () => {
    await withWatchmarkerRefresh(() => historySynchronization.periodic());
  });

  alarmManager.registerHandler(HISTORY_SYNC_ALARM, async () => {
    await ensureServiceWorkerReady();
    await withWatchmarkerRefresh(() =>
      SyncManagerInstance.syncNow({ forceDownload: false }),
    );
  });

  alarmHandlersRegistered = true;
}

async function initializeDatabaseProviders() {
  await Database.init();

  databaseProviderFactory.setDatabaseManager(Database);
  Database.providerFactory = databaseProviderFactory;

  const initialized = await databaseProviderFactory.init();
  if (!initialized) {
    throw new Error("Failed to initialize database provider factory");
  }

  History.setProviderFactory(databaseProviderFactory);
  Youtube.setProviderFactory(databaseProviderFactory);
  Search.setProviderFactory(databaseProviderFactory);

  await Promise.all([History.init(), Youtube.init(), Search.init()]);
}

async function restrictSensitiveStorageAccess() {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
}

async function initializeServiceWorker() {
  logger.info("Initializing service worker context...");

  await restrictSensitiveStorageAccess();
  await historyImportCutoff();
  await settingsManager.initialize();
  await initializeDatabaseProviders();

  await alarmManager.initialize();
  await SyncManagerInstance.init();
  await videoTracker.initialize(Youtube);
  await durationStorage.readCache();
  if (!(await chrome.alarms.get("youtube-duration-expiry")))
    await chrome.alarms.create("youtube-duration-expiry", {
      periodInMinutes: 60,
    });
  await durationBackfill.initialize();

  // Network availability must never block recording a local watch.
  void withWatchmarkerRefresh(() => SyncManagerInstance.syncNow()).catch(
    (error) => logger.warn("History sync deferred:", error.message),
  );
  logger.info("Service worker context initialized");
}

async function ensureServiceWorkerReady() {
  if (!initializationPromise) {
    initializationPromise = initializeServiceWorker().catch((error) => {
      initializationPromise = undefined;
      logger.error("Service worker initialization failed:", error);
      throw error;
    });
  }

  return initializationPromise;
}

const historySynchronization = createHistorySynchronization({
  ready: ensureServiceWorkerReady,
  storage: chrome.storage.sync,
  youtube: Youtube,
  history: History,
  // Download first so another device's own events win over a recovered copy.
  recoverPlaybacks: async () => {
    await SyncManagerInstance.syncNow({ forceDownload: false });
    return recoverMissedPlaybacks(
      Youtube,
      await readWatchTime(Database.database),
    );
  },
  logger,
});

registerMessageHandlers();
registerAlarmHandlers();
alarmManager.bindListener();

chrome.runtime.onInstalled.addListener(() => {
  void withWatchmarkerRefresh(() => historySynchronization.startup());
});

chrome.runtime.onStartup.addListener(() => {
  void withWatchmarkerRefresh(() => historySynchronization.startup());
});

void ensureServiceWorkerReady();
