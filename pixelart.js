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
      // Rasterization quality controls how we sample the *source* image into the target grid.
      // Higher values = better color fidelity (and better matching), at modest CPU cost.
      rasterSamples: options.rasterSamples ?? 3,
      rasterMaxSourceSide: options.rasterMaxSourceSide ?? 2048,
      colorMetric: options.colorMetric || 'oklab',
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

  oklabDistance(lab1, lab2, emphasizeLightness = false) {
    // Weighted OKLab distance with improved perceptual weighting
    // Lightness is more important in low-saturation regions
    const chromaL1 = Math.sqrt(lab1.a * lab1.a + lab1.b * lab1.b);
    const chromaL2 = Math.sqrt(lab2.a * lab2.a + lab2.b * lab2.b);
    const avgChroma = (chromaL1 + chromaL2) / 2;

    // Increase lightness weight for desaturated colors, decrease for saturated
    // This improves matching for grays while preserving color accuracy
    const lightnessWeight = emphasizeLightness ? 2.0 : (1.6 + (0.4 * Math.exp(-avgChroma * 3)));

    const dL = (lab1.L - lab2.L) * lightnessWeight;
    const da = lab1.a - lab2.a;
    const db = lab1.b - lab2.b;

    // Enhanced chroma and hue difference weighting
    const dC = chromaL1 - chromaL2;
    const dH2 = da * da + db * db - dC * dC; // Hue difference squared

    return Math.sqrt(dL * dL + da * da + db * db + Math.max(0, dH2) * 0.25);
  }

  oklabDistanceCalibrated(lab1, lab2) {
    // Calibrated OKLab delta with LCh decomposition and Helmholtz-Kohlrausch compensation
    const C1 = Math.sqrt(lab1.a * lab1.a + lab1.b * lab1.b);
    const C2 = Math.sqrt(lab2.a * lab2.a + lab2.b * lab2.b);

    // HK lightness adjustment for high-chroma colors
    let L1 = lab1.L, L2 = lab2.L;
    if (C1 > 0.1) {
      const hue1 = Math.atan2(lab1.b, lab1.a);
      const hkFactor1 = 0.12 + 0.06 * Math.cos(hue1 + 0.8);
      L1 = lab1.L + 0.015 * C1 * hkFactor1;
    }
    if (C2 > 0.1) {
      const hue2 = Math.atan2(lab2.b, lab2.a);
      const hkFactor2 = 0.12 + 0.06 * Math.cos(hue2 + 0.8);
      L2 = lab2.L + 0.015 * C2 * hkFactor2;
    }

    const dL = L1 - L2;
    const dC = C1 - C2;
    const da = lab1.a - lab2.a;
    const db = lab1.b - lab2.b;
    const dH2 = Math.max(0, da * da + db * db - dC * dC);

    const wL = 1.0, wC = 1.0, wH = 0.5;
    return Math.sqrt(wL * dL * dL + wC * dC * dC + wH * dH2);
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

      // Precompute OKLab for multi-region color profile
      // Supports both full format (colorProfile: [{rgb, weight}]) and compact (cp: [[r,g,b,w%]])
      const profile = emoji.colorProfile || emoji.cp;
      if (Array.isArray(profile) && profile.length > 0 && !emoji._labProfile) {
        emoji._labProfile = profile.map(entry => {
          if (Array.isArray(entry)) {
            // Compact format: [r, g, b, weight_percent]
            return {
              lab: this.linearToOklab(this.rgb8ToLinear({ r: entry[0], g: entry[1], b: entry[2] })),
              weight: (entry[3] || 50) / 100
            };
          }
          return {
            lab: this.linearToOklab(this.rgb8ToLinear(entry.rgb)),
            weight: entry.weight
          };
        });
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
    
    // Bucket emojis by quantized OKLab coordinates
    const binL = 0.05;  // L range ~0–1, ~20 bins
    const binA = 0.04;  // a range ~-0.4–0.4, ~20 bins
    const binB = 0.04;  // b range ~-0.4–0.4, ~20 bins
    const index = new Map();

    const pushToBucket = (emoji, rgb) => {
      if (!emoji || !rgb) return;
      const lab = this.linearToOklab(this.rgb8ToLinear(rgb));
      const kL = Math.floor(lab.L / binL);
      const kA = Math.floor(lab.a / binA);
      const kB = Math.floor(lab.b / binB);
      const key = `${kL},${kA},${kB}`;

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
      const profile = emoji.colorProfile || emoji.cp;
      if (Array.isArray(profile)) {
        for (const entry of profile) {
          const rgb = Array.isArray(entry) ? { r: entry[0], g: entry[1], b: entry[2] } : entry.rgb;
          pushToBucket(emoji, rgb);
        }
      }
    }
    
    return { colorIndex: index, binL, binA, binB };
  }

  // Get candidate emojis from nearby color buckets
  getCandidateEmojis(targetColor) {
    if (!this.colorIndex) {
      return this.emojis; // Return all emojis for small sets
    }
    
    const { colorIndex, binL, binA, binB } = this.colorIndex;
    const lab = this.linearToOklab(this.rgb8ToLinear(targetColor));
    const kL = Math.floor(lab.L / binL);
    const kA = Math.floor(lab.a / binA);
    const kB = Math.floor(lab.b / binB);
    
    const candidates = [];

    const collect = (radius) => {
      for (let dL = -radius; dL <= radius; dL++) {
        for (let da = -radius; da <= radius; da++) {
          for (let db = -radius; db <= radius; db++) {
            const key = `${kL + dL},${kA + da},${kB + db}`;
            if (colorIndex.has(key)) {
              candidates.push(...colorIndex.get(key));
            }
          }
        }
      }
    };

    // Start with current + adjacent buckets (27 buckets)
    collect(1);

    // If candidate set is too small, widen the net
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

    const useHK = this.options.colorMetric === 'oklab-hk';
    const distFn = useHK
      ? (a, b) => this.oklabDistanceCalibrated(a, b)
      : (a, b) => this.oklabDistance(a, b);

    for (const emoji of candidates) {
      if (!emoji || !emoji.color) continue;

      let dist;
      if (emoji._labProfile) {
        // Multi-region profile: pick the cluster closest to target color
        // Weight bias: slightly favor matching the dominant cluster
        dist = Infinity;
        for (const entry of emoji._labProfile) {
          const d = distFn(targetLab, entry.lab) / (0.5 + entry.weight);
          if (d < dist) dist = d;
        }
      } else {
        // Fallback: single mean + optional accent
        const emojiLab = emoji._lab || this.linearToOklab(this.rgb8ToLinear(emoji.color));
        dist = distFn(targetLab, emojiLab);

        if (emoji._labAccent) {
          const distAccent = distFn(targetLab, emoji._labAccent);
          dist = Math.min(dist, distAccent * accentBias);
        }
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
        const parsedUrl = new URL(source);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          reject(new Error('Only http and https URLs are allowed'));
          return;
        }
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

  // Create an ImageData snapshot of the source image for sampling.
  // Optionally downscales very large images first to keep memory/CPU bounded.
  getSourceImageData(img) {
    const maxSide = Math.max(1, this.options.rasterMaxSourceSide ?? 2048);
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const sw = Math.max(1, Math.floor(img.width * scale));
    const sh = Math.max(1, Math.floor(img.height * scale));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = sw;
    canvas.height = sh;

    // Draw without pre-filling; we handle alpha compositing ourselves in linear space.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, sw, sh);

    return { imageData: ctx.getImageData(0, 0, sw, sh), sw, sh };
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Lanczos3 kernel function for high-quality resampling
  lanczos3(x) {
    if (x === 0) return 1;
    if (x < -3 || x > 3) return 0;
    const pi = Math.PI;
    const px = pi * x;
    return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
  }

  // Sample using Lanczos3 interpolation for superior quality
  sampleSourceLanczos(imageData, sw, sh, x, y) {
    const data = imageData.data;
    const xClamped = Math.max(0, Math.min(sw - 1, x));
    const yClamped = Math.max(0, Math.min(sh - 1, y));
    const x0 = Math.floor(xClamped);
    const y0 = Math.floor(yClamped);

    let sumR = 0, sumG = 0, sumB = 0, sumWeight = 0;

    // Sample a 6x6 neighborhood (Lanczos3 kernel size)
    for (let dy = -2; dy <= 3; dy++) {
      const py = Math.max(0, Math.min(sh - 1, y0 + dy));
      const wy = this.lanczos3(yClamped - py);

      for (let dx = -2; dx <= 3; dx++) {
        const px = Math.max(0, Math.min(sw - 1, x0 + dx));
        const wx = this.lanczos3(xClamped - px);
        const weight = wx * wy;

        const i = (py * sw + px) * 4;
        const r8 = data[i];
        const g8 = data[i + 1];
        const b8 = data[i + 2];
        const a = data[i + 3] / 255;

        // Convert sRGB -> linear then composite on white in linear space
        const r = a * this.srgb8ToLinear01(r8) + (1 - a) * 1.0;
        const g = a * this.srgb8ToLinear01(g8) + (1 - a) * 1.0;
        const b = a * this.srgb8ToLinear01(b8) + (1 - a) * 1.0;

        sumR += r * weight;
        sumG += g * weight;
        sumB += b * weight;
        sumWeight += weight;
      }
    }

    const inv = sumWeight > 0 ? 1 / sumWeight : 1;
    return {
      r: sumR * inv,
      g: sumG * inv,
      b: sumB * inv
    };
  }

  // Sample the source image at (x, y) in source pixel coordinates using bilinear filtering.
  // Returns linear RGB already composited over white in linear space.
  sampleSourceLinear(imageData, sw, sh, x, y) {
    const data = imageData.data;
    const xClamped = Math.max(0, Math.min(sw - 1, x));
    const yClamped = Math.max(0, Math.min(sh - 1, y));
    const x0 = Math.floor(xClamped);
    const y0 = Math.floor(yClamped);
    const x1 = Math.min(sw - 1, x0 + 1);
    const y1 = Math.min(sh - 1, y0 + 1);
    const tx = xClamped - x0;
    const ty = yClamped - y0;

    const readLin = (px, py) => {
      const i = (py * sw + px) * 4;
      const r8 = data[i];
      const g8 = data[i + 1];
      const b8 = data[i + 2];
      const a = data[i + 3] / 255;

      // Convert sRGB -> linear then composite on white in linear space.
      const r = a * this.srgb8ToLinear01(r8) + (1 - a) * 1.0;
      const g = a * this.srgb8ToLinear01(g8) + (1 - a) * 1.0;
      const b = a * this.srgb8ToLinear01(b8) + (1 - a) * 1.0;
      return { r, g, b };
    };

    const c00 = readLin(x0, y0);
    const c10 = readLin(x1, y0);
    const c01 = readLin(x0, y1);
    const c11 = readLin(x1, y1);

    const rx0 = this.lerp(c00.r, c10.r, tx);
    const gx0 = this.lerp(c00.g, c10.g, tx);
    const bx0 = this.lerp(c00.b, c10.b, tx);
    const rx1 = this.lerp(c01.r, c11.r, tx);
    const gx1 = this.lerp(c01.g, c11.g, tx);
    const bx1 = this.lerp(c01.b, c11.b, tx);

    return {
      r: this.lerp(rx0, rx1, ty),
      g: this.lerp(gx0, gx1, ty),
      b: this.lerp(bx0, bx1, ty)
    };
  }

  // Detect edge strength in a region for adaptive sampling
  detectEdge(imageData, sw, sh, x0, x1, y0, y1) {
    // Sample center and corners to estimate variance
    const centerX = (x0 + x1) / 2;
    const centerY = (y0 + y1) / 2;

    const samples = [
      this.sampleSourceLanczos(imageData, sw, sh, x0, y0),
      this.sampleSourceLanczos(imageData, sw, sh, x1, y0),
      this.sampleSourceLanczos(imageData, sw, sh, x0, y1),
      this.sampleSourceLanczos(imageData, sw, sh, x1, y1),
      this.sampleSourceLanczos(imageData, sw, sh, centerX, centerY)
    ];

    // Calculate color variance (higher = more edge detail)
    let varR = 0, varG = 0, varB = 0;
    const avgR = samples.reduce((s, c) => s + c.r, 0) / 5;
    const avgG = samples.reduce((s, c) => s + c.g, 0) / 5;
    const avgB = samples.reduce((s, c) => s + c.b, 0) / 5;

    for (const s of samples) {
      varR += (s.r - avgR) ** 2;
      varG += (s.g - avgG) ** 2;
      varB += (s.b - avgB) ** 2;
    }

    return Math.sqrt((varR + varG + varB) / 15);
  }

  // Rasterize the source image into a target grid with gamma-correct sampling.
  // This generally matches the emoji palette better than relying solely on canvas downscaling.
  rasterizeImage(img, targetWidth, targetHeight) {
    const { imageData, sw, sh } = this.getSourceImageData(img);
    const baseSamples = Math.max(1, Math.min(8, parseInt(this.options.rasterSamples ?? 3, 10) || 3));
    const useAdaptive = this.options.adaptiveSampling ?? true;
    const useLanczos = this.options.lanczosInterpolation ?? true;

    const pixels = [];
    for (let y = 0; y < targetHeight; y++) {
      const row = [];
      for (let x = 0; x < targetWidth; x++) {
        // Sample within the corresponding source region for this cell.
        const x0 = (x * sw) / targetWidth;
        const x1 = ((x + 1) * sw) / targetWidth;
        const y0 = (y * sh) / targetHeight;
        const y1 = ((y + 1) * sh) / targetHeight;

        // Adaptive sampling: use more samples in high-detail regions
        let samples = baseSamples;
        if (useAdaptive) {
          const edgeStrength = this.detectEdge(imageData, sw, sh, x0, x1, y0, y1);
          // Scale samples from baseSamples to baseSamples*2 based on edge strength
          samples = Math.min(8, Math.max(baseSamples, Math.ceil(baseSamples * (1 + edgeStrength * 2))));
        }

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;

        const sampleFunc = useLanczos ? this.sampleSourceLanczos : this.sampleSourceLinear;

        for (let sy = 0; sy < samples; sy++) {
          const fy = (sy + 0.5) / samples;
          const srcY = this.lerp(y0, y1, fy);
          for (let sx = 0; sx < samples; sx++) {
            const fx = (sx + 0.5) / samples;
            const srcX = this.lerp(x0, x1, fx);
            const c = sampleFunc.call(this, imageData, sw, sh, srcX, srcY);
            sumR += c.r;
            sumG += c.g;
            sumB += c.b;
          }
        }

        const inv = 1 / (samples * samples);
        const avgLin = {
          r: sumR * inv,
          g: sumG * inv,
          b: sumB * inv
        };

        row.push({
          r: this.linear01ToSrgb8(this.clamp01(avgLin.r)),
          g: this.linear01ToSrgb8(this.clamp01(avgLin.g)),
          b: this.linear01ToSrgb8(this.clamp01(avgLin.b)),
          a: 255
        });
      }
      pixels.push(row);
    }
    return pixels;
  }

  // Apply unsharp mask for detail enhancement
  applySharpeningFilter(pixels, width, height, strength = 0.5) {
    if (strength <= 0) return pixels;

    // Convert sRGB 0-255 to linear 0-1 for gamma-correct filtering
    const linear = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const p = pixels[y][x];
        row.push({
          r: this.srgb8ToLinear01(p.r),
          g: this.srgb8ToLinear01(p.g),
          b: this.srgb8ToLinear01(p.b),
          a: p.a
        });
      }
      linear.push(row);
    }

    const sharpened = [];
    const radius = 1;

    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const center = linear[y][x];

        // Calculate Gaussian blur (approximate with simple average) in linear space
        let blurR = 0, blurG = 0, blurB = 0;
        let count = 0;

        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const ny = Math.max(0, Math.min(height - 1, y + dy));
            const nx = Math.max(0, Math.min(width - 1, x + dx));
            const p = linear[ny][nx];
            blurR += p.r;
            blurG += p.g;
            blurB += p.b;
            count++;
          }
        }

        blurR /= count;
        blurG /= count;
        blurB /= count;

        // Unsharp mask in linear space, then convert back to sRGB 8-bit
        const sharpenedR = center.r + strength * (center.r - blurR);
        const sharpenedG = center.g + strength * (center.g - blurG);
        const sharpenedB = center.b + strength * (center.b - blurB);

        row.push({
          r: Math.max(0, Math.min(255, this.linear01ToSrgb8(sharpenedR))),
          g: Math.max(0, Math.min(255, this.linear01ToSrgb8(sharpenedG))),
          b: Math.max(0, Math.min(255, this.linear01ToSrgb8(sharpenedB))),
          a: center.a
        });
      }
      sharpened.push(row);
    }

    return sharpened;
  }

  // Extract pixel colors from an image with high-quality resampling
  extractPixelColors(img, width, height) {
    // Prefer gamma-correct supersampled rasterization for best palette matching.
    // This avoids subtle hue shifts that come from naive sRGB downscaling.
    let pixels;
    try {
      pixels = this.rasterizeImage(img, width, height);
    } catch {
      // Fallback to canvas downscale if something goes wrong.
      const canvas = this.resizeImageHighQuality(img, width, height);
      const ctx = canvas.getContext('2d');

      const imageData = ctx.getImageData(0, 0, width, height);
      pixels = [];

      for (let y = 0; y < height; y++) {
        const row = [];
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const r = imageData.data[i];
          const g = imageData.data[i + 1];
          const b = imageData.data[i + 2];
          const a = imageData.data[i + 3];

          if (a < 255) {
            const alpha = a / 255;
            row.push({
              r: Math.round(r * alpha + 255 * (1 - alpha)),
              g: Math.round(g * alpha + 255 * (1 - alpha)),
              b: Math.round(b * alpha + 255 * (1 - alpha)),
              a: 255
            });
          } else {
            row.push({ r, g, b, a });
          }
        }
        pixels.push(row);
      }
    }

    // Apply optional sharpening filter
    const sharpeningStrength = Math.max(0, Math.min(2, (this.options.sharpeningStrength ?? 0) / 100));
    if (sharpeningStrength > 0) {
      pixels = this.applySharpeningFilter(pixels, width, height, sharpeningStrength);
    }

    return pixels;
  }

  // Compute local variance for adaptive dithering strength
  computeLocalVariance(pixels, w, h) {
    const result = Array.from({ length: h }, () => Array(w).fill(null));
    const radius = 2; // Use 5x5 neighborhood for more stable estimates

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sumR = 0, sumG = 0, sumB = 0;
        let count = 0;

        // Calculate mean in neighborhood
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
              const p = pixels[ny][nx];
              sumR += p.r;
              sumG += p.g;
              sumB += p.b;
              count++;
            }
          }
        }

        const meanR = sumR / count;
        const meanG = sumG / count;
        const meanB = sumB / count;

        // Calculate variance
        let varR = 0, varG = 0, varB = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
              const p = pixels[ny][nx];
              varR += (p.r - meanR) ** 2;
              varG += (p.g - meanG) ** 2;
              varB += (p.b - meanB) ** 2;
            }
          }
        }

        // Normalize variance to 0-1 range
        const variance = Math.sqrt((varR + varG + varB) / (count * 3)) / 255;

        // Compute gradient as max absolute difference between opposing edges
        const lx = Math.max(0, x - 1), rx = Math.min(w - 1, x + 1);
        const ty = Math.max(0, y - 1), by = Math.min(h - 1, y + 1);
        const pL = pixels[y][lx], pR = pixels[y][rx];
        const pT = pixels[ty][x], pB = pixels[by][x];
        const avgLeft = (pL.r + pL.g + pL.b) / 3;
        const avgRight = (pR.r + pR.g + pR.b) / 3;
        const avgTop = (pT.r + pT.g + pT.b) / 3;
        const avgBottom = (pB.r + pB.g + pB.b) / 3;
        const gradient = Math.max(
          Math.abs(avgRight - avgLeft),
          Math.abs(avgBottom - avgTop)
        ) / 255;

        result[y][x] = { variance, gradient };
      }
    }

    return result;
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
    const baseDitherStrength = Math.max(0, Math.min(1, (this.options.ditheringStrength ?? 85) / 100));
    const adaptiveDithering = this.options.adaptiveDithering ?? true;
    const w = dimensions.width;
    const h = dimensions.height;
    const error = useDithering
      ? Array.from({ length: h }, () => Array.from({ length: w }, () => ({ r: 0, g: 0, b: 0 })))
      : null;

    // Precompute local variance for adaptive dithering
    const localVariance = useDithering && adaptiveDithering
      ? this.computeLocalVariance(pixels, w, h)
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
            // Adaptive dithering: sigmoid attenuation for edges, boost for smooth gradients
            let ditherStrength = baseDitherStrength;
            if (localVariance) {
              const { variance, gradient } = localVariance[y][x];
              // Sigmoid attenuation: sharp rolloff near threshold preserves detail
              const k = 10;
              const threshold = 0.15;
              ditherStrength *= 1.0 / (1.0 + Math.exp(k * (variance - threshold)));
              // Boost dither on smooth ramps (high gradient, low variance) by up to 20%
              if (gradient > 0.05 && variance < threshold) {
                ditherStrength *= 1.0 + 0.2 * (gradient / 0.5);
              }
            }

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
