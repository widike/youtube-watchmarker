import { prepareYouTubeRequests } from "../youtube-request.js";

export async function checkYouTubeRequests(serverOrigin) {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  await prepareYouTubeRequests();
  const [rule] = await chrome.declarativeNetRequest.getSessionRules();
  const request = {
    initiator: chrome.runtime.getURL("/"),
    type: "xmlhttprequest",
    method: "post",
  };
  for (const endpoint of ["browse", "feedback"]) {
    const url = `https://www.youtube.com/youtubei/v1/${endpoint}?key=fixture`;
    const own = await chrome.declarativeNetRequest.testMatchOutcome({
      ...request,
      url,
    });
    assert(
      own.matchedRules.length === 1,
      `Rule did not match extension ${endpoint}`,
    );
    const website = await chrome.declarativeNetRequest.testMatchOutcome({
      ...request,
      url,
      initiator: "https://www.youtube.com/",
    });
    assert(
      website.matchedRules.length === 0,
      "Rule modified a website request",
    );
  }
  for (const url of [
    "https://www.youtube.com/youtubei/v1/browse-unrelated",
    "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    "https://example.com/youtubei/v1/browse",
  ]) {
    const result = await chrome.declarativeNetRequest.testMatchOutcome({
      ...request,
      url,
    });
    assert(
      result.matchedRules.length === 0,
      `Rule matched unrelated URL ${url}`,
    );
  }
  // Exercise the installed header action on a local receiver as well, without
  // sending test traffic or fixture credentials to YouTube.
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        ...rule,
        id: 2,
        condition: {
          ...rule.condition,
          regexFilter: undefined,
          urlFilter: `${serverOrigin}/echo`,
        },
      },
    ],
  });
  const headers = await (
    await fetch(`${serverOrigin}/echo`, { method: "POST" })
  ).json();
  assert(
    headers.origin === "https://www.youtube.com",
    `Wrong network Origin: ${headers.origin}`,
  );
  assert(
    headers.referer === "https://www.youtube.com/",
    `Wrong network Referer: ${headers.referer}`,
  );
  return {
    passed: true,
    matching: "extension API requests only",
    networkHeaders: "Origin and Referer verified",
  };
}
