export const DATABASE = {
  NAME: "Database",
  VERSION: 403,
  STORE_NAME: "storeDatabase",
  INDEXES: {
    IDENT: "strIdent",
    TIMESTAMP: "intTimestamp",
  },
};

export const YOUTUBE = {
  URLS: {
    WATCH: "https://www.youtube.com/watch?v=",
    SHORTS: "https://www.youtube.com/shorts/",
    MOBILE_WATCH: "https://m.youtube.com/watch?v=",
    HISTORY: "https://www.youtube.com/feed/history",
    LIKED: "https://www.youtube.com/playlist?list=LL",
  },

  API: {
    BASE: "https://www.youtube.com/youtubei/v1/",
    ENDPOINTS: {
      BROWSE: "browse",
      FEEDBACK: "feedback",
    },
  },
};

export const ERRORS = {
  DATABASE_NOT_AVAILABLE: "Database not available",
  INVALID_REQUEST: "Invalid request format",
  PROVIDER_NOT_FOUND: "Database provider not found",
};

export const TIMEOUTS = {
  CHUNK_PROCESSING_DELAY: 150, // milliseconds delay between import chunks
};

export const IMPORT_EXPORT = {
  CHUNK_SIZE_LARGE: 500, // For datasets > 50000 videos
  CHUNK_SIZE_MEDIUM: 750, // For datasets > 10000 videos
  CHUNK_SIZE_SMALL: 1000, // For datasets <= 10000 videos
  LARGE_DATASET_THRESHOLD: 50000,
  MEDIUM_DATASET_THRESHOLD: 10000,
};
