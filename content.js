// Content script that extracts emoji data from Slack's customize/emoji page

(function() {
  'use strict';
  
  // Constants
  const TRANSPARENCY_THRESHOLD = 128; // Alpha value threshold for considering pixels as opaque
  const PIXEL_SAMPLE_STEP = 16; // Sample every 4th pixel (4 RGBA values per pixel)

  // Function to extract emoji data from the page
  function extractEmojiData() {
    const emojis = [];
    
    // Slack's emoji customization page structure may vary, so we'll try multiple selectors
    // Look for emoji images in the customization page
    const emojiElements = document.querySelectorAll('[data-qa="customize_emoji_item"], .c-custom_emoji_item, .emoji-wrapper');
    
    if (emojiElements.length === 0) {
      // Try alternative selectors for emoji images
      const allImages = document.querySelectorAll('img[src*="emoji"], img[data-stringify-type="emoji"]');
      
      allImages.forEach((img) => {
        const name = img.alt || img.getAttribute('data-emoji-name') || img.getAttribute('aria-label') || '';
        const url = img.src;
        
        if (url && name) {
          emojis.push({
            name: name.replace(/:/g, ''),
            url: url
          });
        }
      });
    } else {
      // Process emoji elements
      emojiElements.forEach((element) => {
        const img = element.querySelector('img');
        const nameElement = element.querySelector('[data-qa="customize_emoji_name"], .emoji_name, .c-custom_emoji_item__name');
        
        if (img) {
          const name = nameElement ? nameElement.textContent.trim() : (img.alt || '');
          const url = img.src;
          
          if (url && name) {
            emojis.push({
              name: name.replace(/:/g, ''),
              url: url
            });
          }
        }
      });
    }
    
    return emojis;
  }

  // Function to get the average color of an image
  function getAverageColor(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      
      img.onload = function() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        
        ctx.drawImage(img, 0, 0);
        
        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          let r = 0, g = 0, b = 0, count = 0;
          
          // Sample pixels to get average color
          for (let i = 0; i < data.length; i += PIXEL_SAMPLE_STEP) {
            const alpha = data[i + 3];
            if (alpha > TRANSPARENCY_THRESHOLD) { // Only count non-transparent pixels
              r += data[i];
              g += data[i + 1];
              b += data[i + 2];
              count++;
            }
          }
          
          if (count > 0) {
            resolve({
              r: Math.round(r / count),
              g: Math.round(g / count),
              b: Math.round(b / count)
            });
          } else {
            resolve({ r: 255, g: 255, b: 255 }); // Default to white if all transparent
          }
        } catch (e) {
          // CORS error or other issue
          resolve({ r: 128, g: 128, b: 128 }); // Default to gray
        }
      };
      
      img.onerror = function() {
        resolve({ r: 128, g: 128, b: 128 }); // Default to gray on error
      };
      
      img.src = imageUrl;
    });
  }

  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractEmojis') {
      const emojis = extractEmojiData();
      
      // Get colors for each emoji
      Promise.all(emojis.map(async (emoji) => {
        const color = await getAverageColor(emoji.url);
        return { ...emoji, color };
      }))
      .then(emojisWithColors => {
        chrome.storage.local.set({ 
          slackEmojis: emojisWithColors,
          extractedAt: Date.now()
        }, () => {
          sendResponse({ 
            success: true, 
            count: emojisWithColors.length,
            emojis: emojisWithColors
          });
        });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      
      return true; // Keep the message channel open for async response
    }
  });

  // Auto-extract emojis when the page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        const emojis = extractEmojiData();
        if (emojis.length > 0) {
          console.log(`Slack Pixel Art: Found ${emojis.length} emojis on this page`);
        }
      }, 1000);
    });
  } else {
    setTimeout(() => {
      const emojis = extractEmojiData();
      if (emojis.length > 0) {
        console.log(`Slack Pixel Art: Found ${emojis.length} emojis on this page`);
      }
    }, 1000);
  }
})();
