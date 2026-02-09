// Core pixel art conversion logic

class PixelArtConverter {
  // Constants
  static TRANSPARENCY_THRESHOLD = 128; // Alpha value threshold for considering pixels as opaque
  static AVG_EMOJI_LENGTH = 10; // Average length of emoji in Slack format (:emoji_name:)
  static FALLBACK_EMOJI = 'white_square'; // Emoji used for transparent/null pixels
  static MIN_DIMENSION = 5; // Minimum grid dimension

  // Emojis that are exempted from duplication rules (solid colors, blanks)
  static EXEMPTED_EMOJI_PATTERNS = ['space', 'blank', 'white', 'black', 'red', 'blue', 'green', 'yellow', 'square'];

  // 8x8 Bayer ordered dithering matrix (normalized to 0-1 range)
  static BAYER_8X8 = [
    [ 0/64,48/64,12/64,60/64, 3/64,51/64,15/64,63/64],
    [32/64,16/64,44/64,28/64,35/64,19/64,47/64,31/64],
    [ 8/64,56/64, 4/64,52/64,11/64,59/64, 7/64,55/64],
    [40/64,24/64,36/64,20/64,43/64,27/64,39/64,23/64],
    [ 2/64,50/64,14/64,62/64, 1/64,49/64,13/64,61/64],
    [34/64,18/64,46/64,30/64,33/64,17/64,45/64,29/64],
    [10/64,58/64, 6/64,54/64, 9/64,57/64, 5/64,53/64],
    [42/64,26/64,38/64,22/64,41/64,25/64,37/64,21/64]
  ];

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
      // New enhancement options
      errorClamping: options.errorClamping ?? true,
      clahe: options.clahe ?? false,
      claheStrength: options.claheStrength ?? 40,
      saturationBoost: options.saturationBoost ?? 100,
      hybridDithering: options.hybridDithering ?? false,
      medianFilter: options.medianFilter ?? false,
      perColorTolerance: options.perColorTolerance ?? false,
      spatialCoherence: options.spatialCoherence ?? false,
      coherenceStrength: options.coherenceStrength ?? 50,
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

  // -------- CIE L*a*b* and CIEDE2000 --------

  linearToXYZ(lin) {
    return {
      x: 0.4124564 * lin.r + 0.3575761 * lin.g + 0.1804375 * lin.b,
      y: 0.2126729 * lin.r + 0.7151522 * lin.g + 0.0721750 * lin.b,
      z: 0.0193339 * lin.r + 0.1191920 * lin.g + 0.9503041 * lin.b
    };
  }

  xyzToLab(xyz) {
    const Xn = 0.95047, Yn = 1.00000, Zn = 1.08883;
    const epsilon = 216 / 24389;
    const kappa = 24389 / 27;

    const f = (t) => t > epsilon ? Math.cbrt(t) : (kappa * t + 16) / 116;

    const fx = f(xyz.x / Xn);
    const fy = f(xyz.y / Yn);
    const fz = f(xyz.z / Zn);

    return {
      L: 116 * fy - 16,
      a: 500 * (fx - fy),
      b: 200 * (fy - fz)
    };
  }

  linearToCieLab(lin) {
    return this.xyzToLab(this.linearToXYZ(lin));
  }

  ciede2000Distance(lab1, lab2) {
    const L1 = lab1.L, a1 = lab1.a, b1 = lab1.b;
    const L2 = lab2.L, a2 = lab2.a, b2 = lab2.b;

    const C1 = Math.sqrt(a1 * a1 + b1 * b1);
    const C2 = Math.sqrt(a2 * a2 + b2 * b2);
    const Cmean = (C1 + C2) / 2;
    const Cmean7 = Math.pow(Cmean, 7);
    const G = 0.5 * (1 - Math.sqrt(Cmean7 / (Cmean7 + 6103515625))); // 25^7
    const a1p = a1 * (1 + G);
    const a2p = a2 * (1 + G);
    const C1p = Math.sqrt(a1p * a1p + b1 * b1);
    const C2p = Math.sqrt(a2p * a2p + b2 * b2);
    const h1p = Math.atan2(b1, a1p) * 180 / Math.PI;
    const h1pAdj = h1p < 0 ? h1p + 360 : h1p;
    const h2p = Math.atan2(b2, a2p) * 180 / Math.PI;
    const h2pAdj = h2p < 0 ? h2p + 360 : h2p;

    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dhp;
    if (C1p * C2p === 0) {
      dhp = 0;
    } else if (Math.abs(h2pAdj - h1pAdj) <= 180) {
      dhp = h2pAdj - h1pAdj;
    } else if (h2pAdj - h1pAdj > 180) {
      dhp = h2pAdj - h1pAdj - 360;
    } else {
      dhp = h2pAdj - h1pAdj + 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);

    const Lpm = (L1 + L2) / 2;
    const Cpm = (C1p + C2p) / 2;
    let Hpm;
    if (C1p * C2p === 0) {
      Hpm = h1pAdj + h2pAdj;
    } else if (Math.abs(h1pAdj - h2pAdj) <= 180) {
      Hpm = (h1pAdj + h2pAdj) / 2;
    } else if (h1pAdj + h2pAdj < 360) {
      Hpm = (h1pAdj + h2pAdj + 360) / 2;
    } else {
      Hpm = (h1pAdj + h2pAdj - 360) / 2;
    }

    const T = 1 - 0.17 * Math.cos((Hpm - 30) * Math.PI / 180)
                + 0.24 * Math.cos(2 * Hpm * Math.PI / 180)
                + 0.32 * Math.cos((3 * Hpm + 6) * Math.PI / 180)
                - 0.20 * Math.cos((4 * Hpm - 63) * Math.PI / 180);

    const Lpm50sq = (Lpm - 50) * (Lpm - 50);
    const SL = 1 + 0.015 * Lpm50sq / Math.sqrt(20 + Lpm50sq);
    const SC = 1 + 0.045 * Cpm;
    const SH = 1 + 0.015 * Cpm * T;
    const Cpm7 = Math.pow(Cpm, 7);
    const RT = -2 * Math.sqrt(Cpm7 / (Cpm7 + 6103515625))
             * Math.sin(60 * Math.exp(-((Hpm - 275) / 25) * ((Hpm - 275) / 25)) * Math.PI / 180);

    const dL = dLp / SL;
    const dC = dCp / SC;
    const dH = dHp / SH;
    return Math.sqrt(dL * dL + dC * dC + dH * dH + RT * dC * dH);
  }

  // -------- Jzazbz color space --------

  linearToJzazbz(lin) {
    const xyz = this.linearToXYZ(lin);
    const b_coeff = 1.15, g_coeff = 0.66;
    const Xp = b_coeff * xyz.x - (b_coeff - 1) * xyz.z;
    const Yp = g_coeff * xyz.y - (g_coeff - 1) * xyz.x;

    const L = 0.41478972 * Xp + 0.579999 * Yp + 0.0146480 * xyz.z;
    const M = -0.20151000 * Xp + 1.120649 * Yp + 0.0531008 * xyz.z;
    const S = -0.01660080 * Xp + 0.264800 * Yp + 0.6684799 * xyz.z;

    // PQ transfer function (for SDR content, normalize to 203 nits)
    const pq = (v) => {
      const x = Math.abs(v) / 10000 * 203;
      const n = 0.15930176, p = 134.034375;
      const c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
      const xn = Math.pow(Math.max(0, x), n);
      return Math.pow((c1 + c2 * xn) / (1 + c3 * xn), p);
    };

    const Lp = pq(L);
    const Mp = pq(M);
    const Sp = pq(S);

    const Iz = 0.5 * (Lp + Mp);
    const d = -0.56;
    const d0 = 1.6295499532821e-11;

    return {
      Jz: (1 + d) * Iz / (1 + d * Iz) - d0,
      az: 3.524000 * Lp - 4.066708 * Mp + 0.542708 * Sp,
      bz: 0.199076 * Lp + 1.096799 * Mp - 1.295875 * Sp
    };
  }

  jzazbzDistance(jz1, jz2) {
    const chromaJ1 = Math.sqrt(jz1.az * jz1.az + jz1.bz * jz1.bz);
    const chromaJ2 = Math.sqrt(jz2.az * jz2.az + jz2.bz * jz2.bz);
    const avgChroma = (chromaJ1 + chromaJ2) / 2;
    const lightnessWeight = 1.6 + (0.4 * Math.exp(-avgChroma * 300));

    const dJ = (jz1.Jz - jz2.Jz) * lightnessWeight;
    const da = jz1.az - jz2.az;
    const db = jz1.bz - jz2.bz;
    return Math.sqrt(dJ * dJ + da * da + db * db);
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

      // Precompute CIE L*a*b* for CIEDE2000 metric
      if (!emoji._cieLab && (this.options.colorMetric === 'ciede2000')) {
        emoji._cieLab = this.linearToCieLab(emoji._lin);
      }

      // Precompute Jzazbz for jzazbz metric
      if (!emoji._jzazbz && (this.options.colorMetric === 'jzazbz')) {
        emoji._jzazbz = this.linearToJzazbz(emoji._lin);
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

      // Precompute chroma for per-color tolerance
      if (!emoji._chroma) {
        const lab = emoji._lab;
        emoji._chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
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

    const seen = new Set();
    const candidates = [];

    const collect = (radius) => {
      for (let dL = -radius; dL <= radius; dL++) {
        for (let da = -radius; da <= radius; da++) {
          for (let db = -radius; db <= radius; db++) {
            const key = `${kL + dL},${kA + da},${kB + db}`;
            const bucket = colorIndex.get(key);
            if (bucket) {
              for (const emoji of bucket) {
                if (!seen.has(emoji)) {
                  seen.add(emoji);
                  candidates.push(emoji);
                }
              }
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

  // Get per-emoji usage cap based on chroma when perColorTolerance is enabled
  getEmojiMaxUses(emoji) {
    if (this.options.tolerance >= 100) return Infinity;
    if (!this.options.perColorTolerance) return this.maxEmojiUses;

    const chroma = emoji._chroma || 0;
    if (chroma < 0.05) return Infinity; // Neutrals/grays: unlimited
    if (chroma < 0.15) return this.maxEmojiUses * 2; // Muted colors: 2x normal
    return this.maxEmojiUses; // Saturated colors: normal limit
  }

  // Find the best matching emoji for a given color.
  // `targetColor` is an sRGB 8-bit color ({r, g, b} in the 0..255 range).
  // Optionally, a precomputed OKLab color ({L, a, b}) can be passed as
  // `targetLabOverride` to avoid recomputing the RGB → linear RGB → OKLab conversion.
  findBestEmoji(targetColor, targetLabOverride = null) {
    // Use spatial index to reduce search space for large emoji sets
    const candidates = this.getCandidateEmojis(targetColor);
    const targetLab = targetLabOverride || this.linearToOklab(this.rgb8ToLinear(targetColor));

    let best = null;
    let bestDist = Infinity;
    let bestAllowed = null;
    let bestAllowedDist = Infinity;

    const metric = this.options.colorMetric;
    const useCiede = metric === 'ciede2000';
    const useJzazbz = metric === 'jzazbz';
    const useHK = metric === 'oklab-hk';

    // For CIEDE2000: first pass with OKLab to find top candidates, then re-rank
    let ciede2000Target = null;
    let jzazbzTarget = null;
    if (useCiede) {
      ciede2000Target = this.linearToCieLab(this.rgb8ToLinear(targetColor));
    } else if (useJzazbz) {
      jzazbzTarget = this.linearToJzazbz(this.rgb8ToLinear(targetColor));
    }

    const distFn = useHK
      ? (a, b) => this.oklabDistanceCalibrated(a, b)
      : (a, b) => this.oklabDistance(a, b);

    // Collect scored candidates for CIEDE2000 re-ranking
    const topCandidates = useCiede ? [] : null;

    for (const emoji of candidates) {
      if (!emoji || !emoji.color) continue;

      let dist;
      if (emoji._labProfile) {
        // Multi-region profile: blend overall visual impression with best cluster match.
        let avgL = 0, avgA = 0, avgB = 0, totalW = 0;
        let minClusterDist = Infinity;
        for (const entry of emoji._labProfile) {
          avgL += entry.lab.L * entry.weight;
          avgA += entry.lab.a * entry.weight;
          avgB += entry.lab.b * entry.weight;
          totalW += entry.weight;
          const d = distFn(targetLab, entry.lab);
          if (d < minClusterDist) minClusterDist = d;
        }
        if (totalW > 0) {
          const avgLab = { L: avgL / totalW, a: avgA / totalW, b: avgB / totalW };
          const avgDist = distFn(targetLab, avgLab);
          // Blend: overall impression (60%) + best cluster (40%)
          dist = avgDist * 0.6 + minClusterDist * 0.4;
        } else {
          dist = minClusterDist;
        }
      } else if (useJzazbz && emoji._jzazbz) {
        dist = this.jzazbzDistance(jzazbzTarget, emoji._jzazbz);
      } else {
        // Fallback: single mean + optional accent
        const emojiLab = emoji._lab || this.linearToOklab(this.rgb8ToLinear(emoji.color));
        dist = distFn(targetLab, emojiLab);

        if (emoji._labAccent) {
          const distAccent = distFn(targetLab, emoji._labAccent);
          // Use whichever is closer; slightly favor the accent by making it 5% closer
          dist = Math.min(dist, distAccent * 0.95);
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

      // For CIEDE2000: collect top 20 candidates by OKLab, then re-rank
      if (useCiede) {
        topCandidates.push({ emoji, dist });
        continue;
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
      const maxUses = this.getEmojiMaxUses(emoji);
      const allowed = isExempted || usageCount < maxUses;

      if (allowed && dist < bestAllowedDist) {
        bestAllowedDist = dist;
        bestAllowed = emoji;
      }
    }

    // CIEDE2000 re-ranking: sort by OKLab distance, take top 20, re-rank with CIEDE2000
    if (useCiede && topCandidates.length > 0) {
      topCandidates.sort((a, b) => a.dist - b.dist);
      const rerank = topCandidates.slice(0, 20);
      for (const entry of rerank) {
        const cieLab = entry.emoji._cieLab || this.linearToCieLab(entry.emoji._lin || this.rgb8ToLinear(entry.emoji.color));
        entry.emoji._cieLab = cieLab;
        entry.dist = this.ciede2000Distance(ciede2000Target, cieLab);
      }
      rerank.sort((a, b) => a.dist - b.dist);
      best = rerank[0].emoji;
      bestDist = rerank[0].dist;
      if (this.options.tolerance < 100) {
        for (const entry of rerank) {
          const isExempted = this.isExemptedEmoji(entry.emoji.name);
          const usageCount = this.usedEmojis.get(entry.emoji.name) || 0;
          const maxUses = this.getEmojiMaxUses(entry.emoji);
          if (isExempted || usageCount < maxUses) {
            bestAllowed = entry.emoji;
            bestAllowedDist = entry.dist;
            break;
          }
        }
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
    const targetLab = this.linearToOklab(targetLinear);
    return this.findBestEmoji(targetRgb, targetLab);
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

  // Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)
  applyCLAHE(pixels, width, height, clipLimit = 2.0, tileSize = 8) {
    const numBins = 256;
    const tilesX = Math.max(1, Math.ceil(width / tileSize));
    const tilesY = Math.max(1, Math.ceil(height / tileSize));

    // Compute luminance for each pixel
    const lum = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const p = pixels[y][x];
        row.push(Math.round(0.299 * p.r + 0.587 * p.g + 0.114 * p.b));
      }
      lum.push(row);
    }

    // Compute clipped CDF for each tile
    const tileCDFs = [];
    for (let ty = 0; ty < tilesY; ty++) {
      const tileRow = [];
      for (let tx = 0; tx < tilesX; tx++) {
        const yStart = Math.floor(ty * height / tilesY);
        const yEnd = Math.min(height, Math.floor((ty + 1) * height / tilesY));
        const xStart = Math.floor(tx * width / tilesX);
        const xEnd = Math.min(width, Math.floor((tx + 1) * width / tilesX));
        const tilePixels = (yEnd - yStart) * (xEnd - xStart);

        // Build histogram
        const hist = new Float64Array(numBins);
        for (let y = yStart; y < yEnd; y++) {
          for (let x = xStart; x < xEnd; x++) {
            hist[lum[y][x]]++;
          }
        }

        // Clip histogram and redistribute
        const limit = Math.max(1, clipLimit * tilePixels / numBins);
        let excess = 0;
        for (let i = 0; i < numBins; i++) {
          if (hist[i] > limit) {
            excess += hist[i] - limit;
            hist[i] = limit;
          }
        }
        const redistribute = excess / numBins;
        for (let i = 0; i < numBins; i++) {
          hist[i] += redistribute;
        }

        // Build CDF (maps input luminance to output 0-255)
        const cdf = new Float64Array(numBins);
        cdf[0] = hist[0];
        for (let i = 1; i < numBins; i++) {
          cdf[i] = cdf[i - 1] + hist[i];
        }
        const cdfMin = cdf[0];
        const cdfRange = Math.max(1, tilePixels - cdfMin);
        for (let i = 0; i < numBins; i++) {
          cdf[i] = Math.round(((cdf[i] - cdfMin) / cdfRange) * 255);
        }

        tileRow.push(cdf);
      }
      tileCDFs.push(tileRow);
    }

    // Interpolate CDFs for each pixel and apply
    const result = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        // Find surrounding tile centers
        const tfy = (y + 0.5) / height * tilesY - 0.5;
        const tfx = (x + 0.5) / width * tilesX - 0.5;
        const ty0 = Math.max(0, Math.floor(tfy));
        const ty1 = Math.min(tilesY - 1, ty0 + 1);
        const tx0 = Math.max(0, Math.floor(tfx));
        const tx1 = Math.min(tilesX - 1, tx0 + 1);
        const fy = tfy - ty0;
        const fx = tfx - tx0;

        const l = lum[y][x];
        // Bilinear interpolation of the 4 surrounding tile CDFs
        const v00 = tileCDFs[ty0][tx0][l];
        const v10 = tileCDFs[ty0][tx1][l];
        const v01 = tileCDFs[ty1][tx0][l];
        const v11 = tileCDFs[ty1][tx1][l];
        const newLum = (1 - fy) * ((1 - fx) * v00 + fx * v10) + fy * ((1 - fx) * v01 + fx * v11);

        // Apply equalized luminance while preserving color ratios
        const p = pixels[y][x];
        const oldLum = Math.max(1, 0.299 * p.r + 0.587 * p.g + 0.114 * p.b);
        const scale = newLum / oldLum;

        row.push({
          r: Math.max(0, Math.min(255, Math.round(p.r * scale))),
          g: Math.max(0, Math.min(255, Math.round(p.g * scale))),
          b: Math.max(0, Math.min(255, Math.round(p.b * scale))),
          a: p.a
        });
      }
      result.push(row);
    }
    return result;
  }

  // Apply saturation boost/reduction
  applySaturationBoost(pixels, width, height, boost) {
    if (boost === 1.0) return pixels;

    const result = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const p = pixels[y][x];
        // Luminance-preserving saturation adjustment
        const lum = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
        row.push({
          r: Math.max(0, Math.min(255, Math.round(lum + (p.r - lum) * boost))),
          g: Math.max(0, Math.min(255, Math.round(lum + (p.g - lum) * boost))),
          b: Math.max(0, Math.min(255, Math.round(lum + (p.b - lum) * boost))),
          a: p.a
        });
      }
      result.push(row);
    }
    return result;
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

    // Apply optional CLAHE
    if (this.options.clahe) {
      const strength = Math.max(0, Math.min(1, (this.options.claheStrength ?? 40) / 100));
      const claheResult = this.applyCLAHE(pixels, width, height);
      // Blend original with CLAHE result
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const orig = pixels[y][x];
          const eq = claheResult[y][x];
          pixels[y][x] = {
            r: Math.round(orig.r + (eq.r - orig.r) * strength),
            g: Math.round(orig.g + (eq.g - orig.g) * strength),
            b: Math.round(orig.b + (eq.b - orig.b) * strength),
            a: orig.a
          };
        }
      }
    }

    // Apply optional saturation boost
    const satBoost = (this.options.saturationBoost ?? 100) / 100;
    if (satBoost !== 1.0) {
      pixels = this.applySaturationBoost(pixels, width, height, satBoost);
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

  // Classify regions as photo-like or graphic-like for hybrid dithering
  computeRegionType(localVariance, w, h) {
    const isPhoto = Array.from({ length: h }, () => Array(w).fill(true));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Graphic regions: low variance (flat color areas)
        isPhoto[y][x] = localVariance[y][x].variance > 0.06;
      }
    }
    return isPhoto;
  }

  // Apply spatial coherence: prefer neighboring emojis when close in color distance
  applySpatialCoherence(grid, pixels, w, h) {
    const strength = Math.max(0, Math.min(1, (this.options.coherenceStrength ?? 50) / 100));
    if (strength <= 0) return grid;

    const newGrid = grid.map(row => [...row]);
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const current = grid[y][x];
        if (!current || !current.color) continue;

        const targetLab = this.linearToOklab(this.rgb8ToLinear(pixels[y][x]));
        const currentLab = current._lab || this.linearToOklab(this.rgb8ToLinear(current.color));
        const currentDist = this.oklabDistance(targetLab, currentLab);

        // Check if any neighbor emoji is close enough to be preferred
        let bestNeighbor = null;
        let bestNeighborDist = Infinity;

        for (const [dy, dx] of directions) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          const neighbor = grid[ny][nx];
          if (!neighbor || !neighbor.color || neighbor === current) continue;

          const neighborLab = neighbor._lab || this.linearToOklab(this.rgb8ToLinear(neighbor.color));
          const dist = this.oklabDistance(targetLab, neighborLab);
          if (dist < bestNeighborDist) {
            bestNeighborDist = dist;
            bestNeighbor = neighbor;
          }
        }

        // Replace current with neighbor if it's within threshold
        if (bestNeighbor && bestNeighborDist < currentDist * (1 + 0.15 * strength)) {
          newGrid[y][x] = bestNeighbor;
        }
      }
    }

    return newGrid;
  }

  // Apply median filter to remove isolated outlier emojis
  applyMedianFilter(grid, pixels, w, h) {
    const newGrid = grid.map(row => [...row]);
    const directions = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const current = grid[y][x];
        if (!current || !current.color) continue;

        const neighbors = [];
        for (const [dy, dx] of directions) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w && grid[ny][nx]) {
            neighbors.push(grid[ny][nx]);
          }
        }
        if (neighbors.length < 3) continue;

        // Compute average distance between neighbors
        const targetLab = this.linearToOklab(this.rgb8ToLinear(pixels[y][x]));
        const currentLab = current._lab || this.linearToOklab(this.rgb8ToLinear(current.color));
        const currentDist = this.oklabDistance(targetLab, currentLab);

        let neighborDistSum = 0;
        for (const n of neighbors) {
          const nLab = n._lab || this.linearToOklab(this.rgb8ToLinear(n.color));
          neighborDistSum += this.oklabDistance(targetLab, nLab);
        }
        const avgNeighborDist = neighborDistSum / neighbors.length;

        // If current is an outlier (> 2x average neighbor distance), replace with most common neighbor
        if (currentDist > avgNeighborDist * 2 && avgNeighborDist > 0) {
          // Find most common neighbor emoji
          const counts = new Map();
          for (const n of neighbors) {
            counts.set(n.name, (counts.get(n.name) || 0) + 1);
          }
          let bestName = null, bestCount = 0;
          for (const [name, count] of counts) {
            if (count > bestCount) { bestCount = count; bestName = name; }
          }
          // Only replace if the replacement is within 20% of target pixel color
          const replacement = neighbors.find(n => n.name === bestName);
          if (replacement) {
            const repLab = replacement._lab || this.linearToOklab(this.rgb8ToLinear(replacement.color));
            const repDist = this.oklabDistance(targetLab, repLab);
            if (repDist < currentDist * 1.2) {
              newGrid[y][x] = replacement;
            }
          }
        }
      }
    }

    return newGrid;
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
    let grid = [];
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
    const useHybridDithering = this.options.hybridDithering && useDithering;
    const useErrorClamping = this.options.errorClamping ?? true;
    const w = dimensions.width;
    const h = dimensions.height;
    const error = useDithering
      ? Array.from({ length: h }, () => Array.from({ length: w }, () => ({ r: 0, g: 0, b: 0 })))
      : null;

    // Precompute local variance for adaptive dithering
    const localVariance = useDithering && (adaptiveDithering || useHybridDithering)
      ? this.computeLocalVariance(pixels, w, h)
      : null;

    // Precompute region types for hybrid dithering
    const regionType = useHybridDithering && localVariance
      ? this.computeRegionType(localVariance, w, h)
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
          // Check if this pixel should use ordered (Bayer) dithering instead of F-S
          const useOrdered = useHybridDithering && regionType && !regionType[y][x];

          if (useOrdered) {
            // Ordered dithering for graphic/flat regions
            const threshold = PixelArtConverter.BAYER_8X8[y % 8][x % 8] - 0.5;
            const scale = baseDitherStrength * 0.3;
            const baseLin = this.rgb8ToLinear(pixel);
            const targetLin = this.clampLinear({
              r: baseLin.r + threshold * scale,
              g: baseLin.g + threshold * scale,
              b: baseLin.b + threshold * scale
            });
            emoji = this.findBestEmojiFromLinear(targetLin);
          } else {
            // Floyd-Steinberg error diffusion for photo-like regions
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

              // Clamp error to prevent overcorrection in high-contrast regions
              if (useErrorClamping) {
                const maxErr = 0.1;
                err.r = Math.max(-maxErr, Math.min(maxErr, err.r));
                err.g = Math.max(-maxErr, Math.min(maxErr, err.g));
                err.b = Math.max(-maxErr, Math.min(maxErr, err.b));
              }

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
          const progress = 40 + Math.floor((processedPixels / totalPixels) * 40);
          onProgress(progress, `Matching emojis... ${processedPixels}/${totalPixels}`);
        }
      }
      grid.push(row);
    }

    // Post-processing passes
    if (onProgress) onProgress(82, 'Post-processing...');

    // Apply spatial coherence
    if (this.options.spatialCoherence) {
      grid = this.applySpatialCoherence(grid, pixels, w, h);
    }

    // Apply median filter
    if (this.options.medianFilter) {
      grid = this.applyMedianFilter(grid, pixels, w, h);
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
