// Self-contained QR code encoder + decoder (versions 1–10, all error-correction levels, byte mode).
// No third-party code and no network: used by the in-app scanner and by the Studio's print cards.

// ---------------------------------------------------------------- Galois field GF(256), poly 0x11d
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const gmul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;
const gdiv = (a, b) => { if (!b) throw new Error('div0'); return a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0; };
const gpow = (e) => EXP[((e % 255) + 255) % 255];

// ---------------------------------------------------------------- tables (ISO/IEC 18004)
const LEVELS = { L: 1, M: 0, Q: 3, H: 2 };                     // format-info bits
// [ecCodewordsPerBlock, blocks1, dataPerBlock1, blocks2, dataPerBlock2]
const BLOCKS = {
  1: { L: [7, 1, 19], M: [10, 1, 16], Q: [13, 1, 13], H: [17, 1, 9] },
  2: { L: [10, 1, 34], M: [16, 1, 28], Q: [22, 1, 22], H: [28, 1, 16] },
  3: { L: [15, 1, 55], M: [26, 1, 44], Q: [18, 2, 17], H: [22, 2, 13] },
  4: { L: [20, 1, 80], M: [18, 2, 32], Q: [26, 2, 24], H: [16, 4, 9] },
  5: { L: [26, 1, 108], M: [24, 2, 43], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6: { L: [18, 2, 68], M: [16, 4, 27], Q: [24, 4, 19], H: [28, 4, 15] },
  7: { L: [20, 2, 78], M: [18, 4, 31], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
  8: { L: [24, 2, 97], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
  9: { L: [30, 2, 116], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
  10: { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] },
};
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const MAX_VERSION = 10;

function blockLayout(version, level) {
  const [ec, b1, d1, b2 = 0, d2 = 0] = BLOCKS[version][level];
  const blocks = [];
  for (let i = 0; i < b1; i++) blocks.push(d1);
  for (let i = 0; i < b2; i++) blocks.push(d2);
  return { ec, blocks, dataTotal: b1 * d1 + b2 * d2 };
}

// ---------------------------------------------------------------- BCH (format & version info)
const digits = n => { let d = 0; while (n) { d++; n >>>= 1; } return d; };
function bch(data, gen, shift) { let d = data << shift; while (digits(d) - digits(gen) >= 0) d ^= gen << (digits(d) - digits(gen)); return (data << shift) | d; }
const formatBits = (level, mask) => bch((LEVELS[level] << 3) | mask, 0x537, 10) ^ 0x5412;
const versionBits = v => bch(v, 0x1f25, 12);
const FORMATS = [];   // all 32 valid format words
for (const lv of 'LMQH') for (let m = 0; m < 8; m++) FORMATS.push({ level: lv, mask: m, bits: formatBits(lv, m) });

// format bit positions: two copies, [row, col] per bit i (i = 0 is the least significant bit)
function formatPositions(n) {
  const a = [], b = [];
  for (let i = 0; i < 15; i++) {
    a.push(i < 6 ? [i, 8] : i < 8 ? [i + 1, 8] : [n - 15 + i, 8]);
    b.push(i < 8 ? [8, n - i - 1] : i < 9 ? [8, 15 - i] : [8, 14 - i]);
  }
  return [a, b];
}

const MASKS = [
  (i, j) => (i + j) % 2 === 0, (i) => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0, (i, j) => (i * j) % 2 + (i * j) % 3 === 0,
  (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0, (i, j) => ((i * j) % 3 + (i + j) % 2) % 2 === 0,
];

/** Grid with function patterns set (true/false) and data cells null. Format/version areas reserved. */
function baseGrid(version) {
  const n = version * 4 + 17;
  const g = Array.from({ length: n }, () => new Array(n).fill(null));
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c; if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
      g[rr][cc] = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
    }
  };
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
  const pos = ALIGN[version];
  for (const r of pos) for (const c of pos) {
    if (g[r][c] !== null) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) g[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
  }
  for (let i = 8; i < n - 8; i++) { if (g[i][6] === null) g[i][6] = i % 2 === 0; if (g[6][i] === null) g[6][i] = i % 2 === 0; }
  for (const copy of formatPositions(n)) for (const [r, c] of copy) g[r][c] = false;   // reserved
  g[n - 8][8] = true;                                                                  // dark module
  if (version >= 7) for (let i = 0; i < 18; i++) { g[Math.floor(i / 3)][i % 3 + n - 11] = false; g[i % 3 + n - 11][Math.floor(i / 3)] = false; }
  return g;
}

/** Visit data cells in placement order. */
function forEachDataCell(g, fn) {
  const n = g.length; let row = n - 1, inc = -1;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) if (g[row][col - c] === null) fn(row, col - c);
      row += inc;
      if (row < 0 || row >= n) { row -= inc; inc = -inc; break; }
    }
  }
}

// ---------------------------------------------------------------- Reed–Solomon
function rsGenerator(ec) {
  let g = [1];
  for (let i = 0; i < ec; i++) {                   // multiply by (x - α^i); coefficients high → low
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], gpow(i)); }
    g = next;
  }
  return g;
}
function rsEncode(data, ec) {
  const gen = rsGenerator(ec), res = new Array(ec).fill(0);
  for (const d of data) {
    const f = d ^ res[0]; res.shift(); res.push(0);
    if (f) for (let j = 0; j < ec; j++) res[j] ^= gmul(gen[j + 1], f);
  }
  return res;
}
/** Correct a block in place (codewords high-degree first). Returns false if uncorrectable. */
function rsDecode(cw, ec) {
  const n = cw.length;
  const S = new Array(ec);
  let bad = false;
  for (let i = 0; i < ec; i++) { let s = 0; const a = gpow(i); for (let j = 0; j < n; j++) s = gmul(s, a) ^ cw[j]; S[i] = s; if (s) bad = true; }
  if (!bad) return true;
  // Berlekamp–Massey (polynomials low → high degree)
  let C = [1], B = [1], L = 0, m = 1, b = 1;
  for (let k = 0; k < ec; k++) {
    let d = S[k];
    for (let i = 1; i <= L; i++) d ^= gmul(C[i] || 0, S[k - i]);
    if (d === 0) { m++; continue; }
    const coef = gdiv(d, b), T = C.slice();
    const need = B.length + m; while (C.length < need) C.push(0);
    for (let i = 0; i < B.length; i++) C[i + m] ^= gmul(coef, B[i]);
    if (2 * L <= k) { L = k + 1 - L; B = T; b = d; m = 1; } else m++;
  }
  if (L * 2 > ec) return false;
  const evalLow = (p, x) => { let y = 0; for (let i = p.length - 1; i >= 0; i--) y = gmul(y, x) ^ p[i]; return y; };
  // Chien search
  const errs = [];
  for (let p = 0; p < n; p++) if (evalLow(C, gpow(-p)) === 0) errs.push(p);
  if (errs.length !== L) return false;
  // Forney (first root α^0)
  const Omega = new Array(ec).fill(0);
  for (let i = 0; i < ec; i++) for (let j = 0; j <= i && j < C.length; j++) Omega[i] ^= gmul(C[j], S[i - j]);
  const dC = C.map((c, i) => (i % 2 === 1 ? c : 0)).slice(1);      // formal derivative
  for (const p of errs) {
    const Xinv = gpow(-p);
    const den = evalLow(dC, Xinv); if (!den) return false;
    const mag = gmul(gpow(p), gdiv(evalLow(Omega, Xinv), den));
    cw[n - 1 - p] ^= mag;
  }
  return true;
}

// ================================================================ ENCODER
/** Encode text → { size, modules: boolean[][] } (dark = true). level: 'L' | 'M' | 'Q' | 'H' */
export function encodeQR(text, level = 'M') {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) {
    const bitsCount = v < 10 ? 8 : 16;
    if (4 + bitsCount + bytes.length * 8 <= blockLayout(v, level).dataTotal * 8) { version = v; break; }
  }
  if (!version) throw new Error('Text too long for a QR code here (max ~210 characters).');
  const { ec, blocks, dataTotal } = blockLayout(version, level);
  // bit stream
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, version < 10 ? 8 : 16); for (const b of bytes) put(b, 8);
  const cap = dataTotal * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataTotal; pad ^= 0xec ^ 0x11) data.push(pad);
  // blocks + error correction, interleaved
  const dBlocks = [], eBlocks = []; let off = 0;
  for (const len of blocks) { const d = data.slice(off, off + len); off += len; dBlocks.push(d); eBlocks.push(rsEncode(d, ec)); }
  const out = [];
  for (let i = 0; i < Math.max(...blocks); i++) for (const d of dBlocks) if (i < d.length) out.push(d[i]);
  for (let i = 0; i < ec; i++) for (const e of eBlocks) out.push(e[i]);
  // place with the best mask
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const g = baseGrid(version), n = g.length;
    const free = baseGrid(version);
    let bi = 0;
    forEachDataCell(free, (r, c) => {
      let dark = bi < out.length * 8 ? ((out[bi >> 3] >>> (7 - (bi & 7))) & 1) === 1 : false;
      bi++;
      if (MASKS[mask](r, c)) dark = !dark;
      g[r][c] = dark;
    });
    const fb = formatBits(level, mask);
    for (const copy of formatPositions(n)) copy.forEach(([r, c], i) => { g[r][c] = ((fb >> i) & 1) === 1; });
    if (version >= 7) { const vb = versionBits(version); for (let i = 0; i < 18; i++) { const d = ((vb >> i) & 1) === 1; g[Math.floor(i / 3)][i % 3 + n - 11] = d; g[i % 3 + n - 11][Math.floor(i / 3)] = d; } }
    const score = penalty(g);
    if (!best || score < best.score) best = { score, g };
  }
  return { size: best.g.length, version, modules: best.g };
}

function penalty(g) {
  const n = g.length; let p = 0, dark = 0;
  for (let i = 0; i < n; i++) {
    let rr = 1, rc = 1;
    for (let j = 1; j < n; j++) {
      if (g[i][j] === g[i][j - 1]) rr++; else { if (rr >= 5) p += rr - 2; rr = 1; }
      if (g[j][i] === g[j - 1][i]) rc++; else { if (rc >= 5) p += rc - 2; rc = 1; }
    }
    if (rr >= 5) p += rr - 2; if (rc >= 5) p += rc - 2;
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) { const v = g[i][j]; if (v === g[i + 1][j] && v === g[i][j + 1] && v === g[i + 1][j + 1]) p += 3; }
  const pat = [1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < n; i++) for (let j = 0; j + 6 < n; j++) {
    let h = true, v = true;
    for (let k = 0; k < 7; k++) { if (+g[i][j + k] !== pat[k]) h = false; if (+g[j + k][i] !== pat[k]) v = false; }
    if (h) p += 40; if (v) p += 40;
  }
  for (const row of g) for (const v of row) if (v) dark++;
  return p + Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;
}

/** Draw to a canvas (white background, `margin` modules quiet zone). */
export function qrToCanvas(text, { scale = 8, margin = 4, level = 'M' } = {}) {
  const { size, modules } = encodeQR(text, level);
  const px = (size + margin * 2) * scale;
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, px, px); g.fillStyle = '#000';
  for (let r = 0; r < size; r++) for (let col = 0; col < size; col++) if (modules[r][col]) g.fillRect((col + margin) * scale, (r + margin) * scale, scale, scale);
  return c;
}

// ================================================================ DECODER
/** Decode from RGBA pixels. Returns the text, or null if no readable QR code was found. */
export function decodeQR(rgba, width, height) {
  const lum = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  for (const bin of [binarizeLocal(lum, width, height), binarizeGlobal(lum, width, height)]) {
    const r = decodeBinary(bin, width, height);
    if (r !== null) return r;
  }
  return null;
}

function binarizeLocal(lum, w, h) {
  const B = 8, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const black = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let sum = 0, mn = 255, mx = 0, cnt = 0;
    for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) { const v = lum[y * w + x]; sum += v; cnt++; if (v < mn) mn = v; if (v > mx) mx = v; }
    let avg = sum / cnt;
    if (mx - mn <= 24) {
      avg = mn / 2;
      if (by > 0 && bx > 0) { const nb = (black[(by - 1) * bw + bx] + 2 * black[by * bw + bx - 1] + black[(by - 1) * bw + bx - 1]) / 4; if (mn < nb) avg = nb; }
    }
    black[by * bw + bx] = avg;
  }
  const out = new Uint8Array(w * h);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let s = 0, k = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = Math.min(bh - 1, Math.max(0, by + dy)), xx = Math.min(bw - 1, Math.max(0, bx + dx)); s += black[yy * bw + xx]; k++; }
    const t = s / k;
    for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) out[y * w + x] = lum[y * w + x] <= t ? 1 : 0;
  }
  return out;
}
function binarizeGlobal(lum, w, h) {       // Otsu
  const hist = new Array(256).fill(0); for (const v of lum) hist[v]++;
  const total = lum.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break; sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; t = i; } }
  const out = new Uint8Array(total); for (let i = 0; i < total; i++) out[i] = lum[i] <= t ? 1 : 0; return out;
}

// ---- finder patterns
function ratioOK(s) {
  const total = s[0] + s[1] + s[2] + s[3] + s[4];
  if (total < 7) return false;
  const m = total / 7, v = m / 1.6;
  return Math.abs(m - s[0]) < v && Math.abs(m - s[1]) < v && Math.abs(3 * m - s[2]) < 3 * v && Math.abs(m - s[3]) < v && Math.abs(m - s[4]) < v;
}
function crossCheck(bin, w, h, cx, cy, dx, dy, maxCount) {
  // walk from (cx,cy) along ±(dx,dy) measuring the 5 runs; returns { center offset, total } or null
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? bin[(y | 0) * w + (x | 0)] : -1;
  const s = [0, 0, 0, 0, 0];
  let i = 0;
  while (at(cx - i * dx, cy - i * dy) === 1) { s[2]++; i++; }
  if (at(cx - i * dx, cy - i * dy) === -1) return null;
  while (at(cx - i * dx, cy - i * dy) === 0 && s[1] <= maxCount) { s[1]++; i++; }
  if (at(cx - i * dx, cy - i * dy) === -1 || s[1] > maxCount) return null;
  while (at(cx - i * dx, cy - i * dy) === 1 && s[0] <= maxCount) { s[0]++; i++; }
  if (s[0] > maxCount) return null;
  i = 1;
  while (at(cx + i * dx, cy + i * dy) === 1) { s[2]++; i++; }
  if (at(cx + i * dx, cy + i * dy) === -1) return null;
  const startRight = i;
  while (at(cx + i * dx, cy + i * dy) === 0 && s[3] <= maxCount) { s[3]++; i++; }
  if (at(cx + i * dx, cy + i * dy) === -1 || s[3] > maxCount) return null;
  while (at(cx + i * dx, cy + i * dy) === 1 && s[4] <= maxCount) { s[4]++; i++; }
  if (s[4] > maxCount || !ratioOK(s)) return null;
  const end = startRight + s[3] + s[4];             // pixels to the right of cx (exclusive)
  const centerOffset = end - s[4] - s[3] - s[2] / 2;
  return { offset: centerOffset, total: s.reduce((a, b) => a + b, 0) };
}

function findFinders(bin, w, h) {
  const centers = [];
  const add = (x, y, size) => {
    for (const c of centers) {
      if (Math.abs(c.x - x) <= c.size / 7 * 1.5 && Math.abs(c.y - y) <= c.size / 7 * 1.5 && Math.abs(c.size - size) < c.size * 0.5) {
        c.x = (c.x * c.count + x) / (c.count + 1); c.y = (c.y * c.count + y) / (c.count + 1); c.size = (c.size * c.count + size) / (c.count + 1); c.count++; return;
      }
    }
    centers.push({ x, y, size, count: 1 });
  };
  const step = Math.max(1, Math.floor(h / 400));
  for (let y = 0; y < h; y += step) {
    const s = [0, 0, 0, 0, 0]; let state = 0;
    for (let x = 0; x <= w; x++) {
      const v = x < w ? bin[y * w + x] : 0;
      if (v === 1) {
        if (state === 1 || state === 3) state++;
        s[state]++;
      } else {
        if (state === 0 && s[0] === 0) continue;         // skip leading white
        if (state === 1 || state === 3) { s[state]++; continue; }
        if (state === 4) {
          if (ratioOK(s)) {
            const cx = x - s[4] - s[3] - s[2] / 2;
            const total = s.reduce((a, b) => a + b, 0);
            const vc = crossCheck(bin, w, h, cx, y, 0, 1, s[2] * 2);
            if (vc) {
              const cy = y + vc.offset;
              const hc = crossCheck(bin, w, h, cx, cy, 1, 0, s[2] * 2);
              if (hc) add(cx + hc.offset, cy, (total + vc.total + hc.total) / 3);
            }
          }
          s[0] = s[2]; s[1] = s[3]; s[2] = s[4]; s[3] = 1; s[4] = 0; state = 3;
          continue;
        }
        state++; s[state]++;
      }
    }
  }
  return centers;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function orient(a, b, cc) {
  const dab = dist(a, b), dac = dist(a, cc), dbc = dist(b, cc);
  let tl, p1, p2;
  if (dbc >= dab && dbc >= dac) { tl = a; p1 = b; p2 = cc; } else if (dac >= dab && dac >= dbc) { tl = b; p1 = a; p2 = cc; } else { tl = cc; p1 = a; p2 = b; }
  const cross = (p1.x - tl.x) * (p2.y - tl.y) - (p1.y - tl.y) * (p2.x - tl.x);   // y grows downward
  const [tr, bl] = cross > 0 ? [p1, p2] : [p2, p1];
  return { tl, tr, bl };
}
/** Candidate (top-left, top-right, bottom-left) triples, best first. */
function pickTriples(cands, max = 5) {
  const c = cands.filter(p => p.count >= 2).sort((a, b) => b.count - a.count).slice(0, 12);
  const out = [];
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) for (let k = j + 1; k < c.length; k++) {
    const p = [c[i], c[j], c[k]];
    const sizes = p.map(q => q.size), smin = Math.min(...sizes), smax = Math.max(...sizes);
    if (smax > smin * 1.7) continue;
    const d = [dist(p[0], p[1]), dist(p[0], p[2]), dist(p[1], p[2])].sort((a, b) => a - b);
    if (d[0] < smin * 1.5) continue;
    const err = Math.abs(d[0] - d[1]) / d[1] + Math.abs(d[2] - Math.SQRT2 * d[1]) / d[2] + ((smax - smin) / smax) * 0.8;
    if (err > 0.8) continue;
    out.push({ err, p });
  }
  return out.sort((a, b) => a.err - b.err).slice(0, max).map(o => orient(...o.p));
}

// ---- perspective transform (unit square ↔ quad)
function squareToQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
  const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
  const a13 = (dx3 * dy2 - dx2 * dy3) / den, a23 = (dx1 * dy3 - dx3 * dy1) / den;
  return [x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0, y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0, a13, a23, 1];
}
function adjugate(m) {
  const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = m;
  return [a22 * a33 - a23 * a32, a23 * a31 - a21 * a33, a21 * a32 - a22 * a31, a13 * a32 - a12 * a33, a11 * a33 - a13 * a31, a12 * a31 - a11 * a32, a12 * a23 - a13 * a22, a13 * a21 - a11 * a23, a11 * a22 - a12 * a21];
}
function times(a, b) {
  const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = a, [b11, b21, b31, b12, b22, b32, b13, b23, b33] = b;
  return [a11 * b11 + a21 * b12 + a31 * b13, a11 * b21 + a21 * b22 + a31 * b23, a11 * b31 + a21 * b32 + a31 * b33,
    a12 * b11 + a22 * b12 + a32 * b13, a12 * b21 + a22 * b22 + a32 * b23, a12 * b31 + a22 * b32 + a32 * b33,
    a13 * b11 + a23 * b12 + a33 * b13, a13 * b21 + a23 * b22 + a33 * b23, a13 * b31 + a23 * b32 + a33 * b33];
}
/** quad (module space) → quad (image space) */
function quadToQuad(src, dst) {
  const q2s = adjugate(squareToQuad(...src));
  const s2q = squareToQuad(...dst);
  const m = times(s2q, q2s);
  return (x, y) => { const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = m; const d = a13 * x + a23 * y + a33; return [(a11 * x + a21 * y + a31) / d, (a12 * x + a22 * y + a32) / d]; };
}

function findAlignment(bin, w, h, est, ux, uy, vx, vy, module) {
  const at = (x, y) => { x = Math.round(x); y = Math.round(y); return (x >= 0 && y >= 0 && x < w && y < h) ? bin[y * w + x] : 0; };
  const R = Math.max(4, Math.round(module * 5));
  let best = null;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const cx = est.x + dx, cy = est.y + dy;
    let score = 0;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const want = Math.max(Math.abs(i), Math.abs(j)) !== 1 ? 1 : 0;
      if (at(cx + j * ux + i * vx, cy + j * uy + i * vy) === want) score++;
    }
    const d2 = dx * dx + dy * dy;
    if (!best || score > best.score || (score === best.score && d2 < best.d2)) best = { score, d2, x: cx, y: cy };
  }
  return best && best.score >= 21 ? best : null;
}

// length of the black-white-black run from a finder centre toward (and past) another point
function runBWB(bin, w, h, fx, fy, tx, ty) {
  const dx = tx - fx, dy = ty - fy, L = Math.hypot(dx, dy) || 1, sx = dx / L, sy = dy / L;
  let state = 0;
  for (let i = 0; i < L * 2; i++) {
    const x = Math.round(fx + sx * i), y = Math.round(fy + sy * i);
    if (x < 0 || y < 0 || x >= w || y >= h) return state === 2 ? i : NaN;
    const black = bin[y * w + x] === 1;
    if ((state === 1) === black) { state++; if (state === 3) return i; }
  }
  return NaN;
}
function moduleAlong(bin, w, h, a, b) {
  const fwd = runBWB(bin, w, h, a.x, a.y, b.x, b.y);
  const back = runBWB(bin, w, h, a.x, a.y, 2 * a.x - b.x, 2 * a.y - b.y);
  const s = fwd + back;
  return Number.isFinite(s) ? s / 7 : NaN;
}

function decodeBinary(bin, w, h) {
  for (const f of pickTriples(findFinders(bin, w, h))) {
    const r = decodeWithFinders(bin, w, h, f);
    if (r !== null) return r;
  }
  return null;
}
function decodeWithFinders(bin, w, h, { tl, tr, bl }) {
  const ests = [moduleAlong(bin, w, h, tl, tr), moduleAlong(bin, w, h, tr, tl), moduleAlong(bin, w, h, tl, bl), moduleAlong(bin, w, h, bl, tl)].filter(Number.isFinite);
  const module = ests.length ? ests.reduce((a, b) => a + b, 0) / ests.length : (tl.size + tr.size + bl.size) / 21;
  const est = Math.round((Math.round(dist(tl, tr) / module) + Math.round(dist(tl, bl) / module)) / 2) + 7;
  const tried = new Set();
  for (const delta of [0, 4, -4, 8, -8]) {
    let dim = est + delta;
    const r = dim % 4; dim += r === 0 ? 1 : r === 2 ? -1 : r === 3 ? -2 : 0;
    const version = (dim - 17) / 4;
    if (version < 1 || version > MAX_VERSION || tried.has(version)) continue;
    tried.add(version);
    const out = sampleAndDecode(bin, w, h, tl, tr, bl, version, true) ?? (version >= 2 ? sampleAndDecode(bin, w, h, tl, tr, bl, version, false) : null);
    if (out !== null) return out;
  }
  return null;
}

function sampleAndDecode(bin, w, h, tl, tr, bl, version, useAlignment = true) {
  const n = version * 4 + 17;
  const span = n - 7;
  const ux = (tr.x - tl.x) / span, uy = (tr.y - tl.y) / span, vx = (bl.x - tl.x) / span, vy = (bl.y - tl.y) / span;
  let br = { x: tr.x - tl.x + bl.x, y: tr.y - tl.y + bl.y }, brModule = n - 3.5;
  if (version >= 2) {
    const k = 1 - 3 / span;
    const estA = { x: tl.x + k * (br.x - tl.x), y: tl.y + k * (br.y - tl.y) };
    const a = useAlignment ? findAlignment(bin, w, h, estA, ux, uy, vx, vy, Math.hypot(ux, uy)) : null;
    br = a || estA; brModule = n - 6.5;
  }
  const map = quadToQuad([3.5, 3.5, n - 3.5, 3.5, brModule, brModule, 3.5, n - 3.5], [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const grid = Array.from({ length: n }, () => new Array(n));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const [x, y] = map(c + 0.5, r + 0.5);
    const xi = Math.round(x), yi = Math.round(y);
    grid[r][c] = (xi >= 0 && yi >= 0 && xi < w && yi < h) ? bin[yi * w + xi] === 1 : false;
  }
  return decodeGrid(grid, version);
}

function decodeGrid(grid, version) {
  const n = grid.length;
  // format info (best of both copies)
  let fmt = null;
  for (const copy of formatPositions(n)) {
    let bits = 0; copy.forEach(([r, c], i) => { if (grid[r][c]) bits |= 1 << i; });
    for (const F of FORMATS) {
      let x = F.bits ^ bits, d = 0; while (x) { d += x & 1; x >>>= 1; }
      if (!fmt || d < fmt.d) fmt = { ...F, d };
    }
  }
  if (!fmt || fmt.d > 3) return null;
  const base = baseGrid(version);
  const raw = [];
  let cur = 0, nb = 0;
  forEachDataCell(base, (r, c) => {
    let bit = grid[r][c]; if (MASKS[fmt.mask](r, c)) bit = !bit;
    cur = (cur << 1) | (bit ? 1 : 0); nb++;
    if (nb === 8) { raw.push(cur); cur = 0; nb = 0; }
  });
  const { ec, blocks } = blockLayout(version, fmt.level);
  const total = blocks.reduce((a, b) => a + b, 0) + ec * blocks.length;
  if (raw.length < total) return null;
  // de-interleave
  const bd = blocks.map(len => new Array(len + ec));
  let k = 0;
  const maxLen = Math.max(...blocks);
  for (let i = 0; i < maxLen; i++) for (let b = 0; b < blocks.length; b++) if (i < blocks[b]) bd[b][i] = raw[k++];
  for (let i = 0; i < ec; i++) for (let b = 0; b < blocks.length; b++) bd[b][blocks[b] + i] = raw[k++];
  const data = [];
  for (let b = 0; b < blocks.length; b++) { if (!rsDecode(bd[b], ec)) return null; data.push(...bd[b].slice(0, blocks[b])); }
  return parseData(data, version);
}

function parseData(data, version) {
  let pos = 0;
  const read = len => { let v = 0; for (let i = 0; i < len; i++) { const byte = data[pos >> 3]; if (byte === undefined) return null; v = (v << 1) | ((byte >> (7 - (pos & 7))) & 1); pos++; } return v; };
  const out = [];
  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  let text = '';
  for (;;) {
    if (pos + 4 > data.length * 8) break;
    const mode = read(4);
    if (mode === 0 || mode === null) break;
    if (mode === 4) {
      const len = read(version < 10 ? 8 : 16); if (len === null) return null;
      for (let i = 0; i < len; i++) { const b = read(8); if (b === null) return null; out.push(b); }
    } else if (mode === 2) {
      let len = read(version < 10 ? 9 : 11);
      for (; len >= 2; len -= 2) { const v = read(11); text += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; }
      if (len === 1) text += ALNUM[read(6)];
    } else if (mode === 1) {
      let len = read(version < 10 ? 10 : 12);
      for (; len >= 3; len -= 3) text += String(read(10)).padStart(3, '0');
      if (len === 2) text += String(read(7)).padStart(2, '0'); else if (len === 1) text += String(read(4));
    } else if (mode === 7) { read(8); }
    else return null;
    if (out.length) { text += new TextDecoder().decode(new Uint8Array(out)); out.length = 0; }
  }
  return text || null;
}

export const _test = { rsEncode, rsDecode, encodeQR, decodeGrid, baseGrid };
