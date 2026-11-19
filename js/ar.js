// AR session: camera + MindAR image tracking + the artwork's overlays.
//
// Overlays are always ANCHORED to the printed poster: they're children of MindAR's anchor, so they
// move, tilt and scale with the real poster as you walk around it, and disappear when it leaves
// the camera. An artwork can have several overlays (e.g. its living animation and the artist's
// video); setOverlay / next / prev switch between them with a quick cross-fade.
import * as THREE from 'three';
import { createOverlayEffect } from './effects/index.js';

let MindARThreePromise = null;
export function loadMindAR() {
  if (!MindARThreePromise) MindARThreePromise = import('mindar-image-three').then(m => m.MindARThree)
    .catch(e => { MindARThreePromise = null; throw e; });
  return MindARThreePromise;
}

// MindAR smooths the tracked pose with a One-Euro filter. minCF = steadiness when still,
// beta = how quickly it catches up when the phone moves. Higher beta keeps the overlay stuck to the
// poster during movement (very low beta made it drift behind); minCF keeps it calm when still.
const TRACKING = { filterMinCF: 0.0002, filterBeta: 40, warmupTolerance: 3, missTolerance: 10 };
const HOLD = 0.6;               // seconds an overlay holds its place after a brief tracking miss (no flicker)
const OPACITY = { effect: 0.82, video: 0.8 };   // the printed poster shows through a little

// The tracker updates the poster's pose fewer times a second than the screen redraws, with a little
// jitter. Overlays ride on a "follow" group that glides to the latest pose every frame: real
// movement is followed almost instantly, sub-millimetre wobble is ignored, so it feels glued on.
const FOLLOW_FAST = 38;         // catch-up rate (per second) for real movement
const FOLLOW_STILL = 9;         // catch-up rate when the change is tiny (jitter)
const JITTER_POS = 0.004;       // ≈ 0.4% of the poster width
const JITTER_ROT = 0.006;       // radians

/**
 * opts: { mount, art: {meta, imageURL, overlayURL, overlays, videoURL}, targetSrc, overlay: start index,
 *         onFound, onLost, onOverlay(index, overlay), onOverlayLoading(index, loading), onOverlayError(index, error) }
 * Returns { stop(), next(), prev(), setOverlay(i), overlay, overlays }
 */
export async function startAR({ mount, art, targetSrc, overlay = 0, onFound, onLost, onOverlay, onOverlayLoading, onOverlayError }) {
  const MindARThree = await loadMindAR();
  const container = document.createElement('div');
  container.className = 'ar-stage';
  mount.appendChild(container);

  const mindar = new MindARThree({ container, imageTargetSrc: targetSrc, maxTrack: 1, uiLoading: 'no', uiScanning: 'no', uiError: 'no', ...TRACKING });
  const { renderer, scene, camera } = mindar;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const anchor = mindar.addAnchor(0);   // 1 unit = the poster's width, centred on the poster
  const follow = new THREE.Group(); follow.matrixAutoUpdate = false; scene.add(follow);
  const fPos = new THREE.Vector3(), fQuat = new THREE.Quaternion(), fScale = new THREE.Vector3(1, 1, 1);
  const tPos = new THREE.Vector3(), tQuat = new THREE.Quaternion(), tScale = new THREE.Vector3();
  let followInit = false;
  function updateFollow(dt) {
    if (!tracking) return;                           // hold the last pose while briefly lost
    anchor.group.matrix.decompose(tPos, tQuat, tScale);
    if (!followInit) { fPos.copy(tPos); fQuat.copy(tQuat); fScale.copy(tScale); followInit = true; }
    else {
      const size = Math.max(1e-4, tScale.x);           // movement relative to the poster's size on screen
      const dPos = fPos.distanceTo(tPos) / size, dRot = fQuat.angleTo(tQuat);
      const moving = Math.min(1, Math.max(dPos / (JITTER_POS * 6), dRot / (JITTER_ROT * 6)));
      const still = dPos < JITTER_POS && dRot < JITTER_ROT;
      const rate = still ? FOLLOW_STILL * 0.35 : FOLLOW_STILL + (FOLLOW_FAST - FOLLOW_STILL) * moving;
      const k = 1 - Math.exp(-rate * dt);
      fPos.lerp(tPos, k); fQuat.slerp(tQuat, k); fScale.lerp(tScale, k);
    }
    follow.matrix.compose(fPos, fQuat, fScale);
    follow.matrixWorldNeedsUpdate = true;
  }

  const overlays = art.overlays?.length ? art.overlays : [{ kind: 'effect', effect: art.meta.effect, title: 'Living edition' }];
  const fx = new Map();                 // index → effect (built on first use, kept for quick switching)
  const fade = new Map();               // index → 0..1
  let current = Math.max(0, Math.min(overlays.length - 1, overlay | 0));
  let shown = current;                  // what's on the poster now (stays until the next one is ready)
  // start downloading/decrypting every video overlay now, while the camera starts
  for (const o of overlays) if (o.kind === 'video') art.videoURL?.(o.file, o.mime)?.catch?.(() => {});
  let image = null;
  const build = async i => {
    if (fx.has(i)) return fx.get(i);
    const p = (async () => {
      image = image || await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = art.imageURL; });
      const e = await createOverlayEffect(THREE, art, overlays[i], { image });
      e.setOpacity(0); e.group.position.set(0, 0, 0.002 + i * 0.0005);
      follow.add(e.group);
      return e;
    })();
    fx.set(i, p); fade.set(i, 0);
    return p.catch(err => { fx.delete(i); throw err; });
  };
  const ready = new Map();              // index → effect once built
  const ensure = i => build(i).then(e => { ready.set(i, e); return e; });

  const now = () => performance.now() / 1000;
  let tracking = false, lostAt = -1, everFound = false, goneSince = now();

  const firstFx = ensure(current);       // build the first overlay while the camera starts

  function show(i, { reveal = false } = {}) {
    const e = ready.get(i); if (!e) return;
    shown = i;
    if (reveal) e.reveal(now()); else e.play?.();
  }
  anchor.onTargetFound = () => {
    if (!tracking && now() - lostAt > HOLD) followInit = false;   // a fresh find snaps into place
    tracking = true;
    const target = ready.has(current) ? current : shown;
    if (!everFound || now() - goneSince > 4) show(target, { reveal: true }); else show(target);
    everFound = true;
    try { navigator.vibrate?.(18); } catch {}
    onFound?.();
  };
  anchor.onTargetLost = () => { tracking = false; lostAt = now(); onLost?.(); };

  try { await Promise.all([mindar.start(), firstFx]); }
  catch (e) { cleanup(); throw e; }
  if (tracking && ready.has(current)) show(current, { reveal: true });   // poster was found while the overlay was still preparing

  let switchId = 0;
  async function setOverlay(i) {
    const n = overlays.length; i = ((i % n) + n) % n;
    if (i === current) return current;
    const id = ++switchId;
    current = i; onOverlay?.(i, overlays[i]);
    const loading = !ready.has(i); if (loading) onOverlayLoading?.(i, true);
    try {
      const e = await ensure(i);
      if (loading) onOverlayLoading?.(i, false);
      if (id !== switchId) return current;
      shown = i;
      if (tracking) e.reveal(now());
    } catch (err) {
      if (loading) onOverlayLoading?.(i, false);
      console.warn('overlay', err); onOverlayError?.(i, err);
    }
    return current;
  }

  let last = now();
  const loop = () => {
    const t = now(), dt = Math.min(0.1, t - last); last = t;
    updateFollow(dt);
    const visible = tracking || (lostAt > 0 && t - lostAt < HOLD);
    if (!visible && [...fade.values()].every(v => v === 0)) goneSince = t;
    for (const [i, e] of ready) {
      const want = visible && i === shown ? 1 : 0;
      let f = fade.get(i) || 0;
      f += (want - f) * (1 - Math.pow(want ? 0.004 : 0.0008, dt));   // quick in, quicker out
      if (f < 0.01 && !want) { f = 0; if (!e.group.visible) {} e.pause?.(); }
      fade.set(i, f);
      e.group.visible = f > 0;
      if (f > 0) {
        e.setOpacity((OPACITY[e.kind] ?? 0.96) * f);
        e.setViewportHeight(renderer.domElement.height);
        e.update(t);
      }
    }
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(loop);
  const onVis = () => {
    renderer.setAnimationLoop(document.hidden ? null : loop);
    if (document.hidden) for (const e of ready.values()) e.pause?.();
    else if (tracking) ready.get(shown)?.play?.();
  };
  document.addEventListener('visibilitychange', onVis);
  // warm the next overlay in the background so the first swipe is instant
  if (overlays.length > 1) setTimeout(() => { if (!stopped) for (let k = 0; k < overlays.length; k++) if (k !== current) ensure(k).catch(() => {}); }, 600);

  let stopped = false;
  function cleanup() {
    try { renderer.setAnimationLoop(null); } catch {}
    for (const e of ready.values()) { try { e.dispose?.(); } catch {} }
    try { renderer.dispose(); renderer.forceContextLoss?.(); } catch {}
    container.remove();
  }
  return {
    overlays,
    get overlay() { return current; },
    setOverlay, next: () => setOverlay(current + 1), prev: () => setOverlay(current - 1),
    get mode() { return 'pin'; }, setMode() {},
    /** The video overlay currently on the poster (for the progress bar), or null. */
    media() { const e = ready.get(shown); return e?.kind === 'video' ? e : null; },
    stop() {
      if (stopped) return; stopped = true;
      document.removeEventListener('visibilitychange', onVis);
      try { mindar.stop(); } catch {}
      container.querySelectorAll('video').forEach(v => { try { v.srcObject?.getTracks().forEach(t => t.stop()); } catch {} });
      cleanup();
    },
  };
}
