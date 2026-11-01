import { readFileSync } from "node:fs";
import vm from "node:vm";

export function contentRuntime(files = []) {
  const listeners = new Map();
  const document = {
    title: "Grüße 😀 - YouTube",
    readyState: "loading",
    body: {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
  };
  const window = {
    location: {
      href: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      pathname: "/watch",
    },
    addEventListener() {},
  };
  const context = vm.createContext({
    document,
    window,
    URL,
    crypto,
    console,
    setTimeout,
    clearTimeout,
    chrome: { runtime: { id: "watchmarker" } },
    MutationObserver: class {
      observe() {}
    },
  });
  for (const file of [
    "shared/video-identity.js",
    "youtube/core.js",
    ...files,
  ]) {
    vm.runInContext(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      context,
      { filename: file },
    );
  }
  return {
    context,
    watchmarker: context.YouTubeWatchmarkerContent,
    document,
    window,
    listeners,
  };
}

export function thumbnail(id = "aaaaaaaaaaa") {
  const attrs = new Map();
  const classes = new Set();
  return {
    href: `/watch?v=${id}`,
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value),
    },
    getAttribute: (name) => attrs.get(name),
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: (name) => attrs.delete(name),
    querySelector: () => null,
    closest: () => null,
  };
}

export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
