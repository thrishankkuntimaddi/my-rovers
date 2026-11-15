/* The demo rover's world: scattered rocks, grass and beacons, plus the time-trial
   courses. Shared by the simulated camera, the camera minimap, odometry collisions
   and the trial referee. Pose convention (same as odometry): heading h = 0 faces +y,
   forward = (sin h, cos h), right = (cos h, −sin h). Units are metres. */

export type ObjKind = 'rock' | 'beacon' | 'grass';
export interface Obj { x: number; y: number; s: number; k: ObjKind }
export interface Gate { x: number; y: number; h: number; w: number }
export interface Course { id: string; name: string; desc: string; icon: string; par: number; gates: Gate[] }

const g = (x: number, y: number, hDeg: number, w = 1.3): Gate => ({ x, y, h: (hDeg * Math.PI) / 180, w });

export const COURSES: Course[] = [
  { id: 'sprint', name: 'Sprint', icon: '🏁', desc: 'Four gates, mostly straight. Learn the line.', par: 16000,
    gates: [g(0, 3, 0, 1.4), g(0.3, 6, 5, 1.4), g(-0.2, 9, -5, 1.4), g(0, 12, 0, 1.5)] },
  { id: 'slalom', name: 'Slalom', icon: '〰️', desc: 'Weave left and right through five gates.', par: 24000,
    gates: [g(1.1, 2.5, 0, 1.2), g(-1.1, 5, 0, 1.2), g(1.1, 7.5, 0, 1.2), g(-1.1, 10, 0, 1.2), g(0, 12.5, 0, 1.4)] },
  { id: 'loop', name: 'Canyon Loop', icon: '🔁', desc: 'A full lap that brings you back to the start.', par: 36000,
    gates: [g(0, 3, 0), g(1.4, 5.6, 45), g(3.6, 6.4, 90), g(5.6, 5, 150), g(5.8, 1.5, 180), g(3.8, -0.8, 260), g(1, -0.6, 315), g(0, 1.6, 0, 1.5)] },
];
export const courseById = (id: string | null) => COURSES.find((c) => c.id === id) ?? null;

/** Gate end posts, left then right (as seen when driving through it). */
export function gatePosts(gt: Gate): [[number, number], [number, number]] {
  const rx = Math.cos(gt.h), ry = -Math.sin(gt.h), hw = gt.w / 2;
  return [[gt.x - rx * hw, gt.y - ry * hw], [gt.x + rx * hw, gt.y + ry * hw]];
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Keep rocks off every course's racing line so trials are always drivable. */
function onTrack(x: number, y: number) {
  for (const c of COURSES) {
    let ax = 0, ay = 0;
    for (const gt of c.gates) {
      if (segDist(x, y, ax, ay, gt.x, gt.y) < 1.15) return true;
      for (const [px, py] of gatePosts(gt)) if (Math.hypot(x - px, y - py) < 0.5) return true;
      ax = gt.x; ay = gt.y;
    }
  }
  return false;
}

export const WORLD: Obj[] = (() => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: Obj[] = [];
  for (let i = 0; i < 300; i++) {
    const x = (rnd() - 0.5) * 70, y = (rnd() - 0.5) * 70;
    const r = rnd(), s = 0.05 + rnd() * 0.22;
    const k: ObjKind = r < 0.07 ? 'beacon' : r < 0.55 ? 'rock' : 'grass';
    if (Math.hypot(x, y) < 1.4) continue;
    if (k !== 'grass' && onTrack(x, y)) continue;
    out.push({ x, y, s, k });
  }
  return out;
})();

/** Solid things the rover can hit, with their radius in metres. */
export const SOLIDS = WORLD.filter((o) => (o.k === 'rock' && o.s > 0.1) || o.k === 'beacon')
  .map((o) => ({ ...o, r: o.k === 'beacon' ? 0.06 : o.s * 0.9 }));
const ROVER_R = 0.14;

export function hitAt(x: number, y: number) {
  for (const o of SOLIDS) { if (Math.abs(o.x - x) > 1 || Math.abs(o.y - y) > 1) continue; if (Math.hypot(o.x - x, o.y - y) < o.r + ROVER_R) return o; }
  return null;
}

/** True if moving from a to b passes forwards through the gate. */
export function crosses(gt: Gate, ax: number, ay: number, bx: number, by: number) {
  const [[px, py], [qx, qy]] = gatePosts(gt);
  const d = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
  const d1 = d(px, py, qx, qy, ax, ay), d2 = d(px, py, qx, qy, bx, by);
  const d3 = d(ax, ay, bx, by, px, py), d4 = d(ax, ay, bx, by, qx, qy);
  if (!((d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0))) return false;
  return (bx - ax) * Math.sin(gt.h) + (by - ay) * Math.cos(gt.h) > 0;
}
