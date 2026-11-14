import { createStore } from './store';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad';
export interface Toast { id: number; text: string; tone: Tone }

export const toasts = createStore<{ list: Toast[] }>({ list: [] });
let nextId = 1;
export function toast(text: string, tone: Tone = 'neutral', ms = 2600) {
  const id = nextId++;
  toasts.set((s) => ({ list: [...s.list.filter((t) => t.text !== text), { id, text, tone }].slice(-3) }));
  setTimeout(() => toasts.set((s) => ({ list: s.list.filter((t) => t.id !== id) })), ms);
}

/** Live stick input, written by the controls at pointer rate; read by the 30 Hz send loop. */
export const input = createStore<{ thr: number; str: number }>({ thr: 0, str: 0 }, { batched: true });
