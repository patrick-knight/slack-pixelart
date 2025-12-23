// Popup script - handles UI interactions and coordinates conversion

// Constants
const MAX_PREVIEW_LINES = 15; // Maximum lines to show in preview
const STATUS_MESSAGE_TIMEOUT = 2000; // Time to show status messages (ms)

let currentEmojis = [];
let currentResult = null;
let cachedEmojiCount = 0;

// DOM elements
const extractEmojisBtn = document.getElementById('extractEmojis');
const extractBtnText = document.getElementById('extractBtnText');
const forceResyncBtn = document.getElementById('forceResync');
const emojiStatus = document.getElementById('emojiStatus');
const cacheInfo = document.getElementById('cacheInfo');
const cacheCount = document.getElementById('cacheCount');
const cacheDate = document.getElementById('cacheDate');
const autoSyncCheckbox = document.getElementById('autoSync');
const syncAlert = document.getElementById('syncAlert');
const syncAlertText = document.getElementById('syncAlertText');
const extractProgress = document.getElementById('extractProgress');
const extractProgressBar = document.getElementById('extractProgressBar');
const progressPhase = document.getElementById('progressPhase');
const progressPercent = document.getElementById('progressPercent');
const progressDetails = document.getElementById('progressDetails');
const imageUrlInput = document.getElementById('imageUrl');
const loadFromUrlBtn = document.getElementById('loadFromUrl');
const imageFileInput = document.getElementById('imageFile');
const imageStatus = document.getElementById('imageStatus');
const widthInput = document.getElementById('width');
const heightInput = document.getElementById('height');
const charBudgetInput = document.getElementById('charBudget');
const toleranceInput = document.getElementById('tolerance');
const toleranceRange = document.getElementById('toleranceRange');
const generateBtn = document.getElementById('generate');
const generateStatus = document.getElementById('generateStatus');
const progressBar = document.getElementById('progress');
const progressFill = document.getElementById('progressBar');
const previewSection = document.getElementById('previewSection');
const preview = document.getElementById('preview');
const stats = document.getElementById('stats');
const copyToClipboardBtn = document.getElementById('copyToClipboard');
const downloadTextBtn = document.getElementById('downloadText');
const copyStatus = document.getElementById('copyStatus');
const visualPreview = document.getElementById('visualPreview');
const visualTabBtn = document.getElementById('visualTabBtn');
const textTabBtn = document.getElementById('textTabBtn');

let currentImageSource = null;
let currentImageIsUrl = true;
let currentGrid = null; // Store the grid for visual preview

// Format date for display
function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  
  return date.toLocaleDateString();
}

// Update cache info display
function updateCacheDisplay(emojiData) {
  if (emojiData && emojiData.length > 0) {
    cacheInfo.style.display = 'block';
    cacheCount.textContent = `${emojiData.length.toLocaleString()} emojis cached`;
    forceResyncBtn.style.display = 'inline-flex';
    extractBtnText.textContent = 'Update Cache';
  } else {
    cacheInfo.style.display = 'none';
    forceResyncBtn.style.display = 'none';
    extractBtnText.textContent = 'Extract Emojis';
  }
}

// Update cache date display
function updateCacheDateDisplay(timestamp) {
  if (timestamp) {
    cacheDate.textContent = `Updated ${formatDate(timestamp)}`;
  } else {
    cacheDate.textContent = '';
  }
}

// Show sync alert
function showSyncAlert(newCount, cachedCount) {
  const diff = newCount - cachedCount;
  syncAlert.style.display = 'flex';
  syncAlertText.textContent = `${diff.toLocaleString()} new emoji${diff !== 1 ? 's' : ''} available! (${newCount.toLocaleString()} total)`;
}

// Hide sync alert
function hideSyncAlert() {
  syncAlert.style.display = 'none';
}

// Show extraction progress
function showExtractionProgress() {
  extractProgress.style.display = 'block';
  extractProgressBar.style.width = '0%';
  progressPhase.textContent = 'Initializing...';
  progressPercent.textContent = '0%';
  progressDetails.textContent = 'Starting extraction...';
}

// Update extraction progress
function updateExtractionProgress(phase, percent, details) {
  progressPhase.textContent = phase;
  progressPercent.textContent = `${percent}%`;
  extractProgressBar.style.width = `${percent}%`;
  progressDetails.textContent = details;
}

// Hide extraction progress
function hideExtractionProgress() {
  extractProgress.style.display = 'none';
}

// Sync range slider with number input
toleranceRange.addEventListener('input', (e) => {
  toleranceInput.value = e.target.value;
});

toleranceInput.addEventListener('input', (e) => {
  toleranceRange.value = e.target.value;
});

// Load saved emojis and settings on popup open
chrome.storage.local.get(['slackEmojis', 'extractedAt', 'autoSync'], (result) => {
  if (result.slackEmojis && result.slackEmojis.length > 0) {
    currentEmojis = result.slackEmojis;
    cachedEmojiCount = result.slackEmojis.length;
    showStatus(emojiStatus, `${currentEmojis.length.toLocaleString()} emojis loaded from cache`, 'success');
    updateCacheDisplay(currentEmojis);
    updateCacheDateDisplay(result.extractedAt);
    checkReadyToGenerate();
  }
  
  // Load auto-sync preference
  if (result.autoSync !== undefined) {
    autoSyncCheckbox.checked = result.autoSync;
  }
});

// Save auto-sync preference when changed
autoSyncCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ autoSync: autoSyncCheckbox.checked });
});

// Extract emojis from current tab
extractEmojisBtn.addEventListener('click', () => startExtraction(false));
forceResyncBtn.addEventListener('click', () => startExtraction(true));

async function startExtraction(forceResync) {
  extractEmojisBtn.disabled = true;
  forceResyncBtn.disabled = true;
  hideSyncAlert();
  showExtractionProgress();
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('slack.com/customize/emoji')) {
      hideExtractionProgress();
      showStatus(emojiStatus, 'Please navigate to your Slack emoji customization page first', 'error');
      extractEmojisBtn.disabled = false;
      forceResyncBtn.disabled = false;
      return;
    }
    
    updateExtractionProgress('Connecting...', 5, 'Connecting to Slack page...');
    
    chrome.tabs.sendMessage(tab.id, { action: 'extractEmojis', forceResync }, (response) => {
      hideExtractionProgress();
      
      if (chrome.runtime.lastError) {
        showStatus(emojiStatus, 'Error: ' + chrome.runtime.lastError.message + '. Try reloading the Slack page.', 'error');
        extractEmojisBtn.disabled = false;
        forceResyncBtn.disabled = false;
        return;
      }
      
      if (response.success) {
        currentEmojis = response.emojis;
        cachedEmojiCount = response.count;
        const methodNote = response.method === 'api' ? ' (via Slack API)' : ' (via page scan)';
        const message = response.count > 10000 
          ? `Successfully extracted ${response.count.toLocaleString()} emojis${methodNote}!`
          : `Successfully extracted ${response.count.toLocaleString()} emojis${methodNote}!`;
        showStatus(emojiStatus, message, 'success');
        updateCacheDisplay(currentEmojis);
        updateCacheDateDisplay(Date.now());
        checkReadyToGenerate();
      } else if (response.inProgress) {
        showStatus(emojiStatus, 'Extraction already in progress. Please wait.', 'info');
      } else {
        showStatus(emojiStatus, 'Error: ' + response.error, 'error');
      }
      
      extractEmojisBtn.disabled = false;
      forceResyncBtn.disabled = false;
    });
  } catch (error) {
    hideExtractionProgress();
    showStatus(emojiStatus, 'Error: ' + error.message, 'error');
    extractEmojisBtn.disabled = false;
    forceResyncBtn.disabled = false;
  }
}

// Listen for progress updates from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractionProgress') {
    updateExtractionProgress(request.phase, request.percent, request.details);
  } else if (request.action === 'emojiCountCheck') {
    // Content script detected emoji count, check if sync needed
    if (request.totalCount > cachedEmojiCount && cachedEmojiCount > 0) {
      showSyncAlert(request.totalCount, cachedEmojiCount);
      
      // Auto-sync if enabled
      if (autoSyncCheckbox.checked) {
        startExtraction(true);
      }
    }
  }
});

// Load image from URL
loadFromUrlBtn.addEventListener('click', () => {
  const url = imageUrlInput.value.trim();
  
  if (!url) {
    showStatus(imageStatus, 'Please enter an image URL', 'error');
    return;
  }
  
  // Validate URL
  try {
    new URL(url);
  } catch (e) {
    showStatus(imageStatus, 'Invalid URL format', 'error');
    return;
  }
  
  currentImageSource = url;
  currentImageIsUrl = true;
  showStatus(imageStatus, 'Image URL loaded', 'success');
  checkReadyToGenerate();
});

// Load image from file
imageFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  
  if (!file) {
    return;
  }
  
  if (!file.type.startsWith('image/')) {
    showStatus(imageStatus, 'Please select an image file', 'error');
    return;
  }
  
  currentImageSource = file;
  currentImageIsUrl = false;
  showStatus(imageStatus, `File loaded: ${file.name}`, 'success');
  checkReadyToGenerate();
});

// Generate pixel art
generateBtn.addEventListener('click', async () => {
  generateBtn.disabled = true;
  previewSection.style.display = 'none';
  progressBar.style.display = 'block';
  progressFill.style.width = '0%';
  
  try {
    const options = {
      width: parseInt(widthInput.value),
      height: parseInt(heightInput.value),
      charBudget: parseInt(charBudgetInput.value),
      tolerance: parseInt(toleranceInput.value)
    };
    
    const converter = new PixelArtConverter(currentEmojis, options);
    
    const result = await converter.convert(
      currentImageSource,
      currentImageIsUrl,
      (progress, message) => {
        progressFill.style.width = progress + '%';
        showStatus(generateStatus, message, 'info');
      }
    );
    
    currentResult = result;
    displayResult(result);
    
    progressBar.style.display = 'none';
    showStatus(generateStatus, 'Generation complete!', 'success');
    previewSection.style.display = 'block';
    
  } catch (error) {
    progressBar.style.display = 'none';
    showStatus(generateStatus, 'Error: ' + error.message, 'error');
  }
  
  generateBtn.disabled = false;
});

// Copy to clipboard
copyToClipboardBtn.addEventListener('click', async () => {
  if (!currentResult) {
    return;
  }
  
  try {
    await navigator.clipboard.writeText(currentResult.output);
    showStatus(copyStatus, 'Copied to clipboard!', 'success');
    setTimeout(() => {
      copyStatus.style.display = 'none';
    }, STATUS_MESSAGE_TIMEOUT);
  } catch (error) {
    showStatus(copyStatus, 'Failed to copy: ' + error.message, 'error');
  }
});

// Download as text file
downloadTextBtn.addEventListener('click', () => {
  if (!currentResult) {
    return;
  }
  
  const blob = new Blob([currentResult.output], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'slack-pixelart.txt';
  a.click();
  URL.revokeObjectURL(url);
  
  showStatus(copyStatus, 'Downloaded!', 'success');
  setTimeout(() => {
    copyStatus.style.display = 'none';
  }, STATUS_MESSAGE_TIMEOUT);
});

// Helper functions
function showStatus(element, message, type) {
  element.textContent = message;
  element.className = 'status ' + type;
}

function checkReadyToGenerate() {
  const hasEmojis = currentEmojis.length > 0;
  const hasImage = currentImageSource !== null;
  generateBtn.disabled = !(hasEmojis && hasImage);
}

function displayResult(result) {
  // Display preview (truncated if too long)
  const lines = result.output.split('\n');
  const previewLines = lines.slice(0, MAX_PREVIEW_LINES);
  if (lines.length > MAX_PREVIEW_LINES) {
    previewLines.push('... (truncated in preview)');
  }
  preview.textContent = previewLines.join('\n');
  
  // Display stats
  const statsHtml = `
    <div><strong>Dimensions:</strong> ${result.stats.dimensions.width} × ${result.stats.dimensions.height}</div>
    <div><strong>Total Emojis:</strong> ${result.stats.totalEmojis}</div>
    <div><strong>Unique Emojis:</strong> ${result.stats.uniqueEmojis}</div>
    <div><strong>Character Count:</strong> ${result.stats.characterCount}</div>
    <div><strong>Top 5 Emojis:</strong></div>
    ${result.stats.topEmojis.map(e => `<div style="margin-left: 20px;">:${e.name}: (${e.count}×)</div>`).join('')}
  `;
  stats.innerHTML = statsHtml;
}
