// Collection backups: a small file the collector can keep on the device or share anywhere
// (Files, Drive, iCloud, email, WhatsApp…), and restore later on any device.
import { db } from './db.js';
import { b64, unb64, sealWithPassphrase, openWithPassphrase, makePayload } from './crypto.js';
import { listCollection, loadGallery, unlock } from './gallery.js';

export async function buildBackup({ includeFiles = true, passphrase = '' } = {}) {
  const items = await listCollection();
  const gallery = await loadGallery();
  const ids = new Set(items.map(i => i.id));
  const payload = {
    app: 'golden-hour', type: 'collection-backup', v: 1, created: new Date().toISOString(),
    site: location.origin + location.pathname.replace(/[^/]*$/, ''),
    items: items.map(i => ({ id: i.id, edition: i.edition, code: i.code, unlockedAt: i.unlockedAt })),
    snapshot: { artist: gallery.artist, artworks: (gallery.artworks || []).filter(a => ids.has(a.id)) },
  };
  if (includeFiles) {
    payload.files = {};
    for (const i of items) for (const [name, path] of Object.entries(i.files || {})) {
      const k = `${i.id}/${name}`; if (payload.files[k]) continue;
      const a = await db.get('assets', k);
      if (a) payload.files[k] = { path: a.path, data: b64(a.data) };   // files stay encrypted
    }
  }
  const body = passphrase ? { app: 'golden-hour', type: 'collection-backup', ...(await sealWithPassphrase(passphrase, payload)) } : payload;
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `golden-hour-collection-${stamp}.ghbackup`;
  return { file: new File([JSON.stringify(body)], name, { type: 'application/json' }), count: items.length };
}

export async function saveBackupToDevice(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  await markBackedUp();
}

/** Opens the system share sheet. Returns false if sharing files isn't supported here. */
export async function shareBackup(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'EXHIBIT collection backup', text: 'My EXHIBIT collection backup. Keep it safe: it unlocks my posters.' });
      await markBackedUp();
      return true;
    } catch (e) { if (e?.name === 'AbortError') return true; }
  }
  return false;
}

export const markBackedUp = () => db.put('kv', 'lastBackup', Date.now());
export const lastBackup = () => db.get('kv', 'lastBackup');

export async function readBackupFile(file) {
  const json = JSON.parse(await file.text());
  if (json.app !== 'golden-hour' || json.type !== 'collection-backup') throw new Error('This isn\'t an EXHIBIT backup file.');
  return json;
}

/** Restore. Throws {code:'needs-passphrase'} if the file is password protected. */
export async function restoreBackup(json, passphrase, onP = () => {}) {
  let data = json;
  if (json.sealed) {
    if (!passphrase) { const e = new Error('This backup is password protected.'); e.code = 'needs-passphrase'; throw e; }
    try { data = await openWithPassphrase(passphrase, json); } catch { const e = new Error('Wrong password.'); e.code = 'bad-passphrase'; throw e; }
  }
  if (data.files) for (const [k, f] of Object.entries(data.files)) await db.put('assets', k, { path: f.path, data: unb64(f.data) });
  const results = { restored: 0, already: 0, failed: [] };
  let n = 0;
  for (const it of data.items || []) {
    try {
      const r = await unlock(makePayload(it.id, it.edition, it.code), () => {}, { snapshot: data.snapshot });
      r.already ? results.already++ : results.restored++;
    } catch (e) { results.failed.push({ ...it, reason: e.message }); }
    onP(++n / (data.items.length || 1));
  }
  return results;
}
