// @ts-check

/**
 * Database provider action handlers
 * Handles provider switching, status, syncing, and migration
 */

import { logger } from '../logger.js';
import { ErrorUtils } from '../error-handler.js';
import { credentialStorage } from '../credential-storage.js';

/**
 * Get database provider status
 * @param {Object} request - Request object
 * @param {Object} providerFactory - Provider factory instance
 * @returns {Promise<Object>} Provider status
 */
export async function handleProviderStatus(request, providerFactory) {
    try {
        const status = providerFactory.getProviderStatus();
        return { success: true, status };
    } catch (error) {
        logger.error('Failed to get provider status:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Switch database provider
 * @param {Object} request - Request with provider field
 * @param {Object} providerFactory - Provider factory instance
 * @returns {Promise<Object>} Switch result
 */
export async function handleProviderSwitch(request, providerFactory) {
    try {
        const { provider } = request;

        if (!provider || !['indexeddb', 'supabase'].includes(provider)) {
            return { success: false, error: 'Invalid provider type' };
        }

        if (provider === 'indexeddb') {
            const success = await providerFactory.switchToIndexedDB();
            if (success) {
                return { success: true, message: `Successfully switched to ${provider}` };
            } else {
                return { success: false, error: `Failed to switch to ${provider}` };
            }
        } else if (provider === 'supabase') {
            await providerFactory.switchToSupabase();
            return { success: true, message: `Successfully switched to ${provider}` };
        }
    } catch (error) {
        logger.error('Failed to switch provider:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Get available providers
 * @param {Object} request - Request object
 * @param {Object} providerFactory - Provider factory instance
 * @returns {Promise<Object>} Available providers
 */
export async function handleProviderList(request, providerFactory) {
    try {
        const providers = await providerFactory.getAvailableProviders();
        return { success: true, providers };
    } catch (error) {
        logger.error('Failed to get available providers:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Migrate data between providers
 * @param {Object} request - Request with fromProvider and toProvider
 * @param {Object} providerFactory - Provider factory instance
 * @returns {Promise<Object>} Migration result
 */
export async function handleProviderMigrate(request, providerFactory) {
    try {
        const { fromProvider, toProvider } = request;

        if (!fromProvider || !toProvider) {
            return { success: false, error: 'Missing source or target provider' };
        }

        const success = await providerFactory.migrateData(fromProvider, toProvider);
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
 * @param {Object} providerFactory - Provider factory instance
 * @returns {Promise<Object>} Sync result
 */
export async function handleProviderSync(request, providerFactory) {
    try {
        const { providers } = request;

        if (!providers || !Array.isArray(providers) || providers.length !== 2) {
            return { success: false, error: 'Invalid providers array' };
        }

        const success = await providerFactory.syncProviders(providers[0], providers[1]);
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
 * @param {Object} request - Request object
 * @returns {Promise<Object>} Test result
 */
export async function handleSupabaseTest(request) {
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
 * @param {Object} request - Request object
 * @returns {Promise<Object>} Clear result
 */
export async function handleSupabaseClear(request) {
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
 * @param {Object} request - Request object
 * @returns {Promise<Object>} Credentials result
 */
export async function handleSupabaseGetCredentials(request) {
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
 * @param {Object} request - Request object
 * @returns {Promise<Object>} Status result
 */
export async function handleSupabaseGetStatus(request) {
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
 * @param {Object} request - Request object
 * @param {Object} providerFactory - Provider factory instance
 * @returns {Promise<Object>} Table check result
 */
export async function handleSupabaseCheckTable(request, providerFactory) {
    try {
        const currentProvider = providerFactory.getCurrentProvider();
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
