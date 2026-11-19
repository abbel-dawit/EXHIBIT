// Builds the deployable site into _site/: copies files, stamps the version into the service
// worker (this is what triggers automatic updates on every device), and writes the offline file list.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, '_site');
const INCLUDE = ['index.html', 'manifest.webmanifest', 'sw.js', 'gallery.json', 'marketplace.json', 'market', 'css', 'js', 'brand', 'icons', 'art', 'studio', 'vendor'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const item of INCLUDE) {
  const src = path.join(ROOT, item);
  if (!fs.existsSync(src)) { console.warn('skip (missing):', item); continue; }
  fs.cpSync(src, path.join(OUT, item), { recursive: true });
}
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

let sha = 'local';
try { sha = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
const now = new Date();
const version = `${now.toISOString().slice(0, 10).replace(/-/g, '.')}-${sha}`;
const swPath = path.join(OUT, 'sw.js');
fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace('__BUILD_VERSION__', `${version}-${now.getTime()}`));
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ version, built: now.toISOString() }));

// offline file list: the app shell + bundled libraries (not the studio, not artworks)
const files = [];
const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); f.isDirectory() ? walk(p) : files.push(path.relative(OUT, p).split(path.sep).join('/')); } };
for (const d of ['css', 'js', 'brand', 'icons', 'market', 'vendor']) if (fs.existsSync(path.join(OUT, d))) walk(path.join(OUT, d));
// First visit: download only what the collector app needs to open offline. The artist Studio,
// the AR engine (cached the first time AR is used), install-only icons, full-size marketplace
// images and encrypted artwork files are fetched on demand instead of all at once.
const skip = f => /LICENSE|\.map$/.test(f) || /^js\/(publish|github|zip|analyze)/.test(f) || f.startsWith('studio/') || f.startsWith('art/')
  || (f.startsWith('vendor/') && !f.startsWith('vendor/fonts/')) || /^icons\/(icon-512|icon-maskable-512)/.test(f) || /^market\/[^/]+\.jpg$/.test(f);
const precache = ['./', 'index.html', 'manifest.webmanifest', ...files.filter(f => !skip(f))];
// AR libraries: point the import map at the bundled /vendor copies when the vendor step ran
if (fs.existsSync(path.join(OUT, 'vendor/three/three.module.js'))) {
  for (const [f, base] of [['index.html', './vendor/'], ['studio/index.html', '../vendor/']]) {
    const p = path.join(OUT, f); if (!fs.existsSync(p)) continue;
    const local = { three: base + 'three/three.module.js', addons: base + 'three/addons/', mindar: base + 'mind-ar/mindar-image-three.prod.js', compiler: base + 'mind-ar/mindar-image.prod.js' };
    let h = fs.readFileSync(p, 'utf8');
    h = h.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/build\/three\.module\.js/g, local.three)
         .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/examples\/jsm\//g, local.addons)
         .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/mind-ar@1\.2\.5\/dist\/mindar-image-three\.prod\.js/g, local.mindar)
         .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/mind-ar@1\.2\.5\/dist\/mindar-image\.prod\.js/g, local.compiler)
         .replace('window.EXHIBIT_VENDOR = { local: false,', 'window.EXHIBIT_VENDOR = { local: true,');
    fs.writeFileSync(p, h);
  }
  console.log('import map → bundled vendor');
} else console.log('import map → jsDelivr (no vendor folder)');
// minify stylesheets (comments + whitespace); GitHub Pages also gzips everything
for (const f of files.filter(f => f.endsWith('.css'))) {
  const p = path.join(OUT, f);
  const css = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};,>])\s*/g, '$1').replace(/;}/g, '}').trim();
  fs.writeFileSync(p, css);
}
fs.writeFileSync(path.join(OUT, 'precache.json'), JSON.stringify({ version, files: precache }, null, 1));
console.log(`built ${version}: ${precache.length} files cached for offline use`);
