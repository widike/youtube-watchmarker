// Run enabled history sources after providers and defaults are ready. Each source
// handles its own failure so browser and YouTube imports remain independent.
export function createHistorySynchronization({
  ready,
  storage,
  youtube,
  history,
  recoverPlaybacks,
  logger,
}) {
  const run = async (trigger) => {
    try {
      await ready();
      const settings = await storage.get([
        "idCondition_Browhist",
        "idCondition_Youhist",
        "idCondition_Youprog",
      ]);
      const sources = [
        // Exact measured times must land before day-only imports look for gaps.
        {
          enabled: settings.idCondition_Youprog,
          label: "Measured playback",
          synchronize: recoverPlaybacks,
        },
        {
          enabled: settings.idCondition_Browhist,
          label: "Browser history",
          synchronize: (progress) => history.synchronize(0, true, progress),
        },
        {
          enabled: settings.idCondition_Youhist,
          label: "YouTube history",
          synchronize: (progress) => youtube.synchronize(progress),
        },
      ];
      for (const source of sources) {
        if (source.enabled !== true) continue;
        try {
          const result = await source.synchronize((progress) =>
            logger.debug(`${source.label} sync progress:`, progress),
          );
          logger.info(`${source.label} sync completed:`, result);
        } catch (error) {
          logger.error(
            `${trigger} ${source.label} synchronization failed:`,
            error,
          );
        }
      }
    } catch (error) {
      logger.error(`${trigger} synchronization failed:`, error);
    }
  };
  return {
    startup: () => run("Startup"),
    periodic: () => run("Periodic"),
  };
}
