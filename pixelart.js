// Core pixel art conversion logic

class PixelArtConverter {
  // Constants
  static TRANSPARENCY_THRESHOLD = 128; // Alpha value threshold for considering pixels as opaque
  static AVG_EMOJI_LENGTH = 10; // Average length of emoji in Slack format (:emoji_name:)
  static FALLBACK_EMOJI = 'white_square'; // Emoji used for transparent/null pixels
  static MIN_DIMENSION = 5; // Minimum grid dimension
  
  // Emojis that are exempted from duplication rules (solid colors, blanks)
  static EXEMPTED_EMOJI_PATTERNS = ['space', 'blank', 'white', 'black', 'red', 'blue', 'green', 'yellow', 'square'];

  constructor(emojis, options = {}) {
    this.emojis = emojis;
    this.options = {
      width: options.width || 20,
      height: options.height || 20,
      charBudget: options.charBudget || 4000,
      tolerance: options.tolerance || 10,
      dithering: options.dithering ?? true,
      ditheringStrength: options.ditheringStrength ?? 85,
      texturePenalty: options.texturePenalty ?? 55,
      ...options
    };
    this.usedEmojis = new Map(); // Track emoji usage
    this.maxEmojiUses = Infinity;
    
    // Precompute color representations for better matching performance.
    // Mutates emoji objects in-place (safe: they are stored and reused).
    this.prepareEmojiColors();

    // Performance optimization: Build a spatial index for faster color matching
    // For large emoji sets (>1000), this dramatically improves performance
    this.colorIndex = this.buildColorIndex();
  }

  // -------- Color math (sRGB -> linear -> OKLab) --------

  srgb8ToLinear01(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  linear01ToSrgb8(v) {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  }

  rgb8ToLinear(rgb) {
    return {
      r: this.srgb8ToLinear01(rgb.r),
      g: this.srgb8ToLinear01(rgb.g),
      b: this.srgb8ToLinear01(rgb.b)
    };
  }

  linearToRgb8(lin) {
    return {
      r: this.linear01ToSrgb8(lin.r),
      g: this.linear01ToSrgb8(lin.g),
      b: this.linear01ToSrgb8(lin.b)
    };
  }

  linearToOklab(lin) {
    // Björn Ottosson's OKLab conversion from linear sRGB
    const r = lin.r;
    const g = lin.g;
    const b = lin.b;

    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return {
      L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    };
  }

  oklabDistance(lab1, lab2) {
    // Weighted OKLab distance (prioritize lightness a bit)
    const dL = (lab1.L - lab2.L) * 1.6;
    const da = lab1.a - lab2.a;
    const db = lab1.b - lab2.b;
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  clampLinear(lin) {
    return {
      r: this.clamp01(lin.r),
      g: this.clamp01(lin.g),
      b: this.clamp01(lin.b)
    };
  }

  prepareEmojiColors() {
    for (const emoji of this.emojis) {
      if (!emoji || !emoji.color) continue;
      if (!emoji._lin || !emoji._lab) {
        const lin = this.rgb8ToLinear(emoji.color);
        emoji._lin = lin;
        emoji._lab = this.linearToOklab(lin);
      }

      if (emoji.accentColor && !emoji._labAccent) {
        const linAccent = this.rgb8ToLinear(emoji.accentColor);
        emoji._labAccent = this.linearToOklab(linAccent);
      }

      if (typeof emoji.variance !== 'number') {
        emoji.variance = 999;
      }
    }
  }

  // Build a color index for faster lookup with large emoji sets
  buildColorIndex() {
    if (this.emojis.length < 1000) {
      return null; // Not worth the overhead for small sets
    }
    
    // Bucket emojis by quantized color (reduce color space to 32×32×32)
    const bucketSize = 8; // 256/8 = 32 buckets per channel
    const index = new Map();

    const pushToBucket = (emoji, rgb) => {
      if (!emoji || !rgb) return;
      const bucketR = Math.floor(rgb.r / bucketSize);
      const bucketG = Math.floor(rgb.g / bucketSize);
      const bucketB = Math.floor(rgb.b / bucketSize);
      const key = `${bucketR},${bucketG},${bucketB}`;

      if (!index.has(key)) {
        index.set(key, []);
      }

      const arr = index.get(key);
      // Avoid duplicates when mean and accent land in same bucket
      if (arr.length === 0 || arr[arr.length - 1] !== emoji) {
        arr.push(emoji);
      }
    };

    for (const emoji of this.emojis) {
      if (!emoji || !emoji.color) continue;
      pushToBucket(emoji, emoji.color);
      if (emoji.accentColor) {
        pushToBucket(emoji, emoji.accentColor);
      }
    }
    
    return { colorIndex: index, bucketSize };
  }

  // Get candidate emojis from nearby color buckets
  getCandidateEmojis(targetColor) {
    if (!this.colorIndex) {
      return this.emojis; // Return all emojis for small sets
    }
    
    const { colorIndex, bucketSize } = this.colorIndex;
    const bucketR = Math.floor(targetColor.r / bucketSize);
    const bucketG = Math.floor(targetColor.g / bucketSize);
    const bucketB = Math.floor(targetColor.b / bucketSize);
    
    const candidates = [];

    const collect = (radius) => {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dg = -radius; dg <= radius; dg++) {
          for (let db = -radius; db <= radius; db++) {
            const key = `${bucketR + dr},${bucketG + dg},${bucketB + db}`;
            if (colorIndex.has(key)) {
              candidates.push(...colorIndex.get(key));
            }
          }
        }
      }
    };

    // Start with current + adjacent buckets (27 buckets)
    collect(1);

    // If candidate set is too small, widen the net (helps OKLab matching)
    if (candidates.length < 200) {
      collect(2);
    }

    return candidates.length > 0 ? candidates : this.emojis;
  }

  // Calculate color difference using weighted Euclidean distance
  // Human eyes are more sensitive to green, then red, then blue
  colorDistance(color1, color2) {
    // Backward-compatible wrapper: accepts {r,g,b} 0..255
    const lab1 = this.linearToOklab(this.rgb8ToLinear(color1));
    const lab2 = this.linearToOklab(this.rgb8ToLinear(color2));
    return this.oklabDistance(lab1, lab2);
  }

  // Check if an emoji is exempted from duplication rules
  isExemptedEmoji(emojiName) {
    const lowerName = emojiName.toLowerCase();
    return PixelArtConverter.EXEMPTED_EMOJI_PATTERNS.some(pattern => lowerName.includes(pattern));
  }

  // Find the best matching emoji for a given color (Python-style algorithm)
  findBestEmoji(targetColor) {
    // Use spatial index to reduce search space for large emoji sets
    const candidates = this.getCandidateEmojis(targetColor);
    const targetLab = this.linearToOklab(this.rgb8ToLinear(targetColor));

    // If target isn't near-white, let accentColor influence matches more.
    // This helps a lot for outlined/transparent emojis whose mean tends to white.
    const fromWhite = (255 - targetColor.r) + (255 - targetColor.g) + (255 - targetColor.b);
    const accentBias = fromWhite > 90 ? 0.85 : 1.05;

    let best = null;
    let bestDist = Infinity;
    let bestAllowed = null;
    let bestAllowedDist = Infinity;

    for (const emoji of candidates) {
      if (!emoji || !emoji.color) continue;
      const emojiLab = emoji._lab || this.linearToOklab(this.rgb8ToLinear(emoji.color));
      let dist = this.oklabDistance(targetLab, emojiLab);

      if (emoji._labAccent) {
        const distAccent = this.oklabDistance(targetLab, emoji._labAccent);
        dist = Math.min(dist, distAccent * accentBias);
      }

      // If we couldn't read the emoji pixels during extraction (CORS/taint), its color is a fallback.
      // Penalize these so they don't pollute matching.
      if (emoji.colorError) {
        dist += 0.35;
      }

      // Penalize busy/outlined emojis when user wants more photo-like output.
      // variance ~= 0 for solid blocks; higher for detailed icons.
      const textureWeight = Math.max(0, Math.min(1, (this.options.texturePenalty ?? 0) / 100));
      if (textureWeight > 0 && typeof emoji.variance === 'number') {
        const v = Math.max(0, Math.min(255, emoji.variance)) / 255;
        dist += v * (0.28 * textureWeight);
      }

      if (dist < bestDist) {
        bestDist = dist;
        best = emoji;
      }

      if (this.options.tolerance >= 100) {
        continue;
      }

      const isExempted = this.isExemptedEmoji(emoji.name);
      const usageCount = this.usedEmojis.get(emoji.name) || 0;
      const allowed = isExempted || usageCount < this.maxEmojiUses;

      if (allowed && dist < bestAllowedDist) {
        bestAllowedDist = dist;
        bestAllowed = emoji;
      }
    }

    const chosen = this.options.tolerance >= 100 ? best : (bestAllowed || best);
    if (chosen) {
      const count = this.usedEmojis.get(chosen.name) || 0;
      this.usedEmojis.set(chosen.name, count + 1);
    }
    return chosen;
  }

  // Find best emoji for a linear color with dithering (target in linear 0..1)
  findBestEmojiFromLinear(targetLinear) {
    const targetRgb = this.linearToRgb8(targetLinear);
    return this.findBestEmoji(targetRgb);
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

  // High-quality image resizing using multi-step downscaling
  // Similar to PIL's LANCZOS - reduces artifacts and aliasing
  resizeImageHighQuality(img, targetWidth, targetHeight) {
    // For significant downscaling, use multi-step approach
    // This mimics LANCZOS-style quality by progressively halving
    let currentWidth = img.width;
    let currentHeight = img.height;
    
    // Create source canvas with original image
    let sourceCanvas = document.createElement('canvas');
    let sourceCtx = sourceCanvas.getContext('2d');
    sourceCanvas.width = currentWidth;
    sourceCanvas.height = currentHeight;
    
    // Fill with white background first (handles transparency like Python)
    sourceCtx.fillStyle = '#FFFFFF';
    sourceCtx.fillRect(0, 0, currentWidth, currentHeight);
    sourceCtx.drawImage(img, 0, 0);
    
    // Progressive downscaling - halve dimensions until close to target
    while (currentWidth / 2 > targetWidth && currentHeight / 2 > targetHeight) {
      const newWidth = Math.floor(currentWidth / 2);
      const newHeight = Math.floor(currentHeight / 2);
      
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      tempCanvas.width = newWidth;
      tempCanvas.height = newHeight;
      
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = 'high';
      tempCtx.drawImage(sourceCanvas, 0, 0, newWidth, newHeight);
      
      sourceCanvas = tempCanvas;
      sourceCtx = tempCtx;
      currentWidth = newWidth;
      currentHeight = newHeight;
    }
    
    // Final resize to exact target dimensions
    const finalCanvas = document.createElement('canvas');
    const finalCtx = finalCanvas.getContext('2d');
    finalCanvas.width = targetWidth;
    finalCanvas.height = targetHeight;
    
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = 'high';
    finalCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
    
    return finalCanvas;
  }

  // Extract pixel colors from an image with high-quality resampling
  extractPixelColors(img, width, height) {
    // Use high-quality resizing
    const canvas = this.resizeImageHighQuality(img, width, height);
    const ctx = canvas.getContext('2d');
    
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = [];
    
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];
        const a = imageData.data[i + 3];
        
        // Blend with white background for semi-transparent pixels
        // This matches Python's transparency handling
        if (a < 255) {
          const alpha = a / 255;
          row.push({
            r: Math.round(r * alpha + 255 * (1 - alpha)),
            g: Math.round(g * alpha + 255 * (1 - alpha)),
            b: Math.round(b * alpha + 255 * (1 - alpha)),
            a: 255 // Treat as fully opaque after blending
          });
        } else {
          row.push({ r, g, b, a });
        }
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
    
    // Extract pixel colors with high-quality resampling
    if (onProgress) onProgress(30, 'Processing image...');
    const pixels = this.extractPixelColors(img, dimensions.width, dimensions.height);
    
    // Reset usage tracking
    this.usedEmojis.clear();
    
    // Build the pixel art grid
    if (onProgress) onProgress(40, 'Matching emojis...');
    const grid = [];
    const totalPixels = dimensions.width * dimensions.height;
    let processedPixels = 0;

    // Set per-emoji usage cap based on tolerance.
    // tolerance 0 => effectively unique (max 1 use)
    // tolerance 100 => unlimited
    this.maxEmojiUses = this.options.tolerance >= 100
      ? Infinity
      : Math.max(1, Math.floor(totalPixels * (this.options.tolerance / 100)));

    // Optional Floyd–Steinberg dithering in linear space to improve perceived quality.
    const useDithering = Boolean(this.options.dithering);
    const ditherStrength = Math.max(0, Math.min(1, (this.options.ditheringStrength ?? 85) / 100));
    const w = dimensions.width;
    const h = dimensions.height;
    const error = useDithering
      ? Array.from({ length: h }, () => Array.from({ length: w }, () => ({ r: 0, g: 0, b: 0 })))
      : null;
    
    for (let y = 0; y < h; y++) {
      const row = [];
      const serpentine = useDithering && (y % 2 === 1);
      const xStart = serpentine ? (w - 1) : 0;
      const xEnd = serpentine ? -1 : w;
      const xStep = serpentine ? -1 : 1;

      for (let x = xStart; x !== xEnd; x += xStep) {
        const pixel = pixels[y][x];

        let emoji;
        if (useDithering) {
          // Work in linear RGB for proper error diffusion.
          const baseLin = this.rgb8ToLinear(pixel);
          const e = error[y][x];
          const targetLin = this.clampLinear({
            r: baseLin.r + e.r,
            g: baseLin.g + e.g,
            b: baseLin.b + e.b
          });

          emoji = this.findBestEmojiFromLinear(targetLin);

          const chosenLin = emoji?._lin || (emoji?.color ? this.rgb8ToLinear(emoji.color) : null);
          if (emoji && chosenLin) {
            const err = {
              r: (targetLin.r - chosenLin.r) * ditherStrength,
              g: (targetLin.g - chosenLin.g) * ditherStrength,
              b: (targetLin.b - chosenLin.b) * ditherStrength
            };

            // Diffuse error to neighbors (Floyd–Steinberg)
            const right = serpentine ? -1 : 1;
            const left = serpentine ? 1 : -1;

            // Right
            if (x + right >= 0 && x + right < w) {
              error[y][x + right].r += err.r * (7 / 16);
              error[y][x + right].g += err.g * (7 / 16);
              error[y][x + right].b += err.b * (7 / 16);
            }
            // Bottom-left
            if (y + 1 < h && x + left >= 0 && x + left < w) {
              error[y + 1][x + left].r += err.r * (3 / 16);
              error[y + 1][x + left].g += err.g * (3 / 16);
              error[y + 1][x + left].b += err.b * (3 / 16);
            }
            // Bottom
            if (y + 1 < h) {
              error[y + 1][x].r += err.r * (5 / 16);
              error[y + 1][x].g += err.g * (5 / 16);
              error[y + 1][x].b += err.b * (5 / 16);
            }
            // Bottom-right
            if (y + 1 < h && x + right >= 0 && x + right < w) {
              error[y + 1][x + right].r += err.r * (1 / 16);
              error[y + 1][x + right].g += err.g * (1 / 16);
              error[y + 1][x + right].b += err.b * (1 / 16);
            }
          }
        } else {
          emoji = this.findBestEmoji(pixel);
        }

        // Maintain correct left-to-right order in the grid even in serpentine mode
        if (serpentine) {
          row.unshift(emoji);
        } else {
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
