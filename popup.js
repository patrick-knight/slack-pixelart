/* global PixelArtConverter */
// Popup script - handles UI interactions and coordinates conversion

// Constants
const MAX_PREVIEW_LINES = 15; // Maximum lines to show in preview
const STATUS_MESSAGE_TIMEOUT = 2000; // Time to show status messages (ms)

function slimEmojisForStorage(emojis) {
  return emojis.map(e => {
    const slim = {
      name: e.name,
      url: e.url,
      color: e.color,
      accentColor: e.accentColor,
      variance: e.variance
    };
    // Store compact color profile (top 2 clusters as [r,g,b,weight%])
    const cp = e.colorProfile || e.cp;
    if (Array.isArray(cp) && cp.length > 0) {
      slim.cp = cp.slice(0, 2).map(c => {
        const rgb = c.rgb || c;
        const w = c.weight != null ? Math.round(c.weight * 100) : (c[3] != null ? c[3] : 50);
        return [rgb.r || rgb[0], rgb.g || rgb[1], rgb.b || rgb[2], w];
      });
    }
    return slim;
  });
}

let currentEmojis = [];
let currentResult = null;
let cachedEmojiCount = 0;
let lastExtractedAt = null;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// DOM elements
const emojiPageUrlInput = document.getElementById('emojiPageUrl');
const openEmojiPageBtn = document.getElementById('openEmojiPage');
const extractEmojisBtn = document.getElementById('extractEmojis');
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
const ditheringCheckbox = document.getElementById('dithering');
const ditherStrengthInput = document.getElementById('ditherStrength');
const ditherStrengthRange = document.getElementById('ditherStrengthRange');
const texturePenaltyInput = document.getElementById('texturePenalty');
const texturePenaltyRange = document.getElementById('texturePenaltyRange');
const rasterSamplesInput = document.getElementById('rasterSamples');
const rasterSamplesRange = document.getElementById('rasterSamplesRange');
const lanczosInterpolationCheckbox = document.getElementById('lanczosInterpolation');
const adaptiveSamplingCheckbox = document.getElementById('adaptiveSampling');
const adaptiveDitheringCheckbox = document.getElementById('adaptiveDithering');
const sharpeningStrengthInput = document.getElementById('sharpeningStrength');
const sharpeningStrengthRange = document.getElementById('sharpeningStrengthRange');
const colorMetricSelect = document.getElementById('colorMetric');
const saturationBoostInput = document.getElementById('saturationBoost');
const saturationBoostRange = document.getElementById('saturationBoostRange');
const claheCheckbox = document.getElementById('clahe');
const spatialCoherenceCheckbox = document.getElementById('spatialCoherence');
const hybridDitheringCheckbox = document.getElementById('hybridDithering');
const perColorToleranceCheckbox = document.getElementById('perColorTolerance');
const medianFilterCheckbox = document.getElementById('medianFilter');
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
let referenceImageUrl = null;
let comparisonMode = 'side-by-side';

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
  } else {
    cacheInfo.style.display = 'none';
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

// Preview tab switching
visualTabBtn.addEventListener('click', () => {
  visualTabBtn.classList.add('active');
  textTabBtn.classList.remove('active');
  visualPreview.style.display = 'flex';
  preview.style.display = 'none';
});

textTabBtn.addEventListener('click', () => {
  textTabBtn.classList.add('active');
  visualTabBtn.classList.remove('active');
  preview.style.display = 'block';
  visualPreview.style.display = 'none';
});

// Render visual preview with emoji images
function renderVisualPreview(grid, emojiSize = 16) {
  visualPreview.innerHTML = '';
  
  const cols = grid[0] ? grid[0].length : 0;
  const rows = grid.length;
  
  // Auto-fit: calculate emoji size so grid fills available width without scrolling.
  // visualPreview has 12px padding on each side; in side-by-side mode the container
  // splits into two panes with an 8px gap.
  const previewPadding = 24; // 12px * 2
  const availableWidth = visualPreview.clientWidth > 0
    ? visualPreview.clientWidth - previewPadding
    : 650 - 32 - previewPadding; // fallback: popup - container padding - preview padding
  const isSideBySide = referenceImageUrl && comparisonMode === 'side-by-side';
  const panes = isSideBySide ? 2 : 1;
  const gapBetweenPanes = isSideBySide ? 8 : 0;
  const paneWidth = (availableWidth - gapBetweenPanes) / panes;
  const autoSize = cols > 0 ? Math.floor(paneWidth / cols) : emojiSize;
  emojiSize = Math.max(8, Math.min(32, autoSize));
  
  // Add zoom controls
  const zoomControls = document.createElement('div');
  zoomControls.className = 'zoom-controls';
  zoomControls.innerHTML = `
    <label>Zoom:</label>
    <input type="range" id="zoomSlider" min="8" max="32" value="${emojiSize}">
    <span class="zoom-value" id="zoomValue">${emojiSize}px</span>
  `;
  visualPreview.appendChild(zoomControls);
  
  // Comparison container wraps reference + mosaic
  const comparisonContainer = document.createElement('div');
  comparisonContainer.id = 'comparisonContainer';
  comparisonContainer.className = comparisonMode === 'overlay' ? 'comparison-container overlay' : 'comparison-container';
  
  // Reference pane
  if (referenceImageUrl) {
    const refPane = document.createElement('div');
    refPane.className = comparisonMode === 'overlay' ? 'comparison-pane overlay-pane' : 'comparison-pane';
    refPane.id = 'referencePane';
    
    const refLabel = document.createElement('div');
    refLabel.className = 'comparison-pane-label';
    refLabel.textContent = 'Reference';
    refPane.appendChild(refLabel);
    
    const refImg = document.createElement('img');
    refImg.className = 'reference-img';
    refImg.src = referenceImageUrl;
    refImg.alt = 'Reference image';
    refImg.style.width = `${cols * emojiSize}px`;
    refImg.style.height = `${rows * emojiSize}px`;
    refImg.id = 'referenceImage';
    refPane.appendChild(refImg);
    
    if (comparisonMode === 'overlay') {
      const opacitySlider = document.getElementById('overlayOpacity');
      refPane.style.opacity = (opacitySlider ? opacitySlider.value : 50) / 100;
      refPane.style.pointerEvents = 'none';
    }
    
    comparisonContainer.appendChild(refPane);
  }
  
  // Mosaic pane
  const mosaicPane = document.createElement('div');
  mosaicPane.className = 'comparison-pane';
  
  if (referenceImageUrl) {
    const mosaicLabel = document.createElement('div');
    mosaicLabel.className = 'comparison-pane-label';
    mosaicLabel.textContent = 'Mosaic';
    mosaicPane.appendChild(mosaicLabel);
  }
  
  // Container for the emoji grid
  const gridContainer = document.createElement('div');
  gridContainer.id = 'emojiGridContainer';
  
  // Build emoji lookup from current emojis
  const emojiLookup = new Map();
  for (const emoji of currentEmojis) {
    emojiLookup.set(emoji.name, emoji.url);
  }
  
  // Render each row
  for (const row of grid) {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'emoji-row';
    
    for (const emoji of row) {
      const cell = document.createElement('div');
      cell.className = 'emoji-cell';
      cell.style.width = `${emojiSize}px`;
      cell.style.height = `${emojiSize}px`;
      
      if (emoji && emoji.url) {
        const img = document.createElement('img');
        img.src = emoji.url;
        img.alt = emoji.name;
        img.title = `:${emoji.name}:`;
        img.style.width = `${emojiSize}px`;
        img.style.height = `${emojiSize}px`;
        img.loading = 'lazy';
        cell.appendChild(img);
      }
      
      rowDiv.appendChild(cell);
    }
    
    gridContainer.appendChild(rowDiv);
  }
  
  mosaicPane.appendChild(gridContainer);
  comparisonContainer.appendChild(mosaicPane);
  visualPreview.appendChild(comparisonContainer);
  
  // Add zoom slider functionality
  const zoomSlider = document.getElementById('zoomSlider');
  const zoomValue = document.getElementById('zoomValue');
  
  zoomSlider.addEventListener('input', (e) => {
    const newSize = parseInt(e.target.value);
    zoomValue.textContent = `${newSize}px`;
    
    // Update all emoji cells and images
    const cells = gridContainer.querySelectorAll('.emoji-cell');
    cells.forEach(cell => {
      cell.style.width = `${newSize}px`;
      cell.style.height = `${newSize}px`;
      const img = cell.querySelector('img');
      if (img) {
        img.style.width = `${newSize}px`;
        img.style.height = `${newSize}px`;
      }
    });
    
    // Update reference image size to match
    const refImg = document.getElementById('referenceImage');
    if (refImg) {
      refImg.style.width = `${cols * newSize}px`;
      refImg.style.height = `${rows * newSize}px`;
    }
  });
}

// Sync range slider with number input
toleranceRange.addEventListener('input', (e) => {
  toleranceInput.value = e.target.value;
});

toleranceInput.addEventListener('input', (e) => {
  toleranceRange.value = e.target.value;
});

ditherStrengthRange.addEventListener('input', (e) => {
  ditherStrengthInput.value = e.target.value;
});

ditherStrengthInput.addEventListener('input', (e) => {
  ditherStrengthRange.value = e.target.value;
});

texturePenaltyRange.addEventListener('input', (e) => {
  texturePenaltyInput.value = e.target.value;
});

texturePenaltyInput.addEventListener('input', (e) => {
  texturePenaltyRange.value = e.target.value;
});

rasterSamplesRange.addEventListener('input', (e) => {
  rasterSamplesInput.value = e.target.value;
});

rasterSamplesInput.addEventListener('input', (e) => {
  rasterSamplesRange.value = e.target.value;
});

sharpeningStrengthRange.addEventListener('input', (e) => {
  sharpeningStrengthInput.value = e.target.value;
});

sharpeningStrengthInput.addEventListener('input', (e) => {
  sharpeningStrengthRange.value = e.target.value;
});

saturationBoostRange.addEventListener('input', (e) => {
  saturationBoostInput.value = e.target.value;
});

saturationBoostInput.addEventListener('input', (e) => {
  saturationBoostRange.value = e.target.value;
});

// Load saved emojis and settings on popup open
chrome.storage.local.get(['slackEmojis', 'extractedAt', 'autoSync', 'dithering', 'ditherStrength', 'texturePenalty', 'rasterSamples', 'lanczosInterpolation', 'adaptiveSampling', 'adaptiveDithering', 'sharpeningStrength', 'emojiPageUrl', 'extractionProgress', 'colorMetric', 'saturationBoost', 'clahe', 'spatialCoherence', 'hybridDithering', 'perColorTolerance', 'medianFilter'], (result) => {
  // Restore in-progress extraction progress bar
  if (result.extractionProgress && result.extractionProgress.inProgress) {
    const ep = result.extractionProgress;
    showExtractionProgress();
    updateExtractionProgress(ep.phase, ep.percent, ep.details);
    extractEmojisBtn.disabled = true;
  }

  if (result.emojiPageUrl) {
    emojiPageUrlInput.value = result.emojiPageUrl;
  }

  if (result.slackEmojis && result.slackEmojis.length > 0) {
    currentEmojis = result.slackEmojis;
    cachedEmojiCount = result.slackEmojis.length;
    lastExtractedAt = result.extractedAt;
    showStatus(emojiStatus, `${currentEmojis.length.toLocaleString()} emojis loaded from cache`, 'success');
    updateCacheDisplay(currentEmojis);
    updateCacheDateDisplay(result.extractedAt);
    checkReadyToGenerate();
  }
  
  // Load auto-sync preference
  if (result.autoSync !== undefined) {
    autoSyncCheckbox.checked = result.autoSync;
  }

  // Load dithering preference
  if (result.dithering !== undefined) {
    ditheringCheckbox.checked = result.dithering;
  }

  if (result.ditherStrength !== undefined) {
    ditherStrengthInput.value = result.ditherStrength;
    ditherStrengthRange.value = result.ditherStrength;
  }

  if (result.texturePenalty !== undefined) {
    texturePenaltyInput.value = result.texturePenalty;
    texturePenaltyRange.value = result.texturePenalty;
  }

  if (result.rasterSamples !== undefined) {
    rasterSamplesInput.value = result.rasterSamples;
    rasterSamplesRange.value = result.rasterSamples;
  }

  // Load new quality enhancement preferences
  if (result.lanczosInterpolation !== undefined) {
    lanczosInterpolationCheckbox.checked = result.lanczosInterpolation;
  }

  if (result.adaptiveSampling !== undefined) {
    adaptiveSamplingCheckbox.checked = result.adaptiveSampling;
  }

  if (result.adaptiveDithering !== undefined) {
    adaptiveDitheringCheckbox.checked = result.adaptiveDithering;
  }

  if (result.sharpeningStrength !== undefined) {
    sharpeningStrengthInput.value = result.sharpeningStrength;
    sharpeningStrengthRange.value = result.sharpeningStrength;
  }

  if (result.colorMetric !== undefined) {
    colorMetricSelect.value = result.colorMetric;
  }

  if (result.saturationBoost !== undefined) {
    saturationBoostInput.value = result.saturationBoost;
    saturationBoostRange.value = result.saturationBoost;
  }

  if (result.clahe !== undefined) {
    claheCheckbox.checked = result.clahe;
  }

  if (result.spatialCoherence !== undefined) {
    spatialCoherenceCheckbox.checked = result.spatialCoherence;
  }

  if (result.hybridDithering !== undefined) {
    hybridDitheringCheckbox.checked = result.hybridDithering;
  }

  if (result.perColorTolerance !== undefined) {
    perColorToleranceCheckbox.checked = result.perColorTolerance;
  }

  if (result.medianFilter !== undefined) {
    medianFilterCheckbox.checked = result.medianFilter;
  }
});

// Save auto-sync preference when changed
autoSyncCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ autoSync: autoSyncCheckbox.checked });
});

// Save emoji page URL when changed
emojiPageUrlInput.addEventListener('change', () => {
  chrome.storage.local.set({ emojiPageUrl: emojiPageUrlInput.value.trim() });
});

// Open emoji page in a new tab
openEmojiPageBtn.addEventListener('click', () => {
  const url = emojiPageUrlInput.value.trim();
  if (!url) {
    showStatus(emojiStatus, 'Please enter your Slack emoji page URL', 'error');
    return;
  }
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('slack.com')) {
      showStatus(emojiStatus, 'URL must be a slack.com domain', 'error');
      return;
    }
  } catch {
    showStatus(emojiStatus, 'Invalid URL format', 'error');
    return;
  }
  chrome.storage.local.set({ emojiPageUrl: url });
  chrome.tabs.create({ url });
});

ditheringCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ dithering: ditheringCheckbox.checked });
});

ditherStrengthInput.addEventListener('change', () => {
  chrome.storage.local.set({ ditherStrength: parseInt(ditherStrengthInput.value) });
});

texturePenaltyInput.addEventListener('change', () => {
  chrome.storage.local.set({ texturePenalty: parseInt(texturePenaltyInput.value) });
});

rasterSamplesInput.addEventListener('change', () => {
  chrome.storage.local.set({ rasterSamples: parseInt(rasterSamplesInput.value) });
});

lanczosInterpolationCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ lanczosInterpolation: lanczosInterpolationCheckbox.checked });
});

adaptiveSamplingCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ adaptiveSampling: adaptiveSamplingCheckbox.checked });
});

adaptiveDitheringCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ adaptiveDithering: adaptiveDitheringCheckbox.checked });
});

sharpeningStrengthInput.addEventListener('change', () => {
  chrome.storage.local.set({ sharpeningStrength: parseInt(sharpeningStrengthInput.value) });
});

colorMetricSelect.addEventListener('change', () => {
  chrome.storage.local.set({ colorMetric: colorMetricSelect.value });
});

saturationBoostInput.addEventListener('change', () => {
  chrome.storage.local.set({ saturationBoost: parseInt(saturationBoostInput.value) });
});

claheCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ clahe: claheCheckbox.checked });
});

spatialCoherenceCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ spatialCoherence: spatialCoherenceCheckbox.checked });
});

hybridDitheringCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ hybridDithering: hybridDitheringCheckbox.checked });
});

perColorToleranceCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ perColorTolerance: perColorToleranceCheckbox.checked });
});

medianFilterCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ medianFilter: medianFilterCheckbox.checked });
});

// Extract emojis from current tab
extractEmojisBtn.addEventListener('click', () => startExtraction());

async function startExtraction() {
  extractEmojisBtn.disabled = true;
  hideSyncAlert();
  showExtractionProgress();
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('slack.com/customize/emoji')) {
      hideExtractionProgress();
      showStatus(emojiStatus, 'Please navigate to your Slack emoji customization page first', 'error');
      extractEmojisBtn.disabled = false;
      return;
    }
    
    updateExtractionProgress('Connecting...', 5, 'Connecting to Slack page...');
    
    // Delta sync if cache exists, full extraction otherwise
    if (lastExtractedAt && currentEmojis.length > 0) {
      chrome.tabs.sendMessage(tab.id, { action: 'deltaExtractEmojis', lastSyncDate: lastExtractedAt }, (response) => {
        hideExtractionProgress();
        
        if (chrome.runtime.lastError) {
          showStatus(emojiStatus, 'Error: ' + chrome.runtime.lastError.message + '. Try reloading the Slack page.', 'error');
          extractEmojisBtn.disabled = false;
          return;
        }
        
        if (response && response.success && response.count > 0) {
          currentEmojis = currentEmojis.concat(response.newEmojis);
          cachedEmojiCount = currentEmojis.length;
          const now = Date.now();
          lastExtractedAt = now;
          chrome.storage.local.set({ slackEmojis: slimEmojisForStorage(currentEmojis), extractedAt: now });
          updateCacheDisplay(currentEmojis);
          updateCacheDateDisplay(now);
          showStatus(emojiStatus, `Synced ${response.count} new emoji${response.count !== 1 ? 's' : ''}`, 'success');
          checkReadyToGenerate();
        } else if (response && response.success) {
          showStatus(emojiStatus, 'Cache is up to date', 'info');
        } else if (response && response.inProgress) {
          showStatus(emojiStatus, 'Extraction already in progress. Please wait.', 'info');
        } else {
          showStatus(emojiStatus, 'Error: ' + (response ? response.error : 'No response'), 'error');
        }
        
        extractEmojisBtn.disabled = false;
        startDeletedScan();
      });
    } else {
      chrome.tabs.sendMessage(tab.id, { action: 'extractEmojis' }, (response) => {
        hideExtractionProgress();
        
        if (chrome.runtime.lastError) {
          showStatus(emojiStatus, 'Error: ' + chrome.runtime.lastError.message + '. Try reloading the Slack page.', 'error');
          extractEmojisBtn.disabled = false;
          return;
        }
        
        if (response.success) {
          currentEmojis = response.emojis;
          cachedEmojiCount = response.count;
          lastExtractedAt = Date.now();
          const methodNote = response.method === 'api' ? ' (via Slack API)' : ' (via page scan)';
          const fallbackColors = Array.isArray(response.emojis)
            ? response.emojis.reduce((acc, e) => acc + (e && e.colorError ? 1 : 0), 0)
            : 0;

          const fallbackNote = fallbackColors > 0
            ? ` (${fallbackColors.toLocaleString()} fallback colors)`
            : '';

          const message = `Successfully extracted ${response.count.toLocaleString()} emojis${methodNote}!`;
          showStatus(emojiStatus, message + fallbackNote, fallbackColors > 0 ? 'info' : 'success');
          updateCacheDisplay(currentEmojis);
          updateCacheDateDisplay(Date.now());
          checkReadyToGenerate();
        } else if (response.inProgress) {
          showStatus(emojiStatus, 'Extraction already in progress. Please wait.', 'info');
        } else {
          showStatus(emojiStatus, 'Error: ' + response.error, 'error');
        }
        
        extractEmojisBtn.disabled = false;
      });
    }
  } catch (error) {
    hideExtractionProgress();
    showStatus(emojiStatus, 'Error: ' + error.message, 'error');
    extractEmojisBtn.disabled = false;
  }
}

// Scan for deleted emojis in the background
function startDeletedScan() {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { action: 'scanDeletedEmojis', cachedNames: currentEmojis.map(e => e.name) }, (response) => {
        try {
          if (chrome.runtime.lastError) {
            console.error('Deleted scan error:', chrome.runtime.lastError.message);
            return;
          }
          if (response && response.success && response.deletedNames && response.deletedNames.length > 0) {
            const deletedSet = new Set(response.deletedNames);
            currentEmojis = currentEmojis.filter(e => !deletedSet.has(e.name));
            cachedEmojiCount = currentEmojis.length;
            chrome.storage.local.set({ slackEmojis: slimEmojisForStorage(currentEmojis), extractedAt: Date.now() });
            updateCacheDisplay(currentEmojis);
            updateCacheDateDisplay(Date.now());
            showStatus(emojiStatus, `Removed ${response.deletedNames.length} deleted emoji${response.deletedNames.length !== 1 ? 's' : ''}`, 'info');
          }
        } catch (err) {
          console.error('Deleted scan processing error:', err);
        }
      });
    });
  } catch (err) {
    console.error('Deleted scan error:', err);
  }
}

// Handle an emoji count from the Slack page — trigger delta sync or show alert
function handleEmojiCountCheck(totalCount) {
  if (totalCount !== cachedEmojiCount && cachedEmojiCount > 0) {
    if (autoSyncCheckbox.checked && lastExtractedAt) {
      showExtractionProgress();
      updateExtractionProgress('Syncing new emojis...', 10, 'Checking for new emojis...');
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
          hideExtractionProgress();
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, { action: 'deltaExtractEmojis', lastSyncDate: lastExtractedAt }, (response) => {
          if (chrome.runtime.lastError) {
            hideExtractionProgress();
            showStatus(emojiStatus, 'Sync error: ' + chrome.runtime.lastError.message, 'error');
            return;
          }
          if (response && response.success && response.count > 0) {
            currentEmojis = currentEmojis.concat(response.newEmojis);
            cachedEmojiCount = currentEmojis.length;
            const now = Date.now();
            lastExtractedAt = now;
            chrome.storage.local.set({ slackEmojis: slimEmojisForStorage(currentEmojis), extractedAt: now });
            updateCacheDisplay(currentEmojis);
            updateCacheDateDisplay(now);
            showStatus(emojiStatus, `Synced ${response.count} new emoji${response.count !== 1 ? 's' : ''}`, 'success');
          } else if (response && response.success) {
            showStatus(emojiStatus, 'Cache is up to date', 'info');
          }
          hideExtractionProgress();
          startDeletedScan();
        });
      });
    } else {
      showSyncAlert(totalCount, cachedEmojiCount);
    }
  }
}

// Listen for progress updates from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractionProgress') {
    updateExtractionProgress(request.phase, request.percent, request.details);
  } else if (request.action === 'emojiCountCheck') {
    handleEmojiCountCheck(request.totalCount);
  }
});

// Also listen for storage changes to pick up progress when popup reopens mid-extraction
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.extractionProgress) {
    const ep = changes.extractionProgress.newValue;
    if (ep && ep.inProgress) {
      showExtractionProgress();
      updateExtractionProgress(ep.phase, ep.percent, ep.details);
      extractEmojisBtn.disabled = true;
    } else {
      hideExtractionProgress();
      extractEmojisBtn.disabled = false;
      // Reload emojis from cache since extraction just finished
      chrome.storage.local.get(['slackEmojis', 'extractedAt'], (result) => {
        if (result.slackEmojis && result.slackEmojis.length > 0) {
          currentEmojis = result.slackEmojis;
          cachedEmojiCount = result.slackEmojis.length;
          lastExtractedAt = result.extractedAt;
          showStatus(emojiStatus, `${currentEmojis.length.toLocaleString()} emojis synced`, 'success');
          updateCacheDisplay(currentEmojis);
          updateCacheDateDisplay(result.extractedAt);
          checkReadyToGenerate();
        }
      });
    }
  }
});

// On popup open, proactively ask the content script for the emoji count
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0] && tabs[0].url && tabs[0].url.includes('slack.com/customize/emoji')) {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getEmojiCount' }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      if (response.totalCount) {
        handleEmojiCountCheck(response.totalCount);
      }
    });
  }
});

// Analyze an image and auto-configure Advanced Image Controls
function analyzeAndAutoConfig(imageSource, isUrl) {
  const img = new Image();
  img.crossOrigin = 'anonymous';

  const onLoad = () => {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    // Compute metrics: approximate unique color count and edge density
    const colorSet = new Set();
    let edgePixels = 0;
    const pixels = size * size;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        // Quantize to 4-bit per channel for unique color counting
        const qr = data[i] >> 4, qg = data[i + 1] >> 4, qb = data[i + 2] >> 4;
        colorSet.add((qr << 8) | (qg << 4) | qb);

        // Edge detection: compare with right and bottom neighbors
        if (x < size - 1) {
          const j = (y * size + x + 1) * 4;
          const diff = Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
          if (diff > 80) edgePixels++;
        }
        if (y < size - 1) {
          const j = ((y + 1) * size + x) * 4;
          const diff = Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
          if (diff > 80) edgePixels++;
        }
      }
    }

    const uniqueColors = colorSet.size;
    const edgeDensity = edgePixels / (2 * pixels);

    // Classify: photo (many colors, smooth gradients) vs graphic (few colors, hard edges)
    const isPhoto = uniqueColors > 500 && edgeDensity < 0.3;
    const isGraphic = uniqueColors < 200 || edgeDensity > 0.4;

    if (isPhoto) {
      // Photo preset: smooth gradients, solid emojis, sharpening, CLAHE for detail
      applyPreset({ dithering: true, ditherStrength: 85, texturePenalty: 70, rasterSamples: 4, lanczos: true, adaptiveSampling: true, adaptiveDithering: true, sharpening: 60, colorMetric: 'ciede2000', saturationBoost: 115, clahe: true, spatialCoherence: true, hybridDithering: true, perColorTolerance: true, medianFilter: false });
      showStatus(imageStatus, 'Photo detected — settings optimized for photos', 'success');
    } else if (isGraphic) {
      // Logo/pixel art preset: no dithering, sharp edges
      applyPreset({ dithering: false, ditherStrength: 0, texturePenalty: 40, rasterSamples: 2, lanczos: true, adaptiveSampling: true, adaptiveDithering: false, sharpening: 0, colorMetric: 'oklab', saturationBoost: 100, clahe: false, spatialCoherence: false, hybridDithering: false, perColorTolerance: false, medianFilter: false });
      showStatus(imageStatus, 'Graphic/logo detected — settings optimized for sharp edges', 'success');
    } else {
      // Mixed/default preset
      applyPreset({ dithering: true, ditherStrength: 70, texturePenalty: 55, rasterSamples: 3, lanczos: true, adaptiveSampling: true, adaptiveDithering: true, sharpening: 30, colorMetric: 'oklab', saturationBoost: 105, clahe: false, spatialCoherence: false, hybridDithering: false, perColorTolerance: true, medianFilter: false });
      showStatus(imageStatus, 'Image loaded — settings auto-configured', 'success');
    }
  };

  img.onerror = () => {
    // Analysis failed silently — keep current settings
  };

  if (isUrl) {
    img.src = imageSource;
  } else {
    img.src = URL.createObjectURL(imageSource);
    img.onload = () => { onLoad(); URL.revokeObjectURL(img.src); };
    return;
  }
  img.onload = onLoad;
}

function applyPreset({ dithering, ditherStrength, texturePenalty, rasterSamples, lanczos, adaptiveSampling, adaptiveDithering, sharpening, colorMetric, saturationBoost, clahe, spatialCoherence, hybridDithering, perColorTolerance, medianFilter }) {
  ditheringCheckbox.checked = dithering;
  ditherStrengthInput.value = ditherStrength;
  ditherStrengthRange.value = ditherStrength;
  texturePenaltyInput.value = texturePenalty;
  texturePenaltyRange.value = texturePenalty;
  rasterSamplesInput.value = rasterSamples;
  rasterSamplesRange.value = rasterSamples;
  lanczosInterpolationCheckbox.checked = lanczos;
  adaptiveSamplingCheckbox.checked = adaptiveSampling;
  adaptiveDitheringCheckbox.checked = adaptiveDithering;
  sharpeningStrengthInput.value = sharpening;
  sharpeningStrengthRange.value = sharpening;
  colorMetricSelect.value = colorMetric;
  saturationBoostInput.value = saturationBoost;
  saturationBoostRange.value = saturationBoost;
  claheCheckbox.checked = clahe;
  spatialCoherenceCheckbox.checked = spatialCoherence;
  hybridDitheringCheckbox.checked = hybridDithering;
  perColorToleranceCheckbox.checked = perColorTolerance;
  medianFilterCheckbox.checked = medianFilter;
}

// Load image from URL
loadFromUrlBtn.addEventListener('click', () => {
  const url = imageUrlInput.value.trim();
  
  if (!url) {
    showStatus(imageStatus, 'Please enter an image URL', 'error');
    return;
  }
  
  // Validate URL
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      showStatus(imageStatus, 'Only http and https URLs are allowed', 'error');
      return;
    }
  } catch (e) {
    showStatus(imageStatus, 'Invalid URL format', 'error');
    return;
  }
  
  currentImageSource = url;
  currentImageIsUrl = true;
  analyzeAndAutoConfig(url, true);
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
  analyzeAndAutoConfig(file, false);
  checkReadyToGenerate();
});

// Paste image from clipboard
document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) {
        currentImageSource = file;
        currentImageIsUrl = false;
        showStatus(imageStatus, `Pasted image (${file.type})`, 'success');
        analyzeAndAutoConfig(file, false);
        checkReadyToGenerate();
      }
      return;
    }
  }
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
      tolerance: parseInt(toleranceInput.value),
      dithering: ditheringCheckbox.checked,
      ditheringStrength: parseInt(ditherStrengthInput.value),
      texturePenalty: parseInt(texturePenaltyInput.value),
      rasterSamples: parseInt(rasterSamplesInput.value),
      lanczosInterpolation: lanczosInterpolationCheckbox.checked,
      adaptiveSampling: adaptiveSamplingCheckbox.checked,
      adaptiveDithering: adaptiveDitheringCheckbox.checked,
      sharpeningStrength: parseInt(sharpeningStrengthInput.value),
      colorMetric: colorMetricSelect.value,
      saturationBoost: parseInt(saturationBoostInput.value),
      clahe: claheCheckbox.checked,
      spatialCoherence: spatialCoherenceCheckbox.checked,
      hybridDithering: hybridDitheringCheckbox.checked,
      perColorTolerance: perColorToleranceCheckbox.checked,
      medianFilter: medianFilterCheckbox.checked
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
  // Store the grid for visual preview
  currentGrid = result.grid;
  
  // Build reference image URL
  if (currentImageIsUrl) {
    referenceImageUrl = currentImageSource;
  } else if (currentImageSource) {
    if (referenceImageUrl && referenceImageUrl.startsWith('blob:')) {
      URL.revokeObjectURL(referenceImageUrl);
    }
    referenceImageUrl = URL.createObjectURL(currentImageSource);
  }
  
  // Show comparison controls
  const comparisonControls = document.getElementById('comparisonControls');
  comparisonControls.style.display = referenceImageUrl ? 'flex' : 'none';
  
  // Render visual preview (emoji images)
  renderVisualPreview(result.grid);
  
  // Show visual tab by default
  visualTabBtn.classList.add('active');
  textTabBtn.classList.remove('active');
  visualPreview.style.display = 'flex';
  preview.style.display = 'none';
  
  // Display text preview (truncated if too long)
  const lines = result.output.split('\n');
  const previewLines = lines.slice(0, MAX_PREVIEW_LINES);
  if (lines.length > MAX_PREVIEW_LINES) {
    previewLines.push('... (truncated in preview)');
  }
  preview.textContent = previewLines.join('\n');
  
  // Display stats
  const statsHtml = `
    <div><strong>Dimensions:</strong> ${result.stats.dimensions.width} × ${result.stats.dimensions.height}</div>
    <div><strong>Total Emojis:</strong> ${result.stats.totalEmojis.toLocaleString()}</div>
    <div><strong>Unique Emojis:</strong> ${result.stats.uniqueEmojis.toLocaleString()}</div>
    <div><strong>Character Count:</strong> ${result.stats.characterCount.toLocaleString()}</div>
    <div><strong>Emoji Diversity:</strong> ${((result.stats.uniqueEmojis / result.stats.totalEmojis) * 100).toFixed(1)}%</div>
    <div><strong>Top 5 Emojis:</strong></div>
    ${result.stats.topEmojis.map(e => `<div style="margin-left: 20px;">:${escapeHtml(e.name)}: (${e.count}×)</div>`).join('')}
  `;
  stats.innerHTML = statsHtml;
}

// Comparison mode handlers
document.getElementById('sideBySideBtn').addEventListener('click', () => {
  comparisonMode = 'side-by-side';
  document.getElementById('sideBySideBtn').classList.add('active');
  document.getElementById('overlayBtn').classList.remove('active');
  document.getElementById('overlayOpacity').style.display = 'none';
  if (currentGrid) renderVisualPreview(currentGrid);
});

document.getElementById('overlayBtn').addEventListener('click', () => {
  comparisonMode = 'overlay';
  document.getElementById('overlayBtn').classList.add('active');
  document.getElementById('sideBySideBtn').classList.remove('active');
  document.getElementById('overlayOpacity').style.display = 'inline';
  if (currentGrid) renderVisualPreview(currentGrid);
});

document.getElementById('overlayOpacity').addEventListener('input', (e) => {
  const refPane = document.getElementById('referencePane');
  if (refPane) {
    refPane.style.opacity = e.target.value / 100;
  }
});
