// @ts-check

/**
 * Sync Queue - Write-behind buffer for Supabase operations
 * Queues write operations and syncs them to Supabase asynchronously,
 * providing resilience against network failures.
 */

import { logger } from './logger.js';

/**
 * Operation types for the sync queue
 */
export const SyncOperationType = {
    PUT_VIDEO: 'PUT_VIDEO',
    DELETE_VIDEO: 'DELETE_VIDEO',
    IMPORT_VIDEOS: 'IMPORT_VIDEOS'
};

/**
 * Sync Queue class
 * Buffers write operations for Supabase and processes them in batches
 */
export class SyncQueue {
    constructor() {
        this.queue = [];
        this.isSyncing = false;
        this.maxBatchSize = 50;
        this.maxRetries = 3;
        this.retryDelayMs = 5000;
        this.autoSyncIntervalMs = 30000; // Auto-sync every 30 seconds
        this.autoSyncInterval = null;
        this.supabaseProvider = null;
        this.storageKey = 'sync_queue_pending';
        this.lastSyncAttempt = 0;
        this.consecutiveFailures = 0;
        this.maxConsecutiveFailures = 5;
    }

    /**
     * Initialize the sync queue
     * @param {Object} supabaseProvider - The Supabase provider instance
     */
    async init(supabaseProvider) {
        this.supabaseProvider = supabaseProvider;
        await this.loadPersistedQueue();
        this.startAutoSync();
        logger.info(`Sync queue initialized with ${this.queue.length} pending operations`);
    }

    /**
     * Load persisted queue from storage (survives service worker restarts)
     */
    async loadPersistedQueue() {
        try {
            const result = await chrome.storage.local.get([this.storageKey]);
            if (result[this.storageKey] && Array.isArray(result[this.storageKey])) {
                this.queue = result[this.storageKey];
                logger.debug(`Loaded ${this.queue.length} operations from persisted queue`);
            }
        } catch (error) {
            logger.warn('Failed to load persisted sync queue:', error);
            this.queue = [];
        }
    }

    /**
     * Persist queue to storage
     */
    async persistQueue() {
        try {
            await chrome.storage.local.set({
                [this.storageKey]: this.queue
            });
        } catch (error) {
            logger.warn('Failed to persist sync queue:', error);
        }
    }

    /**
     * Add an operation to the sync queue
     * @param {string} type - Operation type from SyncOperationType
     * @param {Object} data - Operation data
     */
    async enqueue(type, data) {
        const operation = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type,
            data,
            timestamp: Date.now(),
            retries: 0
        };

        // Deduplicate: remove older operations for the same video
        if (type === SyncOperationType.PUT_VIDEO && data.strIdent) {
            this.queue = this.queue.filter(op =>
                !(op.type === SyncOperationType.PUT_VIDEO && op.data.strIdent === data.strIdent)
            );
        }

        this.queue.push(operation);
        await this.persistQueue();

        logger.debug(`Enqueued ${type} operation, queue size: ${this.queue.length}`);

        // Try to sync immediately if not already syncing
        this.trySync();
    }

    /**
     * Start auto-sync interval
     */
    startAutoSync() {
        if (this.autoSyncInterval) return;

        this.autoSyncInterval = setInterval(() => {
            if (this.queue.length > 0) {
                this.trySync();
            }
        }, this.autoSyncIntervalMs);

        logger.debug('Auto-sync started');
    }

    /**
     * Stop auto-sync interval
     */
    stopAutoSync() {
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
            this.autoSyncInterval = null;
            logger.debug('Auto-sync stopped');
        }
    }

    /**
     * Try to sync queued operations
     * Non-blocking - returns immediately if already syncing
     */
    async trySync() {
        if (this.isSyncing || this.queue.length === 0) {
            return;
        }

        // Check if Supabase is available
        if (!this.supabaseProvider || !this.supabaseProvider.isConnected) {
            logger.debug('Supabase not available, skipping sync');
            return;
        }

        // Check circuit breaker
        const circuitStatus = this.supabaseProvider.getCircuitBreakerStatus();
        if (!circuitStatus.isAvailable) {
            logger.debug(`Circuit breaker open, skipping sync (state: ${circuitStatus.state})`);
            return;
        }

        // Back off if too many consecutive failures
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
            const timeSinceLastAttempt = Date.now() - this.lastSyncAttempt;
            const backoffTime = Math.min(this.consecutiveFailures * this.retryDelayMs, 300000); // Max 5 min
            if (timeSinceLastAttempt < backoffTime) {
                logger.debug(`Backing off sync, ${Math.ceil((backoffTime - timeSinceLastAttempt) / 1000)}s remaining`);
                return;
            }
        }

        this.isSyncing = true;
        this.lastSyncAttempt = Date.now();

        try {
            await this.processQueue();
            this.consecutiveFailures = 0;
        } catch (error) {
            this.consecutiveFailures++;
            logger.warn(`Sync failed (attempt ${this.consecutiveFailures}):`, error.message);
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Process queued operations in batches
     */
    async processQueue() {
        if (this.queue.length === 0) return;

        logger.debug(`Processing sync queue: ${this.queue.length} operations`);

        // Group PUT_VIDEO operations for batch processing
        const putOps = this.queue.filter(op => op.type === SyncOperationType.PUT_VIDEO);
        const otherOps = this.queue.filter(op => op.type !== SyncOperationType.PUT_VIDEO);

        // Process PUT operations in batches
        if (putOps.length > 0) {
            await this.processPutBatch(putOps);
        }

        // Process other operations individually
        for (const op of otherOps) {
            await this.processOperation(op);
        }

        // Persist remaining queue
        await this.persistQueue();

        logger.info(`Sync complete, ${this.queue.length} operations remaining`);
    }

    /**
     * Process a batch of PUT_VIDEO operations
     * @param {Array} operations - PUT_VIDEO operations to process
     */
    async processPutBatch(operations) {
        // Take a batch
        const batch = operations.slice(0, this.maxBatchSize);
        const videos = batch.map(op => op.data);

        try {
            await this.supabaseProvider.importVideos(videos);

            // Remove successful operations from queue
            const batchIds = new Set(batch.map(op => op.id));
            this.queue = this.queue.filter(op => !batchIds.has(op.id));

            logger.debug(`Synced batch of ${batch.length} videos to Supabase`);
        } catch (error) {
            // Increment retry count for failed operations
            batch.forEach(op => {
                const queueOp = this.queue.find(q => q.id === op.id);
                if (queueOp) {
                    queueOp.retries++;
                    if (queueOp.retries >= this.maxRetries) {
                        logger.warn(`Dropping operation after ${this.maxRetries} retries:`, queueOp);
                        this.queue = this.queue.filter(q => q.id !== op.id);
                    }
                }
            });
            throw error;
        }
    }

    /**
     * Process a single operation
     * @param {Object} operation - Operation to process
     */
    async processOperation(operation) {
        try {
            switch (operation.type) {
                case SyncOperationType.DELETE_VIDEO:
                    await this.supabaseProvider.deleteVideo(operation.data.strIdent);
                    break;
                case SyncOperationType.IMPORT_VIDEOS:
                    await this.supabaseProvider.importVideos(operation.data.videos);
                    break;
                default:
                    logger.warn(`Unknown operation type: ${operation.type}`);
            }

            // Remove successful operation from queue
            this.queue = this.queue.filter(op => op.id !== operation.id);
        } catch (error) {
            operation.retries++;
            if (operation.retries >= this.maxRetries) {
                logger.warn(`Dropping operation after ${this.maxRetries} retries:`, operation);
                this.queue = this.queue.filter(op => op.id !== operation.id);
            }
            throw error;
        }
    }

    /**
     * Get queue status
     * @returns {Object} Queue status information
     */
    getStatus() {
        return {
            queueLength: this.queue.length,
            isSyncing: this.isSyncing,
            consecutiveFailures: this.consecutiveFailures,
            lastSyncAttempt: this.lastSyncAttempt,
            oldestOperation: this.queue.length > 0 ? this.queue[0].timestamp : null
        };
    }

    /**
     * Force clear the queue (for debugging/reset)
     */
    async clearQueue() {
        this.queue = [];
        await this.persistQueue();
        logger.info('Sync queue cleared');
    }

    /**
     * Cleanup on shutdown
     */
    async cleanup() {
        this.stopAutoSync();
        await this.persistQueue();
    }
}

// Create singleton instance
export const syncQueue = new SyncQueue();
