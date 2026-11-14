/* The single link between the app and the rover: connect flow, 30 Hz drive loop,
   ping/latency, watchdog + auto-reconnect, telemetry history and the event log. */
import { createStore } from '../state/store';
import { settings } from '../state/settings';
import { input, toast } from '../state/ui';
import { haptic } from '../lib/native';
import { APP_VERSION, EMPTY_TEL, type AppMsg, type DriveMode, type LinkKind, type LinkStatus, type RoverEvent, type RoverInfo, type RoverMsg, type Telemetry } from './protocol';
import { openDemo, openHttp, openWs, probeRover, type Transport, type TransportHooks } from './transports';

export type StepId = 'wifi' | 'reach' | 'handshake';
export type StepState = 'pending' | 'active' | 'ok' | 'fail';

export interface LogEntry { id: number; at: number; text: string; tone: 'neutral' | 'good' | 'warn' | 'bad' }
export interface Sample { t: number; v: number | null; pct: number | null; rssi: number | null; lat: number | null }

export interface RoverState {
  status: LinkStatus;
  kind: LinkKind | null;
  info: RoverInfo | null;
  tel: Telemetry;
  latency: number | null;
  steps: Record<StepId, StepState>;
  error: string | null;
  log: LogEntry[];
  history: Sample[];
}

const initial: RoverState = {
  status: 'idle', kind: null, info: null, tel: EMPTY_TEL, latency: null,
  steps: { wifi: 'pending', reach: 'pending', handshake: 'pending' }, error: null, log: [], history: [],
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
let logId = 1;
let attempt = 0;          // bumps on every connect/disconnect so stale async work is ignored

function log(text: string, tone: LogEntry['tone'] = 'neutral', withToast = false) {
  rover.set((s) => ({ log: [{ id: logId++, at: Date.now(), text, tone }, ...s.log].slice(0, 120) }));
  if (withToast) toast(text, tone);
}

const EVENT_TEXT: Record<RoverEvent, [string, LogEntry['tone']]> = {
  armed: ['Ignition on: motors armed', 'good'],
  disarmed: ['Ignition off', 'neutral'],
  estop: ['Emergency stop', 'bad'],
  failsafe: ['Failsafe: rover stopped (no signal)', 'warn'],
  lowbat: ['Battery low', 'warn'],
  cutoff: ['Battery critical: motors cut', 'bad'],
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
        const [text, tone] = EVENT_TEXT[m.e];
        const loud = m.e !== 'armed' && m.e !== 'disarmed';
        log(text, tone, loud);
        if (m.e === 'estop' || m.e === 'cutoff') haptic('error');
        else if (m.e === 'failsafe' || m.e === 'lowbat') haptic('warning');
        return;
      }
    }
  },
  onClose(reason) { if (rover.get().status === 'connected') lost(reason); },
};

function send(m: AppMsg) { transport?.send(m); }

function pushConfig() {
  const s = settings.get();
  send({ t: 'cfg', deadzone: s.deadzone, expo: s.expo, invertThr: s.invertThr, invertStr: s.invertStr, maxPct: s.maxPower });
  send({ t: 'trim', str: s.trim });
}
settings.subscribe(() => { if (rover.get().status === 'connected') pushConfig(); });

function startLoops() {
  stopLoops();
  driveTimer = setInterval(() => {
    if (!driving || rover.get().status !== 'connected') return;
    const { thr, str } = input.get();
    send({ t: 'drive', thr: Math.round(thr), str: Math.round(str), seq: seq++ });
  }, 33);
  pingTimer = setInterval(() => {
    send({ t: 'ping', ts: performance.now() });
    const s = rover.get();
    if (s.status === 'connected' && s.kind === 'ws' && performance.now() - lastRx > 2500) lost('no data from rover');
  }, 1000);
  sampleTimer = setInterval(() => {
    const { tel, latency } = rover.get();
    rover.set((s) => ({ history: [...s.history, { t: Date.now(), v: tel.vbat, pct: tel.pct, rssi: tel.rssi, lat: latency }].slice(-600) }));
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
  rover.set({ ...initial, status: 'connecting', log: rover.get().log, steps: { wifi: 'active', reach: 'pending', handshake: 'pending' } });

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
  stopLoops();
  transport?.close(); transport = null;
  rover.set((s) => ({ status: 'lost', tel: { ...s.tel, armed: false, thr: 0, str: 0 }, latency: null }));
  log(`Connection lost (${reason})`, 'bad', true);
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
  if (reconnectTimer) clearTimeout(reconnectTimer);
  stopLoops();
  if (transport) { transport.send({ t: 'disarm' }); transport.close(); transport = null; }
  const was = rover.get().status;
  rover.set({ status: 'idle', kind: null, info: null, tel: EMPTY_TEL, latency: null, error: null, history: [] });
  if (!silent && was !== 'idle') log('Disconnected');
}

export function cancelConnect() {
  if (rover.get().status === 'connecting') { attempt++; rover.set({ status: 'idle', error: null }); }
}

export const control = {
  setDriving(on: boolean) {
    driving = on;
    if (!on) { input.set({ thr: 0, str: 0 }); send({ t: 'disarm' }); }
  },
  arm() { send({ t: 'arm' }); },
  disarm() { send({ t: 'disarm' }); },
  estop() { input.set({ thr: 0, str: 0 }); send({ t: 'estop' }); },
  mode(m: DriveMode) { send({ t: 'mode', m }); rover.set((s) => ({ tel: { ...s.tel, mode: m } })); },
};
