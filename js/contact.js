// Floating "contact our team" button (WhatsApp + Telegram).
// DEMO MODE: leave these empty and the buttons only show a "coming soon" note.
// To go live, fill them in, commit, and push. Every installed app updates automatically.
export const CONTACT = {
  whatsapp: '',   // international number, digits only, e.g. '251911234567'
  telegram: '',   // Telegram username without @, e.g. 'goldenhourteam'
  message: 'Hi EXHIBIT team! I have a question about my poster.',
};

const ICON = {
  call: '<path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  chat: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M8 11h.01M12 11h.01M16 11h.01" stroke-width="2.6"/>',
  plane: '<path d="M21 4 3 11l6 2.5L19 7l-8 8 .5 5 3-3.5 4 3z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const svg = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;

export function mountContact({ toast = () => {} } = {}) {
  const root = document.createElement('div');
  root.className = 'contact'; root.id = 'contact';
  root.innerHTML = `
    <div class="contact-items" id="contact-items" role="menu" aria-label="Contact our team">
      <a class="contact-item wa" role="menuitem" href="#" data-contact="whatsapp" style="--d:1"><span class="contact-label">WhatsApp</span><span class="contact-bubble">${svg(ICON.chat)}</span></a>
      <a class="contact-item tg" role="menuitem" href="#" data-contact="telegram" style="--d:0"><span class="contact-label">Telegram</span><span class="contact-bubble">${svg(ICON.plane)}</span></a>
    </div>
    <button class="contact-fab" type="button" aria-expanded="false" aria-controls="contact-items" aria-label="Contact our team">
      <span class="ico ico-call">${svg(ICON.call)}</span><span class="ico ico-close">${svg(ICON.close)}</span>
    </button>`;
  document.body.appendChild(root);
  const fab = root.querySelector('.contact-fab');
  const set = open => { root.classList.toggle('open', open); fab.setAttribute('aria-expanded', open); };
  fab.addEventListener('click', e => { e.stopPropagation(); set(!root.classList.contains('open')); });
  document.addEventListener('click', e => { if (!root.contains(e.target)) set(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  root.querySelectorAll('[data-contact]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const kind = a.dataset.contact;
    const url = kind === 'whatsapp'
      ? (CONTACT.whatsapp ? `https://wa.me/${CONTACT.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(CONTACT.message)}` : null)
      : (CONTACT.telegram ? `https://t.me/${CONTACT.telegram.replace(/^@/, '')}` : null);
    set(false);
    if (url) window.open(url, '_blank', 'noopener');
    else toast(`${kind === 'whatsapp' ? 'WhatsApp' : 'Telegram'} contact is coming soon`);
  }));
  return { show() { root.classList.add('ready'); }, hide() { root.classList.remove('ready'); set(false); } };
}
