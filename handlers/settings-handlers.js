// @ts-check

/**
 * Settings action handlers
 * Handles getting and setting extension settings
 */

import { logger } from '../logger.js';
import { ErrorUtils } from '../error-handler.js';
import { settingsManager } from '../settings-manager.js';

/**
 * Get a setting value
 * @param {Object} request - Request with key field
 * @returns {Promise<Object>} Setting value
 */
export async function handleGetSetting(request) {
    try {
        const { key } = request;
        const value = await settingsManager.getSetting(key);
        return { success: true, value };
    } catch (error) {
        logger.error('Error getting setting:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Set a setting value
 * @param {Object} request - Request with key and value fields
 * @returns {Promise<Object>} Set result
 */
export async function handleSetSetting(request) {
    try {
        const { key, value } = request;
        await settingsManager.setSetting(key, value);
        return { success: true };
    } catch (error) {
        logger.error('Error setting setting:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}
