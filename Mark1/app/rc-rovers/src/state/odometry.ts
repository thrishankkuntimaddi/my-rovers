/* Dead-reckoning: estimates where the rover has gone from its actual throttle and
   steering output (bicycle model). It's an estimate — no wheel encoders on MARK 1 —
   but it draws missions convincingly and feeds trip distance / top speed. */
import { createStore } from './store';
import { rover } from '../rover/controller';
import { updateTrip } from './logs';
import { bus } from './bus';
import { hitAt } from '../sim/world';

export const VMAX = 1.4;          // m/s at 100% output (estimate for a 1:18 crawler)
export const WHEELBASE = 0.26;    // m
export const MAX_STEER = (28 * Math.PI) / 180;

export interface Odo { x: number; y: number; h: number; dist: number; speed: number; maxSpeed: number; trail: [number, number][] }
export const odo = createStore<Odo>({ x: 0, y: 0, h: 0, dist: 0, speed: 0, maxSpeed: 0, trail: [[0, 0]] }, { batched: true });

/** Advance a pose by one step of the model (shared with mission path previews). */
export function stepPose(p: { x: number; y: number; h: number }, thrPct: number, strPct: number, dt: number) {
  const v = (thrPct / 100) * VMAX;
  const yaw = (v / WHEELBASE) * Math.tan((strPct / 100) * MAX_STEER);
  const h = p.h + yaw * dt;
  return { x: p.x + v * Math.sin(h) * dt, y: p.y + v * Math.cos(h) * dt, h, v };
}

let last = performance.now();
let tripDist = 0;
let lastBump = 0;
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.2, (now - last) / 1000);
  last = now;
  const r = rover.get();
  if (r.status !== 'connected') return;
  const { thr, str } = r.tel;
  if (Math.abs(thr) < 0.5) { if (odo.get().speed !== 0) odo.set({ speed: 0 }); return; }
  const s = odo.get();
  const n = stepPose(s, thr, str, dt);
  // demo world: rocks and beacons are solid. Moving deeper into one is blocked (wheels spin).
  if (r.kind === 'demo') {
    const ob = hitAt(n.x, n.y);
    if (ob && Math.hypot(n.x - ob.x, n.y - ob.y) < Math.hypot(s.x - ob.x, s.y - ob.y)) {
      if (s.speed !== 0) odo.set({ speed: 0 });
      if (now - lastBump > 700) { lastBump = now; bus.emit('bump', { x: ob.x, y: ob.y }); }
      return;
    }
  }
  const sp = Math.abs(n.v);
  const dist = s.dist + sp * dt;
  const lastPt = s.trail[s.trail.length - 1];
  const moved = Math.hypot(n.x - lastPt[0], n.y - lastPt[1]) > 0.03;
  odo.set({ x: n.x, y: n.y, h: n.h, dist, speed: sp, maxSpeed: Math.max(s.maxSpeed, sp),
    trail: moved ? [...s.trail.slice(-1500), [n.x, n.y]] : s.trail });
  tripDist += sp * dt;
  if (tripDist > 0.5) { const d = tripDist; tripDist = 0; updateTrip((t) => ({ distance: t.distance + d, maxSpeed: Math.max(t.maxSpeed, sp) })); }
}, 50);

export function resetOdo() { odo.set({ x: 0, y: 0, h: 0, dist: 0, speed: 0, maxSpeed: 0, trail: [[0, 0]] }); }
