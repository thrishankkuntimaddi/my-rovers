/* Synthesised UI chimes and an optional engine hum (WebAudio, no audio files). */
import { settings } from '../state/settings';

let ctx: AudioContext | null = null;
const ac = () => {
  if (!ctx) { try { ctx = new AudioContext(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
};

type Chime = 'arm' | 'disarm' | 'stop' | 'start' | 'done' | 'listen' | 'unlock' | 'error' | 'tap';
const NOTES: Record<Chime, [number, number][]> = {   // [frequency, start offset s]
  arm: [[523, 0], [784, 0.09], [1047, 0.18]],
  disarm: [[784, 0], [523, 0.1]],
  stop: [[880, 0], [440, 0.12], [880, 0.24]],
  start: [[660, 0], [990, 0.08]],
  done: [[784, 0], [988, 0.1], [1319, 0.2]],
  listen: [[1046, 0]],
  unlock: [[659, 0], [831, 0.08], [988, 0.16], [1319, 0.26]],
  error: [[330, 0], [262, 0.14]],
  tap: [[1400, 0]],
};

export function chime(kind: Chime) {
  if (!settings.get().uiSounds) return;
  const a = ac(); if (!a) return;
  const t0 = a.currentTime + 0.01;
  for (const [f, off] of NOTES[kind]) {
    const o = a.createOscillator(); const g = a.createGain();
    o.type = kind === 'stop' || kind === 'error' ? 'triangle' : 'sine';
    o.frequency.value = f;
    const len = kind === 'tap' ? 0.04 : 0.16;
    g.gain.setValueAtTime(0, t0 + off);
    g.gain.linearRampToValueAtTime(kind === 'tap' ? 0.05 : 0.12, t0 + off + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + len);
    o.connect(g).connect(a.destination);
    o.start(t0 + off); o.stop(t0 + off + len + 0.05);
  }
}

/* engine hum: two detuned saws through a low-pass, pitch follows |throttle| */
let eng: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null = null;
export function engine(armed: boolean, thr: number) {
  const on = settings.get().engineSound && armed;
  if (!on) { if (eng) { const e = eng; eng = null; e.g.gain.setTargetAtTime(0, ac()!.currentTime, 0.08); setTimeout(() => { e.o1.stop(); e.o2.stop(); }, 400); } return; }
  const a = ac(); if (!a) return;
  if (!eng) {
    const o1 = a.createOscillator(), o2 = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
    o1.type = o2.type = 'sawtooth'; f.type = 'lowpass'; f.Q.value = 6; g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g).connect(a.destination);
    o1.start(); o2.start();
    eng = { o1, o2, f, g };
  }
  const x = Math.min(1, Math.abs(thr) / 100);
  const t = a.currentTime;
  eng.o1.frequency.setTargetAtTime(42 + x * 120, t, 0.06);
  eng.o2.frequency.setTargetAtTime(43.5 + x * 124, t, 0.06);
  eng.f.frequency.setTargetAtTime(260 + x * 1500, t, 0.06);
  eng.g.gain.setTargetAtTime(0.028 + x * 0.05, t, 0.08);
}
