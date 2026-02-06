// Content script that extracts emoji data from Slack's customize/emoji page

(function() {
  'use strict';
  
  // Function to get Slack API token from the page
  function getSlackApiToken() {
    // Try multiple methods to get the API token
    
    // Method 1: From boot_data (most reliable)
    if (typeof boot_data !== 'undefined' && boot_data.api_token) {
      return boot_data.api_token;
    }
    
    // Method 2: From window object variations
    if (window.boot_data && window.boot_data.api_token) {
      return window.boot_data.api_token;
    }
    
    // Method 3: Search in script tags for api_token
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const content = script.textContent;
      // Look for api_token in various formats
      const patterns = [
        /"api_token"\s*:\s*"(xoxc-[^"]+)"/,
        /"api_token"\s*:\s*"(xoxs-[^"]+)"/,
        /api_token['"]\s*:\s*['"]([^'"]+)['"]/,
        /token['"]\s*:\s*['"](xox[csp]-[^'"]+)['"]/
      ];
      
      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
          return match[1];
        }
      }
    }
    
    // Method 4: From localStorage
    try {
      const localTeamData = localStorage.getItem('localConfig_v2');
      if (localTeamData) {
        const parsed = JSON.parse(localTeamData);
        for (const key of Object.keys(parsed)) {
          if (parsed[key]?.token) {
            return parsed[key].token;
          }
        }
      }
    } catch (e) {
      // localStorage read failed; continue to return null
    }
    
    return null;
  }

  // Track if extraction is in progress to prevent duplicate runs
  let extractionInProgress = false;

  const COLOR_SAMPLER_VERSION = 4;

  // Send progress update to popup
  function sendProgressUpdate(phase, percent, details) {
    chrome.runtime.sendMessage({
      action: 'extractionProgress',
      phase: phase,
      percent: percent,
      details: details
    }).catch(() => {
      // Popup might be closed, ignore error
    });
  }

  // Fetch with retry on 429 rate limit
  async function fetchWithRetry(url, options, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(url, options);
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After'), 10);
        const delay = (retryAfter && retryAfter > 0 ? retryAfter : Math.pow(2, attempt)) * 1000;
        console.log(`Rate limited (429), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      return response;
    }
    // Final attempt exhausted — return the last 429 response so caller can handle it
    return fetch(url, options);
  }

  // Function to extract emojis via Slack API (preferred method)
  async function extractEmojisViaApi() {
    const token = getSlackApiToken();
    
    if (!token) {
      console.log('No API token found, falling back to DOM extraction');
      return null;
    }
    
    console.log('Attempting to fetch emojis via Slack API...');
    sendProgressUpdate('Connecting to API...', 10, 'Authenticating with Slack...');
    
    // Use the current hostname for Enterprise Grid support
    const baseUrl = window.location.origin;
    
    try {
      // Try emoji.adminList first (works on customize/emoji page for all emojis)
      // This API supports pagination for large emoji sets
      let allEmojis = [];
      let page = 1;
      const count = 500; // Number of emojis per page
      
      console.log('Using emoji.adminList API with pagination...');
      sendProgressUpdate('Fetching emoji list...', 15, 'Getting first page...');
      
      // First request to get total pages
      const firstResponse = await fetch(`${baseUrl}/api/emoji.adminList`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `token=${encodeURIComponent(token)}&page=1&count=${count}`,
        credentials: 'include'
      });
      
      if (!firstResponse.ok) {
        throw new Error(`API request failed: ${firstResponse.status}`);
      }
      
      const firstData = await firstResponse.json();
      
      if (!firstData.ok) {
        // If adminList fails, fall back to emoji.list
        console.log('emoji.adminList failed:', firstData.error, '- trying emoji.list...');
        return await extractEmojisViaEmojiList(baseUrl, token);
      }
      
      allEmojis = allEmojis.concat(firstData.emoji || []);
      const paging = firstData.paging || {};
      const totalPages = paging.pages || 1;
      const totalEmojis = paging.total || allEmojis.length;
      
      console.log(`Page 1/${totalPages}: ${allEmojis.length} emojis`);
      sendProgressUpdate('Fetching emojis...', 20, `Page 1/${totalPages} (${allEmojis.length.toLocaleString()} emojis)`);
      
      // Fetch remaining pages sequentially to avoid rate limiting
      for (page = 2; page <= totalPages; page++) {
        try {
          const response = await fetchWithRetry(`${baseUrl}/api/emoji.adminList`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `token=${encodeURIComponent(token)}&page=${page}&count=${count}`,
            credentials: 'include'
          });
          
          if (!response.ok) {
            console.warn(`Page ${page} request failed: ${response.status}, skipping...`);
            continue;
          }
          
          const data = await response.json();
          
          if (!data.ok) {
            console.warn(`Page ${page} API error: ${data.error}, skipping...`);
            continue;
          }
          
          const emojis = data.emoji || [];
          allEmojis = allEmojis.concat(emojis);
          
          // Calculate progress (20% to 60% for fetching)
          const fetchProgress = 20 + Math.floor((page / totalPages) * 40);
          console.log(`Page ${page}/${totalPages}: +${emojis.length} emojis (total: ${allEmojis.length})`);
          sendProgressUpdate('Fetching emojis...', fetchProgress, `Page ${page}/${totalPages} (${allEmojis.length.toLocaleString()} emojis)`);
          
          // Small delay to avoid rate limiting
          if (page % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (pageError) {
          console.warn(`Error fetching page ${page}:`, pageError.message, '- continuing...');
        }
      }
      
      // Convert to our format and deduplicate
      sendProgressUpdate('Processing emojis...', 65, 'Removing duplicates...');
      const seenNames = new Set();
      const result = [];
      
      for (const emoji of allEmojis) {
        if (emoji.name && emoji.url && !emoji.url.startsWith('alias:') && !seenNames.has(emoji.name)) {
          seenNames.add(emoji.name);
          result.push({
            name: emoji.name,
            url: emoji.url
          });
        }
      }
      
      console.log(`Successfully extracted ${result.length} unique emojis via API`);
      return result;
      
    } catch (error) {
      console.error('API extraction failed:', error);
      return null;
    }
  }
  
  // Fallback to emoji.list API
  async function extractEmojisViaEmojiList(baseUrl, token) {
    try {
      const response = await fetch(`${baseUrl}/api/emoji.list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `token=${encodeURIComponent(token)}`,
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error || 'Unknown error'}`);
      }
      
      const emojis = [];
      const emojiData = data.emoji || {};
      
      for (const [name, url] of Object.entries(emojiData)) {
        // Skip aliases (they start with "alias:")
        if (typeof url === 'string' && !url.startsWith('alias:')) {
          emojis.push({
            name: name,
            url: url
          });
        }
      }
      
      console.log(`Successfully extracted ${emojis.length} emojis via emoji.list API`);
      return emojis;
      
    } catch (error) {
      console.error('emoji.list API failed:', error);
      return null;
    }
  }

  // Function to scroll and load all emojis (fallback for DOM extraction)
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

  // Function to extract emoji data from the DOM (fallback method)
  function extractEmojiDataFromDom() {
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
      chrome.runtime.sendMessage({ action: 'sampleEmojiColor', url: imageUrl }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({
            color: { r: 128, g: 128, b: 128 },
            accentColor: { r: 128, g: 128, b: 128 },
            variance: 999,
            colorError: true
          });
          return;
        }

        resolve({
          color: response.color || { r: 128, g: 128, b: 128 },
          accentColor: response.accentColor || response.color || { r: 128, g: 128, b: 128 },
          variance: typeof response.variance === 'number' ? response.variance : 999,
          colorProfile: Array.isArray(response.colorProfile) ? response.colorProfile : undefined,
          colorError: Boolean(response.colorError)
        });
      });
    });
  }

  // Batch version: sample multiple emoji URLs in a single message round-trip
  function getAverageColors(urls) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'sampleEmojiColors', urls }, (responses) => {
        if (chrome.runtime.lastError || !responses) {
          resolve(urls.map(() => ({
            color: { r: 128, g: 128, b: 128 },
            accentColor: { r: 128, g: 128, b: 128 },
            variance: 999,
            colorError: true
          })));
          return;
        }
        resolve(responses.map(response => ({
          color: response.color || { r: 128, g: 128, b: 128 },
          accentColor: response.accentColor || response.color || { r: 128, g: 128, b: 128 },
          variance: typeof response.variance === 'number' ? response.variance : 999,
          colorProfile: Array.isArray(response.colorProfile) ? response.colorProfile : undefined,
          colorError: Boolean(response.colorError)
        })));
      });
    });
  }

  // Process emojis in batches to avoid browser freezing with large emoji sets
  async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= items.length) return;
        results[i] = await mapper(items[i], i);
      }
    });

    await Promise.all(workers);
    return results;
  }

  async function processEmojisInBatches(emojis, cachedByUrl, cachedVersion, forceResync, batchSize = 200, onProgress = null) {
    const results = [];
    const totalBatches = Math.ceil(emojis.length / batchSize);
    
    for (let i = 0; i < emojis.length; i += batchSize) {
      const batch = emojis.slice(i, i + batchSize);
      const batchResults = new Array(batch.length);
      const uncachedIndices = [];
      const uncachedUrls = [];

      // Separate cached vs uncached
      for (let j = 0; j < batch.length; j++) {
        const emoji = batch[j];
        if (!forceResync && cachedVersion === COLOR_SAMPLER_VERSION) {
          const cached = cachedByUrl.get(emoji.url);
          if (cached && cached.color && !cached.colorError) {
            batchResults[j] = {
              ...emoji,
              color: cached.color,
              accentColor: cached.accentColor || cached.color,
              variance: typeof cached.variance === 'number' ? cached.variance : 999,
              colorProfile: Array.isArray(cached.colorProfile) ? cached.colorProfile : undefined,
              colorError: false
            };
            continue;
          }
        }
        uncachedIndices.push(j);
        uncachedUrls.push(emoji.url);
      }

      // Batch-sample all uncached emojis in one message
      if (uncachedUrls.length > 0) {
        const colorResults = await getAverageColors(uncachedUrls);
        for (let k = 0; k < uncachedIndices.length; k++) {
          const j = uncachedIndices[k];
          const emoji = batch[j];
          const cr = colorResults[k];
          batchResults[j] = { ...emoji, ...cr };
        }
      }

      results.push(...batchResults);
      
      const currentBatch = Math.floor(i / batchSize) + 1;
      if (onProgress) {
        onProgress(currentBatch, totalBatches, results.length);
      }
      
      const colorProgress = 70 + Math.floor((currentBatch / totalBatches) * 25);
      sendProgressUpdate(
        'Analyzing colors...', 
        colorProgress, 
        `Processing ${results.length.toLocaleString()} of ${emojis.length.toLocaleString()} emojis`
      );
      
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    
    return results;
  }

  // Fallback delta extraction using emoji.list (for non-admin users)
  async function deltaViaEmojiList(baseUrl, token) {
    sendProgressUpdate('Fetching emoji list...', 30, 'Using fallback API (non-admin)...');
    const allEmojis = await extractEmojisViaEmojiList(baseUrl, token);
    if (!allEmojis || allEmojis.length === 0) return null;

    const cached = await chrome.storage.local.get(['slackEmojis']);
    const cachedNames = new Set((cached.slackEmojis || []).map(e => e.name));
    const newEmojis = allEmojis.filter(e => !cachedNames.has(e.name));

    console.log(`Delta via emoji.list: ${newEmojis.length} new emojis (out of ${allEmojis.length} total)`);
    return newEmojis;
  }

  // Delta extraction: fetch all emojis via API but return only those created after lastSyncDate
  async function deltaExtractEmojisViaApi(lastSyncDate) {
    const token = getSlackApiToken();

    if (!token) {
      console.log('No API token found for delta extraction');
      return null;
    }

    console.log('Delta extraction: fetching emojis created after', new Date(lastSyncDate).toISOString());
    sendProgressUpdate('Connecting to API...', 10, 'Authenticating with Slack...');

    const baseUrl = window.location.origin;
    const cutoffSeconds = lastSyncDate / 1000;

    try {
      let allEmojis = [];
      let page = 1;
      const count = 500;

      sendProgressUpdate('Fetching emoji list...', 15, 'Getting first page...');

      const firstResponse = await fetch(`${baseUrl}/api/emoji.adminList`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `token=${encodeURIComponent(token)}&page=1&count=${count}`,
        credentials: 'include'
      });

      if (!firstResponse.ok) {
        throw new Error(`API request failed: ${firstResponse.status}`);
      }

      const firstData = await firstResponse.json();

      if (!firstData.ok) {
        console.log('emoji.adminList failed for delta extraction:', firstData.error, '- falling back to emoji.list');
        return await deltaViaEmojiList(baseUrl, token);
      }

      allEmojis = allEmojis.concat(firstData.emoji || []);
      const paging = firstData.paging || {};
      const totalPages = paging.pages || 1;

      console.log(`Delta page 1/${totalPages}: ${allEmojis.length} emojis`);
      sendProgressUpdate('Fetching emojis...', 20, `Page 1/${totalPages} (${allEmojis.length.toLocaleString()} emojis)`);

      for (page = 2; page <= totalPages; page++) {
        try {
          const response = await fetchWithRetry(`${baseUrl}/api/emoji.adminList`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `token=${encodeURIComponent(token)}&page=${page}&count=${count}`,
            credentials: 'include'
          });

          if (!response.ok) {
            console.warn(`Delta page ${page} request failed: ${response.status}, skipping...`);
            continue;
          }

          const data = await response.json();

          if (!data.ok) {
            console.warn(`Delta page ${page} API error: ${data.error}, skipping...`);
            continue;
          }

          const emojis = data.emoji || [];
          allEmojis = allEmojis.concat(emojis);

          const fetchProgress = 20 + Math.floor((page / totalPages) * 40);
          console.log(`Delta page ${page}/${totalPages}: +${emojis.length} emojis (total: ${allEmojis.length})`);
          sendProgressUpdate('Fetching emojis...', fetchProgress, `Page ${page}/${totalPages} (${allEmojis.length.toLocaleString()} emojis)`);

          if (page % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (pageError) {
          console.warn(`Error fetching delta page ${page}:`, pageError.message, '- continuing...');
        }
      }

      // Filter to only emojis created after the cutoff, deduplicate, and convert to {name, url}
      sendProgressUpdate('Filtering new emojis...', 65, 'Finding recently added emojis...');
      const seenNames = new Set();
      const result = [];

      for (const emoji of allEmojis) {
        if (emoji.name && emoji.url && !emoji.url.startsWith('alias:') && !seenNames.has(emoji.name)) {
          if (emoji.created > cutoffSeconds) {
            seenNames.add(emoji.name);
            result.push({
              name: emoji.name,
              url: emoji.url
            });
          }
        }
      }

      console.log(`Delta extraction: ${result.length} new emojis (out of ${allEmojis.length} total)`);
      return result;

    } catch (error) {
      console.error('Delta API extraction failed:', error);
      return null;
    }
  }

  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractEmojis') {
      // Prevent duplicate extractions
      if (extractionInProgress) {
        console.log('Extraction already in progress, ignoring duplicate request');
        sendResponse({ success: false, error: 'Extraction already in progress. Please wait.', inProgress: true });
        return true;
      }
      
      extractionInProgress = true;
      sendProgressUpdate('Starting...', 5, 'Initializing extraction...');

      const forceResync = Boolean(request.forceResync);
      
      // Try API method first, fall back to DOM extraction
      extractEmojisViaApi()
        .then(async (apiEmojis) => {
          let emojis;
          let extractionMethod;
          
          if (apiEmojis && apiEmojis.length > 0) {
            emojis = apiEmojis;
            extractionMethod = 'api';
            console.log(`Using API extraction: ${emojis.length} emojis`);
          } else {
            // Fall back to DOM extraction
            console.log('API extraction failed, falling back to DOM extraction');
            sendProgressUpdate('Scanning page...', 30, 'API unavailable, scanning page for emojis...');
            await scrollToLoadAll();
            emojis = extractEmojiDataFromDom();
            extractionMethod = 'dom';
            console.log(`Using DOM extraction: ${emojis.length} emojis`);
          }
          
          if (emojis.length === 0) {
            throw new Error('No emojis found. Make sure you are on the Slack emoji customization page.');
          }

          // Build cache lookup for reuse (performance: avoid re-sampling unchanged emoji URLs)
          const cachedByUrl = new Map();
          let cachedVersion = -1;
          try {
            const cached = await chrome.storage.local.get(['slackEmojis', 'colorSamplerVersion']);
            cachedVersion = typeof cached.colorSamplerVersion === 'number' ? cached.colorSamplerVersion : -1;
            if (Array.isArray(cached.slackEmojis)) {
              for (const e of cached.slackEmojis) {
                if (e && typeof e.url === 'string') {
                  cachedByUrl.set(e.url, e);
                }
              }
            }
          } catch {
            // ignore
          }
          
          sendProgressUpdate('Analyzing colors...', 70, `Starting color analysis for ${emojis.length.toLocaleString()} emojis...`);
          
          // Get colors for each emoji in batches
          return processEmojisInBatches(emojis, cachedByUrl, cachedVersion, forceResync, 200, (currentBatch, totalBatches, processedCount) => {
            // Send progress updates
            console.log(`Processing batch ${currentBatch}/${totalBatches} (${processedCount} emojis processed)`);
          }).then(emojisWithColors => ({ emojisWithColors, extractionMethod }));
        })
        .then(({ emojisWithColors, extractionMethod }) => {
          sendProgressUpdate('Saving...', 98, 'Caching emojis for offline use...');
          
          const slimEmojis = emojisWithColors.map(e => ({
            name: e.name,
            url: e.url,
            color: e.color,
            accentColor: e.accentColor,
            variance: e.variance
          }));
          
          chrome.storage.local.set({ 
            slackEmojis: slimEmojis,
            extractedAt: Date.now(),
            extractionMethod: extractionMethod,
            colorSamplerVersion: COLOR_SAMPLER_VERSION
          }, () => {
            if (chrome.runtime.lastError) {
              console.warn('Storage save warning:', chrome.runtime.lastError.message);
              // Still report success - emojis are in memory even if storage failed
            }
            sendProgressUpdate('Complete!', 100, `${emojisWithColors.length.toLocaleString()} emojis ready to use!`);
            extractionInProgress = false;
            sendResponse({ 
              success: true, 
              count: emojisWithColors.length,
              emojis: emojisWithColors,
              method: extractionMethod
            });
          });
        })
        .catch(error => {
          extractionInProgress = false;
          sendResponse({ success: false, error: error.message });
        });
      
      return true; // Keep the message channel open for async response
    } else if (request.action === 'deltaExtractEmojis') {
      if (extractionInProgress) {
        console.log('Extraction already in progress, ignoring delta request');
        sendResponse({ success: false, error: 'Extraction already in progress. Please wait.', inProgress: true });
        return true;
      }

      extractionInProgress = true;
      sendProgressUpdate('Starting delta sync...', 5, 'Looking for new emojis...');

      deltaExtractEmojisViaApi(request.lastSyncDate)
        .then(async (newEmojis) => {
          if (!newEmojis) {
            throw new Error('Delta extraction failed. Could not connect to Slack API.');
          }

          if (newEmojis.length === 0) {
            extractionInProgress = false;
            sendProgressUpdate('Complete!', 100, 'No new emojis found.');
            sendResponse({ success: true, newEmojis: [], count: 0 });
            return;
          }

          sendProgressUpdate('Analyzing colors...', 70, `Processing ${newEmojis.length.toLocaleString()} new emojis...`);

          const emojisWithColors = await processEmojisInBatches(newEmojis, new Map(), -1, true, 200, (currentBatch, totalBatches, processedCount) => {
            console.log(`Delta color batch ${currentBatch}/${totalBatches} (${processedCount} emojis processed)`);
          });

          sendProgressUpdate('Complete!', 100, `${emojisWithColors.length.toLocaleString()} new emojis ready!`);
          extractionInProgress = false;
          sendResponse({ success: true, newEmojis: emojisWithColors, count: emojisWithColors.length });
        })
        .catch(error => {
          extractionInProgress = false;
          sendResponse({ success: false, error: error.message });
        });

      return true;
    } else if (request.action === 'scanDeletedEmojis') {
      const cachedNames = request.cachedNames || [];

      extractEmojisViaApi()
        .then(apiEmojis => {
          if (!apiEmojis) {
            throw new Error('Could not fetch current emoji list from API');
          }

          const currentNames = new Set(apiEmojis.map(e => e.name));
          const deletedNames = cachedNames.filter(name => !currentNames.has(name));

          sendResponse({ success: true, deletedNames });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });

      return true;
    } else if (request.action === 'getEmojiCount') {
      const emojiCountEl = document.querySelector('h4[data-qa="customize_emoji_count"]');
      if (emojiCountEl) {
        const parsed = parseInt(emojiCountEl.textContent.replace(/[^0-9]/g, ''), 10);
        sendResponse({ totalCount: isNaN(parsed) ? null : parsed });
      } else {
        sendResponse({ totalCount: null });
      }
      return false;
    }
  });

  // Log extension loaded
  console.log('Slack Pixel Art extension loaded on emoji customization page');

  // Detect emoji count from the page and notify the popup/background.
  // The element may not exist yet (Slack renders dynamically), so poll for it.
  let countCheckAttempts = 0;
  const countCheckInterval = setInterval(() => {
    countCheckAttempts++;
    const emojiCountEl = document.querySelector('h4[data-qa="customize_emoji_count"]');
    if (emojiCountEl) {
      clearInterval(countCheckInterval);
      const parsed = parseInt(emojiCountEl.textContent.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(parsed)) {
        chrome.runtime.sendMessage({ action: 'emojiCountCheck', totalCount: parsed }).catch(() => {});
      }
    } else if (countCheckAttempts >= 30) {
      clearInterval(countCheckInterval);
    }
  }, 1000);
})();
