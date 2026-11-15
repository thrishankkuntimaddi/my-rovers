/* Three ways to reach a rover. Each speaks the same protocol to the controller:
   - WsTransport:   real rover, firmware with WebSocket (Phase 3+)
   - HttpTransport: real rover, Firmware V1 (Phase 1) — discrete /api/cmd commands
   - DemoTransport: simulated rover in the app (no hardware)                        */
import { cellV, modeSpec, shape, EMPTY_TEL, type AppMsg, type DriveCfg, type DriveMode, type RoverMsg, type Telemetry } from './protocol';

export interface Transport {
  send(msg: AppMsg): void;
  close(): void;
}
export interface TransportHooks {
  onMessage(msg: RoverMsg): void;
  onClose(reason: string): void;
}

export async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** True only if the reply is from a My Rovers rover (not, say, a home router on the same IP). */
export async function probeRover(host: string, timeoutMs: number): Promise<boolean> {
  try {
    const j = (await fetchJson(`http://${host}/api/status`, timeoutMs)) as { device?: unknown };
    return typeof j?.device === 'string' && /^MARK\d+$/i.test(j.device);
  } catch { return false; }
}

/* ── WebSocket ─────────────────────────────────────────────────── */
export function openWs(host: string, hooks: TransportHooks, timeoutMs = 1500): Promise<Transport> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try { ws = new WebSocket(`ws://${host}/ws`); } catch (e) { reject(e); return; }
    let opened = false;
    const timer = setTimeout(() => { if (!opened) { ws.close(); reject(new Error('timeout')); } }, timeoutMs);
    ws.onopen = () => {
      opened = true; clearTimeout(timer);
      resolve({
        send: (m) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
        close: () => { ws.onclose = null; ws.close(); },
      });
    };
    ws.onmessage = (ev) => {
      try { hooks.onMessage(JSON.parse(String(ev.data)) as RoverMsg); } catch { /* ignore malformed */ }
    };
    ws.onerror = () => { if (!opened) { clearTimeout(timer); reject(new Error('ws error')); } };
    ws.onclose = () => { if (opened) hooks.onClose('socket closed'); };
  });
}

/* ── HTTP (Firmware V1 basic mode) ─────────────────────────────── */
type Move = 'forward' | 'backward' | 'left' | 'right' | 'stop';

export function openHttp(host: string, hooks: TransportHooks): Transport {
  const base = `http://${host}`;
  const tel: Telemetry = { ...EMPTY_TEL };
  const started = performance.now();
  let lastSent: Move = 'stop';
  let inFlight = false;
  let pending: Move | null = null;
  let closed = false;
  let misses = 0;

  const post = (move: Move) => {
    if (inFlight) { pending = move; return; }
    inFlight = true;
    fetchJson(`${base}/api/cmd?move=${move}`, 1200)
      .catch(() => {})
      .finally(() => {
        inFlight = false;
        if (pending && pending !== move) { const p = pending; pending = null; post(p); } else pending = null;
      });
  };
  const command = (move: Move) => { if (move !== lastSent) { lastSent = move; post(move); } };

  const emitTel = () => hooks.onMessage({ t: 'tel', ...tel, up: Math.round((performance.now() - started) / 1000) });
  const telTimer = setInterval(emitTel, 200);

  // liveness: poll /api/status, answer pings with real round-trip time
  const poll = setInterval(async () => {
    if (await probeRover(host, 1500)) misses = 0;
    else { if (++misses >= 3 && !closed) { closed = true; cleanup(); hooks.onClose('rover not responding'); } }
  }, 1000);
  const cleanup = () => { clearInterval(telTimer); clearInterval(poll); };

  setTimeout(() => hooks.onMessage({ t: 'info', name: 'MARK 1', model: 'mark1', fw: '1.0 (basic)', caps: ['drive', 'steer'] }), 0);

  return {
    send(m) {
      if (closed) return;
      switch (m.t) {
        case 'drive': {
          tel.thr = m.thr; tel.str = m.str;
          if (!tel.armed) return command('stop');
          const at = Math.abs(m.thr), as = Math.abs(m.str);
          if (at < 20 && as < 20) return command('stop');
          return command(at >= as ? (m.thr > 0 ? 'forward' : 'backward') : (m.str > 0 ? 'right' : 'left'));
        }
        case 'arm': tel.armed = true; hooks.onMessage({ t: 'evt', e: 'armed' }); return;
        case 'disarm': tel.armed = false; command('stop'); hooks.onMessage({ t: 'evt', e: 'disarmed' }); return;
        case 'estop': tel.armed = false; lastSent = 'forward'; command('stop'); hooks.onMessage({ t: 'evt', e: 'estop' }); return;
        case 'mode': tel.mode = m.m; return;
        case 'ping': {
          const t0 = performance.now();
          fetchJson(`${base}/api/status`, 1500).then(() => hooks.onMessage({ t: 'pong', ts: m.ts - (performance.now() - t0) / 2 })).catch(() => {});
          return;
        }
        default: return;
      }
    },
    close() { closed = true; cleanup(); post('stop'); },
  };
}

/* ── Demo rover (simulator) ────────────────────────────────────── */
export function openDemo(hooks: TransportHooks): Transport {
  const CELLS = 3;
  let armed = false;
  let mode: DriveMode = 'cruise';
  let cfg: DriveCfg = { deadzone: 5, expo: 30, invertThr: false, invertStr: false, maxPct: 100 };
  let trim = 0;
  let tgtThr = 0, tgtStr = 0, outThr = 0, outStr = 0;
  let lastDrive = performance.now();
  let failsafe = false;
  /* Battery model: state of charge drains with load. Tuned so a full demo pack gives
     about 5 minutes of real driving (≈20 %/min at half load), a little longer when
     gentle, a little shorter flat-out. Voltage follows the Li-ion curve and sags under load. */
  let soc = 1;                   // 0…1
  let rssi = -46;
  let rateEma = 0.2;             // fraction per minute, smoothed
  let lowWarned = false;
  let cutoff = false;
  const t0 = performance.now();
  let last = t0;
  let telTick = 0;

  const emit = (m: RoverMsg) => hooks.onMessage(m);
  const disarm = (e: 'disarmed' | 'estop' | 'cutoff') => { armed = false; tgtThr = 0; emit({ t: 'evt', e }); };

  const loop = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(100, now - last); last = now;
    const silent = now - lastDrive;

    // failsafe: 300 ms → stop, 2 s → disarm
    if (silent > 300 && !failsafe && armed) { failsafe = true; emit({ t: 'evt', e: 'failsafe' }); }
    if (silent > 2000 && armed) disarm('disarmed');

    const spec = modeSpec(cutoff ? 'crawl' : mode);
    const wantThr = armed && !failsafe ? (shape(tgtThr, cfg, cfg.invertThr) * spec.cap) / 100 : 0;
    const wantStr = armed && !failsafe ? Math.max(-100, Math.min(100, shape(tgtStr, cfg, cfg.invertStr) + trim)) : 0;
    // direction change passes through zero
    const target = Math.sign(wantThr) !== Math.sign(outThr) && Math.abs(outThr) > 0.5 ? 0 : wantThr;
    const step = (100 / spec.rampMs) * dt;
    outThr += Math.max(-step, Math.min(step, target - outThr));
    outStr += Math.max(-dt * 0.9, Math.min(dt * 0.9, wantStr - outStr));

    // battery
    const load = Math.abs(outThr) / 100;
    const rate = armed ? 0.02 + load * 0.36 : 0.002;          // fraction per minute
    soc = Math.max(0, soc - (rate * dt) / 60000);
    rateEma += (rate - rateEma) * Math.min(1, dt / 4000);
    const vRest = cellV(soc * 100) * CELLS;
    const vbat = Math.max(9.0, vRest - load * 0.55 - Math.abs(outStr) / 100 * 0.08);
    const pct = Math.round(soc * 100);
    const warn: string[] = [];
    if (pct <= 15) { warn.push('lowbat'); if (!lowWarned) { lowWarned = true; emit({ t: 'evt', e: 'lowbat' }); } }
    if (soc <= 0 && !cutoff) { cutoff = true; if (armed) disarm('cutoff'); }

    rssi += (Math.random() - 0.5) * 1.6 + (-48 - rssi) * 0.02;

    if (++telTick % 5 === 0) {   // 10 Hz telemetry
      emit({
        t: 'tel', armed, mode, thr: Math.round(outThr), str: Math.round(outStr),
        vbat: Math.round(vbat * 100) / 100, pct, rssi: Math.round(rssi),
        up: Math.round((now - t0) / 1000),
        estMin: Math.round((soc / Math.max(armed ? rateEma : 0.2, 0.02)) * 10) / 10,
        warn,
      });
    }
  }, 20);

  setTimeout(() => emit({ t: 'info', name: 'MARK 1', model: 'mark1', fw: '1.0.0-demo', caps: ['drive', 'steer', 'battery'] }), 120);

  return {
    send(m) {
      switch (m.t) {
        case 'drive': tgtThr = m.thr; tgtStr = m.str; lastDrive = performance.now(); failsafe = false; return;
        case 'arm': if (cutoff) emit({ t: 'evt', e: 'cutoff' }); else { armed = true; failsafe = false; lastDrive = performance.now(); emit({ t: 'evt', e: 'armed' }); } return;
        case 'disarm': if (armed) disarm('disarmed'); return;
        case 'estop': outThr = 0; disarm('estop'); return;
        case 'mode': mode = m.m; return;
        case 'trim': trim = m.str; return;
        case 'cfg': { const { t: _t, ...rest } = m; void _t; cfg = rest; return; }
        case 'ping': setTimeout(() => emit({ t: 'pong', ts: m.ts }), 4 + Math.random() * 9); return;
        default: return;
      }
    },
    close() { clearInterval(loop); },
  };
}

export type { Telemetry };
