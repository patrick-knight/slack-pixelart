// MV3 service worker: fetch and sample emoji colors without page CORS limitations

const SAMPLE_SIZE = 24;

// In-memory cache (clears when service worker restarts, but still helps a lot during a resync)
const memCache = new Map();

// Precompute center-weighted Gaussian sampling weights (center pixels matter more, edge artifacts less)
const centerWeights = computeCenterWeights(SAMPLE_SIZE);

function computeCenterWeights(size) {
  const weights = new Float32Array(size * size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const sigma = size / 3;
  const sigmaSquared2 = 2 * sigma * sigma;
  let totalWeight = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const w = 0.3 + 0.7 * Math.exp(-(dx * dx + dy * dy) / sigmaSquared2);
      weights[y * size + x] = w;
      totalWeight += w;
    }
  }

  // Normalize so weights sum to pixel count (keeps existing math compatible)
  const scale = (size * size) / totalWeight;
  for (let i = 0; i < weights.length; i++) {
    weights[i] *= scale;
  }

  return weights;
}

function computeFromImageData(imageData) {
  const data = imageData.data;
  const count = SAMPLE_SIZE * SAMPLE_SIZE;

  let r = 0, g = 0, b = 0;
  let ar = 0, ag = 0, ab = 0;
  let accentWeight = 0;
  let rr = 0, gg = 0, bb = 0;
  let totalWeight = 0;

  for (let i = 0; i < count; i++) {
    const off = i * 4;
    const pr = data[off];
    const pg = data[off + 1];
    const pb = data[off + 2];
    const w = centerWeights[i];

    r += pr * w;
    g += pg * w;
    b += pb * w;

    rr += pr * pr * w;
    gg += pg * pg * w;
    bb += pb * pb * w;

    totalWeight += w;

    const fromWhite = (255 - pr) + (255 - pg) + (255 - pb);
    if (fromWhite > 80) {
      ar += pr * w;
      ag += pg * w;
      ab += pb * w;
      accentWeight += w;
    }
  }

  const avg = {
    r: Math.round(r / totalWeight),
    g: Math.round(g / totalWeight),
    b: Math.round(b / totalWeight)
  };

  // Weighted root-mean-square deviation (0..255-ish). Lower means more solid/flat color.
  const vr = Math.max(0, rr / totalWeight - (avg.r * avg.r));
  const vg = Math.max(0, gg / totalWeight - (avg.g * avg.g));
  const vb = Math.max(0, bb / totalWeight - (avg.b * avg.b));
  const variance = Math.sqrt((vr + vg + vb) / 3);

  const accent = accentWeight >= 8
    ? { r: Math.round(ar / accentWeight), g: Math.round(ag / accentWeight), b: Math.round(ab / accentWeight) }
    : avg;

  return { color: avg, accentColor: accent, variance, colorProfile: colorProfileFromPixels(data, count, centerWeights) };
}

// Adaptive k-means to extract dominant colors from sampled pixels
function colorProfileFromPixels(data, n, weights = null) {
  if (n === 0) return [];

  // Collect pixels as [r,g,b] arrays
  const pixels = new Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * 4;
    pixels[i] = [data[off], data[off + 1], data[off + 2]];
  }

  // Adaptive k: analyze color diversity to pick cluster count
  const colorSet = new Set();
  for (let i = 0; i < n; i++) {
    const qr = pixels[i][0] >> 4, qg = pixels[i][1] >> 4, qb = pixels[i][2] >> 4;
    colorSet.add((qr << 8) | (qg << 4) | qb);
  }
  const uniqueColors = colorSet.size;
  let k;
  if (uniqueColors <= 3) k = 2;
  else if (uniqueColors <= 10) k = 3;
  else k = 4;
  k = Math.min(k, uniqueColors);
  if (k < 1) k = 1;

  // Maximin initialization: pick first pixel, then furthest from existing centroids
  const centroids = [pixels[0].slice()];
  for (let c = 1; c < k; c++) {
    let bestIdx = 0, bestDist = -1;
    for (let i = 0; i < n; i++) {
      let minD = Infinity;
      for (const cent of centroids) {
        const dr = pixels[i][0] - cent[0], dg = pixels[i][1] - cent[1], db = pixels[i][2] - cent[2];
        minD = Math.min(minD, dr * dr + dg * dg + db * db);
      }
      if (minD > bestDist) { bestDist = minD; bestIdx = i; }
    }
    centroids.push(pixels[bestIdx].slice());
  }

  const assignments = new Uint8Array(n);
  for (let iter = 0; iter < 12; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bestC = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = pixels[i][0] - centroids[c][0], dg = pixels[i][1] - centroids[c][1], db = pixels[i][2] - centroids[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; bestC = c; }
      }
      if (assignments[i] !== bestC) { assignments[i] = bestC; changed = true; }
    }
    if (!changed) break;
    // Update centroids using center-weights
    for (let c = 0; c < k; c++) {
      let sr = 0, sg = 0, sb = 0, wSum = 0;
      for (let i = 0; i < n; i++) {
        if (assignments[i] === c) {
          const w = weights ? weights[i] : 1;
          sr += pixels[i][0] * w;
          sg += pixels[i][1] * w;
          sb += pixels[i][2] * w;
          wSum += w;
        }
      }
      if (wSum > 0) centroids[c] = [Math.round(sr / wSum), Math.round(sg / wSum), Math.round(sb / wSum)];
    }
  }

  // Build profile with weighted counts and merge clusters closer than ~30 per channel
  const clusterWeights = new Array(k).fill(0);
  let totalClusterWeight = 0;
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    clusterWeights[assignments[i]] += w;
    totalClusterWeight += w;
  }
  let profile = [];
  for (let c = 0; c < k; c++) {
    if (clusterWeights[c] > 0) {
      profile.push({ rgb: { r: centroids[c][0], g: centroids[c][1], b: centroids[c][2] }, weight: clusterWeights[c] / totalClusterWeight });
    }
  }
  let didMerge = true;
  while (didMerge) {
    didMerge = false;
    for (let i = 0; i < profile.length && !didMerge; i++) {
      for (let j = i + 1; j < profile.length && !didMerge; j++) {
        const dr = profile[i].rgb.r - profile[j].rgb.r, dg = profile[i].rgb.g - profile[j].rgb.g, db = profile[i].rgb.b - profile[j].rgb.b;
        if (dr * dr + dg * dg + db * db < 900) {
          const w = profile[i].weight + profile[j].weight;
          profile[i].rgb = {
            r: Math.round((profile[i].rgb.r * profile[i].weight + profile[j].rgb.r * profile[j].weight) / w),
            g: Math.round((profile[i].rgb.g * profile[i].weight + profile[j].rgb.g * profile[j].weight) / w),
            b: Math.round((profile[i].rgb.b * profile[i].weight + profile[j].rgb.b * profile[j].weight) / w)
          };
          profile[i].weight = w;
          profile.splice(j, 1);
          didMerge = true;
        }
      }
    }
  }
  profile.sort((a, b) => b.weight - a.weight);
  return profile;
}

async function sampleEmojiColor(url) {
  if (memCache.has(url)) {
    return memCache.get(url);
  }

  // Use fetch from extension context (host_permissions) to avoid CORS issues seen in page/content context.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      // Cookies usually not required for emoji CDN, but include anyway for slack.com-hosted assets
      credentials: 'include',
      cache: 'force-cache',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();

    // Decode
    const bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    ctx.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }

    const imageData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { color, accentColor, variance, colorProfile } = computeFromImageData(imageData);

    const result = { color, accentColor, variance, colorProfile, colorError: false };
    memCache.set(url, result);
    return result;
  } catch (err) {
    const result = {
      color: { r: 128, g: 128, b: 128 },
      accentColor: { r: 128, g: 128, b: 128 },
      variance: 999,
      colorError: true,
      error: String(err && err.message ? err.message : err)
    };
    memCache.set(url, result);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === 'sampleEmojiColors' && Array.isArray(request.urls)) {
    // Process in chunks of 20 to avoid overwhelming the service worker
    (async () => {
      const results = new Array(request.urls.length);
      const chunkSize = 20;
      for (let i = 0; i < request.urls.length; i += chunkSize) {
        const chunk = request.urls.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(chunk.map(url => sampleEmojiColor(url)));
        for (let j = 0; j < chunkResults.length; j++) {
          results[i + j] = chunkResults[j];
        }
      }
      sendResponse(results);
    })();
    return true;
  }

  if (request && request.action === 'sampleEmojiColor' && typeof request.url === 'string') {
    sampleEmojiColor(request.url).then(sendResponse);
    return true;
  }

  return false;
});
