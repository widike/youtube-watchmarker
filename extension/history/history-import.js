import { fixUtf8DoubleEncoding } from "../shared/text-utils.js";
import { normalizeVideo } from "./history-records.js";

function escapeJsonControlCharacter(character) {
  switch (character) {
    case "\b":
      return "\\b";
    case "\t":
      return "\\t";
    case "\n":
      return "\\n";
    case "\f":
      return "\\f";
    case "\r":
      return "\\r";
    default:
      return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
  }
}

function escapeInvalidJsonControlCharacters(text) {
  let result = "";
  let isInsideString = false;
  let isEscaped = false;

  for (const character of text) {
    const charCode = character.charCodeAt(0);

    if (isInsideString) {
      if (isEscaped) {
        result += character;
        isEscaped = false;
        continue;
      }

      if (character === "\\") {
        result += character;
        isEscaped = true;
        continue;
      }

      if (character === '"') {
        result += character;
        isInsideString = false;
        continue;
      }

      result +=
        charCode <= 0x1f ? escapeJsonControlCharacter(character) : character;
      continue;
    }

    if (character === '"') {
      isInsideString = true;
    }

    if (
      charCode <= 0x1f &&
      character !== "\t" &&
      character !== "\n" &&
      character !== "\r"
    ) {
      continue;
    }

    result += character;
  }

  return result;
}

function parseJson(rawData) {
  const text = String(rawData || "").replace(/^\uFEFF/, "");

  try {
    return JSON.parse(text);
  } catch (error) {
    const sanitizedText = escapeInvalidJsonControlCharacters(text);
    if (sanitizedText === text) {
      throw error;
    }

    return JSON.parse(sanitizedText);
  }
}

function normalizeImportedVideo(video) {
  const timestamp = Number(video.intTimestamp || video.int_timestamp);
  const count = Number(video.intCount || video.int_count || 1);
  const title = String(video.strTitle || video.str_title || "");
  const deletedAt = Number(video.intDeletedAt || video.int_deleted_at || 0);

  return normalizeVideo({
    strIdent: String(video.strIdent || video.str_ident || "").trim(),
    intTimestamp:
      Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : 0,
    strTitle: fixUtf8DoubleEncoding(title),
    intDeletedAt:
      Number.isSafeInteger(deletedAt) && deletedAt > 0 ? deletedAt : 0,
    intCount: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
    intImportedCount: video.intImportedCount ?? video.int_imported_count,
    watchEvents: video.watchEvents,
  });
}

function getImportRows(parsedData) {
  if (Array.isArray(parsedData)) {
    return parsedData;
  }

  if (Array.isArray(parsedData?.objVideos)) {
    return parsedData.objVideos;
  }

  if (Array.isArray(parsedData?.objResponse?.objVideos)) {
    return parsedData.objResponse.objVideos;
  }

  if (Array.isArray(parsedData?.data)) {
    return parsedData.data;
  }

  if (Array.isArray(parsedData?.rows)) {
    return parsedData.rows;
  }

  if (Array.isArray(parsedData?.providers?.indexedDB)) {
    return parsedData.providers.indexedDB;
  }

  if (Array.isArray(parsedData?.providers?.supabase)) {
    return parsedData.providers.supabase;
  }

  return null;
}

// Original .database files contain base64 of UTF-8 JSON, not Latin-1 text.
function decodeDatabase(text) {
  const binary = atob(text.trim());
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function parseHistoryImport(rawData) {
  let parsed;
  try {
    const text = String(rawData ?? "").replace(/^\uFEFF/, "");
    try {
      parsed = parseJson(text);
    } catch {
      parsed = parseJson(decodeDatabase(text));
    }
  } catch {
    throw new Error(
      "Invalid database format. Choose a JSON export or an original Watchmarker .database backup.",
    );
  }

  const rows = getImportRows(parsed);
  if (!rows) {
    throw new Error(
      "Invalid database format. Expected a video array or a Watchmarker export containing objVideos.",
    );
  }
  // Validate the entire file before the handler writes any import chunks.
  return rows.map((video) => {
    if (!video || typeof video !== "object" || Array.isArray(video)) {
      throw new Error("Invalid database format. Expected video records.");
    }
    return normalizeImportedVideo(video);
  });
}
