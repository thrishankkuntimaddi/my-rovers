/* Cockpit views, in swipe order: Chase · Front · Driver · Rear · Top · Map · Gauges.
   - Demo rover: every camera is rendered from the simulated world (rocks, beacons, gates),
     so each view moves exactly like the rover does.
   - Real rover: Front / Driver show the camera stream (Settings → Camera, or the ESP32-CAM
     default when the rover reports a camera), Rear shows the rear stream if set. Chase and
     Top are drawn from the dead-reckoning estimate (no obstacles — it can't see them).
   Swipe sideways to change view, drag up/down to zoom or tilt, double-tap to reset.
   Battery: 30 fps (saver) / 60 fps cap, lower pixel density, ~20 fps while parked,
   and nothing is drawn when the app is in the background. */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useSel, useStore } from '../state/store';
import { settings, type ViewId } from '../state/settings';
import { rover } from '../rover/controller';
import { odo, stepPose, resetOdo, MAX_STEER } from '../state/odometry';
import { bus } from '../state/bus';
import { capture, registerFeed } from '../lib/capture';
import { courseById, gatePosts, SOLIDS, WORLD, type Gate } from '../sim/world';
import { trial } from '../sim/trials';
import { haptic } from '../lib/native';
import { Gauge, RoverTopView } from './Hud';
import { TrailMap } from './Futuristic';
import { Icon } from './Icon';
import { lastViewDir, stepView, viewLabel, VIEWS } from '../state/views';

/* per-view zoom / tilt from the drag gesture (reset by double-tap) */
const ADJ0: Record<ViewId, { zoom: number; tilt: number }> = {
  chase: { zoom: 1, tilt: 0 }, front: { zoom: 1, tilt: 0 }, driver: { zoom: 1, tilt: 0 }, rear: { zoom: 1, tilt: 0 },
  top: { zoom: 1, tilt: 0 }, map: { zoom: 1, tilt: 0 }, gauge: { zoom: 1, tilt: 0 },
};
const adj: Record<ViewId, { zoom: number; tilt: number }> = JSON.parse(JSON.stringify(ADJ0));

/* ── sources ───────────────────────────────────────────────────── */
type Src = { kind: 'sim' } | { kind: 'est' } | { kind: 'stream'; url: string } | { kind: 'none'; which: 'front' | 'rear' };
function frontUrl() {
  const s = settings.get(), r = rover.get();
  if (s.cameraUrl.trim()) return s.cameraUrl.trim();
  if (r.kind !== 'demo' && r.info?.caps.includes('camera')) return `http://${s.host.trim() || '192.168.4.1'}:81/stream`;
  return '';
}
function sourceFor(v: ViewId): Src {
  const demo = rover.get().kind === 'demo';
  const rear = settings.get().rearCameraUrl.trim();
  const front = frontUrl();
  if (v === 'front' || v === 'driver') return front ? { kind: 'stream', url: front } : demo ? { kind: 'sim' } : { kind: 'none', which: 'front' };
  if (v === 'rear') return rear ? { kind: 'stream', url: rear } : demo ? { kind: 'sim' } : { kind: 'none', which: 'rear' };
  return demo ? { kind: 'sim' } : { kind: 'est' };
}

function trialGates(): { gt: Gate; st: 'next' | 'todo' | 'done'; n: number }[] {
  const t = trial.get();
  const c = t.phase === 'idle' ? null : courseById(t.course);
  if (!c) return [];
  return c.gates.map((gt, i) => ({ gt, n: i + 1, st: i < t.next ? 'done' : i === t.next && t.phase !== 'done' ? 'next' : 'todo' }));
}

/* ── 3-D renderer ─────────────────────────────────────────────── */
type V3 = [number, number, number];
interface Proj { d: number; x: number; y: number }

// rover model, local coords: l forward, w right, z up (metres) — a 1:18 crawler
type Box = { l: [number, number]; w: [number, number]; z: [number, number]; rgb: [number, number, number]; glow?: boolean; wheel?: 'f' | 'r'; c?: [number, number] };
const BODY: Box[] = [
  { l: [-0.15, 0.15], w: [-0.072, 0.072], z: [0.045, 0.085], rgb: [70, 74, 82] },              // chassis
  { l: [-0.13, 0.03], w: [-0.085, 0.085], z: [0.085, 0.118], rgb: [255, 122, 26] },            // shell
  { l: [0.03, 0.12], w: [-0.085, 0.085], z: [0.085, 0.112], rgb: [255, 122, 26] },             // hood (separate so the driver view sees it)
  { l: [-0.06, 0.06], w: [-0.066, 0.066], z: [0.118, 0.158], rgb: [24, 30, 40] },              // cab glass
  { l: [0.15, 0.172], w: [-0.09, 0.09], z: [0.04, 0.07], rgb: [30, 30, 34] },                  // front bumper
  { l: [-0.17, -0.15], w: [-0.09, 0.09], z: [0.04, 0.07], rgb: [30, 30, 34] },                 // rear bumper
  { l: [0.118, 0.122], w: [0.035, 0.068], z: [0.092, 0.11], rgb: [255, 244, 200], glow: true },  // headlights
  { l: [0.118, 0.122], w: [-0.068, -0.035], z: [0.092, 0.11], rgb: [255, 244, 200], glow: true },
  { l: [-0.132, -0.128], w: [0.04, 0.07], z: [0.09, 0.105], rgb: [255, 50, 40], glow: true },   // tail lights
  { l: [-0.132, -0.128], w: [-0.07, -0.04], z: [0.09, 0.105], rgb: [255, 50, 40], glow: true },
];
const WHEELS: Box[] = [[0.1, 0.098], [0.1, -0.098], [-0.1, 0.098], [-0.1, -0.098]].map(([l, w], i) => (
  { l: [-0.046, 0.046], w: [-0.024, 0.024], z: [0, 0.092], rgb: [58, 60, 66], wheel: i < 2 ? 'f' : 'r', c: [l, w] }
));
const LIGHT: V3 = (() => { const v: V3 = [-0.45, 0.35, 0.82]; const m = Math.hypot(...v); return [v[0] / m, v[1] / m, v[2] / m]; })();

function Renderer({ view, world, label }: { view: ViewId; world: boolean; label: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current!;
    registerFeed(c, label);
    const g = c.getContext('2d', { alpha: false })!;
    let raf = 0, W = 0, H = 0, dpr = 1;
    const size = () => {
      const q = settings.get().quality;
      const dev = window.devicePixelRatio || 1;
      dpr = q === 'saver' ? 1 : q === 'high' ? Math.min(2, dev) : Math.min(1.5, dev);
      W = c.clientWidth; H = c.clientHeight;
      c.width = Math.max(1, Math.round(W * dpr)); c.height = Math.max(1, Math.round(H * dpr));
    };
    const ro = new ResizeObserver(size); ro.observe(c);
    let q0 = settings.get().quality;
    const offSet = settings.subscribe(() => { const q = settings.get().quality; if (q !== q0) { q0 = q; size(); } });
    let shakeAt = -1e9;
    const offBump = bus.on('bump', () => { shakeAt = performance.now(); });
    let odoAt = performance.now();
    const offOdo = odo.subscribe(() => { odoAt = performance.now(); });
    const dark = () => document.documentElement.getAttribute('data-theme') === 'dark';
    let last = 0, lastDraw = 0, visStr = 0, camYaw = odo.get().h, bob = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!W || !H || document.hidden) return;
      const q = settings.get().quality;
      const tel = rover.get().tel, o = odo.get();
      const moving = o.speed > 0.01 || Math.abs(tel.str - visStr) > 0.5 || now - shakeAt < 500 || trial.get().phase !== 'idle';
      const minGap = !moving ? 48 : q === 'saver' ? 32 : 15.5;   // ~20 fps parked · 30 / 60 fps moving
      if (now - lastDraw < minGap) return;
      const fdt = Math.min(0.1, (now - (last || now)) / 1000);
      last = now; lastDraw = now;

      // pose: extrapolate between 20 Hz odometry steps so motion is smooth at 60 fps
      const ex = o.speed > 0.01 ? stepPose(o, tel.thr, tel.str, Math.min(0.08, (now - odoAt) / 1000)) : o;
      const px = ex.x, py = ex.y, ph = ex.h;
      visStr += (tel.str - visStr) * (1 - Math.exp(-fdt * 14));
      let dy = ph - camYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      camYaw += dy * (1 - Math.exp(-fdt * 5));
      const sp = Math.abs(tel.thr) / 100;
      bob += sp * fdt * 18;

      // camera rig for this view
      const a = adj[view];
      const fwd = (h: number, l: number, w: number): [number, number] => [px + l * Math.sin(h) + w * Math.cos(h), py + l * Math.cos(h) - w * Math.sin(h)];
      let C: V3, yaw: number, pitch: number, F: number, mirror = false, roll = 0, drawRover = true, near = 0.03;
      if (view === 'front') {
        const [x, y] = fwd(ph, 0.175, 0); C = [x, y, 0.13 + Math.sin(bob) * 0.002 * sp]; yaw = ph; pitch = 0.05 + a.tilt; F = W * 0.62 * a.zoom; drawRover = false;
        roll = (-visStr / 100) * 2.2 * Math.min(1, sp * 2) * (Math.PI / 180);
      } else if (view === 'driver') {
        const [x, y] = fwd(ph, -0.03, 0); C = [x, y, 0.2]; yaw = ph; pitch = 0.13 + a.tilt; F = W * 0.48 * a.zoom; near = 0.02;
        roll = (-visStr / 100) * 1.4 * Math.min(1, sp * 2) * (Math.PI / 180);
      } else if (view === 'rear') {
        const [x, y] = fwd(ph, -0.175, 0); C = [x, y, 0.13]; yaw = ph + Math.PI; pitch = 0.24 + a.tilt; F = W * 0.46 * a.zoom; mirror = true; drawRover = false;
      } else if (view === 'top') {
        C = [px, py, 2.6 * a.zoom]; yaw = ph; pitch = Math.PI / 2 - 1e-4; F = W * 0.62;
      } else {   // chase
        const D = 1.05 * a.zoom; const [x, y] = [px - D * Math.sin(camYaw), py - D * Math.cos(camYaw)];
        const z = 0.12 + 0.3 * a.zoom; C = [x, y, z]; yaw = camYaw; pitch = Math.atan2(z - 0.09, D + 0.55) + a.tilt; F = W * 0.72;
      }
      pitch = Math.max(-0.4, Math.min(Math.PI / 2 - 1e-4, pitch));
      const sY = Math.sin(yaw), cY = Math.cos(yaw), sP = Math.sin(pitch), cP = Math.cos(pitch);
      const P = (x: number, y: number, z: number): Proj => {
        const dx = x - C[0], dy2 = y - C[1], dz = z - C[2];
        const f = dx * sY + dy2 * cY, r = dx * cY - dy2 * sY;
        const d = f * cP - dz * sP, v = f * sP + dz * cP;
        return { d, x: W / 2 + (mirror ? -r : r) / d * F, y: H / 2 - (v / d) * F };
      };

      const dk = dark();
      const shake = Math.max(0, 1 - (now - shakeAt) / 450);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.save();
      if (shake || roll) {
        g.translate(W / 2 + (shake ? (Math.random() - 0.5) * 14 * shake : 0), H / 2 + (shake ? (Math.random() - 0.5) * 10 * shake : 0));
        g.rotate(roll + (shake ? (Math.random() - 0.5) * 0.03 * shake : 0)); g.scale(1.06, 1.06); g.translate(-W / 2, -H / 2);
      }
      // sky + ground
      const hz = pitch > 1.3 ? -1e5 : H / 2 - Math.tan(pitch) * F;
      if (hz > -H) {
        const sky = g.createLinearGradient(0, Math.min(0, hz - H), 0, hz);
        sky.addColorStop(0, dk ? '#05080F' : '#7FAED6'); sky.addColorStop(1, dk ? '#1A2B3D' : '#E6EDF3');
        g.fillStyle = sky; g.fillRect(-W, -H, W * 3, hz + H);
        // distant ridge
        g.fillStyle = dk ? 'rgba(80,110,140,.22)' : 'rgba(90,110,130,.22)';
        g.beginPath(); g.moveTo(-W, hz);
        const span = (W / F) * 1.2;
        for (let i = 0; i <= 40; i++) {
          const t = i / 40 - 0.5, an = yaw + (mirror ? -t : t) * span;
          const hgt = 10 + 8 * Math.sin(an * 3.1) + 5 * Math.sin(an * 7.3 + 1) + 3 * Math.sin(an * 13.7);
          g.lineTo(W / 2 + t * W * 1.25, hz - hgt * (H / 420));
        }
        g.lineTo(W * 2, hz); g.closePath(); g.fill();
      }
      const gTop = Math.max(-H, hz);
      const gr = g.createLinearGradient(0, gTop, 0, H);
      gr.addColorStop(0, dk ? '#1C2026' : '#B5AA98'); gr.addColorStop(1, dk ? '#0B0D10' : '#7A6D5C');
      g.fillStyle = gr; g.fillRect(-W, gTop, W * 3, H * 2 - gTop);

      // ground grid (1 m), lines clipped at the near plane
      const N = Math.max(near, 0.03);
      const seg = (ax: number, ay: number, bx: number, by: number) => {
        let A = P(ax, ay, 0), B = P(bx, by, 0);
        if (A.d < N && B.d < N) return;
        if (A.d < N) { const t = (N - A.d) / (B.d - A.d); A = P(ax + (bx - ax) * t, ay + (by - ay) * t, 0); }
        else if (B.d < N) { const t = (N - B.d) / (A.d - B.d); B = P(bx + (ax - bx) * t, by + (ay - by) * t, 0); }
        g.moveTo(A.x, A.y); g.lineTo(B.x, B.y);
      };
      const R = view === 'top' ? Math.ceil(4 + 3 * a.zoom) : 12;
      const gx = Math.round(view === 'top' ? px : C[0]), gy = Math.round(view === 'top' ? py : C[1]);
      g.lineWidth = 1;
      g.strokeStyle = dk ? 'rgba(94,231,255,.15)' : 'rgba(255,255,255,.34)';
      g.beginPath();
      for (let i = -R; i <= R; i++) { seg(gx + i, gy - R, gx + i, gy + R); seg(gx - R, gy + i, gx + R, gy + i); }
      g.stroke();
      // fog band hides far-grid shimmer near the horizon
      if (hz > -H && hz < H) {
        const fog = g.createLinearGradient(0, hz, 0, hz + H * 0.16);
        fog.addColorStop(0, dk ? 'rgba(28,32,38,1)' : 'rgba(181,170,152,1)'); fog.addColorStop(1, dk ? 'rgba(28,32,38,0)' : 'rgba(181,170,152,0)');
        g.fillStyle = fog; g.fillRect(-W, hz - 1, W * 3, H * 0.16 + 1);
      }

      // driven trail on the ground (estimated views have nothing else to show)
      if (!world || view === 'top') {
        const tr = o.trail;
        g.strokeStyle = dk ? 'rgba(94,231,255,.7)' : 'rgba(0,122,255,.65)'; g.lineWidth = 2.5; g.lineCap = 'round';
        g.beginPath();
        for (let i = Math.max(1, tr.length - 400); i < tr.length; i++) seg(tr[i - 1][0], tr[i - 1][1], tr[i][0], tr[i][1]);
        g.stroke(); g.lineCap = 'butt';
      }

      type Item = { d: number; draw(): void };
      const items: Item[] = [];
      const reach = view === 'top' ? 4 + 3 * a.zoom : 30;
      if (world) {
        for (const ob of WORLD) {
          if (Math.abs(ob.x - C[0]) > reach || Math.abs(ob.y - C[1]) > reach) continue;
          const b = P(ob.x, ob.y, 0);
          if (b.d < 0.12) continue;
          const sz = (ob.s / b.d) * F;
          if (b.x < -sz * 3 || b.x > W + sz * 3 || sz < 0.4) continue;
          const fogA = view === 'top' ? 1 : Math.max(0, Math.min(1, 1.15 - b.d / 28));
          items.push({ d: b.d, draw() {
            g.globalAlpha = fogA;
            if (ob.k === 'rock') {
              const t = P(ob.x, ob.y, ob.s * 0.6);
              const rx = sz * 1.1, ry = Math.max(Math.abs(t.y - b.y) * 0.8, rx * sP * 0.9, rx * 0.3);
              const cy = (b.y + t.y) / 2;
              g.fillStyle = dk ? '#3A414B' : '#877B6B';
              g.beginPath(); g.ellipse(b.x, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
              g.fillStyle = dk ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.22)';
              g.beginPath(); g.ellipse(b.x - rx * 0.28, cy - ry * 0.35, rx * 0.45, ry * 0.4, 0, 0, Math.PI * 2); g.fill();
            } else if (ob.k === 'grass') {
              g.strokeStyle = dk ? 'rgba(120,170,140,.5)' : 'rgba(80,110,60,.6)'; g.lineWidth = Math.max(1, sz * 0.08);
              g.beginPath();
              for (let k = -2; k <= 2; k++) {
                const t = P(ob.x + k * ob.s * 0.3 * cY, ob.y - k * ob.s * 0.3 * sY, ob.s * (0.8 + (k & 1) * 0.3));
                g.moveTo(b.x + (k * sz * 0.15), b.y); g.lineTo(t.x, t.y);
              }
              g.stroke();
            } else {
              const t = P(ob.x, ob.y, 0.5);
              g.strokeStyle = dk ? '#5EE7FF' : '#FF7A1A'; g.lineWidth = Math.max(1.5, (0.025 / b.d) * F);
              g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(t.x, t.y); g.stroke();
              g.fillStyle = g.strokeStyle;
              g.globalAlpha = fogA * (0.55 + 0.45 * Math.sin(now / 220 + ob.x));
              g.beginPath(); g.arc(t.x, t.y, Math.max(2, (0.05 / Math.max(0.1, t.d)) * F), 0, Math.PI * 2); g.fill();
            }
          } });
        }
        for (const { gt, st, n } of trialGates()) {
          if (st === 'done') continue;
          const [[ax, ay], [bx, by]] = gatePosts(gt);
          const pa = P(ax, ay, 0), pb = P(bx, by, 0), ta = P(ax, ay, 0.42), tb = P(bx, by, 0.42);
          if (pa.d < 0.3 || pb.d < 0.3 || ta.d < 0.3 || tb.d < 0.3) continue;
          const dd = (pa.d + pb.d) / 2;
          if (dd > 40) continue;
          items.push({ d: dd, draw() {
            const next = st === 'next';
            const col = next ? (dk ? '94,231,255' : '0,170,220') : '255,255,255';
            g.globalAlpha = Math.max(0.2, Math.min(1, 1.2 - dd / 34)) * (next ? 0.75 + 0.25 * Math.sin(now / 160) : 0.45);
            if (next) { g.fillStyle = `rgba(${col},.12)`; g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(ta.x, ta.y); g.lineTo(tb.x, tb.y); g.lineTo(pb.x, pb.y); g.closePath(); g.fill(); }
            g.strokeStyle = `rgb(${col})`; g.lineCap = 'round';
            for (const [p, t] of [[pa, ta], [pb, tb]] as const) { g.lineWidth = Math.min(10, Math.max(2, (0.03 / p.d) * F)); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(t.x, t.y); g.stroke(); }
            g.lineWidth = Math.min(6, Math.max(1.5, (0.02 / dd) * F)); g.beginPath(); g.moveTo(ta.x, ta.y); g.lineTo(tb.x, tb.y); g.stroke();
            g.fillStyle = `rgb(${col})`; g.font = `700 ${Math.max(10, Math.min(28, (0.14 / dd) * F))}px -apple-system, Inter, sans-serif`; g.textAlign = 'center';
            g.fillText(String(n), (ta.x + tb.x) / 2, (ta.y + tb.y) / 2 - 6);
            g.lineCap = 'butt';
          } });
        }
      }

      // the rover itself
      if (drawRover) {
        const sh = Math.sin(ph), ch = Math.cos(ph);
        const toW = (l: number, w: number, z: number): V3 => [px + l * sh + w * ch, py + l * ch - w * sh, z];
        const steer = (visStr / 100) * MAX_STEER;
        const spin = (bob * 2.2) % 1;
        // shadow
        const shp = [[-0.19, -0.11], [0.19, -0.11], [0.19, 0.11], [-0.19, 0.11]].map(([l, w]) => { const q = toW(l, w, 0.001); return P(q[0], q[1], q[2]); });
        if (shp.every((p) => p.d > N)) {
          items.push({ d: 1e3, draw() { g.globalAlpha = 1; g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); shp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill(); } });
        }
        const faces: { d: number; pts: Proj[]; rgb: [number, number, number]; shade: number; glow?: boolean; tread?: boolean }[] = [];
        const boxFaces = (b: Box) => {
          const corner = (i: number): V3 => {
            let l = b.l[(i & 1)], w = b.w[(i >> 1) & 1];
            const z = b.z[(i >> 2) & 1];
            if (b.c) {
              const an = b.wheel === 'f' ? steer : 0, cs = Math.cos(an), sn = Math.sin(an);
              const l2 = l * cs - w * sn, w2 = l * sn + w * cs; l = b.c[0] + l2; w = b.c[1] + w2;
            }
            return toW(l, w, z);
          };
          const v = Array.from({ length: 8 }, (_, i) => corner(i));
          const ctr: V3 = [v.reduce((s, p) => s + p[0], 0) / 8, v.reduce((s, p) => s + p[1], 0) / 8, v.reduce((s, p) => s + p[2], 0) / 8];
          for (const f of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]) {
            const q = f.map((i) => v[i]);
            const fc: V3 = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, (q[0][2] + q[2][2]) / 2];
            const n: V3 = [fc[0] - ctr[0], fc[1] - ctr[1], fc[2] - ctr[2]];
            if (n[0] * (C[0] - fc[0]) + n[1] * (C[1] - fc[1]) + n[2] * (C[2] - fc[2]) <= 0) continue;   // back face
            const pts = q.map((p) => P(p[0], p[1], p[2]));
            if (pts.some((p) => p.d < N)) continue;
            const m = Math.hypot(n[0], n[1], n[2]) || 1;
            const shade = 0.5 + 0.5 * Math.max(0, (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / m);
            faces.push({ d: P(fc[0], fc[1], fc[2]).d, pts, rgb: b.rgb, shade, glow: b.glow, tread: !!b.c && Math.abs(n[2]) < m * 0.5 });
          }
        };
        for (const b of [...WHEELS, ...BODY]) boxFaces(b);
        const rd = P(px, py, 0.08).d;
        items.push({ d: rd, draw() {
          faces.sort((x, y) => y.d - x.d);
          g.globalAlpha = 1; g.lineJoin = 'round';
          for (const f of faces) {
            const k = f.glow ? 1 : f.shade;
            g.fillStyle = `rgb(${Math.round(f.rgb[0] * k)},${Math.round(f.rgb[1] * k)},${Math.round(f.rgb[2] * k)})`;
            g.beginPath(); f.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill();
            g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 0.8; g.stroke();
            if (f.tread && sp > 0.02) {   // rolling tread marks
              g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1;
              for (let t = 0; t < 3; t++) {
                const u = (spin + t / 3) % 1;
                const ax = f.pts[0].x + (f.pts[1].x - f.pts[0].x) * u, ay = f.pts[0].y + (f.pts[1].y - f.pts[0].y) * u;
                const bx = f.pts[3].x + (f.pts[2].x - f.pts[3].x) * u, by = f.pts[3].y + (f.pts[2].y - f.pts[3].y) * u;
                g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
              }
            }
          }
          // headlight beams in the dark
          if (dk && view !== 'top') {
            const [lx, ly] = [px + 0.14 * sh, py + 0.14 * ch];
            const fp = P(lx + 1.4 * sh, ly + 1.4 * ch, 0), np = P(lx, ly, 0.1);
            if (fp.d > N && np.d > N) {
              const bg = g.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, Math.max(20, (0.9 / fp.d) * F));
              bg.addColorStop(0, 'rgba(255,240,200,.16)'); bg.addColorStop(1, 'rgba(255,240,200,0)');
              g.fillStyle = bg; g.beginPath(); g.arc(fp.x, fp.y, Math.max(20, (0.9 / fp.d) * F), 0, Math.PI * 2); g.fill();
            }
          }
        } });
      }
      items.sort((x, y) => y.d - x.d).forEach((it) => it.draw());
      g.globalAlpha = 1;
      g.restore();
      if (shake > 0.3) { g.fillStyle = `rgba(120,0,0,${(shake - 0.3) * 0.35})`; g.fillRect(0, 0, W, H); }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); offBump(); offOdo(); offSet(); registerFeed(null, '', c); };
  }, [view, world, label]);
  return <canvas ref={cv} className="view-feed" />;
}

/* ── live stream (MJPEG) ───────────────────────────────────────── */
function StreamFeed({ url, label, mirror }: { url: string; label: string; mirror?: boolean }) {
  const [nonce, setNonce] = useState(0);
  const [cors, setCors] = useState(true);   // try CORS first so snapshots/clips work; fall back if the camera refuses
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading');
  const img = useRef<HTMLImageElement>(null);
  const src = url + (nonce ? (url.includes('?') ? '&' : '?') + `r=${nonce}` : '');
  useEffect(() => { setState('loading'); const t = setTimeout(() => setState((s) => (s === 'loading' ? 'err' : s)), 7000); return () => clearTimeout(t); }, [src, cors]);
  useEffect(() => { const el = img.current; if (state !== 'ok' || !el) return; registerFeed(el, label); return () => registerFeed(null, '', el); }, [state, label]);
  useEffect(() => { if (state !== 'err') return; const t = setTimeout(() => setNonce((n) => n + 1), 4000); return () => clearTimeout(t); }, [state]);   // auto-retry
  return (
    <>
      <img key={src + cors} ref={img} className={`view-feed is-img${mirror ? ' is-mirror' : ''}`} src={src} alt="" crossOrigin={cors ? 'anonymous' : undefined}
        onLoad={() => setState('ok')} onError={() => { if (cors) setCors(false); else setState('err'); }} />
      {state !== 'ok' && (
        <div className="view-msg">
          {state === 'loading' ? <><span className="spinner" />Connecting to camera…</> : <>
            <Icon name="camera" size={20} /><b>No camera signal</b><small>{url}</small><small>Retrying…</small>
            <button className="lg-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => setNonce((n) => n + 1)}><Icon name="refresh" size={15} />Retry now</button>
          </>}
        </div>
      )}
    </>
  );
}

function NoCamera({ which }: { which: 'front' | 'rear' }) {
  const key = which === 'front' ? 'cameraUrl' : 'rearCameraUrl';
  return (
    <div className="view-msg is-empty" onPointerDown={(e) => e.stopPropagation()}>
      <Icon name="camera" size={26} />
      <b>No {which} camera</b>
      <small>{which === 'front' ? 'MARK 1 has no camera yet. Add an ESP32-CAM and paste its stream address:' : 'Add a second camera for reversing and paste its stream address:'}</small>
      <input className="lg-field view-url" placeholder="http://192.168.4.2:81/stream" spellCheck={false} inputMode="url"
        onKeyDown={(e) => { if (e.key === 'Enter') settings.set({ [key]: (e.target as HTMLInputElement).value } as never); }}
        onBlur={(e) => { if (e.target.value) settings.set({ [key]: e.target.value } as never); }} />
      <small>Swipe for Chase and Top views: they are drawn from where the rover has driven.</small>
    </div>
  );
}

/* ── overlays ──────────────────────────────────────────────────── */
function HeadingTape() {
  const deg = useSel(odo, (o) => Math.round((((o.h * 180) / Math.PI) % 360 + 360) % 360));
  const ticks = [];
  for (let d = Math.floor((deg - 60) / 10) * 10; d <= deg + 60; d += 10) {
    const n = ((d % 360) + 360) % 360;
    const lab = n === 0 ? 'N' : n === 90 ? 'E' : n === 180 ? 'S' : n === 270 ? 'W' : n % 30 === 0 ? String(n) : '';
    ticks.push(<span key={d} className={`cam-tick${lab ? ' is-major' : ''}`} style={{ left: `${50 + ((d - deg) / 120) * 100}%` }}>{lab && <em>{lab}</em>}</span>);
  }
  useStore(trial);
  const nextGate = trialGates().find((x) => x.st === 'next');
  let gateMark = null;
  if (nextGate) {
    const o = odo.get();
    const b = (Math.atan2(nextGate.gt.x - o.x, nextGate.gt.y - o.y) * 180) / Math.PI;
    const rel = ((b - deg + 540) % 360) - 180;
    const pos = Math.max(-58, Math.min(58, rel));
    gateMark = <span className={`cam-gate-mark${Math.abs(rel) > 58 ? ' is-edge' : ''}`} style={{ left: `${50 + (pos / 120) * 100}%` }}>{Math.abs(rel) > 58 ? (rel > 0 ? '▶' : '◀') : '▼'}</span>;
  }
  return <div className="cam-tape"><div className="cam-tape-in">{ticks}{gateMark}</div><b className="cam-hdg">{String(deg).padStart(3, '0')}°</b></div>;
}

function MiniMap({ sim }: { sim: boolean }) {
  const o = useStore(odo);
  useStore(trial);
  const R = 44, span = 7;
  const k = R / span;
  const sh = Math.sin(o.h), ch = Math.cos(o.h);
  const loc = (x: number, y: number) => { const dx = x - o.x, dy = y - o.y; return [R + (dx * ch - dy * sh) * k, R - (dx * sh + dy * ch) * k] as const; };
  const near = (x: number, y: number) => Math.abs(x - o.x) < span * 1.5 && Math.abs(y - o.y) < span * 1.5;
  const trail = o.trail.slice(-300).map(([x, y], i) => { const [a, b] = loc(x, y); return `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`; }).join(' ');
  return (
    <svg className="cam-mini" viewBox={`0 0 ${R * 2} ${R * 2}`}>
      <defs><clipPath id="mini-clip"><circle cx={R} cy={R} r={R - 1} /></clipPath></defs>
      <circle cx={R} cy={R} r={R - 1} className="mini-bg" />
      <g clipPath="url(#mini-clip)">
        <circle cx={R} cy={R} r={R / 2} className="mini-ring" />
        <path d={trail} className="mini-trail" />
        {sim && SOLIDS.filter((s) => near(s.x, s.y)).map((s, i) => { const [a, b] = loc(s.x, s.y); return <circle key={i} cx={a} cy={b} r={Math.max(1.4, s.r * k)} className={s.k === 'beacon' ? 'mini-beacon' : 'mini-rock'} />; })}
        {trialGates().filter((t) => t.st !== 'done').map(({ gt, st, n }) => {
          const [[ax, ay], [bx, by]] = gatePosts(gt); const [a1, b1] = loc(ax, ay), [a2, b2] = loc(bx, by);
          return <line key={n} x1={a1} y1={b1} x2={a2} y2={b2} className={`mini-gate${st === 'next' ? ' is-next' : ''}`} />;
        })}
      </g>
      <path d={`M${R} ${R - 6} L${R + 4.5} ${R + 4} L${R} ${R + 2} L${R - 4.5} ${R + 4} Z`} className="mini-me" />
    </svg>
  );
}

/** Driver view: a steering wheel that turns with your input (±135°). */
function SteeringWheel() {
  const str = useSel(rover, (s) => Math.round(s.tel.str));
  return (
    <svg className="wheel-ov" viewBox="-60 -60 120 120" style={{ transform: `rotate(${str * 1.35}deg)` }} aria-hidden="true">
      <circle r="52" className="wh-rim" />
      <circle r="52" className="wh-rim-hi" />
      <path d="M-50 -4 Q0 -14 50 -4 M0 6 L0 50 M-12 6 L12 6" className="wh-spoke" />
      <circle r="13" className="wh-hub" />
      <rect x="-3" y="-56" width="6" height="9" rx="2" className="wh-mark" />
    </svg>
  );
}

/** Rear view: parking guides that bend with the steering. */
function ParkingGuides() {
  const str = useSel(rover, (s) => Math.round(s.tel.str / 4) * 4);
  const k = -str / 100 * 70;   // mirrored image: steering right bends the guides left
  const line = (x0: number) => `M${x0} 100 Q ${x0 * 0.7 + k * 0.4} 60 ${x0 * 0.42 + k} 28`;
  return (
    <svg className="guides-ov" viewBox="-100 0 200 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={line(-62)} className="gd-line" /><path d={line(62)} className="gd-line" />
      <path d="M-50 86 L-38 86 M50 86 L38 86" className="gd-red" />
      <path d="M-40 64 L-30 64 M40 64 L30 64" className="gd-amber" />
      <path d="M-30 44 L-22 44 M30 44 L22 44" className="gd-green" />
    </svg>
  );
}

function Overlay({ view, src }: { view: ViewId; src: Src }) {
  const cap = useStore(capture);
  const t = useSel(trial, (x) => (x.phase === 'countdown' ? x.count : 0));
  const tag = src.kind === 'stream' ? 'LIVE' : src.kind === 'sim' ? 'DEMO SIM' : src.kind === 'est' ? 'ESTIMATED' : 'NO SIGNAL';
  const sim = src.kind === 'sim';
  return (
    <div className="view-hud">
      <div className={`view-tag${src.kind === 'stream' ? ' is-live' : ''}`}><i />{viewLabel(view).toUpperCase()} · {tag}</div>
      {(view === 'front' || view === 'chase' || view === 'driver') && <HeadingTape />}
      {(view === 'front' || view === 'driver' || view === 'rear') && <MiniMap sim={sim} />}
      {view === 'front' && <div className="cam-reticle"><span /></div>}
      {view === 'driver' && <SteeringWheel />}
      {view === 'rear' && <ParkingGuides />}
      {t > 0 && <div className="cam-count" key={t}>{t}</div>}
      {cap.flash > 0 && <div className="cam-flash" key={cap.flash} />}
    </div>
  );
}

/* ── the stage: whichever view is active, with swipe / drag / double-tap ── */
export function ViewStage({ children }: { children?: ReactNode }) {
  const view = useSel(settings, (s) => s.view);
  useSel(settings, (s) => `${s.cameraUrl}|${s.rearCameraUrl}|${s.host}`);
  const kind = useSel(rover, (s) => `${s.kind}|${s.info?.caps.join(',') ?? ''}`);
  const [anim, setAnim] = useState('');
  const prev = useRef(view);
  useEffect(() => {
    if (prev.current === view) return;
    prev.current = view;
    setAnim(lastViewDir > 0 ? 'is-in-r' : 'is-in-l');
    const t = setTimeout(() => setAnim(''), 320);
    return () => clearTimeout(t);
  }, [view]);

  const gest = useRef<{ id: number; x: number; y: number; t: number; mode: '' | 'swipe' | 'drag'; z0: number; t0: number } | null>(null);
  const lastTap = useRef(0);
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (gest.current) return;
    const a = adj[view];
    gest.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), mode: '', z0: a.zoom, t0: a.tilt };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const gs = gest.current;
    if (!gs || gs.id !== e.pointerId) return;
    const dx = e.clientX - gs.x, dy = e.clientY - gs.y;
    if (!gs.mode && Math.hypot(dx, dy) > 14) gs.mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'swipe' : 'drag';
    if (gs.mode === 'drag') {
      const a = adj[view];
      if (view === 'chase' || view === 'top') a.zoom = Math.max(0.55, Math.min(3, gs.z0 * Math.exp(dy / 220)));
      else if (view === 'map' || view === 'gauge') { /* nothing to drag */ }
      else a.tilt = Math.max(-0.35, Math.min(0.5, gs.t0 - dy / 500));
    }
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const gs = gest.current;
    if (!gs || gs.id !== e.pointerId) return;
    gest.current = null;
    const dx = e.clientX - gs.x;
    if (gs.mode === 'swipe' && Math.abs(dx) > 48) { stepView(dx < 0 ? 1 : -1); return; }
    if (!gs.mode && performance.now() - gs.t < 280) {
      const now = performance.now();
      if (now - lastTap.current < 320) { adj[view] = { ...ADJ0[view] }; if (view === 'map') resetOdo(); haptic('light'); lastTap.current = 0; }
      else lastTap.current = now;
    }
  };

  const src = VIEWS.find((v) => v.id === view)!.cam ? sourceFor(view) : null;
  void kind;
  let body: ReactNode;
  if (view === 'map') body = <div className="view-dom is-map"><TrailMap /></div>;
  else if (view === 'gauge') body = <GaugeView />;
  else if (!src || src.kind === 'none') body = <NoCamera which={src?.kind === 'none' ? src.which : 'front'} />;
  else if (src.kind === 'stream') body = <StreamFeed url={src.url} label={`${viewLabel(view).toUpperCase()} · LIVE`} mirror={view === 'rear'} />;
  else body = <Renderer key={view} view={view} world={src.kind === 'sim'} label={`${viewLabel(view).toUpperCase()} · ${src.kind === 'sim' ? 'SIM' : 'EST'}`} />;

  return (
    <div className={`view-stage is-${view} ${anim}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {body}
      <div className="view-vignette" />
      {src && src.kind !== 'none' && <Overlay view={view} src={src} />}
      {children}
    </div>
  );
}

function GaugeView() {
  const thr = useSel(rover, (s) => s.tel.thr), str = useSel(rover, (s) => s.tel.str), mode = useSel(rover, (s) => s.tel.mode);
  return (
    <div className="view-dom is-gauge">
      <Gauge thr={thr} mode={mode} />
      <RoverTopView thr={thr} str={str} />
    </div>
  );
}
