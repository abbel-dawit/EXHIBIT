// Marketplace: browse posters from artists and order them with one tap.
// Ordering builds a ready-to-send WhatsApp or Telegram message to the artist. Nothing is sent
// until the buyer presses send in that app, and there's no payment or server involved.
// Listings and artist contacts live in marketplace.json (edit it, commit, push).

let cache = null;
export async function loadMarket() {
  if (cache) return cache;
  try {
    const r = await fetch('marketplace.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('http ' + r.status);
    cache = await r.json();
    try { localStorage.setItem('ex-market', JSON.stringify(cache)); } catch {}
  } catch (e) {
    try { cache = JSON.parse(localStorage.getItem('ex-market') || 'null'); } catch {}
    if (!cache) throw e;
  }
  cache.listings ||= []; cache.artists ||= {};
  return cache;
}

const PROFILE_KEY = 'ex-order-profile';
const profile = {
  get() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'); } catch { return {}; } },
  set(v) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(v)); } catch {} },
};

const money = (n, cur) => {
  if (n == null || n === '') return 'Price on request';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n); }
  catch { return `${Number(n).toLocaleString()} ${cur}`; }
};
const fromPrice = (l, cur) => {
  const p = (l.sizes || []).map(s => s.price).filter(x => x != null);
  return p.length ? `${p.length > 1 ? 'From ' : ''}${money(Math.min(...p), cur)}` : 'Price on request';
};
const artistOf = (m, l) => ({ name: 'the artist', ...(m.artists[l.artist] || {}) });

// ---------- favourites (hearts), saved on this device ----------
const FAV_KEY = 'ex-favs';
const favs = () => { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { return new Set(); } };
export const isFav = id => favs().has(id);
export function toggleFav(id) {
  const f = favs(); f.has(id) ? f.delete(id) : f.add(id);
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...f])); } catch {}
  document.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`).forEach(el => el.setAttribute('aria-pressed', f.has(id)));
  return f.has(id);
}
export const heartHTML = (id, esc) => `<span class="heart" role="button" tabindex="0" data-fav="${esc(id)}" aria-pressed="${isFav(id)}" aria-label="Save"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg></span>`;

const CATS = ['All', 'Living', 'Portraits', 'Still life', 'Abstract', 'Landscapes', 'Nature', 'Saved'];
const matches = (l, cat) => cat === 'All' || (cat === 'Living' ? l.living : cat === 'Saved' ? isFav(`m:${l.id}`) : (l.category || '') === cat);

function cardHTML(m, l, esc) {
  const a = artistOf(m, l);
  return `<button class="card market-card" data-listing="${esc(l.id)}">
    <div class="card-img market-img"><img src="${esc(l.image)}" alt="" loading="lazy" decoding="async">${l.living ? '<span class="card-badge">Living</span>' : ''}${l.soldOut ? '<span class="card-edition sold">Sold out</span>' : ''}</div>
    ${heartHTML(`m:${l.id}`, esc)}
    <div class="card-body"><div class="card-title">${esc(l.title)}</div><div class="card-meta">${esc(a.name)}</div>
      <div class="market-price">${esc(fromPrice(l, m.currency || 'ETB'))}</div></div>
  </button>`;
}

function chipsHTML(m, cat, esc) {
  const present = CATS.filter(c => c === 'All' || c === 'Saved' || m.listings.some(l => matches(l, c)));
  return present.map(c => `<button class="chip" data-cat="${c}" aria-pressed="${c === cat}">${esc(c)}</button>`).join('');
}

function bindGrid(grid, chips, m, ctx, paint) {
  if (grid.dataset.bound) return; grid.dataset.bound = '1';
  grid.addEventListener('click', e => {
    const h = e.target.closest('[data-fav]'); if (h) { e.stopPropagation(); toggleFav(h.dataset.fav); if (grid.dataset.cat === 'Saved') paint(); return; }
    const c = e.target.closest('[data-listing]'); if (c) openOrder(m.listings.find(l => l.id === c.dataset.listing), ctx);
  });
  chips?.addEventListener('click', e => { const c = e.target.closest('[data-cat]'); if (!c) return; grid.dataset.cat = c.dataset.cat; paint(); });
}

/** Full marketplace grid (the Marketplace view). */
export async function renderMarket(grid, ctx) {
  const m = await loadMarket();
  const chips = document.getElementById('market-chips');
  const paint = () => {
    const cat = grid.dataset.cat || 'All';
    const list = m.listings.filter(l => matches(l, cat));
    grid.innerHTML = list.length ? list.map(l => cardHTML(m, l, ctx.esc)).join('') : `<div class="empty">${cat === 'Saved' ? 'Tap the heart on a poster to save it here.' : 'No posters here yet.'}</div>`;
    if (chips) chips.innerHTML = chipsHTML(m, cat, ctx.esc);
  };
  paint(); bindGrid(grid, chips, m, ctx, paint);
  const note = document.getElementById('market-note'); if (note && m.note) note.textContent = m.note;
}

/** "Trending Art" on the home page: same cards and chips, first few posters. */
export async function renderTrending(grid, chips, ctx) {
  if (!grid) return;
  const m = await loadMarket();
  const paint = () => {
    const cat = grid.dataset.cat || 'All';
    const list = m.listings.filter(l => matches(l, cat)).slice(0, 6);
    grid.innerHTML = list.length ? list.map(l => cardHTML(m, l, ctx.esc)).join('') : `<div class="empty">${cat === 'Saved' ? 'Tap the heart on a poster to save it here.' : 'No posters here yet.'}</div>`;
    if (chips) chips.innerHTML = chipsHTML(m, cat, ctx.esc);
  };
  paint(); bindGrid(grid, chips, m, ctx, paint);
  grid.closest('section')?.removeAttribute('hidden');
}

/** Build the order message. */
export function orderMessage({ listing, artist, size, qty, name, place, note, currency, ref, site }) {
  const each = size?.price, total = each != null ? each * qty : null;
  return [
    `Hello ${artist.name}! I'd like to order a poster I found on EXHIBIT.`,
    '',
    `• Artwork: ${listing.title}`,
    size ? `• Size: ${size.label}` : null,
    `• Quantity: ${qty}`,
    each != null ? `• Price: ${money(each, currency)} each${qty > 1 ? ` · Total ${money(total, currency)}` : ''}` : '• Price: please confirm',
    name ? `• Name: ${name}` : null,
    place ? `• Delivery: ${place}` : null,
    note ? `• Note: ${note}` : null,
    '',
    `Order ref: ${ref}`,
    'Is it available? Please let me know how to pay and when it can be delivered. Thank you!',
    site ? `\n${site}` : null,
  ].filter(x => x !== null).join('\n');
}

/** Art Story page for one listing, with ordering. */
export function openOrder(l, ctx, { fromArtist = null } = {}) {
  if (!l) return;
  const { esc, openSheet, toast, storyHTML, mountStory } = ctx;
  const m = cache, cur = m.currency || 'ETB', a = artistOf(m, l), p = profile.get();
  const sizes = l.sizes?.length ? l.sizes : [{ label: 'Standard', price: null }];
  const html = storyHTML({
    kind: 'order', topTitle: 'Art Story', cover: true, back: fromArtist ? `data-back-artist="${esc(fromArtist)}"` : '',
    media: `<img class="story-cover" src="${esc(l.image)}" alt="${esc(l.title)}">`,
    badge: l.living ? '<span class="dot"></span>Living edition' : '',
    title: l.title,
    by: `Created by <button class="artist-link" data-open-artist="${esc(l.artist)}">${esc(a.name)}</button>${a.city ? `, ${esc(a.city)}` : ''}.${l.edition ? ` ${esc(l.edition)}.` : ''}`,
    year: l.year,
    specs: [['Medium', esc(l.medium || 'Archival print')], ['Dimensions', `<span id="o-dim">${esc(sizes[0].label.replace(/^[^·]*·\s*/, ''))}</span>`]],
    desc: l.description + (l.living ? ' Comes with a private QR code that unlocks its living, animated edition in EXHIBIT.' : ''),
    body: `${l.soldOut ? '<p class="err">This poster is sold out. You can still message the artist to ask about a reprint.</p>' : ''}
      <form class="stack order-form" id="order-form" autocomplete="on" onsubmit="return false">
        <fieldset class="sizes"><legend>Choose a size</legend>
          ${sizes.map((s, i) => `<label class="size-opt"><input type="radio" name="size" value="${i}"${i === 0 ? ' checked' : ''}><span><b>${esc(s.label)}</b><small>${esc(money(s.price, cur))}</small></span></label>`).join('')}
        </fieldset>
        <div class="field"><label for="o-qty">Quantity</label><div class="qty"><button type="button" data-q="-1" aria-label="Fewer">−</button><input id="o-qty" type="number" inputmode="numeric" min="1" max="99" value="1"><button type="button" data-q="1" aria-label="More">+</button></div></div>
        <div class="field"><label for="o-name">Your name</label><input type="text" id="o-name" autocomplete="name" value="${esc(p.name || '')}" placeholder="So the artist knows who's ordering"></div>
        <div class="field"><label for="o-place">Delivery city or area</label><input type="text" id="o-place" autocomplete="address-level2" value="${esc(p.place || '')}" placeholder="e.g. Bole, Addis Ababa"></div>
        <div class="field"><label for="o-note">Note (optional)</label><input type="text" id="o-note" placeholder="Framing, gift wrap, delivery time…"></div>
        <p class="help" style="margin:0">Tap <b>Order Now</b> and choose WhatsApp or Telegram. Your order opens already written to the artist. Nothing is sent until you press send. Payment and delivery are arranged directly with the artist.</p>
      </form>`,
    bar: { label: 'Price', value: '<span id="o-total"></span>', action: `<button class="btn btn-gold btn-lg" data-order-now>Order Now</button>
        <div class="send-pair" hidden><button type="button" class="btn btn-wa" data-send="whatsapp" aria-label="Order on WhatsApp"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.3-4A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2z"/></svg>WhatsApp</button><button type="button" class="btn btn-tg" data-send="telegram" aria-label="Order on Telegram"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 4 3 11l6 2.5L19 7l-8 8 .5 5 3-3.5 4 3z"/></svg>Telegram</button></div>` },
  });
  const ref = 'EX-' + Date.now().toString(36).toUpperCase().slice(-6);
  openSheet(html, body => {
    mountStory(body);
    const qty = body.querySelector('#o-qty'), total = body.querySelector('#o-total');
    const size = () => sizes[Number(body.querySelector('input[name=size]:checked')?.value || 0)];
    const n = () => Math.max(1, Math.min(99, Math.round(Number(qty.value) || 1)));
    const paint = () => {
      const s = size(); total.textContent = s.price != null ? money(s.price * n(), cur) : 'On request';
      body.querySelector('#o-dim').textContent = s.label.replace(/^[^·]*·\s*/, '');
    };
    paint();
    body.addEventListener('change', paint); qty.addEventListener('input', paint);
    body.addEventListener('click', async e => {
      const ba = e.target.closest('[data-back-artist]'); if (ba) return openArtist(ba.dataset.backArtist, ctx);
      const oa = e.target.closest('[data-open-artist]'); if (oa) return openArtist(oa.dataset.openArtist, ctx);
      const q = e.target.closest('[data-q]'); if (q) { qty.value = Math.max(1, Math.min(99, n() + Number(q.dataset.q))); paint(); return; }
      if (e.target.closest('[data-order-now]')) {
        body.querySelector('[data-order-now]').hidden = true; body.querySelector('.send-pair').hidden = false; body.querySelector('.story-bar').classList.add('sending');
        if (!body.querySelector('#o-name').value.trim()) body.querySelector('#order-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const b = e.target.closest('[data-send]'); if (!b) return;
      const name = body.querySelector('#o-name').value.trim(), place = body.querySelector('#o-place').value.trim(), note = body.querySelector('#o-note').value.trim();
      profile.set({ name, place });
      const site = location.origin + location.pathname.replace(/index\.html$/, '') + '#marketplace';
      const text = orderMessage({ listing: l, artist: a, size: size(), qty: n(), name, place, note, currency: cur, ref, site });
      let url;
      if (b.dataset.send === 'whatsapp') {
        const num = String(a.whatsapp || '').replace(/\D/g, '');
        url = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
        if (!num) toast('This artist hasn\'t added a WhatsApp number yet. Choose who to send the order to.', 4200);
      } else {
        const user = String(a.telegram || '').replace(/^@/, '').trim();
        try { await navigator.clipboard.writeText(text); } catch {}
        url = user ? `https://t.me/${encodeURIComponent(user)}?text=${encodeURIComponent(text)}` : `https://t.me/share/url?url=${encodeURIComponent(site)}&text=${encodeURIComponent(text)}`;
        toast(user ? 'Order copied too. If the message box is empty, just paste it.' : 'This artist hasn\'t added a Telegram username yet. Choose who to send the order to.', 4200);
      }
      window.open(url, '_blank', 'noopener');
    });
  }, { full: true });
}

// ---------- artists ----------
export function artistList(m) {
  return Object.entries(m.artists).map(([id, a]) => ({ id, ...a, works: m.listings.filter(l => l.artist === id) })).filter(a => a.works.length);
}
const avatarOf = a => a.avatar || a.works[0]?.image || '';

/** Round artist avatars (home and marketplace). */
export async function renderArtistStrip(el, ctx) {
  if (!el) return;
  const m = await loadMarket(), list = artistList(m), { esc } = ctx;
  el.innerHTML = list.map(a => `<button class="artist-chip" data-open-artist="${esc(a.id)}"><span class="artist-av" style="background-image:url('${esc(avatarOf(a))}')"></span><b>${esc(a.name.replace(/\s*\(demo\)/, ''))}</b><small>${a.works.length} work${a.works.length === 1 ? '' : 's'}</small></button>`).join('');
  el.closest('section')?.removeAttribute('hidden');
  if (!el.dataset.bound) { el.dataset.bound = '1'; el.addEventListener('click', e => { const b = e.target.closest('[data-open-artist]'); if (b) openArtist(b.dataset.openArtist, ctx); }); }
}

/** All artists (the Artists view). */
export async function renderArtists(grid, ctx) {
  const m = await loadMarket(), list = artistList(m), { esc, svgIcon } = ctx;
  grid.innerHTML = list.map(a => `<div class="artist-card" data-open-artist="${esc(a.id)}" role="button" tabindex="0">
      <div class="artist-collage">${a.works.slice(0, 3).map(w => `<span style="background-image:url('${esc(w.image)}')"></span>`).join('')}</div>
      <div class="artist-card-body">
        <span class="artist-av" style="background-image:url('${esc(avatarOf(a))}')"></span>
        <div class="artist-card-text"><b>${esc(a.name)}</b><small>${esc([a.city, `${a.works.length} work${a.works.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '))}</small></div>
        <button class="btn btn-gold btn-small" data-artist-3d="${esc(a.id)}">${svgIcon('cube')}3D</button>
      </div>
    </div>`).join('') || '<div class="empty">No artists yet.</div>';
  if (!grid.dataset.bound) {
    grid.dataset.bound = '1';
    grid.addEventListener('click', e => {
      const t = e.target.closest('[data-artist-3d]'); if (t) { e.stopPropagation(); return ctx.openArtist3D(t.dataset.artist3d); }
      const c = e.target.closest('[data-open-artist]'); if (c) openArtist(c.dataset.openArtist, ctx);
    });
  }
}

/** Artist page: profile, stats, works, and a walk-through 3D gallery of everything they made. */
export async function openArtist(id, ctx) {
  const m = await loadMarket(), a = artistList(m).find(x => x.id === id); if (!a) return;
  const { esc, svgIcon, openSheet } = ctx, cur = m.currency || 'ETB';
  const prices = a.works.flatMap(w => (w.sizes || []).map(s => s.price)).filter(x => x != null);
  const liked = () => a.works.filter(w => isFav(`m:${w.id}`)).length;
  const html = `<article class="story artist-page">
    <div class="artist-cover">${a.works.slice(0, 3).map(w => `<span style="background-image:url('${esc(w.image)}')"></span>`).join('')}
      <div class="story-top">
        <button class="story-round" data-action="close-sheet" aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
        <span class="story-top-title">Artist Gallery</span>
        <button class="story-round" data-artist-3d="${esc(a.id)}" aria-label="Open 3D gallery">${svgIcon('cube')}</button>
      </div>
    </div>
    <div class="story-body">
      <div class="artist-id"><span class="artist-av lg" style="background-image:url('${esc(avatarOf(a))}')"></span>
        <div><h2 class="story-title" id="sheet-title">${esc(a.name)}</h2><p class="story-by">${esc(a.city || '')}</p></div></div>
      ${a.bio ? `<p class="story-desc">${esc(a.bio)}</p>` : ''}
      <div class="story-specs artist-stats">
        <div><small>Works</small><b>${a.works.length}</b></div>
        <div><small>You like</small><b id="artist-likes">${liked()}</b></div>
        <div class="r"><small>Prints from</small><b>${prices.length ? esc(money(Math.min(...prices), cur)) : '—'}</b></div>
      </div>
      <div class="section-head row"><h2 class="h-sm">Works</h2><button class="link-btn" data-artist-3d="${esc(a.id)}">View in 3D</button></div>
      <div class="grid masonry artist-grid">${a.works.map(l => cardHTML(m, l, esc)).join('')}</div>
    </div>
    <div class="story-bar">
      <div class="story-price"><small>3D Gallery</small><b>${a.works.length} work${a.works.length === 1 ? '' : 's'}</b></div>
      <div class="story-action"><button class="btn btn-gold btn-lg" data-artist-3d="${esc(a.id)}">${svgIcon('cube')}Walk the gallery</button></div>
    </div>
  </article>`;
  openSheet(html, body => {
    body.addEventListener('click', e => {
      const h = e.target.closest('[data-fav]'); if (h) { e.stopPropagation(); toggleFav(h.dataset.fav); const n = body.querySelector('#artist-likes'); if (n) n.textContent = liked(); return; }
      const t = e.target.closest('[data-artist-3d]'); if (t) return ctx.openArtist3D(a.id);
      const c = e.target.closest('[data-listing]'); if (c) openOrder(m.listings.find(l => l.id === c.dataset.listing), ctx, { fromArtist: a.id });
    });
  }, { full: true });
}
