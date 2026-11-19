// Poster recognition data for MindAR, as fast as possible:
//   1. in memory this session  →  2. pre-built by the Studio (shipped encrypted with the artwork)
//   3. cached on this device    →  4. built on the device from the artwork (first time only)
import { db } from './db.js';

const COMPILER_URL = globalThis.EXHIBIT_VENDOR?.compiler
  ? new URL(globalThis.EXHIBIT_VENDOR.compiler, document.baseURI).href
  : new URL('../vendor/mind-ar/mindar-image.prod.js', import.meta.url).href;
const COMPILE_MAX_SIDE = 720;   // enough detail for solid tracking; smaller = much faster to build

const memory = new Map(), inflight = new Map(), listeners = new Map();

let compilerPromise = null;
export function loadCompiler() {
  if (!compilerPromise) compilerPromise = import(COMPILER_URL).then(m => m.Compiler || globalThis.MINDAR?.IMAGE?.Compiler)
    .catch(e => { compilerPromise = null; throw e; });
  return compilerPromise;
}

function emit(key, p) { listeners.get(key)?.forEach(fn => { try { fn(p); } catch {} }); }
export function onProgress(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key)?.delete(fn);
}
export const isReady = key => memory.has(key);

async function loadImage(src) { const img = new Image(); img.src = src; await img.decode(); return img; }

async function prepare(src) {
  const img = typeof src === 'string' ? await loadImage(src) : src;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const s = Math.min(1, COMPILE_MAX_SIDE / Math.max(w, h));
  if (s >= 1 && img instanceof HTMLImageElement) return img;
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const url = URL.createObjectURL(await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92)));
  try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

/** Compile an image into MindAR target data (Uint8Array). */
export async function compileTarget(src, onP = () => {}) {
  onP(1);
  const [Compiler, img] = await Promise.all([loadCompiler(), prepare(src)]);
  onP(4);
  const compiler = new Compiler();
  await compiler.compileImageTargets([img], p => onP(4 + p * 0.95));
  const buf = await compiler.exportData();
  onP(100);
  return new Uint8Array(buf);
}

const toURL = buf => URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));

/**
 * key:  unique per artwork version (e.g. entry.key + image path)
 * art:  { imageURL, targetBuffer? }
 */
export function getTarget(key, art) {
  if (memory.has(key)) return Promise.resolve(memory.get(key));
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    if (art.targetBuffer) { emit(key, 100); return toURL(art.targetBuffer); }
    const cached = await db.get('targets', key);
    if (cached) { emit(key, 100); return toURL(cached); }
    const buf = await compileTarget(art.imageURL, pr => emit(key, pr));
    db.put('targets', key, buf);
    return toURL(buf);
  })();
  inflight.set(key, p);
  p.then(url => { memory.set(key, url); inflight.delete(key); emit(key, 100); }, () => inflight.delete(key));
  return p;
}
