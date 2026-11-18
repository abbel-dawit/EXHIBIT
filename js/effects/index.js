// Picks the right animation for an artwork.
//   meta.effect: 'golden-hour' (hand-tuned signature effect) | 'video' (artist's own animation) | 'auto'
import { createLivingPoster } from './golden-hour.js';
import { createAutoPoster } from './auto.js';
import { createVideoPoster, makeVideo } from './video.js';
import { analyzeImage } from '../analyze.js';

/** Load an image element from a URL. */
export async function loadImage(url) {
  const img = new Image(); img.src = url; await img.decode(); return img;
}

/**
 * art: { meta, imageURL, overlayURL }
 * Returns an effect { group, reveal, update, setOpacity, setViewportHeight, dispose, aspect }
 */
export async function createEffect(THREE, art, opts = {}) {
  const img = opts.image || await loadImage(art.imageURL);
  const aspect = img.naturalHeight / img.naturalWidth;
  let fx;
  if (art.meta.effect === 'video' && art.overlayURL) {
    const video = makeVideo(art.overlayURL);
    fx = createVideoPoster(THREE, video, aspect);
  } else {
    const texture = new THREE.Texture(img); texture.needsUpdate = true;
    if (art.meta.effect === 'golden-hour') fx = createLivingPoster(THREE, texture, { embers: 140 });
    else fx = createAutoPoster(THREE, texture, art.analysis || (art.analysis = analyzeImage(img)), art.meta.preset);
    const d = fx.dispose; fx.dispose = () => { d?.(); texture.dispose(); };
  }
  fx.aspect = art.meta.effect === 'golden-hour' ? 820 / 1179 : aspect;
  return fx;
}
