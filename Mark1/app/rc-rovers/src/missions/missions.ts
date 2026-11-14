/* Missions = programmable routes. Built-ins + your own (editor or recorded drives).
   The autopilot plays them by writing to the same `input` store the thumbs use,
   so every safety layer on the rover (modes, failsafe, E-stop) still applies.
   Touching any drive control instantly cancels the autopilot. */
import { createStore } from '../state/store';
import { input, toast } from '../state/ui';
import { bus } from '../state/bus';
import { logEvent, updateTrip } from '../state/logs';
import { control, rover } from '../rover/controller';
import { stepPose } from '../state/odometry';
import { chime } from '../lib/sound';
import { haptic } from '../lib/native';
import type { DriveMode } from '../rover/protocol';

export type Move = 'forward' | 'back' | 'left' | 'right' | 'backleft' | 'backright' | 'spinleft' | 'spinright' | 'wait';
export type Step =
  | { id: string; kind: 'move'; move: Move; speed: number; ms: number }
  | { id: string; kind: 'raw'; thr: number; str: number; ms: number }
  | { id: string; kind: 'mode'; m: DriveMode };

export interface Mission {
  id: string; name: string; icon: string; desc: string; steps: Step[];
  builtin?: boolean; recorded?: boolean; createdAt: number;
}

export const MOVES: { id: Move; label: string; glyph: string }[] = [
  { id: 'forward', label: 'Forward', glyph: '↑' }, { id: 'back', label: 'Reverse', glyph: '↓' },
  { id: 'left', label: 'Fwd left', glyph: '↖' }, { id: 'right', label: 'Fwd right', glyph: '↗' },
  { id: 'backleft', label: 'Rev left', glyph: '↙' }, { id: 'backright', label: 'Rev right', glyph: '↘' },
  { id: 'spinleft', label: 'Tight left', glyph: '⟲' }, { id: 'spinright', label: 'Tight right', glyph: '⟳' },
  { id: 'wait', label: 'Pause', glyph: '⏸' },
];

/** Stick values for a move at a given speed (0…100). */
export function moveToStick(move: Move, speed: number): { thr: number; str: number } {
  const v = speed;
  switch (move) {
    case 'forward': return { thr: v, str: 0 };
    case 'back': return { thr: -v, str: 0 };
    case 'left': return { thr: v, str: -75 };
    case 'right': return { thr: v, str: 75 };
    case 'backleft': return { thr: -v, str: -75 };
    case 'backright': return { thr: -v, str: 75 };
    case 'spinleft': return { thr: v, str: -100 };
    case 'spinright': return { thr: v, str: 100 };
    case 'wait': return { thr: 0, str: 0 };
  }
}

let uid = 0;
export const sid = () => `${Date.now().toString(36)}${(uid++).toString(36)}`;
const mv = (move: Move, speed: number, ms: number): Step => ({ id: sid(), kind: 'move', move, speed, ms });
const rep = <T,>(n: number, f: () => T[]) => Array.from({ length: n }, f).flat();

/* Built-ins are timed from the bicycle model at Cruise (50% cap): full lock ≈ 0.49 m turning
   radius, 75% lock ≈ 0.68 m, speed ≈ stick% × 0.5 × 1.4 m/s. Real toy-grade steering varies —
   use steering trim, or copy a mission and tune its times. */
export const BUILTIN: Mission[] = [
  { id: 'b-square', name: 'Square', icon: '◻︎', desc: 'Four sides, four corners', steps: rep(4, () => [mv('forward', 55, 2400), mv('spinright', 50, 2200)]) },
  { id: 'b-circle', name: 'Circle', icon: '◯', desc: 'One smooth lap', steps: [mv('right', 60, 10100)] },
  { id: 'b-eight', name: 'Figure 8', icon: '∞', desc: 'Left loop, right loop', steps: [mv('spinleft', 60, 7300), mv('spinright', 60, 7300)] },
  { id: 'b-zigzag', name: 'Zig-zag', icon: '⩘', desc: 'Weave down the hall', steps: [mv('left', 55, 700), ...rep(3, () => [mv('right', 55, 1400), mv('left', 55, 1400)]), mv('right', 55, 700)] },
  { id: 'b-patrol', name: 'Patrol', icon: '⇅', desc: 'Out and back, twice', steps: rep(2, () => [mv('forward', 50, 2000), mv('wait', 0, 500), mv('back', 50, 2000), mv('wait', 0, 500)]) },
  { id: 'b-uturn', name: 'Three-point turn', icon: '↺', desc: 'Turn around in a tight spot', steps: [mv('spinright', 45, 1700), mv('wait', 0, 250), mv('backleft', 45, 1700), mv('wait', 0, 250), mv('spinright', 45, 1900)] },
  { id: 'b-dance', name: 'Dance', icon: '♪', desc: 'Show off a little', steps: [...rep(3, () => [mv('forward', 60, 300), mv('back', 60, 300)]), mv('spinleft', 70, 1500), mv('spinright', 70, 1500), mv('wait', 0, 300)] },
  { id: 'b-crawl', name: 'Crawl test', icon: '⛰', desc: 'Crawl mode, slow and steady', steps: [{ id: 'cm', kind: 'mode', m: 'crawl' } as Step, mv('forward', 100, 3000), mv('wait', 0, 400), mv('back', 100, 2000)] },
].map((m) => ({ ...m, builtin: true, createdAt: 0 }));

/* ── storage ───────────────────────────────────────────────────── */
const KEY = 'rcr-missions';
function loadCustom(): Mission[] { try { return JSON.parse(localStorage.getItem(KEY) || '[]') as Mission[]; } catch { return []; } }
export const missions = createStore<{ custom: Mission[] }>({ custom: loadCustom() });
missions.subscribe(() => { try { localStorage.setItem(KEY, JSON.stringify(missions.get().custom)); } catch { /* ignore */ } });

export const allMissions = () => [...missions.get().custom, ...BUILTIN];
export function findMission(q: string): Mission | undefined {
  const n = q.toLowerCase().replace(/[^a-z0-9]/g, '');
  return allMissions().find((m) => m.name.toLowerCase().replace(/[^a-z0-9]/g, '') === n)
    ?? allMissions().find((m) => { const k = m.name.toLowerCase().replace(/[^a-z0-9]/g, ''); return k.includes(n) || n.includes(k); });
}
export function saveMission(m: Mission) {
  const exists = missions.get().custom.some((x) => x.id === m.id);
  missions.set((s) => ({ custom: exists ? s.custom.map((x) => (x.id === m.id ? m : x)) : [m, ...s.custom] }));
  if (!exists) bus.emit('mission:saved', { name: m.name, recorded: !!m.recorded });
  logEvent('mission', `${exists ? 'Updated' : 'Saved'} mission “${m.name}”`, 'good');
}
export function deleteMission(id: string) {
  const m = missions.get().custom.find((x) => x.id === id);
  missions.set((s) => ({ custom: s.custom.filter((x) => x.id !== id) }));
  if (m) logEvent('mission', `Deleted mission “${m.name}”`);
}

export const stepMs = (s: Step) => (s.kind === 'mode' ? 0 : s.ms);
export const missionMs = (m: Mission) => m.steps.reduce((a, s) => a + stepMs(s), 0);
export function stepStick(s: Step) {
  if (s.kind === 'move') return moveToStick(s.move, s.speed);
  if (s.kind === 'raw') return { thr: s.thr, str: s.str };
  return { thr: 0, str: 0 };
}

/** Predicted path of a mission (for previews), using the same model as odometry at a nominal 50% cap. */
export function missionPath(m: Mission): [number, number][] {
  let p = { x: 0, y: 0, h: 0 };
  const pts: [number, number][] = [[0, 0]];
  let cap = 0.5;
  for (const s of m.steps) {
    if (s.kind === 'mode') { cap = { crawl: 0.25, cruise: 0.5, sport: 0.75, full: 1 }[s.m]; continue; }
    const { thr, str } = stepStick(s);
    for (let t = 0; t < s.ms; t += 50) { p = stepPose(p, thr * cap, str, 0.05); if (t % 150 === 0) pts.push([p.x, p.y]); }
    pts.push([p.x, p.y]);
  }
  return pts;
}

/* ── autopilot ─────────────────────────────────────────────────── */
export interface AutoState { running: Mission | null; index: number; progress: number; elapsed: number; total: number }
export const autopilot = createStore<AutoState>({ running: null, index: 0, progress: 0, elapsed: 0, total: 0 }, { batched: true });
let timer: ReturnType<typeof setInterval> | null = null;

export function runMission(m: Mission): { ok: boolean; reason?: string } {
  const r = rover.get();
  if (r.status !== 'connected') return { ok: false, reason: 'Connect to the rover first.' };
  if (!r.tel.armed) return { ok: false, reason: 'Start the ignition first.' };
  if (!m.steps.length) return { ok: false, reason: 'This mission has no steps yet.' };
  stopMission('replaced', true);
  const total = missionMs(m);
  const t0 = performance.now();
  let modeIdx = -1;
  autopilot.set({ running: m, index: 0, progress: 0, elapsed: 0, total });
  logEvent('mission', `▶ Running “${m.name}” (${(total / 1000).toFixed(1)} s)`, 'good');
  bus.emit('mission:start', { name: m.name });
  updateTrip((t) => ({ missions: t.missions + 1 }));
  chime('start');
  timer = setInterval(() => {
    const st = rover.get();
    if (st.status !== 'connected' || !st.tel.armed) return stopMission(st.status !== 'connected' ? 'link lost' : 'ignition off');
    const el = performance.now() - t0;
    let acc = 0, i = 0;
    for (; i < m.steps.length; i++) { const d = stepMs(m.steps[i]); if (el < acc + d || (d === 0 && i > modeIdx)) break; acc += d; }
    if (i >= m.steps.length) return finish();
    const s = m.steps[i];
    if (s.kind === 'mode') { if (i > modeIdx) { modeIdx = i; control.mode(s.m); } return; }
    input.set(stepStick(s));
    autopilot.set({ index: i, elapsed: el, progress: Math.min(1, el / Math.max(1, total)) });
  }, 30);

  function finish() {
    clear();
    input.set({ thr: 0, str: 0 });
    autopilot.set({ running: null, progress: 1 });
    logEvent('mission', `✓ “${m.name}” complete`, 'good');
    bus.emit('mission:end', { name: m.name, completed: true });
    chime('done'); haptic('success');
  }
  return { ok: true };
}

function clear() { if (timer) clearInterval(timer); timer = null; }

export function stopMission(reason = 'stopped', silent = false) {
  const m = autopilot.get().running;
  if (!m) return;
  clear();
  input.set({ thr: 0, str: 0 });
  autopilot.set({ running: null });
  if (silent) return;
  logEvent('mission', `■ “${m.name}” stopped (${reason})`, 'warn');
  bus.emit('mission:end', { name: m.name, completed: false, reason });
  toast(`Mission stopped: ${reason}`, 'warn');
}

/** Called by every manual control on touch-down: the human always wins. */
export function manualOverride() { if (autopilot.get().running) stopMission('manual override'); }

/* ── drive recorder ────────────────────────────────────────────── */
export const recorder = createStore<{ on: boolean; since: number; samples: number }>({ on: false, since: 0, samples: 0 }, { batched: true });
let rec: { thr: number; str: number; ms: number }[] = [];
let recTimer: ReturnType<typeof setInterval> | null = null;

export function startRecording() {
  if (recorder.get().on) return;
  rec = [];
  recorder.set({ on: true, since: Date.now(), samples: 0 });
  recTimer = setInterval(() => {
    const { thr, str } = input.get();
    const q = (v: number) => Math.round(v / 5) * 5;
    const lastSeg = rec[rec.length - 1];
    if (lastSeg && Math.abs(lastSeg.thr - q(thr)) <= 5 && Math.abs(lastSeg.str - q(str)) <= 5) lastSeg.ms += 100;
    else rec.push({ thr: q(thr), str: q(str), ms: 100 });
    recorder.set((s) => ({ samples: s.samples + 1 }));
  }, 100);
  logEvent('mission', '● Recording drive…');
  chime('listen');
}

export function stopRecording(save = true): Mission | null {
  if (!recorder.get().on) return null;
  if (recTimer) clearInterval(recTimer);
  recTimer = null;
  recorder.set({ on: false });
  while (rec.length && rec[0].thr === 0 && rec[0].str === 0) rec.shift();          // trim idle start
  while (rec.length && rec[rec.length - 1].thr === 0 && rec[rec.length - 1].str === 0) rec.pop();
  if (!save || rec.length === 0) { logEvent('mission', 'Recording discarded (nothing driven)'); return null; }
  const n = missions.get().custom.filter((m) => m.recorded).length + 1;
  const m: Mission = {
    id: sid(), name: `Recorded drive ${n}`, icon: '●', desc: `Recorded ${new Date().toLocaleString()}`,
    steps: rec.map((r) => ({ id: sid(), kind: 'raw' as const, thr: r.thr, str: r.str, ms: r.ms })),
    recorded: true, createdAt: Date.now(),
  };
  saveMission(m);
  chime('done');
  return m;
}

/** Ad-hoc mission from co-pilot / voice commands. */
export function quickMission(name: string, steps: Step[]): Mission {
  return { id: sid(), name, icon: '✦', desc: 'From Nova', steps, createdAt: Date.now() };
}
