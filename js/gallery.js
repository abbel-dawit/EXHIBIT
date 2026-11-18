// Gallery: unlock artworks with a purchase code, store them on the device, and open them.
import { db } from './db.js';
import { parsePayload, parseNfcPayload, editionKey, nfcKey, decryptBytes, decryptJSON, verifyCertificate, b64, unb64 } from './crypto.js';

const GALLERY_URL = 'gallery.json';
let galleryCache = null;

/** Public gallery manifest. Network first (so new artworks/revocations arrive), cached copy when offline. */
export async function loadGallery({ force = false } = {}) {
  if (galleryCache && !force) return galleryCache;
  try {
    const r = await fetch(GALLERY_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error('http ' + r.status);
    galleryCache = await r.json();
    db.put('kv', 'gallery', galleryCache);
  } catch (e) {
    galleryCache = (await db.get('kv', 'gallery')) || { artworks: [], artist: null };
    galleryCache.offline = true;
  }
  return galleryCache;
}

export const entryKey = (id, edition) => `${id}#${edition}`;

export async function listCollection() {
  const rows = await db.all('collection');
  return rows.sort((a, b) => b.unlockedAt - a.unlockedAt);
}
export const getEntry = (id, edition) => db.get('collection', entryKey(id, edition));

class UnlockError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

/** Try one edition entry with a code. Returns { K, cert } or null. */
async function tryEdition(art, edition, code) {
  const ed = art.editions?.[String(edition)];
  if (!ed) return null;
  try {
    const ek = await editionKey(code, art.id, edition);
    const K = await decryptBytes(ek, unb64(ed.k));
    const cert = ed.c ? await decryptJSON(ek, unb64(ed.c)) : null;
    return { K, cert };
  } catch { return null; }
}

/**
 * Unlock from a scanned QR / link / typed code.
 * onStep(label, progress0to100)
 * Returns { entry, already }
 */
export async function unlock(input, onStep = () => {}, { snapshot = null } = {}) {
  const p = parsePayload(input);
  if (!p) throw new UnlockError('invalid', 'That code doesn\'t look right. Check it and try again.');
  onStep('Checking your code', 5);
  let gallery = await loadGallery({ force: true });
  if (gallery.offline && snapshot) gallery = { ...snapshot, offline: true };
  const arts = gallery.artworks || [];

  // Already collected?
  if (p.id && p.edition) {
    const existing = await getEntry(p.id, p.edition);
    if (existing && existing.code === p.code) return { entry: existing, already: true };
  }

  let match = null;
  if (p.id) {
    const art = arts.find(a => a.id === p.id);
    if (!art) throw new UnlockError(gallery.offline ? 'offline' : 'unknown', gallery.offline ? 'You\'re offline. Connect to the internet to unlock a new poster.' : 'This artwork isn\'t in the gallery.');
    if (!art.editions?.[String(p.edition)]) throw new UnlockError('revoked', 'This code is no longer valid. Contact the artist if you bought this poster.');
    const r = await tryEdition(art, p.edition, p.code);
    if (r) match = { art, edition: p.edition, ...r };
  } else {
    // typed code only: try every edition (fast, a few ms each)
    const owned = new Set((await listCollection()).map(e => e.code));
    if (owned.has(p.code)) { const e = (await listCollection()).find(x => x.code === p.code); return { entry: e, already: true }; }
    outer: for (const art of arts) for (const ed of Object.keys(art.editions || {})) {
      const r = await tryEdition(art, Number(ed), p.code);
      if (r) { match = { art, edition: Number(ed), ...r }; break outer; }
    }
  }
  if (!match) throw new UnlockError('wrong', gallery.offline ? 'You\'re offline. Connect to unlock a new poster.' : 'We couldn\'t match that code to a poster. Check it and try again.');

  onStep('Verifying certificate', 20);
  const { art, edition, K, cert } = match;
  const verified = cert && gallery.artist?.publicKey ? await verifyCertificate(gallery.artist.publicKey, cert) : false;
  if (cert && !verified) throw new UnlockError('forged', 'This certificate could not be verified as signed by the artist.');

  onStep('Opening the artwork', 30);
  const files = art.files || {};
  const meta = await decryptJSON(K, await fetchAsset(art.id, 'meta', files.meta));

  // Download everything so it works offline from now on
  const names = Object.keys(files).filter(n => n !== 'meta');
  let done = 0;
  for (const name of names) {
    await fetchAsset(art.id, name, files[name], pr => onStep(`Downloading ${labelFor(name)}`, 30 + ((done + pr) / names.length) * 60));
    done++;
  }

  const entry = {
    key: entryKey(art.id, edition), id: art.id, edition, editions: art.editionsTotal || cert?.editions || null,
    code: p.code, K: b64(K), cert, verified, meta, files, unlockedAt: Date.now(),
    artist: gallery.artist ? { name: gallery.artist.name } : null,
  };
  await db.put('collection', entry.key, entry);
  mirrorCredentials();
  onStep('Unlocked', 100);
  return { entry, already: false };
}

/**
 * Temporary preview from an artwork's NFC tag link (#n=<id>.<code>).
 * Returns an in-memory entry that is never written to the collection: once the preview ends,
 * the tag has to be scanned again. Only a QR code (unlock) adds an artwork permanently.
 */
export async function nfcPreview(input, onStep = () => {}) {
  const p = parseNfcPayload(input);
  if (!p) throw new UnlockError('invalid', 'This NFC tag isn\'t an EXHIBIT artwork tag.');
  onStep('Reading the tag', 5);
  const gallery = await loadGallery({ force: true });
  const art = (gallery.artworks || []).find(a => a.id === p.id);
  if (!art) throw new UnlockError(gallery.offline ? 'offline' : 'unknown', gallery.offline ? 'You\'re offline. Connect to the internet to preview this artwork.' : 'This artwork isn\'t in the gallery any more.');
  if (!art.nfc?.k) throw new UnlockError('revoked', 'This tag isn\'t active. Ask the artist for help.');
  let K;
  try { K = await decryptBytes(await nfcKey(p.code, art.id), unb64(art.nfc.k)); }
  catch { throw new UnlockError('revoked', 'This tag is no longer valid. Ask the artist for a new one.'); }
  onStep('Opening the artwork', 25);
  const files = art.files || {};
  const meta = await decryptJSON(K, await fetchAsset(art.id, 'meta', files.meta));
  const names = Object.keys(files).filter(n => n !== 'meta');
  let done = 0;
  for (const name of names) {
    await fetchAsset(art.id, name, files[name], pr => onStep(`Loading ${labelFor(name)}`, 25 + ((done + pr) / names.length) * 70));
    done++;
  }
  const owned = (await listCollection()).filter(e => e.id === art.id);
  onStep('Ready', 100);
  return {
    key: `preview:${art.id}`, id: art.id, edition: null, editions: art.editionsTotal || null, preview: true,
    K: b64(K), meta, files, verified: false, cert: null, artist: gallery.artist ? { name: gallery.artist.name } : null,
    owned: owned[0] || null,
  };
}

const labelFor = n => ({ image: 'artwork', overlay: 'animation', target: 'recognition data' }[n] || n);

/** Fetch an encrypted file (from device storage if we already have it). */
export async function fetchAsset(id, name, path, onP = () => {}) {
  const key = `${id}/${name}`;
  const cached = await db.get('assets', key);
  if (cached && cached.path === path) { onP(1); return cached.data; }
  const r = await fetch(path);
  if (!r.ok) throw new UnlockError('download', 'Download failed. Check your connection and try again.');
  let data;
  const total = Number(r.headers.get('content-length')) || 0;
  if (r.body && total) {
    const reader = r.body.getReader(); const chunks = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onP(Math.min(1, got / total)); }
    data = new Uint8Array(got); let o = 0; for (const c of chunks) { data.set(c, o); o += c.length; }
  } else { data = new Uint8Array(await r.arrayBuffer()); onP(1); }
  await db.put('assets', key, { path, data });
  return data;
}

// ---------- opening a collected artwork ----------
const opened = new Map(); // entry.key -> { imageURL, overlayURL, targetBuffer }

export async function openArtwork(entry) {
  if (opened.has(entry.key)) return opened.get(entry.key);
  const K = unb64(entry.K);
  const get = async name => entry.files[name] ? decryptBytes(K, await fetchAsset(entry.id, name, entry.files[name])) : null;
  const [image, overlay, target] = await Promise.all([get('image'), get('overlay'), get('target')]);
  const res = {
    imageURL: URL.createObjectURL(new Blob([image], { type: entry.meta.imageMime || 'image/jpeg' })),
    overlayURL: overlay ? URL.createObjectURL(new Blob([overlay], { type: entry.meta.overlayMime || 'video/mp4' })) : null,
    targetBuffer: target ? target.buffer.slice(target.byteOffset, target.byteOffset + target.byteLength) : null,
  };
  opened.set(entry.key, res);
  return res;
}

/** Forget a decrypted artwork (used when an NFC preview ends). */
export function closeArtwork(key) {
  const r = opened.get(key); if (!r) return;
  opened.delete(key);
  for (const u of [r.imageURL, r.overlayURL]) if (u) setTimeout(() => URL.revokeObjectURL(u), 1500);
}

/** Are all files of this entry stored on the device? */
export async function isOffline(entry) {
  for (const [name, path] of Object.entries(entry.files || {})) {
    const c = await db.get('assets', `${entry.id}/${name}`);
    if (!c || c.path !== path) return false;
  }
  return true;
}

// ---------- on-device mirror of credentials (survives if the big asset store is cleared) ----------
export async function mirrorCredentials() {
  try {
    const rows = await listCollection();
    localStorage.setItem('gh-credentials', JSON.stringify(rows.map(r => ({ id: r.id, edition: r.edition, code: r.code, unlockedAt: r.unlockedAt }))));
  } catch {}
}
/** If the collection store was wiped but the mirror survived, list what can be restored. */
export function mirroredCredentials() {
  try { return JSON.parse(localStorage.getItem('gh-credentials') || '[]'); } catch { return []; }
}
export { UnlockError };
