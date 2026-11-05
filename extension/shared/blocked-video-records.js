import { isValidVideoId } from "./validation.js";

export function normalizeBlock(value) {
  if (
    !value ||
    !isValidVideoId(value.videoId) ||
    typeof value.blocked !== "boolean" ||
    !Number.isSafeInteger(value.updatedAt) ||
    value.updatedAt < 0 ||
    typeof value.changeId !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.changeId) ||
    typeof value.title !== "string" ||
    value.title.length > 2000
  )
    throw new Error("Invalid blocked video record");
  return {
    videoId: value.videoId,
    title: value.title,
    blocked: value.blocked,
    updatedAt: value.updatedAt,
    changeId: value.changeId,
  };
}

export function compareBlocks(left, right) {
  return (
    left.updatedAt - right.updatedAt ||
    (left.changeId < right.changeId
      ? -1
      : left.changeId > right.changeId
        ? 1
        : 0)
  );
}
