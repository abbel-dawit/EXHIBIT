// Automatic image analysis for user-uploaded posters.
// Produces everything the auto effect needs: a "calm map" (where it's safe to move pixels),
// light sources to make glow, a particle palette, a suggested preset and a trackability score.

export const PRESETS = {
  glow:    { label: 'Golden glow', drift: 0.45, ripple: 0.0, sweep: 1.0, pulse: 1.0, shimmer: 0.25, particles: { mode: 'up',    count: 120, size: 1.0, speed: 1.0 } },
  drift:   { label: 'Dream drift', drift: 1.0,  ripple: 0.0, sweep: 0.4, pulse: 0.6, shimmer: 0.0,  particles: { mode: 'float', count: 36,  size: 3.2, speed: 0.5 } },
  sparkle: { label: 'Starlight',   drift: 0.3,  ripple: 0.0, sweep: 0.5, pulse: 0.8, shimmer: 1.0,  particles: { mode: 'down',  count: 150, size: 0.9, speed: 0.6 } },
  ripple:  { label: 'Ripple',      drift: 0.25, ripple: 1.0, sweep: 0.3, pulse: 0.6, shimmer: 0.35, particles: { mode: 'up',    count: 50,  size: 1.4, speed: 0.4 } },
};

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Load a File/Blob into an ImageBitmap (EXIF orientation applied). */
export async function fileToBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); return img; }
    finally { setTimeout(() => URL.revokeObjectURL(url), 4000); }
  }
}

/** Resize an image source to fit maxSide; returns a canvas. */
export function resizeToCanvas(src, maxSide) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function boxBlur(a, w, h, r) {
  const out = new Float32Array(a.length), tmp = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += a[y * w + xx]; n++; } }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } }
    out[y * w + x] = s / n;
  }
  return out;
}

export function analyzeImage(src) {
  const W0 = src.naturalWidth || src.width, H0 = src.naturalHeight || src.height;
  const aspect = H0 / W0;
  const w = 96, h = Math.max(8, Math.round(96 * aspect));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;

  const L = new Float32Array(w * h);
  let sumR = 0, sumG = 0, sumB = 0, sumL = 0, sumL2 = 0;
  const skin = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
    const l = lum(r, gg, b); L[i] = l;
    sumR += r; sumG += gg; sumB += b; sumL += l; sumL2 += l * l;
    // YCbCr skin heuristic: protect faces/skin from being warped
    const cb = 128 - 0.168736 * r - 0.331264 * gg + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * gg - 0.081312 * b;
    skin[i] = (cb > 77 && cb < 127 && cr > 137 && cr < 173 && l > 0.12 && l < 0.92) ? 1 : 0;
  }
  const n = w * h;
  const avg = [sumR / n / 255, sumG / n / 255, sumB / n / 255];
  const meanL = sumL / n, stdL = Math.sqrt(Math.max(0, sumL2 / n - meanL * meanL));

  // Sobel edges → calm map
  const E = new Float32Array(n); let sumE = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
    const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
    E[i] = Math.hypot(gx, gy); sumE += E[i];
  }
  const meanE = sumE / n;
  const Eb = boxBlur(E, w, h, 2);
  const skinB = boxBlur(skin, w, h, 3);
  const calm = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const e = Eb[i];
    let c0 = 1 - smooth(0.05, 0.30, e);          // low detail → calm
    c0 *= 1 - smooth(0.15, 0.5, skinB[i]);        // keep skin still
    const dx = x / w - 0.5, dy = (y / h - 0.5) * aspect;
    c0 *= 0.55 + 0.45 * smooth(0.08, 0.38, Math.hypot(dx, dy)); // subjects are usually central
    calm[i] = Math.round(Math.max(0, Math.min(1, c0)) * 255);
  }
  const calmB = boxBlur(Float32Array.from(calm), w, h, 2);
  const calmMap = new Uint8Array(n);
  for (let i = 0; i < n; i++) calmMap[i] = Math.round(calmB[i]);

  // Light sources: local maxima of blurred luminance
  const Lb = boxBlur(L, w, h, 3);
  const cand = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x, v = Lb[i];
    if (v < Math.min(0.93, Math.max(0.72, meanL + 1.6 * stdL))) continue;
    let isMax = true;
    for (let k = -2; k <= 2 && isMax; k++) for (let j = -2; j <= 2; j++) if ((k || j) && Lb[i + k * w + j] > v) { isMax = false; break; }
    if (isMax) cand.push({ x: x / w, y: y / h, v });
  }
  cand.sort((a, b) => b.v - a.v);
  const lights = [];
  for (const cnd of cand) {
    if (lights.every(l => Math.hypot((l.x - cnd.x), (l.y - cnd.y) * aspect) > 0.18)) lights.push(cnd);
    if (lights.length === 3) break;
  }
  const lightList = lights.map(l => ({ x: l.x, y: l.y, strength: Math.min(1, (l.v - 0.6) * 2.5) }));

  // Palette: average colours of the brightest, most saturated pixels in 3 hue buckets
  const buckets = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < n; i++) {
    if (L[i] < 0.5) continue;
    const r = px[i * 4] / 255, gg = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    if (mx - mn < 0.08) continue;
    const hue = rgbHue(r, gg, b);
    const k = hue < 60 || hue >= 330 ? 0 : hue < 180 ? 1 : 2;
    const wgt = (mx - mn) * L[i];
    buckets[k][0] += r * wgt; buckets[k][1] += gg * wgt; buckets[k][2] += b * wgt; buckets[k][3] += wgt;
  }
  const fallback = [[1, 0.84, 0.5], [1, 0.55, 0.25], [1, 0.95, 0.85]];
  let palette = buckets.filter(b => b[3] > 0.5).sort((a, b) => b[3] - a[3])
    .map(b => brighten([b[0] / b[3], b[1] / b[3], b[2] / b[3]]));
  while (palette.length < 3) palette.push(fallback[palette.length]);

  // Pick a preset automatically
  const warmth = avg[0] - avg[2];
  const topCalm = mean(calmMap, w, h, 0, 0.4) / 255, botCalm = mean(calmMap, w, h, 0.6, 1) / 255;
  const botBlue = meanChannelDiff(px, w, h, 0.6, 1);
  let preset = 'glow';
  if (meanL < 0.32) preset = 'sparkle';
  else if (botCalm > 0.45 && botBlue > 0.04) preset = 'ripple';
  else if (warmth < 0.02 && topCalm > 0.35) preset = 'drift';
  else if (warmth >= 0.02) preset = 'glow';
  else preset = 'drift';
  if (preset === 'sparkle') palette = [[1, 1, 1], [0.85, 0.92, 1], palette[0]];

  // Trackability (0–100): detail + contrast
  const score = Math.round(Math.max(0, Math.min(100, (meanE / 0.12) * 60 + (stdL / 0.22) * 40)));

  return { aspect, calm: { data: calmMap, w, h }, lights: lightList, palette, preset, score, meanL, warmth };
}

function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function mean(a, w, h, y0, y1) { let s = 0, k = 0; for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y++) for (let x = 0; x < w; x++) { s += a[y * w + x]; k++; } return k ? s / k : 0; }
function meanChannelDiff(px, w, h, y0, y1) { let s = 0, k = 0; for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; s += (px[i + 2] - px[i]) / 255; k++; } return k ? s / k : 0; }
function rgbHue(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; return hh < 0 ? hh + 360 : hh; }
function brighten(c) { const m = Math.max(...c, 0.001); const s = 0.98 / m; return c.map(v => Math.min(1, v * s * 0.85 + 0.15)); }

/** Serialisable copy for IndexedDB (typed arrays are fine in IDB). */
export const serialiseAnalysis = a => ({ ...a });
