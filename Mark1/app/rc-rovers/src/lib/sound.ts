/* All app audio is synthesised with WebAudio (no files):
   - UI chimes (ignition, stop, missions, voice)
   - an RC drivetrain that follows the rover's real output: brushed-motor whine,
     gear-mesh harmonic, low chassis rumble, tyre/gravel noise and a steering-servo buzz
   - one-shots: motor spool-up on arm, brake + relay clunk on stop.
   Everything runs through one master gain (Settings → Volume) and a compressor so it
   can be loud without clipping. */
import { settings } from '../state/settings';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let comp: DynamicsCompressorNode | null = null;
let tap: MediaStreamAudioDestinationNode | null = null;
let noiseBuf: AudioBuffer | null = null;

const vol = () => Math.max(0, Math.min(100, settings.get().volume ?? 85)) / 100;

function ac() {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
    master = ctx.createGain();
    master.gain.value = vol() * 1.6;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
settings.subscribe(() => { if (ctx && master) master.gain.setTargetAtTime(vol() * 1.6, ctx.currentTime, 0.05); });

function noise(a: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.82 * b + 0.18 * w; d[i] = b * 2.4; }  // slightly pinked
  }
  const n = a.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
  return n;
}

/* ── UI chimes ─────────────────────────────────────────────────── */
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
  const a = ac(); if (!a || !master) return;
  const t0 = a.currentTime + 0.01;
  for (const [f, off] of NOTES[kind]) {
    for (const [mul, type, amp] of [[1, kind === 'stop' || kind === 'error' ? 'triangle' : 'sine', 1], [2, 'sine', 0.18]] as const) {
      const o = a.createOscillator(); const g = a.createGain();
      o.type = type; o.frequency.value = f * mul;
      const len = kind === 'tap' ? 0.05 : 0.22;
      const peak = (kind === 'tap' ? 0.08 : 0.2) * amp;
      g.gain.setValueAtTime(0, t0 + off);
      g.gain.linearRampToValueAtTime(peak, t0 + off + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + len);
      o.connect(g).connect(master);
      o.start(t0 + off); o.stop(t0 + off + len + 0.05);
    }
  }
}

/* ── one-shot effects ──────────────────────────────────────────── */
/** The app's mixed audio as a MediaStream (for recording camera clips with sound). */
export function audioStream(): MediaStream | null {
  const a = ac(); if (!a || !comp) return null;
  if (!tap) { tap = a.createMediaStreamDestination(); comp.connect(tap); }
  return tap.stream;
}

export type Sfx = 'spool' | 'brake' | 'click' | 'bump' | 'shutter';
export function sfx(kind: Sfx) {
  if (kind === 'shutter' ? !settings.get().uiSounds : !settings.get().motorSound) return;
  const a = ac(); if (!a || !master) return;
  const t = a.currentTime + 0.01;
  if (kind === 'bump') {
    // chassis thud + plastic clack + gravel scatter
    const k = a.createOscillator(), kg = a.createGain();
    k.type = 'sine'; k.frequency.setValueAtTime(140, t); k.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    kg.gain.setValueAtTime(0.9, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    k.connect(kg).connect(master); k.start(t); k.stop(t + 0.3);
    const n = noise(a), nf = a.createBiquadFilter(), ng = a.createGain();
    nf.type = 'bandpass'; nf.frequency.value = 2200; nf.Q.value = 1.2;
    ng.gain.setValueAtTime(0.6, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    n.connect(nf).connect(ng).connect(master); n.start(t); n.stop(t + 0.12);
    const n2 = noise(a), n2f = a.createBiquadFilter(), n2g = a.createGain();
    n2f.type = 'highpass'; n2f.frequency.value = 3500;
    n2g.gain.setValueAtTime(0, t + 0.04); n2g.gain.linearRampToValueAtTime(0.18, t + 0.07); n2g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    n2.connect(n2f).connect(n2g).connect(master); n2.start(t); n2.stop(t + 0.45);
    return;
  }
  // relay click (all of these start with it)
  const c = noise(a), cf = a.createBiquadFilter(), cg = a.createGain();
  cf.type = 'highpass'; cf.frequency.value = 2500;
  cg.gain.setValueAtTime(0.5, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  c.connect(cf).connect(cg).connect(master); c.start(t); c.stop(t + 0.05);
  if (kind === 'click') return;
  if (kind === 'shutter') {
    const n = noise(a), nf = a.createBiquadFilter(), ng = a.createGain();
    nf.type = 'bandpass'; nf.frequency.value = 3200; nf.Q.value = 0.9;
    ng.gain.setValueAtTime(0, t + 0.06); ng.gain.linearRampToValueAtTime(0.35, t + 0.065); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(nf).connect(ng).connect(master); n.start(t); n.stop(t + 0.15);
    return;
  }

  const o = a.createOscillator(), o2 = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
  o.type = 'sawtooth'; o2.type = 'square'; f.type = 'bandpass'; f.Q.value = 1.4;
  o.connect(f); o2.connect(f); f.connect(g).connect(master);
  if (kind === 'spool') {
    // ESC arming beeps, then a quick motor spin-up and settle
    for (const [i, fr] of [[0, 1760], [1, 2093]] as const) {
      const b = a.createOscillator(), bg = a.createGain();
      b.type = 'square'; b.frequency.value = fr;
      const bt = t + 0.05 + i * 0.11;
      bg.gain.setValueAtTime(0, bt); bg.gain.linearRampToValueAtTime(0.05, bt + 0.005); bg.gain.setValueAtTime(0.05, bt + 0.07); bg.gain.linearRampToValueAtTime(0, bt + 0.08);
      b.connect(bg).connect(master); b.start(bt); b.stop(bt + 0.1);
    }
    const s = t + 0.3;
    o.frequency.setValueAtTime(90, s); o.frequency.exponentialRampToValueAtTime(900, s + 0.28); o.frequency.exponentialRampToValueAtTime(160, s + 0.7);
    o2.frequency.setValueAtTime(181, s); o2.frequency.exponentialRampToValueAtTime(1810, s + 0.28); o2.frequency.exponentialRampToValueAtTime(322, s + 0.7);
    f.frequency.setValueAtTime(600, s); f.frequency.exponentialRampToValueAtTime(2600, s + 0.28); f.frequency.exponentialRampToValueAtTime(800, s + 0.7);
    g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.22, s + 0.08); g.gain.exponentialRampToValueAtTime(0.001, s + 0.75);
    o.start(s); o2.start(s); o.stop(s + 0.8); o2.stop(s + 0.8);
  } else {
    // brake: motor pitch dives, drivetrain clunk + tyre scrub
    o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.35);
    o2.frequency.setValueAtTime(1400, t); o2.frequency.exponentialRampToValueAtTime(120, t + 0.35);
    f.frequency.setValueAtTime(2000, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.35);
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.start(t); o2.start(t); o.stop(t + 0.45); o2.stop(t + 0.45);
    const n = noise(a), nf = a.createBiquadFilter(), ng = a.createGain();
    nf.type = 'bandpass'; nf.frequency.value = 1600; nf.Q.value = 0.8;
    ng.gain.setValueAtTime(0.35, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    n.connect(nf).connect(ng).connect(master); n.start(t); n.stop(t + 0.35);
    const k = a.createOscillator(), kg = a.createGain();
    k.type = 'sine'; k.frequency.setValueAtTime(120, t); k.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    kg.gain.setValueAtTime(0.5, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    k.connect(kg).connect(master); k.start(t); k.stop(t + 0.2);
  }
}

/* ── continuous drivetrain ─────────────────────────────────────── */
interface Motor {
  whine: OscillatorNode; whine2: OscillatorNode; whineF: BiquadFilterNode; whineG: GainNode;
  rumble: OscillatorNode; rumbleF: BiquadFilterNode; rumbleG: GainNode;
  road: AudioBufferSourceNode; roadF: BiquadFilterNode; roadG: GainNode;
  servo: OscillatorNode; servoF: BiquadFilterNode; servoG: GainNode;
  wob: OscillatorNode; wobG: GainNode;
  out: GainNode;
}
let mot: Motor | null = null;
let lastStr = 0;
let lastX = 0;

function build(a: AudioContext): Motor {
  const out = a.createGain(); out.gain.value = 0; out.connect(master!);
  // motor whine: saw + gear-mesh square, band-passed
  const whine = a.createOscillator(), whine2 = a.createOscillator(), whineF = a.createBiquadFilter(), whineG = a.createGain();
  whine.type = 'sawtooth'; whine2.type = 'square'; whineF.type = 'bandpass'; whineF.Q.value = 2.2; whineG.gain.value = 0;
  const w2g = a.createGain(); w2g.gain.value = 0.35;
  whine.connect(whineF); whine2.connect(w2g).connect(whineF); whineF.connect(whineG).connect(out);
  // slight brush flutter on the whine pitch
  const wob = a.createOscillator(), wobG = a.createGain();
  wob.frequency.value = 23; wobG.gain.value = 0;
  wob.connect(wobG); wobG.connect(whine.frequency); wobG.connect(whine2.frequency);
  // chassis rumble
  const rumble = a.createOscillator(), rumbleF = a.createBiquadFilter(), rumbleG = a.createGain();
  rumble.type = 'sawtooth'; rumbleF.type = 'lowpass'; rumbleF.Q.value = 3; rumbleG.gain.value = 0;
  rumble.connect(rumbleF).connect(rumbleG).connect(out);
  // tyres on gravel
  const road = noise(a), roadF = a.createBiquadFilter(), roadG = a.createGain();
  roadF.type = 'bandpass'; roadF.Q.value = 0.7; roadG.gain.value = 0;
  road.connect(roadF).connect(roadG).connect(out);
  // steering servo
  const servo = a.createOscillator(), servoF = a.createBiquadFilter(), servoG = a.createGain();
  servo.type = 'square'; servo.frequency.value = 210; servoF.type = 'bandpass'; servoF.frequency.value = 1900; servoF.Q.value = 2.5; servoG.gain.value = 0;
  servo.connect(servoF).connect(servoG).connect(out);
  for (const o of [whine, whine2, rumble, road, servo, wob]) o.start();
  return { whine, whine2, whineF, whineG, rumble, rumbleF, rumbleG, road, roadF, roadG, servo, servoF, servoG, wob, wobG, out };
}

/** Called on every telemetry change with the rover's actual output. */
export function motor(armed: boolean, thr: number, str: number) {
  const on = settings.get().motorSound && armed;
  if (!on) {
    if (mot && ctx) {
      const m = mot; mot = null;
      m.out.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
      setTimeout(() => { for (const o of [m.whine, m.whine2, m.rumble, m.road, m.servo, m.wob]) { try { o.stop(); } catch { /* already stopped */ } } m.out.disconnect(); }, 900);
    }
    lastStr = str; lastX = 0;
    return;
  }
  const a = ac(); if (!a || !master) return;
  if (!mot) { mot = build(a); mot.out.gain.setTargetAtTime(1, a.currentTime, 0.05); }
  const m = mot, t = a.currentTime;
  const x = Math.min(1, Math.abs(thr) / 100);
  const accel = Math.max(0, x - lastX);           // load spike when you punch it
  lastX = x;
  const k = 0.05;
  const f = 110 + x * 1350;
  m.whine.frequency.setTargetAtTime(f, t, k);
  m.whine2.frequency.setTargetAtTime(f * 2.03, t, k);
  m.whineF.frequency.setTargetAtTime(700 + x * 2900, t, k);
  m.whineG.gain.setTargetAtTime(0.03 + x * 0.2 + accel * 0.25, t, 0.04);
  m.wobG.gain.setTargetAtTime(2 + x * 14, t, k);
  m.rumble.frequency.setTargetAtTime(34 + x * 62, t, k);
  m.rumbleF.frequency.setTargetAtTime(180 + x * 520, t, k);
  m.rumbleG.gain.setTargetAtTime(0.06 + x * 0.22, t, 0.06);
  m.roadF.frequency.setTargetAtTime(500 + x * 2200, t, 0.1);
  m.roadG.gain.setTargetAtTime(x < 0.03 ? 0 : 0.04 + x * 0.24, t, 0.1);
  // servo: buzzes while the steering is moving
  const ds = Math.abs(str - lastStr);
  lastStr = str;
  if (ds > 1.5) {
    m.servo.frequency.setTargetAtTime(180 + Math.min(ds, 40) * 6, t, 0.02);
    m.servoG.gain.cancelScheduledValues(t);
    m.servoG.gain.setTargetAtTime(Math.min(0.16, 0.05 + ds * 0.004), t, 0.01);
    m.servoG.gain.setTargetAtTime(0, t + 0.09, 0.03);
  }
}
