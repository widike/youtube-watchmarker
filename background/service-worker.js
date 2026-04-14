// @ts-check

/**
 * Chrome MV3 service worker bootstrap.
 * Registers extension listeners synchronously and lazily initializes the
 * extension context before handlers execute.
 */

import { logger } from "../logger.js";
import { messageRouter } from "../message-router.js";
import { settingsManager } from "../settings-manager.js";
import { alarmManager } from "../alarm-manager.js";
import { videoTracker } from "../video-tracker.js";
import { Database } from "../bg-database.js";
import { History } from "../bg-history.js";
import { Youtube } from "../bg-youtube.js";
import { Search } from "../bg-search.js";
import { SyncManagerInstance } from "../bg-sync-manager.js";
import { databaseProviderFactory } from "../database-provider-factory.js";
import {
  handleDatabaseExport,
  handleDatabaseImport,
  handleDatabaseReset,
  handleDatabaseSize,
} from "../handlers/database-handlers.js";
import {
  handleYoutubeLookup,
  handleYoutubeEnsure,
  handleYoutubeSynchronize,
  handleYoutubeLikedVideos,
  handleYoutubeMark,
} from "../handlers/youtube-handlers.js";
import {
  handleSearchVideos,
  handleSearchDelete,
} from "../handlers/search-handlers.js";
import {
  handleProviderStatus,
  handleProviderSwitch,
  handleProviderList,
  handleProviderMigrate,
  handleProviderSync,
  handleSupabaseConfigure,
  handleSupabaseTest,
  handleSupabaseClear,
  handleSupabaseGetCredentials,
  handleSupabaseGetStatus,
  handleSupabaseCheckTable,
} from "../handlers/provider-handlers.js";
import { handleHistorySynchronize } from "../handlers/history-handlers.js";
import {
  handleGetSetting,
  handleSetSetting,
} from "../handlers/settings-handlers.js";

let initializationPromise;
let messageHandlersRegistered = false;
let alarmHandlersRegistered = false;

function withInitialization(handler) {
  return async (request, sender) => {
    await ensureServiceWorkerReady();
    return handler(request, sender);
  };
}

function registerMessageHandlers() {
  if (messageHandlersRegistered) {
    return;
  }

  messageRouter.registerMultiple({
    "database-export": withInitialization(handleDatabaseExport),
    "database-import": withInitialization(handleDatabaseImport),
    "database-reset": withInitialization(handleDatabaseReset),
    "database-size": withInitialization(handleDatabaseSize),
    "youtube-lookup": withInitialization(handleYoutubeLookup),
    "youtube-ensure": withInitialization(handleYoutubeEnsure),
    "youtube-mark": withInitialization(handleYoutubeMark),
    "youtube-synchronize": withInitialization(handleYoutubeSynchronize),
    "youtube-liked-videos": withInitialization(handleYoutubeLikedVideos),
    "search-videos": withInitialization(handleSearchVideos),
    "search-delete": withInitialization(handleSearchDelete),
    "history-synchronize": withInitialization(handleHistorySynchronize),
    "database-provider-status": withInitialization(handleProviderStatus),
    "database-provider-switch": withInitialization(handleProviderSwitch),
    "database-provider-list": withInitialization(handleProviderList),
    "database-provider-migrate": withInitialization(handleProviderMigrate),
    "database-provider-sync": withInitialization(handleProviderSync),
    "supabase-configure": withInitialization(handleSupabaseConfigure),
    "supabase-test": withInitialization(handleSupabaseTest),
    "supabase-clear": withInitialization(handleSupabaseClear),
    "supabase-get-credentials": withInitialization(
      handleSupabaseGetCredentials,
    ),
    "supabase-get-status": withInitialization(handleSupabaseGetStatus),
    "supabase-check-table": withInitialization(handleSupabaseCheckTable),
    "get-setting": withInitialization(handleGetSetting),
    "set-setting": withInitialization(handleSetSetting),
    "sync-manager-start": withInitialization(async () =>
      SyncManagerInstance.startAutoSync(),
    ),
    "sync-manager-stop": withInitialization(async () =>
      SyncManagerInstance.stopAutoSync(),
    ),
    "sync-manager-sync-now": withInitialization(async () =>
      SyncManagerInstance.syncNow(),
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

  alarmManager.registerHandler("synchronize", async () => {
    await performPeriodicSync();
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

async function initializeServiceWorker() {
  logger.info("Initializing service worker context...");

  await settingsManager.initialize();
  await initializeDatabaseProviders();

  registerAlarmHandlers();
  await alarmManager.initialize();
  await videoTracker.initialize(Youtube);

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

async function syncHistory() {
  const result = await History.synchronize(0, true, (progress) =>
    logger.debug("History sync progress:", progress),
  );
  logger.info("History sync completed:", result);
  return result;
}

async function syncYoutube() {
  const result = await Youtube.synchronize((progress) =>
    logger.debug("YouTube sync progress:", progress),
  );
  logger.info("YouTube sync completed:", result);
  return result;
}

async function performStartupSynchronization() {
  await ensureServiceWorkerReady();

  try {
    const result = await chrome.storage.sync.get(["idCondition_Youhist"]);
    if (result.idCondition_Youhist === true) {
      await syncYoutube();
    }
  } catch (error) {
    logger.error("Startup synchronization failed:", error);
  }
}

async function performPeriodicSync() {
  await ensureServiceWorkerReady();

  try {
    const result = await chrome.storage.sync.get([
      "idCondition_Browhist",
      "idCondition_Youhist",
    ]);

    if (result.idCondition_Browhist === true) {
      await syncHistory();
    }

    if (result.idCondition_Youhist === true) {
      await syncYoutube();
    }
  } catch (error) {
    logger.error("Periodic synchronization failed:", error);
  }
}

registerMessageHandlers();
alarmManager.bindListener();

chrome.runtime.onInstalled.addListener(() => {
  void performStartupSynchronization();
});

chrome.runtime.onStartup.addListener(() => {
  void performStartupSynchronization();
});

void ensureServiceWorkerReady();
