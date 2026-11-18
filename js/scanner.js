// In-app QR scanner for unlock codes.
// Uses the phone's built-in BarcodeDetector when it has one (Android Chrome), otherwise the app's own
// decoder in js/qr.js. No downloads, no third parties, works offline.
import { decodeQR } from './qr.js';

async function makeDetector() {
  let native = null;
  if ('BarcodeDetector' in globalThis) {
    try {
      const formats = await BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes('qr_code')) native = new BarcodeDetector({ formats: ['qr_code'] });
    } catch {}
  }
  const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
  let frame = 0;
  return async (video) => {
    if (native) { try { const r = await native.detect(video); if (r[0]?.rawValue) return r[0].rawValue; } catch { native = null; } }
    const w = video.videoWidth, h = video.videoHeight; if (!w || !h) return null;
    // alternate between the full frame and a centre crop (helps small, distant codes)
    const crop = (frame++ % 2) === 1;
    const sw = crop ? w * 0.6 : w, sh = crop ? h * 0.6 : h, sx = (w - sw) / 2, sy = (h - sh) / 2;
    const s = Math.min(1, 800 / Math.max(sw, sh));
    c.width = Math.round(sw * s); c.height = Math.round(sh * s);
    g.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return decodeQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  };
}

/** Explain why the camera couldn't start, in plain words. */
export function cameraErrorMessage(err) {
  const name = String(err?.name || ''), msg = String(err?.message || '');
  if (!window.isSecureContext) return 'The camera only works on a secure (https://) address.';
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser can\'t open the camera. Try Safari on iPhone or Chrome on Android.';
  if (/NotAllowed|Permission|denied/i.test(name + msg)) return 'Camera access was blocked. Allow the camera for this site in your browser settings (on iPhone: Settings → Safari → Camera), then try again.';
  if (/NotFound|DevicesNotFound|OverconstrainedError/i.test(name + msg)) return 'No camera was found on this device.';
  if (/NotReadable|TrackStart|AbortError/i.test(name + msg)) return 'The camera is busy in another app. Close other apps using the camera and try again.';
  return 'The camera couldn\'t start. Try again, or enter your code instead.';
}

/**
 * Start scanning into a <video> element. Calls onResult(text) for each decoded QR (until stopped).
 * Returns { stop() }.
 */
export async function startScanner(video, onResult) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    if (e?.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    else throw e;
  }
  video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.muted = true; video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  const detect = await makeDetector();
  let running = true, busy = false;
  const tick = async () => {
    if (!running) return;
    if (!busy && video.readyState >= 2) {
      busy = true;
      try { const text = await detect(video); if (text && running) onResult(text); } catch {}
      busy = false;
    }
    setTimeout(tick, 120);
  };
  tick();
  return { stop() { running = false; stream.getTracks().forEach(t => t.stop()); video.srcObject = null; } };
}
