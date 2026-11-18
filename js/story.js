// "Art Story" page: the full-screen artwork page used for collected posters, NFC previews and
// marketplace listings. Big artwork on top, bold title, "Created by", a year rule, two spec
// columns, the story, and a bottom bar with a value on the left and one yellow action.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = {
  back: '<path d="M15 6l-6 6 6 6"/>',
  more: '<circle cx="12" cy="5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>',
};
const svg = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;

/**
 * opts: {
 *   kind: 'detail' | 'preview' | 'order'      (extra class on the root)
 *   media: HTML for the artwork area (an <img> or a .detail-stage)
 *   cover: true → full-bleed image that fades into the page
 *   topTitle, moreAction: data attribute for the ⋮ button (e.g. 'data-d="cert"'), or ''
 *   badge: HTML shown on the artwork (top left)
 *   title, by (HTML), year, specs: [[label, valueHTML], [label, valueHTML]]
 *   desc, body (extra HTML), bar: { label, value (HTML), action (HTML) }
 * }
 */
export function storyHTML(o) {
  const [s1, s2] = o.specs || [];
  const desc = o.desc ? (o.desc.length > 190
    ? `<p class="story-desc clamp" id="story-desc">${esc(o.desc)}</p><button class="story-more" type="button" data-story-more>See more</button>`
    : `<p class="story-desc">${esc(o.desc)}</p>`) : '';
  return `<article class="story story-${o.kind || 'detail'}">
    <div class="story-hero${o.cover ? ' cover' : ''}">
      ${o.media}
      ${o.badge ? `<span class="story-badge">${o.badge}</span>` : ''}
      <div class="story-top">
        <button class="story-round" ${o.back || 'data-action="close-sheet"'} aria-label="Back">${svg(ICON.back)}</button>
        <span class="story-top-title">${esc(o.topTitle || 'Art Story')}</span>
        ${o.moreAction ? `<button class="story-round" ${o.moreAction} aria-label="More">${svg(ICON.more)}</button>` : '<span class="story-round ghost" aria-hidden="true"></span>'}
      </div>
    </div>
    <div class="story-body">
      <h2 class="story-title" id="sheet-title">${esc(o.title)}</h2>
      ${o.by ? `<p class="story-by">${o.by}</p>` : ''}
      ${o.year ? `<div class="story-year"><i></i><span>Year: ${esc(o.year)}</span><i></i></div>` : ''}
      ${s1 || s2 ? `<div class="story-specs">
        ${s1 ? `<div><small>${esc(s1[0])}</small><b>${s1[1]}</b></div>` : '<div></div>'}
        ${s2 ? `<div class="r"><small>${esc(s2[0])}</small><b>${s2[1]}</b></div>` : ''}
      </div>` : ''}
      ${desc}
      ${o.body || ''}
    </div>
    ${o.bar ? `<div class="story-bar">
      <div class="story-price"><small>${esc(o.bar.label)}</small><b>${o.bar.value}</b></div>
      <div class="story-action">${o.bar.action}</div>
    </div>` : ''}
  </article>`;
}

/** Wire the shared bits (See more). */
export function mountStory(body) {
  body.addEventListener('click', e => {
    const m = e.target.closest('[data-story-more]'); if (!m) return;
    const d = body.querySelector('#story-desc'); const open = d.classList.toggle('clamp');
    m.textContent = open ? 'See more' : 'See less';
  });
}
