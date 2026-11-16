/* Camera snapshots (PNG) and clips (WebM/MP4 with the app's sound), with the HUD burned in.
   The active camera view registers its feed element here. On Android the files go to the
   Gallery (Pictures/RC-Rovers, Movies/RC-Rovers) through MediaPlugin.java; on the web they
   download. Every capture is noted in Logs → Media.
   A live stream from another device can only be captured if it sends CORS headers
   (the ESP32-CAM web server does). */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { createStore } from '../state/store';
import { odo } from '../state/odometry';
import { rover } from '../rover/controller';
import { toast } from '../state/ui';
import { logEvent } from '../state/logs';
import { bus } from '../state/bus';
import { audioStream, sfx } from './sound';
import { haptic } from './native';

interface MediaNative {
  saveToGallery(o: { path: string; name: string; mime: string }): Promise<{ uri: string; album: string }>;
  open(o: { uri: string; mime: string }): Promise<void>;
}
const Media = registerPlugin<MediaNative>('Media');

type Feed = HTMLCanvasElement | HTMLImageElement;
let feed: { el: Feed; label: string } | null = null;
/** Called by the camera view. Passing null only clears the feed if `el` is the current one. */
export function registerFeed(el: Feed | null, label: string, owner?: Feed | null) {
  if (el) feed = { el, label };
  else if (!owner || feed?.el === owner) feed = null;
}
export const hasFeed = () => !!feed;

export const capture = createStore<{ clip: boolean; since: number; flash: number; last: { uri: string; mime: string } | null }>({ clip: false, since: 0, flash: 0, last: null });

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const feedSize = (el: Feed) => el instanceof HTMLCanvasElement ? [el.width, el.height] : [el.naturalWidth, el.naturalHeight];

function drawHud(g: CanvasRenderingContext2D, W: number, H: number, label: string) {
  const o = odo.get(), r = rover.get();
  const u = Math.max(1, Math.min(W, H) / 400);
  g.save();
  g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.5 * u;
  const c = 16 * u, m = 12 * u;
  for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
    g.beginPath(); g.moveTo(x, y + dy * c); g.lineTo(x, y); g.lineTo(x + dx * c, y); g.stroke();
  }
  g.fillStyle = 'rgba(232,246,255,.95)'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 3 * u;
  g.font = `600 ${11 * u}px -apple-system, Inter, Roboto, sans-serif`;
  g.textBaseline = 'top';
  g.fillText(`${label}  ·  ${r.info?.name ?? 'MARK 1'}`, m + 22 * u, m + 4 * u);
  const hdg = Math.round((((o.h * 180) / Math.PI) % 360 + 360) % 360);
  g.textAlign = 'center'; g.fillText(`${String(hdg).padStart(3, '0')}°`, W / 2, m + 4 * u);
  g.textAlign = 'right'; g.fillText(new Date().toLocaleString(), W - m - 22 * u, m + 4 * u);
  g.textBaseline = 'bottom'; g.textAlign = 'left';
  const kmh = (o.speed * 3.6).toFixed(1);
  g.font = `300 ${26 * u}px -apple-system, Inter, Roboto, sans-serif`;
  g.fillText(kmh, m + 22 * u, H - m - 2 * u);
  const w = g.measureText(kmh).width;
  g.font = `600 ${10 * u}px -apple-system, Inter, Roboto, sans-serif`;
  g.fillText('km/h', m + 26 * u + w, H - m - 6 * u);
  g.textAlign = 'right';
  g.fillText(`${r.tel.pct ?? '—'}%  ·  ${o.dist.toFixed(1)} m`, W - m - 22 * u, H - m - 6 * u);
  g.restore();
}

function blobToB64(b: Blob): Promise<string> {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] ?? ''); fr.onerror = rej; fr.readAsDataURL(b); });
}

/** Saves to the Gallery on Android (written to the cache in ~1 MB chunks, then moved), downloads on the web. */
async function save(blob: Blob, name: string, kind: 'Snapshot' | 'Clip'): Promise<string> {
  const mime = blob.type || (kind === 'Clip' ? 'video/webm' : 'image/png');
  if (Capacitor.isNativePlatform()) {
    const CH = 3 * 256 * 1024;   // multiple of 3 so base64 chunks concatenate cleanly
    for (let at = 0; at < blob.size; at += CH) {
      const data = await blobToB64(blob.slice(at, at + CH));
      if (at === 0) await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
      else await Filesystem.appendFile({ path: name, data, directory: Directory.Cache });
    }
    const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
    const out = await Media.saveToGallery({ path: uri, name, mime });
    capture.set({ last: { uri: out.uri, mime } });
    logEvent('media', `${kind} saved to ${out.album}: ${name}`, 'good', { name, bytes: blob.size, uri: out.uri });
    return out.album;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  logEvent('media', `${kind} saved: ${name}`, 'good', { name, bytes: blob.size });
  return 'Downloads';
}

export function openLast() {
  const l = capture.get().last;
  if (l && Capacitor.isNativePlatform()) Media.open(l).catch((e) => toast(String(e.message || e), 'warn'));
}

const blocked = () => toast('This camera stream does not allow capture (it needs CORS headers)', 'warn', 3200);
const noView = () => toast('Switch to a camera view (front, chase, driver, rear or top) to capture', 'neutral', 2400);

export async function snapshot() {
  if (!feed) { noView(); return; }
  const [W, H] = feedSize(feed.el);
  if (!W || !H) { toast('No camera picture yet', 'warn'); return; }
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.drawImage(feed.el, 0, 0, W, H);
  drawHud(g, W, H, feed.label);
  let blob: Blob | null = null;
  try { blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png')); } catch { blob = null; }
  if (!blob) { blocked(); return; }
  capture.set({ flash: Date.now() });
  sfx('shutter'); haptic('medium');
  const name = `rc-rovers-${stamp()}.png`;
  try {
    const where = await save(blob, name, 'Snapshot');
    toast(`📸 Saved to ${where}`, 'good', 1800);
    bus.emit('snapshot', { name });
  } catch (e) {
    toast(`Could not save the photo: ${String((e as Error).message || e)}`, 'bad', 3500);
  }
}

let rec: { mr: MediaRecorder; raf: number; chunks: Blob[]; mime: string } | null = null;

export function startClip() {
  if (rec) return;
  if (!feed) { noView(); return; }
  if (typeof MediaRecorder === 'undefined') { toast('Clip recording is not supported on this device', 'warn'); return; }
  const [fw, fh] = feedSize(feed.el);
  const H = 720, W = Math.round((fw && fh ? fw / fh : 16 / 9) * H / 2) * 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  let lastFeed = Date.now();
  const draw = () => {
    if (!rec) return;
    rec.raf = requestAnimationFrame(draw);
    if (feed) {
      lastFeed = Date.now();
      try { g.drawImage(feed.el, 0, 0, W, H); } catch { /* feed not ready */ }
      drawHud(g, W, H, feed.label);
      g.fillStyle = '#FF453A'; g.beginPath(); g.arc(W - 30, H - 30, 7, 0, Math.PI * 2); g.fill();
    } else if (Date.now() - lastFeed > 2500) {   // left the camera views: save what we have
      toast('Left the camera views: clip saved', 'neutral', 2000);
      stopClip();
    }
  };
  let stream: MediaStream;
  try {
    g.drawImage(feed.el, 0, 0, W, H);
    g.getImageData(0, 0, 1, 1);   // throws if the feed is cross-origin
    stream = c.captureStream(30);
  } catch { blocked(); return; }
  const audio = audioStream();
  audio?.getAudioTracks().forEach((t) => stream.addTrack(t));
  const mime = ['video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  let mr: MediaRecorder;
  try { mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 3_000_000 } : undefined); } catch { toast('Could not start recording', 'bad'); return; }
  rec = { mr, raf: 0, chunks: [], mime: (mr.mimeType || mime || 'video/webm').split(';')[0] };
  const since = Date.now();
  mr.ondataavailable = (e) => { if (e.data.size) rec?.chunks.push(e.data); };
  mr.onstop = () => {
    const r = rec!; rec = null;
    cancelAnimationFrame(r.raf);
    stream.getVideoTracks().forEach((t) => t.stop());
    capture.set({ clip: false, since: 0 });
    const blob = new Blob(r.chunks, { type: r.mime });
    const seconds = Math.round((Date.now() - since) / 1000);
    if (!blob.size) { toast('The clip was empty', 'warn'); return; }
    const ext = r.mime.includes('mp4') ? 'mp4' : 'webm';
    const name = `rc-rovers-${stamp()}.${ext}`;
    toast('Saving clip…', 'neutral', 1200);
    save(blob, name, 'Clip').then(
      (where) => { toast(`🎬 ${seconds}s clip saved to ${where}`, 'good', 2200); bus.emit('clip', { name, seconds }); },
      (e) => toast(`Could not save the clip: ${String((e as Error).message || e)}`, 'bad', 3500));
  };
  mr.start(1000);
  capture.set({ clip: true, since });
  rec.raf = requestAnimationFrame(draw);
  haptic('medium');
  sfx('click');
}

export function stopClip() { if (rec && rec.mr.state !== 'inactive') rec.mr.stop(); }
export const toggleClip = () => (rec ? stopClip() : startClip());
