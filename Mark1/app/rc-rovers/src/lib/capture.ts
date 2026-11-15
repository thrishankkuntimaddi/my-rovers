/* Camera snapshots (PNG) and clips (WebM/MP4 with the app's sound), with the HUD
   burned in. The camera view registers its feed element here. Files download on the
   web and open the share sheet on Android; every capture is noted in Logs → Media.
   A live stream from another device can only be captured if it allows it (CORS). */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { createStore } from '../state/store';
import { odo } from '../state/odometry';
import { rover } from '../rover/controller';
import { toast } from '../state/ui';
import { logEvent } from '../state/logs';
import { bus } from '../state/bus';
import { audioStream, sfx } from './sound';
import { haptic } from './native';

type Feed = HTMLCanvasElement | HTMLImageElement;
let feed: { el: Feed; label: string } | null = null;
export function registerFeed(el: Feed | null, label: string) { feed = el ? { el, label } : null; }

export const capture = createStore<{ clip: boolean; since: number; flash: number }>({ clip: false, since: 0, flash: 0 });

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
  g.font = `300 ${26 * u}px -apple-system, Inter, Roboto, sans-serif`;
  g.fillText(o.speed.toFixed(1), m + 22 * u, H - m - 2 * u);
  const w = g.measureText(o.speed.toFixed(1)).width;
  g.font = `600 ${10 * u}px -apple-system, Inter, Roboto, sans-serif`;
  g.fillText('m/s', m + 26 * u + w, H - m - 6 * u);
  g.textAlign = 'right';
  g.fillText(`${r.tel.pct ?? '—'}%  ·  ${o.dist.toFixed(1)} m`, W - m - 22 * u, H - m - 6 * u);
  // reticle
  g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1 * u;
  g.beginPath(); g.arc(W / 2, H * 0.52, 23 * u, 0, Math.PI * 2); g.stroke();
  g.restore();
}

async function save(blob: Blob, name: string, kind: 'Snapshot' | 'Clip') {
  if (Capacitor.isNativePlatform()) {
    const data = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
    const out = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
    await Share.share({ title: `RC-Rovers ${kind.toLowerCase()}`, files: [out.uri], dialogTitle: `Save ${kind.toLowerCase()}` }).catch(() => {});
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  logEvent('media', `${kind} saved: ${name}`, 'good', { name, bytes: blob.size });
}

const blocked = () => toast('This camera stream does not allow capture (needs CORS on the camera)', 'warn', 3200);

export async function snapshot() {
  if (!feed) { toast('Open the camera view first', 'neutral'); return; }
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
  await save(blob, name, 'Snapshot');
  toast('📸 Snapshot saved', 'good', 1600);
  bus.emit('snapshot', { name });
}

let rec: { mr: MediaRecorder; raf: number; chunks: Blob[]; mime: string } | null = null;

export function startClip() {
  if (rec) return;
  if (!feed) { toast('Open the camera view first', 'neutral'); return; }
  if (typeof MediaRecorder === 'undefined') { toast('Clip recording is not supported on this device', 'warn'); return; }
  const [fw, fh] = feedSize(feed.el);
  const H = 720, W = Math.round((fw && fh ? fw / fh : 16 / 9) * H / 2) * 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  let lastFeed = Date.now();
  const draw = () => {
    if (!rec) return;
    if (feed) lastFeed = Date.now();
    else if (Date.now() - lastFeed > 1500) { stopClip(); return; }   // camera view closed
    if (feed) { try { g.drawImage(feed.el, 0, 0, W, H); } catch { /* feed not ready */ } drawHud(g, W, H, feed.label); }
    g.fillStyle = '#FF453A'; g.beginPath(); g.arc(W - 30, H - 30, 7, 0, Math.PI * 2); g.fill();
    rec.raf = requestAnimationFrame(draw);
  };
  let stream: MediaStream;
  try {
    g.drawImage(feed.el, 0, 0, W, H);
    c.getContext('2d')!.getImageData(0, 0, 1, 1);   // throws if the feed is cross-origin
    stream = c.captureStream(30);
  } catch { blocked(); return; }
  const audio = audioStream();
  audio?.getAudioTracks().forEach((t) => stream.addTrack(t));
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  let mr: MediaRecorder;
  try { mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined); } catch { toast('Could not start recording', 'bad'); return; }
  rec = { mr, raf: 0, chunks: [], mime: mr.mimeType || mime || 'video/webm' };
  const since = Date.now();
  mr.ondataavailable = (e) => { if (e.data.size) rec?.chunks.push(e.data); };
  mr.onstop = () => {
    const r = rec!; rec = null;
    cancelAnimationFrame(r.raf);
    stream.getVideoTracks().forEach((t) => t.stop());
    capture.set({ clip: false, since: 0 });
    const blob = new Blob(r.chunks, { type: r.mime });
    const ext = r.mime.includes('mp4') ? 'mp4' : 'webm';
    const name = `rc-rovers-${stamp()}.${ext}`;
    const seconds = Math.round((Date.now() - since) / 1000);
    save(blob, name, 'Clip').then(() => { toast(`🎬 Clip saved · ${seconds}s`, 'good', 1800); bus.emit('clip', { name, seconds }); }, () => toast('Could not save the clip', 'bad'));
  };
  mr.start(1000);
  capture.set({ clip: true, since });
  draw();
  haptic('medium');
  toast('Recording camera clip', 'neutral', 1400);
}

export function stopClip() { if (rec && rec.mr.state !== 'inactive') rec.mr.stop(); }
export const toggleClip = () => (rec ? stopClip() : startClip());
