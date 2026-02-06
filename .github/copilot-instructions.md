# Copilot Instructions for Slack Pixel Art

## Project Overview

Chrome extension (Manifest V3) that converts images into Slack emoji pixel art. Users extract custom emojis from their Slack workspace, then the extension converts any image into a grid of `:emoji_name:` text that renders as pixel art when pasted into Slack.

## Architecture

The extension has four JavaScript files with distinct execution contexts — they cannot import from each other and communicate only via `chrome.runtime.onMessage` / `sendMessage`:

- **`content.js`** — Content script injected into `*.slack.com/customize/emoji`. Extracts emojis via Slack API (`emoji.adminList`, falling back to `emoji.list`, then DOM scraping). Delegates color sampling to the background worker to avoid CORS. Processes emojis in batches with concurrency control (`mapWithConcurrency`).
- **`background.js`** — MV3 service worker. Fetches emoji images using `host_permissions` (bypassing CORS), draws them to `OffscreenCanvas` at 16×16, and computes average color, accent color, variance, and a k-means color profile. Uses an in-memory `Map` cache.
- **`pixelart.js`** — Core conversion engine (~1100 lines). Contains the `PixelArtConverter` class loaded via `<script>` tag in popup.html. Implements OKLab color space math, Lanczos3 resampling, Floyd-Steinberg dithering (serpentine, texture-aware, adaptive), spatial color indexing, and unsharp mask sharpening. All image processing happens on an HTML Canvas in the popup context.
- **`popup.js`** — UI controller for the extension popup. Manages DOM interactions, settings persistence via `chrome.storage.local`, and orchestrates the conversion pipeline by instantiating `PixelArtConverter`.

**Data flow**: Popup tells content script to extract → content script calls background worker for color sampling → results cached in `chrome.storage.local` → popup reads cache and passes emojis to `PixelArtConverter`.

## Versioning

**Bump the patch version in `manifest.json`** with every PR merge or commit (e.g., `1.0.0` → `1.0.1`).

## Key Conventions

- **No build step or bundler.** All JS files are plain browser JavaScript loaded directly. No npm, no transpilation.
- **No test framework.** There are no automated tests.
- **Color math in linear RGB.** All blending, dithering error diffusion, and interpolation operate in linear RGB space (gamma-correct). OKLab is used for perceptual distance calculations only.
- **`PixelArtConverter` is a single class** with all conversion logic as instance methods. Configuration is passed as an `options` object to the constructor.
- **Emoji color data is attached in-place** — `prepareEmojiColors()` mutates emoji objects to add `.oklab`, `.accentOklab`, and `.linearRgb` properties.
- **Spatial indexing** for color matching: emojis are bucketed into a 3D OKLab grid (`Map` keyed by `"kL,kA,kB"` strings) for O(1) candidate lookup in large emoji sets (60k+).
- **Settings are persisted** individually to `chrome.storage.local` (not as a single settings object).
- **`COLOR_SAMPLER_VERSION`** (in content.js) is incremented when the color sampling algorithm changes, triggering re-analysis of cached emojis.
