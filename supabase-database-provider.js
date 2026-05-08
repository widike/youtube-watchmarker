/**
 * Supabase Database Provider for YouTube Watch History
 * Implements PostgreSQL storage using Supabase PostgREST API
 * Uses pure HTTP requests to avoid service worker restrictions
 */

import { credentialStorage } from "./credential-storage.js";

/**
 * Supabase Database Provider
 * Provides PostgreSQL storage for YouTube watch history data via PostgREST API
 */
export class SupabaseDatabaseProvider {
  constructor() {
    this.isInitialized = false;
    this.isConnected = false;
    this.tableName = "youtube_watch_history";
    this.credentials = null;
    this.baseUrl = null;
    this.apiKey = null;
    this.maxRetries = 3;
    this.retryDelay = 1000;
    this.activeControllers = new Set(); // Track active AbortControllers for cleanup

    // Circuit breaker state - prevents cascading failures
    this.circuitState = "CLOSED"; // CLOSED (normal), OPEN (failing), HALF_OPEN (testing)
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.failureThreshold = 3; // Open circuit after 3 consecutive failures
    this.resetTimeoutMs = 60000; // Try again after 1 minute
  }

  getTableProbePath() {
    // Query a real column so PostgREST returns 200 for an existing, readable table,
    // even when the table is empty.
    return `/${this.tableName}?select=str_ident&limit=1`;
  }

  /**
   * Check if circuit breaker allows requests
   * @returns {{allowed: boolean, reason?: string}}
   */
  checkCircuitBreaker() {
    if (this.circuitState === "CLOSED") {
      return { allowed: true };
    }

    if (this.circuitState === "OPEN") {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.resetTimeoutMs) {
        // Transition to HALF_OPEN - allow one test request
        this.circuitState = "HALF_OPEN";
        console.log("Circuit breaker: OPEN → HALF_OPEN (testing connection)");
        return { allowed: true };
      }
      const remainingMs = this.resetTimeoutMs - timeSinceFailure;
      return {
        allowed: false,
        reason: `Circuit breaker OPEN - Supabase disabled for ${Math.ceil(remainingMs / 1000)}s more`,
      };
    }

    // HALF_OPEN - allow the test request
    return { allowed: true };
  }

  /**
   * Record a successful request - reset circuit breaker
   */
  recordSuccess() {
    if (this.circuitState === "HALF_OPEN") {
      console.log("Circuit breaker: HALF_OPEN → CLOSED (connection restored)");
    }
    this.circuitState = "CLOSED";
    this.failureCount = 0;
  }

  /**
   * Record a failed request - may open circuit breaker
   */
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.circuitState === "HALF_OPEN") {
      // Test request failed - reopen circuit
      this.circuitState = "OPEN";
      console.log("Circuit breaker: HALF_OPEN → OPEN (test request failed)");
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.circuitState = "OPEN";
      console.warn(
        `Circuit breaker: CLOSED → OPEN (${this.failureCount} consecutive failures)`,
      );
    }
  }

  /**
   * Get circuit breaker status
   * @returns {Object} Circuit breaker status
   */
  getCircuitBreakerStatus() {
    return {
      state: this.circuitState,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      isAvailable:
        this.circuitState !== "OPEN" ||
        Date.now() - this.lastFailureTime >= this.resetTimeoutMs,
    };
  }

  createTimeoutSignal(timeoutMs) {
    const controller = new AbortController();
    this.activeControllers.add(controller);

    const timeoutId = setTimeout(() => {
      controller.abort();
      this.activeControllers.delete(controller);
    }, timeoutMs);

    controller.signal.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      this.activeControllers.delete(controller);
    });

    return controller.signal;
  }

  cleanup() {
    for (const controller of this.activeControllers) {
      try {
        controller.abort();
      } catch (_error) {
        // Ignore cleanup errors
      }
    }
    this.activeControllers.clear();
  }

  validateApiKey(apiKey) {
    return apiKey && typeof apiKey === "string" && apiKey.length >= 100;
  }

  /**
   * Load and validate stored credentials.
   * @returns {Promise<boolean>} True when usable credentials are available
   */
  async loadCredentials() {
    this.credentials = await credentialStorage.getCredentials();
    if (!this.credentials) {
      return false;
    }

    if (!this.validateSupabaseUrl(this.credentials.supabaseUrl)) {
      console.error(
        "Invalid Supabase URL format:",
        this.credentials.supabaseUrl,
      );
      return false;
    }

    if (!this.validateApiKey(this.credentials.apiKey)) {
      console.error("Invalid API key format");
      return false;
    }

    this.baseUrl = this.credentials.supabaseUrl;
    this.apiKey = this.credentials.apiKey;
    return true;
  }

  /**
   * Ensure database is connected
   * @private
   */
  ensureConnected() {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }
  }

  /**
   * Validate Supabase URL format
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid
   */
  validateSupabaseUrl(url) {
    if (!url || typeof url !== "string") return false;

    try {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === "https:";
      const isLocalhost = urlObj.hostname.includes("localhost");
      const isSupabase = urlObj.hostname.includes("supabase.co");

      if (!isHttps && !isLocalhost) return false;
      if (!isSupabase && !isLocalhost) return false;

      return true;
    } catch (_error) {
      return false;
    }
  }

  /**
   * Ensure timestamp is a valid integer for bigint compatibility
   * @param {number} timestamp - Timestamp value
   * @returns {number} Integer timestamp
   */
  normalizeTimestamp(timestamp) {
    return timestamp == null || isNaN(timestamp)
      ? Date.now()
      : Math.floor(Number(timestamp));
  }

  parseContentRangeCount(response) {
    const countHeader = response.headers.get("Content-Range");
    if (!countHeader) {
      return null;
    }

    const match = countHeader.match(/\/(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Initialize the Supabase connection
   * @returns {Promise<boolean>} Success status
   */
  async init() {
    try {
      if (!(await this.loadCredentials())) {
        return false;
      }

      // Test connection and ensure schema
      await this.ensureSchema();

      this.isInitialized = true;
      this.isConnected = true;

      return true;
    } catch (error) {
      console.error("Failed to initialize Supabase provider:", error.message);
      this.isInitialized = false;
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Check if the database table exists
   * @returns {Promise<boolean>} True if table exists and is accessible
   */
  async checkTableExists() {
    try {
      if (!this.baseUrl || !this.apiKey) {
        const loaded = await this.loadCredentials();
        if (!loaded) {
          return false;
        }
      }

      const response = await this.makeRequest(
        "HEAD",
        this.getTableProbePath(),
        null,
        {
          Prefer: "count=exact",
          "Range-Unit": "items",
          Range: "0-0",
        },
        { throwOnHttpError: false, useCircuitBreaker: false },
      );
      return response.ok;
    } catch (error) {
      console.debug("Table existence check failed:", error);
      return false;
    }
  }

  /**
   * Ensure database schema exists
   * @private
   */
  async ensureSchema() {
    try {
      if (await this.checkTableExists()) {
        return;
      }

      console.error("Table does not exist. Create it with this SQL:");
      console.error(`CREATE TABLE IF NOT EXISTS ${this.tableName} (
  str_ident VARCHAR(255) PRIMARY KEY,
  int_timestamp BIGINT NOT NULL,
  str_title TEXT,
  int_count INTEGER DEFAULT 1 NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);`);

      throw new Error(
        "Database table does not exist. Please create it using the SQL above.",
      );
    } catch (error) {
      if (error.message.includes("Database table does not exist")) throw error;
      console.error("Failed to ensure schema:", error.message);
      throw error;
    }
  }

  async retryRequest(requestFn, retries = this.maxRetries, attempt = 1) {
    try {
      return await requestFn();
    } catch (error) {
      if (retries > 0 && this.isRetryableError(error)) {
        const delay = Math.min(
          this.retryDelay * Math.pow(2, attempt - 1),
          10000,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.retryRequest(requestFn, retries - 1, attempt + 1);
      }
      throw error;
    }
  }

  isRetryableError(error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("cors") ||
      message.includes("failed to fetch") ||
      message.includes("abort")
    );
  }

  /**
   * Make HTTP request to Supabase PostgREST API
   * Protected by circuit breaker to prevent cascading failures
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @param {Object} body - Request body
   * @param {Object} headers - Additional headers
   * @param {Object} options - Request options
   * @param {boolean} options.throwOnHttpError - Throw for non-2xx responses
   * @param {boolean} options.useCircuitBreaker - Apply circuit breaker checks
   * @returns {Promise<Response>} Fetch response
   */
  async makeRequest(method, path, body = null, headers = {}, options = {}) {
    const { throwOnHttpError = true, useCircuitBreaker = true } = options;

    // Check circuit breaker before making request
    if (useCircuitBreaker) {
      const circuitCheck = this.checkCircuitBreaker();
      if (!circuitCheck.allowed) {
        throw new Error(circuitCheck.reason);
      }
    }

    const url = `${this.baseUrl}/rest/v1${path}`;

    // Security headers
    const requestHeaders = {
      "Content-Type": "application/json",
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      "X-Client-Info": "youtube-watchmarker-extension",
      // Add security headers
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Prefer: "return=representation",
      ...headers,
    };

    const config = {
      method,
      headers: requestHeaders,
      // Reduced timeout from 60s to 15s for faster failure detection
      signal: this.createTimeoutSignal(15000),
    };

    if (body && method !== "GET" && method !== "HEAD") {
      config.body = JSON.stringify(body);
    }

    const requestFn = async () => {
      try {
        const response = await fetch(url, config);

        if (!response.ok && throwOnHttpError) {
          const errorText = await response.text();
          throw new Error(
            `HTTP ${response.status}: ${errorText || response.statusText}`,
          );
        }

        // Success - reset circuit breaker
        if (response.ok && useCircuitBreaker) {
          this.recordSuccess();
        }
        return response;
      } catch (error) {
        // Record failure for circuit breaker
        if (useCircuitBreaker) {
          this.recordFailure();
        }
        throw error;
      }
    };

    return this.retryRequest(requestFn);
  }

  /**
   * Test database connection
   * @returns {Promise<boolean>} Connection status
   */
  async testConnection() {
    try {
      if (!this.baseUrl || !this.apiKey) {
        const loaded = await this.loadCredentials();
        if (!loaded) {
          return false;
        }
      }

      const response = await this.makeRequest(
        "HEAD",
        `/${this.tableName}?select=str_ident`,
        null,
        {
          Prefer: "count=exact",
          "Range-Unit": "items",
          Range: "0-0",
        },
      );

      this.isConnected = response.ok;
      return this.isConnected;
    } catch (error) {
      console.error("Supabase connection test failed:", error.message);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Get a single video record by ID
   * @param {string} videoId - YouTube video ID
   * @returns {Promise<Object|null>} Video record or null
   */
  async getVideo(videoId) {
    try {
      this.ensureConnected();

      const response = await this.makeRequest(
        "GET",
        `/${this.tableName}?str_ident=eq.${videoId}&select=str_ident,int_timestamp,str_title,int_count&limit=1`,
      );

      if (!response.ok) {
        throw new Error(`Failed to get video: ${response.status}`);
      }

      const data = await response.json();

      if (data.length === 0) {
        return null;
      }

      const row = data[0];
      return {
        strIdent: row.str_ident,
        intTimestamp: parseInt(row.int_timestamp),
        strTitle: row.str_title,
        intCount: parseInt(row.int_count),
      };
    } catch (error) {
      console.error("Failed to get video:", error.message);
      throw error;
    }
  }

  /**
   * Store or update a video record
   * @param {Object} video - Video data
   * @param {string} video.strIdent - YouTube video ID
   * @param {number} video.intTimestamp - Timestamp
   * @param {string} video.strTitle - Video title
   * @param {number} video.intCount - View count
   * @returns {Promise<boolean>} Success status
   */
  async putVideo(video) {
    try {
      this.ensureConnected();

      const { strIdent, intTimestamp, strTitle, intCount = 1 } = video;

      // Use upsert with conflict resolution
      const videoData = {
        str_ident: strIdent,
        int_timestamp: this.normalizeTimestamp(intTimestamp),
        str_title: strTitle,
        int_count: intCount,
        updated_at: new Date().toISOString(),
      };

      const response = await this.makeRequest(
        "POST",
        `/${this.tableName}?on_conflict=str_ident`,
        videoData,
        {
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
      );

      return response.ok;
    } catch (error) {
      console.error("Failed to put video:", error.message);
      throw error;
    }
  }

  /**
   * Get all video records
   * @returns {Promise<Array>} Array of video records
   */
  async getAllVideos() {
    try {
      this.ensureConnected();

      const allVideos = [];
      let offset = 0;
      const limit = 1000; // Use reasonable batch size
      let hasMore = true;

      while (hasMore) {
        const response = await this.makeRequest(
          "GET",
          `/${this.tableName}?select=str_ident,int_timestamp,str_title,int_count&order=int_timestamp.desc&limit=${limit}&offset=${offset}`,
        );

        if (!response.ok) {
          throw new Error(`Failed to get all videos: ${response.status}`);
        }

        const data = await response.json();

        if (data.length === 0) {
          hasMore = false;
        } else {
          const videos = data.map((row) => ({
            strIdent: row.str_ident,
            intTimestamp: parseInt(row.int_timestamp),
            strTitle: row.str_title,
            intCount: parseInt(row.int_count),
          }));

          allVideos.push(...videos);
          offset += limit;

          // If we got fewer records than the limit, we've reached the end
          if (data.length < limit) {
            hasMore = false;
          }
        }
      }

      return allVideos;
    } catch (error) {
      console.error("Failed to get all videos:", error.message);
      throw error;
    }
  }

  /**
   * Get video count
   * @returns {Promise<number>} Total number of videos
   */
  async getVideoCount() {
    try {
      this.ensureConnected();

      const response = await this.makeRequest(
        "HEAD",
        `/${this.tableName}?select=str_ident`,
        null,
        {
          Prefer: "count=exact",
          "Range-Unit": "items",
          Range: "0-0",
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to get video count: ${response.status}`);
      }

      const count = this.parseContentRangeCount(response);
      if (count !== null) {
        return count;
      }

      // Fallback: get all and count
      const data = await this.getAllVideos();
      return data.length;
    } catch (error) {
      console.error("Failed to get video count:", error.message);
      throw error;
    }
  }

  /**
   * Clear all video records
   * @returns {Promise<boolean>} Success status
   */
  async clearAllVideos() {
    try {
      this.ensureConnected();

      const response = await this.makeRequest(
        "DELETE",
        `/${this.tableName}?str_ident=neq.`,
      );

      console.log("All videos cleared from Supabase");
      return response.ok;
    } catch (error) {
      console.error("Failed to clear all videos:", error.message);
      throw error;
    }
  }

  /**
   * Delete a single video record by ID
   * @param {string} videoId - YouTube video ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteVideo(videoId) {
    try {
      this.ensureConnected();

      const response = await this.makeRequest(
        "DELETE",
        `/${this.tableName}?str_ident=eq.${videoId}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to delete video: ${response.status}`);
      }

      return true;
    } catch (error) {
      console.error("Failed to delete video:", error.message);
      throw error;
    }
  }

  /**
   * Import multiple videos (batch operation)
   * @param {Array} videos - Array of video objects
   * @returns {Promise<boolean>} Success status
   */
  async importVideos(videos) {
    try {
      this.ensureConnected();

      if (!videos || videos.length === 0) {
        return true;
      }

      // Prepare data for batch insert
      const videoData = videos.map((video) => ({
        str_ident: video.strIdent,
        int_timestamp: this.normalizeTimestamp(video.intTimestamp),
        str_title: video.strTitle,
        int_count: video.intCount || 1,
        updated_at: new Date().toISOString(),
      }));

      // PostgREST supports batch operations
      const response = await this.makeRequest(
        "POST",
        `/${this.tableName}?on_conflict=str_ident`,
        videoData,
        {
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
      );

      return response.ok;
    } catch (error) {
      console.error("Failed to import videos:", error.message);
      throw error;
    }
  }

  /**
   * Search videos by title
   * @param {string} query - Search query
   * @param {number} limit - Maximum results
   * @returns {Promise<Array>} Array of matching video records
   */
  async searchVideos(query, limit = 100) {
    try {
      this.ensureConnected();

      const response = await this.makeRequest(
        "GET",
        `/${this.tableName}?str_title=ilike.*${encodeURIComponent(query)}*&select=str_ident,int_timestamp,str_title,int_count&order=int_timestamp.desc&limit=${limit}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to search videos: ${response.status}`);
      }

      const data = await response.json();

      return data.map((row) => ({
        strIdent: row.str_ident,
        intTimestamp: parseInt(row.int_timestamp),
        strTitle: row.str_title,
        intCount: parseInt(row.int_count),
      }));
    } catch (error) {
      console.error("Failed to search videos:", error.message);
      throw error;
    }
  }

  /**
   * Get videos by date range
   * @param {number} startTimestamp - Start timestamp
   * @param {number} endTimestamp - End timestamp
   * @returns {Promise<Array>} Array of video records
   */
  async getVideosByDateRange(startTimestamp, endTimestamp) {
    try {
      this.ensureConnected();

      const allVideos = [];
      let offset = 0;
      const limit = 1000; // Use reasonable batch size
      let hasMore = true;

      while (hasMore) {
        const response = await this.makeRequest(
          "GET",
          `/${this.tableName}?int_timestamp=gte.${this.normalizeTimestamp(startTimestamp)}&int_timestamp=lte.${this.normalizeTimestamp(endTimestamp)}&select=str_ident,int_timestamp,str_title,int_count&order=int_timestamp.desc&limit=${limit}&offset=${offset}`,
        );

        if (!response.ok) {
          throw new Error(
            `Failed to get videos by date range: ${response.status}`,
          );
        }

        const data = await response.json();

        if (data.length === 0) {
          hasMore = false;
        } else {
          const videos = data.map((row) => ({
            strIdent: row.str_ident,
            intTimestamp: parseInt(row.int_timestamp),
            strTitle: row.str_title,
            intCount: parseInt(row.int_count),
          }));

          allVideos.push(...videos);
          offset += limit;

          // If we got fewer records than the limit, we've reached the end
          if (data.length < limit) {
            hasMore = false;
          }
        }
      }

      return allVideos;
    } catch (error) {
      console.error("Failed to get videos by date range:", error.message);
      throw error;
    }
  }

  /**
   * Get database statistics
   * @returns {Promise<Object>} Database statistics
   */
  async getStatistics() {
    try {
      if (!this.isConnected) throw new Error("Database not connected");

      const totalVideos = await this.getVideoCount();

      // Get timestamp range
      const oldestResponse = await this.makeRequest(
        "GET",
        `/${this.tableName}?select=int_timestamp&order=int_timestamp.asc&limit=1`,
      );
      const newestResponse = await this.makeRequest(
        "GET",
        `/${this.tableName}?select=int_timestamp&order=int_timestamp.desc&limit=1`,
      );

      const oldestData = await oldestResponse.json();
      const newestData = await newestResponse.json();

      return {
        totalVideos,
        oldestTimestamp:
          oldestData.length > 0 ? parseInt(oldestData[0].int_timestamp) : 0,
        newestTimestamp:
          newestData.length > 0 ? parseInt(newestData[0].int_timestamp) : 0,
        totalViews: totalVideos, // Simplified: assume 1 view per video
        avgViewsPerVideo: 1,
      };
    } catch (error) {
      console.error("Failed to get statistics:", error.message);
      throw error;
    }
  }

  /**
   * Close database connection
   * @returns {Promise<boolean>} Success status
   */
  async close() {
    try {
      // HTTP connections don't need explicit closing
      this.isConnected = false;
      this.baseUrl = null;
      this.apiKey = null;

      console.log("Supabase provider closed");
      return true;
    } catch (error) {
      console.error("Failed to close Supabase provider:", error.message);
      return false;
    }
  }

  /**
   * Get provider information
   * @returns {Object} Provider info
   */
  getProviderInfo() {
    return {
      name: "Supabase",
      type: "remote",
      isConnected: this.isConnected,
      isInitialized: this.isInitialized,
      url: this.baseUrl,
      tableName: this.tableName,
      circuitBreaker: this.getCircuitBreakerStatus(),
    };
  }
}

// Create singleton instance
export const supabaseDatabaseProvider = new SupabaseDatabaseProvider();
