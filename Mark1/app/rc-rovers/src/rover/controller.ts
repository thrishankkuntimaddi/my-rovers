/* The single link between the app and the rover: connect flow, 30 Hz drive loop,
   ping/latency, watchdog + auto-reconnect, telemetry history and the event log. */
import { createStore } from '../state/store';
import { settings } from '../state/settings';
import { input, toast } from '../state/ui';
import { haptic } from '../lib/native';
import { bus } from '../state/bus';
import { endTrip, logEvent, startTrip, updateTrip, type LogCat } from '../state/logs';
import { APP_VERSION, EMPTY_TEL, type AppMsg, type DriveMode, type LinkKind, type LinkStatus, type RoverEvent, type RoverInfo, type RoverMsg, type Telemetry } from './protocol';
import { openDemo, openHttp, openWs, probeRover, type Transport, type TransportHooks } from './transports';

export type StepId = 'wifi' | 'reach' | 'handshake';
export type StepState = 'pending' | 'active' | 'ok' | 'fail';

type Tone = 'neutral' | 'good' | 'warn' | 'bad';
export interface Sample { t: number; v: number | null; a: number | null; pct: number | null; rssi: number | null; lat: number | null }

export interface RoverState {
  status: LinkStatus;
  kind: LinkKind | null;
  info: RoverInfo | null;
  tel: Telemetry;
  latency: number | null;
  steps: Record<StepId, StepState>;
  error: string | null;
  history: Sample[];
}

const initial: RoverState = {
  status: 'idle', kind: null, info: null, tel: EMPTY_TEL, latency: null,
  steps: { wifi: 'pending', reach: 'pending', handshake: 'pending' }, error: null, history: [],
};

export const rover = createStore<RoverState>(initial);

let transport: Transport | null = null;
let seq = 0;
let lastRx = 0;
let driveTimer: ReturnType<typeof setInterval> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let driving = false;
let sampleCount = 0;
let firstPct: number | null = null;
let attempt = 0;          // bumps on every connect/disconnect so stale async work is ignored

function log(text: string, tone: Tone = 'neutral', withToast = false, cat: LogCat = 'link') {
  logEvent(cat, text, tone);
  if (withToast) toast(text, tone);
}

const EVENT_TEXT: Record<RoverEvent, [string, Tone]> = {
  armed: ['Ignition on: motors armed', 'good'],
  disarmed: ['Ignition off', 'neutral'],
  estop: ['Emergency stop', 'bad'],
  failsafe: ['Failsafe: rover stopped (no signal)', 'warn'],
  lowbat: ['Battery low', 'warn'],
  cutoff: ['Battery critical: motors cut', 'bad'],
  stall: ['Motor stall: drive cut. Release the throttle', 'bad'],
};

const hooks: TransportHooks = {
  onMessage(m: RoverMsg) {
    lastRx = performance.now();
    switch (m.t) {
      case 'tel': { const { t: _t, ...tel } = m; void _t; rover.set({ tel }); return; }
      case 'info': { const { t: _t, ...info } = m; void _t; rover.set({ info }); return; }
      case 'pong': {
        const rtt = Math.max(1, Math.round(performance.now() - m.ts));
        rover.set((s) => ({ latency: s.latency == null ? rtt : Math.round(s.latency * 0.6 + rtt * 0.4) }));
        return;
      }
      case 'evt': {
        const [base, tone] = EVENT_TEXT[m.e];
        const text = m.e === 'cutoff' && rover.get().kind === 'demo' ? 'Demo battery flat: reconnect the demo to recharge' : base;
        const loud = m.e !== 'armed' && m.e !== 'disarmed';
        log(text, tone, loud, 'drive');
        bus.emit('rover', { e: m.e });
        if (m.e === 'estop' || m.e === 'cutoff' || m.e === 'failsafe' || m.e === 'disarmed') cruiseOff();
        if (m.e === 'estop') updateTrip((t) => ({ estops: t.estops + 1 }));
        if (m.e === 'estop' || m.e === 'cutoff') haptic('error');
        else if (m.e === 'failsafe' || m.e === 'lowbat' || m.e === 'stall') haptic('warning');
        return;
      }
    }
  },
  onClose(reason) { if (rover.get().status === 'connected') lost(reason); },
};

function send(m: AppMsg) { transport?.send(m); }

/* ── cruise control ────────────────────────────────────────────────
   Locks the throttle at the value you were driving with; steering stays free.
   Released by any new throttle input, Stop, ignition off, a mission, or link loss. */
export const cruise = createStore<{ on: boolean; thr: number }>({ on: false, thr: 0 });
let cruiseWaitRelease = false;
let lastUserThr = 0, lastUserAt = 0;
function cruiseOff(why?: string) {
  if (!cruise.get().on) return;
  cruise.set({ on: false, thr: 0 });
  if (why) toast(`Cruise off · ${why}`, 'neutral', 1600);
}

/** Things that may hold the rover still (e.g. a trial countdown). */
const holds = new Set<() => boolean>();
bus.on('mission:start', () => cruiseOff('mission'));
export function addDriveHold(fn: () => boolean) { holds.add(fn); return () => { holds.delete(fn); }; }

function driveOut(): { thr: number; str: number } {
  let { thr, str } = input.get();
  const now = performance.now();
  if (Math.abs(thr) > 5) { lastUserThr = thr; lastUserAt = now; }
  const c = cruise.get();
  if (c.on) {
    if (cruiseWaitRelease) { if (Math.abs(thr) < 3) cruiseWaitRelease = false; thr = c.thr; }
    else if (Math.abs(thr) > 5) cruiseOff('throttle');
    else thr = c.thr;
  }
  for (const h of holds) if (h()) return { thr: 0, str: 0 };
  return { thr, str };
}

function pushConfig() {
  const s = settings.get();
  send({ t: 'cfg', deadzone: s.deadzone, expo: s.expo, invertThr: s.invertThr, invertStr: s.invertStr, maxPct: s.maxPower, stallA: s.stallA });
  send({ t: 'trim', str: s.trim });
}
settings.subscribe(() => { if (rover.get().status === 'connected') pushConfig(); });

function startLoops() {
  stopLoops();
  driveTimer = setInterval(() => {
    if (rover.get().status !== 'connected') return;   // stream always (keeps the rover's failsafe fed); sticks are 0 when idle
    const { thr, str } = driveOut();
    send({ t: 'drive', thr: Math.round(thr), str: Math.round(str), seq: seq++ });
  }, 33);
  pingTimer = setInterval(() => {
    send({ t: 'ping', ts: performance.now() });
    const s = rover.get();
    if (s.status === 'connected' && s.kind === 'ws' && performance.now() - lastRx > 2500) lost('no data from rover');
  }, 1000);
  sampleTimer = setInterval(() => {
    const { tel, latency } = rover.get();
    rover.set((s) => ({ history: [...s.history, { t: Date.now(), v: tel.vbat, a: tel.amps, pct: tel.pct, rssi: tel.rssi, lat: latency }].slice(-600) }));
    if (++sampleCount % 10 === 0) logEvent('telemetry', `Battery ${tel.pct ?? '—'}% · ${tel.vbat?.toFixed(2) ?? '—'} V · ${tel.amps?.toFixed(2) ?? '—'} A · signal ${tel.rssi ?? '—'} dBm · ${latency ?? '—'} ms`, 'neutral', { vbat: tel.vbat, amps: tel.amps, mah: tel.mah, pct: tel.pct, rssi: tel.rssi, latency });
    if (tel.armed) updateTrip((t) => ({ seconds: t.seconds + 1, batteryUsed: firstPct != null && tel.pct != null ? Math.max(0, firstPct - tel.pct) : t.batteryUsed }));
    if (firstPct == null && tel.pct != null) firstPct = tel.pct;
  }, 1000);
}
function stopLoops() {
  for (const t of [driveTimer, pingTimer, sampleTimer]) if (t) clearInterval(t);
  driveTimer = pingTimer = sampleTimer = null;
}

async function openReal(host: string): Promise<{ t: Transport; kind: LinkKind }> {
  try { return { t: await openWs(host, hooks), kind: 'ws' }; }
  catch { return { t: openHttp(host, hooks), kind: 'http' }; }
}

function begin(t: Transport, kind: LinkKind) {
  transport = t;
  lastRx = performance.now();
  rover.set({ status: 'connected', kind, error: null, latency: null });
  bus.emit('connected', { kind });
  if (!rover.get().history.length) { firstPct = null; startTrip(kind); }
  send({ t: 'hello', app: 'RC-Rovers', ver: APP_VERSION });
  pushConfig();
  send({ t: 'mode', m: settings.get().defaultMode });
  startLoops();
}

const step = (id: StepId, st: StepState) => rover.set((s) => ({ steps: { ...s.steps, [id]: st } }));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Connect flow shown in the Connect sheet. Resolves true when connected. */
export async function connect(demo = false): Promise<boolean> {
  disconnect(true);
  const my = ++attempt;
  rover.set({ ...initial, status: 'connecting', steps: { wifi: 'active', reach: 'pending', handshake: 'pending' } });

  if (demo) {
    await wait(260); if (my !== attempt) return false; step('wifi', 'ok'); step('reach', 'active');
    await wait(320); if (my !== attempt) return false; step('reach', 'ok'); step('handshake', 'active');
    await wait(300); if (my !== attempt) return false; step('handshake', 'ok');
    begin(openDemo(hooks), 'demo');
    log('Connected to demo rover', 'good');
    return true;
  }

  const host = settings.get().host.trim() || '192.168.4.1';
  await wait(200);
  if (my !== attempt) return false;
  step('wifi', 'ok'); step('reach', 'active');
  if (!(await probeRover(host, 2500))) {
    if (my !== attempt) return false;
    step('reach', 'fail');
    rover.set({ status: 'idle', error: `Can't reach the rover at ${host}. Join the MARK1_ROVER Wi-Fi and try again.` });
    return false;
  }
  if (my !== attempt) return false;
  step('reach', 'ok'); step('handshake', 'active');
  const { t, kind } = await openReal(host);
  if (my !== attempt) { t.close(); return false; }
  step('handshake', 'ok');
  begin(t, kind);
  log(kind === 'ws' ? `Connected to rover at ${host}` : 'Connected in basic mode (Firmware V1)', 'good');
  return true;
}

function lost(reason: string) {
  cruiseOff();
  stopLoops();
  transport?.close(); transport = null;
  rover.set((s) => ({ status: 'lost', tel: { ...s.tel, armed: false, thr: 0, str: 0 }, latency: null }));
  log(`Connection lost (${reason})`, 'bad', true);
  bus.emit('lost', { reason });
  haptic('error');
  const my = attempt;
  const kind = rover.get().kind;
  const retry = async () => {
    if (my !== attempt || rover.get().status !== 'lost') return;
    const host = settings.get().host.trim() || '192.168.4.1';
    try {
      if (!(await probeRover(host, 1500))) throw new Error('not reachable');
      const r = kind === 'http' ? { t: openHttp(host, hooks), kind: 'http' as const } : await openReal(host);
      if (my !== attempt || rover.get().status !== 'lost') { r.t.close(); return; }
      begin(r.t, r.kind);
      log('Reconnected', 'good', true);
      haptic('success');
    } catch {
      reconnectTimer = setTimeout(retry, 1500);
    }
  };
  reconnectTimer = setTimeout(retry, 800);
}

export function disconnect(silent = false) {
  attempt++;
  cruiseOff();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  stopLoops();
  if (transport) { transport.send({ t: 'disarm' }); transport.close(); transport = null; }
  const was = rover.get().status;
  rover.set({ status: 'idle', kind: null, info: null, tel: EMPTY_TEL, latency: null, error: null, history: [] });
  if (was !== 'idle') { endTrip(); bus.emit('disconnected', { reason: silent ? 'replaced' : 'user' }); }
  if (!silent && was !== 'idle') log('Disconnected');
}

export function cancelConnect() {
  if (rover.get().status === 'connecting') { attempt++; rover.set({ status: 'idle', error: null }); }
}

export const control = {
  /** Leaving the cockpit zeroes the sticks; missions and Nova keep working from any tab. */
  setDriving(on: boolean) {
    driving = on;
    if (!on) input.set({ thr: 0, str: 0 });
  },
  get inCockpit() { return driving; },
  arm() { send({ t: 'arm' }); },
  cruiseOff,
  disarm() { cruiseOff(); send({ t: 'disarm' }); },
  estop() { cruiseOff(); input.set({ thr: 0, str: 0 }); send({ t: 'estop' }); },
  /** Toggle cruise control at the current (or just-released) throttle. */
  cruise() {
    if (cruise.get().on) { cruiseOff('tapped'); haptic('light'); return; }
    const r = rover.get();
    if (r.status !== 'connected' || !r.tel.armed) { toast('Start the ignition first', 'warn', 1800); return; }
    const cur = input.get().thr;
    const v = Math.abs(cur) > 5 ? cur : performance.now() - lastUserAt < 1500 ? lastUserThr : 0;
    if (!v) { toast('Drive first, then tap Cruise to hold that speed', 'neutral', 2200); return; }
    cruiseWaitRelease = Math.abs(cur) > 3;
    cruise.set({ on: true, thr: Math.round(v) });
    toast(`Cruise ${v > 0 ? 'forward' : 'reverse'} · ${Math.abs(Math.round(v))}%`, 'good', 1800);
    haptic('medium');
    bus.emit('cruise', { thr: Math.round(v) });
  },
  mode(m: DriveMode) {
    if (rover.get().tel.mode === m) return;
    send({ t: 'mode', m }); rover.set((s) => ({ tel: { ...s.tel, mode: m } }));
    logEvent('drive', `Mode → ${m}`); bus.emit('mode', { m });
  },
};
