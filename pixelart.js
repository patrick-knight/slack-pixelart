// Core pixel art conversion logic

class PixelArtConverter {
  // Constants
  static TRANSPARENCY_THRESHOLD = 128; // Alpha value threshold for considering pixels as opaque
  static AVG_EMOJI_LENGTH = 10; // Average length of emoji in Slack format (:emoji_name:)
  static FALLBACK_EMOJI = 'white_square'; // Emoji used for transparent/null pixels
  static MIN_DIMENSION = 5; // Minimum grid dimension

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
    
    // Performance optimization: Build a spatial index for faster color matching
    // For large emoji sets (>1000), this dramatically improves performance
    this.colorIndex = this.buildColorIndex();
  }

  // Build a color index for faster lookup with large emoji sets
  buildColorIndex() {
    if (this.emojis.length < 1000) {
      return null; // Not worth the overhead for small sets
    }
    
    // Bucket emojis by quantized color (reduce color space to 32×32×32)
    const bucketSize = 8; // 256/8 = 32 buckets per channel
    const index = new Map();
    
    for (const emoji of this.emojis) {
      const bucketR = Math.floor(emoji.color.r / bucketSize);
      const bucketG = Math.floor(emoji.color.g / bucketSize);
      const bucketB = Math.floor(emoji.color.b / bucketSize);
      const key = `${bucketR},${bucketG},${bucketB}`;
      
      if (!index.has(key)) {
        index.set(key, []);
      }
      index.get(key).push(emoji);
    }
    
    return { index, bucketSize };
  }

  // Get candidate emojis from nearby color buckets
  getCandidateEmojis(targetColor) {
    if (!this.colorIndex) {
      return this.emojis; // Return all emojis for small sets
    }
    
    const { index, bucketSize } = this.colorIndex;
    const bucketR = Math.floor(targetColor.r / bucketSize);
    const bucketG = Math.floor(targetColor.g / bucketSize);
    const bucketB = Math.floor(targetColor.b / bucketSize);
    
    const candidates = [];
    
    // Search in current bucket and adjacent buckets (27 buckets total)
    for (let dr = -1; dr <= 1; dr++) {
      for (let dg = -1; dg <= 1; dg++) {
        for (let db = -1; db <= 1; db++) {
          const key = `${bucketR + dr},${bucketG + dg},${bucketB + db}`;
          if (index.has(key)) {
            candidates.push(...index.get(key));
          }
        }
      }
    }
    
    // If no candidates found, fall back to all emojis
    return candidates.length > 0 ? candidates : this.emojis;
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

    // Use spatial index to reduce search space for large emoji sets
    const candidates = this.getCandidateEmojis(targetColor);

    for (const emoji of candidates) {
      const distance = this.colorDistance(targetColor, emoji.color);
      
      if (distance < bestDistance) {
        // Check if we can use this emoji based on tolerance
        const usageCount = this.usedEmojis.get(emoji.name) || 0;
        const maxUsage = Math.max(1, Math.floor((100 - this.options.tolerance) / 10));
        
        if (usageCount < maxUsage || this.options.tolerance >= 50) {
          bestDistance = distance;
          bestEmoji = emoji;
          
          // Early exit optimization: if we found a very close match, stop searching
          if (distance < 5) { // RGB distance < 5 is essentially identical
            break;
          }
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

    const maxPixels = Math.floor(this.options.charBudget / PixelArtConverter.AVG_EMOJI_LENGTH);
    const currentPixels = width * height;

    if (currentPixels <= maxPixels) {
      return { width, height };
    }

    // Scale down proportionally
    const scale = Math.sqrt(maxPixels / currentPixels);
    return {
      width: Math.max(PixelArtConverter.MIN_DIMENSION, Math.floor(width * scale)),
      height: Math.max(PixelArtConverter.MIN_DIMENSION, Math.floor(height * scale))
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
        if (pixel.a < PixelArtConverter.TRANSPARENCY_THRESHOLD) {
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
        .map(emoji => emoji ? `:${emoji.name}:` : `:${PixelArtConverter.FALLBACK_EMOJI}:`)
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
    const fallbackLength = `:${PixelArtConverter.FALLBACK_EMOJI}:`.length;
    
    for (const row of grid) {
      for (const emoji of row) {
        if (emoji) {
          count += emoji.name.length + 2; // +2 for the colons
        } else {
          count += fallbackLength;
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
