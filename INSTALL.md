# Installation Guide

## Quick Start

### Step 1: Download the Extension

1. Download or clone this repository to your local machine
2. Extract the files to a folder (e.g., `slack-pixelart`)

### Step 2: Load the Extension in Chrome

1. Open Google Chrome (or any Chromium-based browser like Edge, Brave, etc.)
2. Navigate to the extensions page:
   - Type `chrome://extensions/` in the address bar, or
   - Click the three-dot menu → More Tools → Extensions
3. Enable **Developer mode** by toggling the switch in the top-right corner
4. Click the **Load unpacked** button
5. Select the folder containing the extension files
6. The Slack Pixel Art extension should now appear in your extensions list

### Step 3: Pin the Extension (Optional)

1. Click the puzzle piece icon in the Chrome toolbar
2. Find "Slack Pixel Art" in the list
3. Click the pin icon to make it always visible in your toolbar

## Verifying Installation

After installation, you should see:
- The Slack Pixel Art icon in your Chrome toolbar (or in the extensions menu)
- When you click it, the popup should open with the extension interface
- The extension should have a colorful pixel art icon

## Using the Extension

See the main [README.md](README.md) for detailed usage instructions.

## Troubleshooting

### Extension doesn't appear after loading
- Make sure Developer mode is enabled
- Check that you selected the correct folder (it should contain `manifest.json`)
- Try refreshing the extensions page

### Extension icon is missing
- The icons should be in the `icons/` folder
- If missing, the extension will still work but may show a default icon

### Can't extract emojis
- Make sure you're on a Slack emoji customization page
- The URL should look like: `https://[workspace].slack.com/customize/emoji`
- You may need to reload the page after installing the extension

### Conversion fails
- Check that you've extracted emojis first (Step 1)
- Verify the image URL is accessible or the file is a valid image
- Try with a smaller image or lower dimensions

## Uninstalling

1. Go to `chrome://extensions/`
2. Find "Slack Pixel Art" in the list
3. Click the **Remove** button
4. Confirm the removal

## Updating

To update the extension:
1. Download/pull the latest version
2. Go to `chrome://extensions/`
3. Click the refresh icon on the Slack Pixel Art extension card

Alternatively, you can remove and re-install the extension.

## Browser Compatibility

This extension works with:
- ✅ Google Chrome (recommended)
- ✅ Microsoft Edge
- ✅ Brave Browser
- ✅ Opera
- ✅ Any Chromium-based browser

Not compatible with:
- ❌ Firefox (uses different extension format)
- ❌ Safari (uses different extension format)

## Permissions Explained

The extension requires these permissions:

- **activeTab**: To read emoji data from the current Slack tab
- **storage**: To save extracted emojis for reuse
- **host_permissions for *.slack.com**: To interact with Slack pages

The extension does not:
- Track your browsing
- Send data to external servers
- Access your Slack messages or data
- Require login or authentication
