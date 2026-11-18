// Privacy Policy and Terms of Use, shown in the app's bottom sheet (footer links, #privacy, #terms).
// Plain-language starting point written for how EXHIBIT actually works. Have it reviewed for your market.
export const LEGAL_OWNER = 'Abbel Dawit';
export const LEGAL_UPDATED = '18 November 2026';
export const LEGAL_CONTACT = '';   // optional contact email for privacy questions, e.g. 'hello@example.com'

const contactLine = () => LEGAL_CONTACT
  ? `email <a href="mailto:${LEGAL_CONTACT}">${LEGAL_CONTACT}</a>`
  : 'use the WhatsApp or Telegram button in the app';

export function privacyHTML() {
  return `<article class="legal">
  <div class="eyebrow">Legal</div>
  <h2 id="sheet-title">Privacy Policy</h2>
  <p class="legal-date">Last updated ${LEGAL_UPDATED}</p>
  <p>EXHIBIT is run by ${LEGAL_OWNER}. This policy explains what happens to your information when you use the EXHIBIT app and website.</p>

  <h3>The short version</h3>
  <p>EXHIBIT accounts have no password, email or server-side database. Your account lives on your own devices and syncs between them encrypted. We can't read it. We don't sell your data, show ads or track you across other sites.</p>

  <h3>Your account</h3>
  <ul>
    <li><b>What it holds:</b> your name, an optional photo, the unlock codes of posters you collect, your likes, and the name and delivery area you enter when ordering.</li>
    <li><b>Where it lives:</b> on each device you sign in on. It's tied together by a random secret key made on your first device. Signing in on another device works by scanning a QR code, opening a link or typing a short code (valid 15 minutes) that carries this key. Only share them with devices you own.</li>
    <li><b>How it syncs:</b> your account is compressed and <b>encrypted on your device</b> (AES-256) before it leaves, then passed between your devices through the free public relay <b>ntfy.sh</b>. ntfy.sh only receives unreadable data under a random topic name, along with technical data such as your IP address and the device type you're syncing from. Copies on the relay expire after about 3 hours.</li>
    <li><b>Deleting:</b> "Sign out of this device" removes the account from that device. "Delete my account from all devices" signs out and wipes every device that's signed in.</li>
  </ul>

  <h3>What stays on your device</h3>
  <ul>
    <li><b>Your collection:</b> the posters you unlock, their unlock codes, certificates and artwork files are saved in your browser's storage on this device only.</li>
    <li><b>Preferences:</b> your light/dark choice, AR mode and 3D gallery settings.</li>
    <li><b>Backups:</b> backup files are created on your device. You decide where they go. Anyone with an unprotected backup can unlock your posters, so add a password if you store it somewhere shared.</li>
  </ul>

  <h3>Camera, NFC and motion sensors</h3>
  <ul>
    <li><b>Camera</b> is used only to scan QR codes and to show artworks in AR. The video is processed on your device and is never recorded or uploaded.</li>
    <li><b>NFC</b> is used only to read EXHIBIT tags on artworks. The tag's link is used once to open a temporary preview and isn't stored.</li>
    <li><b>Motion sensors</b> (gyroscope) are used only while you're in the 3D gallery with motion mode turned on, to move your view.</li>
  </ul>
  <p>Your browser asks for permission before any of these are used, and you can turn them off in your browser or phone settings at any time.</p>

  <h3>Orders and messages</h3>
  <p>When you order from the Marketplace or contact the team, EXHIBIT opens WhatsApp or Telegram with a pre-written message. Nothing is sent until you press send in that app. Messages you send are handled by WhatsApp or Telegram under their own privacy policies, and by the artist you contact.</p>

  <h3>Hosting</h3>
  <p>The app is a static website hosted on GitHub Pages. Like any web host, GitHub may log technical information such as IP addresses to keep the service running and secure. See GitHub's privacy statement for details.</p>

  <h3>Children</h3>
  <p>EXHIBIT isn't directed at children under 13 and doesn't knowingly collect information from them.</p>

  <h3>Your choices</h3>
  <p>You can delete your account from all devices in the account page (tap your picture), or remove everything from one device by clearing this site's data in your browser settings. Back up first if you want to keep your posters.</p>

  <h3>Changes and contact</h3>
  <p>If this policy changes, the updated version will appear here with a new date. Questions? Please ${contactLine()}.</p>
</article>`;
}

export function termsHTML() {
  return `<article class="legal">
  <div class="eyebrow">Legal</div>
  <h2 id="sheet-title">Terms of Use</h2>
  <p class="legal-date">Last updated ${LEGAL_UPDATED}</p>
  <p>By using EXHIBIT you agree to these terms. If you don't agree, please don't use the app.</p>

  <h3>1. Copyright and ownership</h3>
  <p>© 2026 ${LEGAL_OWNER}. All rights reserved. The EXHIBIT name, logo, app design and code, and every artwork, image, animation and text shown in the app are protected by copyright and other intellectual property laws. They belong to ${LEGAL_OWNER} or to the artists who created them.</p>

  <h3>2. What buying a poster gives you</h3>
  <p>Buying a physical poster with its private QR code gives you a personal, non-exclusive, non-transferable licence to view that poster's living edition in EXHIBIT for your own enjoyment. It doesn't transfer copyright. You may not copy, screen-record for distribution, resell, publish, print, modify or use the artworks commercially without the artist's written permission. If you sell or give away the physical poster, its digital edition goes with it, and you should delete your copy.</p>

  <h3>3. QR codes and NFC tags</h3>
  <ul>
    <li><b>QR codes</b> permanently add an edition to the collection of the person who unlocks it. Each code belongs to one poster. Don't share or publish your code.</li>
    <li><b>NFC tags</b> on artworks open a <b>temporary preview</b> only. It ends when you close it or leave the app, and you need to scan the tag again to view it again. A preview doesn't give you any ownership or licence.</li>
    <li>Artists may revoke codes that have been leaked or misused.</li>
  </ul>

  <h3>4. Marketplace</h3>
  <p>The Marketplace shows posters offered by independent artists. Orders are arranged directly between you and the artist over WhatsApp or Telegram. Prices, availability, payment, delivery, returns and refunds are agreed with the artist. ${LEGAL_OWNER} isn't a party to those sales and isn't responsible for them, but please report any artist who behaves dishonestly.</p>

  <h3>5. Your account</h3>
  <p>You need a free EXHIBIT account to use the app. You're responsible for the devices you sign in on and for keeping your sign-in QR code, link and codes private. Anyone who has them can open your account. Your account isn't stored on a server, so keep at least one device signed in, or keep a backup, so you don't lose your collection.</p>

  <h3>6. Acceptable use</h3>
  <p>Don't try to break the app's encryption, extract artwork files, get around unlock or preview limits, or use the app for anything unlawful.</p>

  <h3>7. Certificates and NFTs</h3>
  <p>Certificates of authenticity and linked tokens record provenance. They don't promise any future value. Blockchains and marketplaces are run by third parties.</p>

  <h3>8. No warranty</h3>
  <p>EXHIBIT is provided "as is". We work to keep it reliable, but we can't promise it will always be available or error-free, or that it works on every device. Keep backups of your collection.</p>

  <h3>9. Limitation of liability</h3>
  <p>To the extent the law allows, ${LEGAL_OWNER} isn't liable for indirect or consequential losses, or for loss of data stored on your device, arising from your use of the app.</p>

  <h3>10. Changes</h3>
  <p>These terms may be updated from time to time. The current version will always be shown here. Questions? Please ${contactLine()}.</p>
</article>`;
}
