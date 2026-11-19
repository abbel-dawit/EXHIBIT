// Artist-side publishing pipeline (used by the Studio in the browser and by tools/ in Node).
// Turns an artwork into encrypted files + a public gallery.json entry + per-edition unlock codes.
import {
  b64, unb64, hex, sha256, newContentKey, encryptBytes, encryptJSON, editionKey,
  newUnlockCode, newArtistKeys, signCertificate, keyFingerprint, makePayload, nfcKey, makeNfcPayload,
} from './crypto.js';

export const VAULT_VERSION = 1;

export async function createVault(artistName) {
  const keys = await newArtistKeys();
  return { app: 'golden-hour', type: 'artist-vault', v: VAULT_VERSION, created: new Date().toISOString(),
    artist: { name: artistName, publicJwk: keys.publicJwk, privateJwk: keys.privateJwk }, artworks: {} };
}

export const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'artwork';

async function fileName(id, name, bytes) {
  return `art/${id}/${name}.${hex(await sha256(bytes)).slice(0, 10)}.bin`;
}

/**
 * Create or update an artwork in the vault.
 * input: { id?, title, author, year, description, editionsTotal, effect: 'auto'|'video'|'golden-hour', preset,
 *          aspect, image: {bytes, mime}, overlay?: {bytes, mime} | null, target?: Uint8Array | null,
 *          teaser?: {bytes, mime} | null, publicTitle?: bool, nft?: {...}, contentHash?: hex of the original file,
 *          overlays?: [ AR overlays collectors swipe between, in order:
 *            { id, kind: 'effect', effect: 'golden-hour'|'auto', preset?, title }
 *            { id, kind: 'video', title, bytes?, mime? }   (bytes only when the video is new or changed) ] }
 * Content (image/overlay/target) is only re-encrypted when supplied.
 * Returns { id, files: { path: Uint8Array }, removed: [paths] }
 */
export async function upsertArtwork(vault, input) {
  const id = input.id || slugify(input.title);
  const prev = vault.artworks[id];
  const art = prev ? structuredClone(prev) : { id, K: b64(newContentKey()), codes: {}, revoked: [], files: {}, created: new Date().toISOString() };
  const K = unb64(art.K);
  const files = {}, removed = [];

  const put = async (name, bytes) => {
    const ct = await encryptBytes(K, bytes);
    const path = await fileName(id, name, ct);
    if (art.files[name] && art.files[name] !== path) removed.push(art.files[name]);
    art.files[name] = path; files[path] = ct;
  };

  if (input.image) {
    await put('image', input.image.bytes);
    art.contentHash = input.contentHash || hex(await sha256(input.image.bytes));
    art.imageMime = input.image.mime;
  }
  if (input.overlay === null || input.effect !== 'video') {
    if (art.files.overlay) { removed.push(art.files.overlay); delete art.files.overlay; delete art.overlayMime; }
  }
  if (input.overlay && input.effect === 'video') { await put('overlay', input.overlay.bytes); art.overlayMime = input.overlay.mime; }
  if (input.target) await put('target', input.target);
  // extra AR overlays (each video is its own encrypted file: ov-<id>)
  let overlays = null;
  if (Array.isArray(input.overlays)) {
    overlays = [];
    for (const o of input.overlays) {
      const oid = slugify(o.id || o.title || 'overlay').slice(0, 24) || 'overlay';
      if (o.kind === 'video') {
        const file = `ov-${oid}`;
        if (o.bytes) { await put(file, o.bytes); art.ovMime = { ...(art.ovMime || {}), [file]: o.mime || 'video/mp4' }; }
        if (!art.files[file]) continue;   // no video for this overlay
        overlays.push({ id: oid, kind: 'video', title: o.title || 'Video', file, mime: art.ovMime?.[file] || 'video/mp4' });
      } else overlays.push({ id: oid, kind: 'effect', effect: o.effect || 'auto', preset: o.preset || null, title: o.title || 'Living edition' });
    }
    for (const name of Object.keys(art.files)) if (name.startsWith('ov-') && !overlays.some(o => o.file === name)) { removed.push(art.files[name]); delete art.files[name]; }
  } else overlays = art.meta?.overlays || null;
  if (input.teaser) {
    const path = `art/${id}/teaser.${hex(await sha256(input.teaser.bytes)).slice(0, 10)}.jpg`;
    if (art.teaser && art.teaser !== path) removed.push(art.teaser);
    art.teaser = path; files[path] = input.teaser.bytes;
  }
  if (input.teaser === null && art.teaser) { removed.push(art.teaser); delete art.teaser; }

  art.meta = {
    title: input.title, author: input.author, year: input.year || '', description: input.description || '',
    effect: input.effect || 'auto', preset: input.preset || null, aspect: input.aspect || art.meta?.aspect || null,
    imageMime: art.imageMime, overlayMime: art.overlayMime || null, nft: 'nft' in input ? (input.nft || null) : (art.meta?.nft || null),
    overlays: overlays && overlays.length ? overlays : null,
  };
  art.publicTitle = !!input.publicTitle;
  art.editionsTotal = Math.max(1, Number(input.editionsTotal) || art.editionsTotal || 1);
  // meta is re-encrypted every time (cheap) so edits to title/NFT details publish
  await put('meta', new TextEncoder().encode(JSON.stringify({ ...art.meta, editionsTotal: art.editionsTotal })));
  // make sure every edition up to the total has a code
  for (let e = 1; e <= art.editionsTotal; e++) if (!art.codes[e]) art.codes[e] = newUnlockCode();
  if (!art.nfcCode) art.nfcCode = newUnlockCode();   // NFC tag secret (temporary previews)
  art.updated = new Date().toISOString();
  vault.artworks[id] = art;
  return { id, files, removed };
}

export function revokeEdition(vault, id, edition) {
  const a = vault.artworks[id]; if (!a) return;
  if (!a.revoked.includes(edition)) a.revoked.push(edition);
}
export function reissueEdition(vault, id, edition) {
  const a = vault.artworks[id]; if (!a) return;
  a.codes[edition] = newUnlockCode();
  a.revoked = a.revoked.filter(e => e !== edition);
}
/** New NFC tag secret: every tag written with the old link stops opening previews after you publish. */
export function reissueNfc(vault, id) {
  const a = vault.artworks[id]; if (!a) return;
  a.nfcCode = newUnlockCode();
}
/** The link to write onto this artwork's NFC tags. */
export function nfcLink(vault, id, siteURL) {
  const a = vault.artworks[id];
  if (!a.nfcCode) a.nfcCode = newUnlockCode();
  const base = siteURL.replace(/[#?].*$/, '').replace(/\/?$/, '/');
  return `${base}#n=${makeNfcPayload(id, a.nfcCode)}`;
}

export function deleteArtwork(vault, id) {
  const a = vault.artworks[id]; if (!a) return [];
  delete vault.artworks[id];
  return [...Object.values(a.files), a.teaser].filter(Boolean);
}

/** Public manifest entry: wrapped keys + encrypted signed certificates for each live edition. */
export async function manifestEntry(vault, id) {
  const a = vault.artworks[id];
  const K = unb64(a.K);
  const keyId = await keyFingerprint(vault.artist.publicJwk);
  const editions = {};
  for (let e = 1; e <= a.editionsTotal; e++) {
    if (a.revoked.includes(e)) continue;
    const ek = await editionKey(a.codes[e], id, e);
    const cert = await signCertificate(vault.artist.privateJwk, {
      v: 1, type: 'certificate-of-authenticity', artwork: id, edition: e, editions: a.editionsTotal,
      title: a.meta.title, author: a.meta.author, year: a.meta.year || '', issuer: vault.artist.name, keyId,
      contentHash: a.contentHash, issued: a.created.slice(0, 10),
    });
    editions[e] = { k: b64(await encryptBytes(ek, K)), c: b64(await encryptJSON(ek, cert)) };
  }
  const entry = { id, added: a.created.slice(0, 10), editionsTotal: a.editionsTotal, files: { ...a.files }, editions };
  if (a.nfcCode) entry.nfc = { k: b64(await encryptBytes(await nfcKey(a.nfcCode, id), K)) };
  if (a.teaser) entry.teaser = a.teaser;
  if (a.publicTitle) entry.publicTitle = a.meta.title;
  return entry;
}

/** Build the full public gallery.json from the vault. */
export async function buildGallery(vault, { order } = {}) {
  const ids = order || Object.keys(vault.artworks).sort((x, y) => vault.artworks[y].created.localeCompare(vault.artworks[x].created));
  const artworks = [];
  for (const id of ids) if (vault.artworks[id]) artworks.push(await manifestEntry(vault, id));
  const { kty, crv, x, y } = vault.artist.publicJwk;
  return { app: 'golden-hour', v: 1, updated: new Date().toISOString(),
    artist: { name: vault.artist.name, publicKey: { kty, crv, x, y }, keyId: await keyFingerprint(vault.artist.publicJwk) }, artworks };
}

/** Everything the artist needs to print and track editions. */
export function editionList(vault, id, siteURL) {
  const a = vault.artworks[id];
  const base = siteURL.replace(/[#?].*$/, '').replace(/\/?$/, '/');
  return Array.from({ length: a.editionsTotal }, (_, i) => {
    const e = i + 1, code = a.codes[e], payload = makePayload(id, e, code);
    return { edition: e, code, payload, url: `${base}#u=${payload}`, revoked: a.revoked.includes(e) };
  });
}

/** ERC-721 style metadata for each edition (attach to your mint). */
export function nftMetadata(vault, id, imageURI = '') {
  const a = vault.artworks[id];
  return Array.from({ length: a.editionsTotal }, (_, i) => ({
    name: `${a.meta.title} #${i + 1}/${a.editionsTotal}`,
    description: `${a.meta.description || a.meta.title}\n\nPhysical poster with living AR edition. Certificate of authenticity signed by ${vault.artist.name}.`,
    image: imageURI,
    attributes: [
      { trait_type: 'Artist', value: a.meta.author || vault.artist.name },
      { trait_type: 'Edition', value: i + 1, max_value: a.editionsTotal, display_type: 'number' },
      { trait_type: 'Year', value: String(a.meta.year || '') },
      { trait_type: 'Animated', value: a.meta.effect === 'video' ? 'Artist video' : 'Living overlay' },
      { trait_type: 'Content SHA-256', value: a.contentHash },
    ],
  }));
}
