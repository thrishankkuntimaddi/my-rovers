/* Android back button (and Escape on keyboards): closes the top-most thing that is open —
   a sheet, the menu, the focus view, then the cockpit. Anything that can be closed
   registers a handler while it is open; the most recent one runs first. */
import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import { isNative } from './native';

const stack: { fn: () => void }[] = [];

function back(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.fn();
  return true;
}

if (isNative) {
  App.addListener('backButton', () => { if (!back()) App.minimizeApp().catch(() => {}); }).catch(() => {});
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
    if (back()) e.preventDefault();
  });
}

/** While `active`, the back button / Escape calls `fn` (the latest registration wins). */
export function useBack(active: boolean, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const entry = { fn: () => ref.current() };
    stack.push(entry);
    return () => { const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1); };
  }, [active]);
}
