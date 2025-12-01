/**
 * Validation utilities for YouTube Watchmarker
 * Centralized validation logic to avoid duplication
 */

import { REGEX } from './constants.js';

/**
 * Validates if a string is valid base64
 * @param {string} str - String to check
 * @returns {boolean} True if valid base64
 */
export function isValidBase64(str) {
    if (typeof str !== 'string' || str.length === 0) {
        return false;
    }

    // Base64 strings should only contain valid characters and proper padding
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;

    // Check basic format
    if (!base64Regex.test(str)) {
        return false;
    }

    // Base64 strings should be divisible by 4 (with padding)
    if (str.length % 4 !== 0) {
        return false;
    }

    // Try to decode to verify it's actually valid base64
    try {
        const decoded = atob(str);
        // Additional check: decoded content should look like JSON (start with [ or {)
        const trimmed = decoded.trim();
        return trimmed.startsWith('[') || trimmed.startsWith('{');
    } catch (error) {
        return false;
    }
}

/**
 * Validates if a video ID is in the correct format
 * @param {string} videoId - Video ID to validate
 * @returns {boolean} True if valid
 */
export function isValidVideoId(videoId) {
    if (!videoId || typeof videoId !== 'string') {
        return false;
    }
    return REGEX.VIDEO_ID.test(videoId);
}

/**
 * Validates if a video title is meaningful and not a generic placeholder
 * @param {string} title - Video title to validate
 * @returns {boolean} True if title is valid and meaningful
 */
export function isValidVideoTitle(title) {
    if (!title || typeof title !== 'string') {
        return false;
    }

    const trimmedTitle = title.trim();

    // Check if title is empty or too short
    if (trimmedTitle.length < 2) {
        return false;
    }

    // List of generic/invalid titles to avoid
    const invalidTitles = [
        'YouTube',
        'Youtube',
        'YOUTUBE',
        'Video',
        'Untitled',
        'Loading...',
        'Loading',
        '...',
        'Private video',
        'Deleted video',
        '[Deleted video]',
        '[Private video]',
        'Video unavailable'
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
        /^\[.*\]$/, // Anything in brackets like "[Private video]"
        /^\.{3,}$/, // Just dots
        /^-+$/, // Just dashes
        /^_+$/, // Just underscores
    ];

    // Check if title matches any generic pattern
    if (genericPatterns.some(pattern => pattern.test(trimmedTitle))) {
        return false;
    }

    // Title seems valid
    return true;
}

/**
 * Validates if a URL is a YouTube URL
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid YouTube URL
 */
export function isYouTubeUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }
    return REGEX.YOUTUBE_URL.test(url);
}

/**
 * Validates if a URL is a Supabase URL
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid Supabase URL
 */
export function isSupabaseUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }
    return REGEX.SUPABASE_URL.test(url);
}

/**
 * Validates a video record object
 * @param {Object} video - Video record to validate
 * @returns {{valid: boolean, errors: string[]}} Validation result
 */
export function validateVideoRecord(video) {
    const errors = [];

    if (!video || typeof video !== 'object') {
        errors.push('Video must be an object');
        return { valid: false, errors };
    }

    // Check required fields
    if (!video.strIdent) {
        errors.push('Missing required field: strIdent');
    } else if (!isValidVideoId(video.strIdent)) {
        errors.push('Invalid video ID format');
    }

    if (typeof video.intTimestamp !== 'number') {
        errors.push('intTimestamp must be a number');
    } else if (video.intTimestamp < 0) {
        errors.push('intTimestamp must be positive');
    }

    if (video.strTitle !== undefined && typeof video.strTitle !== 'string') {
        errors.push('strTitle must be a string');
    }

    if (video.intCount !== undefined && typeof video.intCount !== 'number') {
        errors.push('intCount must be a number');
    } else if (video.intCount !== undefined && video.intCount < 1) {
        errors.push('intCount must be at least 1');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Sanitizes a video record by ensuring all fields are correct types
 * @param {Object} video - Video record to sanitize
 * @returns {Object} Sanitized video record
 */
export function sanitizeVideoRecord(video) {
    return {
        strIdent: String(video.strIdent || ''),
        intTimestamp: Number(video.intTimestamp) || Date.now(),
        strTitle: String(video.strTitle || ''),
        intCount: Number(video.intCount) || 1
    };
}
