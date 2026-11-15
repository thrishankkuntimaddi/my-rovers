/* Structured, persisted logs + trip records, with JSON / CSV export. */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { createStore } from './store';

export type LogCat = 'system' | 'link' | 'drive' | 'voice' | 'nova' | 'mission' | 'academy' | 'telemetry' | 'media';
export type LogTone = 'neutral' | 'good' | 'warn' | 'bad';
export interface LogItem { id: number; at: number; cat: LogCat; text: string; tone: LogTone; data?: Record<string, unknown> }

export interface Trip {
  id: number; start: number; end: number | null; kind: string;
  seconds: number; distance: number; maxSpeed: number; batteryUsed: number | null;
  commands: number; missions: number; estops: number;
}

export const LOG_CATS: { id: LogCat; label: string }[] = [
  { id: 'link', label: 'Link' }, { id: 'drive', label: 'Drive' }, { id: 'voice', label: 'Voice' },
  { id: 'nova', label: 'Nova' }, { id: 'mission', label: 'Missions' }, { id: 'academy', label: 'Academy' },
  { id: 'telemetry', label: 'Telemetry' }, { id: 'media', label: 'Media' }, { id: 'system', label: 'System' },
];

const LOG_KEY = 'rcr-logs';
const TRIP_KEY = 'rcr-trips';
const MAX = 1500;

function load<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); if (raw) return JSON.parse(raw) as T; } catch { /* ignore */ }
  return fallback;
}

export const logs = createStore<{ items: LogItem[] }>({ items: load<LogItem[]>(LOG_KEY, []) });
export const trips = createStore<{ list: Trip[]; current: Trip | null }>({ list: load<Trip[]>(TRIP_KEY, []), current: null });

let nextId = (logs.get().items[0]?.id ?? 0) + 1;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { localStorage.setItem(LOG_KEY, JSON.stringify(logs.get().items.slice(0, 600))); } catch { /* full */ }
  }, 1500);
}

export function logEvent(cat: LogCat, text: string, tone: LogTone = 'neutral', data?: Record<string, unknown>) {
  const item: LogItem = { id: nextId++, at: Date.now(), cat, text, tone, ...(data ? { data } : {}) };
  logs.set((s) => ({ items: [item, ...s.items].slice(0, MAX) }));
  persist();
}

export function clearLogs() {
  logs.set({ items: [] });
  try { localStorage.removeItem(LOG_KEY); } catch { /* ignore */ }
}

/* ── trips ─────────────────────────────────────────────────────── */
export function startTrip(kind: string) {
  trips.set({ current: { id: Date.now(), start: Date.now(), end: null, kind, seconds: 0, distance: 0, maxSpeed: 0, batteryUsed: null, commands: 0, missions: 0, estops: 0 } });
}
export function updateTrip(patch: Partial<Trip> | ((t: Trip) => Partial<Trip>)) {
  const cur = trips.get().current;
  if (!cur) return;
  trips.set({ current: { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) } });
}
export function endTrip() {
  const cur = trips.get().current;
  if (!cur) return;
  const done = { ...cur, end: Date.now() };
  const list = done.seconds >= 3 ? [done, ...trips.get().list].slice(0, 60) : trips.get().list;
  trips.set({ list, current: null });
  try { localStorage.setItem(TRIP_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}
export function clearTrips() {
  trips.set({ list: [] });
  try { localStorage.removeItem(TRIP_KEY); } catch { /* ignore */ }
}

/* ── export ────────────────────────────────────────────────────── */
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function logsAsText(format: 'json' | 'csv'): string {
  const items = logs.get().items;
  if (format === 'json') return JSON.stringify({ app: 'RC-Rovers', exported: new Date().toISOString(), logs: items, trips: trips.get().list }, null, 2);
  const rows = [['time', 'category', 'tone', 'message', 'data']];
  for (const l of items) rows.push([new Date(l.at).toISOString(), l.cat, l.tone, l.text, l.data ? JSON.stringify(l.data) : '']);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

export async function exportLogs(format: 'json' | 'csv'): Promise<string> {
  const text = logsAsText(format);
  const name = `rc-rovers-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${format}`;
  if (Capacitor.isNativePlatform()) {
    const res = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: 'RC-Rovers logs', files: [res.uri], dialogTitle: 'Share logs' });
    return name;
  }
  const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}
