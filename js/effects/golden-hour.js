// living-poster.js
// Builds the animated "living" version of the artwork as a three.js group.
// The group is 1 unit wide (MindAR's target width) and ASPECT tall, centred on 0,0.
// Bespoke, hand-masked animation for the Golden Hour artwork.

export const ASPECT = 820 / 1179; // height / width of the artwork

// ---------- shaders (exported so they can be tested without three.js) ----------

export const POSTER_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const POSTER_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform float uReveal;   // 0 → 1 intro wipe
uniform float uOpacity;  // overall fade
varying vec2 vUv;

const float A = 1179.0 / 820.0;        // aspect (w/h)

// --- hash / value noise / fbm ---
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
// soft ellipse mask, 1 inside → 0 outside
float ellipse(vec2 p, vec2 c, vec2 r, float soft) {
  vec2 d = (p - c) / r;
  return 1.0 - smoothstep(1.0 - soft, 1.0 + soft, length(d));
}

void main() {
  float t = uTime;
  // p: image space, origin top-left, x 0..1, y 0..1
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  // q: aspect-corrected space (y in units of image height)
  vec2 q = vec2(p.x * A, p.y);

  // ---------------- region masks ----------------
  float head   = ellipse(p, vec2(0.508, 0.395), vec2(0.105, 0.140), 0.35);
  float torso  = ellipse(p, vec2(0.560, 0.780), vec2(0.165, 0.310), 0.30);
  float figure = clamp(max(head, torso), 0.0, 1.0);

  float scarf  = ellipse(p, vec2(0.840, 0.680), vec2(0.200, 0.230), 0.45) * (1.0 - torso);
  float clouds = (1.0 - smoothstep(0.42, 0.66, p.y)) * (1.0 - figure);
  float leaves = smoothstep(0.66, 0.86, p.y) * (1.0 - figure) * (1.0 - scarf);

  // ---------------- UV displacement ----------------
  vec2 off = vec2(0.0);

  // drifting, breathing clouds
  vec2 cp = p * vec2(3.0, 4.0) + vec2(t * 0.045, t * 0.012);
  vec2 cn = vec2(fbm(cp), fbm(cp + 7.31)) - 0.5;
  off += cn * 0.020 * clouds;
  off.x += sin(p.y * 9.0 + t * 0.35) * 0.0035 * clouds;

  // scarf rippling in the wind (travels outwards to the right)
  float grow = smoothstep(0.62, 1.0, p.x);
  off.y += sin(p.x * 26.0 - t * 2.6 + p.y * 6.0) * 0.0075 * scarf * (0.35 + grow);
  off.x += sin(p.y * 20.0 - t * 2.1) * 0.0035 * scarf * grow;

  // foliage swaying
  float sway = sin(t * 1.15 + p.x * 9.0) + 0.5 * sin(t * 2.3 + p.x * 23.0);
  off.x += sway * 0.0032 * leaves * smoothstep(0.66, 1.0, p.y);
  off.y += cos(t * 1.7 + p.x * 15.0) * 0.0015 * leaves;

  // subtle breathing of the figure (very small, keeps her alive but stable)
  off.y += sin(t * 0.9) * 0.0010 * head;

  vec2 suv = clamp(p + off, 0.001, 0.999);
  vec3 col = texture2D(uMap, vec2(suv.x, 1.0 - suv.y)).rgb;

  // ---------------- light ----------------
  // suns (q-space centres / radii)
  vec2  s1 = vec2(0.768 * A, 0.232);  float r1 = 0.135;
  vec2  s2 = vec2(0.660 * A, 0.467);  float r2 = 0.080;
  float d1 = length(q - s1), d2 = length(q - s2);
  float pulse1 = 0.65 + 0.35 * sin(t * 1.10);
  float pulse2 = 0.65 + 0.35 * sin(t * 1.10 + 2.1);
  vec3  warm = vec3(1.0, 0.86, 0.62);

  col += warm * exp(-pow(d1 / (r1 * 1.5), 2.0)) * 0.14 * pulse1;
  col += warm * exp(-pow(d2 / (r2 * 1.6), 2.0)) * 0.12 * pulse2;

  // slow rotating rays around the big sun
  float ang  = atan(q.y - s1.y, q.x - s1.x);
  float rays = pow(0.5 + 0.5 * sin(ang * 16.0 + t * 0.25), 6.0)
             + 0.6 * pow(0.5 + 0.5 * sin(ang * 7.0 - t * 0.18), 14.0);
  float rayFall = smoothstep(r1 * 4.2, r1 * 1.05, d1) * smoothstep(r1 * 0.85, r1 * 1.1, d1);
  col += warm * rays * rayFall * rayFall * 0.07 * (0.6 + 0.4 * pulse1);

  // light streak sweep along the existing lens streak
  vec2  L0 = vec2(30.0 / 820.0, 770.0 / 820.0);
  vec2  L1 = vec2(1179.0 / 820.0, 432.0 / 820.0);
  vec2  ld = L1 - L0;
  float len = length(ld);
  vec2  ln = ld / len;
  float s   = dot(q - L0, ln);                     // along line
  float dl  = abs(dot(q - L0, vec2(-ln.y, ln.x))); // distance from line
  float head2 = mod(t * 0.38, len + 1.6) - 0.6;    // travelling highlight (pauses off-poster)
  float sweep = exp(-pow((s - head2) / 0.11, 2.0));
  col += vec3(1.0, 0.97, 0.9) * sweep * (exp(-pow(dl / 0.0045, 2.0)) * 0.7 + exp(-pow(dl / 0.03, 2.0)) * 0.14);

  // flare burst where the streak meets her shoulder
  vec2  F = vec2(0.430 * A, 0.735);
  float df = length(q - F);
  float fang = atan(q.y - F.y, q.x - F.x);
  float star = pow(abs(cos(fang * 3.0 + t * 0.2)), 40.0) * exp(-df / 0.09);
  float fpulse = 0.6 + 0.4 * sin(t * 1.6 + 1.0);
  col += vec3(1.0, 0.95, 0.85) * (exp(-pow(df / 0.07, 2.0)) * 0.12 + star * 0.22) * fpulse;

  // drifting soft bokeh rings near the bottom (like the ones in the art)
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 bc = vec2(0.30 + 0.30 * fi + 0.05 * sin(t * 0.21 + fi * 2.0),
                   0.80 + 0.07 * sin(t * 0.17 + fi * 1.3));
    bc.x *= A;
    float br = 0.045 + 0.02 * fi;
    float bd = length(q - bc);
    float ring = smoothstep(br, br - 0.006, bd) * (0.35 + 0.65 * smoothstep(br * 0.6, br, bd));
    col += vec3(1.0, 0.92, 0.8) * ring * 0.07 * (0.5 + 0.5 * sin(t * 0.5 + fi));
  }

  // gentle warm grade that "breathes" with the suns
  col *= 1.0 + 0.03 * sin(t * 1.1);

  // ---------------- intro reveal (radial wipe from the flare) ----------------
  float maxD = 1.75;
  float wipe = smoothstep(uReveal * maxD, uReveal * maxD - 0.18, df);
  // golden edge on the wipe front
  float edge = exp(-pow((df - uReveal * maxD) / 0.03, 2.0)) * (1.0 - step(0.999, uReveal));
  col += vec3(1.0, 0.8, 0.45) * edge * 0.8;

  gl_FragColor = vec4(col, clamp(max(wipe, edge), 0.0, 1.0) * uOpacity);
}`;

export const EMBER_VERT = /* glsl */ `
uniform float uTime;
uniform float uViewportH; // drawing-buffer height in px
uniform float uH;
attribute float aSize;
attribute float aSpeed;
attribute float aPhase;
varying float vAlpha;
varying float vTint;
void main() {
  vec3 pos = position;
  float travel = uH + 0.2;
  float y = mod(pos.y + uH * 0.5 + 0.1 + uTime * aSpeed, travel) - uH * 0.5 - 0.1;
  pos.y = y;
  pos.x += sin(uTime * 0.7 + aPhase) * 0.025 + sin(uTime * 1.9 + aPhase * 3.0) * 0.008;
  pos.z += sin(uTime * 0.5 + aPhase) * 0.01;
  float yn = (y + uH * 0.5) / uH;               // 0 bottom → 1 top
  vAlpha = smoothstep(0.0, 0.12, yn) * (1.0 - smoothstep(0.65, 1.0, yn));
  vAlpha *= 0.55 + 0.45 * sin(uTime * 3.0 + aPhase * 5.0);
  vTint = fract(aPhase * 7.13);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  // unit-independent sizing: size in poster-widths, projected to pixels
  float modelScale = length(modelViewMatrix[0].xyz);
  float worldSize = aSize * 0.0012 * modelScale;
  gl_PointSize = clamp(worldSize * projectionMatrix[1][1] * 0.5 * uViewportH / max(-mv.z, 1e-4), 1.0, 64.0);
  gl_Position = projectionMatrix * mv;
}`;

export const EMBER_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vAlpha;
varying float vTint;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = smoothstep(0.5, 0.0, d);
  core = pow(core, 1.8);
  vec3 gold = vec3(1.0, 0.84, 0.50);
  vec3 ember = vec3(1.0, 0.45, 0.18);
  vec3 col = mix(gold, ember, vTint);
  float a = core * vAlpha * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}`;

// ---------- three.js builder ----------

export function createLivingPoster(THREE, texture, { embers = 140 } = {}) {
  const group = new THREE.Group();

  texture.colorSpace = THREE.NoColorSpace; // shader works in raw sRGB, output is raw sRGB
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const posterMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: POSTER_VERT,
    fragmentShader: POSTER_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(1, ASPECT), posterMat);
  poster.renderOrder = 0;
  group.add(poster);

  // floating embers, spread in depth so they parallax in AR
  const n = embers;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const speed = new Float32Array(n);
  const phase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3 + 0] = (Math.random() - 0.5) * 1.0;
    pos[i * 3 + 1] = (Math.random() - 0.5) * ASPECT;
    pos[i * 3 + 2] = 0.01 + Math.random() * 0.14;
    const big = Math.random() < 0.12;
    size[i] = big ? 10 + Math.random() * 10 : 2.5 + Math.random() * 4.5;
    speed[i] = 0.012 + Math.random() * 0.035;
    phase[i] = Math.random() * Math.PI * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const emberMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uViewportH: { value: 800 },
      uH: { value: ASPECT },
      uOpacity: { value: 0 },
    },
    vertexShader: EMBER_VERT,
    fragmentShader: EMBER_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  const points = new THREE.Points(g, emberMat);
  points.renderOrder = 1;
  points.frustumCulled = false;
  group.add(points);

  let revealStart = null, opacity = 1;
  const REVEAL_SECONDS = 1.6;

  return {
    group,
    /** restart the intro wipe (call when the poster is found) */
    reveal(now) { revealStart = now; },
    /** pass the renderer's drawing-buffer height (px) so embers are sized correctly */
    setViewportHeight(px) { emberMat.uniforms.uViewportH.value = px; },
    update(now) {
      const t = now;
      posterMat.uniforms.uTime.value = t;
      emberMat.uniforms.uTime.value = t;
      let r = 1;
      if (revealStart !== null) r = Math.min(1, (t - revealStart) / REVEAL_SECONDS);
      const eased = 1 - Math.pow(1 - r, 3);
      posterMat.uniforms.uReveal.value = eased;
      posterMat.uniforms.uOpacity.value = opacity;
      emberMat.uniforms.uOpacity.value = Math.max(0, (eased - 0.4) / 0.6) * opacity;
    },
    /** overall opacity 0..1 (AR uses < 1 so the printed poster shows through) */
    setOpacity(o) { opacity = o; },
    dispose() { g.dispose(); emberMat.dispose(); posterMat.dispose(); poster.geometry.dispose(); },
  };
}
