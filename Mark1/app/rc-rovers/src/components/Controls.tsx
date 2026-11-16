/* Driving controls. They write straight to the `input` store and move their knobs
   via transforms on refs — no React re-render per pointer move, so dragging stays
   at the display's full refresh rate (120 Hz on the Pad 5). */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { settings, type ControlSize } from '../state/settings';
import { input, toast } from '../state/ui';
import { haptic } from '../lib/native';
import { MODES, type DriveMode } from '../rover/protocol';
import { Icon } from './Icon';
import { manualOverride } from '../missions/missions';
import { useSel, useStore } from '../state/store';
import { tilt, calibrateTilt } from '../input/sources';

const clamp = (v: number, lo = -100, hi = 100) => Math.max(lo, Math.min(hi, v));

let lastNag = 0;
function nagIfLocked(armed: boolean) {
  if (armed) return;
  const now = Date.now();
  if (now - lastNag < 3000) return;
  lastNag = now;
  toast('Slide to start the ignition first', 'warn', 1800);
  haptic('warning');
}

/** Tick at centre and at the ends while dragging. */
function useDetents() {
  const zone = useRef(0);
  return (v: number) => {
    const z = Math.abs(v) >= 99 ? Math.sign(v) * 2 : Math.abs(v) < 4 ? 0 : Math.sign(v);
    if (z !== zone.current) { if (z === 0 || Math.abs(z) === 2) haptic('tick'); zone.current = z; }
  };
}

/* ── Floating thumb controls ───────────────────────────────────────
   Touch anywhere in your side of the screen: the control appears under your thumb and
   that spot is "zero". A short push gives full deflection (Settings → Control size), so
   your hands never leave the edges of the tablet. Each zone tracks its own finger, so
   throttle and steering work at the same time (multi-touch). Release = back to zero. */
export const TRAVEL: Record<ControlSize, number> = { s: 54, m: 72, l: 96 };
type ThumbKind = 'thr' | 'str' | 'stick';

export function ThumbZone({ kind, side, armed, steerTilt = false }: { kind: ThumbKind; side: 'left' | 'right'; armed: boolean; steerTilt?: boolean }) {
  const zone = useRef<HTMLDivElement>(null);
  const float = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const fillP = useRef<HTMLDivElement>(null);
  const fillN = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const act = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const travel = TRAVEL[useSel(settings, (s) => s.controlSize)];
  const assist = useSel(settings, (s) => s.straightAssist);
  const detent = useDetents();

  const home = useCallback(() => {
    const z = zone.current;
    if (!z) return { x: 0, y: 0 };
    return { x: z.clientWidth / 2, y: Math.min(z.clientHeight - travel - 28, z.clientHeight * (kind === 'str' ? 0.66 : 0.6)) };
  }, [kind, travel]);

  const show = useCallback((x: number, y: number, dx: number, dy: number, active: boolean) => {
    const f = float.current, k = knob.current;
    if (!f || !k) return;
    f.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    f.classList.toggle('is-active', active);
    k.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    const sc = (n: number) => (kind === 'thr' ? `scaleY(${n})` : `scaleX(${n})`);
    if (kind !== 'stick') {
      const v = kind === 'thr' ? -dy / travel : dx / travel;
      if (fillP.current) fillP.current.style.transform = sc(Math.max(0, v));
      if (fillN.current) fillN.current.style.transform = sc(Math.max(0, -v));
    }
  }, [kind, travel]);

  const rest = useCallback((spring: boolean) => {
    const f = float.current;
    if (!f) return;
    f.classList.toggle('is-spring', spring);
    knob.current?.classList.toggle('is-spring', spring);
    const h = home();
    show(h.x, h.y, 0, 0, false);
    if (readout.current) readout.current.textContent = kind === 'thr' ? 'Throttle' : kind === 'str' ? 'Steer' : 'Drive';
  }, [home, show, kind]);

  /** Map a thumb offset to stick values (and the knob's drawn offset). */
  const compute = (dx: number, dy: number) => {
    if (kind === 'thr') {
      const d = Math.max(-travel, Math.min(travel, dy));
      let v = clamp((-d / travel) * 100);
      if (Math.abs(v) < 4) v = 0;
      return { thr: v, str: undefined, kx: 0, ky: d, label: v === 0 ? 'N' : `${v > 0 ? 'D' : 'R'} ${Math.round(Math.abs(v))}` };
    }
    if (kind === 'str') {
      const d = Math.max(-travel, Math.min(travel, dx));
      let v = clamp((d / travel) * 100);
      if (assist) v = Math.abs(v) < 8 ? 0 : Math.sign(v) * ((Math.abs(v) - 8) / 92) * 100;
      return { thr: undefined, str: v, kx: d, ky: 0, label: v === 0 ? 'Straight' : `${v > 0 ? 'R' : 'L'} ${Math.round(Math.abs(v))}` };
    }
    let x = dx / travel, y = -dy / travel;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    const kx = x * travel, ky = -y * travel;
    if (assist) {
      if (Math.abs(x) < Math.abs(y) * 0.26) x = 0;          // within ~15° of straight ahead / back
      else if (Math.abs(y) < Math.abs(x) * 0.2) y = 0;
      if (Math.abs(x) < 0.06) x = 0;
    }
    if (Math.hypot(x, y) < 0.05) { x = 0; y = 0; }
    const thr = y * 100, str = x * 100;
    return { thr, str: steerTilt ? undefined : str, kx, ky, label: thr === 0 && str === 0 ? 'N' : `${thr >= 0 ? 'D' : 'R'} ${Math.round(Math.abs(thr))}` };
  };

  const write = (thr: number | undefined, str: number | undefined) => {
    const p: { thr?: number; str?: number } = {};
    if (thr !== undefined) p.thr = thr;
    if (str !== undefined) p.str = str;
    input.set(p);
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (act.current != null) return;               // one finger per zone; others are ignored
    const r = zone.current!.getBoundingClientRect();
    act.current = { id: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top };
    zone.current!.setPointerCapture(e.pointerId);
    float.current?.classList.remove('is-spring');
    knob.current?.classList.remove('is-spring');
    show(act.current.ox, act.current.oy, 0, 0, true);
    if (readout.current) readout.current.textContent = kind === 'str' ? 'Straight' : 'N';
    manualOverride();
    nagIfLocked(armed);
    haptic('light');
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const a = act.current;
    if (!a || a.id !== e.pointerId) return;
    const r = zone.current!.getBoundingClientRect();
    const c = compute(e.clientX - r.left - a.ox, e.clientY - r.top - a.oy);
    write(c.thr, c.str);
    detent(kind === 'str' ? c.str ?? 0 : c.thr ?? 0);
    show(a.ox, a.oy, c.kx, c.ky, true);
    if (readout.current) readout.current.textContent = c.label;
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const a = act.current;
    if (!a || a.id !== e.pointerId) return;
    act.current = null;
    write(kind === 'str' ? undefined : 0, kind === 'thr' ? undefined : steerTilt ? undefined : 0);
    detent(0);
    rest(true);
  };

  useLayoutEffect(() => {
    rest(false);
    const ro = new ResizeObserver(() => { if (!act.current) rest(false); });
    if (zone.current) ro.observe(zone.current);
    return () => ro.disconnect();
  }, [rest]);
  useEffect(() => () => { write(kind === 'str' ? undefined : 0, kind === 'thr' ? undefined : 0); }, [kind]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`thumb is-${side} is-${kind}`} ref={zone} style={{ ['--travel' as string]: `${travel}px` }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp}
      onContextMenu={(e) => e.preventDefault()} role="application" aria-label={kind === 'thr' ? 'Throttle: touch and slide up or down' : kind === 'str' ? 'Steering: touch and slide left or right' : 'Joystick'}>
      <div className="thumb-float" ref={float}>
        <div className="thumb-track">
          {kind !== 'stick' && <><div className="thumb-fill is-pos" ref={fillP} /><div className="thumb-fill is-neg" ref={fillN} /></>}
          {kind === 'thr' && <><span className="thumb-tag is-a">D</span><span className="thumb-tag is-b">R</span></>}
          {kind === 'str' && <><span className="thumb-tag is-a">L</span><span className="thumb-tag is-b">R</span></>}
          {kind === 'stick' && <><span className="thumb-tag is-n">D</span><span className="thumb-tag is-s">R</span><span className="thumb-tag is-w">L</span><span className="thumb-tag is-e">R</span></>}
        </div>
        <div className="thumb-knob" ref={knob}><span ref={readout} /></div>
      </div>
    </div>
  );
}

/* ── Tilt steering read-out (replaces the steering thumb when tilt is on) ── */
export function TiltPad() {
  const t = useStore(tilt);
  return (
    <div className="tiltpad">
      <div className="tilt-dial">
        <div className="tilt-horizon" style={{ transform: `rotate(${-t.roll}deg)` }} />
        <div className="tilt-bar"><div className="tilt-fill" style={{ transform: `scaleX(${t.value / 100})` }} /></div>
        <span className="tilt-deg">{t.value === 0 ? 'Straight' : `${t.value > 0 ? 'R' : 'L'} ${Math.abs(Math.round(t.value))}`}</span>
      </div>
      <button className="lg-btn tilt-cal" onClick={calibrateTilt}><Icon name="tilt" size={16} />Centre here</button>
    </div>
  );
}

/* ── Ignition: slide to start / slide back to stop ─────────────── */
export function Ignition({ armed, disabled, onArm, onDisarm }: { armed: boolean; disabled: boolean; onArm(): void; onDisarm(): void }) {
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x0: number; p0: number } | null>(null);
  const [pending, setPending] = useState(false);
  const shown = pending || armed;

  const travel = () => (track.current && thumb.current ? track.current.clientWidth - thumb.current.offsetWidth - 8 : 0);
  const place = (p: number, spring: boolean) => {
    if (!thumb.current) return;
    thumb.current.classList.toggle('is-spring', spring);
    thumb.current.style.transform = `translate3d(${p * travel()}px, 0, 0)`;
    track.current?.style.setProperty('--p', String(p));
  };
  useLayoutEffect(() => { if (!drag.current) place(shown ? 1 : 0, true); });
  useEffect(() => {
    const ro = new ResizeObserver(() => place(shown ? 1 : 0, false));
    if (track.current) ro.observe(track.current);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  useEffect(() => { if (armed) setPending(false); }, [armed]);
  useEffect(() => { if (!pending) return; const t = setTimeout(() => setPending(false), 1200); return () => clearTimeout(t); }, [pending]);

  const onDown = (e: RPointerEvent) => {
    if (disabled) return;
    drag.current = { id: e.pointerId, x0: e.clientX, p0: shown ? 1 : 0 };
    thumb.current!.setPointerCapture(e.pointerId);
    haptic('light');
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = Math.max(0, Math.min(1, d.p0 + (e.clientX - d.x0) / (travel() || 1)));
    place(p, false);
  };
  const onUp = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const m = new DOMMatrixReadOnly(getComputedStyle(thumb.current!).transform);
    const p = m.m41 / (travel() || 1);
    if (!shown && p > 0.82) { setPending(true); onArm(); haptic('success'); place(1, true); }
    else if (shown && p < 0.18) { setPending(false); onDisarm(); haptic('medium'); place(0, true); }
    else place(shown ? 1 : 0, true);
  };

  return (
    <div className={`ignition${shown ? ' is-armed' : ''}${disabled ? ' is-disabled' : ''}`} ref={track}>
      <div className="ignition-fill" />
      <span className="ignition-text">{shown ? 'ARMED · slide back to stop' : 'slide to start'}<Icon name="chevron" size={16} /></span>
      <div className="ignition-thumb" ref={thumb} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        role="switch" aria-checked={armed} aria-label="Ignition">
        <Icon name="power" size={22} />
      </div>
    </div>
  );
}

/* ── Segmented control with a sliding white-glass pill ─────────── */
export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: {
  value: T; options: { id: T; label: string; sub?: string }[]; onChange(v: T): void; size?: 'md' | 'lg';
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const ready = useRef(false);
  const place = useCallback(() => {
    const btn = wrap.current?.querySelector<HTMLElement>('button[aria-pressed="true"]');
    const p = pill.current;
    if (!btn || !p) return;
    p.style.width = `${btn.offsetWidth}px`;
    p.style.height = `${btn.offsetHeight}px`;
    p.style.transform = `translate3d(${btn.offsetLeft}px, ${btn.offsetTop}px, 0)`;
    if (!ready.current) requestAnimationFrame(() => { p.classList.add('is-ready'); ready.current = true; });
  }, []);
  useLayoutEffect(place, [value, place]);
  useEffect(() => {
    const ro = new ResizeObserver(place);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [place]);
  return (
    <div className={`seg is-${size}`} ref={wrap} role="group">
      <span className="seg-pill" ref={pill} aria-hidden="true" />
      {options.map((o) => (
        <button key={o.id} aria-pressed={o.id === value}
          onClick={() => { if (o.id !== value) { haptic('medium'); onChange(o.id); } }}>
          <span>{o.label}</span>{o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

export function ModePicker({ value, onChange }: { value: DriveMode; onChange(m: DriveMode): void }) {
  return <Segmented size="lg" value={value} onChange={onChange} options={MODES.map((m) => ({ id: m.id, label: m.label, sub: `${m.cap}%` }))} />;
}

/* ── Emergency stop: fires on touch-down, not on click ─────────── */
export function EStop({ onStop, disabled }: { onStop(): void; disabled: boolean }) {
  return (
    <button className="estop" disabled={disabled} aria-label="Emergency stop"
      onPointerDown={(e) => { e.preventDefault(); if (!disabled) onStop(); }}>
      <Icon name="stop" size={22} /><span>STOP</span>
    </button>
  );
}
