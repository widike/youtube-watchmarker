// Receipt events preserve the original immutable import while recording that it
// must no longer contribute a watch. They use the existing replicated schema.
export const IMPORT_CORRECTION = "reconciled-import:v1:";

export function excludedImportIds(events) {
  return new Set(
    events
      .filter(
        (event) =>
          event.source === "receipt" &&
          event.eventId.startsWith(IMPORT_CORRECTION),
      )
      .map((event) => event.eventId.slice(IMPORT_CORRECTION.length)),
  );
}
