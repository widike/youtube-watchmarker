// @ts-check

/**
 * Database provider action handlers
 * Handles provider switching, status, syncing, and migration
 */

import { credentialStorage } from '../credential-storage.js';
import { databaseProviderFactory } from '../database-provider-factory.js';
import { createHandler } from '../handler-wrapper.js';

/**
 * Get database provider status
 */
export const handleProviderStatus = createHandler(
    async () => {
        const status = databaseProviderFactory.getProviderStatus();
        return { status };
    },
    { name: 'handleProviderStatus', requiresRequest: false }
);

/**
 * Switch database provider
 */
export const handleProviderSwitch = createHandler(
    async (request) => {
        const { provider } = request;

        if (!provider || !['indexeddb', 'supabase'].includes(provider)) {
            return { success: false, error: 'Invalid provider type' };
        }

        if (provider === 'indexeddb') {
            const success = await databaseProviderFactory.switchToIndexedDB();
            if (success) {
                return { message: `Successfully switched to ${provider}` };
            } else {
                return { success: false, error: `Failed to switch to ${provider}` };
            }
        } else if (provider === 'supabase') {
            await databaseProviderFactory.switchToSupabase();
            return { message: `Successfully switched to ${provider}` };
        }
    },
    'handleProviderSwitch'
);

/**
 * Get available providers
 */
export const handleProviderList = createHandler(
    async () => {
        const providers = await databaseProviderFactory.getAvailableProviders();
        return { providers };
    },
    { name: 'handleProviderList', requiresRequest: false }
);

/**
 * Migrate data between providers
 */
export const handleProviderMigrate = createHandler(
    async (request) => {
        const { fromProvider, toProvider } = request;

        if (!fromProvider || !toProvider) {
            return { success: false, error: 'Missing source or target provider' };
        }

        const success = await databaseProviderFactory.migrateData(fromProvider, toProvider);
        if (success) {
            return { message: `Successfully migrated data from ${fromProvider} to ${toProvider}` };
        } else {
            return { success: false, error: 'Migration failed' };
        }
    },
    'handleProviderMigrate'
);

/**
 * Sync data between providers
 */
export const handleProviderSync = createHandler(
    async (request) => {
        const { providers } = request;

        if (!providers || !Array.isArray(providers) || providers.length !== 2) {
            return { success: false, error: 'Invalid providers array' };
        }

        const success = await databaseProviderFactory.syncProviders(providers[0], providers[1]);
        if (success) {
            return { message: `Successfully synced data between ${providers[0]} and ${providers[1]}` };
        } else {
            return { success: false, error: 'Sync failed' };
        }
    },
    'handleProviderSync'
);

/**
 * Configure Supabase credentials
 */
export const handleSupabaseConfigure = createHandler(
    async (request) => {
        const { credentials } = request;

        if (!credentials) {
            return { success: false, error: 'No credentials provided' };
        }

        await credentialStorage.storeCredentials(credentials);
        return { message: 'Supabase configuration saved successfully' };
    },
    'handleSupabaseConfigure'
);

/**
 * Test Supabase connection
 */
export const handleSupabaseTest = createHandler(
    async () => {
        const success = await credentialStorage.testConnection();
        if (success) {
            return { message: 'Supabase connection test successful' };
        } else {
            return { success: false, error: 'Supabase connection test failed' };
        }
    },
    { name: 'handleSupabaseTest', requiresRequest: false }
);

/**
 * Clear Supabase configuration
 */
export const handleSupabaseClear = createHandler(
    async () => {
        await credentialStorage.clearCredentials();
        return { message: 'Supabase configuration cleared successfully' };
    },
    { name: 'handleSupabaseClear', requiresRequest: false }
);

/**
 * Get Supabase credentials (masked)
 */
export const handleSupabaseGetCredentials = createHandler(
    async () => {
        const credentials = await credentialStorage.getMaskedCredentials();
        return { credentials };
    },
    { name: 'handleSupabaseGetCredentials', requiresRequest: false }
);

/**
 * Get Supabase status
 */
export const handleSupabaseGetStatus = createHandler(
    async () => {
        const status = await credentialStorage.getCredentialStatus();
        return { status };
    },
    { name: 'handleSupabaseGetStatus', requiresRequest: false }
);

/**
 * Check if Supabase table exists
 */
export const handleSupabaseCheckTable = createHandler(
    async () => {
        const currentProvider = databaseProviderFactory.getCurrentProvider();
        if (!currentProvider || !currentProvider.checkTableExists) {
            return { success: false, error: 'Supabase provider not available' };
        }

        const exists = await currentProvider.checkTableExists();
        return { tableExists: exists };
    },
    { name: 'handleSupabaseCheckTable', requiresRequest: false }
);
