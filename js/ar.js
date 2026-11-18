// AR session: camera + MindAR tracking + the artwork's animation.
//
// Two display modes:
//   'fit' (default): once the poster is recognised, the animated artwork is shown fitted to the screen
//                     with padding, always fully visible and sharp, while it tilts, drifts and scales
//                     with the poster's real position, so it still moves with you.
//   'pin':           classic AR: the animation is locked exactly onto the printed poster.
import * as THREE from 'three';
import { createEffect } from './effects/index.js';

let MindARThreePromise = null;
export function loadMindAR() {
  if (!MindARThreePromise) MindARThreePromise = import('mindar-image-three').then(m => m.MindARThree)
    .catch(e => { MindARThreePromise = null; throw e; });
  return MindARThreePromise;
}

const OVERLAY_OPACITY = 0.86;   // the printed poster stays slightly visible behind
const MAX_TILT = THREE.MathUtils.degToRad(24);
const LOST_GRACE = 1.2;         // seconds the overlay holds after tracking is lost

/**
 * opts: { mount, art: {meta, imageURL, overlayURL}, targetSrc, mode, padding: {top,right,bottom,left} px,
 *         onFound, onLost }
 * Returns { stop(), setMode(mode), mode }
 */
export async function startAR({ mount, art, targetSrc, mode = 'fit', padding = {}, onFound, onLost }) {
  const MindARThree = await loadMindAR();
  const container = document.createElement('div');
  container.className = 'ar-stage';
  mount.appendChild(container);

  const mindar = new MindARThree({
    container, imageTargetSrc: targetSrc, maxTrack: 1,
    uiLoading: 'no', uiScanning: 'no', uiError: 'no',
    filterMinCF: 0.0001, filterBeta: 0.001, warmupTolerance: 3, missTolerance: 8,
  });
  const { renderer, scene, camera } = mindar;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const effect = await createEffect(THREE, art);
  effect.setOpacity(0);
  const anchor = mindar.addAnchor(0);

  // fit-mode scene: its own camera, the artwork sits in a rig that copies (damped) the poster's motion
  const fitScene = new THREE.Scene();
  const fitCam = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
  const rig = new THREE.Group(); fitScene.add(rig);

  let currentMode = mode;
  const place = () => {
    effect.group.removeFromParent();
    effect.group.position.set(0, 0, currentMode === 'pin' ? 0.002 : 0);
    effect.group.quaternion.identity(); effect.group.scale.setScalar(1);
    (currentMode === 'pin' ? anchor.group : rig).add(effect.group);
  };
  place();

  // tracking state
  const now = () => performance.now() / 1000;
  let tracking = false, lostAt = -1, everFound = false, goneSince = now();
  let fade = 0;                                  // 0..1 visibility
  const pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: new THREE.Vector3() };
  const smoothQ = new THREE.Quaternion(), targetQ = new THREE.Quaternion(), ident = new THREE.Quaternion();
  const smoothOff = new THREE.Vector2(), smoothZoom = { v: 1 };
  const ndc = new THREE.Vector3();

  anchor.onTargetFound = () => {
    tracking = true;
    if (!everFound || now() - goneSince > 4) effect.reveal(now());   // full reveal only on a fresh find
    everFound = true;
    effect.play?.();
    try { navigator.vibrate?.(18); } catch {}
    onFound?.();
  };
  anchor.onTargetLost = () => { tracking = false; lostAt = now(); onLost?.(); };

  try { await mindar.start(); }
  catch (e) { cleanup(); throw e; }

  function layoutFit() {
    const el = renderer.domElement;
    const w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight;
    fitCam.aspect = w / h;
    // usable area after padding
    const pt = padding.top ?? 84, pb = padding.bottom ?? 96, pl = padding.left ?? 20, pr = padding.right ?? 20;
    const fw = Math.max(0.3, (w - pl - pr) / w), fh = Math.max(0.3, (h - pt - pb) / h);
    const tan = Math.tan(THREE.MathUtils.degToRad(fitCam.fov / 2));
    const a = effect.aspect, margin = 1.1;      // a little extra room for the tilt
    const dist = Math.max((a * margin) / (2 * tan * fh), (margin / fitCam.aspect) / (2 * tan * fw));
    // shift the camera so the padded area (not the whole screen) is centred
    const cy = ((pt - pb) / 2) / h * 2 * tan * dist;
    const cx = ((pr - pl) / 2) / w * 2 * tan * dist * fitCam.aspect;
    fitCam.position.set(cx, cy, dist);
    fitCam.lookAt(cx, cy, 0);
    fitCam.updateProjectionMatrix();
    return { dist, tan, fw, fh };
  }

  function updateFit(dt) {
    const L = layoutFit();
    if (tracking) {
      anchor.group.matrix.decompose(pose.pos, pose.quat, pose.scale);
      // tilt: follow the poster's orientation, damped and clamped so it stays readable
      targetQ.copy(ident).slerp(pose.quat, 0.6);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(targetQ.w)));
      if (ang > MAX_TILT) targetQ.copy(ident).slerp(targetQ, MAX_TILT / ang);
      // drift: lean toward where the poster is on screen (but never off screen)
      ndc.copy(pose.pos).project(camera);
      const visW = 2 * L.tan * L.dist * fitCam.aspect, visH = 2 * L.tan * L.dist;
      const slackX = Math.max(0, (visW * L.fw - 1 * 1.1) / 2), slackY = Math.max(0, (visH * L.fh - effect.aspect * 1.1) / 2);
      const ox = THREE.MathUtils.clamp(ndc.x * visW * 0.08, -slackX - 0.03, slackX + 0.03);
      const oy = THREE.MathUtils.clamp(ndc.y * visH * 0.08, -slackY - 0.03, slackY + 0.03);
      // zoom: a gentle push-in as you walk closer
      const apparent = THREE.MathUtils.clamp(pose.scale.x / Math.max(1e-3, -pose.pos.z) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect), 0, 1.5);
      const zoom = 0.94 + 0.06 * Math.min(1, apparent);
      const k = 1 - Math.pow(0.0015, dt);          // frame-rate independent smoothing
      smoothQ.slerp(targetQ, k);
      smoothOff.x += (ox - smoothOff.x) * k; smoothOff.y += (oy - smoothOff.y) * k;
      smoothZoom.v += (zoom - smoothZoom.v) * k;
    } else {
      // ease back to centre while holding
      const k = 1 - Math.pow(0.05, dt);
      smoothQ.slerp(ident, k); smoothOff.multiplyScalar(1 - k);
    }
    rig.quaternion.copy(smoothQ);
    rig.position.set(smoothOff.x, smoothOff.y, 0);
    rig.scale.setScalar(smoothZoom.v);
  }

  let last = now();
  const loop = () => {
    const t = now(), dt = Math.min(0.1, t - last); last = t;
    const visible = tracking || (lostAt > 0 && t - lostAt < LOST_GRACE && currentMode === 'fit');
    if (!visible && fade === 0) goneSince = t;
    fade += ((visible ? 1 : 0) - fade) * (1 - Math.pow(visible ? 0.02 : 0.0005, dt));
    if (fade < 0.01 && !visible) { fade = 0; effect.pause?.(); }
    effect.setOpacity(OVERLAY_OPACITY * fade);
    effect.setViewportHeight(renderer.domElement.height);
    effect.update(t);
    if (currentMode === 'fit') { updateFit(dt); renderer.render(fitScene, fitCam); }
    else renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(loop);
  const onVis = () => renderer.setAnimationLoop(document.hidden ? null : loop);
  document.addEventListener('visibilitychange', onVis);

  let stopped = false;
  function cleanup() {
    try { renderer.setAnimationLoop(null); } catch {}
    try { effect.dispose?.(); } catch {}
    try { renderer.dispose(); renderer.forceContextLoss?.(); } catch {}
    container.remove();
  }
  return {
    get mode() { return currentMode; },
    setMode(m) { currentMode = m; place(); },
    stop() {
      if (stopped) return; stopped = true;
      document.removeEventListener('visibilitychange', onVis);
      try { mindar.stop(); } catch {}
      container.querySelectorAll('video').forEach(v => { try { v.srcObject?.getTracks().forEach(t => t.stop()); } catch {} });
      cleanup();
    },
  };
}
