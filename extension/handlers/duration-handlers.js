import { createHandler } from "../shared/handler-wrapper.js";
import { durationBackfill } from "../background/duration-runtime.js";

export const handleDurationStatus = createHandler(
  async () => ({ backfill: await durationBackfill.status() }),
  { name: "handleDurationStatus" },
);
export const handleDurationControl = createHandler(
  async (request) => ({ backfill: await durationBackfill.control(request) }),
  { name: "handleDurationControl" },
);
