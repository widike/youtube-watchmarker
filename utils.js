/**
 * Legacy utilities file - now re-exports from focused modules
 * This file maintains backward compatibility
 * New code should import directly from the specific modules:
 * - storage-utils.js
 * - youtube-auth.js
 * - text-utils.js
 * - browser-utils.js
 */

// Re-export everything from the new modular files
export * from './storage-utils.js';
export * from './youtube-auth.js';
export * from './text-utils.js';
export * from './browser-utils.js';

// Re-export from validation for backward compatibility
export { isValidVideoTitle } from './validation.js';
