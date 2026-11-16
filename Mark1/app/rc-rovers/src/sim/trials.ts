/* Time trials (demo rover): 3-2-1 countdown, gates in order, +2 s per bump,
   best times saved on the device, XP for finishing / clean runs / beating par. */
import { createStore } from '../state/store';
import { odo, resetOdo } from '../state/odometry';
import { addDriveHold, rover } from '../rover/controller';
import { bus } from '../state/bus';
import { toast } from '../state/ui';
import { logEvent } from '../state/logs';
import { bump as bumpCounters, grantXp } from '../state/academy';
import { chime } from '../lib/sound';
import { haptic } from '../lib/native';
import { courseById, crosses } from './world';

export const PENALTY_MS = 2000;
const BEST_KEY = 'rcr-trial-best';

export interface TrialResult { ms: number; raw: number; bumps: number; best: boolean; prevBest: number | null; par: number }
export interface TrialState {
  course: string | null;
  phase: 'idle' | 'countdown' | 'running' | 'done';
  count: number;              // countdown number shown
  next: number;               // index of the next gate
  t0: number;                 // performance.now() at GO
  bumps: number;
  splits: number[];
  result: TrialResult | null;
  best: Record<string, number>;
}

function loadBest(): Record<string, number> { try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}'); } catch { return {}; } }

export const trial = createStore<TrialState>({ course: null, phase: 'idle', count: 0, next: 0, t0: 0, bumps: 0, splits: [], result: null, best: loadBest() });

let timers: ReturnType<typeof setTimeout>[] = [];
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

addDriveHold(() => trial.get().phase === 'countdown');

export function startTrial(id: string): { ok: boolean; reason?: string } {
  const r = rover.get();
  const c = courseById(id);
  if (!c) return { ok: false, reason: 'Unknown course.' };
  if (r.status !== 'connected' || r.kind !== 'demo') return { ok: false, reason: 'Time trials run on the demo rover. Connect the demo first.' };
  clearTimers();
  resetOdo();

  trial.set({ course: id, phase: 'countdown', count: 3, next: 0, t0: 0, bumps: 0, splits: [], result: null });
  chime('tap'); haptic('light');
  for (const n of [2, 1]) timers.push(setTimeout(() => { trial.set({ count: n }); chime('tap'); haptic('light'); }, (3 - n) * 1000));
  timers.push(setTimeout(() => {
    resetOdo(); px = 0; py = 0;
    trial.set({ phase: 'running', count: 0, t0: performance.now() });
    chime('start'); haptic('success');
    if (!rover.get().tel.armed) toast('GO! Slide to start the ignition', 'warn', 2200);
  }, 3000));
  logEvent('mission', `Time trial started: ${c.name}`);
  return { ok: true };
}

export function stopTrial() {
  clearTimers();
  trial.set({ course: null, phase: 'idle', count: 0, next: 0, result: null, splits: [], bumps: 0 });
}

function finish() {
  const s = trial.get();
  const c = courseById(s.course)!;
  const raw = performance.now() - s.t0;
  const ms = Math.round(raw + s.bumps * PENALTY_MS);
  const prevBest = s.best[c.id] ?? null;
  const best = prevBest == null || ms < prevBest;
  const bestMap = best ? { ...s.best, [c.id]: ms } : s.best;
  if (best) { try { localStorage.setItem(BEST_KEY, JSON.stringify(bestMap)); } catch { /* ignore */ } }
  trial.set({ phase: 'done', result: { ms, raw: Math.round(raw), bumps: s.bumps, best, prevBest, par: c.par }, best: bestMap });
  chime('done'); haptic('success');
  const secs = (ms / 1000).toFixed(2);
  logEvent('mission', `Trial ${c.name}: ${secs} s${s.bumps ? ` (${s.bumps} bump${s.bumps > 1 ? 's' : ''})` : ''}${best ? ' · new best' : ''}`, 'good');
  bumpCounters((k) => ({ trials: k.trials + 1, cleanRuns: k.cleanRuns + (s.bumps === 0 ? 1 : 0), parBeats: k.parBeats + (ms <= c.par ? 1 : 0) }));
  grantXp(15 + (ms <= c.par ? 15 : 0) + (best && prevBest != null ? 10 : 0), `${c.name} trial`);
  bus.emit('trial:end', { course: c.id, ms, bumps: s.bumps, best });
}

/* referee: watch the pose for gate crossings */
let px = 0, py = 0;
odo.subscribe(() => {
  const o = odo.get();
  const s = trial.get();
  if (s.phase === 'running') {
    const c = courseById(s.course);
    const gt = c?.gates[s.next];
    if (c && gt && crosses(gt, px, py, o.x, o.y)) {
      const split = performance.now() - s.t0;
      const next = s.next + 1;
      trial.set({ next, splits: [...s.splits, split] });
      if (next >= c.gates.length) finish();
      else { chime('tap'); haptic('tick'); }
    }
  }
  px = o.x; py = o.y;
});

bus.on('bump', () => {
  if (trial.get().phase !== 'running') return;
  trial.set((s) => ({ bumps: s.bumps + 1 }));
  toast(`Bump! +${PENALTY_MS / 1000} s`, 'warn', 1200);
});
bus.on('disconnected', () => { if (trial.get().phase !== 'idle') stopTrial(); });
bus.on('lost', () => { if (trial.get().phase === 'running' || trial.get().phase === 'countdown') stopTrial(); });

export const fmtTime = (ms: number) => {
  const s = ms / 1000;
  return s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` : `${s.toFixed(2)} s`;
};
