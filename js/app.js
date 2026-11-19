// EXHIBIT: collector app
import { db, requestPersistence } from './db.js';
import { loadGallery, listCollection, unlock, openArtwork, isOffline, mirroredCredentials, nfcPreview, closeArtwork, syncEntry, overlaysOf } from './gallery.js';
import { buildBackup, saveBackupToDevice, shareBackup, lastBackup, readBackupFile, restoreBackup } from './backup.js';
import { parsePayload, formatCode, normaliseCode } from './crypto.js';
import { getTarget, onProgress, isReady } from './recognition.js';
import { shuffledFacts } from './facts.js';
import { applyTheme, mountThemeButton } from './theme.js';
import { mountContact } from './contact.js';
import { loadMarket, renderMarket, openOrder, renderTrending, toggleFav, heartHTML, isFav, artistList, renderArtistStrip, renderArtists, openArtist } from './market.js';
import { storyHTML, mountStory } from './story.js';
import * as acct from './account.js';
import { initAccountUI, ensureAccount, openAccount, avatarHTML } from './account-ui.js';
const loadQR = () => import('./qr.js');          // only when a sign-in QR code is shown
const loadLegal = () => import('./legal.js');    // only when Privacy / Terms are opened

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hasWebGL = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let previewMod, arMod, scannerMod, roomMod;
const loadPreview = () => (previewMod ||= import('./preview.js'));
const loadAR = () => (arMod ||= import('./ar.js'));
const loadScanner = () => (scannerMod ||= import('./scanner.js'));
const loadRoom = () => (roomMod ||= import('./gallery3d.js'));

const state = { gallery: null, collection: [], thumbs: new Map(), heroPreview: null, view: 'home', preview: null, room: null, market: null };
const coverOpen = () => !$('#ar-view').hidden || !$('#ceremony').hidden || !!state.room;
const targetKeyOf = e => `${e.key}|${e.files?.image || ''}`;

// ================================================================ helpers
function svgIcon(name) {
  const p = {
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    ar: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    share: '<path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
    save: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    nfc: '<path d="M6 8.5a6 6 0 0 1 0 7M9.5 6a10 10 0 0 1 0 12M13 3.5a14 14 0 0 1 0 17"/><circle cx="3.5" cy="12" r="1"/>',
    cube: '<path d="M12 3 3 7.5v9L12 21l9-4.5v-9z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  }[name];
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
}
function toast(t, ms = 2800) { const el = $('#toast'); el.innerHTML = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), ms); }
const edLabel = e => e.editions ? `Edition ${e.edition} of ${e.editions}` : `Edition ${e.edition}`;
const edShort = e => e.editions ? `${e.edition}/${e.editions}` : `#${e.edition}`;

function embers(canvas, { density = 9000, max = 90 } = {}) {
  const g = canvas.getContext('2d');
  let w, h, raf, running = true; const parts = [];
  const resize = () => { const d = Math.min(devicePixelRatio, 2); w = canvas.clientWidth; h = canvas.clientHeight; canvas.width = w * d; canvas.height = h * d; g.setTransform(d, 0, 0, d, 0, 0); };
  resize(); const ro = new ResizeObserver(resize); ro.observe(canvas);
  const spawn = any => ({ x: Math.random() * w, y: any ? Math.random() * h : h + 10, r: Math.random() < .15 ? 2.5 + Math.random() * 3 : .8 + Math.random() * 1.6, vy: .25 + Math.random() * .8, ph: Math.random() * 6.28, hue: Math.random() < .6 ? 38 : 22 });
  const N = Math.round(Math.min(max, (w * h) / density) || 30);
  for (let i = 0; i < N; i++) parts.push(spawn(true));
  const t0 = performance.now();
  (function frame(now) {
    if (!running) return;
    const t = (now - t0) / 1000; g.clearRect(0, 0, w, h);
    const fin = Math.min(1, t / 1.5);
    for (const p of parts) {
      p.y -= p.vy; p.x += Math.sin(t * .8 + p.ph) * .35;
      if (p.y < -10) Object.assign(p, spawn(false));
      const life = Math.min(1, (h - p.y) / (h * .25)) * Math.min(1, p.y / (h * .3));
      const a = Math.max(0, life) * (.55 + .45 * Math.sin(t * 3 + p.ph)) * fin;
      const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
      gr.addColorStop(0, `hsla(${p.hue},100%,82%,${a})`); gr.addColorStop(.35, `hsla(${p.hue},100%,62%,${a * .45})`); gr.addColorStop(1, `hsla(${p.hue},100%,50%,0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r * 4, 0, 6.283); g.fill();
    }
    raf = requestAnimationFrame(frame);
  })(t0);
  return () => { running = false; cancelAnimationFrame(raf); ro.disconnect(); };
}

// ================================================================ splash (progress truly reaches 100% before the app opens)
function splitTitle(el, text) {
  const words = text.split(' '); let i = 0;
  el.innerHTML = words.map((w, wi) => {
    const chars = [...w].map(c => `<span class="ch" style="animation-delay:${(.75 + (i++) * .06).toFixed(3)}s">${esc(c)}</span>`).join('');
    const sp = wi < words.length - 1 ? `<span class="ch sp" style="animation-delay:${(.75 + (i++) * .06).toFixed(3)}s"> </span>` : '';
    return `<span class="word">${wi === words.length - 1 && words.length > 1 ? `<em>${chars}</em>` : chars}</span>` + sp;
  }).join('');
}

async function runSplash({ landing = true } = {}) {
  const stopEmbers = () => {};
  const bar = $('#splash-bar'), status = $('#splash-status'), pctEl = $('#splash-pct');

  // rotating fun facts
  const facts = shuffledFacts(); let fi = 0;
  const factEl = $('#fact-text'); factEl.textContent = facts[0];
  const factTimer = setInterval(() => {
    factEl.classList.add('out');
    setTimeout(() => { fi = (fi + 1) % facts.length; factEl.textContent = facts[fi]; factEl.classList.remove('out'); }, 450);
  }, 5200);

  // Only the essentials block the splash: the gallery list and this device's collection (both
  // tiny, cached offline). The AR camera engine and artwork tracking warm up in the background
  // once the app is on screen (see warmAR), so opening the app never waits on a big download.
  let label = 'Opening the gallery…';
  const tasks = { gallery: { w: 1, p: 0 } };
  const real = () => tasks.gallery.p;
  const guard = (p, ms = 8000) => Promise.race([p, sleep(ms)]);   // never hang (offline, slow network)
  const prep = (async () => {
    await guard((async () => {
      state.gallery = await loadGallery();
      state.collection = await listCollection();
    })().catch(() => {}));
    tasks.gallery.p = 1;
  })();

  // landing page first (loading already runs underneath); deep links skip straight to the splash
  const land = $('#landing'), boot = $('#boot');
  if (landing && land) {
    land.classList.add('ready');
    await new Promise(resolve => {
      const go = () => { try { navigator.vibrate?.(10); } catch {} resolve(); };
      $('#launch').addEventListener('click', go, { once: true });
      setTimeout(() => $('#launch')?.focus({ preventScroll: true }), 900);
    });
    land.classList.add('leaving');
    setTimeout(() => land.remove(), 900);
  } else land?.remove();
  boot.hidden = false;
  requestAnimationFrame(() => boot.classList.add('on'));

  // smooth display that can never run ahead of the real progress, and must hit 100
  let shown = 0, finished = false;
  prep.then(() => { finished = true; });
  const t0 = performance.now(), minTime = reducedMotion ? 300 : 1300;
  await new Promise(resolve => {
    (function tick() {
      const target = finished ? 1 : Math.min(.99, real());
      shown += (target - shown) * .2; if (target - shown < .004) shown = target;
      const pct = Math.round(shown * 100);
      bar.style.width = Math.max(2, pct) + '%'; pctEl.textContent = pct + '%';
      status.textContent = pct >= 100 ? 'Ready' : label;
      if (pct >= 100 && performance.now() - t0 > minTime) return resolve();
      requestAnimationFrame(tick);
    })();
  });
  await sleep(160);
  clearInterval(factTimer);
  $('#app').hidden = false;
  requestAnimationFrame(() => $('#app').classList.add('in'));
  boot.classList.add('leaving');
  setTimeout(() => { stopEmbers(); boot.remove(); }, 1000);
}

// ================================================================ AR warm-up
/** Get one poster ready for AR right away (engine, recognition data, overlay videos). */
function warmOne(entry) {
  if (!entry?.K || warmOne.done?.has(entry.key)) return;
  (warmOne.done ||= new Set()).add(entry.key);
  (async () => {
    try {
      const engine = loadAR().then(m => m.loadMindAR()); engine.catch(() => {});
      await syncEntry(entry);
      const art = await openArtwork(entry);
      for (const o of art.overlays || []) if (o.kind === 'video') art.videoURL(o.file, o.mime).catch(() => {});
      await getTarget(targetKeyOf(entry), art);
      await engine;
    } catch (err) { warmOne.done.delete(entry.key); console.warn('warm', err); }
  })();
}
// ================================================================ background AR warm-up
// After the app is visible and idle, quietly fetch the AR engine and prepare camera tracking for
// collected posters, so "Start AR" opens instantly (and works offline later). Skipped on Data
// Saver / 2G, where it happens on demand instead.
function warmAR() {
  const c = navigator.connection;
  if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return;
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1));
  setTimeout(() => idle(async () => {
    try {
      await loadAR().then(m => m.loadMindAR());
      for (const e of state.collection) {
        if (warmOne.done?.has(e.key)) continue;
        try { const art = await openArtwork(e); await getTarget(targetKeyOf(e), art); } catch (err) { console.warn('warm', err); }
        await new Promise(r => idle(r));
      }
    } catch (err) { console.warn('AR warm-up skipped', err); }
  }, { timeout: 2000 }), 800);
}

// ================================================================ rendering
async function thumbURL(e) {
  if (state.thumbs.has(e.key)) return state.thumbs.get(e.key);
  let blob = e.thumb;
  if (!blob) {
    try {
      const art = await openArtwork(e);
      const img = new Image(); img.src = art.imageURL; await img.decode();
      const s = Math.min(1, 560 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .85));
      e.thumb = blob; db.put('collection', e.key, e);
    } catch { return ''; }
  }
  const url = URL.createObjectURL(blob); state.thumbs.set(e.key, url); return url;
}

function cardHTML(e, url) {
  const m = e.meta || {};
  return `<button class="card" data-entry="${esc(e.key)}">
    <div class="card-img"><span class="card-badge">Live</span><span class="card-edition">${esc(edShort(e))}</span><img src="${esc(url)}" alt="" loading="lazy" decoding="async"></div>
    ${heartHTML(`c:${e.key}`, esc)}
    <div class="card-body"><div class="card-title">${esc(m.title)}</div><div class="card-meta">by ${esc(m.author || e.artist?.name || 'the artist')}${m.year ? ' · ' + esc(m.year) : ''}</div>
      <div class="card-badges">${e.verified ? '<span class="mini-badge ok">✓ Signed</span>' : ''}${m.nft?.contract ? '<span class="mini-badge nft">NFT</span>' : ''}</div></div>
  </button>`;
}

async function renderCollection() {
  state.collection = await listCollection();
  const n = state.collection.length;
  const cnt = $('#mine-count'); cnt.hidden = !n; cnt.textContent = n;
  $('#hero-count').textContent = n ? `(${n})` : '';
  const urls = await Promise.all(state.collection.map(thumbURL));
  const cards = state.collection.map((e, i) => cardHTML(e, urls[i])).join('');

  // My Posters grid
  const total = new Set((state.gallery?.artworks || []).map(a => a.id)).size;
  const ownedIds = new Set(state.collection.map(e => e.id));
  $('#mine-sub').textContent = n ? `${n} poster${n > 1 ? 's' : ''} in your collection${total ? ` · ${ownedIds.size} of ${total} artworks in the series` : ''}` : 'Your unlocked posters will appear here.';
  $('#mine-grid').innerHTML = n ? cards : `<div class="empty-state"><h3>Your gallery is waiting</h3><p>Scan the private QR code that came with your poster to unlock its living edition.</p><button class="btn btn-gold btn-lg" data-action="unlock">${svgIcon('unlock')}Unlock your first poster</button></div>`;

  // Home strip
  $('#home-mine').hidden = !n;
  $('#home-strip').innerHTML = cards;

  // Locked teasers
  const locked = (state.gallery?.artworks || []).filter(a => !ownedIds.has(a.id));
  $('#home-locked').hidden = !locked.length;
  $('#locked-note').textContent = total ? `You've collected ${ownedIds.size} of ${total}.` : '';
  $('#locked-grid').innerHTML = locked.map(a => `<div class="card locked" aria-label="Locked artwork">
      <div class="card-img ${a.teaser ? '' : 'noimg'}">${a.teaser ? `<img src="${esc(a.teaser)}" alt="" loading="lazy">` : ''}<span class="lockmark">${svgIcon('lock')}</span></div>
      <div class="card-body"><div class="card-title">${esc(a.publicTitle || 'Locked artwork')}</div><div class="card-meta">Edition of ${esc(a.editionsTotal || '?')} · unlock with its poster</div></div>
    </div>`).join('');

  // backup nudge
  const lb = await lastBackup();
  const newest = n ? Math.max(...state.collection.map(e => e.unlockedAt)) : 0;
  const dismissedAt = Number(localStorage.getItem('ex-dismiss-backup') || 0);   // dismissed: comes back when a new poster is unlocked
  $('#backup-banner').hidden = !n || (lb && lb > newest) || dismissedAt >= newest;
  renderHero();
}

let heroKey = null;
async function renderHero() {
  const frame = $('#hero-frame'), latest = state.collection[0];
  if (!latest) {
    heroKey = null; state.heroPreview?.dispose(); state.heroPreview = null; frame.classList.remove('live');
    $('#hero-caption').innerHTML = `<span>Golden Hour</span><span class="muted">Unlock with your poster's QR</span>`;
    $('#hero-eyebrow').textContent = state.gallery?.artist?.name ? `Private collection · ${state.gallery.artist.name}` : 'Private collection';
    if (!renderHero.embers && !reducedMotion) renderHero.embers = embers($('#hero-embers'), { density: 6000, max: 40 });
    return;
  }
  $('#hero-eyebrow').textContent = 'Your latest unlock';
  $('#hero-caption').innerHTML = `<span>${esc(latest.meta.title)}</span><span class="muted">${esc(edLabel(latest))}</span>`;
  frame.dataset.entry = latest.key;
  if (heroKey === latest.key || !hasWebGL) return;
  heroKey = latest.key;
  try {
    const art = await openArtwork(latest);
    const { LivePreview } = await loadPreview();
    state.heroPreview?.dispose();
    $('#hero-img').src = art.imageURL;
    frame.style.aspectRatio = '';
    state.heroPreview = new LivePreview(frame, { meta: latest.meta, ...art });
    await state.heroPreview.ready;
    frame.classList.add('live');
    renderHero.embers?.(); renderHero.embers = null;
  } catch (e) { console.warn('hero preview', e); }
}

function setView(v) {
  state.view = v;
  $('#view-home').hidden = v !== 'home';
  $('#view-mine').hidden = v !== 'mine';
  $('#view-market').hidden = v !== 'market';
  $('#view-artists').hidden = v !== 'artists';
  if (v === 'artists') showArtists();
  $$('.tab-btn[data-action]').forEach(b => b.classList.toggle('active', b.dataset.action === v));
  if (v === 'market') showMarket();
  if (v === 'home') state.heroPreview?.resume(); else state.heroPreview?.pause();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  const want = v === 'mine' ? '#my-posters' : v === 'market' ? '#marketplace' : v === 'artists' ? '#artists' : '';
  if (location.hash !== want && !/[#&]([un])=/.test(location.hash)) history.replaceState(history.state, '', want || location.pathname + location.search);
  updateInstallBanner();
}

// ================================================================ journey (immersive steps)
function initJourney() {
  // tiny QR art
  let s = '';
  const finder = (x, y) => `<path d="M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5zM${x + 2} ${y + 2}h3v3h-3z" fill-rule="evenodd"/>`;
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
    if ((x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12)) continue;
    if (((x * 7 + y * 13 + x * y) % 5) < 2) s += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }
  $('.jv-qr .qr').innerHTML = `<svg viewBox="0 0 21 21">${finder(0, 0)}${finder(14, 0)}${finder(0, 14)}${s}</svg>`;
  const steps = $$('.jstep');
  const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: .25 });
  steps.forEach(st => io.observe(st));
  const list = $('.journey-list');
  const onScroll = () => {
    const r = list.getBoundingClientRect(), vh = innerHeight;
    const p = Math.min(1, Math.max(0, (vh * .75 - r.top) / (r.height || 1)));
    list.style.setProperty('--fill', p.toFixed(3));
  };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
}

// ================================================================ layers (Android back button closes sheets/overlays)
// history.back() is asynchronous, so a layer opened while a back is still pending waits for it
// before adding its own history entry (otherwise the browser can step back one page too far).
const layers = []; let ignorePop = 0;
function pushLayer(name, close) {
  const l = { name, close, pushed: false }; layers.push(l);
  if (!ignorePop) { history.pushState({ layer: name }, ''); l.pushed = true; }
}
function popLayer(name) {
  const i = layers.findLastIndex(l => l.name === name); if (i < 0) return;
  const [l] = layers.splice(i, 1);
  if (l.pushed) { ignorePop++; history.back(); }
}
addEventListener('popstate', () => {
  if (ignorePop) {
    ignorePop--;
    if (!ignorePop) for (const l of layers) if (!l.pushed) { history.pushState({ layer: l.name }, ''); l.pushed = true; }
    return;
  }
  const top = layers.pop(); if (top) top.close(true);
});

// ================================================================ sheet
let sheetCleanup = null;
function openSheet(html, onMount, opts = {}) {
  const wrap = $('#sheet'), reuse = !wrap.hidden;
  wrap.classList.toggle('full', !!opts.full);
  if (reuse) { try { sheetCleanup?.(); } catch {} sheetCleanup = null; }
  { const old = $('#sheet-body'), fresh = old.cloneNode(false); old.replaceWith(fresh); }   // drop the previous sheet's listeners
  $('#sheet-body').innerHTML = html;
  wrap.hidden = false; $('.sheet', wrap).classList.remove('closing');
  document.body.classList.add('locked');
  state.heroPreview?.pause(); state.room?.pause();
  sheetCleanup = onMount?.($('#sheet-body')) || null;
  $('#sheet-body').scrollTop = 0;
  if (!reuse) pushLayer('sheet', fromPop => closeSheet(fromPop));
}
function closeSheet(fromPop = false) {
  const wrap = $('#sheet'); if (wrap.hidden) return;
  if (!fromPop) popLayer('sheet');
  try { sheetCleanup?.(); } catch {} sheetCleanup = null;
  $('.sheet', wrap).classList.add('closing');
  setTimeout(() => { wrap.hidden = true; wrap.classList.remove('full'); $('#sheet-body').innerHTML = ''; if (!coverOpen()) document.body.classList.remove('locked'); if (state.view === 'home' && !state.room) state.heroPreview?.resume(); if ($('#ar-view').hidden) state.room?.resume(); }, 260);
}

// ================================================================ poster detail
const CHAINS = {
  ethereum: { name: 'Ethereum', token: (c, t) => `https://etherscan.io/nft/${c}/${t}` },
  base: { name: 'Base', token: (c, t) => `https://basescan.org/nft/${c}/${t}` },
  polygon: { name: 'Polygon', token: (c, t) => `https://polygonscan.com/nft/${c}/${t}` },
  tezos: { name: 'Tezos', token: (c, t) => `https://tzkt.io/${c}/tokens/${t}` },
};
export function tokenIdFor(nft, edition) {
  if (!nft) return null;
  if (nft.standard === 'ERC-1155') return nft.tokenId ?? nft.tokenIdStart;
  return Number(nft.tokenIdStart ?? 1) + edition - 1;
}

async function openDetail(e) {
  const m = e.meta, c = e.cert;
  const nft = m.nft?.contract ? m.nft : null;
  const tokenId = tokenIdFor(nft, e.edition);
  const chain = nft ? CHAINS[nft.chain] : null;
  const explorer = nft && chain ? chain.token(nft.contract, tokenId) : null;
  const market = nft?.marketplace ? nft.marketplace.replace('{tokenId}', tokenId).replace('{edition}', e.edition) : null;
  const author = m.author || e.artist?.name || '';
  const html = storyHTML({
    kind: 'detail', topTitle: 'Art Story', moreAction: 'data-d="cert"',
    media: `<div class="detail-stage story-stage" style="aspect-ratio:${m.effect === 'golden-hour' ? '1179/820' : (m.aspect ? `1/${m.aspect}` : '4/3')}"><img class="ph" src="${esc(state.thumbs.get(e.key) || '')}" alt=""></div>`,
    badge: '<span class="dot"></span>Live',
    title: m.title,
    by: `Created by <button class="artist-link" data-artist-name="${esc(author)}">${esc(author)}</button>. ${esc(edLabel(e))} of the living edition, unlocked with its private QR code.`,
    year: m.year,
    specs: [['Edition', `${esc(e.edition)} of ${esc(e.editions || '?')}`], ['Certificate', c ? (e.verified ? '<span class="ok">✓ Verified</span>' : '<span class="bad">Not verified</span>') : 'None']],
    desc: m.description,
    body: `<div class="story-chips">
        <button class="chip" data-d="replay">↻ Replay</button>
        <button class="chip" data-d="3d">${svgIcon('cube')}See it in 3D</button>
        <button class="chip" data-d="cert">✦ Certificate</button>
        ${overlaysOf(m).length > 1 ? `<button class="chip" data-d="ar">${svgIcon('ar')}${overlaysOf(m).length} AR overlays · swipe in AR</button>` : ''}
      </div>
      <div class="panel" id="cert-panel">
        <div class="panel-head"><span class="seal"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="6"/><path d="M9.5 9l1.8 1.8L14.8 7.3"/><path d="M8.5 14.2L7 21l5-2.6 5 2.6-1.5-6.8"/></svg></span>Certificate of authenticity${c ? (e.verified ? '<span class="ok">✓ Verified</span>' : '<span class="bad">Not verified</span>') : ''}</div>
        ${c ? `<dl class="kv">
          <dt>Artwork</dt><dd>${esc(c.title)}</dd>
          <dt>Artist</dt><dd>${esc(c.author)}</dd>
          <dt>Edition</dt><dd>${esc(c.edition)} of ${esc(c.editions)}</dd>
          <dt>Signed by</dt><dd>${esc(c.issuer)}</dd>
          <dt>Issued</dt><dd>${esc(c.issued)}</dd>
          <dt>Artist key</dt><dd class="mono">${esc(c.keyId)}</dd>
          <dt>Fingerprint</dt><dd class="mono">${esc((c.contentHash || '').slice(0, 24))}…</dd>
        </dl>` : '<p class="tip">No certificate attached.</p>'}
      </div>
      ${nft ? `<div class="panel">
        <div class="panel-head"><span class="seal" style="background:radial-gradient(circle at 35% 35%,#c9b6ff,#5b3fc4)">◆</span>On-chain token</div>
        <dl class="kv"><dt>Chain</dt><dd>${esc(chain?.name || nft.chain)}</dd><dt>Standard</dt><dd>${esc(nft.standard || 'ERC-721')}</dd>
          <dt>Contract</dt><dd class="mono">${esc(nft.contract)}</dd><dt>Token</dt><dd>#${esc(tokenId)}</dd></dl>
        <div class="links">${explorer ? `<a class="btn btn-small btn-ghost" href="${esc(explorer)}" target="_blank" rel="noopener">View on explorer ↗</a>` : ''}${market ? `<a class="btn btn-small btn-ghost" href="${esc(market)}" target="_blank" rel="noopener">View on marketplace ↗</a>` : ''}</div>
      </div>` : ''}
      <p class="tip" id="offline-line">Checking offline copy…</p>`,
    bar: { label: 'In your collection', value: esc(edShort(e)), action: `<button class="btn btn-gold btn-lg" data-d="ar">${svgIcon('ar')}Start AR</button>` },
  });
  openSheet(html, body => {
    mountStory(body);
    let preview = null, gone = false;
    const stage = $('.detail-stage', body);
    (async () => {
      try {
        const art = await openArtwork(e);
        if (gone) return;
        const ph = $('.ph', stage); if (ph && !ph.getAttribute('src')) ph.src = art.imageURL;
        if (!hasWebGL) return;
        const { LivePreview } = await loadPreview(); if (gone) return;
        preview = new LivePreview(stage, { meta: m, ...art });
        preview.ready.then(() => $('.ph', stage)?.remove()).catch(() => {});
        getTarget(targetKeyOf(e), art).catch(() => {});      // warm up AR
      } catch (err) { console.warn(err); }
    })();
    warmOne(e);
    isOffline(e).then(ok => { const l = $('#offline-line', body); if (l) l.textContent = ok ? '✓ Saved on this device: works offline.' : 'Some files will download the first time you open AR.'; });
    body.addEventListener('click', ev => {
      const b = ev.target.closest('[data-d]'); if (!b) return;
      if (b.dataset.d === 'ar') { closeSheet(); setTimeout(() => openAR(e), 280); }
      if (b.dataset.d === 'replay') preview?.replay();
      if (b.dataset.d === '3d') { if (state.room) closeSheet(); else { closeSheet(); setTimeout(() => open3D(), 280); } }
      if (b.dataset.d === 'cert') $('#cert-panel', body).scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => { gone = true; preview?.dispose(); };
  }, { full: true });
}

// ================================================================ unlock sheet (scan · code · restore)
function openUnlock(tab = 'scan') {
  const html = `<div class="create-head"><div class="eyebrow">Unlock</div><h2 id="sheet-title">Unlock your poster</h2>
    <p>Use the private QR code or the 20-character code that came with your poster.</p></div>
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="scan">${svgIcon('qr')}Scan QR</button>
      <button class="tab" role="tab" data-tab="code">${svgIcon('key')}Enter code</button>
      <button class="tab" role="tab" data-tab="nfc">${svgIcon('nfc')}NFC</button>
      <button class="tab" role="tab" data-tab="restore">${svgIcon('file')}Restore</button>
    </div>
    <div id="tab-body"></div>`;
  openSheet(html, body => {
    let scanner = null;
    const tb = $('#tab-body', body);
    let nfcAbort = null;
    const stopScan = () => { try { scanner?.stop(); } catch {} scanner = null; nfcAbort?.abort(); nfcAbort = null; };
    async function show(t) {
      stopScan();
      $$('.tab', body).forEach(x => x.setAttribute('aria-selected', x.dataset.tab === t));
      if (t === 'scan') {
        tb.innerHTML = `<div class="scanbox"><video muted playsinline></video><div class="reticle"></div><div class="scanmsg" id="scanmsg">Point at the QR code on your poster card</div></div>
          <p class="help">Tip: you can also scan the QR with your phone's camera app.</p>`;
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { tb.innerHTML = `<p class="err">The camera needs a secure (https) connection. Enter your code instead.</p>`; return; }
        let tries = 0;
        const start = async () => {
          try {
            const { startScanner } = await loadScanner();
            const v = $('video', tb); if (!v) return;
            let handled = false;
            scanner = await startScanner(v, text => {
              if (handled) return;
              if (acct.secretFrom(text) || acct.codeFrom(text)) { handled = true; stopScan(); closeSheet(); setTimeout(() => handleAccountLink(text), 260); return; }
              if (/[#&?]n=/.test(text)) { handled = true; stopScan(); closeSheet(); setTimeout(() => runPreview(text), 260); return; }
              const p = parsePayload(text);
              if (!p) { const m = $('#scanmsg', tb); if (m) m.textContent = 'That QR isn\'t an EXHIBIT code'; return; }
              handled = true; try { navigator.vibrate?.(20); } catch {} stopScan(); closeSheet(); setTimeout(() => runUnlock(text), 260);
            });
          } catch (err) {
            console.warn('scanner', err);
            const { cameraErrorMessage } = await loadScanner().catch(() => ({ cameraErrorMessage: () => 'The camera couldn\'t start.' }));
            tb.innerHTML = `<div class="scan-error"><p class="err" style="margin:0">${esc(cameraErrorMessage(err))}</p>
              <div class="btn-row" style="margin-top:12px"><button class="btn btn-gold" data-retry-scan>Try again</button><button class="btn btn-ghost" data-tab="code">Enter code</button></div></div>`;
            $('[data-retry-scan]', tb)?.addEventListener('click', () => { tries++; show('scan'); });
          }
        };
        start();
      }
      if (t === 'code') {
        tb.innerHTML = `<form class="stack" id="codeform" autocomplete="off">
            <input class="code-input" id="code" inputmode="text" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" maxlength="29" aria-label="Unlock code">
            <button class="btn btn-gold btn-lg btn-block" type="submit">${svgIcon('unlock')}Unlock</button>
            <p class="err" id="code-err"></p>
            <p class="help">The code is printed under the QR code on your poster card. Letters and numbers only. Dashes are optional.</p>
          </form>`;
        const inp = $('#code', tb);
        const PH = inp.getAttribute('placeholder');
        inp.addEventListener('focus', () => { inp.setAttribute('placeholder', ''); });
        inp.addEventListener('pointerdown', () => { inp.setAttribute('placeholder', ''); });
        inp.addEventListener('blur', () => { if (!inp.value) inp.setAttribute('placeholder', PH); });
        inp.addEventListener('input', () => { const n = normaliseCode(inp.value).slice(0, 20); const f = n ? formatCode(n) : ''; if (inp.value !== f) inp.value = f; });
        $('#codeform', tb).addEventListener('submit', ev => {
          ev.preventDefault();
          const n = normaliseCode(inp.value);
          if (n.length !== 20) { $('#code-err', tb).textContent = 'Codes are 20 characters long.'; return; }
          closeSheet(); setTimeout(() => runUnlock(n), 260);
        });
        setTimeout(() => inp.focus(), 300);
      }
      if (t === 'nfc') {
        const can = 'NDEFReader' in window;
        tb.innerHTML = `<div class="nfc-box">
            <div class="nfc-ring${can ? ' live' : ''}">${svgIcon('nfc')}</div>
            <h3>${can ? 'Hold your phone near the artwork\'s NFC tag' : (isIOS ? 'Just tap the tag with your iPhone' : 'NFC scanning isn\'t available here')}</h3>
            <p class="help" id="nfc-msg">${can ? 'Touch the back of your phone to the tag on or beside the artwork.' : isIOS ? 'Hold the top of your iPhone near the tag. A notification appears. Tap it to open the preview. No need to keep this screen open.' : 'Use Chrome on an Android phone with NFC turned on, or an iPhone (just tap the tag).'}</p>
          </div>
          <p class="help nfc-note"><b>NFC shows a temporary preview.</b> It isn't saved: tap the tag again to see the artwork again. To keep a poster in your collection for good, scan the private <b>QR code</b> that came with it.</p>`;
        if (can) {
          try {
            nfcAbort = new AbortController();
            const reader = new NDEFReader();
            await reader.scan({ signal: nfcAbort.signal });
            reader.onreading = ev => {
              let url = null;
              for (const r of ev.message.records) {
                try { if (r.recordType === 'url' || r.recordType === 'absolute-url') url = new TextDecoder().decode(r.data); else if (r.recordType === 'text') url = new TextDecoder(r.encoding || 'utf-8').decode(r.data); } catch {}
                if (url && /[#&?]n=/.test(url)) break;
              }
              if (!url || !/[#&?]n=/.test(url)) { const m = $('#nfc-msg', tb); if (m) m.textContent = 'That tag isn\'t an EXHIBIT artwork tag.'; return; }
              try { navigator.vibrate?.(30); } catch {}
              stopScan(); closeSheet(); setTimeout(() => runPreview(url), 260);
            };
            reader.onreadingerror = () => { const m = $('#nfc-msg', tb); if (m) m.textContent = 'Couldn\'t read the tag. Hold it still against the back of your phone.'; };
          } catch (err) {
            const m = $('#nfc-msg', tb);
            if (m && err.name !== 'AbortError') m.textContent = err.name === 'NotAllowedError' ? 'NFC permission was blocked. Allow it in your browser\'s site settings.' : 'Turn on NFC in your phone settings, then try again.';
          }
        }
      }
      if (t === 'restore') {
        tb.innerHTML = `<div class="stack">
            <p class="help" style="margin:0">Restore posters from an EXHIBIT backup file you saved or shared earlier.</p>
            <label class="btn btn-gold btn-lg btn-block" style="position:relative;overflow:hidden">${svgIcon('file')}Choose backup file<input type="file" id="bfile" accept=".ghbackup,application/json,.json" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label>
            <div class="field" id="pw-field" hidden><label for="bpw">Backup password</label><input type="password" id="bpw" autocomplete="current-password"><button class="btn btn-ghost btn-block" id="bpw-go" style="margin-top:10px">Restore</button></div>
            <div class="progress" id="rprog" hidden><i></i></div>
            <p class="err" id="rerr"></p>
          </div>`;
        let json = null;
        const go = async (pw) => {
          $('#rerr', tb).textContent = ''; $('#rprog', tb).hidden = false;
          try {
            const r = await restoreBackup(json, pw, p => { $('#rprog i', tb).style.width = Math.round(p * 100) + '%'; });
            await renderCollection(); acct.changed();
            closeSheet();
            toast(`Restored ${r.restored} poster${r.restored === 1 ? '' : 's'}${r.already ? ` · ${r.already} already here` : ''}${r.failed.length ? ` · ${r.failed.length} couldn't be restored` : ''}`, 4200);
            if (r.restored) setView('mine');
          } catch (err) {
            $('#rprog', tb).hidden = true;
            if (err.code === 'needs-passphrase' || err.code === 'bad-passphrase') { $('#pw-field', tb).hidden = false; if (err.code === 'bad-passphrase') $('#rerr', tb).textContent = 'Wrong password.'; }
            else $('#rerr', tb).textContent = err.message || 'Could not restore this file.';
          }
        };
        $('#bfile', tb).addEventListener('change', async ev => {
          const f = ev.target.files[0]; if (!f) return;
          try { json = await readBackupFile(f); } catch (err) { $('#rerr', tb).textContent = err.message; return; }
          if (json.sealed) { $('#pw-field', tb).hidden = false; $('#bpw', tb).focus(); } else go('');
        });
        $('#bpw-go', tb).addEventListener('click', () => go($('#bpw', tb).value));
      }
    }
    body.addEventListener('click', ev => { const t = ev.target.closest('[data-tab]'); if (t) show(t.dataset.tab); });
    show(tab);
    return stopScan;
  });
}

// ================================================================ unlock ceremony
let cerEmbers = null;
function openCeremony() {
  const c = $('#ceremony'); c.hidden = false; document.body.classList.add('locked');
  state.heroPreview?.pause();
  if (!reducedMotion) cerEmbers = embers($('#ceremony-embers'), { density: 7000, max: 70 });
  pushLayer('ceremony', fromPop => closeCeremony(fromPop));
}
function closeCeremony(fromPop = false) {
  const c = $('#ceremony'); if (c.hidden) return;
  if (!fromPop) popLayer('ceremony');
  c.hidden = true; cerEmbers?.(); cerEmbers = null; $('#cer-inner').innerHTML = '';
  if ($('#sheet').hidden && $('#ar-view').hidden && !state.room) document.body.classList.remove('locked');
  if (state.view === 'home' && !state.room) state.heroPreview?.resume();
}

async function runUnlock(input) {
  openCeremony();
  const inner = $('#cer-inner');
  inner.innerHTML = `<div class="cer-ring" id="cer-ring">${svgIcon('lock')}</div><div class="cer-eyebrow" style="animation-delay:0s">Unlocking</div><p class="cer-step" id="cer-step">Checking your code</p>`;
  const ring = $('#cer-ring', inner), step = $('#cer-step', inner);
  try {
    const { entry, already } = await unlock(input, (label, p) => { ring.style.setProperty('--p', Math.round(p)); step.textContent = label; });
    ring.style.setProperty('--p', 100);
    requestPersistence();
    warmOne(entry);   // "View in AR" is the next tap for most people
    if (!already) acct.changed();
    const art = await openArtwork(entry);
    await thumbURL(entry);
    await sleep(350);
    const m = entry.meta;
    inner.innerHTML = `
      <div class="cer-art"><img src="${esc(art.imageURL)}" alt="${esc(m.title)}"></div>
      <div class="cer-eyebrow">${already ? 'Already in your collection' : 'Unlocked'}</div>
      <h2 class="cer-title">${esc(m.title)}</h2>
      <p class="cer-by">by ${esc(m.author || entry.artist?.name || '')}${m.year ? ` · ${esc(m.year)}` : ''}</p>
      <div class="cer-meta"><span class="edition-chip">${esc(edLabel(entry))}</span>${entry.verified ? '<span class="mini-badge ok" style="font-size:12px;padding:6px 10px">✓ Certificate verified</span>' : ''}${m.nft?.contract ? '<span class="mini-badge nft" style="font-size:12px;padding:6px 10px">◆ NFT</span>' : ''}</div>
      <div class="cer-actions">
        <button class="btn btn-gold btn-lg" data-c="ar">${svgIcon('ar')}View in AR</button>
        <button class="btn btn-ghost" data-c="mine">Go to My Posters</button>
      </div>
      <p class="cer-prep" id="cer-prep">Preparing camera recognition…</p>`;
    const prep = $('#cer-prep', inner), key = targetKeyOf(entry);
    const off = onProgress(key, p => { if (prep.isConnected && p < 100) prep.textContent = `Preparing camera recognition… ${Math.round(p)}%`; });
    getTarget(key, art).then(() => { if (prep.isConnected) prep.innerHTML = '<span class="update-dot"></span>Ready for AR'; }).catch(() => { if (prep.isConnected) prep.textContent = 'Recognition will finish when you open AR'; }).finally(off);
    inner.onclick = ev => {
      const b = ev.target.closest('[data-c]'); if (!b) return;
      closeCeremony();
      if (b.dataset.c === 'ar') setTimeout(() => openAR(entry), 250);
      else setView('mine');
    };
    await renderCollection();
    if (!already) setTimeout(async () => { if (!(await lastBackup())) toast('✦ Tip: save a backup of your collection from <b>My Posters</b>', 4200); }, 2500);
  } catch (err) {
    console.warn(err);
    inner.innerHTML = `<div class="cer-ring cer-fail">${svgIcon('x')}</div><h2 class="cer-title" style="font-size:32px">Couldn't unlock</h2>
      <p class="cer-by" style="max-width:340px">${esc(err.message || 'Something went wrong.')}</p>
      <div class="cer-actions"><button class="btn btn-gold" data-c="retry">Try again</button><button class="btn btn-ghost" data-c="close">Close</button></div>`;
    inner.onclick = ev => { const b = ev.target.closest('[data-c]'); if (!b) return; closeCeremony(); if (b.dataset.c === 'retry') setTimeout(() => openUnlock(err.code === 'invalid' || err.code === 'wrong' ? 'code' : 'scan'), 250); };
  }
}

// ================================================================ NFC temporary preview
// The tag's link opens the artwork in memory only. Nothing is stored, so once the preview ends
// (closed, timed out, or the app left in the background) the tag must be scanned again.
const PREVIEW_MS = 10 * 60 * 1000, PREVIEW_BG_MS = 60 * 1000;
async function runPreview(input) {
  endPreview(true);
  openCeremony();
  const inner = $('#cer-inner');
  inner.innerHTML = `<div class="cer-ring" id="cer-ring">${svgIcon('nfc')}</div><div class="cer-eyebrow" style="animation-delay:0s">NFC preview</div><p class="cer-step" id="cer-step">Reading the tag</p>`;
  const ring = $('#cer-ring', inner), step = $('#cer-step', inner);
  try {
    const entry = await nfcPreview(input, (label, p) => { ring.style.setProperty('--p', Math.round(p)); step.textContent = label; });
    const art = await openArtwork(entry);
    state.preview = { entry, art, expires: Date.now() + PREVIEW_MS, hiddenAt: 0 };
    state.preview.timer = setInterval(tickPreview, 1000);
    warmOne(entry);
    closeCeremony();
    showPreviewPill();
    openPreviewSheet();
  } catch (err) {
    console.warn(err);
    inner.innerHTML = `<div class="cer-ring cer-fail">${svgIcon('x')}</div><h2 class="cer-title" style="font-size:32px">Couldn't open the preview</h2>
      <p class="cer-by" style="max-width:340px">${esc(err.message || 'Something went wrong.')}</p>
      <div class="cer-actions"><button class="btn btn-ghost" data-c="close">Close</button></div>`;
    inner.onclick = ev => { if (ev.target.closest('[data-c]')) closeCeremony(); };
  }
}
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function tickPreview() {
  const p = state.preview; if (!p) return;
  const left = p.expires - Date.now();
  if (left <= 0) return endPreview();
  $$('[data-preview-left]').forEach(el => { el.textContent = mmss(left); });
}
function showPreviewPill() {
  let pill = $('#preview-pill');
  if (!pill) {
    pill = document.createElement('button'); pill.id = 'preview-pill'; pill.className = 'preview-pill';
    pill.addEventListener('click', () => openPreviewSheet());
    document.body.appendChild(pill);
  }
  const e = state.preview.entry;
  pill.innerHTML = `${svgIcon('nfc')}<span><b>${esc(e.meta.title)}</b> · preview <span data-preview-left>${mmss(state.preview.expires - Date.now())}</span></span>`;
  pill.hidden = false; requestAnimationFrame(() => pill.classList.add('on'));
}
function endPreview(silent = false) {
  const p = state.preview; if (!p) return;
  clearInterval(p.timer); state.preview = null;
  const pill = $('#preview-pill'); if (pill) { pill.classList.remove('on'); setTimeout(() => { if (!state.preview) pill.hidden = true; }, 300); }
  if (!$('#ar-view').hidden && openAR.entry?.preview) closeAR();
  if (!$('#sheet').hidden && $('#sheet-body .story-preview')) closeSheet();
  closeArtwork(p.entry.key);
  if (!silent) toast('Preview ended. Tap the artwork\'s NFC tag to see it again.', 4200);
}
document.addEventListener('visibilitychange', () => {
  const p = state.preview; if (!p) return;
  if (document.hidden) p.hiddenAt = Date.now();
  else if (p.hiddenAt && Date.now() - p.hiddenAt > PREVIEW_BG_MS) endPreview();
  else p.hiddenAt = 0;
});

function openPreviewSheet() {
  const p = state.preview; if (!p) return;
  const e = p.entry, m = e.meta;
  const html = storyHTML({
    kind: 'preview', topTitle: 'NFC Preview',
    media: `<div class="detail-stage story-stage is-preview" style="aspect-ratio:${m.effect === 'golden-hour' ? '1179/820' : (m.aspect ? `1/${m.aspect}` : '4/3')}"><img class="ph" src="${esc(p.art.imageURL)}" alt=""></div>`,
    badge: `${svgIcon('nfc')}Preview`,
    title: m.title,
    by: `Created by <b>${esc(m.author || e.artist?.name || '')}</b>. You're seeing a temporary preview from this artwork's NFC tag.`,
    year: m.year,
    specs: [['Editions', esc(e.editions || '?')], ['Preview ends in', `<span data-preview-left>${mmss(p.expires - Date.now())}</span>`]],
    desc: m.description,
    body: `<div class="story-chips">
        <button class="chip" data-p="3d">${svgIcon('cube')}See it in 3D</button>
        <button class="chip" data-p="end">End preview</button>
      </div>
      ${e.owned
        ? `<div class="panel"><div class="panel-head"><span class="seal">✦</span>You own this artwork</div><p class="tip" style="margin:0 0 12px">Edition ${esc(e.owned.edition)} is in your collection, so you can open it any time.</p><button class="btn btn-gold btn-small" data-p="owned">Open my edition</button></div>`
        : `<div class="panel"><div class="panel-head"><span class="seal">✦</span>Want to keep it?</div><p class="tip" style="margin:0 0 12px">This preview isn't saved. Scan the tag again to see it again. Buy the poster and scan its private <b>QR code</b> to add the living edition to your collection for good.</p>
           <div class="links"><button class="btn btn-gold btn-small" data-p="scan">${svgIcon('qr')}I have the QR code</button><button class="btn btn-ghost btn-small" data-p="buy">Order a print</button></div></div>`}`,
    bar: { label: 'Temporary preview', value: `<span data-preview-left>${mmss(p.expires - Date.now())}</span>`, action: `<button class="btn btn-gold btn-lg" data-p="ar">${svgIcon('ar')}View in AR</button>` },
  });
  openSheet(html, body => {
    mountStory(body);
    let preview = null, gone = false;
    const stage = $('.detail-stage', body);
    (async () => {
      if (!hasWebGL) return;
      try {
        const { LivePreview } = await loadPreview(); if (gone) return;
        preview = new LivePreview(stage, { meta: m, ...p.art });
        preview.ready.then(() => $('.ph', stage)?.remove()).catch(() => {});
        getTarget(targetKeyOf(e), p.art).catch(() => {});
      } catch (err) { console.warn(err); }
    })();
    body.addEventListener('click', ev => {
      const b = ev.target.closest('[data-p]'); if (!b) return;
      const a = b.dataset.p;
      if (a === 'ar') { closeSheet(); setTimeout(() => openAR(e), 280); }
      if (a === '3d') { closeSheet(); if (!state.room) setTimeout(() => open3D(), 280); }
      if (a === 'end') endPreview();
      if (a === 'owned') { const own = state.collection.find(x => x.key === e.owned.key); if (own) openDetail(own); }
      if (a === 'scan') openUnlock('scan');
      if (a === 'buy') { closeSheet(); setTimeout(async () => { setView('market'); const l = (await loadMarket()).listings.find(x => x.artwork === e.id); if (l) openOrder(l, marketCtx()); }, 280); }
    });
    return () => { gone = true; preview?.dispose(); };
  }, { full: true });
}

// ================================================================ 3D gallery
async function open3D() {
  if (state.room) return;
  if (!hasWebGL) return toast('Your browser doesn\'t support 3D graphics.');
  state.collection = await listCollection();
  const pieces = [];
  for (const e of state.collection) {
    try {
      const art = await openArtwork(e);
      pieces.push({ key: e.key, entry: e, title: e.meta.title, artist: e.meta.author || e.artist?.name || '', year: e.meta.year || '', edition: edLabel(e).toUpperCase(), imageURL: art.imageURL });
    } catch (err) { console.warn('3d', err); }
  }
  if (state.preview) {
    const e = state.preview.entry;
    pieces.splice(pieces.length ? 1 : 0, 0, { key: e.key, entry: e, preview: true, title: e.meta.title, artist: e.meta.author || '', year: e.meta.year || '', edition: 'NFC PREVIEW', imageURL: state.preview.art.imageURL });
  }
  const owned = new Set(state.collection.map(e => e.id)); if (state.preview) owned.add(state.preview.entry.id);
  for (const a of state.gallery?.artworks || []) if (!owned.has(a.id) && a.teaser) pieces.push({ key: `locked:${a.id}`, locked: true, title: a.publicTitle || 'Still to discover', imageURL: a.teaser });
  if (!pieces.length) { toast('Unlock a poster first to see it in the 3D gallery.'); return openUnlock(); }
  return launchRoom(pieces, {
    onOpen: p => {
      if (p.locked) return openUnlock();
      if (p.preview) return openPreviewSheet();
      openDetail(p.entry);
    },
  });
}

/** Open the 3D room with any set of pieces. opts: hooks for gallery3d (title, subtitle, wallTitle, onOpen, onLike…) */
async function launchRoom(pieces, opts) {
  document.body.classList.add('locked');
  state.heroPreview?.pause();
  try {
    const { openGallery3D } = await loadRoom();
    state.room = await openGallery3D(pieces, {
      toast, ...opts,
      onExit: () => {
        state.room = null;
        popLayer('room');
        if ($('#sheet').hidden && $('#ar-view').hidden && $('#ceremony').hidden) document.body.classList.remove('locked');
        if (state.view === 'home') state.heroPreview?.resume();
      },
    });
    pushLayer('room', () => { const r = state.room; if (r) { r.close(); } });
  } catch (err) {
    console.warn(err); state.room = null; document.body.classList.remove('locked');
    toast('The 3D gallery couldn\'t start on this device.');
  }
}

/** An artist's own 3D gallery: every work they list, with details and likes. */
let roomLaunching = false;
async function openArtist3D(id) {
  if (state.room || roomLaunching) return;
  roomLaunching = true; setTimeout(() => { roomLaunching = false; }, 1500);
  if (!hasWebGL) return toast('Your browser doesn\'t support 3D graphics.');
  const m = await loadMarket(), a = artistList(m).find(x => x.id === id); if (!a) return;
  if (!$('#sheet').hidden) { closeSheet(); await sleep(280); }
  const name = a.name.replace(/\s*\(demo\)/, '');
  const pieces = a.works.map(l => ({ key: `m:${l.id}`, favKey: `m:${l.id}`, listing: l, title: l.title, artist: name, year: l.year || '', edition: (l.medium || 'Print').toUpperCase(), imageURL: l.image, openLabel: 'Details' }));
  launchRoom(pieces, {
    title: name, subtitle: `${pieces.length} work${pieces.length === 1 ? '' : 's'} · tap a work for details`,
    introTitle: `Step inside ${name}'s gallery`, wallTitle: name.toUpperCase(), wallSub: a.city ? `Artist gallery · ${a.city}` : 'Artist gallery',
    isLiked: p => isFav(p.favKey),
    onLike: p => toggleFav(p.favKey),
    onOpen: p => openOrder(p.listing, marketCtx()),
  });
}

// ================================================================ marketplace
const marketCtx = () => ({ toast, openSheet, closeSheet, esc, svgIcon, storyHTML, mountStory, openArtist3D });
let artistQuery = '';
async function showArtists() {
  const f = $('#artist-search');
  if (f && !f.dataset.bound) {
    f.dataset.bound = '1';
    const inp = $('#artist-q'), run = () => { artistQuery = inp.value.trim(); showArtists(); };
    f.addEventListener('submit', e => { e.preventDefault(); run(); inp.blur(); });
    inp.addEventListener('input', () => { clearTimeout(f._t); f._t = setTimeout(run, 160); });
  }
  try { await renderArtists($('#artists-grid'), marketCtx(), artistQuery); }
  catch (err) { console.warn(err); $('#artists-grid').innerHTML = '<div class="empty">Artists couldn\'t load. Check your connection.</div>'; }
}
async function showMarket() {
  renderArtistStrip($('#market-artists'), marketCtx()).catch(() => {});
  try { await renderMarket($('#market-grid'), marketCtx()); }
  catch (err) { console.warn(err); $('#market-grid').innerHTML = '<div class="empty">The marketplace couldn\'t load. Check your connection.</div>'; }
}

// ================================================================ legal
async function openLegal(which) { const { privacyHTML, termsHTML } = await loadLegal(); openSheet(which === 'privacy' ? privacyHTML() : termsHTML()); }

// ================================================================ backup sheet
async function openBackup() {
  const lb = await lastBackup();
  const n = state.collection.length;
  const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.ghbackup', { type: 'application/json' })] }));
  const html = `<div class="create-head"><div class="eyebrow">Backup</div><h2 id="sheet-title">Back up your collection</h2>
    <p>Your posters are saved on this phone. A backup file keeps them safe if you change phones or clear your browser. Store it anywhere: Files, iCloud, Google Drive, email, or a chat with yourself.</p></div>
    <div class="stack" style="margin-top:16px">
      <label class="toggle"><span>Include artwork files<small>Restores even without internet. Bigger file.</small></span><input type="checkbox" id="bk-files" checked></label>
      <div class="field"><label for="bk-pw">Password (optional)</label><input type="password" id="bk-pw" autocomplete="new-password" placeholder="Protect the backup with a password"></div>
      <div class="btn-row">
        ${canShareFiles ? `<button class="btn btn-gold btn-lg" data-b="share">${svgIcon('share')}Share backup…</button>` : ''}
        <button class="btn ${canShareFiles ? 'btn-ghost' : 'btn-gold'} btn-lg" data-b="save" ${canShareFiles ? '' : 'style="grid-column:1/-1"'}>${svgIcon('save')}Save to this device</button>
      </div>
      <p class="help" style="margin:0">${n} poster${n === 1 ? '' : 's'} · ${lb ? `last backup ${new Date(lb).toLocaleString()}` : 'never backed up'}</p>
      <p class="help" style="margin:0">⚠ Anyone with your backup file can unlock your posters. Add a password if you share it somewhere public.</p>
      <div class="divider"></div>
      <button class="btn btn-ghost btn-block" data-b="restore">${svgIcon('file')}Restore from a backup</button>
    </div>`;
  openSheet(html, body => {
    body.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-b]'); if (!b) return;
      if (b.dataset.b === 'restore') return openUnlock('restore');
      if (!n) return toast('Unlock a poster first');
      const label = b.innerHTML; b.disabled = true; b.textContent = 'Preparing…';
      try {
        const { file } = await buildBackup({ includeFiles: $('#bk-files', body).checked, passphrase: $('#bk-pw', body).value });
        if (b.dataset.b === 'share') { const ok = await shareBackup(file); if (!ok) await saveBackupToDevice(file); }
        else await saveBackupToDevice(file);
        toast('✓ Backup ready'); renderCollection();
      } catch (err) { console.warn(err); toast('Backup failed: ' + (err.message || 'unknown error')); }
      b.disabled = false; b.innerHTML = label;
    });
  });
}

// ================================================================ AR view
let arSession = null;
async function openAR(entry) {
  const view = $('#ar-view'), scan = $('#ar-scan'), status = $('#ar-status'), msg = $('#ar-msg'), cap = $('#ar-caption');
  const setStatus = t => { status.textContent = t || ''; status.classList.toggle('on', !!t); };
  view.hidden = false; document.body.classList.add('locked');
  state.heroPreview?.pause(); state.room?.pause();
  const m = entry.meta;
  $('#ar-title').textContent = m.title;
  $('#ar-ghost').src = state.thumbs.get(entry.key) || '';
  $('#ar-frame').style.setProperty('--ar', m.effect === 'golden-hour' ? '1.4378' : (m.aspect ? (1 / m.aspect).toFixed(4) : '1.333'));
  cap.innerHTML = `<b>${esc(m.title)}</b>${esc(m.author || '')} · ${entry.preview ? 'NFC preview' : `Ed. ${esc(edShort(entry))}`}`;
  cap.classList.remove('on');
  $('#ar-help').hidden = true; $$('.ar-gate', view).forEach(g => g.remove());
  scan.classList.remove('on');
  $('#ar-overlays').hidden = true; $('#ar-swipehint').classList.remove('on');
  pushLayer('ar', fromPop => closeAR(fromPop));

  const gate = (title, text, retry = true) => {
    setStatus('');
    const g = document.createElement('div'); g.className = 'ar-gate';
    g.innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p><div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${retry ? '<button class="btn btn-gold" data-g="retry">Try again</button>' : ''}<button class="btn btn-ghost" data-g="close">Close</button></div>`;
    g.addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (!b) return; closeAR(); if (b.dataset.g === 'retry') setTimeout(() => openAR(entry), 320); });
    view.appendChild(g);
  };
  if (!window.isSecureContext) return gate('Needs a secure link', 'The camera only works when the gallery is opened over https://.', false);
  if (!navigator.mediaDevices?.getUserMedia) return gate('Camera not available', 'This browser can\'t open the camera. Try Safari on iPhone or Chrome on Android.', false);

  const token = Symbol(); openAR.token = token; openAR.entry = entry;
  let off = () => {};
  try {
    const key = targetKeyOf(entry);
    setStatus(isReady(key) ? 'Starting camera…' : 'Preparing recognition…');
    off = onProgress(key, p => { if (p < 100 && openAR.token === token) setStatus(`Preparing recognition… ${Math.round(p)}%`); });
    const engine = loadAR().then(async mod => { await mod.loadMindAR(); return mod; });   // download the AR engine right away
    engine.catch(() => {});
    await syncEntry(entry);   // pick up overlays the artist added after this poster was unlocked
    const art = await openArtwork(entry);
    const [targetSrc, ar] = await Promise.all([getTarget(key, art), engine]);
    off();
    if (openAR.token !== token || view.hidden) return;
    setStatus('Starting camera…');
    const topbar = $('.ar-top').getBoundingClientRect().bottom;
    const ovKey = `ex-ov-${entry.id}`;
    const startOv = Math.max(0, art.overlays.findIndex(o => o.id === localStorage.getItem(ovKey)));
    const session = await ar.startAR({
      mount: $('#ar-mount'), art: { meta: entry.meta, ...art }, targetSrc, overlay: startOv,
      onFound: () => { scan.classList.remove('on'); cap.classList.add('on'); showOverlayBar(true); },
      onLost: () => { msg.textContent = 'Find the poster again'; scan.classList.add('on'); cap.classList.remove('on'); },
      onOverlay: (i, ov) => { paintOverlayBar(i); try { localStorage.setItem(ovKey, ov.id); } catch {} },
      onOverlayLoading: (i, on) => { $('#ar-overlays').classList.toggle('loading', on); },
      onOverlayError: () => toast('That overlay couldn\'t load. Check your connection and try again.'),
    });
    if (openAR.token !== token || view.hidden) { session.stop(); return; }
    arSession = session;
    paintOverlayBar(session.overlay);
    arVideoLoop();
    setStatus(''); msg.textContent = 'Fit the whole poster in the frame'; scan.classList.add('on');
  } catch (e) {
    console.error(e); off();
    if (view.hidden) return;
    const txt = String(e?.name) + ' ' + String(e?.message);
    const engine = /dynamically imported module|Importing a module|module script|Failed to fetch|error loading|Load failed|MindAR|compiler/i.test(txt);
    const camera = /NotAllowed|Permission|denied|NotFound|DevicesNotFound|Overconstrained|NotReadable|TrackStart|AbortError|getUserMedia|video/i.test(txt);
    if (camera) { const { cameraErrorMessage } = await loadScanner().catch(() => ({ cameraErrorMessage: () => 'The camera couldn\'t start.' })); gate(/NotAllowed|Permission|denied/i.test(txt) ? 'Camera access blocked' : 'Camera problem', cameraErrorMessage(e)); }
    else if (engine) gate('AR engine didn\'t load', navigator.onLine === false ? 'You\'re offline. Connect to the internet once so the AR camera engine can download, then it works offline.' : 'The AR camera engine couldn\'t download. Check your connection and try again.');
    else gate('Something went wrong', `We couldn't start AR (${String(e?.message || e?.name || 'unknown error').slice(0, 120)}). Try again, or restart the app.`);
  }
}
// ---------- AR video controls: play/pause, restart, progress bar ----------
const fmtT = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let vScrubbing = false, vRaf = 0;
function arVideoLoop() {
  cancelAnimationFrame(vRaf);
  const tick = () => {
    const view = $('#ar-view'); if (view.hidden) return;
    const fx = arSession?.media?.(), bar = $('#ar-video');
    const v = fx?.video;
    const show = !!(v && $('#ar-caption').classList.contains('on'));
    if (bar.hidden === show) { bar.hidden = !show; requestAnimationFrame(() => bar.classList.toggle('on', show)); }
    if (v) {
      const d = v.duration || 0;
      if (!vScrubbing && d) { $('#ar-vseek').value = Math.round(v.currentTime / d * 1000); $('#ar-vcur').textContent = fmtT(v.currentTime); }
      $('#ar-vdur').textContent = fmtT(d);
      $('#ar-vseek').style.setProperty('--p', `${($('#ar-vseek').value / 10).toFixed(1)}%`);
      const paused = fx.userPaused; const b = $('#ar-vplay');
      b.classList.toggle('paused', paused); b.setAttribute('aria-label', paused ? 'Play video' : 'Pause video');
    }
    vRaf = requestAnimationFrame(tick);
  };
  vRaf = requestAnimationFrame(tick);
}
(() => {
  const seek = $('#ar-vseek');
  const apply = () => { const fx = arSession?.media?.(); const v = fx?.video; if (!v?.duration) return; const t = seek.value / 1000 * v.duration; fx.seek(t); $('#ar-vcur').textContent = fmtT(t); };
  seek.addEventListener('pointerdown', () => { vScrubbing = true; });
  seek.addEventListener('input', apply);
  const end = () => { if (!vScrubbing) return; vScrubbing = false; apply(); };
  seek.addEventListener('change', end); seek.addEventListener('pointerup', end); seek.addEventListener('pointercancel', end);
})();

// ---------- AR overlays: name, dots, arrows and swipe ----------
function paintOverlayBar(i) {
  const list = arSession?.overlays || []; const bar = $('#ar-overlays');
  if (list.length < 2) { bar.hidden = true; return; }
  $('#ar-ov-title').textContent = list[i]?.title || '';
  $('#ar-dots').innerHTML = list.map((o, k) => `<button role="tab" aria-selected="${k === i}" aria-label="${esc(o.title)}" data-ov="${k}"></button>`).join('');
}
function showOverlayBar(found) {
  const list = arSession?.overlays || []; if (list.length < 2) return;
  const bar = $('#ar-overlays'); bar.hidden = false; requestAnimationFrame(() => bar.classList.add('on'));
  if (found && !localStorage.getItem('ex-ar-swiped')) { const h = $('#ar-swipehint'); h.classList.add('on'); clearTimeout(h.t); h.t = setTimeout(() => h.classList.remove('on'), 3200); }
}
function switchOverlay(dir) {
  if (!arSession || (arSession.overlays?.length || 0) < 2) return;
  dir > 0 ? arSession.next() : arSession.prev();
  try { localStorage.setItem('ex-ar-swiped', '1'); } catch {}
  $('#ar-swipehint').classList.remove('on');
  const t = $('#ar-ov-title'); t.classList.remove('swap'); void t.offsetWidth; t.classList.add('swap');
}
(() => {
  const view = $('#ar-view'); let sx = 0, sy = 0, st = 0, tracking = false;
  view.addEventListener('pointerdown', e => { if (e.target.closest('button, input, .ar-help, .ar-gate, .ar-video')) return; tracking = true; sx = e.clientX; sy = e.clientY; st = performance.now(); });
  view.addEventListener('pointerup', e => {
    if (!tracking) return; tracking = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4 && performance.now() - st < 900) switchOverlay(dx < 0 ? 1 : -1);
  });
  view.addEventListener('pointercancel', () => { tracking = false; });
  $('#ar-dots').addEventListener('click', e => { const d = e.target.closest('[data-ov]'); if (d && arSession) arSession.setOverlay(Number(d.dataset.ov)); });
  addEventListener('keydown', e => { if (view.hidden) return; if (e.key === 'ArrowRight') switchOverlay(1); if (e.key === 'ArrowLeft') switchOverlay(-1); });
})();
function closeAR(fromPop = false) {
  const view = $('#ar-view'); if (view.hidden) return;
  openAR.token = null;
  if (!fromPop) popLayer('ar');
  arSession?.stop(); arSession = null;
  $('#ar-mount').innerHTML = ''; view.hidden = true;
  $('#ar-scan').classList.remove('on'); $('#ar-status').classList.remove('on'); $('#ar-caption').classList.remove('on');
  $('#ar-overlays').classList.remove('on'); $('#ar-overlays').hidden = true; $('#ar-swipehint').classList.remove('on');
  cancelAnimationFrame(vRaf); $('#ar-video').classList.remove('on'); $('#ar-video').hidden = true;
  if ($('#sheet').hidden && $('#ceremony').hidden && !state.room) document.body.classList.remove('locked');
  if (state.view === 'home' && !state.room) state.heroPreview?.resume();
  if ($('#sheet').hidden) state.room?.resume();
  if (pendingReload) doReload();
}

// ================================================================ install banner
let deferredInstall = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; updateInstallBanner(); });
function updateInstallBanner() {
  const b = $('#install-banner'), btn = $('#install-btn'), txt = $('#install-text');
  if (isStandalone() || !state.collection.length || localStorage.getItem('ex-dismiss-install')) { b.hidden = true; return; }
  if (deferredInstall) { b.hidden = false; btn.hidden = false; }
  else if (isIOS) { b.hidden = false; btn.hidden = true; txt.innerHTML = '<b>Add EXHIBIT to your home screen:</b> tap the Share button, then “Add to Home Screen”. Then use <b>Unlock → Restore</b> with a backup to bring your posters into the app.'; }
  else b.hidden = true;
}
document.addEventListener('click', e => {
  const x = e.target.closest('[data-dismiss]'); if (!x) return;
  const which = x.dataset.dismiss;
  try { localStorage.setItem(`ex-dismiss-${which}`, String(which === 'backup' ? Math.max(0, ...state.collection.map(c => c.unlockedAt || 0)) : Date.now())); } catch {}
  const b = x.closest('.banner'); b.classList.add('gone'); setTimeout(() => { b.hidden = true; b.classList.remove('gone'); }, 250);
});
$('#install-btn').addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; updateInstallBanner(); });

// ================================================================ auto-updates (service worker)
let pendingReload = false;
const busy = () => !$('#ar-view').hidden || !$('#ceremony').hidden || !$('#sheet').hidden || !!state.room || !!state.preview;
function doReload() { if (busy()) { pendingReload = true; return; } toast('<span class="update-dot"></span>Updating to the latest version…', 1500); setTimeout(() => location.reload(), 900); }
function initServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const hadController = !!navigator.serviceWorker.controller;
  // first visit: register after the page has loaded and gone quiet, so caching never slows the first paint
  const go = () => navigator.serviceWorker.register('./sw.js', { scope: './' }).then(reg => {
    const check = () => reg.update().catch(() => {});
    setInterval(check, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }).catch(e => console.warn('sw', e));
  if (hadController) go();
  else if (document.readyState === 'complete') setTimeout(go, 3000);
  else addEventListener('load', () => setTimeout(go, 3000), { once: true });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || reloading) return; reloading = true; doReload(); });
  // re-check sheets/overlays closing for a deferred reload
  setInterval(() => { if (pendingReload && !busy()) { pendingReload = false; doReload(); } }, 2000);
}

// ================================================================ events
document.addEventListener('click', e => {
  const oa = e.target.closest('[data-artist-name]');
  if (oa) { loadMarket().then(m => { const a = artistList(m).find(x => x.name === oa.dataset.artistName); if (a) openArtist(a.id, marketCtx()); else toast('No artist page yet'); }); return; }
  const fav = e.target.closest('[data-fav]');
  if (fav) { if (!fav.closest('[data-listing]')) toggleFav(fav.dataset.fav); return; }
  const card = e.target.closest('[data-entry]');
  if (card) { const en = state.collection.find(x => x.key === card.dataset.entry); if (en) openDetail(en); return; }
  const a = e.target.closest('[data-action]'); if (!a) return;
  const act = a.dataset.action;
  // a tab tapped while the 3D gallery is still asking how to move: leave the room and go there
  if (state.room && a.closest('#tabbar')) {
    if (act === 'gallery3d') return;
    state.room.close();
  }
  if (a.tagName === 'A') e.preventDefault();
  if (act === 'home') setView('home');
  if (act === 'see-collection') setView('mine');
  if (act === 'mine') setView('mine');
  if (act === 'market') setView('market');
  if (act === 'artists') setView('artists');
  if (act === 'account') openAccount();
  if (act === 'gallery3d') open3D();
  if (act === 'privacy' || act === 'terms') openLegal(act);
  if (act === 'unlock') openUnlock();
  if (act === 'backup') openBackup();
  if (act === 'close-sheet') closeSheet();
  if (act === 'close-ar') closeAR();
  if (act === 'ar-vplay') { const fx = arSession?.media?.(); if (fx) fx.setUserPaused(!fx.userPaused); }
  if (act === 'ar-vrestart') { const fx = arSession?.media?.(); if (fx) fx.restart(); }
  if (act === 'ar-next') switchOverlay(1);
  if (act === 'ar-prev') switchOverlay(-1);
  if (act === 'ar-help') $('#ar-help').hidden = !$('#ar-help').hidden;
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#ar-view').hidden) closeAR(); else if (!$('#ceremony').hidden) closeCeremony(); else if (!$('#sheet').hidden) closeSheet(); else state.room?.close();
});
(() => {   // swipe down to close bottom sheets
  let y0 = null; const sheet = $('.sheet');
  sheet.addEventListener('touchstart', e => { if ($('#sheet-body').scrollTop <= 0 && innerWidth < 760) y0 = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchmove', e => { if (y0 === null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sheet.addEventListener('touchend', e => { if (y0 === null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; sheet.style.transform = ''; if (dy > 110) closeSheet(); });
})();
function takeJoinFromURL() {
  const h = location.hash;
  if (!/[#&](join|code)=/.test(h)) return null;
  history.replaceState(history.state, '', location.pathname + location.search);   // never keep the sign-in key in history
  return h;
}
/** A sign-in QR / link for an account, while the app is running. */
async function handleAccountLink(text) {
  const secret = acct.secretFrom(text), code = acct.codeFrom(text);
  if (!secret && !code) return;
  if (acct.signedIn()) {
    if (secret && secret === JSON.parse(localStorage.getItem('ex-sync') || '{}').secret) return toast('This device is already signed in to that account.');
    if (!confirm(`Switch accounts? This device will be signed out of ${acct.profile()?.name || 'your account'} (it stays on your other devices) and signed in to the scanned one.`)) return;
    await acct.syncNow({ force: true }).catch(() => {});
    await acct.leave({ wipe: true });
  }
  await ensureAccount({ joinSecret: secret, joinCode: code });
  location.reload();
}
function takeNfcFromURL() {
  const h = location.hash;
  if (!/[#&]n=/.test(h)) return null;
  history.replaceState(history.state, '', location.pathname + location.search);   // never keep the tag link in history
  return h;
}
function takeUnlockFromURL() {
  const h = location.hash;
  if (!/[#&]u=/.test(h)) return null;
  history.replaceState(history.state, '', location.pathname + location.search);   // strip before any layers are pushed
  return h;
}
addEventListener('hashchange', () => {
  const j = takeJoinFromURL(); if (j) return handleAccountLink(j);
  const n = takeNfcFromURL(); if (n) return runPreview(n);
  const u = takeUnlockFromURL();
  if (u) runUnlock(u);
  else if (location.hash === '#my-posters') setView('mine');
  else if (location.hash === '#marketplace') setView('market');
  else if (location.hash === '#artists') setView('artists');
  else if (location.hash === '#privacy' || location.hash === '#terms') { const w = location.hash.slice(1); history.replaceState(history.state, '', location.pathname + location.search); openLegal(w); }
});

// ================================================================ boot
function paintAvatar() {
  const b = $('#account-btn'); if (!b) return;
  const p = acct.profile();
  b.innerHTML = avatarHTML(p); b.setAttribute('aria-label', p ? `Your account: ${p.name}` : 'Account');
}
let pendingUnlock = null, pendingNfc = null, pendingJoin = null;
(async function boot() {
  pendingJoin = takeJoinFromURL();
  pendingNfc = takeNfcFromURL();
  pendingUnlock = takeUnlockFromURL();
  const legalHash = ['#privacy', '#terms'].includes(location.hash) ? location.hash.slice(1) : null;
  if (legalHash) history.replaceState(history.state, '', location.pathname + location.search);
  applyTheme();
  mountThemeButton($('.nav-actions'));
  $('.nav-actions').prepend($('.nav-actions .theme-wrap'));   // order: light/dark · Unlock · profile picture
  $('.nav-actions').appendChild($('#account-btn'));
  initServiceWorker();
  fetch('version.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(v => { if (v?.version) $('#foot-version').textContent = `v${v.version}`; }).catch(() => {});
  await runSplash({ landing: !pendingUnlock && !pendingNfc && !pendingJoin });
  // accounts: everyone signs up, or signs in by scanning a QR code from another device
  initAccountUI({ toast, esc, svgIcon, openSheet, closeSheet, loadQR, loadScanner, openLegal, openBackup: () => openBackup(),
    stats: () => ({ posters: state.collection.length, liked: (JSON.parse(localStorage.getItem('ex-favs') || '[]')).length }) });
  acct.on('profile', paintAvatar);
  acct.on('collection', async ({ added }) => { await renderCollection(); toast(`✦ ${added} poster${added === 1 ? '' : 's'} synced from your account`); });
  acct.on('signedout', ({ reason }) => { if (reason === 'removed' || reason === 'deleted') { toast(reason === 'removed' ? 'This device was removed from your account on another device.' : 'Your account was deleted on another device.', 4000); setTimeout(() => location.reload(), 2500); } });
  if (pendingJoin && acct.signedIn()) { await ensureAccount(); handleAccountLink(pendingJoin); }
  else await ensureAccount({ joinSecret: pendingJoin ? acct.secretFrom(pendingJoin) : null, joinCode: pendingJoin ? acct.codeFrom(pendingJoin) : null });
  paintAvatar();
  renderTrending($('#trend-grid'), $('#trend-chips'), marketCtx()).catch(() => {});
  renderArtistStrip($('#home-artists'), marketCtx()).catch(() => {});
  const contact = mountContact({ toast });
  document.getElementById('tabbar')?.appendChild(document.getElementById('contact'));
  contact.show();
  initJourney();
  await renderCollection();
  // nothing in the collection store but credentials mirrored on this device? restore quietly
  if (!state.collection.length && mirroredCredentials().length) {
    const creds = mirroredCredentials();
    for (const c of creds) { try { await unlock(`${c.id}.${c.edition}.${c.code}`); } catch {} }
    await renderCollection();
  }
  if (pendingNfc) { setView('home'); runPreview(pendingNfc); }
  else if (pendingUnlock) runUnlock(pendingUnlock);
  else setView({ '#my-posters': 'mine', '#marketplace': 'market', '#artists': 'artists' }[location.hash] || 'home');
  if (legalHash) openLegal(legalHash);
  warmAR();
  // owned posters pick up overlays/details the artist added later
  Promise.all(state.collection.map(e => syncEntry(e))).catch(() => {});
})();
