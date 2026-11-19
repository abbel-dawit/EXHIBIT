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
const TRACKING = { filterMinCF: 0.0008, filterBeta: 25, warmupTolerance: 4, missTolerance: 6 };
const HOLD = 0.35;              // seconds an overlay stays after a brief tracking miss (hides flicker)
const OPACITY = { effect: 0.96, video: 1 };

/**
 * opts: { mount, art: {meta, imageURL, overlayURL, overlays, videoURL}, targetSrc, overlay: start index,
 *         onFound, onLost, onOverlay(index, overlay), onOverlayError(index, error) }
 * Returns { stop(), next(), prev(), setOverlay(i), overlay, overlays }
 */
export async function startAR({ mount, art, targetSrc, overlay = 0, onFound, onLost, onOverlay, onOverlayError }) {
  const MindARThree = await loadMindAR();
  const container = document.createElement('div');
  container.className = 'ar-stage';
  mount.appendChild(container);

  const mindar = new MindARThree({ container, imageTargetSrc: targetSrc, maxTrack: 1, uiLoading: 'no', uiScanning: 'no', uiError: 'no', ...TRACKING });
  const { renderer, scene, camera } = mindar;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const anchor = mindar.addAnchor(0);   // 1 unit = the poster's width, centred on the poster

  const overlays = art.overlays?.length ? art.overlays : [{ kind: 'effect', effect: art.meta.effect, title: 'Living edition' }];
  const fx = new Map();                 // index → effect (built on first use, kept for quick switching)
  const fade = new Map();               // index → 0..1
  let current = Math.max(0, Math.min(overlays.length - 1, overlay | 0));
  let image = null;
  const build = async i => {
    if (fx.has(i)) return fx.get(i);
    const p = (async () => {
      image = image || await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = art.imageURL; });
      const e = await createOverlayEffect(THREE, art, overlays[i], { image });
      e.setOpacity(0); e.group.position.set(0, 0, 0.002 + i * 0.0005);
      anchor.group.add(e.group);
      return e;
    })();
    fx.set(i, p); fade.set(i, 0);
    return p.catch(err => { fx.delete(i); throw err; });
  };
  const ready = new Map();              // index → effect once built
  const ensure = i => build(i).then(e => { ready.set(i, e); return e; });

  const now = () => performance.now() / 1000;
  let tracking = false, lostAt = -1, everFound = false, goneSince = now();

  try { await ensure(current); } catch (e) { container.remove(); throw e; }

  function show(i, { reveal = false } = {}) {
    const e = ready.get(i); if (!e) return;
    if (reveal) e.reveal(now()); else e.play?.();
  }
  anchor.onTargetFound = () => {
    tracking = true;
    if (!everFound || now() - goneSince > 4) show(current, { reveal: true }); else show(current);
    everFound = true;
    try { navigator.vibrate?.(18); } catch {}
    onFound?.();
  };
  anchor.onTargetLost = () => { tracking = false; lostAt = now(); onLost?.(); };

  try { await mindar.start(); }
  catch (e) { cleanup(); throw e; }

  let switchId = 0;
  async function setOverlay(i) {
    const n = overlays.length; i = ((i % n) + n) % n;
    if (i === current) return current;
    const id = ++switchId;
    current = i; onOverlay?.(i, overlays[i]);
    try {
      const e = await ensure(i);
      if (id !== switchId) return current;
      if (tracking) e.reveal(now());
    } catch (err) {
      console.warn('overlay', err); onOverlayError?.(i, err);
    }
    return current;
  }

  let last = now();
  const loop = () => {
    const t = now(), dt = Math.min(0.1, t - last); last = t;
    const visible = tracking || (lostAt > 0 && t - lostAt < HOLD);
    if (!visible && [...fade.values()].every(v => v === 0)) goneSince = t;
    for (const [i, e] of ready) {
      const want = visible && i === current ? 1 : 0;
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
    else if (tracking) ready.get(current)?.play?.();
  };
  document.addEventListener('visibilitychange', onVis);
  // warm the next overlay in the background so the first swipe is instant
  if (overlays.length > 1) setTimeout(() => { if (!stopped) ensure((current + 1) % overlays.length).catch(() => {}); }, 1500);

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
    stop() {
      if (stopped) return; stopped = true;
      document.removeEventListener('visibilitychange', onVis);
      try { mindar.stop(); } catch {}
      container.querySelectorAll('video').forEach(v => { try { v.srcObject?.getTracks().forEach(t => t.stop()); } catch {} });
      cleanup();
    },
  };
}
