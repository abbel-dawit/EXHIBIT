// Video effect: the artist's own animation (.mp4 / .mov) attached to the artwork.
// The video is cover-fitted to the artwork's proportions, so any video size lines up with the poster.
export const VIDEO_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec4 uCover;     // uv scale.xy, offset.zw
uniform float uReveal, uOpacity, uA;
uniform vec3 uGlow;
varying vec2 vUv;
void main() {
  vec2 uv = vUv * uCover.xy + uCover.zw;
  vec3 col = texture2D(uMap, uv).rgb;
  vec2 q = vec2(vUv.x * uA, vUv.y);
  float dc = length(q - vec2(0.5 * uA, 0.5));
  float maxD = length(vec2(0.5 * uA, 0.5)) + 0.2;
  float wipe = smoothstep(uReveal * maxD, uReveal * maxD - 0.15, dc);
  float edge = exp(-pow((dc - uReveal * maxD) / 0.025, 2.0)) * (1.0 - step(0.999, uReveal));
  col += uGlow * edge * 0.8;
  gl_FragColor = vec4(col, clamp(max(wipe, edge), 0.0, 1.0) * uOpacity);
}`;
const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Create a <video> element that plays inline, muted and looping (required for autoplay on phones). */
export function makeVideo(url) {
  const v = document.createElement('video');
  // muted + inline must be set BEFORE src, or iPhones refuse to play it without a tap
  v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.autoplay = false;
  v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
  // Safari (and some Android builds) only decode frames for videos that are in the page, so keep it
  // in the document: tiny, invisible and out of the way.
  v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
  v.src = url;
  (document.body || document.documentElement).appendChild(v);
  v.load();
  return v;
}

export function createVideoPoster(THREE, video, aspect) {
  const group = new THREE.Group();
  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uCover: { value: new THREE.Vector4(1, 1, 0, 0) }, uReveal: { value: 1 }, uOpacity: { value: 1 }, uA: { value: 1 / aspect }, uGlow: { value: new THREE.Vector3(1, 0.85, 0.6) } },
    vertexShader: VERT, fragmentShader: VIDEO_FRAG, transparent: true, depthWrite: false,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, aspect), mat);
  group.add(plane);

  const fit = () => {
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return;
    const va = vh / vw;            // video h/w
    let sx = 1, sy = 1;
    if (va > aspect) sy = aspect / va; else sx = va / aspect;   // crop the longer side
    mat.uniforms.uCover.value.set(sx, sy, (1 - sx) / 2, (1 - sy) / 2);
  };
  video.addEventListener('loadedmetadata', fit);
  fit();

  let revealStart = null, opacity = 1, wantPlay = false;
  // If the browser blocks playback (no recent tap), try again on the next touch anywhere.
  const retry = () => { if (wantPlay && video.paused) video.play().catch(() => {}); };
  addEventListener('pointerdown', retry, true); addEventListener('touchend', retry, true);
  const play = () => { wantPlay = true; const p = video.play(); if (p && p.catch) p.catch(() => {}); };
  return {
    group,
    reveal(t) { revealStart = t; play(); },
    play, pause() { wantPlay = false; video.pause(); },
    video,
    setViewportHeight() {},
    setOpacity(o) { opacity = o; },
    update(t) {
      const r = revealStart === null ? 1 : Math.min(1, (t - revealStart) / 1.3);
      mat.uniforms.uReveal.value = 1 - Math.pow(1 - r, 3);
      mat.uniforms.uOpacity.value = opacity;
      // push frames ourselves too: requestVideoFrameCallback doesn't fire everywhere
      if (video.readyState >= 2) tex.needsUpdate = true;
    },
    dispose() {
      removeEventListener('pointerdown', retry, true); removeEventListener('touchend', retry, true);
      video.pause(); video.removeAttribute('src'); video.load(); video.remove(); tex.dispose(); mat.dispose(); plane.geometry.dispose();
    },
  };
}
