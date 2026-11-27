import { decodeHtmlEntitiesAndFixEncoding } from "../shared/text-utils.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES =
  "jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december";
const germanMonths = new Map(
  [
    "januar",
    "februar",
    "märz",
    "april",
    "mai",
    "juni",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "dezember",
  ].flatMap((name, month) => [
    [name, month],
    [name.slice(0, 3), month],
  ]),
);
const WEEKDAYS = [
  ["sunday", "sonntag"],
  ["monday", "montag"],
  ["tuesday", "dienstag"],
  ["wednesday", "mittwoch"],
  ["thursday", "donnerstag"],
  ["friday", "freitag"],
  ["saturday", "samstag"],
];

function startOfLocalDay(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/**
 * Parse common YouTube date labels into a timestamp.
 * @param {string|null} dateText - YouTube date label
 * @param {Date} [now] - Reference date
 * @returns {number|null} Timestamp in milliseconds, or null when unknown
 */
export function parseYouTubeDateText(dateText, now = new Date()) {
  if (!dateText || typeof dateText !== "string") {
    return null;
  }

  const text = decodeHtmlEntitiesAndFixEncoding(dateText)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return null;
  }

  const lowerText = text.toLowerCase();

  if (lowerText.includes("today") || lowerText.includes("heute")) {
    return startOfLocalDay(now);
  }

  if (lowerText.includes("yesterday") || lowerText.includes("gestern")) {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
    ).getTime();
  }

  // History headers name the past week's days, which always lie in the past.
  const weekday = WEEKDAYS.findIndex((names) => names.includes(lowerText));
  if (weekday >= 0) {
    const daysAgo = (now.getDay() - weekday + 7) % 7 || 7;
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - daysAgo,
    ).getTime();
  }

  let relativeMatch = lowerText.match(
    /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/,
  );
  let relativeUnit = relativeMatch?.[2] || null;

  if (!relativeMatch) {
    relativeMatch = lowerText.match(
      /vor\s+(\d+)\s+(sekunde|minute|stunde|tag|woche|monat|jahr)(?:n|en|e)?/,
    );
    const germanUnits = {
      sekunde: "second",
      minute: "minute",
      stunde: "hour",
      tag: "day",
      woche: "week",
      monat: "month",
      jahr: "year",
    };
    relativeUnit = germanUnits[relativeMatch?.[2]] || null;
  }

  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeUnit;
    if (unit === "day" || unit === "week") {
      const days = amount * (unit === "week" ? 7 : 1);
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - days,
      ).getTime();
    }
    if (unit === "month" || unit === "year") {
      const month = new Date(
        now.getFullYear(),
        now.getMonth() - amount * (unit === "year" ? 12 : 1),
        1,
      );
      const lastDay = new Date(
        month.getFullYear(),
        month.getMonth() + 1,
        0,
      ).getDate();
      month.setDate(Math.min(now.getDate(), lastDay));
      return month.getTime();
    }
    const multipliers = {
      second: 1000,
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
    };
    const timestamp = now.getTime() - amount * multipliers[unit];
    return timestamp;
  }

  const absoluteText = text
    .replace(/^(added|watched|viewed|liked)\s+(on\s+)?/i, "")
    .trim();

  const german = absoluteText
    .toLowerCase()
    .match(/^(\d{1,2})\.\s+([a-zäöü]+)\.?(?:\s+(\d{4}))?$/);
  if (german) {
    const [, day, label, year] = german;
    const month = germanMonths.get(label);
    if (month === undefined) return null;
    const date = new Date(
      Number(year || now.getFullYear()),
      month,
      Number(day),
    );
    if (!year && date.getTime() > now.getTime())
      date.setFullYear(date.getFullYear() - 1);
    return date.getMonth() === month && date.getDate() === Number(day)
      ? date.getTime()
      : null;
  }

  const monthDayMatch = absoluteText.match(
    new RegExp(`^(${MONTH_NAMES})\\.?\\s+\\d{1,2}$`, "i"),
  );
  const candidateText = monthDayMatch
    ? `${absoluteText}, ${now.getFullYear()}`
    : absoluteText;
  let parsedDate = new Date(candidateText);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  if (monthDayMatch && parsedDate.getTime() > now.getTime() + DAY_IN_MS) {
    parsedDate = new Date(`${absoluteText}, ${now.getFullYear() - 1}`);
  }

  return startOfLocalDay(parsedDate);
}
