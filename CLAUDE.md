# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YouTube Watchmarker is a Chrome extension (Manifest V3) that tracks and marks watched YouTube videos. It extends YouTube's limited watch history by maintaining a complete local record and optionally syncing to Supabase cloud storage.

## Development Commands

```bash
npm run lint          # Run ESLint
npm run lint:fix      # Run ESLint with auto-fix
npm run format        # Format code with Prettier
npm run format:check  # Check formatting without changes
```

To develop: Load the extension as an unpacked extension in Chrome from the project root directory.

## Architecture

### Extension Entry Points

- **`background.js`** - Service worker entry point; initializes `ExtensionManager` which coordinates all modules
- **`youtube.js`** - Content script injected into YouTube pages; contains `YouTubeWatchMarker` class for DOM manipulation
- **`popup.js`** - Popup UI script for quick search functionality
- **`content/index.js`** - Options page with `OptionsPageManager` class

### Module Organization

**Background modules (`bg-*.js`):**
- `bg-database.js` - IndexedDB operations via `Database` class
- `bg-history.js` - Browser history sync via `History` class
- `bg-youtube.js` - YouTube API integration via `Youtube` class
- `bg-search.js` - Search functionality via `Search` class
- `bg-sync-manager.js` - Automatic synchronization scheduling

**Handler modules (`handlers/`):**
- Organized by domain: `database-handlers.js`, `youtube-handlers.js`, `search-handlers.js`, `history-handlers.js`, `provider-handlers.js`, `settings-handlers.js`
- All handlers are registered in `ExtensionManager.registerMessageHandlers()`

**Core utilities:**
- `message-router.js` - Message passing between extension components
- `settings-manager.js` - User settings management
- `alarm-manager.js` - Chrome alarm scheduling for background tasks
- `video-tracker.js` - Video watch detection
- `database-provider-factory.js` - Switches between IndexedDB and Supabase providers
- `supabase-database-provider.js` - Supabase cloud storage integration

### Message Flow

Content scripts and UI → `chrome.runtime.sendMessage()` → `messageRouter` → handler functions → background modules

### Database Schema

```javascript
{
  strIdent: "video_id",       // YouTube video ID (11 chars)
  intTimestamp: 1234567890,   // Unix timestamp of last watch
  strTitle: "Video Title",    // Video title
  intCount: 1                 // View count
}
```

## Code Conventions

- ES6 modules throughout (`"type": "module"` in package.json)
- Classes for major components (e.g., `ExtensionManager`, `YouTubeWatchMarker`)
- Async/await patterns preferred over callbacks
- `polyfill.js` must be imported first in background.js for Firefox compatibility
- ESLint + Prettier for code quality (configured in `eslint.config.mjs`)

## Browser Compatibility

- Chrome/Chromium: Full support
- Firefox: Requires polyfill.js; Supabase features may need manual setup
- The manifest has Firefox-specific settings in `browser_specific_settings.gecko`
