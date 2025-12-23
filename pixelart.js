// Core pixel art conversion logic

class PixelArtConverter {
  constructor(emojis, options = {}) {
    this.emojis = emojis;
    this.options = {
      width: options.width || 20,
      height: options.height || 20,
      charBudget: options.charBudget || 4000,
      tolerance: options.tolerance || 10,
      ...options
    };
    this.usedEmojis = new Map(); // Track emoji usage
  }

  // Calculate color difference using Euclidean distance
  colorDistance(color1, color2) {
    const rDiff = color1.r - color2.r;
    const gDiff = color1.g - color2.g;
    const bDiff = color1.b - color2.b;
    return Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
  }

  // Find the best matching emoji for a given color
  findBestEmoji(targetColor) {
    let bestEmoji = null;
    let bestDistance = Infinity;

    for (const emoji of this.emojis) {
      const distance = this.colorDistance(targetColor, emoji.color);
      
      if (distance < bestDistance) {
        // Check if we can use this emoji based on tolerance
        const usageCount = this.usedEmojis.get(emoji.name) || 0;
        const maxUsage = Math.max(1, Math.floor((100 - this.options.tolerance) / 10));
        
        if (usageCount < maxUsage || this.options.tolerance >= 50) {
          bestDistance = distance;
          bestEmoji = emoji;
        }
      }
    }

    if (bestEmoji) {
      const currentCount = this.usedEmojis.get(bestEmoji.name) || 0;
      this.usedEmojis.set(bestEmoji.name, currentCount + 1);
    }

    return bestEmoji;
  }

  // Load and process an image
  async loadImage(source, isUrl = true) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      
      if (isUrl) {
        img.crossOrigin = 'Anonymous';
        img.src = source;
      } else {
        // source is a File object
        const reader = new FileReader();
        reader.onload = (e) => {
          img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(source);
      }
    });
  }

  // Extract pixel colors from an image
  extractPixelColors(img, width, height) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = width;
    canvas.height = height;
    
    // Draw the image scaled to the target dimensions
    ctx.drawImage(img, 0, 0, width, height);
    
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = [];
    
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        row.push({
          r: imageData.data[i],
          g: imageData.data[i + 1],
          b: imageData.data[i + 2],
          a: imageData.data[i + 3]
        });
      }
      pixels.push(row);
    }
    
    return pixels;
  }

  // Adjust dimensions to fit within character budget
  adjustDimensionsForBudget(width, height) {
    if (this.options.charBudget === 0) {
      return { width, height };
    }

    // Average emoji name length in Slack format (:emoji:) is about 10 characters
    const avgEmojiLength = 10;
    const maxPixels = Math.floor(this.options.charBudget / avgEmojiLength);
    const currentPixels = width * height;

    if (currentPixels <= maxPixels) {
      return { width, height };
    }

    // Scale down proportionally
    const scale = Math.sqrt(maxPixels / currentPixels);
    return {
      width: Math.max(5, Math.floor(width * scale)),
      height: Math.max(5, Math.floor(height * scale))
    };
  }

  // Convert image to pixel art
  async convert(imageSource, isUrl = true, onProgress = null) {
    if (!this.emojis || this.emojis.length === 0) {
      throw new Error('No emojis available. Please extract emojis from Slack first.');
    }

    // Load the image
    if (onProgress) onProgress(10, 'Loading image...');
    const img = await this.loadImage(imageSource, isUrl);
    
    // Adjust dimensions for character budget
    if (onProgress) onProgress(20, 'Calculating dimensions...');
    const dimensions = this.adjustDimensionsForBudget(
      this.options.width,
      this.options.height
    );
    
    // Extract pixel colors
    if (onProgress) onProgress(30, 'Extracting colors...');
    const pixels = this.extractPixelColors(img, dimensions.width, dimensions.height);
    
    // Reset usage tracking
    this.usedEmojis.clear();
    
    // Build the pixel art grid
    if (onProgress) onProgress(40, 'Matching emojis...');
    const grid = [];
    const totalPixels = dimensions.width * dimensions.height;
    let processedPixels = 0;
    
    for (let y = 0; y < dimensions.height; y++) {
      const row = [];
      for (let x = 0; x < dimensions.width; x++) {
        const pixel = pixels[y][x];
        
        // Skip fully transparent pixels
        if (pixel.a < 128) {
          row.push(null);
        } else {
          const emoji = this.findBestEmoji(pixel);
          row.push(emoji);
        }
        
        processedPixels++;
        if (onProgress && processedPixels % 10 === 0) {
          const progress = 40 + Math.floor((processedPixels / totalPixels) * 50);
          onProgress(progress, `Matching emojis... ${processedPixels}/${totalPixels}`);
        }
      }
      grid.push(row);
    }
    
    // Generate text output
    if (onProgress) onProgress(90, 'Generating output...');
    const output = this.generateTextOutput(grid);
    
    if (onProgress) onProgress(100, 'Complete!');
    
    return {
      grid,
      output,
      dimensions,
      stats: this.generateStats(grid)
    };
  }

  // Generate text output for Slack
  generateTextOutput(grid) {
    const lines = [];
    
    for (const row of grid) {
      const line = row
        .map(emoji => emoji ? `:${emoji.name}:` : ':white_square:')
        .join('');
      lines.push(line);
    }
    
    return lines.join('\n');
  }

  // Generate statistics about the conversion
  generateStats(grid) {
    const emojiCount = new Map();
    let totalEmojis = 0;
    let nullCount = 0;
    
    for (const row of grid) {
      for (const emoji of row) {
        if (emoji) {
          totalEmojis++;
          const count = emojiCount.get(emoji.name) || 0;
          emojiCount.set(emoji.name, count + 1);
        } else {
          nullCount++;
        }
      }
    }
    
    return {
      totalEmojis,
      uniqueEmojis: emojiCount.size,
      nullPixels: nullCount,
      dimensions: {
        width: grid[0]?.length || 0,
        height: grid.length
      },
      characterCount: this.calculateCharacterCount(grid),
      topEmojis: Array.from(emojiCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }))
    };
  }

  // Calculate total character count
  calculateCharacterCount(grid) {
    let count = 0;
    for (const row of grid) {
      for (const emoji of row) {
        if (emoji) {
          count += emoji.name.length + 2; // +2 for the colons
        } else {
          count += 14; // :white_square: length
        }
      }
    }
    return count;
  }
}

// Export for use in popup
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PixelArtConverter;
}
