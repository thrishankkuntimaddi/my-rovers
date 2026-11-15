/* Academy: XP + levels, achievements, and a guided driving school whose lessons are
   checked live against what the rover is actually doing. */
import { createStore } from './store';
import { bus } from './bus';
import { logEvent } from './logs';
import { toast } from './ui';
import { rover } from '../rover/controller';
import { odo } from './odometry';
import { tilt } from '../input/sources';
import { chime } from '../lib/sound';
import { haptic } from '../lib/native';
import type { DriveMode } from '../rover/protocol';

export interface Counters {
  sessions: number; driveSeconds: number; voiceCmds: number; typedCmds: number; missionsRun: number; missionsDone: number;
  missionsMade: number; recordings: number; estops: number; modes: DriveMode[]; tiltSeconds: number; distance: number;
  maxSpeed: number; smoothSeconds: number; lessons: number; demoSessions: number; realSessions: number;
  trials: number; cleanRuns: number; parBeats: number; snapshots: number; clips: number; cruiseUses: number;
}
interface AcademyState { xp: number; unlocked: Record<string, number>; c: Counters; lesson: string | null; lessonStep: number; lessonProgress: number }

const ZERO: Counters = { sessions: 0, driveSeconds: 0, voiceCmds: 0, typedCmds: 0, missionsRun: 0, missionsDone: 0, missionsMade: 0, recordings: 0, estops: 0, modes: [], tiltSeconds: 0, distance: 0, maxSpeed: 0, smoothSeconds: 0, lessons: 0, demoSessions: 0, realSessions: 0, trials: 0, cleanRuns: 0, parBeats: 0, snapshots: 0, clips: 0, cruiseUses: 0 };
const KEY = 'rcr-academy';
function load(): AcademyState {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) return { ...s, c: { ...ZERO, ...s.c }, lesson: null, lessonStep: 0, lessonProgress: 0 }; } catch { /* ignore */ }
  return { xp: 0, unlocked: {}, c: ZERO, lesson: null, lessonStep: 0, lessonProgress: 0 };
}
export const academy = createStore<AcademyState>(load(), { batched: true });
let saveT: ReturnType<typeof setTimeout> | null = null;
academy.subscribe(() => {
  if (saveT) return;
  saveT = setTimeout(() => { saveT = null; const { xp, unlocked, c } = academy.get(); try { localStorage.setItem(KEY, JSON.stringify({ xp, unlocked, c })); } catch { /* ignore */ } }, 800);
});

export const LEVELS = [
  { name: 'Rookie', xp: 0 }, { name: 'Driver', xp: 120 }, { name: 'Pilot', xp: 320 }, { name: 'Ace', xp: 650 },
  { name: 'Commander', xp: 1100 }, { name: 'Legend', xp: 1800 },
];
export function levelOf(xp: number) {
  let i = 0; while (i < LEVELS.length - 1 && xp >= LEVELS[i + 1].xp) i++;
  const cur = LEVELS[i], next = LEVELS[i + 1];
  return { index: i, name: cur.name, next: next?.name ?? null, progress: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1, toNext: next ? next.xp - xp : 0 };
}

export interface Achievement { id: string; title: string; desc: string; xp: number; icon: string; test(c: Counters): boolean }
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'gate-runner', title: 'Gate Runner', desc: 'Finish a time trial', xp: 40, icon: '🏁', test: (c) => c.trials >= 1 },
  { id: 'clean-run', title: 'Clean Run', desc: 'Finish a trial without hitting anything', xp: 60, icon: '✨', test: (c) => c.cleanRuns >= 1 },
  { id: 'under-par', title: 'Under Par', desc: 'Beat the par time on any course', xp: 80, icon: '⚡', test: (c) => c.parBeats >= 1 },
  { id: 'shutterbug', title: 'Shutterbug', desc: 'Take a camera snapshot', xp: 15, icon: '📸', test: (c) => c.snapshots >= 1 },
  { id: 'director', title: 'Director', desc: 'Record a camera clip', xp: 25, icon: '🎬', test: (c) => c.clips >= 1 },
  { id: 'cruiser', title: 'Cruiser', desc: 'Use cruise control', xp: 15, icon: '🛞', test: (c) => c.cruiseUses >= 1 },
  { id: 'first-contact', title: 'First Contact', desc: 'Connect to a rover', xp: 20, icon: '🛰', test: (c) => c.sessions >= 1 },
  { id: 'real-deal', title: 'The Real Deal', desc: 'Connect to the real MARK 1', xp: 60, icon: '🔌', test: (c) => c.realSessions >= 1 },
  { id: 'first-meter', title: 'First Meter', desc: 'Drive 1 meter', xp: 20, icon: '📏', test: (c) => c.distance >= 1 },
  { id: 'hundred', title: 'Century', desc: 'Drive 100 meters in total', xp: 80, icon: '💯', test: (c) => c.distance >= 100 },
  { id: 'marathon', title: 'Marathon', desc: 'Drive for 10 minutes in total', xp: 80, icon: '⏱', test: (c) => c.driveSeconds >= 600 },
  { id: 'mode-master', title: 'Mode Master', desc: 'Use all four drive modes', xp: 40, icon: '🎚', test: (c) => c.modes.length >= 4 },
  { id: 'speed-demon', title: 'Speed Demon', desc: 'Reach 1 m/s (estimated)', xp: 40, icon: '⚡', test: (c) => c.maxSpeed >= 1 },
  { id: 'smooth', title: 'Smooth Operator', desc: 'Hold a gentle 20–40% throttle for 10 s', xp: 50, icon: '🧈', test: (c) => c.smoothSeconds >= 10 },
  { id: 'voice-pilot', title: 'Voice Pilot', desc: 'Give 5 voice commands', xp: 50, icon: '🎙', test: (c) => c.voiceCmds >= 5 },
  { id: 'chatty', title: 'Chatty', desc: 'Send Nova 10 commands', xp: 30, icon: '💬', test: (c) => c.voiceCmds + c.typedCmds >= 10 },
  { id: 'autopilot', title: 'Autopilot', desc: 'Complete a mission', xp: 40, icon: '🧭', test: (c) => c.missionsDone >= 1 },
  { id: 'architect', title: 'Architect', desc: 'Create your own mission', xp: 50, icon: '📐', test: (c) => c.missionsMade >= 1 },
  { id: 'director', title: 'Director', desc: 'Record a drive', xp: 40, icon: '🎬', test: (c) => c.recordings >= 1 },
  { id: 'safety-first', title: 'Safety First', desc: 'Use the emergency stop', xp: 20, icon: '🛑', test: (c) => c.estops >= 1 },
  { id: 'tilt-rider', title: 'Tilt Rider', desc: 'Steer by tilt for 30 s', xp: 50, icon: '📱', test: (c) => c.tiltSeconds >= 30 },
  { id: 'graduate', title: 'Graduate', desc: 'Finish every Driving School lesson', xp: 150, icon: '🎓', test: (c) => c.lessons >= LESSONS.length },
];

/* ── driving school ────────────────────────────────────────────── */
interface Probe { armed: boolean; thr: number; str: number; mode: DriveMode; estop: boolean; voice: boolean; missionDone: boolean; dt: number }
export interface Lesson { id: string; title: string; goal: string; tip: string; xp: number; check(p: Probe, mem: Record<string, number>): number /* 0…1 */ }
export const LESSONS: Lesson[] = [
  { id: 'l1', title: 'Ignition', goal: 'Slide the ignition to start the engine.', tip: 'Drag the power button to the right until it turns green.', xp: 20, check: (p) => (p.armed ? 1 : 0) },
  { id: 'l2', title: 'Gentle start', goal: 'Hold the throttle between 20% and 40% for 3 seconds.', tip: 'Push the left thumb up just a little. Smooth wins.', xp: 30,
    check: (p, m) => { m.t = p.thr >= 18 && p.thr <= 42 ? (m.t ?? 0) + p.dt : 0; return Math.min(1, (m.t ?? 0) / 3); } },
  { id: 'l3', title: 'Steering', goal: 'Steer fully left, then fully right.', tip: 'Slide the right thumb all the way each way.', xp: 30,
    check: (p, m) => { if (p.str <= -80) m.l = 1; if (m.l && p.str >= 80) m.r = 1; return (m.l ? 0.5 : 0) + (m.r ? 0.5 : 0); } },
  { id: 'l4', title: 'Reverse', goal: 'Reverse for 2 seconds.', tip: 'Pull the throttle down below the centre line.', xp: 30,
    check: (p, m) => { m.t = p.thr < -10 ? (m.t ?? 0) + p.dt : m.t ?? 0; return Math.min(1, (m.t ?? 0) / 2); } },
  { id: 'l5', title: 'Drive modes', goal: 'Try Crawl and Sport modes.', tip: 'Tap the mode pills under the gauge.', xp: 30,
    check: (p, m) => { if (p.mode === 'crawl') m.c = 1; if (p.mode === 'sport') m.s = 1; return (m.c ? 0.5 : 0) + (m.s ? 0.5 : 0); } },
  { id: 'l6', title: 'Emergency stop', goal: 'Hit the red STOP button.', tip: 'One tap — it acts the instant you touch it.', xp: 30, check: (p, m) => { if (p.estop) m.d = 1; return m.d ? 1 : 0; } },
  { id: 'l7', title: 'Talk to Nova', goal: 'Hold the mic and ask “battery status”.', tip: 'Hold the 🎙 button, speak, release.', xp: 40, check: (p, m) => { if (p.voice) m.d = 1; return m.d ? 1 : 0; } },
  { id: 'l8', title: 'Autopilot', goal: 'Run any mission to the end.', tip: 'Open Missions or say “run the square”.', xp: 40, check: (p, m) => { if (p.missionDone) m.d = 1; return m.d ? 1 : 0; } },
];

export function bump(patch: (c: Counters) => Partial<Counters>) {
  academy.set((s) => ({ c: { ...s.c, ...patch(s.c) } }));
  evaluate();
}

/** One-off XP (trial results etc.). */
export function grantXp(xp: number, why: string) {
  if (xp <= 0) return;
  const before = levelOf(academy.get().xp).index;
  academy.set((st) => ({ xp: st.xp + xp }));
  logEvent('academy', `+${xp} XP · ${why}`, 'good');
  const after = levelOf(academy.get().xp);
  if (after.index > before) { toast(`Level up — you're now a ${after.name}! 🚀`, 'good', 3600); logEvent('academy', `Level up: ${after.name}`, 'good'); }
}

function evaluate() {
  const s = academy.get();
  for (const a of ACHIEVEMENTS) {
    if (s.unlocked[a.id] || !a.test(s.c)) continue;
    const before = levelOf(academy.get().xp).index;
    academy.set((st) => ({ unlocked: { ...st.unlocked, [a.id]: Date.now() }, xp: st.xp + a.xp }));
    toast(`${a.icon} ${a.title} · +${a.xp} XP`, 'good', 3200);
    logEvent('academy', `Achievement unlocked: ${a.title} (+${a.xp} XP)`, 'good');
    chime('unlock'); haptic('success');
    bus.emit('achievement', { id: a.id, title: a.title });
    const after = levelOf(academy.get().xp);
    if (after.index > before) { toast(`Level up — you're now a ${after.name}! 🚀`, 'good', 3600); logEvent('academy', `Level up: ${after.name}`, 'good'); }
  }
}

/* lessons */
let mem: Record<string, number> = {};
let flags = { estop: false, voice: false, missionDone: false };
export function startLesson(id: string) { mem = {}; flags = { estop: false, voice: false, missionDone: false }; academy.set({ lesson: id, lessonProgress: 0 }); logEvent('academy', `Lesson started: ${LESSONS.find((l) => l.id === id)?.title}`); }
export function stopLesson() { academy.set({ lesson: null, lessonProgress: 0 }); }
export function resetAcademy() { academy.set({ xp: 0, unlocked: {}, c: ZERO, lesson: null, lessonProgress: 0 }); try { localStorage.removeItem(KEY); localStorage.removeItem('rcr-lessons'); } catch { /* ignore */ } lessonsDone.set({ done: {} }); }
export const lessonsDone = createStore<{ done: Record<string, number> }>({ done: (() => { try { return JSON.parse(localStorage.getItem('rcr-lessons') || '{}'); } catch { return {}; } })() });
lessonsDone.subscribe(() => { try { localStorage.setItem('rcr-lessons', JSON.stringify(lessonsDone.get().done)); } catch { /* ignore */ } });

/* ── observers ─────────────────────────────────────────────────── */
let last = performance.now();
setInterval(() => {
  const now = performance.now(); const dt = (now - last) / 1000; last = now;
  const r = rover.get(); const live = r.status === 'connected'; const { tel } = r;
  if (live && tel.armed) {
    const o = odo.get();
    bump((c) => ({
      driveSeconds: c.driveSeconds + dt,
      smoothSeconds: tel.thr >= 18 && tel.thr <= 42 ? c.smoothSeconds + dt : tel.thr > 42 ? 0 : c.smoothSeconds,
      tiltSeconds: tilt.get().active ? c.tiltSeconds + dt : c.tiltSeconds,
      maxSpeed: Math.max(c.maxSpeed, o.speed),
      modes: c.modes.includes(tel.mode) ? c.modes : [...c.modes, tel.mode],
    }));
  }
  const s = academy.get();
  if (s.lesson && live) {
    const lesson = LESSONS.find((l) => l.id === s.lesson)!;
    const p = lesson.check({ armed: tel.armed, thr: tel.thr, str: tel.str, mode: tel.mode, ...flags, dt }, mem);
    if (Math.abs(p - s.lessonProgress) > 0.01) academy.set({ lessonProgress: p });
    if (p >= 1) {
      const first = !lessonsDone.get().done[lesson.id];
      lessonsDone.set((d) => ({ done: { ...d.done, [lesson.id]: Date.now() } }));
      academy.set((st) => ({ lesson: null, lessonProgress: 0, xp: st.xp + (first ? lesson.xp : 0) }));
      toast(`Lesson complete: ${lesson.title}${first ? ` · +${lesson.xp} XP` : ''}`, 'good', 3000);
      logEvent('academy', `Lesson complete: ${lesson.title}`, 'good');
      chime('done'); haptic('success');
      bump(() => ({ lessons: Object.keys(lessonsDone.get().done).length }));
      const idx = LESSONS.findIndex((l) => l.id === lesson.id);
      if (LESSONS[idx + 1] && !lessonsDone.get().done[LESSONS[idx + 1].id]) setTimeout(() => startLesson(LESSONS[idx + 1].id), 1600);
    }
  }
}, 250);

let lastDist = 0;
odo.subscribe(() => { const d = odo.get().dist; if (d > lastDist) { const inc = d - lastDist; lastDist = d; bump((c) => ({ distance: c.distance + inc })); } else lastDist = d; });
bus.on('connected', ({ kind }) => bump((c) => ({ sessions: c.sessions + 1, demoSessions: c.demoSessions + (kind === 'demo' ? 1 : 0), realSessions: c.realSessions + (kind !== 'demo' ? 1 : 0) })));
bus.on('rover', ({ e }) => { if (e === 'estop') { flags.estop = true; bump((c) => ({ estops: c.estops + 1 })); } });
bus.on('command', ({ source }) => bump((c) => (source === 'voice' ? { voiceCmds: c.voiceCmds + 1 } : { typedCmds: c.typedCmds + 1 })));
bus.on('voice', () => { flags.voice = true; });
bus.on('cruise', () => bump((c) => ({ cruiseUses: c.cruiseUses + 1 })));
bus.on('snapshot', () => bump((c) => ({ snapshots: c.snapshots + 1 })));
bus.on('clip', () => bump((c) => ({ clips: c.clips + 1 })));
bus.on('mission:start', () => bump((c) => ({ missionsRun: c.missionsRun + 1 })));
bus.on('mission:end', ({ completed }) => { if (completed) { flags.missionDone = true; bump((c) => ({ missionsDone: c.missionsDone + 1 })); } });
bus.on('mission:saved', ({ recorded }) => bump((c) => (recorded ? { recordings: c.recordings + 1 } : { missionsMade: c.missionsMade + 1 })));
