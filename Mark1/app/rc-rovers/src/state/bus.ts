/* App-wide event bus: lets logs, the academy and the co-pilot observe what happens
   without the controller knowing about them. */
import type { DriveMode, LinkKind, RoverEvent } from '../rover/protocol';

export interface BusEvents {
  connected: { kind: LinkKind };
  disconnected: { reason: string };
  lost: { reason: string };
  rover: { e: RoverEvent };
  mode: { m: DriveMode };
  voice: { text: string };
  command: { text: string; source: 'typed' | 'voice' };
  'mission:start': { name: string };
  'mission:end': { name: string; completed: boolean; reason?: string };
  'mission:saved': { name: string; recorded: boolean };
  achievement: { id: string; title: string };
  bump: { x: number; y: number };
  cruise: { thr: number };
  snapshot: { name: string };
  clip: { name: string; seconds: number };
  'trial:end': { course: string; ms: number; bumps: number; best: boolean };
}

type Handler<K extends keyof BusEvents> = (p: BusEvents[K]) => void;
const handlers: { [K in keyof BusEvents]?: Set<Handler<K>> } = {};

export const bus = {
  on<K extends keyof BusEvents>(type: K, fn: Handler<K>) {
    ((handlers[type] ??= new Set() as never) as Set<Handler<K>>).add(fn);
    return () => { (handlers[type] as Set<Handler<K>> | undefined)?.delete(fn); };
  },
  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]) {
    (handlers[type] as Set<Handler<K>> | undefined)?.forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
  },
};
