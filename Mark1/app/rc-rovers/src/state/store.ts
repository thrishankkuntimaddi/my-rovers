import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(fn: () => void): () => void;
}

/** Tiny external store. `batched` coalesces notifications to one per animation frame. */
export function createStore<T extends object>(initial: T, opts: { batched?: boolean } = {}): Store<T> {
  let state = initial;
  const subs = new Set<() => void>();
  let queued = false;
  const notify = () => subs.forEach((f) => f());
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      if (!opts.batched) return notify();
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; notify(); });
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Subscribe to one derived value. The component re-renders only when that value changes
    (compare with Object.is), so return primitives or stable references. */
export function useSel<T extends object, R>(store: Store<T>, sel: (s: T) => R): R {
  const get = () => sel(store.get());
  return useSyncExternalStore(store.subscribe, get, get);
}
