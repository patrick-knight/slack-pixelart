# Slack Pixel Art Chrome Extension

Turn Slack emojis into pixel art! This Chrome extension reads emojis from your Slack workspace and converts any image into a mosaic of emoji characters that you can paste directly into Slack.

## Features

- 📸 Extract emojis directly from Slack's emoji customization page
- 🎨 Convert images (URL or local files) into pixel art using your workspace's emojis
- 🎯 Advanced color matching with OKLab color space for perceptually accurate results
- 🖼️ Adaptive dithering support for smoother gradients and cleaner edges
- 🔬 **Lanczos3 interpolation** for superior image resampling quality
- 🎯 **Edge-aware adaptive supersampling** for better detail preservation
- ✨ **Texture-aware dithering** that reduces artifacts in detailed regions
- 🔍 **Enhanced perceptual color matching** with chroma-sensitive lightness weighting
- 📐 **Optional sharpening filter** for crisp detail enhancement
- 📏 Automatic resizing to fit within Slack's character budget
- 🔄 Duplicate tracking based on configurable tolerance
- 🔍 Texture-aware emoji selection to prefer solid colors over busy patterns
- 🎛️ Adjustable raster quality for better color sampling from source images
- 💾 Auto-sync and caching for efficient emoji management
- 📋 One-click copy to clipboard for easy pasting into Slack
- 💾 Export results as text files
- 👁️ Visual preview with both emoji rendering and text format

## Installation

See the [Installation Guide](INSTALL.md) for detailed instructions.

### Quick Install

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the directory containing this extension
5. The Slack Pixel Art extension icon should appear in your Chrome toolbar

## Screenshots

### Extension Popup UI
![Popup UI](https://github.com/user-attachments/assets/824c68a5-4705-4fb1-b83d-3fdd18835971)

## Usage

### Step 1: Extract Emojis

1. Navigate to your Slack workspace's emoji customization page: `https://[your-workspace].slack.com/customize/emoji`
2. Click the Slack Pixel Art extension icon in your Chrome toolbar
3. Click the "Extract Emojis" button (or "Update Cache" if emojis were previously extracted)
4. The extension will extract all available emojis and analyze their colors
5. Extracted emojis are cached for reuse - a "Resync" button appears to force re-extraction if needed

### Step 2: Load an Image

Choose one of two methods:
- **From URL**: Enter an image URL and click "Load from URL"
- **From File**: Click "Choose File" and select an image from your computer

### Step 3: Configure Settings

Adjust the following settings as needed:

**Basic Settings:**
- **Width/Height**: Dimensions of the pixel art in emojis (default: 20×20)
- **Character Budget**: Maximum characters in the output (0 = unlimited). Default is 4000 to fit within Slack's message limits
- **Duplicate Tolerance**: Controls how often the same emoji can be reused (0-100). Lower values require more unique emojis

**Advanced Settings:**
- **Dithering**: Enable/disable dithering for smoother gradients and better photo reproduction (default: enabled)
- **Dithering Strength**: Controls the amount of dithering applied (0-100). Lower = smoother, higher = more detail/texture (default: 85)
- **Prefer Solid Emojis**: Avoids busy or outlined emojis in favor of solid colors (0-100). Higher values produce more photo-like results (default: 55)
- **Raster Quality**: Controls how the source image is sampled (1-5). Higher values provide better color matching at modest CPU cost (default: 3)

**Quality Enhancement Settings:**
- **Lanczos3 Interpolation**: Superior resampling algorithm for sharper details and better edge preservation (default: enabled, ~15% slower than bilinear)
- **Adaptive Supersampling**: Intelligently uses more samples in high-detail regions, fewer in flat areas (default: enabled, actually improves performance)
- **Adaptive Dithering**: Texture-aware dithering that reduces strength in detailed areas, increases in smooth gradients (default: enabled)
- **Sharpening Strength**: Enhances edges and fine details using unsharp mask (0-100). Recommended 50-70 for photos, 0 for pixel art (default: 0)

### Step 4: Generate Pixel Art

1. Click the "Generate Pixel Art" button
2. Wait for the conversion to complete (progress bar will show status)
3. Preview the result in the extension popup
   - Use the **Visual** tab to see the rendered emoji preview
   - Use the **Text** tab to see the raw Slack format text

### Step 5: Use Your Pixel Art

- **Copy to Clipboard**: Click "Copy to Clipboard" and paste directly into any Slack message
- **Download**: Click "Download as Text" to save the pixel art as a text file

## How It Works

1. **Emoji Extraction**: The content script scans the Slack emoji page and extracts emoji images
2. **Color Analysis**: Each emoji is analyzed to determine its average color, texture, and visual characteristics
3. **High-Quality Image Resampling**:
   - **Lanczos3 interpolation** provides superior quality with 6×6 kernel sampling
   - **Adaptive supersampling** detects edges and allocates more samples (up to 8×8) in high-detail regions
   - Gamma-correct processing in linear RGB space for mathematically accurate color blending
4. **Advanced Color Matching**:
   - Uses perceptually accurate **OKLab color space** with enhanced weighting
   - **Chroma-adaptive lightness weighting** improves gray/skin tone matching
   - **Hue difference weighting** for more accurate color perception
   - Spatial indexing for efficient matching in large emoji sets (1000+ emojis)
5. **Texture-Aware Adaptive Dithering**:
   - **Floyd-Steinberg error diffusion** in linear RGB space
   - Automatically reduces dithering strength in high-variance (detailed) areas
   - Increases dithering in smooth gradients for better color transitions
   - Serpentine scanning reduces directional artifacts
6. **Optional Detail Enhancement**: Unsharp mask sharpening for crisp edges and fine details
7. **Texture-Aware Selection**: Penalizes emojis with high variance (busy patterns) when solid colors are preferred
8. **Duplicate Tracking**: The algorithm limits emoji reuse based on the tolerance setting
9. **Text Generation**: Generates Slack-formatted text (`:emoji_name:`) for easy pasting

## Technical Details

- **Manifest Version**: 3
- **Permissions**:
  - `activeTab`: To extract emojis from the current Slack page
  - `storage`: To save extracted emojis for reuse
  - `host_permissions`: Access to `*.slack.com` and CDN domains
- **Image Resampling**:
  - Lanczos3 windowed sinc interpolation with 6×6 kernel
  - Adaptive supersampling (1×1 to 8×8 samples per pixel)
  - Edge detection using local variance analysis
  - Gamma-correct processing in linear RGB color space
- **Color Matching**:
  - Björn Ottosson's OKLab perceptual color space
  - Chroma-adaptive lightness weighting for improved gray/skin tone matching
  - Hue difference emphasis for accurate color perception
  - Spatial indexing (32×32×32 color buckets) for large emoji sets
- **Dithering Algorithm**:
  - Floyd-Steinberg error diffusion in linear RGB space
  - Texture-aware adaptive strength (reduces in high-detail areas)
  - Serpentine scanning pattern to minimize directional artifacts
- **Detail Enhancement**: Optional unsharp mask filter for edge sharpening
- **Texture Analysis**: Statistical variance (RMS deviation) to identify and prefer solid-color emojis
- **Character Budget**: Automatically scales dimensions to fit within the specified character limit
- **Performance Optimization**: Batch processing, spatial indexing, and adaptive sampling for efficiency

## Tips

**For Photos and Complex Images:**
- Keep all quality enhancements enabled (Lanczos3, Adaptive Sampling, Adaptive Dithering)
- Set **Sharpening Strength** to 50-70 for crisp details
- Enable **Dithering** with strength 80-85 for smooth gradients
- Increase **Prefer Solid Emojis** setting (60-80) for photo-realistic results
- Use **Raster Quality** 4-5 for fine color details

**For Pixel Art, Logos, and Simple Graphics:**
- Keep Lanczos3 enabled for sharp edges
- Set **Sharpening Strength** to 0 to avoid artifacts
- **Disable dithering** to preserve hard edges
- Lower **Prefer Solid Emojis** (20-40) to allow outlined emojis
- **Raster Quality** 2-3 is sufficient

**General Tips:**
- Higher duplicate tolerance allows for smoother gradients but less variety
- Smaller dimensions (10×10 to 30×30) work best for most Slack messages
- Remember that Slack has a 40,000 character limit per message
- Use the **Visual** preview tab to see how your pixel art will look in Slack
- Extracted emojis are cached - use **Resync** button if workspace emojis change
- Quality enhancements add minimal overhead (~15-20% processing time for significant quality gains)

See [EXAMPLES.md](EXAMPLES.md) for detailed use cases, tips, and best practices.

## Performance

The extension is optimized to handle large emoji sets efficiently:

- **Emoji Extraction**: Processes emojis in batches of 100 to keep the browser responsive
- **Color Matching**: Uses spatial indexing (color bucketing) for emoji sets >1,000
- **Large Workspaces**: Tested to work with 60,000+ emojis
  - Extraction: ~2-5 minutes depending on network speed
  - Conversion: ~5-10 seconds for a 20×20 grid

**Tips for Large Emoji Sets:**
- Extract emojis once, then reuse them (stored in browser)
- Use smaller grid sizes (15×15 or less) for faster conversion
- Higher duplicate tolerance (50+) reduces search time

## Troubleshooting

**Emojis not extracting?**
- Make sure you're on the emoji customization page: `https://[workspace].slack.com/customize/emoji`
- Reload the page and try again
- Check that you have sufficient permissions in your Slack workspace

**Image not loading?**
- For URL images, ensure the URL is accessible and CORS is enabled
- For local files, ensure the file is a valid image format (PNG, JPG, GIF, etc.)

**Output too large?**
- Reduce the width and height dimensions
- Lower the character budget setting
- Use a simpler image with fewer colors

## License

MIT License - see [LICENSE](LICENSE) file for details

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Credits

Created by Patrick Knight
