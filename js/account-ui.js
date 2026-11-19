// Account screens: the welcome gate (create an account or sign in with a QR code), and the
// account page (profile, sync status, devices, "Sign in a new device" with QR code / link / short code).
import * as acct from './account.js';

const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 8h3v3H8zM13 13h3v3h-3zM13 8h3M8 13v3h3"/></svg>';
const CAM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
export const avatarHTML = (p, cls = '') => p?.picture
  ? `<span class="ex-avatar has-pic ${cls}"><img src="${p.picture}" alt="" decoding="async"></span>`
  : `<span class="ex-avatar ${cls} noimg">${initials(p?.name)}</span>`;
const ago = t => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

let H = null;   // hooks from the app
export function initAccountUI(hooks) { H = hooks; }

// ================================================================ welcome gate
/** Resolves once this device has an account. joinSecret / joinCode: sign in straight away (from a link). */
export function ensureAccount({ joinSecret = null, joinCode = null } = {}) {
  if (acct.signedIn()) { acct.restore(); return Promise.resolve(acct.profile()); }
  return new Promise(resolve => {
    const root = document.createElement('div');
    root.id = 'auth'; root.className = 'auth'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'auth-title');
    document.body.appendChild(root); document.body.classList.add('auth-open');
    let scanner = null, picture = '';
    const $ = s => root.querySelector(s);
    const stopScan = () => { try { scanner?.stop(); } catch {} scanner = null; };
    const done = p => { stopScan(); root.classList.add('leaving'); document.body.classList.remove('auth-open'); setTimeout(() => root.remove(), 500); H.toast(`Welcome${p?.name ? `, ${H.esc(p.name.split(' ')[0])}` : ''}! ✦`); resolve(p); };
    const shell = inner => `<div class="auth-card">
        <div class="auth-logo">${LOGO}</div>${inner}
        <p class="auth-legal">By continuing you agree to the <a href="#terms" data-auth-legal="terms">Terms</a> and <a href="#privacy" data-auth-legal="privacy">Privacy Policy</a>. © 2026 Abbel Dawit.</p>
      </div>`;

    function choose() {
      stopScan();
      root.innerHTML = shell(`
        <h1 class="auth-title" id="auth-title">Welcome to<br>EXHIBIT</h1>
        <p class="auth-lede">Create a free account to keep your living posters, likes and orders together on all your devices. Already have one? Sign in by scanning the QR code on your other device.</p>
        <div class="auth-actions">
          <button class="btn btn-gold btn-lg btn-block" data-a="create">Create account</button>
          <button class="btn btn-ghost btn-lg btn-block" data-a="signin">${H.svgIcon('qr')}Sign in with QR code</button>
        </div>
        <ul class="auth-points">
          <li><b>No password.</b> Your devices are your key.</li>
          <li><b>Private.</b> Everything is encrypted on your phone before it syncs.</li>
          <li><b>Free.</b> No email, no card, nothing to pay.</li>
        </ul>`);
    }
    function createForm() {
      stopScan();
      root.innerHTML = shell(`
        <button class="auth-back" data-a="back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
        <h1 class="auth-title" id="auth-title">Create your<br>account</h1>
        <p class="auth-lede">Just a name. Add a photo if you like.</p>
        <form class="auth-form" id="auth-create" autocomplete="on">
          <label class="auth-pic" title="Add a photo">
            <span class="auth-pic-img">${picture ? `<img src="${picture}" alt="">` : CAM}</span>
            <span class="auth-pic-lbl">${picture ? 'Change photo' : 'Add photo (optional)'}</span>
            <input type="file" accept="image/*" id="auth-pic" hidden>
          </label>
          <div class="field"><label for="auth-name">Your name</label><input type="text" id="auth-name" autocomplete="name" maxlength="40" placeholder="e.g. Mieraf" required></div>
          <label class="auth-check"><input type="checkbox" id="auth-agree"><span>I agree to the <a href="#terms" data-auth-legal="terms">Terms of Use</a> and <a href="#privacy" data-auth-legal="privacy">Privacy Policy</a></span></label>
          <button class="btn btn-gold btn-lg btn-block" type="submit">Create account</button>
          <p class="err" id="auth-err"></p>
        </form>`);
      const name = $('#auth-name'); setTimeout(() => name.focus(), 250);
      $('#auth-pic').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { picture = await acct.pictureFromFile(f); const nm = name.value; createForm(); $('#auth-name').value = nm; } catch { $('#auth-err').textContent = 'That photo couldn\'t be used. Try another.'; } });
      $('#auth-create').addEventListener('submit', async e => {
        e.preventDefault();
        const err = $('#auth-err'); err.textContent = '';
        if (!name.value.trim()) { err.textContent = 'Please enter your name.'; return name.focus(); }
        if (!$('#auth-agree').checked) { err.textContent = 'Please accept the Terms and Privacy Policy.'; return; }
        try { done(await acct.create({ name: name.value, picture })); } catch (ex) { err.textContent = ex.message; }
      });
    }
    function signIn(mode = 'scan') {
      stopScan();
      root.innerHTML = shell(`
        <button class="auth-back" data-a="back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
        <h1 class="auth-title" id="auth-title">Sign in</h1>
        <p class="auth-lede">On your other device, open EXHIBIT, tap your <b>picture</b> (top right), then <b>Sign in a new device</b>. Scan the QR code it shows.</p>
        <div class="tabs auth-tabs" role="tablist">
          <button class="tab" role="tab" data-mode="scan" aria-selected="${mode === 'scan'}">${H.svgIcon('qr')}Scan QR</button>
          <button class="tab" role="tab" data-mode="code" aria-selected="${mode === 'code'}">${H.svgIcon('key')}Enter code</button>
        </div>
        <div id="auth-body"></div>
        <p class="auth-status" id="auth-status" aria-live="polite"></p>`);
      const body = $('#auth-body');
      if (mode === 'scan') {
        body.innerHTML = `<div class="scanbox auth-scan"><video muted playsinline></video><div class="reticle"></div><div class="scanmsg" id="auth-scanmsg">Point at the QR code on your other device</div></div>`;
        (async () => {
          if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { body.innerHTML = '<p class="err">The camera needs a secure (https://) connection. Use <b>Enter code</b> instead.</p>'; return; }
          try {
            const { startScanner } = await H.loadScanner();
            let handled = false;
            scanner = await startScanner($('video'), text => {
              if (handled) return;
              const s = acct.secretFrom(text), c = acct.codeFrom(text);
              if (!s && !c) { const m = $('#auth-scanmsg'); if (m) m.textContent = 'That QR isn\'t an EXHIBIT sign-in code'; return; }
              handled = true; try { navigator.vibrate?.(20); } catch {} stopScan();
              go(s ? { secret: s } : { code: c });
            });
          } catch (err) {
            const { cameraErrorMessage } = await H.loadScanner().catch(() => ({ cameraErrorMessage: () => 'The camera couldn\'t start.' }));
            body.innerHTML = `<p class="err">${H.esc(cameraErrorMessage(err))}</p><button class="btn btn-ghost btn-block" data-mode="code">Enter a code instead</button>`;
          }
        })();
      } else {
        body.innerHTML = `<form class="auth-form" id="auth-code" autocomplete="off">
            <input class="code-input" id="auth-codein" inputmode="text" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX" maxlength="9" aria-label="Sign-in code">
            <button class="btn btn-gold btn-lg btn-block" type="submit">Sign in</button>
            <p class="help">Under the QR code on your other device, tap <b>Get a code</b>. Codes work for 15 minutes.</p>
          </form>`;
        const inp = $('#auth-codein');
        inp.addEventListener('input', () => { const n = acct.cleanCode(inp.value); const f = n.length > 4 ? n.slice(0, 4) + '-' + n.slice(4) : n; if (inp.value !== f) inp.value = f; });
        $('#auth-code').addEventListener('submit', e => { e.preventDefault(); go({ code: inp.value }); });
        setTimeout(() => inp.focus(), 250);
      }
    }
    async function go({ secret = null, code = null }) {
      const st = $('#auth-status'), set = t => { if (st) st.innerHTML = t ? `<span class="spin-dot"></span>${H.esc(t)}` : ''; };
      root.querySelectorAll('button, input').forEach(b => { b.disabled = true; });
      try {
        if (!secret) { set('Checking your code…'); secret = await acct.redeemCode(code); }
        const p = await acct.join(secret, set);
        done(p);
      } catch (err) {
        root.querySelectorAll('button, input').forEach(b => { b.disabled = false; });
        if (st) st.innerHTML = `<span class="err">${H.esc(err.message || 'Sign in failed.')}</span>`;
      }
    }
    root.addEventListener('click', e => {
      const l = e.target.closest('[data-auth-legal]'); if (l) { e.preventDefault(); return H.openLegal(l.dataset.authLegal); }
      const b = e.target.closest('[data-a]');
      if (b?.dataset.a === 'create') createForm();
      if (b?.dataset.a === 'signin') signIn('scan');
      if (b?.dataset.a === 'back') choose();
      const m = e.target.closest('[data-mode]'); if (m) signIn(m.dataset.mode);
    });
    if (joinSecret || joinCode) { signIn('code'); go({ secret: joinSecret, code: joinCode }); }
    else choose();
  });
}

// ================================================================ account page
export function openAccount({ showLink = false } = {}) {
  const p = acct.profile(); if (!p) return;
  const st = acct.syncState();
  const devices = acct.listDevices();
  const statusText = { synced: `Synced ${ago(st.lastSync)}`, syncing: 'Syncing…', offline: 'Offline. Syncs when you\'re back online', error: st.error || 'Sync problem', off: 'Not syncing' }[st.status] || 'Sync ready';
  const html = `<div class="acct">
    <div class="acct-head">
      <label class="acct-pic" title="Change photo">${avatarHTML(p, 'xl')}<span class="acct-pic-edit">${CAM}</span><input type="file" accept="image/*" id="acct-pic" hidden></label>
      <div class="acct-id">
        <input class="acct-name" id="acct-name" value="${H.esc(p.name)}" maxlength="40" aria-label="Your name">
        <p class="acct-since">Member since ${new Date(p.createdAt || Date.now()).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
      </div>
    </div>
    <div class="story-specs acct-stats">
      <div><small>Posters</small><b>${H.stats().posters}</b></div>
      <div class="c"><small>Liked</small><b>${H.stats().liked}</b></div>
      <div class="r"><small>Devices</small><b>${devices.length}</b></div>
    </div>
    <div class="acct-sync ${st.status}"><span class="acct-dot"></span><span id="acct-status">${H.esc(statusText)}</span><button class="link-btn" data-acct="sync">Sync now</button></div>

    <div class="panel acct-link" id="acct-link">
      <div class="panel-head"><span class="seal">${H.svgIcon('qr')}</span>Sign in a new device</div>
      <div id="acct-link-body">
        <p class="tip" style="margin:0 0 12px">Show a QR code to sign in on another phone, tablet or computer. It brings your posters, likes and details with it.</p>
        <button class="btn btn-gold btn-block" data-acct="show-qr">${H.svgIcon('qr')}Show sign-in QR code</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><span class="seal">◎</span>Your devices</div>
      <ul class="acct-devices">${devices.map(d => `<li><div><b>${H.esc(d.name)}</b><small>${d.me ? 'This device' : `Active ${ago(d.lastSeen)}`}</small></div>${d.me ? '<span class="mini-badge ok">This device</span>' : `<button class="link-btn" data-acct-remove="${H.esc(d.id)}">Remove</button>`}</li>`).join('')}</ul>
    </div>

    <div class="acct-actions">
      <button class="btn btn-ghost btn-block" data-acct="backup">${H.svgIcon('save')}Back up my posters</button>
      <button class="btn btn-ghost btn-block" data-acct="signout">Sign out of this device</button>
      <button class="link-btn danger" data-acct="delete">Delete my account from all devices</button>
    </div>
    <p class="tip acct-note">Your account lives on your devices, not on a server. It syncs encrypted through a free relay, so keep at least one device signed in (or a backup) to keep your posters.</p>
  </div>`;
  H.openSheet(html, body => {
    let codeTimer = null;
    const offStatus = acct.on('status', s => { const el = body.querySelector('#acct-status'); if (el) el.textContent = s.status === 'synced' ? `Synced ${ago(s.lastSync)}` : s.status === 'syncing' ? 'Syncing…' : s.status === 'error' ? (s.error || 'Sync problem') : s.status === 'offline' ? 'Offline. Syncs when you\'re back online' : 'Not syncing'; body.querySelector('.acct-sync')?.setAttribute('class', `acct-sync ${s.status}`); });
    const name = body.querySelector('#acct-name');
    name.addEventListener('change', () => { const v = name.value.trim(); if (v) { acct.updateProfile({ name: v }); H.toast('Name saved'); } else name.value = acct.profile().name; });
    body.querySelector('#acct-pic').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { const pic = await acct.pictureFromFile(f); acct.updateProfile({ picture: pic }); body.querySelector('.acct-pic .ex-avatar').outerHTML = avatarHTML(acct.profile(), 'xl'); H.toast('Photo updated'); } catch { H.toast('That photo couldn\'t be used'); } });
    const showQR = () => {
      const url = acct.linkURL();
      const lb = body.querySelector('#acct-link-body');
      lb.innerHTML = `<div class="acct-qr"><canvas id="acct-qr"></canvas></div>
        <p class="tip" style="margin:10px 0">On the new device, open EXHIBIT and choose <b>Sign in with QR code</b>, or scan this with its camera. <b>Only show it to devices you own:</b> anyone who scans it can open your account.</p>
        <div class="btn-row"><button class="btn btn-ghost" data-acct="copy">Copy link</button><button class="btn btn-ghost" data-acct="code">Get a code</button></div>
        <div class="acct-code" id="acct-code" hidden></div>`;
      H.loadQR().then(({ qrToCanvas }) => { const c = qrToCanvas(url, { scale: 6, margin: 3, level: 'M' }); const cv = lb.querySelector('#acct-qr'); if (cv) { cv.replaceWith(c); c.id = 'acct-qr'; } }).catch(e => console.warn(e));
      acct.syncNow({ force: true });
    };
    if (showLink) showQR();
    body.addEventListener('click', async e => {
      const rm = e.target.closest('[data-acct-remove]');
      if (rm) { if (confirm('Remove this device? It will be signed out the next time it opens EXHIBIT.')) { acct.removeDevice(rm.dataset.acctRemove); rm.closest('li').remove(); } return; }
      const b = e.target.closest('[data-acct]'); if (!b) return;
      const a = b.dataset.acct;
      if (a === 'sync') { await acct.syncNow({ force: true }); }
      if (a === 'show-qr') showQR();
      if (a === 'copy') { try { await navigator.clipboard.writeText(acct.linkURL()); H.toast('Sign-in link copied. Only send it to yourself.'); } catch { prompt('Copy this link', acct.linkURL()); } }
      if (a === 'code') {
        const box = body.querySelector('#acct-code'); box.hidden = false; box.textContent = 'Making a code…';
        try {
          const { code, expires } = await acct.makeCode();
          clearInterval(codeTimer);
          const paint = () => { const left = Math.max(0, expires - Date.now()); box.innerHTML = left ? `<b>${acct.prettyCode(code)}</b><small>Type this on the new device · ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')} left</small>` : '<small>That code expired. Tap <b>Get a code</b> for a new one.</small>'; if (!left) clearInterval(codeTimer); };
          paint(); codeTimer = setInterval(paint, 1000);
        } catch (err) { box.textContent = err.message; }
      }
      if (a === 'backup') H.openBackup();
      if (a === 'signout') {
        const others = acct.listDevices().filter(d => !d.me).length;
        const msg = others ? 'Sign out of this device? Your account stays on your other devices, and you can sign back in here with a QR code.' : 'This is your only signed-in device. If you sign out, your posters can only be brought back with a backup file (or within about 3 hours with a QR code from another device). Sign out anyway?';
        if (!confirm(msg)) return;
        H.closeSheet(); await acct.syncNow({ force: true }).catch(() => {}); await acct.leave({ wipe: true }); location.reload();
      }
      if (a === 'delete') {
        if (!confirm('Delete your EXHIBIT account from all devices? Every signed-in device will be signed out and its posters removed. Download a backup first if you want to keep them.')) return;
        H.closeSheet(); await acct.deleteEverywhere(); location.reload();
      }
    });
    return () => { clearInterval(codeTimer); offStatus(); };
  });
}
