// EXHIBIT 3D gallery: a clean museum room with the collector's artworks hung on the walls.
// Plain WebGL (no libraries) so it stays light on phones.
//
// Ways to move:
//   Touch:  drag anywhere to look around · the pad (bottom left) walks and turns · tap an artwork to walk up to it
//           · tap the floor to walk there. Desktop: mouse drag + WASD / arrow keys.
//   Motion: the phone is your window. Turn and tilt it to look left/right/up/down. You walk forward
//           automatically in the direction you face, slowing down at artworks. Pause/resume any time.

const EYE = 1.6, W = 9, H = 4.3, BAY = 4.4;
const WALK_AUTO = 0.85, WALK_MAX = 1.7, TURN_MAX = 1.6;
const MODE_KEY = 'ex-3d-mode';

// ------------------------------------------------------------------ math
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: a => Math.hypot(a[0], a[1], a[2]),
};
const sum = (...vs) => vs.reduce(v3.add, [0, 0, 0]);
const quat = {
  axis(ax, ang) { const s = Math.sin(ang / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)]; },
  mul(a, b) {
    return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  },
  rot(q, v) {   // rotate vector v by quaternion q
    const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  },
  // Euler (x = beta, y = alpha, z = -gamma), order YXZ, as in the W3C device-orientation model
  fromEulerYXZ(x, y, z) {
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
  },
  slerpish(a, b, t) {   // normalised lerp, good enough for smoothing sensor noise
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; const s = d < 0 ? -1 : 1;
    const o = [0, 1, 2, 3].map(i => a[i] + (b[i] * s - a[i]) * t); const l = Math.hypot(...o); return o.map(c => c / l);
  },
};
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function mat4mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function viewMatrix(q, eye) {   // inverse of (translate(eye) * rotate(q))
  const [x, y, z, w] = [-q[0], -q[1], -q[2], q[3]];
  const r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
  const t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -eye[0], -eye[1], -eye[2], 1];
  return mat4mul(r, t);
}
const yawOf = q => { const f = quat.rot(q, [0, 0, -1]); return Math.atan2(-f[0], -f[2]); };
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ------------------------------------------------------------------ procedural textures (power-of-two canvases)
function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
function noise(g, w, h, amt, alpha = 1) {
  const d = g.getImageData(0, 0, w, h), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const n = (Math.random() - .5) * amt; p[i] += n; p[i + 1] += n; p[i + 2] += n; p[i + 3] *= alpha; }
  g.putImageData(d, 0, 0);
}
const TEX = {
  white: () => canvas(4, 4, g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 4, 4); }),
  plaster: () => canvas(256, 256, (g, w, h) => { g.fillStyle = '#f4f1eb'; g.fillRect(0, 0, w, h); noise(g, w, h, 7); }),
  oak: () => canvas(1024, 1024, (g, w, h) => {
    const rows = 8, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -Math.random() * w * .6;
      while (x < w) {
        const len = w * (.35 + Math.random() * .4), l = 72 + Math.random() * 10, hue = 32 + Math.random() * 5;
        g.fillStyle = `hsl(${hue} 34% ${l}%)`; g.fillRect(x, r * rh, len, rh);
        g.globalAlpha = .07;
        for (let k = 0; k < 18; k++) { g.fillStyle = Math.random() < .5 ? '#6b4a2a' : '#fff6e6'; const yy = r * rh + Math.random() * rh; g.fillRect(x, yy, len, 1 + Math.random() * 2); }
        g.globalAlpha = .22; g.fillStyle = '#5c4026'; g.fillRect(x, r * rh, 2, rh); g.globalAlpha = 1;
        x += len;
      }
      g.fillStyle = 'rgba(80,55,30,.28)'; g.fillRect(0, r * rh, w, 2);
    }
    noise(g, w, h, 10);
  }),
  pool: () => canvas(256, 256, (g, w, h) => {   // wall wash from a ceiling spot: bright crown, soft fall-off
    const gr = g.createRadialGradient(w / 2, h * .22, 4, w / 2, h * .42, w * .55);
    gr.addColorStop(0, 'rgba(255,248,232,1)'); gr.addColorStop(.35, 'rgba(255,244,222,.55)'); gr.addColorStop(1, 'rgba(255,240,215,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }),
  disc: () => canvas(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,246,228,1)'); gr.addColorStop(1, 'rgba(255,246,228,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }),
  shadow: () => canvas(128, 128, (g, w) => { g.filter = 'blur(12px)'; g.fillStyle = '#000'; g.fillRect(26, 26, w - 52, w - 52); }),
  ao: () => canvas(4, 64, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }),
};
function textTexture(lines, { w = 512, h = 256, bg = '#fbfaf7', pad = 34 } = {}) {
  return canvas(w, h, (g) => {
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    let y = pad;
    for (const l of lines) {
      g.font = l.font; g.fillStyle = l.color || '#1b1714'; g.textBaseline = 'top'; g.textAlign = l.align || 'left';
      if (l.spacing) g.letterSpacing = l.spacing; else g.letterSpacing = '0px';
      const x = l.align === 'center' ? w / 2 : pad;
      let s = l.text; while (g.measureText(s).width > w - pad * 2 && s.length > 3) s = s.slice(0, -2).trimEnd() + '…';
      g.fillText(s, x, y + (l.dy || 0)); y += l.lh;
    }
  });
}
// Entrance wall: the EXHIBIT logo (white mark on Golden Hour sky pink) above the title.
const LOGO_PATHS = ['M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3', 'M8 8h3v3H8zM13 13h3v3h-3zM13 8h3M8 13v3h3'];
export function wallTitleTexture(hooks) {
  return canvas(1024, 512, (g, w) => {
    const cx = w / 2, cy = 92, r = 74;
    g.save(); g.shadowColor = 'rgba(200,120,90,.35)'; g.shadowBlur = 26; g.shadowOffsetY = 10;
    const gr = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r); gr.addColorStop(0, '#ebb7a0'); gr.addColorStop(1, '#dc9a84');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.restore();
    g.save(); const k = 3.9; g.translate(cx - 12 * k, cy - 12 * k); g.scale(k, k);
    g.strokeStyle = '#fff8ef'; g.lineWidth = 2; g.lineCap = 'round'; g.lineJoin = 'round';
    if (typeof Path2D === 'function') for (const d of LOGO_PATHS) g.stroke(new Path2D(d));
    g.restore();
    g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = '#2a2420';
    let title = hooks.wallTitle || 'EXHIBIT', size = 112;
    g.font = `800 ${size}px Inter, system-ui, sans-serif`; g.letterSpacing = hooks.wallTitle ? '0px' : '14px';
    while (g.measureText(title).width > w - 60 && size > 50) { size -= 6; g.font = `800 ${size}px Inter, system-ui, sans-serif`; }
    g.fillText(title, cx, 198);
    g.font = '500 30px Inter, system-ui, sans-serif'; g.letterSpacing = '8px'; g.fillStyle = '#8a7d70';
    g.fillText((hooks.wallSub || 'A private gallery of living art').toUpperCase(), cx, 340);
  });
}

async function imageTexture(url, max = 1024) {
  const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; await img.decode();
  const pot = n => 2 ** Math.round(Math.log2(n));
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const cw = clamp(pot(img.naturalWidth * s), 64, max), ch = clamp(pot(img.naturalHeight * s), 64, max);
  return { canvas: canvas(cw, ch, g => { g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, cw, ch); }), aspect: img.naturalHeight / img.naturalWidth };
}

// ------------------------------------------------------------------ WebGL
const VS = `attribute vec3 aPos; attribute vec2 aUv; attribute vec4 aCol;
uniform mat4 uVP; uniform vec3 uEye; varying vec2 vUv; varying vec4 vCol; varying float vDist;
void main(){ vUv=aUv; vCol=aCol; vDist=distance(aPos,uEye); gl_Position=uVP*vec4(aPos,1.0); }`;
const FS = `precision mediump float;
uniform sampler2D uTex; uniform vec3 uFog; uniform vec2 uFogRange; uniform float uFogAmt; uniform float uSheen; uniform float uTime;
varying vec2 vUv; varying vec4 vCol; varying float vDist;
void main(){
  vec4 t = texture2D(uTex, vUv) * vCol;
  if (uSheen > 0.0) {   // faint glass glare drifting across framed works
    float b = fract(vUv.x * 0.55 + vUv.y * 0.35 - uTime * 0.045);
    t.rgb += uSheen * 0.07 * smoothstep(0.1, 0.0, abs(b - 0.5)) + uSheen * 0.025 * (vUv.y);
  }
  float f = smoothstep(uFogRange.x, uFogRange.y, vDist) * uFogAmt;
  gl_FragColor = vec4(mix(t.rgb, uFog, f), t.a);
}`;

function makeGL(cv) {
  const gl = cv.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' }) || cv.getContext('experimental-webgl');
  if (!gl) throw new Error('webgl');
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  gl.useProgram(pr);
  const loc = n => gl.getUniformLocation(pr, n);
  return { gl, pr, u: { vp: loc('uVP'), eye: loc('uEye'), tex: loc('uTex'), fog: loc('uFog'), fogRange: loc('uFogRange'), fogAmt: loc('uFogAmt'), sheen: loc('uSheen'), time: loc('uTime') },
    a: { pos: gl.getAttribLocation(pr, 'aPos'), uv: gl.getAttribLocation(pr, 'aUv'), col: gl.getAttribLocation(pr, 'aCol') } };
}
function uploadTexture(gl, src, repeat = false) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  const ext = gl.getExtension('EXT_texture_filter_anisotropic');
  if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  return t;
}

// Geometry is collected into batches (one per texture + blend pass), then uploaded once.
class Scene {
  constructor() { this.batches = new Map(); }
  batch(tex, pass = 'opaque', sheen = 0) {
    const k = `${tex}|${pass}|${sheen}`;
    if (!this.batches.has(k)) this.batches.set(k, { tex, pass, sheen, v: [], i: [] });
    return this.batches.get(k);
  }
  /** Quad centred at c, spanning ±u (width) and ±v (height). col: [r,g,b,a] or {top, bottom}. */
  quad(tex, c, u, v, col = [1, 1, 1, 1], uv = [0, 0, 1, 1], pass = 'opaque', sheen = 0) {
    const b = this.batch(tex, pass, sheen), n = b.v.length / 9;
    const top = col.top || col, bot = col.bottom || col;
    const P = [[v3.sub(v3.sub(c, u), v), uv[0], uv[1], bot], [v3.sub(v3.add(c, u), v), uv[2], uv[1], bot], [v3.add(v3.add(c, u), v), uv[2], uv[3], top], [v3.add(v3.sub(c, u), v), uv[0], uv[3], top]];
    for (const [p, s, t, k] of P) b.v.push(p[0], p[1], p[2], s, t, k[0], k[1], k[2], k[3] ?? 1);
    b.i.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  box(c, h, col, shade = { top: 1.06, side: .9, front: .96 }) {   // axis-aligned box, half sizes h
    const s = (k) => [col[0] * k, col[1] * k, col[2] * k, 1];
    const [x, y, z] = c, [a, b, d] = h;
    this.quad('white', [x, y + b, z], [a, 0, 0], [0, 0, -d], s(shade.top));
    this.quad('white', [x, y - b, z], [a, 0, 0], [0, 0, d], s(.7));
    this.quad('white', [x, y, z + d], [a, 0, 0], [0, b, 0], s(shade.front));
    this.quad('white', [x, y, z - d], [-a, 0, 0], [0, b, 0], s(shade.front * .92));
    this.quad('white', [x + a, y, z], [0, 0, -d], [0, b, 0], s(shade.side));
    this.quad('white', [x - a, y, z], [0, 0, d], [0, b, 0], s(shade.side * .95));
  }
}

// ------------------------------------------------------------------ the room
function layout(n) {
  const side = Math.max(0, n - 1), perSide = Math.ceil(side / 2);
  const L = Math.max(n <= 1 ? 9.5 : 12, 5 + perSide * BAY + 3.5);
  const z0 = 2.2, zEnd = z0 - L;
  const walls = {
    left: { n: [1, 0, 0], u: [0, 0, -1], at: z => [-W / 2, 0, z] },
    right: { n: [-1, 0, 0], u: [0, 0, 1], at: z => [W / 2, 0, z] },
    end: { n: [0, 0, 1], u: [1, 0, 0], at: x => [x, 0, zEnd] },
    entry: { n: [0, 0, -1], u: [-1, 0, 0], at: x => [x, 0, z0] },
  };
  const slots = [];
  if (n >= 1) slots.push({ wall: 'end', pos: walls.end.at(0), featured: true });
  for (let i = 0; i < side; i++) {
    const w = i % 2 === 0 ? 'left' : 'right', k = Math.floor(i / 2);
    slots.push({ wall: w, pos: walls[w].at(-2.6 - k * BAY) });
  }
  return { L, z0, zEnd, walls, slots };
}

function buildRoom(S, lay, pieces, textures) {
  const { z0, zEnd, walls, L } = lay, zc = (z0 + zEnd) / 2, hl = L / 2;
  const wallCol = k => ({ top: [k, k, k * .995, 1], bottom: [k * .83, k * .82, k * .8, 1] });
  // floor, ceiling, walls
  S.quad('oak', [0, 0, zc], [W / 2, 0, 0], [0, 0, -hl], [.9, .88, .85, 1], [0, 0, W / 3.2, L / 3.2]);
  S.quad('white', [0, H, zc], [W / 2, 0, 0], [0, 0, hl], [.95, .945, .935, 1]);
  const tile = (wd) => [0, 0, wd / 3, H / 3];
  S.quad('plaster', [-W / 2, H / 2, zc], [0, 0, -hl], [0, H / 2, 0], wallCol(.99), tile(L));
  S.quad('plaster', [W / 2, H / 2, zc], [0, 0, hl], [0, H / 2, 0], wallCol(.95), tile(L));
  S.quad('plaster', [0, H / 2, zEnd], [W / 2, 0, 0], [0, H / 2, 0], wallCol(1.0), tile(W));
  S.quad('plaster', [0, H / 2, z0], [-W / 2, 0, 0], [0, H / 2, 0], wallCol(.93), tile(W));
  // baseboards + corner shading
  for (const w of Object.values(walls)) {
    const span = w === walls.left || w === walls.right ? hl : W / 2;
    const mid = w === walls.left || w === walls.right ? w.at(zc) : w.at(0);
    S.quad('white', sum(mid, [0, .05, 0], v3.mul(w.n, .012)), v3.mul(w.u, span), [0, .05, 0], [.9, .895, .885, 1]);
    S.quad('white', sum(mid, [0, .1, 0], v3.mul(w.n, .006)), v3.mul(w.u, span), [0, 0, 0].map((_, i) => w.n[i] * .006), [.78, .77, .76, 1]);
    S.quad('ao', sum(mid, [0, .45, 0], v3.mul(w.n, .004)), v3.mul(w.u, span), [0, .45, 0], [0, 0, 0, .13], [0, 0, 1, 1], 'blend');
    S.quad('ao', sum(mid, [0, .002, 0], v3.mul(w.n, .35)), v3.mul(w.u, span), v3.mul(w.n, -.35), [0, 0, 0, .1], [0, 0, 1, 1], 'blend');
    S.quad('ao', sum(mid, [0, H - .3, 0], v3.mul(w.n, .004)), v3.mul(w.u, span), [0, -.3, 0], [0, 0, 0, .06], [0, 0, 1, 1], 'blend');
  }
  // ceiling: skylight, light tracks and spots
  S.quad('white', [0, H - .004, zc], [.85, 0, 0], [0, 0, hl - 1.2], [1, 1, 1, 1]);
  for (const x of [-.88, .88]) S.quad('white', [x, H - .006, zc], [.03, 0, 0], [0, 0, hl - 1.15], [.82, .82, .8, 1]);
  for (const x of [-2.7, 2.7]) S.quad('white', [x, H - .01, zc], [.016, 0, 0], [0, 0, hl - .6], [.62, .6, .58, 1]);
  S.quad('white', [0, H - .01, zEnd + 1.6], [W / 2 - .6, 0, 0], [0, 0, .016], [.62, .6, .58, 1]);
  // wall lettering
  S.quad('title', sum(walls.entry.at(0), [0, 2.65, 0], [0, 0, -.004]), [-1.6, 0, 0], [0, .8, 0], [1, 1, 1, 1], [0, 0, 1, 1], 'blend');

  // artworks
  pieces.forEach((p, i) => {
    const slot = lay.slots[i]; if (!slot) return;
    const w = walls[slot.wall], u = w.u, n = w.n, up = [0, 1, 0];
    const maxW = slot.featured ? 2.5 : 1.85, maxH = slot.featured ? 1.85 : 1.5;
    let hw = maxW / 2, hh = hw * p.aspect; if (hh > maxH / 2) { hh = maxH / 2; hw = hh / p.aspect; }
    const cy = slot.featured ? 1.85 : 1.68, mat = slot.featured ? .14 : .11, fr = .045, d = .05;
    const P = sum(slot.pos, [0, cy, 0]);
    const ow = hw + mat + fr, oh = hh + mat + fr;
    p.world = { P, n, u, hw, hh, ow, oh };
    // spotlight fixture above
    const fx = sum(slot.pos, [0, H - .12, 0], v3.mul(n, 1.6));
    S.box([fx[0], fx[1], fx[2]], [.06, .1, .06], [.16, .15, .14]);
    S.quad('white', sum(fx, [0, -.1, 0]), [.045, 0, 0], [0, 0, .045], [1, .98, .9, 1]);
    // light wash on the wall + pool on the floor
    S.quad('pool', sum(P, v3.mul(n, .003), [0, oh * .55, 0]), v3.mul(u, ow * 1.8), [0, oh * 1.9, 0], [1, .97, .9, p.locked ? .2 : .42], [0, 0, 1, 1], 'add');
    S.quad('disc', sum(slot.pos, [0, .003, 0], v3.mul(n, 1.1)), v3.mul(u, ow * 1.3), v3.mul(n, .9), [1, .97, .9, .13], [0, 0, 1, 1], 'add');
    // drop shadow
    S.quad('shadow', sum(P, v3.mul(n, .004), [0, -.05, 0]), v3.mul(u, ow + .16), [0, oh + .18, 0], [0, 0, 0, .55], [0, 0, 1, 1], 'blend');
    // frame: sides
    const fcol = [.11, .1, .095, 1], fside = [.07, .065, .06, 1];
    S.quad('white', sum(P, v3.mul(up, oh), v3.mul(n, d / 2)), v3.mul(u, ow), v3.mul(n, d / 2), [.2, .19, .18, 1]);
    S.quad('white', sum(P, v3.mul(up, -oh), v3.mul(n, d / 2)), v3.mul(u, ow), v3.mul(n, -d / 2), fside);
    S.quad('white', sum(P, v3.mul(u, -ow), v3.mul(n, d / 2)), v3.mul(n, d / 2), v3.mul(up, oh), fside);
    S.quad('white', sum(P, v3.mul(u, ow), v3.mul(n, d / 2)), v3.mul(n, -d / 2), v3.mul(up, oh), fside);
    // frame: front ring
    S.quad('white', sum(P, v3.mul(up, hh + mat + fr / 2), v3.mul(n, d)), v3.mul(u, ow), v3.mul(up, fr / 2), fcol);
    S.quad('white', sum(P, v3.mul(up, -(hh + mat + fr / 2)), v3.mul(n, d)), v3.mul(u, ow), v3.mul(up, fr / 2), fcol);
    S.quad('white', sum(P, v3.mul(u, -(hw + mat + fr / 2)), v3.mul(n, d)), v3.mul(u, fr / 2), v3.mul(up, hh + mat), fcol);
    S.quad('white', sum(P, v3.mul(u, hw + mat + fr / 2), v3.mul(n, d)), v3.mul(u, fr / 2), v3.mul(up, hh + mat), fcol);
    // mat (passe-partout) with a hint of bevel, then the artwork itself
    S.quad('white', sum(P, v3.mul(n, d - .012)), v3.mul(u, hw + mat), v3.mul(up, hh + mat), { top: [.99, .985, .975, 1], bottom: [.93, .925, .915, 1] });
    S.quad('white', sum(P, v3.mul(n, d - .011)), v3.mul(u, hw + .006), v3.mul(up, hh + .006), [.8, .79, .77, 1]);
    S.quad(`art${i}`, sum(P, v3.mul(n, d - .009)), v3.mul(u, hw), v3.mul(up, hh), p.locked ? [.55, .55, .55, 1] : [1, 1, 1, 1], [0, 0, 1, 1], 'opaque', p.locked ? 0 : 1);
    // wall label, to the right of the frame
    const lp = sum(P, v3.mul(u, ow + .34), [0, -oh + .2, 0], v3.mul(n, .008));
    S.quad('white', sum(lp, v3.mul(n, -.004)), v3.mul(u, .175), [0, .09, 0], [.85, .84, .82, 1]);
    S.quad(`label${i}`, lp, v3.mul(u, .17), [0, .085, 0]);
  });
  return textures;
}

// ------------------------------------------------------------------ public entry
/**
 * pieces: [{ key, title, artist, year, edition, imageURL, preview?, locked? }]
 * hooks: { onOpen(piece), onExit(), toast(msg) }
 * Returns a handle { pause(), resume(), close() } or throws if WebGL is unavailable.
 */
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function openGallery3D(pieces, hooks = {}) {
  const root = document.createElement('div');
  root.className = 'g3d'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', '3D gallery');
  root.innerHTML = `
    <canvas class="g3d-canvas"></canvas><div class="g3d-vignette"></div>
    <div class="g3d-top">
      <button class="icon-btn icon-btn-glass" data-g="exit" aria-label="Leave the 3D gallery"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="g3d-title"><b>${escH(hooks.title || 'Your collection')}</b><span>${escH(hooks.subtitle || `${pieces.filter(p => !p.locked).length} work${pieces.filter(p => !p.locked).length === 1 ? '' : 's'} on view`)}</span></div>
      <div class="g3d-seg" role="group" aria-label="How to move">
        <button data-g="mode-touch" aria-label="Touch controls"><svg viewBox="0 0 24 24"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.6-2.2L4.3 15a1.5 1.5 0 0 1 2.3-1.9L9 15.5"/></svg></button>
        <button data-g="mode-motion" aria-label="Motion controls"><svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2M3 9c-.8 1.9-.8 4.1 0 6M21 9c.8 1.9.8 4.1 0 6"/></svg></button>
      </div>
    </div>
    <div class="g3d-hint" aria-live="polite"></div>
    <div class="g3d-plaque" hidden><div class="g3d-plaque-text"></div><div class="g3d-plaque-actions"></div></div>
    <div class="g3d-joy" aria-hidden="true"><span class="g3d-knob"></span></div>
    <button class="g3d-play" data-g="play" aria-label="Pause walking" hidden>
      <svg class="i-pause" viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg><svg class="i-play" viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>
    </button>
    <button class="g3d-recenter icon-btn icon-btn-glass" data-g="recenter" aria-label="Face forward" hidden><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>
    <div class="g3d-intro">
      <div class="g3d-intro-card">
        <div class="eyebrow">3D Gallery</div>
        <h2>${escH(hooks.introTitle || 'Step inside your collection')}</h2>
        <p>Choose how you'd like to move around the room.</p>
        <div class="g3d-choices">
          <button class="g3d-choice" data-g="pick-touch"><svg viewBox="0 0 24 24"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.6-2.2L4.3 15a1.5 1.5 0 0 1 2.3-1.9L9 15.5"/></svg><b>Touch</b><span>Drag to look, use the pad to walk, tap a work to visit it</span></button>
          <button class="g3d-choice" data-g="pick-motion"><svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2M3 9c-.8 1.9-.8 4.1 0 6M21 9c.8 1.9.8 4.1 0 6"/></svg><b>Move your phone</b><span>Look around by moving your phone. You walk forward on your own. Pause any time.</span></button>
        </div>
      </div>
    </div>
    <div class="g3d-loading"><span class="g3d-spin"></span>Hanging your artworks…</div>`;
  document.body.appendChild(root);
  document.body.classList.add('g3d-choosing');   // keep the tab bar usable until a way of moving is picked
  const $ = s => root.querySelector(s);
  const cv = $('.g3d-canvas');

  let G;
  try { G = makeGL(cv); } catch (e) { document.body.classList.remove('g3d-choosing'); root.remove(); throw e; }
  const { gl } = G;

  // textures
  const lay = layout(pieces.length);
  const srcs = { white: TEX.white(), plaster: TEX.plaster(), oak: TEX.oak(), pool: TEX.pool(), disc: TEX.disc(), shadow: TEX.shadow(), ao: TEX.ao(),
    title: wallTitleTexture(hooks) };
  await Promise.all(pieces.map(async (p, i) => {
    try { const t = await imageTexture(p.imageURL); srcs[`art${i}`] = t.canvas; p.aspect = t.aspect; }
    catch { srcs[`art${i}`] = TEX.plaster(); p.aspect = .75; }
    const sub = p.locked ? 'Locked · unlock with its poster' : p.preview ? 'NFC preview · temporary' : [p.artist, p.year].filter(Boolean).join(', ');
    srcs[`label${i}`] = textTexture([
      { text: p.locked ? (p.title || 'Still to discover') : p.title, font: '700 40px Inter, system-ui, sans-serif', lh: 56 },
      { text: sub, font: '400 24px Inter, system-ui, sans-serif', lh: 36, color: '#5e544b' },
      { text: p.edition || '', font: '500 20px Inter, system-ui, sans-serif', lh: 30, color: '#9a8c7e', spacing: '2px' },
    ]);
  }));
  const S = new Scene();
  buildRoom(S, lay, pieces, srcs);
  const glTex = {};
  for (const [k, c] of Object.entries(srcs)) glTex[k] = uploadTexture(gl, c, k === 'oak' || k === 'plaster');
  const draws = [];
  for (const b of S.batches.values()) {
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.v), gl.STATIC_DRAW);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(b.i), gl.STATIC_DRAW);
    draws.push({ vb, ib, n: b.i.length, tex: glTex[b.tex], pass: b.pass, sheen: b.sheen });
  }
  const order = { opaque: 0, blend: 1, add: 2 }; draws.sort((a, b) => order[a.pass] - order[b.pass]);
  $('.g3d-loading').remove();

  // ---------------- camera state
  const bounds = { x0: -W / 2 + .55, x1: W / 2 - .55, z0: lay.zEnd + .7, z1: lay.z0 - .45 };
  const cam = { pos: [0, EYE, lay.z0 - 1.2], yaw: 0, pitch: -.02, q: [0, 0, 0, 1] };
  let mode = 'touch', paused = false, running = true, raf = 0, last = performance.now(), visible = true;
  const input = { joy: null, keys: new Set(), lookDrag: null };
  let glide = null;               // { from, to, yawFrom, yawTo, t0, dur }
  let dev = null, devSmooth = null, yawOffset = 0, gotMotion = false, blockedFor = 0;

  const setCamQ = () => { cam.q = quat.mul(quat.axis([0, 1, 0], cam.yaw), quat.axis([1, 0, 0], cam.pitch)); };
  setCamQ();

  // ---------------- motion (gyro)
  const screenAngle = () => ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * Math.PI / 180;
  const Q1 = [-Math.sqrt(.5), 0, 0, Math.sqrt(.5)];   // camera looks out of the back of the phone
  const onOrient = e => {
    if (e.alpha == null && e.beta == null) return;
    const d2r = Math.PI / 180;
    let q = quat.fromEulerYXZ((e.beta || 0) * d2r, (e.alpha || 0) * d2r, -(e.gamma || 0) * d2r);
    q = quat.mul(q, Q1); q = quat.mul(q, quat.axis([0, 0, 1], -screenAngle()));
    if (!gotMotion) { gotMotion = true; yawOffset = cam.yaw - yawOf(q); }
    dev = q;
  };
  async function enableMotion() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') throw new Error('denied');
      }
    } catch { hooks.toast?.('Motion access was blocked. Allow "Motion & Orientation" for this site to use it.'); return false; }
    gotMotion = false; dev = null; devSmooth = null;
    addEventListener('deviceorientation', onOrient);
    await new Promise(r => setTimeout(r, 1200));
    if (!gotMotion) { removeEventListener('deviceorientation', onOrient); hooks.toast?.('This device has no motion sensor. Using touch controls.'); return false; }
    return true;
  }
  function disableMotion() { removeEventListener('deviceorientation', onOrient); dev = null; devSmooth = null; }

  async function setMode(m, fromIntro = false) {
    if (m === 'motion' && !(await enableMotion())) m = 'touch';
    if (m === 'touch' && mode === 'motion') { disableMotion(); const yw = yawOf(cam.q); cam.yaw = yw; cam.pitch = 0; setCamQ(); }
    mode = m; paused = false;
    try { localStorage.setItem(MODE_KEY, m); } catch {}
    root.dataset.mode = m;
    $('[data-g=mode-touch]').setAttribute('aria-pressed', m === 'touch');
    $('[data-g=mode-motion]').setAttribute('aria-pressed', m === 'motion');
    $('.g3d-play').hidden = m !== 'motion'; $('.g3d-recenter').hidden = m !== 'motion';
    paintPlay();
    hint(m === 'motion' ? 'Move your phone to look around. You\'ll walk forward on your own. Tap ❚❚ to stop.' : (matchMedia('(pointer: fine)').matches ? 'Drag to look around · W A S D or arrow keys to walk · click a work to visit it' : 'Drag to look around · use the pad to walk · tap a work to visit it'), fromIntro ? 5200 : 3600);
  }
  function paintPlay() { const b = $('.g3d-play'); b.classList.toggle('paused', paused); b.setAttribute('aria-label', paused ? 'Resume walking' : 'Pause walking'); }
  let hintT = 0;
  function hint(t, ms = 3200) { const h = $('.g3d-hint'); h.textContent = t; h.classList.toggle('on', !!t); clearTimeout(hintT); if (t) hintT = setTimeout(() => h.classList.remove('on'), ms); }

  // ---------------- picking
  function rayFrom(x, y) {
    const r = cv.getBoundingClientRect(), a = r.width / r.height, t = Math.tan(fov() / 2);
    const d = [((x - r.left) / r.width * 2 - 1) * t * a, (1 - (y - r.top) / r.height * 2) * t, -1];
    const dir = quat.rot(cam.q, d), l = v3.len(dir); return dir.map(c => c / l);
  }
  function pick(dir) {
    let best = null;
    pieces.forEach((p, i) => {
      const w = p.world; if (!w) return;
      const denom = v3.dot(dir, w.n); if (denom > -1e-4) return;
      const t = v3.dot(v3.sub(w.P, cam.pos), w.n) / denom; if (t <= 0) return;
      const hit = v3.add(cam.pos, v3.mul(dir, t)), rel = v3.sub(hit, w.P);
      if (Math.abs(v3.dot(rel, w.u)) <= w.ow + .25 && Math.abs(rel[1]) <= w.oh + .25 && (!best || t < best.t)) best = { t, i, p };
    });
    return best;
  }
  function standIn(p) {
    const w = p.world, a = cv.clientWidth / Math.max(1, cv.clientHeight), tv = Math.tan(fov() / 2), th = tv * a;
    const dist = clamp(Math.max((w.ow + .5) / th, (w.oh + .35) / tv) * 1.12, 1.8, 5.4);
    const to = v3.add(w.P, v3.mul(w.n, dist)); to[1] = EYE;
    to[0] = clamp(to[0], bounds.x0, bounds.x1); to[2] = clamp(to[2], bounds.z0, bounds.z1);
    const yawTo = Math.atan2(w.n[0], w.n[2]);
    startGlide(to, yawTo, -.02 + Math.atan2(w.P[1] - EYE, dist) * .7);
    if (mode === 'motion') { paused = true; paintPlay(); }
    showPlaque(p, true);
  }
  function startGlide(to, yawTo = null, pitchTo = null) {
    const from = cam.pos.slice(), dist = v3.len(v3.sub(to, from));
    let yf = cam.yaw, yt = yawTo ?? cam.yaw; while (yt - yf > Math.PI) yt -= Math.PI * 2; while (yt - yf < -Math.PI) yt += Math.PI * 2;
    glide = { from, to, yawFrom: yf, yawTo: mode === 'touch' ? yt : null, pitchFrom: cam.pitch, pitchTo: mode === 'touch' ? (pitchTo ?? cam.pitch) : null, t0: performance.now(), dur: clamp(dist / 1.6, .6, 2.6) * 1000 };
  }

  // ---------------- plaque card
  let plaqueFor = null, plaqueSticky = 0;
  function showPlaque(p, sticky = false) {
    if (sticky) plaqueSticky = performance.now() + 2500;
    if (plaqueFor === p) return;
    plaqueFor = p;
    const el = $('.g3d-plaque');
    if (!p) { el.classList.remove('on'); setTimeout(() => { if (!plaqueFor) el.hidden = true; }, 250); return; }
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    $('.g3d-plaque-text').innerHTML = p.locked
      ? `<b>${esc(p.title || 'Still to discover')}</b><span>Locked · unlock it with its poster's QR code</span>`
      : `<b>${esc(p.title)}</b><span>${esc([p.artist, p.year].filter(Boolean).join(' · '))}</span>${p.edition ? `<em>${esc(p.edition)}</em>` : ''}`;
    $('.g3d-plaque-actions').innerHTML = (p.favKey ? `<button class="g3d-heart" data-g="like" aria-pressed="${!!hooks.isLiked?.(p)}" aria-label="Like"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg></button>` : '')
      + (p.locked ? '<button class="btn btn-gold btn-small" data-g="open">Unlock</button>' : `<button class="btn btn-gold btn-small" data-g="open">${escH(p.openLabel || 'View live')}</button>`);
    el.hidden = false; requestAnimationFrame(() => el.classList.add('on'));
  }

  // ---------------- input: pointer (look, tap), joystick, keys
  const joy = $('.g3d-joy'), knob = $('.g3d-knob');
  const pointers = new Map();
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: 0 });
  });
  cv.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; p.moved += Math.abs(dx) + Math.abs(dy);
    const k = 2.4 / Math.max(innerWidth, innerHeight) * (fov() / 1.1);
    if (mode === 'touch') { cam.yaw += dx * k * 1.6; cam.pitch = clamp(cam.pitch + dy * k * 1.3, -1.1, 1.1); setCamQ(); glide && (glide.yawTo = null, glide.pitchTo = null); }
    else yawOffset += dx * k * 1.6;   // in motion mode, a horizontal drag nudges where "forward" is
  });
  const up = e => {
    const p = pointers.get(e.pointerId); pointers.delete(e.pointerId); if (!p) return;
    if (p.moved < 10 && performance.now() - p.t0 < 450) onTap(e.clientX, e.clientY);
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', e => pointers.delete(e.pointerId));
  function onTap(x, y) {
    const dir = rayFrom(x, y), hit = pick(dir);
    if (hit) return standIn(hit.p);
    if (dir[1] < -.05) {   // floor
      const t = -cam.pos[1] / dir[1], to = v3.add(cam.pos, v3.mul(dir, t)); to[1] = EYE;
      to[0] = clamp(to[0], bounds.x0, bounds.x1); to[2] = clamp(to[2], bounds.z0, bounds.z1);
      startGlide(to);
    }
  }
  joy.addEventListener('pointerdown', e => { joy.setPointerCapture(e.pointerId); input.joy = { id: e.pointerId, x: 0, y: 0 }; moveJoy(e); joy.classList.add('on'); });
  joy.addEventListener('pointermove', e => { if (input.joy?.id === e.pointerId) moveJoy(e); });
  const joyEnd = () => { input.joy = null; knob.style.transform = ''; joy.classList.remove('on'); };
  joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);
  function moveJoy(e) {
    const r = joy.getBoundingClientRect(), R = r.width / 2;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R); const l = Math.hypot(dx, dy), m = R * .62;
    if (l > m) { dx *= m / l; dy *= m / l; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.joy.x = dx / m; input.joy.y = dy / m; glide = null;
  }
  const onKey = e => {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(k)) { e.preventDefault(); if (e.type === 'keydown') { input.keys.add(k); glide = null; } else input.keys.delete(k); }
    if (e.type === 'keydown' && k === ' ' && mode === 'motion') { paused = !paused; paintPlay(); }
  };
  addEventListener('keydown', onKey); addEventListener('keyup', onKey);

  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-g]'); if (!b) return;
    const g = b.dataset.g;
    if (g === 'exit') close();
    if (g === 'pick-touch' || g === 'pick-motion') { document.body.classList.remove('g3d-choosing'); $('.g3d-intro').classList.add('gone'); setTimeout(() => $('.g3d-intro')?.remove(), 400); await setMode(g === 'pick-motion' ? 'motion' : 'touch', true); }
    if (g === 'mode-touch' && mode !== 'touch') setMode('touch');
    if (g === 'mode-motion' && mode !== 'motion') setMode('motion');
    if (g === 'play') { paused = !paused; paintPlay(); blockedFor = 0; }
    if (g === 'recenter' && dev) { yawOffset = -yawOf(devSmooth || dev); hint('Facing into the room', 1600); }
    if (g === 'open' && plaqueFor) hooks.onOpen?.(plaqueFor);
    if (g === 'like' && plaqueFor) { const on = hooks.onLike?.(plaqueFor); b.setAttribute('aria-pressed', !!on); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); hint(on ? '♥ Added to your likes' : 'Removed from your likes', 1400); }
  });
  // remember the last choice
  try { const last = localStorage.getItem(MODE_KEY); if (last) root.querySelector(`[data-g=pick-${last}]`)?.classList.add('last'); } catch {}

  // ---------------- frame loop
  const fov = () => { const r = cv.clientWidth / Math.max(1, cv.clientHeight); return r < 1 ? 1.32 : 1.02; };
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }
  function collide(nx, nz) {
    const x = clamp(nx, bounds.x0, bounds.x1), z = clamp(nz, bounds.z0, bounds.z1);
    return { x, z, blocked: Math.abs(x - nx) + Math.abs(z - nz) > 1e-4 };
  }
  function step(dt, now) {
    // orientation
    if (mode === 'motion' && dev) {
      devSmooth = devSmooth ? quat.slerpish(devSmooth, dev, Math.min(1, dt * 14)) : dev;
      cam.q = quat.mul(quat.axis([0, 1, 0], yawOffset), devSmooth);
    } else if (mode === 'touch') {
      let turn = 0;
      if (input.joy) turn -= input.joy.x * TURN_MAX * Math.min(1, Math.abs(input.joy.x) * 1.4);
      if (input.keys.has('arrowleft') || input.keys.has('q')) turn += TURN_MAX; if (input.keys.has('arrowright') || input.keys.has('e')) turn -= TURN_MAX;
      if (turn) { cam.yaw += turn * dt; setCamQ(); }
    }
    // movement
    const f = quat.rot(cam.q, [0, 0, -1]); let fx = f[0], fz = f[2]; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const rx = -fz, rz = fx;
    let fwd = 0, strafe = 0;
    if (glide) {
      const t = Math.min(1, (now - glide.t0) / glide.dur), e = ease(t);
      cam.pos = v3.add(glide.from, v3.mul(v3.sub(glide.to, glide.from), e));
      if (glide.yawTo != null) { cam.yaw = glide.yawFrom + (glide.yawTo - glide.yawFrom) * e; }
      if (glide.pitchTo != null) { cam.pitch = glide.pitchFrom + (glide.pitchTo - glide.pitchFrom) * e; }
      if (mode === 'touch') setCamQ();
      if (t >= 1) glide = null;
      return;
    }
    if (mode === 'touch') {
      if (input.joy) fwd -= input.joy.y * WALK_MAX;
      if (input.keys.has('w') || input.keys.has('arrowup')) fwd += WALK_MAX * 1.2; if (input.keys.has('s') || input.keys.has('arrowdown')) fwd -= WALK_MAX;
      if (input.keys.has('a')) strafe -= WALK_MAX; if (input.keys.has('d')) strafe += WALK_MAX;
    } else if (mode === 'motion' && !paused && dev) {
      // stroll; slow right down while looking at a nearby artwork
      const look = pick(f); const near = look && look.t < 4.2 && !look.p.locked;
      fwd = WALK_AUTO * (near ? .25 : 1);
    }
    if (fwd || strafe) {
      const nx = cam.pos[0] + (fx * fwd + rx * strafe) * dt, nz = cam.pos[2] + (fz * fwd + rz * strafe) * dt;
      const c = collide(nx, nz); cam.pos[0] = c.x; cam.pos[2] = c.z;
      if (mode === 'motion') {
        blockedFor = c.blocked && Math.abs(nx - c.x) + Math.abs(nz - c.z) > WALK_AUTO * dt * .6 ? blockedFor + dt : 0;
        if (blockedFor > .8 && blockedFor - dt <= .8) hint('Turn around to keep walking', 2200);
      }
    }
    cam.pos[1] = EYE + (fwd ? Math.sin(now / 240) * .012 : 0);   // tiny head bob while walking
  }
  function render(now) {
    resize();
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(.94, .93, .91, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    const vp = mat4mul(perspective(fov(), cv.width / Math.max(1, cv.height), .05, 90), viewMatrix(cam.q, cam.pos));
    gl.uniformMatrix4fv(G.u.vp, false, new Float32Array(vp));
    gl.uniform3fv(G.u.eye, cam.pos); gl.uniform3f(G.u.fog, .94, .93, .91); gl.uniform2f(G.u.fogRange, 9, 48); gl.uniform1f(G.u.time, now / 1000);
    gl.uniform1i(G.u.tex, 0); gl.activeTexture(gl.TEXTURE0);
    let pass = null;
    for (const d of draws) {
      if (d.pass !== pass) {
        pass = d.pass;
        if (pass === 'opaque') { gl.disable(gl.BLEND); gl.depthMask(true); gl.uniform1f(G.u.fogAmt, .4); }
        if (pass === 'blend') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.uniform1f(G.u.fogAmt, 0); }
        if (pass === 'add') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false); gl.uniform1f(G.u.fogAmt, 0); }
      }
      gl.uniform1f(G.u.sheen, d.sheen);
      gl.bindTexture(gl.TEXTURE_2D, d.tex);
      gl.bindBuffer(gl.ARRAY_BUFFER, d.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, d.ib);
      gl.enableVertexAttribArray(G.a.pos); gl.vertexAttribPointer(G.a.pos, 3, gl.FLOAT, false, 36, 0);
      gl.enableVertexAttribArray(G.a.uv); gl.vertexAttribPointer(G.a.uv, 2, gl.FLOAT, false, 36, 12);
      gl.enableVertexAttribArray(G.a.col); gl.vertexAttribPointer(G.a.col, 4, gl.FLOAT, false, 36, 20);
      gl.drawElements(gl.TRIANGLES, d.n, gl.UNSIGNED_SHORT, 0);
    }
    gl.depthMask(true);
  }
  function frame(now) {
    if (!running) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    step(dt, now);
    // auto plaque: the work in the middle of the view, if close enough
    if (now > plaqueSticky) { const h = pick(quat.rot(cam.q, [0, 0, -1])); showPlaque(h && h.t < 5.5 ? h.p : null); }
    render(now);
    raf = requestAnimationFrame(frame);
  }
  const onVis = () => { visible = !document.hidden; if (visible && running) { last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } else cancelAnimationFrame(raf); };
  document.addEventListener('visibilitychange', onVis);
  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); if (closed) return; running = false; hooks.toast?.('The 3D view was interrupted. Open it again to continue.'); close(); });

  root.dataset.mode = 'touch';
  requestAnimationFrame(() => root.classList.add('in'));
  raf = requestAnimationFrame(frame);

  let closed = false;
  function close() {
    if (closed) return; closed = true;
    document.body.classList.remove('g3d-choosing');
    running = false; cancelAnimationFrame(raf); disableMotion();
    removeEventListener('keydown', onKey); removeEventListener('keyup', onKey);
    document.removeEventListener('visibilitychange', onVis);
    root.classList.remove('in');
    setTimeout(() => { for (const t of Object.values(glTex)) gl.deleteTexture(t); for (const d of draws) { gl.deleteBuffer(d.vb); gl.deleteBuffer(d.ib); } gl.getExtension('WEBGL_lose_context')?.loseContext(); root.remove(); }, 320);
    hooks.onExit?.();
  }
  return {
    pause() { running = false; cancelAnimationFrame(raf); if (mode === 'motion') { paused = true; paintPlay(); } },
    resume() { if (closed || running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
    close,
    get state() { return { mode, paused, pos: cam.pos.slice(), yaw: yawOf(cam.q), pieces: pieces.length }; },
    _debug: { setMode, tap: onTap, standIn: i => standIn(pieces[i]), keys: input.keys, setDevice: q => { dev = q; gotMotion = true; } },
  };
}
