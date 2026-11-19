# EXHIBIT: a private gallery of living art

© 2026 Abbel Dawit. All rights reserved.

EXHIBIT is a web app that runs as a static site on GitHub Pages. There's no server and no database, nothing to pay for, and it works offline.

- **Collectors** buy a poster and get a private QR code with it. Scanning the code unlocks the poster's living edition: an animated version of the artwork, a certificate of authenticity signed by the artist, and an optional NFT token. Unlocked posters live on the collector's phone, work offline, and can be backed up anywhere.
- **The artist** uses the private **Studio** (`/studio/`) to:
  - add artworks (title, author, year, description)
  - choose each artwork's moving overlay: auto-generated, or their own `.mp4`/`.mov`
  - set the number of editions
  - print one unique QR card per poster
  - link NFTs
  - publish to GitHub in one click
  - write NFC tags that give visitors a temporary preview
- **Everyone** can walk through their collection in a **3D gallery**, and order posters from artists in the **Marketplace** over WhatsApp or Telegram.

---

## 1 · Go live on GitHub Pages (about 10 minutes, once)

1. Create a new repository on GitHub, for example `exhibit`. A public repository works, because the artworks are encrypted (see Security below).
2. Upload **everything in this folder**, including the hidden `.github` folder. Either:
   - drag the folder into GitHub's "Add file → Upload files" page, or
   - use git:
     ```
     git init && git add . && git commit -m "EXHIBIT" && git branch -M main
     git remote add origin https://github.com/YOUR-USERNAME/exhibit.git && git push -u origin main
     ```
3. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
4. Open the **Actions** tab and wait for "Deploy EXHIBIT" to turn green (about a minute). Your gallery is live at `https://YOUR-USERNAME.github.io/exhibit/`.

Each deploy automatically:
- bundles the open-source libraries (3D engine, image tracking, fonts) into the site, so nothing loads from other servers. The QR scanner and the Studio's QR printing are built into the app itself (`js/qr.js`), so they work however the site is hosted.
- stamps a new version, which makes every installed copy update itself

> **AR not starting?** The AR camera engine (MindAR) and 3D engine (three.js) are bundled into `vendor/` by the GitHub Actions deploy. Make sure **Settings → Pages → Source** is **GitHub Actions** (not "Deploy from a branch"). If the site is ever published without that step, the app now loads the same pinned versions from jsDelivr instead, so AR still works, but the first AR start then needs an internet connection.

## 2 · Try the demo

The repository ships with **Golden Hour** by **Mieraf Girum** (the woman in the golden light) and 10 demo editions. The demo keys were regenerated for this version, so the old demo codes no longer work. The new codes, the demo vault and its password are in the separate demo-keys download (`demo-codes.txt`, `exhibit-demo-vault.ghvault`). Keep them out of the public repository.

To try edition 1, tap **Unlock → Enter code** and type its code, or tap **Unlock → Scan QR** and scan the QR card from the demo-keys download. You can also open:

```
https://YOUR-USERNAME.github.io/exhibit/#u=golden-hour.1.<CODE>
```

To make phone-camera QR cards that open your site directly, open the Studio, choose **Open a vault file**, pick `exhibit-demo-vault.ghvault`, enter the password, set your address in **Settings**, then use **Editions & QR → Print QR cards**.

## 3 · Make it yours (before selling)

The demo keys were generated during development, so replace them with your own:

1. Open `https://YOUR-USERNAME.github.io/exhibit/studio/`.
2. Choose **Create a new artist identity**, enter your name and a strong password, and keep the downloaded `.ghvault` file safe. Your vault and password together *are* your studio: they hold your signing key and every unlock code. Store copies somewhere safe, such as a password manager or an offline drive.
3. Open **Settings**:
   - set the gallery address
   - optionally add a GitHub token for one-click publishing: a fine-grained token with only this repository and **Contents: Read and write**
4. **+ Add artwork**:
   - **Artwork image:** upload your high-resolution print file.
   - **Details:** enter the title, author, year, description and number of editions.
   - **Moving overlay:** choose **Auto-generate** (a simple moving version made from the artwork itself, with styles like Golden glow, Dream drift, Starlight and Ripple; no AI and nothing leaves your device) or **Upload video** (`.mp4` or `.mov`, automatically scaled and cropped onto the artwork).
5. **Editions & QR → Print QR cards** prints one card per poster, with the QR code, edition number and backup code. Put the matching card with each poster you sell.
6. **Publish to GitHub** (or **Download ZIP** and upload the files yourself). Collectors' apps pick up the update automatically.

Publishing from your new vault replaces the demo in `gallery.json`. You can then delete the old `art/golden-hour/` folder from the repository.

Other Studio tools:
- **Revoke** a leaked code, or **re-issue** an edition with a new code.
- **Add editions** later.
- **Download codes (CSV)** for your sales records.

## 4 · Contact buttons (WhatsApp & Telegram)

The golden call button (bottom-right) opens WhatsApp and Telegram buttons. They're in **demo mode** for now: tapping one shows "coming soon". To make them work, edit `js/contact.js`:

```js
whatsapp: '251911234567',   // your number with country code, digits only
telegram: 'yourteam',       // your Telegram username, without @
```

Commit and push. Every installed app picks up the change automatically.

## 5 · NFTs

A static website can't write to a blockchain by itself. Minting needs a wallet and a network fee. To link your editions to NFTs:

1. Mint your editions with any tool where **you own the contract** (for example Manifold), on the chain you prefer.
2. In the Studio, open **NFT** on the artwork. Enter the chain, contract address and token IDs, then publish.
3. Use **Download token metadata** for ready-made metadata (edition, artist, and the artwork's SHA-256 fingerprint).

Collectors then see their token, with a link to verify it on the chain's explorer. The same fingerprint appears on the signed certificate, which ties the physical poster, the certificate and the token together.

NFTs record provenance and ownership. They don't stop someone copying an image, and they don't guarantee future value. Copying is limited by the encryption described below.

## 6 · Security: what is and isn't protected

What is protected:
- **Artworks are encrypted** (AES-256-GCM). The site only hosts ciphertext. Each poster's code derives the key that opens it, and codes are 100-bit random, so they can't be guessed.
- **Every edition has its own code.** One leaked code exposes one edition, and you can revoke it.
- **Certificates are signed** with the artist's private key (ECDSA P-256). The app verifies every certificate, offline, against the artist's public key in `gallery.json`.
- **The Studio holds no secrets on the server.** Your vault exists only as an encrypted file and in your own browser.

Limits of a serverless design:
- Anyone holding a valid code (or a collector's backup file) can unlock that edition on any device.
- Revoking only stops new unlocks. People who already unlocked keep their copy.
- A collector can screenshot their own screen.

Device limits or transfer control would need a server.

## 7 · For collectors

- **Install:** "Add to Home Screen" (iPhone: Share → Add to Home Screen; Android: Install). The app works offline after the first visit.
- **iPhone note:** iOS keeps home-screen apps separate from Safari. Unlock inside the installed app, or move posters across with **Back up → Restore**.
- **Backups:** **My Posters → Back up** creates a small file you can share to Files, iCloud, Drive, email or chat. You can add a password. **Unlock → Restore** brings everything back on any device.
- **Light or dark:** tap the sun/moon button at the end of the top bar to switch. Until you tap it, the app follows the phone's own setting. The splash and camera views stay dark in both themes, so they keep their cinematic feel over the artwork.
- **AR modes:**
  - **Fit** (default) keeps the artwork fully on screen with padding, tilting and drifting as you move.
  - **Pin** locks it exactly onto the print.

  The overlay is slightly transparent, so the real poster shows through.

## 8 · Look and feel

Warm cream background, bold black type (Inter 700/800, bundled at deploy), mustard buttons, rounded image-first art cards with hearts, and a floating tab bar at the bottom (Home · Marketplace · 3D Gallery · My Posters · Contact). Unlock and the light/dark switch sit top right. Every artwork opens as a full-screen **Art Story** page: big artwork, title, "Created by", year, two detail columns, the story, and a bar at the bottom with the price or edition and one yellow action. The app starts in light mode. Tap the moon for dark mode. Colours are CSS variables at the end of `css/app.css` (`--mustard`, `--ink`, `--cream`).

## 9 · 3D Gallery

Tap the cube button in the top bar (or **3D Gallery** on My Posters) to step into a clean, white-walled museum room with every poster in your collection framed on the walls. Artworks you haven't unlocked yet hang at the end, dimmed and locked.

- **Touch:** drag anywhere to look around. Use the pad (bottom left) to walk forward/back and turn. Tap an artwork to walk up to it, or tap the floor to walk there. On a computer, drag with the mouse and use W A S D or the arrow keys.
- **Move your phone:** turn and tilt your phone to look left, right, up and down. You walk forward on your own in the direction you face, slowing down at artworks. Tap the pause button to stop and start. Drag sideways to nudge which way is forward, or tap the round arrow to face into the room. iPhone asks for "Motion & Orientation" permission the first time.
- Look at a work up close and its label appears. Tap **View live** to open the animated living edition.

The room is plain WebGL (`js/gallery3d.js`) with no extra download, so it runs smoothly on phones.

## 10 · NFC tags: temporary previews

Stick an NFC tag (NTAG213/215/216 stickers work) on or beside each artwork, for example at an exhibition or in a shop.

1. In the Studio, open **NFC tag** on the artwork.
2. In Chrome on Android, tap **Write to NFC tag** and hold the tag to the phone. On iPhone or desktop, copy the link and write it as a URL record with a free app such as NFC Tools.
3. Publish.

What visitors get:
- **Tapping the tag opens a temporary preview** of the living edition (animated, in AR and in the 3D room). On iPhone, the tag opens a notification. On Android, tap **Unlock → NFC** in the app, or just tap the tag.
- **Nothing is saved.** The preview ends when they tap **End preview**, after 10 minutes, or when the app has been in the background for over a minute. To see it again they have to tap the tag again, so owners can always view their work while they have it with them.
- **Only the poster's QR code adds it to a collection for good.**

Each artwork has one tag secret, separate from the edition codes. If a tag link leaks, use **New tag secret**, publish, and re-write your tags. The app removes the tag link from the address bar immediately, but a static site can't stop someone who copies the link off the tag itself. Treat it as a preview, not as protection.

## 11 · Marketplace

The **Marketplace** (bag button) lists posters people can order straight from the artists. Choosing a size, quantity and delivery area and tapping **Order on WhatsApp** or **Order on Telegram** opens that app with the full order written out (artwork, size, quantity, price, total, name, delivery area and an order reference), addressed to the artist. Nothing is sent until the buyer presses send. Payment and delivery are arranged in the chat.

Edit `marketplace.json` to add artists and listings, then commit and push:

```json
"artists": { "selam": { "name": "Selam T.", "city": "Bahir Dar", "whatsapp": "251911234567", "telegram": "selamart" } },
"listings": [ { "id": "blue-nile", "title": "Blue Nile Morning", "artist": "selam", "image": "market/color-study.jpg", "category": "Abstract", "year": "2026", "medium": "Giclée print",
  "description": "…", "edition": "Open edition", "sizes": [ { "label": "A3 · 29.7 × 42 cm", "price": 1500 } ] } ]
```

- `whatsapp`: international number, digits only. `telegram`: username without @. If either is empty, the app lets the buyer pick who to send the order to.
- `"living": true` shows the "Comes with a living AR edition" badge. `"artwork": "<id>"` links a listing to a gallery artwork so its NFC preview can offer **Order a print**. `"soldOut": true` marks it sold out.
- `category` (Portraits, Abstract, Landscapes…) drives the filter chips, and `year` and `medium` appear on the Art Story page. Hearts save posters to the **Saved** chip on this device.
- `currency` (top level) is used for all prices, for example `"ETB"`.
- The listings that ship with the app are demos: Golden Hour by Mieraf Girum plus four public-domain artworks from Unsplash (Europeana, NYPL, Birmingham Museums Trust, Boston Public Library). Replace them with real artists and contacts before going live.

## 12 · Artist galleries

Every artist in `marketplace.json` gets an **artist gallery**: round avatars on Home and in the Marketplace, plus a **Meet the Artists** page (`#artists`). An artist page shows their bio, how many of their works you've liked, prices, and all their works. **Walk the gallery** opens a 3D room with the artist's name on the wall and only their works on the walls. In the room, tap a work for its label, tap the heart to like it, and tap **Details** for the Art Story page where it can be ordered. Likes are shared with the hearts in the Marketplace and saved on the device. Add `"bio"` and optionally `"avatar"` (an image path) to each artist in `marketplace.json`.

## 13 · Accounts and sync (same model as BAZINGA!)

Everyone needs an account. After **Launch App**, the welcome screen offers **Create account** (a name, an optional photo, and accepting the Terms) or **Sign in with QR code**.

- **No password and no server.** An account is the profile plus a random secret *sync key* made on the first device. It lives only on the user's devices.
- **Signing in a new device:** on a signed-in device, tap your picture (top right) → **Show sign-in QR code**. The new device scans it (in the app or with the phone camera, which opens `…/#join=<key>`), or types the 8-character code from **Get a code**, which works once for 15 minutes.
- **What syncs:** profile (name, photo), every collected poster's unlock code (other devices download and decrypt the poster themselves), likes, and order details. A device list shows each signed-in device, and you can remove any of them.
- **How:** everything is compressed and encrypted with AES-256-GCM on the device, then passed through the free public relay **ntfy.sh** under a topic named by a one-way hash of the key. The relay only sees unreadable bytes. Copies there expire after about 3 hours; open devices re-post well before that, and sync live within seconds while open.
- **Sign out of this device** removes the account and its posters from that device. **Delete my account from all devices** wipes every signed-in device.
- Want your own relay? Run an ntfy server and set `window.EXHIBIT_CONFIG = { syncRelay: 'https://your-ntfy' }` before `js/app.js` loads.
- Code: `js/account.js` (sync engine) and `js/account-ui.js` (welcome screen and account page).

## 14 · Speed

- The splash waits only for the gallery list and your collection. The AR camera engine downloads and prepares your posters in the background after the app opens (skipped on Data Saver or 2G, where it loads when you tap AR).
- Cards, avatars and the landing collage use 640px thumbnails from `market/thumbs/`. Full images load only on artwork pages. Add `"thumb"` to new listings in `marketplace.json`.
- First visit: the service worker starts after the page has loaded and saves only the app itself (not the Studio, AR engine or full-size images). Repeat visits open from the saved copy straight away and refresh in the background. New deploys still switch over automatically.
- Startup modules are preloaded in parallel, the CSS is minified at build, and the legal pages and QR generator load only when needed.

## 15 · AR overlays

- **Locked to the poster.** In AR the overlay is anchored to the printed poster: it moves, tilts and scales with it as you walk around, and hides when the poster leaves the camera. (The old "fit to screen" mode is gone.) Tracking is tuned to follow movement closely without jitter (`TRACKING` in `js/ar.js`).
- **Several overlays per artwork.** Collectors swipe left or right in AR (or use the arrows and dots) to switch. The app remembers the last one per artwork. Golden Hour ships with two: **Living light** (the animated effect) and **The making of** (Mieraf's time-lapse video).
- **Adding overlays:** in the Studio, open an artwork → **AR overlays** → **Add video overlay** (MP4/H.264, roughly the poster's shape, under ~10 MB). Reorder, rename or remove, then **Publish**. Videos are encrypted with the artwork's key, so only owners and NFC previews can play them. People who already own the poster get new overlays automatically the next time they open it.

## 16 · Legal

The footer carries the copyright notice (© 2026 Abbel Dawit) and links to the **Privacy Policy** and **Terms of Use**, which open inside the app (also at `#privacy` and `#terms`). Their text is in `js/legal.js`. It's a plain-language starting point written to match how the app works. Set `LEGAL_CONTACT` there, and have a lawyer review both texts for your country before you sell.

## Files

```
index.html, css/, js/       the collector app
  js/crypto.js              encryption, codes, signatures (WebCrypto, no libraries)
  js/gallery.js             unlock, offline storage
  js/backup.js              backup / share / restore
  js/ar.js                  camera AR, fit & pin modes
  js/theme.js               light / dark / auto theme
  js/qr.js                  built-in QR scanner + QR generator (no libraries)
  js/contact.js             WhatsApp / Telegram contact details
  js/gallery3d.js           3D museum room (touch + motion controls)
  js/market.js              marketplace + WhatsApp / Telegram orders
  js/legal.js               privacy policy and terms of use
  js/story.js               the full-screen Art Story artwork page
marketplace.json, market/   marketplace listings and their images
  js/effects/               golden-hour (signature), auto (any artwork), video (artist's own)
studio/                     the artist Studio
gallery.json, art/          the published (encrypted) gallery
sw.js, manifest.webmanifest offline + install + auto-update
tools/vendor.sh, build.mjs  run by GitHub Actions on every push
.github/workflows/          the deploy pipeline
```

**Run it locally** (needs Node 18+ and internet once):

```
bash tools/vendor.sh && node tools/build.mjs && npx serve _site
```
