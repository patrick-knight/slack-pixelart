# Slack Pixel Art Chrome Extension

Turn Slack emojis into pixel art! This Chrome extension reads emojis from your Slack workspace and converts any image into a mosaic of emoji characters that you can paste directly into Slack.

## Features

- 📸 Extract emojis directly from Slack's emoji customization page
- 🎨 Convert images (URL or local files) into pixel art using your workspace's emojis
- 🎯 Color similarity matching to find the best emoji for each pixel
- 📏 Automatic resizing to fit within Slack's character budget
- 🔄 Duplicate tracking based on configurable tolerance
- 📋 One-click copy to clipboard for easy pasting into Slack
- 💾 Export results as text files

## Installation

### From Source

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the directory containing this extension
5. The Slack Pixel Art extension icon should appear in your Chrome toolbar

## Usage

### Step 1: Extract Emojis

1. Navigate to your Slack workspace's emoji customization page: `https://[your-workspace].slack.com/customize/emoji`
2. Click the Slack Pixel Art extension icon in your Chrome toolbar
3. Click the "Extract Emojis from Current Tab" button
4. The extension will extract all available emojis and their colors

### Step 2: Load an Image

Choose one of two methods:
- **From URL**: Enter an image URL and click "Load from URL"
- **From File**: Click "Choose File" and select an image from your computer

### Step 3: Configure Settings

Adjust the following settings as needed:
- **Width/Height**: Dimensions of the pixel art in emojis (default: 20×20)
- **Character Budget**: Maximum characters in the output (0 = unlimited). Default is 4000 to fit within Slack's message limits
- **Duplicate Tolerance**: Controls how often the same emoji can be reused (0-100). Lower values require more unique emojis

### Step 4: Generate Pixel Art

1. Click the "Generate Pixel Art" button
2. Wait for the conversion to complete (progress bar will show status)
3. Preview the result in the extension popup

### Step 5: Use Your Pixel Art

- **Copy to Clipboard**: Click "Copy to Clipboard" and paste directly into any Slack message
- **Download**: Click "Download as Text" to save the pixel art as a text file

## How It Works

1. **Emoji Extraction**: The content script scans the Slack emoji page and extracts emoji images
2. **Color Analysis**: Each emoji is analyzed to determine its average color
3. **Image Processing**: The input image is resized to the specified dimensions
4. **Color Matching**: For each pixel, the extension finds the emoji with the closest color using Euclidean distance
5. **Duplicate Tracking**: The algorithm limits emoji reuse based on the tolerance setting
6. **Text Generation**: Generates Slack-formatted text (`:emoji_name:`) for easy pasting

## Technical Details

- **Manifest Version**: 3
- **Permissions**: 
  - `activeTab`: To extract emojis from the current Slack page
  - `storage`: To save extracted emojis for reuse
  - `host_permissions`: Access to `*.slack.com`
- **Color Matching**: Uses RGB Euclidean distance for color similarity
- **Character Budget**: Automatically scales dimensions to fit within the specified character limit

## Tips

- For best results, use images with clear, distinct colors
- Higher duplicate tolerance allows for smoother gradients but less variety
- Smaller dimensions (10×10 to 30×30) work best for most Slack messages
- Remember that Slack has a 40,000 character limit per message

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
