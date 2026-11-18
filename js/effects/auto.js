// Auto effect: animates any photo using the analysis from analyze.js.
// Same interface as golden-hour.js: { group, reveal(t), update(t), setViewportHeight(px) }

import { PRESETS } from '../analyze.js';

export const AUTO_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export const AUTO_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uCalm;
uniform float uTime, uReveal, uOpacity, uA;   // uA = width / height
uniform float uDrift, uRipple, uSweep, uPulse, uShimmer;
uniform vec3 uLights[3];                       // x, y (image space), strength
uniform vec3 uGlow;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

void main() {
  float t = uTime;
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);       // image space, top-left origin
  vec2 q = vec2(p.x * uA, p.y);             // aspect-corrected
  float calm = texture2D(uCalm, vUv).r;

  vec2 off = vec2(0.0);
  // drifting air / clouds / water in calm areas
  vec2 cp = p * vec2(3.0 * uA, 3.0) + vec2(t * 0.05, t * 0.015);
  off += (vec2(fbm(cp), fbm(cp + 5.7)) - 0.5) * 0.022 * calm * uDrift;
  // ripples from lower centre
  vec2 rc = vec2(0.5 * uA, 0.72);
  float rd = length(q - rc);
  off += normalize(q - rc + 1e-4) * sin(rd * 46.0 - t * 2.2) * 0.0035 * calm * uRipple * smoothstep(0.0, 0.08, rd);

  vec3 col = texture2D(uMap, vec2(clamp(p.x + off.x, 0.001, 0.999), 1.0 - clamp(p.y + off.y, 0.001, 0.999))).rgb;
  float L = dot(col, vec3(0.2126, 0.7152, 0.0722));

  // glowing light sources
  for (int i = 0; i < 3; i++) {
    vec3 lt = uLights[i];
    if (lt.z <= 0.0) continue;
    float d = length(q - vec2(lt.x * uA, lt.y));
    float pulse = 0.6 + 0.4 * sin(t * 1.1 + float(i) * 2.1);
    col += uGlow * exp(-pow(d / 0.16, 2.0)) * 0.20 * lt.z * pulse * uPulse;
    float ang = atan(q.y - lt.y, q.x - lt.x * uA);
    float rays = pow(0.5 + 0.5 * sin(ang * 12.0 + t * 0.25 + float(i)), 6.0);
    col += uGlow * rays * smoothstep(0.45, 0.05, d) * 0.05 * lt.z * uPulse;
  }

  // diagonal light sweep
  vec2 dir = normalize(vec2(1.0, -0.55));
  float s = dot(q, dir);
  float head = mod(t * 0.32, uA + 2.4) - 0.9;
  col += vec3(1.0, 0.97, 0.92) * exp(-pow((s - head) / 0.12, 2.0)) * 0.10 * uSweep * (0.4 + L);

  // twinkles on bright details
  vec2 cell = floor(q * 70.0);
  float h = hash(cell);
  vec2 cq = fract(q * 70.0) - 0.5;
  float tw = pow(max(0.0, sin(t * 1.8 + h * 60.0)), 24.0) * step(0.86, h) * smoothstep(0.62, 0.9, L);
  float star = max(exp(-abs(cq.x) * 28.0) * exp(-abs(cq.y) * 6.0), exp(-abs(cq.y) * 28.0) * exp(-abs(cq.x) * 6.0));
  col += vec3(1.0, 0.98, 0.94) * tw * (star + exp(-dot(cq, cq) * 30.0)) * 0.9 * uShimmer;

  col *= 1.0 + 0.025 * sin(t * 1.05) * uPulse;

  // radial reveal from centre
  float dc = length(q - vec2(0.5 * uA, 0.5));
  float maxD = length(vec2(0.5 * uA, 0.5)) + 0.2;
  float wipe = smoothstep(uReveal * maxD, uReveal * maxD - 0.15, dc);
  float edge = exp(-pow((dc - uReveal * maxD) / 0.025, 2.0)) * (1.0 - step(0.999, uReveal));
  col += uGlow * edge * 0.8;
  gl_FragColor = vec4(col, clamp(max(wipe, edge), 0.0, 1.0) * uOpacity);
}`;

export const PARTICLE_VERT = /* glsl */ `
uniform float uTime, uViewportH, uH, uW, uDir, uSpeed, uSize;
attribute float aSize, aSpeed, aPhase, aTint;
varying float vAlpha, vTint, vSoft;
void main() {
  vec3 pos = position;
  float travel = uH + 0.2;
  float y = mod(pos.y + uH * 0.5 + 0.1 + uTime * aSpeed * uSpeed * uDir, travel) - uH * 0.5 - 0.1;
  pos.y = y;
  float sway = (uDir == 0.0) ? 0.06 : 0.025;
  pos.x += sin(uTime * 0.5 * uSpeed + aPhase) * sway + sin(uTime * 1.7 + aPhase * 3.0) * 0.006;
  if (uDir == 0.0) pos.y = position.y + sin(uTime * 0.23 + aPhase * 2.0) * 0.05;
  float yn = (pos.y + uH * 0.5) / uH;
  vAlpha = smoothstep(0.0, 0.1, yn) * (1.0 - smoothstep(0.85, 1.0, yn));
  if (uDir > 0.0) vAlpha *= 1.0 - smoothstep(0.6, 1.0, yn);
  vAlpha *= 0.55 + 0.45 * sin(uTime * 2.4 + aPhase * 5.0);
  vTint = aTint;
  vSoft = (uDir == 0.0) ? 1.0 : 0.0;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float modelScale = length(modelViewMatrix[0].xyz);
  float worldSize = aSize * uSize * 0.0012 * modelScale;
  gl_PointSize = clamp(worldSize * projectionMatrix[1][1] * 0.5 * uViewportH / max(-mv.z, 1e-4), 1.0, 96.0);
  gl_Position = projectionMatrix * mv;
}`;

export const PARTICLE_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec3 uC0, uC1, uC2;
varying float vAlpha, vTint, vSoft;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = pow(smoothstep(0.5, 0.0, d), 1.8);
  // bokeh: soft disc with a brighter rim
  float bokeh = smoothstep(0.5, 0.44, d) * (0.35 + 0.65 * smoothstep(0.25, 0.47, d));
  float shape = mix(core, bokeh * 0.55, vSoft);
  vec3 col = vTint < 0.34 ? uC0 : (vTint < 0.67 ? uC1 : uC2);
  float a = shape * vAlpha * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}`;

export function createAutoPoster(THREE, texture, analysis, presetName) {
  const preset = PRESETS[presetName] || PRESETS[analysis.preset] || PRESETS.glow;
  const aspect = analysis.aspect;      // h / w
  const group = new THREE.Group();

  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;

  const cm = analysis.calm;
  const calmTex = new THREE.DataTexture(cm.data, cm.w, cm.h, THREE.RedFormat, THREE.UnsignedByteType);
  calmTex.flipY = true; // data rows are top→bottom; UVs are bottom→top
  calmTex.minFilter = calmTex.magFilter = THREE.LinearFilter;
  calmTex.needsUpdate = true;

  const lights = [0, 1, 2].map(i => {
    const l = analysis.lights[i];
    return l ? new THREE.Vector3(l.x, l.y, l.strength) : new THREE.Vector3(0, 0, 0);
  });
  const glow = new THREE.Vector3(...mixColor(analysis.palette[0], [1, 0.9, 0.7], 0.5));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture }, uCalm: { value: calmTex },
      uTime: { value: 0 }, uReveal: { value: 1 }, uOpacity: { value: 1 }, uA: { value: 1 / aspect },
      uDrift: { value: preset.drift }, uRipple: { value: preset.ripple }, uSweep: { value: preset.sweep },
      uPulse: { value: preset.pulse }, uShimmer: { value: preset.shimmer },
      uLights: { value: lights }, uGlow: { value: glow },
    },
    vertexShader: AUTO_VERT, fragmentShader: AUTO_FRAG, transparent: true, depthWrite: false,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, aspect), mat);
  group.add(plane);

  // particles
  const P = preset.particles;
  const n = P.count;
  const pos = new Float32Array(n * 3), size = new Float32Array(n), speed = new Float32Array(n), phase = new Float32Array(n), tint = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5); pos[i * 3 + 1] = (Math.random() - 0.5) * aspect; pos[i * 3 + 2] = 0.01 + Math.random() * 0.14;
    const big = Math.random() < 0.12;
    size[i] = (big ? 10 + Math.random() * 10 : 2.5 + Math.random() * 4.5) * (P.mode === 'float' ? 0.6 + Math.random() * 0.8 : 1);
    speed[i] = 0.012 + Math.random() * 0.035; phase[i] = Math.random() * Math.PI * 2; tint[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  const pc = analysis.palette.map(c => new THREE.Vector3(...c));
  const pmat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uViewportH: { value: 800 }, uH: { value: aspect }, uW: { value: 1 },
      uDir: { value: P.mode === 'up' ? 1 : P.mode === 'down' ? -1 : 0 }, uSpeed: { value: P.speed }, uSize: { value: P.size },
      uOpacity: { value: 1 }, uC0: { value: pc[0] }, uC1: { value: pc[1] }, uC2: { value: pc[2] },
    },
    vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const points = new THREE.Points(g, pmat);
  points.frustumCulled = false; points.renderOrder = 1;
  group.add(points);

  let revealStart = null, opacity = 1;
  return {
    group,
    reveal(t) { revealStart = t; },
    setViewportHeight(px) { pmat.uniforms.uViewportH.value = px; },
    update(t) {
      mat.uniforms.uTime.value = t; pmat.uniforms.uTime.value = t;
      const r = revealStart === null ? 1 : Math.min(1, (t - revealStart) / 1.5);
      const e = 1 - Math.pow(1 - r, 3);
      mat.uniforms.uReveal.value = e;
      mat.uniforms.uOpacity.value = opacity;
      pmat.uniforms.uOpacity.value = Math.max(0, (e - 0.4) / 0.6) * opacity;
    },
    setOpacity(o) { opacity = o; },
    dispose() { g.dispose(); pmat.dispose(); mat.dispose(); plane.geometry.dispose(); calmTex.dispose(); },
  };
}

function mixColor(a, b, t) { return a.map((v, i) => v * (1 - t) + b[i] * t); }
