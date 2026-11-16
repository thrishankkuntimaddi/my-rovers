/* RC-Rovers ⇄ rover protocol — mirrors Mark1/docs/control-protocol.md */

export type DriveMode = 'crawl' | 'cruise' | 'sport' | 'full';

export interface ModeSpec { id: DriveMode; label: string; cap: number; rampMs: number }

export const MODES: ModeSpec[] = [
  { id: 'crawl', label: 'Crawl', cap: 25, rampMs: 600 },
  { id: 'cruise', label: 'Normal', cap: 50, rampMs: 400 },   // id stays 'cruise' (protocol); shown as Normal so it isn't confused with speed hold
  { id: 'sport', label: 'Sport', cap: 75, rampMs: 250 },
  { id: 'full', label: 'Full', cap: 100, rampMs: 150 },
];
export const modeSpec = (m: DriveMode) => MODES.find((x) => x.id === m) ?? MODES[1];

/** How the app is talking to the rover. */
export type LinkKind = 'ws' | 'http' | 'demo';
export type LinkStatus = 'idle' | 'connecting' | 'connected' | 'lost';

export interface RoverInfo { name: string; model: string; fw: string; caps: string[] }

export interface Telemetry {
  armed: boolean;
  mode: DriveMode;
  thr: number;          // actual output after ramping, −100…100
  str: number;          // actual steering output, −100…100
  vbat: number | null;  // volts
  pct: number | null;   // battery %
  rssi: number | null;  // dBm
  up: number;           // seconds
  estMin: number | null;
  warn: string[];
}

export interface DriveCfg {
  deadzone: number;     // %
  expo: number;         // 0…100
  invertThr: boolean;
  invertStr: boolean;
  maxPct: number;       // %
}

/* App → Rover */
export type AppMsg =
  | { t: 'hello'; app: string; ver: string }
  | { t: 'drive'; thr: number; str: number; seq: number }
  | { t: 'arm' }
  | { t: 'disarm' }
  | { t: 'estop' }
  | { t: 'mode'; m: DriveMode }
  | { t: 'trim'; str: number }
  | ({ t: 'cfg' } & DriveCfg)
  | { t: 'ping'; ts: number };

/* Rover → App */
export type RoverEvent = 'failsafe' | 'lowbat' | 'cutoff' | 'estop' | 'armed' | 'disarmed';
export type RoverMsg =
  | ({ t: 'info' } & RoverInfo)
  | ({ t: 'tel' } & Telemetry)
  | { t: 'pong'; ts: number }
  | { t: 'evt'; e: RoverEvent };

export const DEFAULT_HOST = '192.168.4.1';
export const APP_VERSION = '2.3.0';

export const EMPTY_TEL: Telemetry = {
  armed: false, mode: 'cruise', thr: 0, str: 0, vbat: null, pct: null, rssi: null, up: 0, estMin: null, warn: [],
};

/** Li-ion % from per-cell voltage (lookup table from the protocol doc). */
const CELL_TABLE: [number, number][] = [
  [4.2, 100], [4.05, 85], [3.9, 70], [3.8, 55], [3.7, 40], [3.6, 25], [3.5, 10], [3.3, 0],
];
export function cellPct(v: number): number {
  if (v >= CELL_TABLE[0][0]) return 100;
  for (let i = 1; i < CELL_TABLE.length; i++) {
    const [v1, p1] = CELL_TABLE[i - 1];
    const [v2, p2] = CELL_TABLE[i];
    if (v >= v2) return p2 + ((v - v2) / (v1 - v2)) * (p1 - p2);
  }
  return 0;
}

/** Inverse of cellPct: per-cell voltage for a given %. */
export function cellV(pct: number): number {
  const p = Math.max(0, Math.min(100, pct));
  for (let i = 1; i < CELL_TABLE.length; i++) {
    const [v1, p1] = CELL_TABLE[i - 1];
    const [v2, p2] = CELL_TABLE[i];
    if (p >= p2) return v2 + ((p - p2) / (p1 - p2)) * (v1 - v2);
  }
  return CELL_TABLE[CELL_TABLE.length - 1][0];
}

/** Deadzone + expo + invert + cap, shared by the simulator (real firmware does the same). */
export function shape(v: number, cfg: DriveCfg, invert: boolean): number {
  let x = Math.max(-100, Math.min(100, v)) / 100;
  if (invert) x = -x;
  const s = Math.sign(x);
  let a = Math.abs(x);
  const dz = cfg.deadzone / 100;
  a = a < dz ? 0 : (a - dz) / (1 - dz);
  const e = cfg.expo / 100;
  a = e * a * a * a + (1 - e) * a;
  return s * a * cfg.maxPct;
}
