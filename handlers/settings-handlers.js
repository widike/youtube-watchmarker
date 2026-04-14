// @ts-check

/**
 * Settings action handlers
 * Handles getting and setting extension settings
 */

import { settingsManager } from "../settings-manager.js";
import { createHandler } from "../handler-wrapper.js";

/**
 * Get a setting value
 */
export const handleGetSetting = createHandler(async (request) => {
  const { key } = request;
  const value = await settingsManager.getSetting(key);
  return { value };
}, "handleGetSetting");

/**
 * Set a setting value
 */
export const handleSetSetting = createHandler(async (request) => {
  const { key, value } = request;
  await settingsManager.setSetting(key, value);
  return {};
}, "handleSetSetting");
