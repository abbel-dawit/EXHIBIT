// EXHIBIT: Artist Studio
// Add artworks, choose their animation (auto-generated or the artist's own video), create numbered
// editions with unique unlock QR codes, attach NFT details, and publish to GitHub Pages.
import { sealWithPassphrase, openWithPassphrase, unb64, decryptBytes, hex, sha256, keyFingerprint, formatCode } from '../js/crypto.js';
import { createVault, upsertArtwork, manifestEntry, buildGallery, editionList, nftMetadata, revokeEdition, reissueEdition, deleteArtwork, slugify, nfcLink, reissueNfc } from '../js/publish.js';
import { analyzeImage, PRESETS } from '../js/analyze.js';
import { compileTarget } from '../js/recognition.js';
import { makeZip } from '../js/zip.js';
import { publishToGitHub } from '../js/github.js';
import { qrToCanvas } from '../js/qr.js';
import { applyTheme, mountThemeButton } from '../js/theme.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (t, ms = 2800) => { const el = $('#toast'); el.innerHTML = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), ms); };
const MAX_FILE = 95 * 1024 * 1024;   // GitHub's per-file limit is 100 MB
const DIST_MAX_SIDE = 2400;          // artwork resolution delivered to phones

// ---------------- studio storage (artist's device only) ----------------
const sdb = (() => {
  let p; const open = () => p ||= new Promise((res, rej) => { const r = indexedDB.open('golden-hour-studio', 1); r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('files'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const run = (store, mode, fn) => open().then(db => new Promise((res, rej) => { const t = db.transaction(store, mode); let out; const q = fn(t.objectStore(store)); if (q) q.onsuccess = () => out = q.result; t.oncomplete = () => res(out); t.onerror = () => rej(t.error); }));
  return { get: (s, k) => run(s, 'readonly', st => st.get(k)), put: (s, k, v) => run(s, 'readwrite', st => st.put(v, k)), del: (s, k) => run(s, 'readwrite', st => st.delete(k)) };
})();
const settings = {
  get() { try { return JSON.parse(localStorage.getItem('gh-studio-settings') || '{}'); } catch { return {}; } },
  set(v) { localStorage.setItem('gh-studio-settings', JSON.stringify({ ...settings.get(), ...v })); },
};
const siteURL = () => settings.get().siteURL || new URL('../', location.href).href;

let vault = null, password = null;

async function saveVault() {
  vault.pending ||= { files: [], remove: [] };
  await sdb.put('kv', 'vault', await sealWithPassphrase(password, vault));
  renderMain();
}
function markPending(files = [], removed = []) {
  vault.pending ||= { files: [], remove: [] };
  for (const f of files) { if (!vault.pending.files.includes(f)) vault.pending.files.push(f); vault.pending.remove = vault.pending.remove.filter(r => r !== f); }
  for (const r of removed) { vault.pending.files = vault.pending.files.filter(f => f !== r); if (!vault.pending.remove.includes(r)) vault.pending.remove.push(r); }
  vault.pending.manifest = true;
}

// ---------------- lock screen ----------------
async function showLock() {
  vault = null; password = null;
  $('#screen-main').hidden = true; $('#nav-actions').hidden = true; $('#screen-lock').hidden = false;
  $('#lock-remembered').hidden = !(await sdb.get('kv', 'vault'));
}
async function openVault(sealed, pw) {
  try {
    const v = await openWithPassphrase(pw, sealed);
    if (v.type !== 'artist-vault') throw new Error('Not a vault');
    vault = v; password = pw;
    await sdb.put('kv', 'vault', sealed);
    $('#screen-lock').hidden = true; $('#screen-main').hidden = false; $('#nav-actions').hidden = false;
    renderMain();
  } catch { $('#lock-err').textContent = 'Wrong password or not a vault file.'; }
}
let fileSealed = null;
$('#vault-file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { fileSealed = JSON.parse(await f.text()); $('#vf-pw').hidden = false; $('#pw-file').focus(); } catch { $('#lock-err').textContent = 'That file isn\'t a vault.'; }
});

// ---------------- main list ----------------
async function decryptFile(art, name) {
  const path = art.files[name]; if (!path) return null;
  let bytes = await sdb.get('files', path);
  if (!bytes) { const r = await fetch('../' + path).catch(() => null); if (r?.ok) { bytes = new Uint8Array(await r.arrayBuffer()); await sdb.put('files', path, bytes); } }
  return bytes ? decryptBytes(unb64(art.K), bytes) : null;
}
const thumbCache = new Map();
async function artThumb(art) {
  const k = art.files.image; if (thumbCache.has(k)) return thumbCache.get(k);
  const bytes = await decryptFile(art, 'image').catch(() => null);
  const url = bytes ? URL.createObjectURL(new Blob([bytes], { type: art.imageMime || 'image/jpeg' })) : '';
  thumbCache.set(k, url); return url;
}

async function renderMain() {
  if (!vault) return;
  $('#artist-line').textContent = `Signed in as ${vault.artist.name}`;
  $('#key-line').textContent = `Artist key ${await keyFingerprint(vault.artist.publicJwk)}`;
  const arts = Object.values(vault.artworks).sort((a, b) => b.created.localeCompare(a.created));
  const p = vault.pending || {};
  const nChanges = (p.files?.length || 0) + (p.remove?.length || 0) + (p.manifest ? 1 : 0);
  $('#pending-bar').hidden = !nChanges;
  $('#pending-text').innerHTML = `<b>Unpublished changes.</b> ${p.files?.length || 0} file(s) to upload${p.remove?.length ? `, ${p.remove.length} to remove` : ''}. Publish so collectors get them.`;
  const urls = await Promise.all(arts.map(artThumb));
  $('#art-grid').innerHTML = arts.length ? arts.map((a, i) => `<div class="card art-card">
      <div class="card-img">${urls[i] ? `<img src="${urls[i]}" alt="">` : ''}<span class="card-edition">${a.editionsTotal} ed.</span></div>
      <div class="card-body">
        <div class="card-title">${esc(a.meta.title)}</div>
        <div class="card-meta">by ${esc(a.meta.author)} · ${esc({ auto: 'Auto animation', video: 'Artist video', 'golden-hour': 'Signature effect' }[a.meta.effect] || a.meta.effect)}${a.revoked.length ? ` · ${a.revoked.length} revoked` : ''}</div>
        <div class="card-badges">${a.files.target ? '<span class="mini-badge ok">✓ Fast recognition</span>' : '<span class="mini-badge">Recognition builds on phones</span>'}${a.meta.nft?.contract ? '<span class="mini-badge nft">NFT linked</span>' : ''}</div>
        <div class="art-actions">
          <button class="btn btn-ghost" data-edit="${a.id}">Edit</button>
          <button class="btn btn-gold" data-editions="${a.id}">Editions & QR</button>
          <button class="btn btn-ghost" data-nft="${a.id}">NFT</button>
          <button class="btn btn-ghost" data-nfc="${a.id}">NFC tag</button>
          <button class="btn btn-ghost" data-ov="${a.id}">AR overlays</button>
        </div>
      </div></div>`).join('')
    : `<div class="empty-state"><h3>No artworks yet</h3><p>Add your first artwork. You'll choose its animation, set how many posters you're selling, and get a unique QR code for each one.</p><button class="btn btn-gold btn-lg" data-act="add">+ Add artwork</button></div>`;
}

// ---------------- sheet ----------------
let sheetCleanup = null;
function openSheet(html, mount) {
  closeSheet(true);
  { const o = $('#sheet-body'), f = o.cloneNode(false); o.replaceWith(f); }
  $('#sheet-body').innerHTML = html; $('#sheet').hidden = false; document.body.classList.add('locked');
  sheetCleanup = mount?.($('#sheet-body')) || null;
}
function closeSheet(instant) {
  if ($('#sheet').hidden) return;
  try { sheetCleanup?.(); } catch {} sheetCleanup = null;
  const done = () => { $('#sheet').hidden = true; $('#sheet-body').innerHTML = ''; document.body.classList.remove('locked'); };
  if (instant) return done();
  $('.sheet').classList.add('closing'); setTimeout(() => { $('.sheet').classList.remove('closing'); done(); }, 240);
}

// ---------------- artwork editor ----------------
async function fileBytes(f) { return new Uint8Array(await f.arrayBuffer()); }
async function loadImg(url) { const i = new Image(); i.src = url; await i.decode(); return i; }
function canvasToBytes(c, type = 'image/jpeg', q = 0.9) { return new Promise(r => c.toBlob(async b => r(new Uint8Array(await b.arrayBuffer())), type, q)); }
function resize(img, max) {
  const w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height); return c;
}
function teaserFrom(img) {
  const small = resize(img, 40);
  const c = document.createElement('canvas'); c.width = 360; c.height = Math.round(360 * small.height / small.width);
  const g = c.getContext('2d'); g.filter = 'blur(10px)'; g.imageSmoothingQuality = 'low'; g.drawImage(small, -20, -20, c.width + 40, c.height + 40);
  return c;
}

async function openEditor(id) {
  const art = id ? vault.artworks[id] : null;
  const m = art?.meta || {};
  const ed = { effect: m.effect || 'auto', preset: m.preset || null, image: null, video: null, imageURL: null, videoURL: null, analysis: null, aspect: m.aspect };
  const html = `<div class="create-head"><div class="eyebrow">${art ? 'Edit artwork' : 'New artwork'}</div><h2>${art ? esc(m.title) : 'Add an artwork'}</h2></div>
  <div class="create" style="margin-top:16px">
    <div class="stack">
      <div class="create-stage" id="ed-stage" style="aspect-ratio:${m.aspect ? `1/${m.aspect}` : '4/3'}">
        <label class="drop" id="ed-drop" style="margin:0;min-height:100%;position:absolute;inset:0;border-radius:inherit">
          <input type="file" id="ed-image" accept="image/*">
          <span class="plus"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>
          <strong>${art ? 'Replace artwork image' : 'Choose the artwork'}</strong><span>The same file you print. JPG or PNG, any size.</span>
        </label>
      </div>
      <div id="ed-imginfo" class="help" style="margin:0"></div>
    </div>
    <div class="create-panel">
      <div class="field"><label for="ed-title">Title *</label><input type="text" id="ed-title" value="${esc(m.title || '')}" placeholder="e.g. Golden Hour"></div>
      <div class="row2">
        <div class="field"><label for="ed-author">Author *</label><input type="text" id="ed-author" value="${esc(m.author || vault.artist.name)}"></div>
        <div class="field"><label for="ed-year">Year</label><input type="text" id="ed-year" value="${esc(m.year || new Date().getFullYear())}" inputmode="numeric"></div>
      </div>
      <div class="field"><label for="ed-desc">Description</label><textarea id="ed-desc" placeholder="A few lines collectors will see">${esc(m.description || '')}</textarea></div>
      <div class="field"><label for="ed-editions">Number of posters (editions)</label><input type="number" id="ed-editions" min="1" max="10000" value="${art?.editionsTotal || 25}"></div>
      <div class="field"><label>Moving overlay</label>
        <div class="seg" id="ed-seg">
          <button data-fx="auto">Auto-generate</button>
          <button data-fx="video">Upload video</button>
          ${m.effect === 'golden-hour' ? '<button data-fx="golden-hour">Signature</button>' : ''}
        </div>
      </div>
      <div id="ed-fx"></div>
      <label class="toggle"><span>Public teaser<small>Show a heavily blurred preview to people who haven't unlocked it yet</small></span><input type="checkbox" id="ed-teaser" ${art?.teaser || !art ? 'checked' : ''}></label>
      <label class="toggle"><span>Public title<small>Show the title on the locked teaser</small></span><input type="checkbox" id="ed-ptitle" ${art?.publicTitle ? 'checked' : ''}></label>
      <div class="progress" id="ed-prog" hidden><i></i></div><p class="help" id="ed-status" style="margin:0"></p>
      <div class="create-actions">
        ${art ? '<button class="btn btn-danger" id="ed-del">Delete</button>' : '<button class="btn btn-ghost" data-act="close">Cancel</button>'}
        <button class="btn btn-gold" id="ed-save">${art ? 'Save changes' : 'Create artwork'}</button>
      </div>
    </div>
  </div>`;
  openSheet(html, body => {
    let preview = null, gone = false;
    const stage = $('#ed-stage', body);
    const refreshPreview = async () => {
      if (!ed.imageURL || gone) return;
      const meta = { effect: ed.effect, preset: ed.preset };
      if (ed.effect === 'video' && !ed.videoURL) meta.effect = 'auto';
      const artObj = { meta, imageURL: ed.imageURL, overlayURL: ed.videoURL, analysis: ed.analysis };
      try {
        const { LivePreview } = await import('../js/preview.js');
        if (gone) return;
        if (!preview) { $('#ed-drop', body).style.opacity = '0'; preview = new LivePreview(stage, artObj); }
        else await preview.setArt(artObj);
      } catch (e) { console.warn('preview', e); $('#ed-drop', body).style.opacity = '.0'; stage.style.background = `center/cover url(${ed.imageURL})`; }
    };
    const fxPanel = () => {
      $$('#ed-seg button', body).forEach(b => b.setAttribute('aria-pressed', b.dataset.fx === ed.effect));
      const box = $('#ed-fx', body);
      if (ed.effect === 'auto') {
        const auto = ed.analysis?.preset;
        box.innerHTML = `<div class="chips">${Object.entries(PRESETS).map(([k, v]) => `<button class="chip" data-preset="${k}" aria-pressed="${(ed.preset || auto) === k}">${esc(v.label)}${k === auto ? '<span class="auto">Auto</span>' : ''}</button>`).join('')}</div>
          <p class="help">A simple moving version generated from the artwork itself: drifting sky, glowing lights, floating particles. No AI, nothing leaves your device.</p>`;
      } else if (ed.effect === 'video') {
        box.innerHTML = `<label class="btn btn-ghost btn-block filebtn">${ed.video ? '✓ ' + esc(ed.video.name) : (art?.files.overlay ? '✓ Video attached: choose to replace' : 'Choose video (.mp4 or .mov)')}<input type="file" id="ed-video" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v"></label>
          <p class="help">Your video is attached to the artwork automatically: it's scaled and cropped to the artwork's shape and loops silently. Best results: same framing as the artwork, 10–20 s seamless loop, MP4 (H.264), under 30 MB.</p><div id="ed-vwarn"></div>`;
        $('#ed-video', box).addEventListener('change', async e => {
          const f = e.target.files[0]; if (!f) return;
          const warn = $('#ed-vwarn', box); warn.innerHTML = '';
          if (f.size > MAX_FILE) { warn.innerHTML = '<p class="warn">This video is over 95 MB. GitHub can\'t host files that big. Please export a smaller version.</p>'; return; }
          const mime = f.type || (f.name.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4');
          const v = document.createElement('video'); const can = v.canPlayType(mime);
          const url = URL.createObjectURL(f);
          const ok = await new Promise(res => { v.muted = true; v.preload = 'metadata'; v.onloadedmetadata = () => res(true); v.onerror = () => res(false); v.src = url; setTimeout(() => res(false), 8000); });
          const notes = [];
          if (!ok) notes.push('This browser couldn\'t play the video. Collectors\' phones may not either. Export as MP4 (H.264).');
          else {
            if (mime === 'video/quicktime') notes.push('.mov plays on iPhone and most Android phones. MP4 (H.264) is the safest choice for every phone.');
            const va = v.videoHeight / v.videoWidth;
            if (ed.aspect && Math.abs(va - ed.aspect) / ed.aspect > 0.08) notes.push(`The video's shape differs from the artwork, so it will be cropped to fit (video ${v.videoWidth}×${v.videoHeight}).`);
            if (v.duration > 60) notes.push('Long videos make the download bigger. A short seamless loop works best.');
          }
          if (f.size > 30 * 1024 * 1024) notes.push(`Large file (${(f.size / 1048576).toFixed(0)} MB): collectors download it once when unlocking.`);
          warn.innerHTML = notes.map(n => `<p class="warn" style="margin-top:8px">${esc(n)}</p>`).join('');
          ed.video = { file: f, mime }; ed.videoURL = url;
          e.target.closest('label').firstChild.textContent = '✓ ' + f.name;
          refreshPreview();
        });
      } else box.innerHTML = '<p class="help">Hand-tuned signature animation for this artwork.</p>';
    };
    body.addEventListener('click', e => {
      const fx = e.target.closest('[data-fx]'); if (fx) { ed.effect = fx.dataset.fx; fxPanel(); refreshPreview(); }
      const pr = e.target.closest('[data-preset]'); if (pr) { ed.preset = pr.dataset.preset; fxPanel(); refreshPreview(); }
    });
    $('#ed-image', body).addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      const url = URL.createObjectURL(f);
      try {
        const img = await loadImg(url);
        ed.image = { file: f, img, originalHash: hex(await sha256(await fileBytes(f))) };
        ed.aspect = img.naturalHeight / img.naturalWidth;
        ed.analysis = analyzeImage(img);
        if (!ed.preset) ed.preset = ed.analysis.preset;
        const dist = resize(img, DIST_MAX_SIDE);
        ed.imageURL = URL.createObjectURL(await new Promise(r => dist.toBlob(r, 'image/jpeg', 0.9)));
        stage.style.aspectRatio = `1 / ${ed.aspect}`;
        $('#ed-imginfo', body).innerHTML = `${img.naturalWidth}×${img.naturalHeight}px · trackability <b>${ed.analysis.score}/100</b>${ed.analysis.score < 35 ? ' · low detail: may be hard to recognise' : ''}${Math.max(img.naturalWidth, img.naturalHeight) < 3000 ? ' · ⚠ low resolution for large prints' : ''}`;
        if (!$('#ed-title', body).value) $('#ed-title', body).value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        fxPanel(); refreshPreview();
      } catch { toast('Couldn\'t read that image.'); }
    });
    // existing artwork → decrypt for preview
    if (art) (async () => {
      const bytes = await decryptFile(art, 'image');
      if (!bytes || gone) return;
      ed.imageURL = URL.createObjectURL(new Blob([bytes], { type: art.imageMime }));
      const img = await loadImg(ed.imageURL); ed.aspect = img.naturalHeight / img.naturalWidth; ed.analysis = analyzeImage(img);
      if (art.files.overlay) { const vb = await decryptFile(art, 'overlay'); if (vb) ed.videoURL = URL.createObjectURL(new Blob([vb], { type: art.overlayMime })); }
      fxPanel(); refreshPreview();
    })();
    fxPanel();

    $('#ed-save', body).addEventListener('click', async () => {
      const title = $('#ed-title', body).value.trim(), author = $('#ed-author', body).value.trim();
      if (!title || !author) return toast('Title and author are required.');
      if (!art && !ed.image) return toast('Choose the artwork image first.');
      if (ed.effect === 'video' && !ed.video && !art?.files.overlay) return toast('Choose a video, or switch to Auto-generate.');
      const btn = $('#ed-save', body), prog = $('#ed-prog', body), st = $('#ed-status', body);
      btn.disabled = true; prog.hidden = false;
      const step = (t, p) => { st.textContent = t; $('i', prog).style.width = p + '%'; };
      try {
        const input = {
          id: art?.id || uniqueId(slugify(title)), title, author, year: $('#ed-year', body).value.trim(), description: $('#ed-desc', body).value.trim(),
          editionsTotal: Number($('#ed-editions', body).value) || 1, effect: ed.effect, preset: ed.preset, aspect: ed.aspect,
          publicTitle: $('#ed-ptitle', body).checked, nft: m.nft || null,
        };
        if (ed.image) {
          step('Preparing artwork…', 5);
          const dist = resize(ed.image.img, DIST_MAX_SIDE);
          input.image = { bytes: await canvasToBytes(dist, 'image/jpeg', 0.9), mime: 'image/jpeg' };
          input.contentHash = ed.image.originalHash;
          step('Building fast camera recognition…', 10);
          try { input.target = await compileTarget(ed.imageURL, p => step(`Building fast camera recognition… ${Math.round(p)}%`, 10 + p * 0.7)); }
          catch (e) { console.warn(e); toast('Recognition couldn\'t be pre-built here. Phones will build it on first use.', 4000); }
        }
        if (ed.video) { step('Attaching video…', 82); input.overlay = { bytes: await fileBytes(ed.video.file), mime: ed.video.mime }; }
        const wantTeaser = $('#ed-teaser', body).checked;
        if (wantTeaser && (ed.image || !art?.teaser)) {
          const img = ed.image?.img || (ed.imageURL ? await loadImg(ed.imageURL) : null);
          if (img) input.teaser = { bytes: await canvasToBytes(teaserFrom(img), 'image/jpeg', 0.7), mime: 'image/jpeg' };
        } else if (!wantTeaser) input.teaser = null;
        step('Encrypting & signing…', 88);
        const res = await upsertArtwork(vault, input);
        for (const [path, bytes] of Object.entries(res.files)) await sdb.put('files', path, bytes);
        markPending(Object.keys(res.files), res.removed);
        await saveVault();
        step('Done', 100);
        closeSheet(); toast(`✓ ${esc(title)} saved. Publish to make it live.`);
        if (!art) setTimeout(() => openEditions(res.id), 300);
      } catch (e) { console.error(e); st.textContent = 'Error: ' + e.message; btn.disabled = false; }
    });
    $('#ed-del', body)?.addEventListener('click', async ev => {
      const b = ev.currentTarget;
      if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Tap again: collectors lose access'; return; }
      const removed = deleteArtwork(vault, art.id); markPending([], removed); await saveVault(); closeSheet(); toast('Artwork deleted. Publish to apply.');
    });
    return () => { gone = true; preview?.dispose(); };
  });
}
function uniqueId(base) { let id = base, n = 2; while (vault.artworks[id]) id = `${base}-${n++}`; return id; }

// ---------------- editions & QR ----------------
function qrDataURL(text, scale = 8) {
  return qrToCanvas(text, { scale, margin: 4, level: 'M' }).toDataURL('image/png');
}

function openEditions(id) {
  const a = vault.artworks[id];
  const list = editionList(vault, id, siteURL());
  const html = `<div class="create-head"><div class="eyebrow">Editions & QR codes</div><h2>${esc(a.meta.title)}</h2>
    <p>Each poster gets its own QR code. Give the matching card to the buyer. If a code leaks, revoke it and issue a new one. Links point to <b>${esc(siteURL())}</b> (change in Settings).</p></div>
    <div class="btn-row" style="margin:16px 0">
      <button class="btn btn-gold" data-e="print">Print QR cards</button>
      <button class="btn btn-ghost" data-e="csv">Download codes (CSV)</button>
    </div>
    <div class="row2" style="align-items:end;margin-bottom:14px">
      <div class="field"><label for="more">Add editions</label><input type="number" id="more" min="1" max="1000" value="10"></div>
      <button class="btn btn-ghost" data-e="more">Add</button>
    </div>
    <div class="table-wrap"><table class="ed-table"><thead><tr><th>#</th><th>Code</th><th></th></tr></thead><tbody>
    ${list.map(e => `<tr class="${e.revoked ? 'revoked' : ''}"><td>${e.edition}</td><td class="mono">${formatCode(e.code)}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost" data-copy="${esc(e.url)}">Copy link</button> ${e.revoked ? `<button class="btn btn-ghost" data-reissue="${e.edition}">Re-issue</button>` : `<button class="btn btn-ghost" data-revoke="${e.edition}">Revoke</button>`}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="help">Revoking stops a code from unlocking on new devices after you publish. Collectors who already unlocked keep their copy. Re-issue creates a fresh code for that edition number.</p>`;
  openSheet(html, body => {
    body.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.copy) { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied'); } catch { prompt('Copy this link', b.dataset.copy); } }
      if (b.dataset.revoke) { revokeEdition(vault, id, Number(b.dataset.revoke)); markPending(); await saveVault(); openEditions(id); }
      if (b.dataset.reissue) { reissueEdition(vault, id, Number(b.dataset.reissue)); markPending(); await saveVault(); openEditions(id); toast('New code issued. Print a new card.'); }
      if (b.dataset.e === 'more') {
        const n = Math.max(1, Number($('#more', body).value) || 0);
        const res = await upsertArtwork(vault, { ...a.meta, id, editionsTotal: a.editionsTotal + n, publicTitle: a.publicTitle });
        for (const [p, bytes] of Object.entries(res.files)) await sdb.put('files', p, bytes);
        markPending(Object.keys(res.files), res.removed); await saveVault(); openEditions(id); toast(`${n} editions added`);
      }
      if (b.dataset.e === 'csv') {
        const rows = [['edition', 'code', 'unlock_link', 'status'], ...editionList(vault, id, siteURL()).map(x => [x.edition, formatCode(x.code), x.url, x.revoked ? 'revoked' : 'active'])];
        download(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }), `${id}-editions.csv`);
      }
      if (b.dataset.e === 'print') printCards(id);
    });
  });
}

function printCards(id) {
  const a = vault.artworks[id];
  let cards;
  try {
    cards = editionList(vault, id, siteURL()).filter(e => !e.revoked).map(e => `<div class="qr-card"><img src="${qrDataURL(e.url, 6)}" alt="">
      <div><div class="ed">Edition ${e.edition} of ${a.editionsTotal}</div><h3>${esc(a.meta.title)}</h3><div class="by">by ${esc(a.meta.author)}</div>
      <div class="code">${formatCode(e.code)}</div><div class="how">Scan to unlock the living edition of your poster. Or open ${esc(siteURL().replace(/^https?:\/\//, ''))} and enter the code. Keep this card private.</div></div></div>`).join('');
  } catch (err) { return toast(err.message, 4000); }
  $('#print-area').innerHTML = cards;
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); setTimeout(() => document.body.classList.remove('printing'), 500); }, 300);
}

// ---------------- AR overlays (collectors swipe between them in AR) ----------------
function overlayList(a) {
  if (a.meta.overlays?.length) return a.meta.overlays.map(o => ({ ...o }));
  return [a.meta.effect === 'video' ? { id: 'main', kind: 'legacy-video', title: 'Artist video' } : { id: 'main', kind: 'effect', effect: a.meta.effect || 'auto', preset: a.meta.preset || null, title: 'Living edition' }];
}
function openOverlays(id) {
  const a = vault.artworks[id];
  let list = overlayList(a);
  const pendingVideos = new Map();   // overlay id → { bytes, mime }
  const render = body => {
    $('#ov-list', body).innerHTML = list.map((o, i) => `<li class="ov-row">
        <span class="ov-kind">${o.kind === 'effect' ? '✦ Animation' : '▶ Video'}</span>
        <input type="text" value="${esc(o.title)}" data-ov-title="${i}" maxlength="32" aria-label="Overlay name">
        <span class="ov-tools">
          <button class="btn btn-ghost btn-small" data-ov-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button class="btn btn-ghost btn-small" data-ov-del="${i}" ${list.length === 1 ? 'disabled' : ''} aria-label="Remove">✕</button>
        </span></li>`).join('');
  };
  const html = `<div class="create-head"><div class="eyebrow">AR overlays</div><h2>${esc(a.meta.title)}</h2>
      <p>Collectors <b>swipe left or right in AR</b> to switch between these, in this order. Each overlay is locked onto the printed poster. Videos are encrypted like the artwork, so only owners (and NFC previews) can play them.</p></div>
    <ul class="ov-list" id="ov-list"></ul>
    <div class="btn-row" style="margin:12px 0">
      <label class="btn btn-ghost">+ Add video overlay<input type="file" accept="video/mp4,video/quicktime,video/webm" id="ov-file" hidden></label>
      ${list.some(o => o.kind === 'effect') ? '' : '<button class="btn btn-ghost" data-ov-anim>+ Add living animation</button>'}
    </div>
    <p class="help">Tip: export videos as MP4 (H.264), about the same shape as the poster, under ~10 MB. They play muted and loop.</p>
    <div class="btn-row" style="margin-top:14px"><button class="btn btn-gold" id="ov-save">Save overlays</button></div>
    <p class="help" id="ov-status"></p>`;
  openSheet(html, body => {
    render(body);
    body.addEventListener('input', e => { const t = e.target.closest('[data-ov-title]'); if (t) list[Number(t.dataset.ovTitle)].title = t.value; });
    body.addEventListener('click', async e => {
      const up = e.target.closest('[data-ov-up]'); if (up) { const i = Number(up.dataset.ovUp); [list[i - 1], list[i]] = [list[i], list[i - 1]]; return render(body); }
      const del = e.target.closest('[data-ov-del]'); if (del) { list.splice(Number(del.dataset.ovDel), 1); return render(body); }
      if (e.target.closest('[data-ov-anim]')) { list.push({ id: 'living', kind: 'effect', effect: a.meta.effect === 'video' ? 'auto' : a.meta.effect, title: 'Living edition' }); return render(body); }
    });
    $('#ov-file', body).addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 25e6) { toast('That video is over 25 MB. Please export a smaller file.'); return; }
      const oid = 'video-' + Date.now().toString(36);
      pendingVideos.set(oid, { bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type || 'video/mp4' });
      list.push({ id: oid, kind: 'video', title: f.name.replace(/\.[^.]+$/, '').slice(0, 32) || 'Video' });
      render(body); e.target.value = '';
    });
    $('#ov-save', body).addEventListener('click', async () => {
      const st = $('#ov-status', body), btn = $('#ov-save', body); btn.disabled = true; st.textContent = 'Encrypting…';
      try {
        if (list.some(o => o.kind === 'legacy-video')) { st.textContent = 'This artwork\'s video is its main animation. Edit the artwork to change it.'; btn.disabled = false; return; }
        const overlays = list.map(o => o.kind === 'video' ? { id: o.id, kind: 'video', title: o.title, ...(pendingVideos.get(o.id) || {}) } : { id: o.id, kind: 'effect', effect: o.effect, preset: o.preset, title: o.title });
        const res = await upsertArtwork(vault, { ...a.meta, id, editionsTotal: a.editionsTotal, publicTitle: a.publicTitle, overlays });
        for (const [path, bytes] of Object.entries(res.files)) await sdb.put('files', path, bytes);
        markPending(Object.keys(res.files), res.removed); await saveVault();
        closeSheet(); toast(`✓ ${list.length} overlay${list.length === 1 ? '' : 's'} saved. Publish to make them live.`); renderMain();
      } catch (err) { console.error(err); st.textContent = 'Error: ' + err.message; btn.disabled = false; }
    });
  });
}

// ---------------- NFC tags (temporary previews) ----------------
async function openNFC(id) {
  const a = vault.artworks[id];
  if (!a.nfcCode) { nfcLink(vault, id, siteURL()); markPending(); await saveVault(); }
  const url = nfcLink(vault, id, siteURL());
  const canWrite = 'NDEFReader' in window;
  const html = `<div class="create-head"><div class="eyebrow">NFC tag</div><h2>${esc(a.meta.title)}</h2>
    <p>Stick an NFC tag (NTAG213/215/216) on or behind the artwork. Anyone who taps it with their phone gets a <b>temporary preview</b> of the living edition. Nothing is saved: to see it again they have to tap the tag again. Only the poster's private <b>QR code</b> adds it to a collection for good.</p></div>
    <div class="field" style="margin-top:14px"><label>Link to write on the tag</label><input type="text" readonly value="${esc(url)}" class="mono" id="nfc-url"></div>
    <div class="btn-row" style="margin:14px 0">
      <button class="btn btn-gold" data-n="write"${canWrite ? '' : ' disabled'}>Write to NFC tag</button>
      <button class="btn btn-ghost" data-n="copy">Copy link</button>
    </div>
    <p class="help" id="nfc-status">${canWrite ? 'Tap <b>Write to NFC tag</b>, then hold the tag against the back of your phone.' : 'Writing tags from the browser works in Chrome on Android. On iPhone or desktop, copy the link and write it with a free app such as NFC Tools (record type: URL).'}</p>
    <div class="divider"></div>
    <p class="help">Is the tag link out in the wild? Create a new tag secret, publish, and re-write your tags. Old tags stop opening previews.</p>
    <button class="btn btn-ghost" data-n="reissue">New tag secret</button>`;
  openSheet(html, body => {
    let abort = null;
    body.addEventListener('click', async e => {
      const b = e.target.closest('[data-n]'); if (!b) return;
      const st = $('#nfc-status', body);
      if (b.dataset.n === 'copy') { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); } }
      if (b.dataset.n === 'write') {
        try {
          abort?.abort(); abort = new AbortController();
          st.textContent = 'Hold the NFC tag against the back of your phone…';
          await new NDEFReader().write({ records: [{ recordType: 'url', data: url }] }, { signal: abort.signal });
          st.innerHTML = '✓ Tag written. Tap it with a phone to test the preview.'; toast('✓ NFC tag written');
        } catch (err) { if (err.name !== 'AbortError') st.textContent = `Couldn't write the tag: ${err.message || err.name}. Make sure NFC is on and the tag isn't locked.`; }
      }
      if (b.dataset.n === 'reissue') {
        if (!confirm('Create a new tag secret? Tags written with the current link will stop working after you publish.')) return;
        reissueNfc(vault, id); markPending(); await saveVault(); openNFC(id); toast('New tag secret. Publish, then re-write your tags.');
      }
    });
    return () => abort?.abort();
  });
}

// ---------------- NFT ----------------
function openNFT(id) {
  const a = vault.artworks[id]; const n = a.meta.nft || {};
  const html = `<div class="create-head"><div class="eyebrow">NFT</div><h2>${esc(a.meta.title)}</h2>
    <p>Mint the editions on the blockchain with any tool where <b>you own the contract</b> (for example Manifold). Then paste the details here: collectors will see their token and a link to verify ownership on-chain.</p></div>
    <div class="stack" style="margin-top:16px">
      <div class="row2">
        <div class="field"><label for="n-chain">Chain</label><select id="n-chain">${['ethereum', 'base', 'polygon', 'tezos', 'other'].map(c => `<option value="${c}" ${n.chain === c ? 'selected' : ''}>${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select></div>
        <div class="field"><label for="n-std">Standard</label><select id="n-std"><option ${n.standard !== 'ERC-1155' ? 'selected' : ''}>ERC-721</option><option ${n.standard === 'ERC-1155' ? 'selected' : ''}>ERC-1155</option></select></div>
      </div>
      <div class="field"><label for="n-contract">Contract address</label><input type="text" id="n-contract" value="${esc(n.contract || '')}" placeholder="0x…" spellcheck="false"></div>
      <div class="row2">
        <div class="field"><label for="n-start">Token ID of edition #1</label><input type="number" id="n-start" min="0" value="${esc(n.tokenIdStart ?? 1)}"></div>
        <div class="field"><label for="n-1155">ERC-1155 token ID (shared)</label><input type="number" id="n-1155" min="0" value="${esc(n.tokenId ?? '')}"></div>
      </div>
      <div class="field"><label for="n-market">Marketplace link (optional, use {tokenId})</label><input type="url" id="n-market" value="${esc(n.marketplace || '')}" placeholder="https://…/{tokenId}"></div>
      <div class="field"><label for="n-image">Image URI for metadata (e.g. ipfs://…)</label><input type="text" id="n-image" value="${esc(n.imageURI || '')}"></div>
      <div class="btn-row"><button class="btn btn-ghost" data-n="meta">Download token metadata</button><button class="btn btn-gold" data-n="save">Save</button></div>
      <p class="help">The metadata files contain each edition's name, artist, edition number and the artwork's SHA-256 fingerprint, the same fingerprint as on the signed certificate. That ties the token, the certificate and the physical poster together.</p>
    </div>`;
  openSheet(html, body => {
    const read = () => ({ chain: $('#n-chain', body).value, standard: $('#n-std', body).value, contract: $('#n-contract', body).value.trim(),
      tokenIdStart: Number($('#n-start', body).value || 1), tokenId: $('#n-1155', body).value === '' ? null : Number($('#n-1155', body).value),
      marketplace: $('#n-market', body).value.trim(), imageURI: $('#n-image', body).value.trim() });
    body.addEventListener('click', async e => {
      const b = e.target.closest('[data-n]'); if (!b) return;
      if (b.dataset.n === 'save') {
        const nft = read();
        const res = await upsertArtwork(vault, { ...a.meta, id, editionsTotal: a.editionsTotal, publicTitle: a.publicTitle, nft: nft.contract ? nft : null });
        for (const [p, bytes] of Object.entries(res.files)) await sdb.put('files', p, bytes);
        markPending(Object.keys(res.files), res.removed); await saveVault(); closeSheet(); toast('NFT details saved. Publish to apply.');
      }
      if (b.dataset.n === 'meta') {
        const metas = nftMetadata(vault, id, read().imageURI);
        download(makeZip(metas.map((m, i) => ({ name: `${id}-metadata/${i + 1}.json`, data: JSON.stringify(m, null, 2) }))), `${id}-nft-metadata.zip`);
      }
    });
  });
}

// ---------------- settings ----------------
function openSettings() {
  const s = settings.get();
  const html = `<div class="create-head"><div class="eyebrow">Settings</div><h2>Publishing</h2></div>
    <div class="stack" style="margin-top:16px">
      <div class="field"><label for="s-site">Gallery address (used in QR codes)</label><input type="url" id="s-site" value="${esc(s.siteURL || siteURL())}"></div>
      <div class="divider"></div>
      <p class="help" style="margin:0"><b>One-click publishing to GitHub (optional).</b> Create a fine-grained personal access token on GitHub (Settings → Developer settings → Fine-grained tokens) with access to <i>only this repository</i> and permission <b>Contents: Read and write</b>. It is stored only in this browser.</p>
      <div class="row2"><div class="field"><label for="s-owner">GitHub owner</label><input type="text" id="s-owner" value="${esc(s.owner || '')}" placeholder="your-username"></div>
      <div class="field"><label for="s-repo">Repository</label><input type="text" id="s-repo" value="${esc(s.repo || '')}" placeholder="exhibit"></div></div>
      <div class="row2"><div class="field"><label for="s-branch">Branch</label><input type="text" id="s-branch" value="${esc(s.branch || 'main')}"></div>
      <div class="field"><label for="s-token">Token</label><input type="password" id="s-token" value="${esc(s.token || '')}" autocomplete="off"></div></div>
      <button class="btn btn-gold" id="s-save">Save settings</button>
    </div>`;
  openSheet(html, body => {
    $('#s-save', body).addEventListener('click', () => {
      settings.set({ siteURL: $('#s-site', body).value.trim(), owner: $('#s-owner', body).value.trim(), repo: $('#s-repo', body).value.trim(), branch: $('#s-branch', body).value.trim() || 'main', token: $('#s-token', body).value.trim() });
      closeSheet(); toast('Settings saved');
    });
  });
}

// ---------------- publish ----------------
async function collectPublish() {
  const gallery = await buildGallery(vault);
  const files = { 'gallery.json': JSON.stringify(gallery, null, 1) };
  for (const p of vault.pending?.files || []) { const b = await sdb.get('files', p); if (b) files[p] = b; }
  return { files, remove: vault.pending?.remove || [] };
}
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 8000); }
async function publishZip() {
  const { files, remove } = await collectPublish();
  const entries = Object.entries(files).map(([name, data]) => ({ name, data }));
  entries.push({ name: 'PUBLISH-README.txt', data: `Copy these files into your repository root (keep the folders), commit and push.\n${remove.length ? `\nAlso delete these old files:\n${remove.join('\n')}\n` : ''}` });
  download(makeZip(entries), `exhibit-publish-${new Date().toISOString().slice(0, 10)}.zip`);
  if (confirm('Downloaded. Mark these changes as published? (Choose OK after you have pushed them to GitHub.)')) { vault.pending = { files: [], remove: [] }; await saveVault(); }
}
async function publishGitHub() {
  const s = settings.get();
  if (!s.owner || !s.repo || !s.token) { toast('Add your GitHub details in Settings first, or use Download ZIP.'); return openSettings(); }
  const { files, remove } = await collectPublish();
  openSheet(`<div class="create-head"><div class="eyebrow">Publishing</div><h2>Sending to GitHub…</h2></div><div class="progress" style="margin-top:20px"><i id="pp"></i></div><p class="help" id="ps"></p>`);
  try {
    await publishToGitHub({ owner: s.owner, repo: s.repo, branch: s.branch || 'main', token: s.token, files, remove, message: `Gallery update: ${new Date().toISOString()}`,
      onP: (t, p) => { $('#ps').textContent = t; $('#pp').style.width = p + '%'; } });
    vault.pending = { files: [], remove: [] }; await saveVault();
    $('#sheet-body').innerHTML = `<div class="create-head"><div class="eyebrow">Published</div><h2>Your gallery is updating</h2><p>GitHub will deploy it in about a minute. Collectors' apps update automatically next time they open, even from the home screen.</p></div><button class="btn btn-gold btn-block" data-act="close" style="margin-top:18px">Done</button>`;
  } catch (e) {
    $('#sheet-body').innerHTML = `<div class="create-head"><div class="eyebrow">Publishing failed</div><h2>GitHub said no</h2><p class="err">${esc(e.message)}</p><p class="help">Check the owner, repository, branch and that the token has Contents: Read and write on this repository.</p></div><button class="btn btn-ghost btn-block" data-act="close" style="margin-top:18px">Close</button>`;
  }
}

// ---------------- events ----------------
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act],[data-edit],[data-editions],[data-nft],[data-nfc],[data-ov]'); if (!t) return;
  if (t.dataset.nfc) return openNFC(t.dataset.nfc);
  if (t.dataset.ov) return openOverlays(t.dataset.ov);
  if (t.dataset.edit) return openEditor(t.dataset.edit);
  if (t.dataset.editions) return openEditions(t.dataset.editions);
  if (t.dataset.nft) return openNFT(t.dataset.nft);
  const a = t.dataset.act;
  if (a === 'close') closeSheet();
  if (a === 'add') openEditor(null);
  if (a === 'settings') openSettings();
  if (a === 'lock') showLock();
  if (a === 'zip') publishZip();
  if (a === 'publish') publishGitHub();
  if (a === 'download-vault') { download(new Blob([JSON.stringify(await sealWithPassphrase(password, vault))], { type: 'application/json' }), `${slugify(vault.artist.name)}-vault.ghvault`); toast('Keep this file and your password safe. Together they are your studio.'); }
  if (a === 'open-remembered') { $('#lock-err').textContent = ''; openVault(await sdb.get('kv', 'vault'), $('#pw-open').value); }
  if (a === 'open-file') { $('#lock-err').textContent = ''; if (fileSealed) openVault(fileSealed, $('#pw-file').value); }
  if (a === 'create') {
    const name = $('#new-name').value.trim(), p1 = $('#new-pw').value, p2 = $('#new-pw2').value;
    if (!name) return ($('#lock-err').textContent = 'Enter your artist name.');
    if (p1.length < 10) return ($('#lock-err').textContent = 'Use a password of at least 10 characters.');
    if (p1 !== p2) return ($('#lock-err').textContent = 'Passwords don\'t match.');
    const v = await createVault(name); v.pending = { files: [], remove: [], manifest: true };
    const sealed = await sealWithPassphrase(p1, v);
    await openVault(sealed, p1);
    download(new Blob([JSON.stringify(sealed)], { type: 'application/json' }), `${slugify(name)}-vault.ghvault`);
    toast('Vault created and downloaded. Keep the file and password safe.', 4500);
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); if (e.key === 'Enter' && e.target.id === 'pw-open') $('[data-act=open-remembered]').click(); });

applyTheme();
{ const box = document.createElement('div'); box.style.cssText = 'display:flex;gap:6px;align-items:center'; const nav = document.querySelector('.nav'); nav.appendChild(box); box.appendChild(document.getElementById('nav-actions')); mountThemeButton(box); }
showLock();
