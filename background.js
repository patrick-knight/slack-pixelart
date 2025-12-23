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

  return { color: avg, accentColor: accent, variance };
}

async function sampleEmojiColor(url) {
  if (memCache.has(url)) {
    return memCache.get(url);
  }

  // Use fetch from extension context (host_permissions) to avoid CORS issues seen in page/content context.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

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
  if (request && request.action === 'sampleEmojiColor' && typeof request.url === 'string') {
    sampleEmojiColor(request.url).then(sendResponse);
    return true;
  }

  return false;
});
