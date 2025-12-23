// Content script that extracts emoji data from Slack's customize/emoji page

(function() {
  'use strict';
  
  // Constants
  const TRANSPARENCY_THRESHOLD = 128; // Alpha value threshold for considering pixels as opaque
  const PIXEL_SAMPLE_STEP = 16; // Sample every 4th pixel (4 RGBA values per pixel)

  // Function to scroll and load all emojis
  async function scrollToLoadAll() {
    const scrollContainer = document.querySelector('.p-customize_emoji_wrapper__list') || 
                           document.querySelector('[data-qa="customize_emoji_list"]') ||
                           document.querySelector('.c-scrollbar__child') ||
                           document.body;
    
    let lastScrollHeight = 0;
    let currentScrollHeight = scrollContainer.scrollHeight;
    let attempts = 0;
    const maxAttempts = 50; // Prevent infinite loop
    
    while (lastScrollHeight !== currentScrollHeight && attempts < maxAttempts) {
      lastScrollHeight = currentScrollHeight;
      scrollContainer.scrollTo(0, scrollContainer.scrollHeight);
      
      // Wait for new content to load
      await new Promise(resolve => setTimeout(resolve, 300));
      currentScrollHeight = scrollContainer.scrollHeight;
      attempts++;
    }
    
    // Scroll back to top
    scrollContainer.scrollTo(0, 0);
  }

  // Function to extract emoji data from the page
  function extractEmojiData() {
    const emojis = [];
    const seenNames = new Set(); // Avoid duplicates
    
    // Try multiple selector strategies for different Slack UI versions
    const selectors = [
      // Modern Slack
      'div[data-qa="customize_emoji_item"]',
      '.p-customize_emoji_wrapper__emoji_row',
      '.c-custom_emoji_item',
      // Fallback to any emoji images
      'img[data-stringify-type="emoji"]',
      'img[src*="/emoji/"]',
      'img[src*="emoji.slack-edge.com"]'
    ];
    
    let emojiElements = [];
    
    // Try each selector until we find emojis
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        emojiElements = Array.from(elements);
        console.log(`Found ${elements.length} emojis using selector: ${selector}`);
        break;
      }
    }
    
    // If still no emojis, try to find all images with emoji-like URLs
    if (emojiElements.length === 0) {
      emojiElements = Array.from(document.querySelectorAll('img')).filter(img => {
        if (!img.src) return false;
        try {
          const url = new URL(img.src);
          return (
            url.hostname.endsWith('.slack-edge.com') ||
            url.hostname.endsWith('.slack.com') ||
            url.pathname.includes('/emoji/')
          );
        } catch {
          return false;
        }
      });
      console.log(`Found ${emojiElements.length} emoji images via fallback`);
    }
    
    emojiElements.forEach((element) => {
      let img, name;
      
      // Check if element is an image or contains an image
      if (element.tagName === 'IMG') {
        img = element;
        // Try to find name from nearby elements
        const parent = img.closest('[data-qa="customize_emoji_item"]') || 
                      img.closest('.p-customize_emoji_wrapper__emoji_row') ||
                      img.closest('.c-custom_emoji_item');
        
        if (parent) {
          const nameElement = parent.querySelector('[data-qa="customize_emoji_name"]') ||
                             parent.querySelector('.c-emoji__name') ||
                             parent.querySelector('.emoji_name');
          name = nameElement ? nameElement.textContent.trim() : img.alt;
        } else {
          name = img.alt || img.getAttribute('aria-label') || img.getAttribute('data-emoji-name') || '';
        }
      } else {
        img = element.querySelector('img');
        const nameElement = element.querySelector('[data-qa="customize_emoji_name"]') ||
                           element.querySelector('.c-emoji__name') ||
                           element.querySelector('.emoji_name') ||
                           element.querySelector('[class*="name"]');
        name = nameElement ? nameElement.textContent.trim() : (img ? img.alt : '');
      }
      
      if (img && img.src && name) {
        const cleanName = name.replace(/:/g, '').trim();
        if (cleanName && !seenNames.has(cleanName)) {
          seenNames.add(cleanName);
          emojis.push({
            name: cleanName,
            url: img.src
          });
        }
      }
    });
    
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

  // Process emojis in batches to avoid browser freezing with large emoji sets
  async function processEmojisInBatches(emojis, batchSize = 100, onProgress = null) {
    const results = [];
    const totalBatches = Math.ceil(emojis.length / batchSize);
    
    for (let i = 0; i < emojis.length; i += batchSize) {
      const batch = emojis.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (emoji) => {
          const color = await getAverageColor(emoji.url);
          return { ...emoji, color };
        })
      );
      results.push(...batchResults);
      
      if (onProgress) {
        const currentBatch = Math.floor(i / batchSize) + 1;
        onProgress(currentBatch, totalBatches, results.length);
      }
      
      // Small delay between batches to keep UI responsive
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    return results;
  }

  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractEmojis') {
      // First scroll to load all emojis
      scrollToLoadAll()
        .then(() => {
          const emojis = extractEmojiData();
          
          // Get colors for each emoji in batches
          return processEmojisInBatches(emojis, 100, (currentBatch, totalBatches, processedCount) => {
            // Send progress updates
            console.log(`Processing batch ${currentBatch}/${totalBatches} (${processedCount} emojis processed)`);
          });
        })
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

  // Log extension loaded
  console.log('Slack Pixel Art extension loaded on emoji customization page');
})();
