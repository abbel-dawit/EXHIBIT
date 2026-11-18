// EXHIBIT: cryptography (runs in browsers and in Node 20+, WebCrypto only, no libraries)
//
// Model
//   • Each artwork has a random 256-bit content key K. Every file of the artwork (meta, image,
//     overlay, recognition target) is AES-256-GCM encrypted with K and published as ciphertext.
//   • Each sold poster (edition) has its own 100-bit unlock code, printed as a QR code.
//     editionKey = HKDF-SHA256(code, salt = "<artworkId>#<edition>")
//     The public gallery.json stores K wrapped with each edition key, plus that edition's
//     certificate (also encrypted). Without a valid code the files are unreadable.
//   • Certificates of authenticity are signed by the artist (ECDSA P-256). The artist's public key
//     is in gallery.json; the private key never leaves the artist's vault.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- encoding ----------
export function b64(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(str) {
  const s = atob(str); const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = s => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
export const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

// Crockford base32: unambiguous, easy to type (no I, L, O, U)
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function toBase32(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function fromBase32(str) {
  const clean = normaliseCode(str);
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) { const v = B32.indexOf(ch); if (v < 0) throw new Error('bad-code'); value = (value << 5) | v; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
/** Uppercase, strip separators, map look-alikes (O→0, I/L→1). */
export function normaliseCode(s) {
  return String(s).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}
export const formatCode = c => normaliseCode(c).match(/.{1,5}/g).join('-');
export const randomBytes = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
/** 20-character code = 100 bits of entropy. */
export const newUnlockCode = () => toBase32(randomBytes(13)).slice(0, 20);

// ---------- hashing ----------
export async function sha256(data) {
  const buf = typeof data === 'string' ? enc.encode(data) : data;
  return new Uint8Array(await subtle.digest('SHA-256', buf));
}

// ---------- AES-GCM ----------
export const newContentKey = () => randomBytes(32);
const importAes = (raw, usages = ['encrypt', 'decrypt']) => subtle.importKey('raw', raw, 'AES-GCM', false, usages);

/** Encrypt bytes → iv(12) ‖ ciphertext+tag */
export async function encryptBytes(rawKeyOrKey, data) {
  const key = rawKeyOrKey instanceof Uint8Array ? await importAes(rawKeyOrKey) : rawKeyOrKey;
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
export async function decryptBytes(rawKeyOrKey, blob) {
  const key = rawKeyOrKey instanceof Uint8Array ? await importAes(rawKeyOrKey) : rawKeyOrKey;
  const u = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, key, u.subarray(12)));
}
export const encryptJSON = async (key, obj) => encryptBytes(key, enc.encode(JSON.stringify(obj)));
export const decryptJSON = async (key, blob) => JSON.parse(dec.decode(await decryptBytes(key, blob)));

// ---------- edition keys ----------
export async function editionKey(code, artworkId, edition) {
  const ikm = await subtle.importKey('raw', enc.encode(normaliseCode(code)), 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(`${artworkId}#${edition}`), info: enc.encode('golden-hour/edition/v1') },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// ---------- NFC preview keys ----------
// Every artwork can carry one NFC tag secret. It unwraps the content key for a temporary,
// in-memory preview only: nothing is saved, so the tag has to be scanned again next time.
export async function nfcKey(code, artworkId) {
  const ikm = await subtle.importKey('raw', enc.encode(normaliseCode(code)), 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(`${artworkId}#nfc`), info: enc.encode('exhibit/nfc-preview/v1') },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// NFC tag link payload: #n=<artworkId>.<code>
export const makeNfcPayload = (artworkId, code) => `${artworkId}.${normaliseCode(code)}`;
export function parseNfcPayload(text) {
  if (!text) return null;
  let s = String(text).trim();
  const m = s.match(/[#&?]n=([^&#\s]+)/);
  if (!m) return null;
  s = decodeURIComponent(m[1]);
  const p = s.match(/^([a-z0-9][a-z0-9-]{0,63})\.([0-9A-Za-z-]{16,40})$/);
  return p ? { id: p[1], code: normaliseCode(p[2]) } : null;
}

// ---------- passphrase (vaults & backups) ----------
export async function passphraseKey(pass, salt, iterations = 310000) {
  const base = await subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealWithPassphrase(pass, obj) {
  const salt = randomBytes(16), iterations = 310000;
  const key = await passphraseKey(pass, salt, iterations);
  return { sealed: 1, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), data: b64(await encryptJSON(key, obj)) };
}
export async function openWithPassphrase(pass, sealed) {
  const key = await passphraseKey(pass, unb64(sealed.salt), sealed.iterations);
  return decryptJSON(key, unb64(sealed.data));
}

// ---------- signatures (certificates) ----------
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
export async function newArtistKeys() {
  const kp = await subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  return { publicJwk: await subtle.exportKey('jwk', kp.publicKey), privateJwk: await subtle.exportKey('jwk', kp.privateKey) };
}
/** Stable JSON: sorted keys, so signatures verify regardless of property order. */
export function canonical(obj) {
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  if (obj && typeof obj === 'object') return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
  return JSON.stringify(obj);
}
export async function signCertificate(privateJwk, cert) {
  const key = await subtle.importKey('jwk', privateJwk, ECDSA, false, ['sign']);
  const { sig, ...body } = cert;
  const s = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(canonical(body)));
  return { ...body, sig: b64url(new Uint8Array(s)) };
}
export async function verifyCertificate(publicJwk, cert) {
  try {
    const { kty, crv, x, y } = publicJwk;
    const key = await subtle.importKey('jwk', { kty, crv, x, y }, ECDSA, false, ['verify']);
    const { sig, ...body } = cert;
    return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64url(sig), enc.encode(canonical(body)));
  } catch { return false; }
}
export async function keyFingerprint(publicJwk) {
  return hex(await sha256(canonical({ crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x, y: publicJwk.y }))).slice(0, 16).toUpperCase().match(/.{4}/g).join(' ');
}

// ---------- unlock links ----------
// QR / link payload: <artworkId>.<edition>.<code>
export function makePayload(artworkId, edition, code) { return `${artworkId}.${edition}.${normaliseCode(code)}`; }
export function parsePayload(text) {
  if (!text) return null;
  let s = String(text).trim();
  const m = s.match(/[#&?]u=([^&#\s]+)/);
  if (m) s = decodeURIComponent(m[1]);
  const p = s.match(/^([a-z0-9][a-z0-9-]{0,63})\.(\d{1,6})\.([0-9A-Za-z-]{16,40})$/);
  if (p) return { id: p[1], edition: Number(p[2]), code: normaliseCode(p[3]) };
  const bare = normaliseCode(s);                     // just the printed code
  if (bare.length === 20) return { code: bare };
  return null;
}
