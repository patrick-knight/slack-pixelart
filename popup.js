// Popup script - handles UI interactions and coordinates conversion

let currentEmojis = [];
let currentResult = null;

// DOM elements
const extractEmojisBtn = document.getElementById('extractEmojis');
const emojiStatus = document.getElementById('emojiStatus');
const imageUrlInput = document.getElementById('imageUrl');
const loadFromUrlBtn = document.getElementById('loadFromUrl');
const imageFileInput = document.getElementById('imageFile');
const imageStatus = document.getElementById('imageStatus');
const widthInput = document.getElementById('width');
const heightInput = document.getElementById('height');
const charBudgetInput = document.getElementById('charBudget');
const toleranceInput = document.getElementById('tolerance');
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

let currentImageSource = null;
let currentImageIsUrl = true;

// Load saved emojis on popup open
chrome.storage.local.get(['slackEmojis'], (result) => {
  if (result.slackEmojis && result.slackEmojis.length > 0) {
    currentEmojis = result.slackEmojis;
    showStatus(emojiStatus, `${currentEmojis.length} emojis loaded from storage`, 'success');
    checkReadyToGenerate();
  }
});

// Extract emojis from current tab
extractEmojisBtn.addEventListener('click', async () => {
  extractEmojisBtn.disabled = true;
  showStatus(emojiStatus, 'Extracting emojis...', 'info');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('slack.com/customize/emoji')) {
      showStatus(emojiStatus, 'Please navigate to your Slack emoji customization page first', 'error');
      extractEmojisBtn.disabled = false;
      return;
    }
    
    chrome.tabs.sendMessage(tab.id, { action: 'extractEmojis' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus(emojiStatus, 'Error: ' + chrome.runtime.lastError.message, 'error');
        extractEmojisBtn.disabled = false;
        return;
      }
      
      if (response.success) {
        currentEmojis = response.emojis;
        showStatus(emojiStatus, `Successfully extracted ${response.count} emojis!`, 'success');
        checkReadyToGenerate();
      } else {
        showStatus(emojiStatus, 'Error: ' + response.error, 'error');
      }
      
      extractEmojisBtn.disabled = false;
    });
  } catch (error) {
    showStatus(emojiStatus, 'Error: ' + error.message, 'error');
    extractEmojisBtn.disabled = false;
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
    }, 2000);
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
  }, 2000);
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
  const previewLines = lines.slice(0, 15);
  if (lines.length > 15) {
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
