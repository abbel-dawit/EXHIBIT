// EXHIBIT accounts: sign up on one device, sign in on others by scanning a QR code, and stay in sync.
//
// Same model as BAZINGA!: there's no server and no password. An account is a profile (name and
// optional picture) plus a long random "sync key" made when the account is created. The key never
// leaves your devices except inside the QR code / link you choose to show another device, or a
// short 8-character code that works once for 15 minutes.
//
// Sync transport: the free public relay ntfy.sh (nothing for the app owner to set up). Everything
// (profile, collected posters' unlock codes, likes, order details, device list) is compressed and
// ENCRYPTED on the device with AES-256-GCM using a key derived from the sync key, then posted to a
// topic whose name is a one-way hash of that key. The relay only ever sees unreadable bytes.
// Copies on the relay last about 3 hours; every open device re-posts its copy well before that, and
// the full account always stays on each device. Devices merge: posters and likes are combined,
// the newest edit wins for profile and details, removed devices are remembered.
import { db } from './db.js';
import { listCollection, unlock } from './gallery.js';

const RELAY = () => ((window.EXHIBIT_CONFIG || {}).syncRelay || 'https://ntfy.sh').replace(/\/$/, '');
const LS = { acct: 'ex-account', link: 'ex-sync', favs: 'ex-favs', favTs: 'ex-favs-ts', order: 'ex-order-profile', orderTs: 'ex-order-ts', dev: 'ex-dev', devices: 'ex-devices' };
const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const listeners = new Map();
const emit = (ev, d) => listeners.get(ev)?.forEach(fn => { try { fn(d); } catch (e) { console.warn(e); } });
export const on = (ev, fn) => { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); };

// ---------- this device ----------
const DEV = (() => { let d = lsGet(LS.dev); if (!d) { d = Math.random().toString(36).slice(2, 12); lsSet(LS.dev, d); } return d; })();
export function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}
export const thisDevice = () => DEV;

// ---------- state ----------
const S = { status: 'off', error: '', lastSync: 0 };
export const syncState = () => ({ ...S });
let link = lsGet(LS.link);          // { secret, since, lastTs, pubTs, hash }
let keys = null;
let devices = lsGet(LS.devices, {});
export const profile = () => lsGet(LS.acct);
export const signedIn = () => !!(profile() && link?.secret);
const saveLink = () => lsSet(LS.link, link);
const saveDevices = () => lsSet(LS.devices, devices);
function setStatus(status, error = '') { S.status = status; S.error = error; if (status === 'synced') S.lastSync = Date.now(); emit('status', syncState()); }

// ---------- crypto & encoding ----------
const enc = new TextEncoder(), dec = new TextDecoder();
const b64url = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = s => crypto.subtle.digest('SHA-256', enc.encode(s));
const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
async function derive(secret) {
  const id = hex(await sha('exhibit-sync-id:' + secret));
  const key = await crypto.subtle.importKey('raw', await sha('exhibit-sync-key:' + secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { id, key };
}
const newSecret = () => b64url(crypto.getRandomValues(new Uint8Array(16)));
export const cleanSecret = s => String(s || '').trim().replace(/[^A-Za-z0-9_-]/g, '');
export const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').slice(0, 8);
export const prettyCode = c => c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c;
const appBase = () => location.origin + location.pathname.replace(/index\.html$/, '');
export const linkURL = () => link?.secret ? `${appBase()}#join=${link.secret}` : '';
/** Pull a sync key out of a scanned QR / pasted link. */
export function secretFrom(text) {
  const m = String(text || '').match(/[#&?]join=([A-Za-z0-9_-]{16,})/);
  return m ? m[1] : null;
}
export function codeFrom(text) {
  const m = String(text || '').match(/[#&?]code=([A-Za-z0-9-]{8,9})/);
  return m ? cleanCode(m[1]) : null;
}

// gzip → AES-GCM. Byte 0: format (1 = gzip, 2 = plain JSON for browsers without CompressionStream)
async function pack(obj) {
  const raw = enc.encode(JSON.stringify(obj));
  if ('CompressionStream' in window) {
    try { return { fmt: 1, bytes: new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()) }; } catch {}
  }
  return { fmt: 2, bytes: raw };
}
async function unpack(fmt, u8) {
  if (fmt === 1) {
    if (!('DecompressionStream' in window)) throw new Error('Update your browser to sync this account.');
    u8 = new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  return JSON.parse(dec.decode(u8));
}
async function seal(obj, key = keys.key) {
  const { fmt, bytes } = await pack(obj);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(13 + ct.length); out[0] = fmt; out.set(iv, 1); out.set(ct, 13);
  return out;
}
async function open(u, key = keys.key) {
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(1, 13) }, key, u.subarray(13)));
  return unpack(u[0], plain);
}

// ---------- relay (ntfy.sh): simple requests only, so no CORS pre-check ----------
const topicOf = id => 'ex' + id.slice(0, 40);
const FILE = 'account.ex';
const mine = new Set();
async function relayList(topic, since = 'all') {
  const r = await fetch(`${RELAY()}/${topic}/json?poll=1&since=${since}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status === 429 ? 'Sync is busy. Trying again shortly.' : `Sync relay error (${r.status})`);
  return (await r.text()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(m => m && m.event === 'message').sort((a, b) => a.time - b.time);
}
async function relayPost(topic, body, params = {}) {
  const r = await fetch(`${RELAY()}/${topic}?${new URLSearchParams({ firebase: 'no', ...params })}`, { method: 'POST', body });
  if (!r.ok) throw new Error(r.status === 413 ? 'Your account is too big for the free sync relay.' : r.status === 429 ? 'Sync is busy. Trying again shortly.' : `Sync relay error (${r.status})`);
  const res = await r.json(); if (res?.id) { mine.add(res.id); if (mine.size > 100) mine.delete(mine.values().next().value); }
  return res;
}
const liveFile = m => m.attachment?.url && m.attachment.name === FILE && (!m.attachment.expires || m.attachment.expires * 1000 > Date.now() + 30e3);
async function fetchFile(m) {
  const r = await fetch(m.attachment.url, { cache: 'no-store' });
  if (!r.ok) throw new Error('Couldn\'t download your account. Trying again shortly.');
  return new Uint8Array(await r.arrayBuffer());
}

// ---------- the synced account ----------
const credKey = c => `${c.id}#${c.edition}`;
function favMap() {
  const ts = lsGet(LS.favTs, {}), list = lsGet(LS.favs, []);
  const out = { ...ts };
  for (const k of list) if (!out[k]) out[k] = { on: true, t: 1 };
  return out;
}
async function snapshot() {
  const creds = (await listCollection()).map(e => ({ id: e.id, edition: e.edition, code: e.code, unlockedAt: e.unlockedAt })).sort((a, b) => credKey(a) < credKey(b) ? -1 : 1);
  const order = lsGet(LS.order);
  return { app: 'exhibit', v: 1, profile: profile(), creds, favs: favMap(), order: order ? { ...order, t: lsGet(LS.orderTs, 1) } : null, devices };
}
function mergeDevices(L = {}, R = {}) {
  const out = { ...L };
  for (const [id, r] of Object.entries(R || {})) {
    const l = out[id];
    if (!l) { out[id] = { ...r }; continue; }
    const win = (r.ts || 0) > (l.ts || 0) ? r : l;
    out[id] = { ...win, lastSeen: Math.max(l.lastSeen || 0, r.lastSeen || 0) };
  }
  return out;
}
export function merge(L, R) {
  const newer = (a, b, f) => !a ? b : !b ? a : (f(b) > f(a) ? b : a);
  const creds = new Map();
  for (const c of [...(L.creds || []), ...(R.creds || [])]) {
    const k = credKey(c), had = creds.get(k);
    if (!had || (c.unlockedAt || 0) < (had.unlockedAt || 0)) creds.set(k, c);
  }
  const favs = { ...(L.favs || {}) };
  for (const [k, r] of Object.entries(R.favs || {})) if (!favs[k] || (r.t || 0) > (favs[k].t || 0)) favs[k] = r;
  const lp = L.profile, rp = R.profile;
  return {
    app: 'exhibit', v: 1,
    profile: newer(lp, rp, p => p.updatedAt || 0),
    creds: [...creds.values()].sort((a, b) => credKey(a) < credKey(b) ? -1 : 1),
    favs, order: newer(L.order, R.order, o => o.t || 0),
    devices: mergeDevices(L.devices, R.devices),
  };
}
function hash(snap) {
  const dv = Object.fromEntries(Object.entries(snap.devices || {}).map(([k, d]) => [k, { n: d.name, r: !!d.removed, ts: d.ts }]));
  const s = JSON.stringify([snap.profile, snap.creds, snap.favs, snap.order, dv]);
  let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + s.length;
}

const failedCreds = new Set();
let restoring = null;
async function apply(m) {
  // profile
  const lp = profile();
  if (m.profile && (!lp || (m.profile.updatedAt || 0) > (lp.updatedAt || 0))) { lsSet(LS.acct, m.profile); emit('profile', m.profile); }
  // likes
  const favs = m.favs || {}, before = JSON.stringify(lsGet(LS.favs, []).sort());
  lsSet(LS.favTs, favs);
  const list = Object.entries(favs).filter(([, v]) => v.on).map(([k]) => k);
  lsSet(LS.favs, list);
  if (JSON.stringify([...list].sort()) !== before) {
    document.querySelectorAll('[data-fav]').forEach(el => el.setAttribute('aria-pressed', list.includes(el.dataset.fav)));
    emit('favs', list);
  }
  // order details
  if (m.order && (m.order.t || 0) > lsGet(LS.orderTs, 0)) { const { t, ...o } = m.order; lsSet(LS.order, o); lsSet(LS.orderTs, t); }
  // posters collected on other devices: unlock them here too (downloads the encrypted files)
  const have = new Set((await listCollection()).map(credKey));
  const missing = (m.creds || []).filter(c => !have.has(credKey(c)) && !failedCreds.has(credKey(c)));
  if (missing.length && !restoring) {
    restoring = (async () => {
      let n = 0;
      emit('restoring', { total: missing.length });
      for (const c of missing) {
        try { await unlock(`${c.id}.${c.edition}.${c.code}`); n++; } catch (e) { console.warn('sync restore', e); failedCreds.add(credKey(c)); }
      }
      if (n) emit('collection', { added: n });
    })().finally(() => { restoring = null; });
  }
}

// ---------- sync ----------
let running = null, again = false;
export async function syncNow({ force = false } = {}) {
  if (!link?.secret || !window.crypto?.subtle) return;
  if (!navigator.onLine) { setStatus('offline'); return; }
  if (running) { again = true; if (force) again = 'force'; return running; }
  running = (async () => {
    setStatus('syncing');
    try {
      let f = force;
      do { const a = again; again = false; await once(f || a === 'force'); f = false; } while (again && link);
      if (link) setStatus('synced');
    } catch (e) {
      console.warn('sync failed', e);
      setStatus('error', /Failed to fetch|NetworkError|Load failed/.test(e.message) ? 'Couldn\'t reach the sync server.' : e.message);
    } finally { running = null; }
  })();
  return running;
}
async function once(force) {
  keys = keys || await derive(link.secret);
  const topic = topicOf(keys.id);
  const msgs = (await relayList(topic, link.lastTs ? Math.max(0, link.lastTs - 5) : 'all')).filter(m => !mine.has(m.id));
  for (const m of msgs) {
    if (m.attachment || !m.message) continue;
    try { const note = await open(fromB64(m.message)); if (note?.t === 'off' && m.time * 1000 > (link.since || 0)) { leave({ wipe: true, reason: 'deleted' }); return; } } catch {}
  }
  if (!devices[DEV] || (devices[DEV].removed && (devices[DEV].ts || 0) <= (link.since || 0))) { devices[DEV] = { name: deviceName(), ts: Date.now(), lastSeen: Date.now() }; saveDevices(); }
  const local = await snapshot();
  let merged = local;
  for (const m of msgs.filter(liveFile)) {
    try { merged = merge(merged, await open(await fetchFile(m))); } catch (e) { console.warn('sync: skipped a copy', e); }
  }
  const dBefore = JSON.stringify(devices);
  devices = mergeDevices(devices, merged.devices); saveDevices();
  if (JSON.stringify(devices) !== dBefore) emit('devices', listDevices());
  if (devices[DEV]?.removed && (devices[DEV].ts || 0) > (link.since || 0)) { leave({ wipe: true, reason: 'removed' }); return; }
  merged.devices = devices;
  if (hash(merged) !== hash(local)) await apply(merged);
  if (msgs.length) link.lastTs = Math.max(link.lastTs || 0, msgs[msgs.length - 1].time);
  const now = Date.now() / 1000, stale = !link.pubTs || now - link.pubTs > 100 * 60;
  if (force || stale || hash(merged) !== link.hash) {
    devices[DEV] = { ...devices[DEV], lastSeen: Date.now() }; saveDevices();
    const res = await relayPost(topic, new Blob([await seal({ ...merged, devices })]), { filename: FILE, title: deviceName() });
    link.hash = hash(merged); link.pubTs = res.time || now; link.lastTs = Math.max(link.lastTs || 0, res.time || 0);
  }
  saveLink();
}

let es = null, timers = false;
function listen() {
  try { es?.close(); } catch {}
  es = null;
  if (!link || !window.EventSource) return;
  (keys ? Promise.resolve(keys) : derive(link.secret)).then(k => {
    keys = keys || k; if (!link) return;
    es = new EventSource(`${RELAY()}/${topicOf(keys.id)}/sse`);
    let t = null;
    es.onmessage = e => { let m = null; try { m = JSON.parse(e.data); } catch {} if (!m || m.event !== 'message' || mine.has(m.id)) return; clearTimeout(t); t = setTimeout(() => syncNow(), 800); };
  }).catch(() => {});
}
let pushT = null;
/** Something synced changed on this device (an unlock, a like, profile, order details): send it soon. */
export function changed() { if (!link) return; clearTimeout(pushT); pushT = setTimeout(() => syncNow(), 2500); }
export function start() {
  if (!link) return;
  syncNow(); listen();
  if (timers) return; timers = true;
  document.addEventListener('visibilitychange', () => {
    if (!link) return;
    if (document.visibilityState === 'visible') { if (Date.now() - S.lastSync > 5e3) syncNow(); if (!es || es.readyState === 2) listen(); }
    else syncNow();
  });
  addEventListener('online', () => { if (link) { syncNow(); listen(); } });
  setInterval(() => { if (document.visibilityState === 'visible' && link) syncNow(); }, 90e3);
  addEventListener('exhibit:changed', changed);
}

// ---------- create / join / leave ----------
export async function create({ name, picture = '' }) {
  if (!window.crypto?.subtle) throw new Error('Accounts need a secure (https://) connection.');
  const now = Date.now();
  lsSet(LS.acct, { id: b64url(crypto.getRandomValues(new Uint8Array(9))), name: String(name).trim().slice(0, 40), picture, createdAt: now, updatedAt: now });
  link = { secret: newSecret(), since: now }; keys = null;
  devices = { [DEV]: { name: deviceName(), ts: now, lastSeen: now } };
  saveLink(); saveDevices();
  start(); syncNow({ force: true });
  emit('profile', profile());
  return profile();
}
/** Is there an account posted under this key? */
export async function peek(secret) {
  const k = await derive(secret);
  const m = [...await relayList(topicOf(k.id))].reverse().find(liveFile);
  return m ? { device: m.title || '', updatedAt: m.time * 1000 } : null;
}
export async function join(secret, onStep = () => {}) {
  secret = cleanSecret(secret);
  if (secret.length < 16) throw new Error('That sign-in link isn\'t complete. Scan the QR code again.');
  onStep('Looking for your account…');
  const found = await peek(secret);
  if (!found) throw new Error('We couldn\'t find that account. Keep EXHIBIT open on your other device (so it can send your account) and try again.');
  const keepLocal = await snapshot();   // anything collected here before signing in joins the account
  link = { secret, since: Date.now() }; keys = null; saveLink();
  devices = {}; saveDevices();
  onStep(`Signing in from ${found.device || 'your other device'}…`);
  await syncNow();
  if (S.status === 'error') { const err = S.error; link = null; keys = null; saveLink(); setStatus('off'); throw new Error(err); }
  if (!profile()) { link = null; saveLink(); throw new Error('That account didn\'t send a profile. Try again in a moment.'); }
  if (keepLocal.creds.length) changed();
  start();
  emit('profile', profile());
  return profile();
}
// short codes: hand this device's sync key to another device for 15 minutes
const CODE_ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
async function codeKeys(code) {
  const topic = 'exc' + hex(await sha('exhibit-code-id:' + code)).slice(0, 40);
  const key = await crypto.subtle.importKey('raw', await sha('exhibit-code-key:' + code), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { topic, key };
}
export async function makeCode() {
  if (!link) throw new Error('Sign in first.');
  const code = [...crypto.getRandomValues(new Uint8Array(8))].map(b => CODE_ABC[b % 32]).join('');
  const k = await codeKeys(code);
  await relayPost(k.topic, toB64(await seal({ s: link.secret, exp: Date.now() + 15 * 60e3 }, k.key)));
  syncNow({ force: true });   // make sure a fresh copy of the account is waiting on the relay
  return { code, expires: Date.now() + 15 * 60e3 };
}
export async function redeemCode(code) {
  const c = cleanCode(code);
  if (c.length !== 8) throw new Error('Codes have 8 letters and numbers, like K7M2-Q9XA.');
  const k = await codeKeys(c);
  for (const m of (await relayList(k.topic, '20m')).reverse()) {
    try { const d = await open(fromB64(m.message), k.key); if (d?.s && d.exp > Date.now()) return d.s; } catch {}
  }
  throw new Error('That code didn\'t work. Check it, or make a new one on your other device (codes last 15 minutes).');
}

export function listDevices() {
  return Object.entries(devices).filter(([, d]) => !d.removed).map(([id, d]) => ({ id, ...d, me: id === DEV }))
    .sort((a, b) => (b.me - a.me) || ((b.lastSeen || 0) - (a.lastSeen || 0)));
}
export function removeDevice(id) {
  if (!devices[id]) return;
  devices[id] = { ...devices[id], removed: true, ts: Date.now() }; saveDevices(); emit('devices', listDevices());
  syncNow({ force: true });
}
export function updateProfile(patch) {
  const p = profile(); if (!p) return;
  const next = { ...p, ...patch, updatedAt: Date.now() };
  lsSet(LS.acct, next); emit('profile', next); changed();
  return next;
}
/** Sign this device out. wipe: also remove this account's posters/likes from the device. */
export async function leave({ wipe = true, reason = 'signout' } = {}) {
  link = null; keys = null; try { es?.close(); } catch {} es = null;
  for (const k of [LS.link, LS.devices, LS.acct, LS.favs, LS.favTs, LS.order, LS.orderTs]) lsSet(k, null);
  devices = {};
  if (wipe) {
    try { localStorage.removeItem('gh-credentials'); } catch {}
    for (const k of await db.keys('collection')) await db.del('collection', k);
  }
  setStatus('off');
  emit('signedout', { reason });
}
/** Sign out every device of this account (each one wipes its copy), then this one. */
export async function deleteEverywhere() {
  if (link) {
    keys = keys || await derive(link.secret);
    await relayPost(topicOf(keys.id), toB64(await seal({ t: 'off', at: Date.now() })));
  }
  await leave({ wipe: true, reason: 'deleted-here' });
}
export function restore() { if (link?.secret && profile()) start(); }

// ---------- picture helper ----------
export async function pictureFromFile(file, size = 192) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL('image/jpeg', .82);
  } finally { URL.revokeObjectURL(url); }
}
