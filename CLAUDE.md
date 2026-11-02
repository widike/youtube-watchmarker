# Repository guide

YouTube Watchmarker is a Chrome Manifest V3 extension that records watched
YouTube videos locally and optionally synchronizes them with Supabase.

## Development

Use Node 26.12.1 or newer and install dependencies with `npm ci`.

```bash
npm run build        # Regenerate bundled dependencies and runtime SQL; validate paths
npm run dev          # Show unpacked extension instructions
npm test             # Node tests, including Chrome integration checks
npm run lint         # ESLint
npm run format:check # Prettier
npm run package      # Build dist/youtube-watchmarker-<version>.zip
```

Load `extension/` as an unpacked extension in Chrome 126 or newer after building.
Set `CHROME_PATH` if Google Chrome is not installed at the default macOS path.

## Structure

- `extension/manifest.json` declares the runtime entry points.
- `extension/background/service-worker.js` registers listeners and initializes
  background modules. Message handlers live in `extension/handlers/`.
- `extension/history/` owns history records, reconciliation and watch time.
- `extension/providers/` owns IndexedDB, Supabase, device linking and credentials.
- `extension/sources/` imports browser history, YouTube history and liked videos.
- `extension/duration/` and `extension/statistics/` handle estimates and analytics.
- `extension/youtube/` contains the content scripts declared in manifest order.
- `extension/popup.html` and `extension/popup.js` provide the toolbar popup.
- `extension/content/` contains the options page, controllers and styles.
- `extension/ui/` and `extension/shared/` provide reusable UI and domain helpers.
- `extension/vendor/` contains generated offline dependencies and their licenses.
- `extension/verification/` contains the public device-verification page.
- `tests/` contains Node and Chrome tests; `tests/support/` contains fixtures and SQL.
- `supabase/` owns canonical migrations, pairing functions and server configuration.
  Build copies migrations into ignored `extension/supabase/` for the settings UI.
- `scripts/`, `data/` and `docs/` contain build tools, data sources and documentation.

## Conventions

Use ES modules and async/await. Keep application modules under 400 lines and
separate them by responsibility. Register background message handlers through
the message router. Content scripts use the shared content-script namespace;
their manifest loading order matters.

Never publish local `.mcp.json`, `.codex/`, credentials, environment overrides,
dependency directories or package output. Keep dependency licenses with shipped
bundles. Use GitHub Actions for server deployment and validate locally first.
