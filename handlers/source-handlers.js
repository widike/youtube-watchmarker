import { History } from "../bg-history.js";
import { Youtube } from "../bg-youtube.js";
import { createHandler } from "../handler-wrapper.js";

const sources = {
  history: (signal) => History.preview({ signal }),
  youtube: (signal) => Youtube.previewHistory({ signal }),
  likes: (signal) => Youtube.previewLikedVideos({ signal }),
};
const pending = new Map();

export const handleSourcePreview = createHandler(
  async ({ source, requestId }) => {
    if (!Object.hasOwn(sources, source))
      throw new Error("Unknown import source");
    if (typeof requestId !== "string" || !requestId || requestId.length > 100)
      throw new Error("Invalid source check request ID");
    // Each page owns its scan, so cancellation never stops another page's check.
    const key = `${requestId}:${source}`;
    if (pending.has(key)) throw new Error("Source check already running");
    const controller = new AbortController();
    pending.set(key, { requestId, controller });
    try {
      return { preview: await sources[source](controller.signal) };
    } catch (error) {
      if (controller.signal.aborted) return { cancelled: true };
      throw error;
    } finally {
      pending.delete(key);
    }
  },
  { name: "handleSourcePreview" },
);

export const handleSourcePreviewCancel = createHandler(
  async ({ requestId }) => {
    for (const run of pending.values()) {
      if (run.requestId === requestId) run.controller.abort();
    }
    return {};
  },
  { name: "handleSourcePreviewCancel" },
);
