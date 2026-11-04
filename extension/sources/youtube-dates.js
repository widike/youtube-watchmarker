import { decodeHtmlEntitiesAndFixEncoding } from "../shared/text-utils.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES =
  "jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december";
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
    return startOfLocalDay(new Date(now.getTime() - DAY_IN_MS));
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
    const multipliers = {
      second: 1000,
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: DAY_IN_MS,
      week: 7 * DAY_IN_MS,
      month: 30 * DAY_IN_MS,
      year: 365 * DAY_IN_MS,
    };
    const timestamp = now.getTime() - amount * multipliers[unit];
    return unit === "second" || unit === "minute" || unit === "hour"
      ? timestamp
      : startOfLocalDay(new Date(timestamp));
  }

  const absoluteText = text
    .replace(/^(added|watched|viewed|liked)\s+(on\s+)?/i, "")
    .trim();

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
