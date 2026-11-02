import { summarizeHistory } from "../history-statistics.js";
import { DAY, dayKey } from "../statistics-dates.js";

const now = new Date(2026, 10, 1, 22, 30).getTime();
const titles = [
  "The space telescope science behind distant galaxies",
  "A space science guide to Mars exploration",
  "Wie die Wissenschaft neue Galaxien entdeckt",
  "Building a quiet custom keyboard",
  "The ultimate keyboard build and sound test",
  "Cooking a perfect ramen bowl at home",
  "The science of cooking ramen noodles",
  "Berlin cycling through autumn streets",
  "A cycling guide to Berlin and beyond",
  "Deep ocean exploration and marine science",
  "The future of renewable energy technology",
  "How to build a home solar energy system",
];
const videos = titles.map((strTitle, index) => ({
  strIdent: String(index).padStart(11, "a"),
  strTitle,
  intCount: 0,
  intTimestamp: 0,
  intUnknownCount: 0,
  watchEvents: [],
}));
let serial = 0;
const time = [];
for (
  let date = new Date(2022, 0, 1);
  date.getTime() <= now;
  date.setDate(date.getDate() + 1)
) {
  const count =
    Math.floor((Math.sin(serial / 7) + 1) * 4) + (serial % 5 === 0 ? 10 : 0);
  for (let i = 0; i < count; i++) {
    const watched = new Date(date);
    watched.setHours(7 + ((serial + i) % 15), (i * 7) % 60);
    const row = videos[(Math.floor(serial / 45) * 3 + (i % 3)) % videos.length];
    row.watchEvents.push({
      eventId: `fixture:${dayKey(date)}:${i}`,
      watchedAt: watched.getTime(),
      source: "playback",
      precision: serial % 7 === 0 ? "day" : "exact",
      observedDeletion: 0,
    });
    row.intCount++;
    row.intTimestamp = watched.getTime();
    const from = watched.getTime();
    time.push({
      strIdent: row.strIdent,
      eventId: `fixture:${dayKey(date)}:${i}`,
      strTitle: row.strTitle,
      minute: Math.floor(from / 60_000) * 60_000,
      from,
      to: from + 60_000,
      milliseconds: 60_000,
    });
  }
  serial++;
}

// Distinct titles in different periods catch stale words/rankings in the UI.
for (const [index, age] of [2, 2, 60, 60].entries()) {
  const watchedAt = now - age * DAY;
  videos.push({
    strIdent: String(index).padStart(11, "b"),
    strTitle:
      age === 2 ? "Recent astronomy survey" : "Historical archaeology survey",
    intCount: 1,
    intTimestamp: watchedAt,
    intUnknownCount: 0,
    watchEvents: [
      {
        eventId: `period:${index}`,
        watchedAt,
        source: "saved",
        precision: "day",
        observedDeletion: 0,
      },
    ],
  });
}

export function statistics(period, empty = false, noTime = false) {
  // The count-only state has neither measurements nor a timed watch sequence.
  const history = noTime
    ? videos.map((video) => ({
        ...video,
        watchEvents: video.watchEvents.map((event) => ({
          ...event,
          precision: "day",
        })),
      }))
    : videos;
  return summarizeHistory(empty ? [] : history, {
    period,
    now,
    time: empty || noTime ? [] : time,
  });
}
