// @ts-check

/**
 * IndexedDB Provider
 * Wraps the existing IndexedDB functionality to match the provider interface
 */

/**
 * IndexedDB Provider class
 */
export class IndexedDBProvider {
    constructor(databaseManager) {
        this.databaseManager = databaseManager;
        this.isInitialized = false;
        this.isConnected = false;
    }

    async init() {
        if (!this.databaseManager) {
            throw new Error('Database manager not set');
        }

        // If database is already open, we're good
        if (this.databaseManager.database) {
            this.isInitialized = true;
            this.isConnected = true;
            return true;
        }

        // If database manager exists but database isn't open yet,
        // that's okay - it will be opened during database initialization
        // We just mark as initialized and will connect when database opens
        this.isInitialized = true;
        this.isConnected = false;
        return true;
    }

    async testConnection() {
        // Update connection status based on current database state
        this.isConnected = this.databaseManager && this.databaseManager.database !== null;
        return this.isConnected;
    }

    /**
     * Update connection status based on database state
     */
    updateConnectionStatus() {
        // More thorough connection checking
        const isDbOpen = this.databaseManager?.database !== null;
        const isDbInitialized = this.databaseManager?.isInitialized === true;

        // We're connected if database is open AND initialized
        this.isConnected = isDbOpen && isDbInitialized;

        // Log status for debugging
        if (!this.isConnected) {
            console.debug('IndexedDB connection status:', {
                isDbOpen,
                isDbInitialized,
                databaseExists: !!this.databaseManager?.database,
                managerInitialized: !!this.databaseManager?.isInitialized
            });
        }
    }

    async getVideo(videoId) {
        // Update connection status
        this.updateConnectionStatus();

        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.databaseManager.database.transaction([this.databaseManager.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.databaseManager.STORE_NAME);
            const request = store.get(videoId);

            request.onsuccess = () => {
                resolve(request.result || null);
            };

            request.onerror = () => {
                reject(new Error('Failed to get video'));
            };
        });
    }

    async putVideo(video) {
        // Update connection status
        this.updateConnectionStatus();

        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.databaseManager.database.transaction([this.databaseManager.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.databaseManager.STORE_NAME);

            // Check if video exists
            const getRequest = store.get(video.strIdent);

            getRequest.onsuccess = () => {
                const existingVideo = getRequest.result;
                let videoToStore = video;

                if (existingVideo) {
                    // Merge with existing data, keeping the latest timestamp
                    videoToStore = {
                        ...existingVideo,
                        ...video,
                        intTimestamp: Math.max(existingVideo.intTimestamp || 0, video.intTimestamp || 0),
                        intCount: Math.max(existingVideo.intCount || 1, video.intCount || 1)
                    };
                }

                const putRequest = store.put(videoToStore);

                putRequest.onsuccess = () => {
                    resolve(true);
                };

                putRequest.onerror = () => {
                    reject(new Error('Failed to put video'));
                };
            };

            getRequest.onerror = () => {
                reject(new Error('Failed to check existing video'));
            };
        });
    }

    async getAllVideos() {
        // Update connection status
        this.updateConnectionStatus();

        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.databaseManager.database.transaction([this.databaseManager.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.databaseManager.STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result || []);
            };

            request.onerror = () => {
                reject(new Error('Failed to get all videos'));
            };
        });
    }

    async getVideoCount() {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.databaseManager.database.transaction([this.databaseManager.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.databaseManager.STORE_NAME);
            const request = store.count();

            request.onsuccess = () => {
                resolve(request.result || 0);
            };

            request.onerror = () => {
                reject(new Error('Failed to get video count'));
            };
        });
    }

    async clearAllVideos() {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.databaseManager.database.transaction([this.databaseManager.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.databaseManager.STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => {
                resolve(true);
            };

            request.onerror = () => {
                reject(new Error('Failed to clear all videos'));
            };
        });
    }

    async deleteVideo(videoId) {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.databaseManager.database.transaction([this.databaseManager.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.databaseManager.STORE_NAME);
            const request = store.delete(videoId);

            request.onsuccess = () => {
                resolve(true);
            };

            request.onerror = () => {
                reject(new Error('Failed to delete video'));
            };
        });
    }

    async importVideos(videos) {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        if (!videos || videos.length === 0) {
            return true;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.databaseManager.database.transaction([this.databaseManager.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.databaseManager.STORE_NAME);

            let processed = 0;
            const total = videos.length;

            const processNext = () => {
                if (processed >= total) {
                    resolve(true);
                    return;
                }

                const video = videos[processed];

                // Check if video exists
                const getRequest = store.get(video.strIdent);

                getRequest.onsuccess = () => {
                    const existingVideo = getRequest.result;
                    let videoToStore = video;

                    if (existingVideo) {
                        // Merge with existing data, keeping the latest timestamp
                        videoToStore = {
                            ...existingVideo,
                            ...video,
                            intTimestamp: Math.max(existingVideo.intTimestamp || 0, video.intTimestamp || 0),
                            intCount: Math.max(existingVideo.intCount || 1, video.intCount || 1)
                        };
                    }

                    const putRequest = store.put(videoToStore);

                    putRequest.onsuccess = () => {
                        processed++;
                        processNext();
                    };

                    putRequest.onerror = () => {
                        reject(new Error(`Failed to import video ${processed + 1}`));
                    };
                };

                getRequest.onerror = () => {
                    reject(new Error(`Failed to check existing video ${processed + 1}`));
                };
            };

            processNext();
        });
    }

    async searchVideos(query, limit = 100) {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        const allVideos = await this.getAllVideos();
        const filteredVideos = allVideos.filter(video =>
            video.strTitle && video.strTitle.toLowerCase().includes(query.toLowerCase())
        );

        return filteredVideos.slice(0, limit);
    }

    async getVideosByDateRange(startTimestamp, endTimestamp) {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        const allVideos = await this.getAllVideos();
        return allVideos.filter(video =>
            video.intTimestamp >= startTimestamp && video.intTimestamp <= endTimestamp
        );
    }

    async getStatistics() {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        const allVideos = await this.getAllVideos();

        if (allVideos.length === 0) {
            return {
                totalVideos: 0,
                oldestTimestamp: 0,
                newestTimestamp: 0,
                totalViews: 0,
                avgViewsPerVideo: 0
            };
        }

        const timestamps = allVideos.map(v => v.intTimestamp).filter(t => t);
        const totalViews = allVideos.reduce((sum, v) => sum + (v.intCount || 1), 0);

        return {
            totalVideos: allVideos.length,
            oldestTimestamp: Math.min(...timestamps),
            newestTimestamp: Math.max(...timestamps),
            totalViews,
            avgViewsPerVideo: totalViews / allVideos.length
        };
    }

    async close() {
        this.isConnected = false;
        return true;
    }

    getProviderInfo() {
        return {
            name: 'IndexedDB',
            type: 'local',
            isConnected: this.isConnected,
            isInitialized: this.isInitialized
        };
    }
}
