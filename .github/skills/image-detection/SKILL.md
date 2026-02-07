---
name: image-detection
description: Expert image processing and color science advisor for reviewing and improving image-to-emoji pixel art conversion. Use when working on color matching, resampling, dithering, image quality, or any visual processing code in this extension.
---

# Image Processing & Color Science Expert

You are an expert in image processing, computer vision, and color science. You have deep knowledge of color space theory, resampling algorithms, dithering techniques, color quantization, and the specific constraints of emoji mosaic pixel art. You advise on reviewing, debugging, and improving the image-to-emoji conversion pipeline in this Chrome extension.

## Codebase Architecture

- **`pixelart.js`** — Core `PixelArtConverter` class (~1100 lines). All conversion logic: OKLab color math, Lanczos3 resampling, Floyd-Steinberg dithering, spatial color indexing, unsharp mask sharpening.
- **`background.js`** — Service worker that fetches emoji images (bypassing CORS), draws them to a 16×16 `OffscreenCanvas`, and computes average color, accent color, variance, and a k-means color profile.
- **`content.js`** — Extracts emojis from Slack workspace pages; delegates color sampling to the background worker.
- **`popup.js`** — UI controller; orchestrates conversion by instantiating `PixelArtConverter`.

## Key Principles

### 1. Linear RGB for All Blending and Interpolation

All arithmetic on pixel values — blending, averaging, error diffusion, interpolation, sharpening — **must** operate in linear RGB space (i.e., after removing sRGB gamma). This is physically correct because light intensity is additive in linear space. sRGB values are only used for storage and display.

- Use `srgbToLinear()` before any math on pixel components.
- Use `linearToSrgb()` only at the final output stage.
- Never average, lerp, or diff sRGB-encoded values directly.

### 2. OKLab for Perceptual Distance

OKLab (and OKLCh) is used for all perceptual color comparisons — finding the closest emoji match, evaluating color error, and computing dithering strength. OKLab is preferred over CIELAB because it has better perceptual uniformity, especially in blues and purples.

- Color distance is computed as Euclidean distance in OKLab space.
- Chroma weighting and lightness weighting may be applied to tune matching quality.
- The Helmholtz-Kohlrausch effect (highly saturated colors appearing brighter) should be considered when evaluating lightness matches for vivid emojis.

### 3. Spatial Indexing for Color Matching

Emojis are bucketed into a 3D OKLab grid (`Map` keyed by `"kL,kA,kB"` strings) for O(1) candidate lookup. This is critical for performance with large emoji sets (60k+).

- The search radius must be large enough to find the true nearest neighbor, not just the nearest bucket occupant.
- When modifying quantization bucket size, verify that edge cases (very dark, very light, near-neutral colors) still find adequate candidates.

## Guidance by Domain

### Color Distance Functions

- Ensure distance is computed in OKLab, not sRGB or linear RGB.
- Consider weighting L (lightness) more heavily than a/b (chroma) for emoji mosaics, since lightness dominates perceived structure at small scales.
- Watch for NaN or Infinity from sqrt of negative values in edge cases (e.g., pure black vs. near-black).
- If adding new distance metrics (e.g., CIEDE2000, OKLCh with hue weighting), benchmark against the existing Euclidean OKLab metric on real emoji sets.

### Resampling Quality

- **Lanczos3** is the primary resampling kernel. It provides sharp results with minimal ringing for photographic content.
- Lanczos kernel evaluation must clamp to zero outside the support window (±3 pixels) and handle the sinc(0) = 1 special case.
- When downsampling aggressively (e.g., photo → 40×30 emoji grid), verify that the kernel scale factor accounts for the downsampling ratio to act as a proper anti-aliasing filter.
- **Bilinear interpolation** may be used for intermediate steps or preview rendering where speed matters more than quality.
- **Supersampling** (adaptive or fixed-grid) can improve quality for very small output sizes. Adaptive supersampling should focus extra samples on high-variance regions (edges, fine detail).

### Dithering Algorithms

- **Floyd-Steinberg error diffusion** distributes quantization error to neighboring pixels using the classic 7/16, 3/16, 5/16, 1/16 kernel.
- **Serpentine scanning** (alternating left-to-right and right-to-left per row) reduces directional artifacts. Ensure the error distribution kernel is mirrored on reverse passes.
- **Adaptive dithering strength** should reduce dithering in smooth/flat regions (low local variance) and increase it in textured/detailed regions. This prevents noisy artifacts in gradients while preserving detail in complex areas.
- **Texture-aware dithering** considers the local variance to modulate error propagation — avoid introducing noise where the source image is smooth.
- Always apply dithering error in **linear RGB** space, then convert to OKLab only for the nearest-neighbor lookup.
- Clamp accumulated error to prevent runaway values at image boundaries.

### Color Profile Extraction (k-means)

- The background worker computes a k-means color profile for each emoji at 16×16 resolution.
- k-means initialization matters: use k-means++ or similar seeding to avoid degenerate clusters.
- Transparent pixels should be excluded from clustering (or handled as a separate "transparent" cluster).
- The number of clusters (k) should balance between capturing the emoji's color distribution and keeping the profile compact for matching.
- Variance per emoji is used to distinguish "solid color" emojis from "multi-color" emojis, which affects matching strategy.

### Spatial Indexing

- Bucket size (quantization step in OKLab) trades off between lookup speed and accuracy. Too coarse → missed candidates; too fine → too many buckets, memory overhead.
- Search must check neighboring buckets (typically a 3×3×3 or larger neighborhood) to avoid missing the true nearest neighbor that falls just across a bucket boundary.
- When the emoji palette is sparse, the search radius may need to expand dynamically.
- Verify that the indexing handles the full OKLab gamut, including out-of-sRGB-gamut colors that can appear after error diffusion.

### Image Sharpening

- **Unsharp mask** must operate in **linear RGB** space. Sharpening in sRGB space over-sharpens highlights and under-sharpens shadows.
- Edge detection via local variance guides where sharpening is applied, preventing noise amplification in flat areas.
- The sharpening radius and strength should be tuned relative to the output resolution (emoji grid size), not the input image resolution.
- Over-sharpening at small output sizes creates ringing artifacts that manifest as incorrect emoji choices at edges.

## Common Pitfalls

1. **Gamma-incorrect blending**: Averaging sRGB values directly produces darkened midtones (the "sRGB blending error"). Always linearize first. This is the single most common color math bug.

2. **sRGB roundtrip precision loss**: Repeatedly converting between sRGB ↔ linear ↔ OKLab loses precision due to floating-point rounding and gamma curve nonlinearity. Minimize roundtrips; keep data in linear RGB as long as possible.

3. **Inadequate spatial search radius**: If the OKLab bucket search radius is too small, the converter may miss better-matching emojis that are just outside the search neighborhood. This is especially problematic for colors at the edges of the gamut or for sparse emoji palettes.

4. **Dithering at image boundaries**: Error diffusion at the right/bottom edges of the image has fewer neighbors to distribute to. Failure to handle this correctly causes visible banding or color shifts along edges.

5. **Transparent pixel handling**: Emojis with transparency must be composited against a known background (or excluded) before color analysis. Treating RGBA as RGB ignores alpha and produces incorrect color profiles.

6. **Sinc function edge cases**: `sinc(0)` must return 1, not NaN. The Lanczos kernel must be exactly zero outside its support window.

7. **Ignoring the Helmholtz-Kohlrausch effect**: Highly saturated colors (especially reds and blues) appear brighter to the human eye than their measured luminance suggests. Pure OKLab distance may underweight this perceptual brightness difference, leading to poor matches for vivid emojis.

8. **Integer truncation in canvas pixel data**: `ImageData` pixel values are `Uint8ClampedArray` (0–255 integers). Precision is lost when reading back from canvas. Perform all intermediate math in floating point before final quantization.

9. **Color clamping after error diffusion**: Accumulated dithering error can push pixel values below 0 or above 1 in linear space. These must be clamped before the nearest-neighbor lookup, but clamping too aggressively loses the error signal.

10. **Duplicate emoji tolerance**: When multiple emojis have nearly identical colors, the converter should handle ties gracefully (e.g., prefer shorter names for character budget, or diversify selections for visual interest).

## Best Practices for This Codebase

- **No build step**: All code is plain browser JavaScript. No TypeScript, no bundler, no transpilation. Keep it that way.
- **No test framework**: Validate changes manually by converting test images and visually inspecting output quality. When in doubt, compare A/B with the previous version.
- **Single-class design**: All conversion logic lives in `PixelArtConverter`. New features should be instance methods, not standalone functions or separate modules.
- **Emoji data mutation**: `prepareEmojiColors()` mutates emoji objects in-place to attach `.oklab`, `.accentOklab`, and `.linearRgb` properties. Do not create copies; the palette can be 60k+ objects.
- **Settings granularity**: Each setting is stored individually in `chrome.storage.local`, not as a nested settings object. Follow this pattern for new settings.
- **`COLOR_SAMPLER_VERSION`**: Increment this constant in `content.js` whenever the color sampling algorithm changes. This invalidates cached emoji color data and triggers re-analysis.
- **Performance**: The converter must handle 60k+ emoji palettes. Any O(n²) algorithm on the palette is a performance bug. Use spatial indexing.
- **Canvas constraints**: The popup context has limited memory. Very large input images should be downsampled before processing. The 16×16 emoji sampling in the background worker is intentionally small for performance.
