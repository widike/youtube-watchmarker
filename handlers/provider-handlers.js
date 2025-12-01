// @ts-check

/**
 * Database provider action handlers
 * Handles provider switching, status, syncing, and migration
 */

import { logger } from '../logger.js';
import { ErrorUtils } from '../error-handler.js';
import { credentialStorage } from '../credential-storage.js';
import { databaseProviderFactory } from '../database-provider-factory.js';

/**
 * Get database provider status
 * @returns {Promise<Object>} Provider status
 */
export async function handleProviderStatus() {
    try {
        const status = databaseProviderFactory.getProviderStatus();
        return { success: true, status };
    } catch (error) {
        logger.error('Failed to get provider status:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Switch database provider
 * @param {Object} request - Request with provider field
 * @returns {Promise<Object>} Switch result
 */
export async function handleProviderSwitch(request) {
    try {
        const { provider } = request;

        if (!provider || !['indexeddb', 'supabase'].includes(provider)) {
            return { success: false, error: 'Invalid provider type' };
        }

        if (provider === 'indexeddb') {
            const success = await databaseProviderFactory.switchToIndexedDB();
            if (success) {
                return { success: true, message: `Successfully switched to ${provider}` };
            } else {
                return { success: false, error: `Failed to switch to ${provider}` };
            }
        } else if (provider === 'supabase') {
            await databaseProviderFactory.switchToSupabase();
            return { success: true, message: `Successfully switched to ${provider}` };
        }
    } catch (error) {
        logger.error('Failed to switch provider:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Get available providers
 * @returns {Promise<Object>} Available providers
 */
export async function handleProviderList() {
    try {
        const providers = await databaseProviderFactory.getAvailableProviders();
        return { success: true, providers };
    } catch (error) {
        logger.error('Failed to get available providers:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Migrate data between providers
 * @param {Object} request - Request with fromProvider and toProvider
 * @returns {Promise<Object>} Migration result
 */
export async function handleProviderMigrate(request) {
    try {
        const { fromProvider, toProvider } = request;

        if (!fromProvider || !toProvider) {
            return { success: false, error: 'Missing source or target provider' };
        }

        const success = await databaseProviderFactory.migrateData(fromProvider, toProvider);
        if (success) {
            return {
                success: true,
                message: `Successfully migrated data from ${fromProvider} to ${toProvider}`
            };
        } else {
            return { success: false, error: 'Migration failed' };
        }
    } catch (error) {
        logger.error('Failed to migrate data:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Sync data between providers
 * @param {Object} request - Request with providers array
 * @returns {Promise<Object>} Sync result
 */
export async function handleProviderSync(request) {
    try {
        const { providers } = request;

        if (!providers || !Array.isArray(providers) || providers.length !== 2) {
            return { success: false, error: 'Invalid providers array' };
        }

        const success = await databaseProviderFactory.syncProviders(providers[0], providers[1]);
        if (success) {
            return {
                success: true,
                message: `Successfully synced data between ${providers[0]} and ${providers[1]}`
            };
        } else {
            return { success: false, error: 'Sync failed' };
        }
    } catch (error) {
        logger.error('Failed to sync providers:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Configure Supabase credentials
 * @param {Object} request - Request with credentials
 * @returns {Promise<Object>} Configuration result
 */
export async function handleSupabaseConfigure(request) {
    // Note: request parameter is used in this function
    try {
        const { credentials } = request;

        if (!credentials) {
            return { success: false, error: 'No credentials provided' };
        }

        await credentialStorage.storeCredentials(credentials);
        return { success: true, message: 'Supabase configuration saved successfully' };
    } catch (error) {
        logger.error('Failed to configure Supabase:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Test Supabase connection
 * @returns {Promise<Object>} Test result
 */
export async function handleSupabaseTest() {
    try {
        const success = await credentialStorage.testConnection();
        if (success) {
            return { success: true, message: 'Supabase connection test successful' };
        } else {
            return { success: false, error: 'Supabase connection test failed' };
        }
    } catch (error) {
        logger.error('Supabase connection test failed:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Clear Supabase configuration
 * @returns {Promise<Object>} Clear result
 */
export async function handleSupabaseClear() {
    try {
        await credentialStorage.clearCredentials();
        return { success: true, message: 'Supabase configuration cleared successfully' };
    } catch (error) {
        logger.error('Failed to clear Supabase configuration:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Get Supabase credentials (masked)
 * @returns {Promise<Object>} Credentials result
 */
export async function handleSupabaseGetCredentials() {
    try {
        const credentials = await credentialStorage.getMaskedCredentials();
        return { success: true, credentials };
    } catch (error) {
        logger.error('Failed to get Supabase credentials:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Get Supabase status
 * @returns {Promise<Object>} Status result
 */
export async function handleSupabaseGetStatus() {
    try {
        const status = await credentialStorage.getCredentialStatus();
        return { success: true, status };
    } catch (error) {
        logger.error('Failed to get Supabase status:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Check if Supabase table exists
 * @returns {Promise<Object>} Table check result
 */
export async function handleSupabaseCheckTable() {
    try {
        const currentProvider = databaseProviderFactory.getCurrentProvider();
        if (!currentProvider || !currentProvider.checkTableExists) {
            return { success: false, error: 'Supabase provider not available' };
        }

        const exists = await currentProvider.checkTableExists();
        return { success: true, tableExists: exists };
    } catch (error) {
        logger.error('Error checking Supabase table:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}
