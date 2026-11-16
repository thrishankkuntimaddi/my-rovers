/* Extra ways to drive: tilt steering, Bluetooth / USB gamepads, keyboard.
   All write into the same `input` store as the touch controls. */
import { createStore } from '../state/store';
import { input, toast } from '../state/ui';
import { settings } from '../state/settings';
import { control, rover } from '../rover/controller';
import { MODES } from '../rover/protocol';
import { manualOverride, recorder, startRecording, stopRecording } from '../missions/missions';
import { hardStop } from '../ai/copilot';
import { haptic } from '../lib/native';
import { stepView } from '../state/views';
import { logEvent } from '../state/logs';

const clamp = (v: number, lo = -100, hi = 100) => Math.max(lo, Math.min(hi, v));

/* ── tilt steering ─────────────────────────────────────────────── */
export const tilt = createStore<{ active: boolean; roll: number; value: number; available: boolean }>(
  { active: false, roll: 0, value: 0, available: typeof window !== 'undefined' && 'DeviceMotionEvent' in window }, { batched: true });

function screenAngle() {
  const a = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
  return ((a % 360) + 360) % 360;
}

let tiltOff: (() => void) | null = null;
export function startTilt() {
  if (tiltOff) return;
  let smooth = 0;
  let got = false;
  // Auto-centre: however you hold the device when the cockpit opens is "straight".
  const seed: number[] = [];
  const onMotion = (e: DeviceMotionEvent) => {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    got = true;
    const a = screenAngle();
    const sx = a === 90 ? g.y : a === 270 ? -g.y : a === 180 ? -g.x : g.x;          // screen-right component
    const roll = (Math.asin(Math.max(-1, Math.min(1, -sx / 9.81))) * 180) / Math.PI;  // right side down = +
    smooth = seed.length ? smooth * 0.7 + roll * 0.3 : roll;
    if (seed.length < 10) {
      seed.push(roll);
      if (seed.length === 10) {
        settings.set({ tiltZero: Math.round((seed.reduce((x, y) => x + y, 0) / seed.length) * 10) / 10 });
        toast('Tilt centred: hold it like this to drive straight', 'neutral', 2000);
      }
      tilt.set({ roll: smooth, value: 0 });
      return;
    }
    const s = settings.get();
    const v = clamp(((smooth - s.tiltZero) / s.tiltRange) * 100);
    const out = Math.abs(v) < 7 ? 0 : Math.sign(v) * ((Math.abs(v) - 7) / 93) * 100;   // centre band = straight
    input.set({ str: out });
    tilt.set({ roll: smooth, value: out });
  };
  window.addEventListener('devicemotion', onMotion);
  tilt.set({ active: true });
  const check = setTimeout(() => { if (!got) toast('No motion sensor found — tilt needs a phone or tablet', 'warn'); }, 1500);
  tiltOff = () => { window.removeEventListener('devicemotion', onMotion); clearTimeout(check); input.set({ str: 0 }); tilt.set({ active: false, value: 0 }); };
}
export function stopTilt() { tiltOff?.(); tiltOff = null; }
export function calibrateTilt() {
  settings.set({ tiltZero: Math.round(tilt.get().roll * 10) / 10 });
  haptic('success');
  toast('Tilt centred', 'good', 1400);
}

/* ── gamepad ───────────────────────────────────────────────────── */
export const pad = createStore<{ connected: boolean; id: string }>({ connected: false, id: '' });
let padRaf = 0;
let padActive = false;
const prevBtn: boolean[] = [];

function pollPad() {
  padRaf = requestAnimationFrame(pollPad);
  const gp = navigator.getGamepads?.().find((g) => g && g.connected);
  if (!gp) return;
  const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
  const ly = dz(gp.axes[1] ?? 0), rx = dz(gp.axes[2] ?? 0), lx = dz(gp.axes[0] ?? 0);
  const rt = gp.buttons[7]?.value ?? 0, lt = gp.buttons[6]?.value ?? 0;
  const thr = clamp((-ly + rt - lt) * 100);
  const str = clamp((rx || lx) * 100);
  const moving = Math.abs(thr) > 1 || Math.abs(str) > 1;
  if (moving) { if (!padActive) manualOverride(); input.set({ thr, str }); padActive = true; }
  else if (padActive) { input.set({ thr: 0, str: 0 }); padActive = false; }
  const edge = (i: number) => { const p = !!gp.buttons[i]?.pressed; const e = p && !prevBtn[i]; prevBtn[i] = p; return e; };
  if (edge(0) || edge(9)) { const armed = rover.get().tel.armed; if (armed) control.disarm(); else control.arm(); haptic('medium'); }   // A / Start
  if (edge(1)) { control.estop(); haptic('heavy'); }                                                                                      // B
  if (edge(2)) hardStop();                                                                                                                // X
  if (edge(3)) { if (recorder.get().on) stopRecording(true); else startRecording(); }                                                     // Y
  const cur = MODES.findIndex((m) => m.id === rover.get().tel.mode);
  if (edge(4)) control.mode(MODES[Math.max(0, cur - 1)].id);                                                                            // LB
  if (edge(5)) control.mode(MODES[Math.min(MODES.length - 1, cur + 1)].id);                                                             // RB
}

export function initGamepad() {
  if (typeof window === 'undefined' || !('getGamepads' in navigator)) return;
  window.addEventListener('gamepadconnected', (e) => {
    pad.set({ connected: true, id: (e as GamepadEvent).gamepad.id });
    toast('Controller connected 🎮', 'good');
    logEvent('system', `Gamepad connected: ${(e as GamepadEvent).gamepad.id}`, 'good');
    if (!padRaf) pollPad();
  });
  window.addEventListener('gamepaddisconnected', () => {
    pad.set({ connected: false, id: '' });
    cancelAnimationFrame(padRaf); padRaf = 0;
    if (padActive) input.set({ thr: 0, str: 0 });
    toast('Controller disconnected', 'warn');
  });
}

/* ── keyboard (Bluetooth keyboards, desktop testing) ───────────── */
let keysOff: (() => void) | null = null;
export function startKeyboard() {
  if (keysOff) return;
  const held = new Set<string>();
  const apply = () => {
    const f = held.has('w') || held.has('arrowup'), b = held.has('s') || held.has('arrowdown');
    const l = held.has('a') || held.has('arrowleft'), r = held.has('d') || held.has('arrowright');
    const boost = held.has('shift') ? 100 : 60;
    input.set({ thr: f === b ? 0 : f ? boost : -boost, str: l === r ? 0 : l ? -100 : 100 });
  };
  const typing = (e: KeyboardEvent) => (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]');
  const down = (e: KeyboardEvent) => {
    if (typing(e) || e.repeat) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) { if (!held.size) manualOverride(); held.add(k); apply(); e.preventDefault(); return; }
    if (k === ' ') { hardStop(); e.preventDefault(); }
    else if (k === 'escape') control.estop();
    else if (k === 'e') { if (rover.get().tel.armed) control.disarm(); else control.arm(); }
    else if (k >= '1' && k <= '4') control.mode(MODES[+k - 1].id);
    else if (k === 'c') control.cruise();
    else if (k === 'v') stepView(e.shiftKey ? -1 : 1);
    else if (k === 'r') { if (recorder.get().on) stopRecording(true); else startRecording(); }
  };
  const up = (e: KeyboardEvent) => { const k = e.key.toLowerCase(); if (held.delete(k)) apply(); };
  const blur = () => { if (held.size) { held.clear(); apply(); } };
  window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
  keysOff = () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
}
export function stopKeyboard() { keysOff?.(); keysOff = null; }
