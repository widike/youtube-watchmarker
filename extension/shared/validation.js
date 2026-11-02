import "./video-identity.js";

export const VIDEO_ID_LENGTH = 11;
export const isValidVideoId = globalThis.YouTubeWatchmarkerVideo.isVideoId;

export function isValidVideoTitle(title) {
  if (!title || typeof title !== "string") {
    return false;
  }

  // Unavailable watch pages can expose only "- YouTube" or a placeholder
  // with the site suffix. Validate the metadata part, never the page branding.
  const trimmedTitle = title
    .trim()
    .replace(/(?:^|\s+)-\s+YouTube$/i, "")
    .trim()
    .replace(/^\[(.*)\]$/, "$1")
    .toLowerCase();

  // Check if title is empty or too short
  if (trimmedTitle.length < 1) {
    return false;
  }

  // List of generic/invalid titles to avoid
  const invalidTitles = [
    "youtube",
    "video",
    "untitled",
    "untitled video",
    "loading...",
    "loading",
    "...",
    "private video",
    "deleted video",
    "video unavailable",
    "privates video",
    "gelöschtes video",
    "video nicht verfügbar",
  ];

  // Check for exact matches with invalid titles
  if (invalidTitles.includes(trimmedTitle)) {
    return false;
  }

  // Check for generic patterns
  const genericPatterns = [
    /^Video \d+$/i, // "Video 123"
    /^Untitled( \d+)?$/i, // "Untitled" or "Untitled 1"
    /^Loading\.{3,}$/i, // "Loading..."
    /^\.{3,}$/, // Just dots
    /^-+$/, // Just dashes
    /^_+$/, // Just underscores
  ];

  // Check if title matches any generic pattern
  if (genericPatterns.some((pattern) => pattern.test(trimmedTitle))) {
    return false;
  }

  // Title seems valid
  return true;
}
