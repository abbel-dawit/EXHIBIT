#!/usr/bin/env bash
# Downloads pinned copies of the few open-source libraries the app bundles, so the deployed site
# never depends on another server: three.js (3D), MindAR (image tracking) and the two fonts.
# (QR scanning and QR generation are built into the app: js/qr.js.) Runs automatically on GitHub during deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V="$ROOT/vendor"
rm -rf "$V"; mkdir -p "$V/three/addons/renderers" "$V/mind-ar" "$V/fonts"
TMP="$(mktemp -d)"; cd "$TMP"
npm pack --silent three@0.160.0 mind-ar@1.2.5 @fontsource/inter@5.0.18 @fontsource/cormorant-garamond@5.0.13 >/dev/null
for f in *.tgz; do d="${f%.tgz}"; mkdir -p "$d"; tar -xzf "$f" -C "$d"; done
cp three-0.160.0/package/build/three.module.js "$V/three/"
cp three-0.160.0/package/examples/jsm/renderers/CSS3DRenderer.js "$V/three/addons/renderers/"
for f in mind-ar-1.2.5/package/dist/*; do case "$(basename "$f")" in mindar-face*) ;; *) cp -R "$f" "$V/mind-ar/";; esac; done
I=$(ls -d fontsource-inter-*/package/files); C=$(ls -d fontsource-cormorant-garamond-*/package/files)
for w in 400 500 600 700 800; do cp "$I/inter-latin-$w-normal.woff2" "$V/fonts/"; done
cp "$C/cormorant-garamond-latin-500-normal.woff2" "$C/cormorant-garamond-latin-600-normal.woff2" "$C/cormorant-garamond-latin-500-italic.woff2" "$V/fonts/"
for lic in three-0.160.0 mind-ar-1.2.5; do [ -f "$lic/package/LICENSE" ] && cp "$lic/package/LICENSE" "$V/LICENSE-${lic%-*}" || true; done
rm -rf "$TMP"
echo "vendor ready:"; find "$V" -type f | sed "s#$ROOT/##" | sort
