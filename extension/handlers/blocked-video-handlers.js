import { getBlockedVideoStore } from "../background/blocked-videos.js";

export const handleBlockedVideosList = async () => ({
  videos: await getBlockedVideoStore().list(),
});

export const handleBlockVideo = async ({ videoId, title }) => ({
  videos: await getBlockedVideoStore().update(videoId, title, true),
});

export const handleUnblockVideo = async ({ videoId }) => ({
  videos: await getBlockedVideoStore().update(videoId, "", false),
});
