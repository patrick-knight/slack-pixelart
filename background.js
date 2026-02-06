// MV3 service worker: fetch and sample emoji colors without page CORS limitations

const SAMPLE_SIZE = 16;

// In-memory cache (clears when service worker restarts, but still helps a lot during a resync)
const memCache = new Map();

function computeFromImageData(imageData) {
  const data = imageData.data;
  let r = 0, g = 0, b = 0;
  let ar = 0, ag = 0, ab = 0;
  let accentCount = 0;

  let rr = 0, gg = 0, bb = 0;

  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i];
    const pg = data[i + 1];
    const pb = data[i + 2];
    r += pr;
    g += pg;
    b += pb;

    rr += pr * pr;
    gg += pg * pg;
    bb += pb * pb;

    const fromWhite = (255 - pr) + (255 - pg) + (255 - pb);
    if (fromWhite > 80) {
      ar += pr;
      ag += pg;
      ab += pb;
      accentCount++;
    }
  }

  const count = SAMPLE_SIZE * SAMPLE_SIZE;
  const avg = {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count)
  };

  // Root-mean-square deviation (0..255-ish). Lower means more solid/flat color.
  const vr = Math.max(0, rr / count - (avg.r * avg.r));
  const vg = Math.max(0, gg / count - (avg.g * avg.g));
  const vb = Math.max(0, bb / count - (avg.b * avg.b));
  const variance = Math.sqrt((vr + vg + vb) / 3);

  const accent = accentCount >= 8
    ? { r: Math.round(ar / accentCount), g: Math.round(ag / accentCount), b: Math.round(ab / accentCount) }
    : avg;

  return { color: avg, accentColor: accent, variance, colorProfile: colorProfileFromPixels(data, count) };
}

// Lightweight k-means (k=3) to extract dominant colors from sampled pixels
function colorProfileFromPixels(data, n) {
  if (n === 0) return [];

  // Collect pixels as [r,g,b] arrays
  const pixels = new Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * 4;
    pixels[i] = [data[off], data[off + 1], data[off + 2]];
  }

  // Maximin initialization: pick first pixel, then furthest from existing centroids
  const k = 3;
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
    for (let c = 0; c < k; c++) {
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      for (let i = 0; i < n; i++) {
        if (assignments[i] === c) { sr += pixels[i][0]; sg += pixels[i][1]; sb += pixels[i][2]; cnt++; }
      }
      if (cnt > 0) centroids[c] = [Math.round(sr / cnt), Math.round(sg / cnt), Math.round(sb / cnt)];
    }
  }

  // Build profile and merge clusters closer than ~30 per channel
  const counts = new Array(k).fill(0);
  for (let i = 0; i < n; i++) counts[assignments[i]]++;
  let profile = [];
  for (let c = 0; c < k; c++) {
    if (counts[c] > 0) {
      profile.push({ rgb: { r: centroids[c][0], g: centroids[c][1], b: centroids[c][2] }, weight: counts[c] / n });
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
    const { color, accentColor, variance } = computeFromImageData(imageData);

    const result = { color, accentColor, variance, colorError: false };
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
