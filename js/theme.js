// Light / dark theme. Preference: 'auto' (follows the phone), 'light' or 'dark'. Saved on this device.
const KEY = 'gh-theme';
const COLORS = { dark: '#14120f', light: '#f1ede4' };
const mq = matchMedia('(prefers-color-scheme: light)');

export const getPref = () => { try { return localStorage.getItem(KEY) || 'light'; } catch { return 'light'; } };
const resolve = p => p === 'auto' ? (mq.matches ? 'light' : 'dark') : p;

export function applyTheme(animate = false) {
  const t = resolve(getPref()), root = document.documentElement;
  if (animate) { root.classList.add('theming'); setTimeout(() => root.classList.remove('theming'), 450); }
  root.dataset.theme = t;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', COLORS[t]));
  document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
  return t;
}
export function setPref(p) { try { localStorage.setItem(KEY, p); } catch {} return applyTheme(true); }
mq.addEventListener?.('change', () => { if (getPref() === 'auto') applyTheme(true); });

const ICONS = {
  auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
};
/** Adds a single-tap light/dark toggle to the end of `container`. Each tap flips the theme. */
export function mountThemeButton(container) {
  const wrap = document.createElement('div'); wrap.className = 'theme-wrap';
  const btn = document.createElement('button');
  btn.className = 'nav-btn theme-btn'; btn.type = 'button';
  const paint = () => {
    const now = resolve(getPref()), next = now === 'dark' ? 'light' : 'dark';
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[now]}</svg>`;
    btn.title = `Switch to ${next} mode`; btn.setAttribute('aria-label', `Switch to ${next} mode`);
    btn.setAttribute('aria-pressed', String(now === 'dark'));
  };
  paint();
  btn.addEventListener('click', e => {
    e.stopPropagation();
    setPref(resolve(getPref()) === 'dark' ? 'light' : 'dark');
    btn.classList.remove('spin'); void btn.offsetWidth; btn.classList.add('spin');
    paint();
  });
  document.addEventListener('themechange', paint);
  wrap.appendChild(btn); container.append(wrap);
  return wrap;
}
