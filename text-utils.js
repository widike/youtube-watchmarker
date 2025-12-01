// @ts-check

/**
 * Text utilities for YouTube Watchmarker
 * Handles text encoding, decoding, and HTML entity processing
 */

/**
 * Fixes UTF-8 double encoding issues in text strings
 * Converts Latin-1 misinterpreted UTF-8 back to proper UTF-8
 * @param {string} text - Text that may have UTF-8 double encoding issues
 * @returns {string} Properly decoded UTF-8 text
 */
export function fixUtf8DoubleEncoding(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    try {
        // First, encode the string as Latin-1 to get the original UTF-8 bytes
        const latin1Bytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) {
            latin1Bytes[i] = text.charCodeAt(i) & 0xFF;
        }

        // Then decode as UTF-8 using TextDecoder
        const decoder = new TextDecoder('utf-8', { fatal: false });
        const decoded = decoder.decode(latin1Bytes);

        // Only return the decoded version if it's different and seems valid
        // (contains fewer replacement characters or obvious improvements)
        if (decoded !== text && decoded.length > 0) {
            // Check if the decoding actually improved the text
            // by looking for common UTF-8 double encoding patterns
            const commonPatterns = [
                'Ã¤', 'Ã¶', 'Ã¼', 'ÃŸ', // German umlauts
                'Ã¡', 'Ã©', 'Ã­', 'Ã³', 'Ãº', // Spanish accents
                'Ã ', 'Ã¨', 'Ã¬', 'Ã²', 'Ã¹', // More accents
                'Ã¢', 'Ãª', 'Ã®', 'Ã´', 'Ã»', // Circumflex accents
                'Ã£', 'Ã±', 'Ã§', // Other common UTF-8 patterns
                'â€™', 'â€œ', 'â€', // Smart quotes
                'â€¢', 'â€"', 'â€"' // Bullets and dashes
            ];

            const hasDoubleEncodingPatterns = commonPatterns.some(pattern => text.includes(pattern));
            const hasFewerReplacementChars = (decoded.match(/�/g) || []).length < (text.match(/�/g) || []).length;

            if (hasDoubleEncodingPatterns || hasFewerReplacementChars) {
                return decoded;
            }
        }

        return text;
    } catch (error) {
        console.warn('Failed to fix UTF-8 double encoding:', error);
        return text;
    }
}

/**
 * Enhanced HTML entity decoder that also handles UTF-8 double encoding
 * @param {string} text - Text to decode
 * @returns {string} Decoded text
 */
export function decodeHtmlEntitiesAndFixEncoding(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    // First fix UTF-8 double encoding
    let decoded = fixUtf8DoubleEncoding(text);

    // Then decode common HTML entities
    const entityMap = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'",
        '&nbsp;': ' ',
        '&copy;': '©',
        '&reg;': '®',
        '&trade;': '™',
        '&euro;': '€',
        '&pound;': '£',
        '&yen;': '¥',
        '&cent;': '¢'
    };

    for (const [entity, char] of Object.entries(entityMap)) {
        decoded = decoded.replaceAll(entity, char);
    }

    // Handle numeric HTML entities
    decoded = decoded.replace(/&#(\d+);/g, (match, num) => {
        return String.fromCharCode(parseInt(num, 10));
    });

    decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
    });

    return decoded;
}

