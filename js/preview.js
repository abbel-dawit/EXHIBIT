// Live animated preview of an artwork (no camera): poster details and the Studio.
import * as THREE from 'three';
import { createEffect } from './effects/index.js';

export class LivePreview {
  /** art: { meta, imageURL, overlayURL } */
  constructor(host, art, { tilt = true, opacity = 1 } = {}) {
    this.host = host; this.art = art; this.tilt = tilt; this.opacity = opacity;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.domElement.className = 'preview-canvas';
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
    this.rig = new THREE.Group(); this.scene.add(this.rig);
    this.mx = 0; this.my = 0; this.hover = false;
    this._onMove = e => { const r = host.getBoundingClientRect(); this.mx = (e.clientX - r.left) / r.width - 0.5; this.my = (e.clientY - r.top) / r.height - 0.5; this.hover = true; };
    this._onLeave = () => { this.hover = false; };
    host.addEventListener('pointermove', this._onMove);
    host.addEventListener('pointerleave', this._onLeave);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
    this.ready = this._build().then(() => {
      const loop = () => this._frame();
      this._loop = loop;
      this.renderer.setAnimationLoop(loop);
      this._vis = () => this.renderer.setAnimationLoop(document.hidden ? null : loop);
      document.addEventListener('visibilitychange', this._vis);
    });
  }
  async _build() {
    const fx = await createEffect(THREE, this.art);
    if (this.disposed) { fx.dispose?.(); return; }
    if (this.effect) { this.rig.remove(this.effect.group); this.effect.dispose?.(); }
    this.effect = fx; this.rig.add(fx.group);
    fx.setOpacity(this.opacity);
    this.resize();
    fx.reveal(performance.now() / 1000 + 0.1);
  }
  /** Swap the animation (e.g. a different style or a new video). */
  async setArt(art) { this.art = art; await this._build(); }
  replay() { this.effect?.reveal(performance.now() / 1000); }
  pause() { this.renderer.setAnimationLoop(null); this.effect?.pause?.(); }
  resume() { if (this._loop) this.renderer.setAnimationLoop(this._loop); this.effect?.play?.(); }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const a = this.effect?.aspect || 0.7, margin = this.tilt ? 1.1 : 1.0;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.position.set(0, 0, Math.max((a * margin) / (2 * tan), (margin / this.camera.aspect) / (2 * tan)));
    this.camera.updateProjectionMatrix();
  }
  _frame() {
    if (!this.effect) return;
    const t = performance.now() / 1000;
    if (this.tilt) {
      const tx = this.hover ? this.mx * 0.5 : Math.sin(t * 0.35) * 0.14;
      const ty = this.hover ? this.my * 0.35 : Math.sin(t * 0.27) * 0.07;
      this.rig.rotation.y += (tx - this.rig.rotation.y) * 0.06;
      this.rig.rotation.x += (ty - this.rig.rotation.x) * 0.06;
    }
    this.effect.setViewportHeight(this.renderer.domElement.height);
    this.effect.update(t);
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.disposed = true;
    this.ro.disconnect();
    this.host.removeEventListener('pointermove', this._onMove);
    this.host.removeEventListener('pointerleave', this._onLeave);
    if (this._vis) document.removeEventListener('visibilitychange', this._vis);
    this.renderer.setAnimationLoop(null);
    this.effect?.dispose?.();
    this.renderer.dispose(); this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
  }
}
