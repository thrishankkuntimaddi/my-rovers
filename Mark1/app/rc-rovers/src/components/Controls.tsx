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

/* ── Fixed throttle / steering sliders (spring back to zero) ──────────
   Short, thumb-sized tracks: the length is 2 × travel (Settings → Control size), so full
   power or full lock is a small thumb movement. Each track follows its own finger
   (pointer capture), so throttle and steering work together. Straight-line assist
   snaps small steering to straight. */
export const TRAVEL: Record<ControlSize, number> = { s: 60, m: 78, l: 100 };

export function AxisControl({ axis, armed, label, hints }: { axis: 'thr' | 'str'; armed: boolean; label: string; hints: [string, string] }) {
  const vertical = axis === 'thr';
  const track = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const fillPos = useRef<HTMLDivElement>(null);
  const fillNeg = useRef<HTMLDivElement>(null);
  const valueEl = useRef<HTMLSpanElement>(null);
  const active = useRef<number | null>(null);
  const travel = TRAVEL[useSel(settings, (s) => s.controlSize)];
  const assist = useSel(settings, (s) => s.straightAssist);
  const detent = useDetents();

  const render = useCallback((v: number, spring: boolean) => {
    const k = knob.current;
    if (!k) return;
    const off = (v / 100) * travel;
    k.classList.toggle('is-spring', spring);
    fillPos.current?.classList.toggle('is-spring', spring);
    fillNeg.current?.classList.toggle('is-spring', spring);
    k.style.transform = vertical ? `translate3d(0, ${-off}px, 0)` : `translate3d(${off}px, 0, 0)`;
    const sc = (n: number) => (vertical ? `scaleY(${n})` : `scaleX(${n})`);
    if (fillPos.current) fillPos.current.style.transform = sc(Math.max(0, v) / 100);
    if (fillNeg.current) fillNeg.current.style.transform = sc(Math.max(0, -v) / 100);
    if (valueEl.current) valueEl.current.textContent = v === 0 ? (vertical ? 'N' : 'Straight') : `${vertical ? (v > 0 ? 'D' : 'R') : v > 0 ? 'R' : 'L'} ${Math.round(Math.abs(v))}`;
  }, [vertical, travel]);

  const fromPointer = (e: RPointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    const d = vertical ? r.top + r.height / 2 - e.clientY : e.clientX - r.left - r.width / 2;
    let v = clamp((d / travel) * 100);
    if (vertical) { if (Math.abs(v) < 4) v = 0; }
    else if (assist) v = Math.abs(v) < 8 ? 0 : Math.sign(v) * ((Math.abs(v) - 8) / 92) * 100;
    return v;
  };
  const onDown = (e: RPointerEvent) => {
    if (active.current != null) return;
    active.current = e.pointerId;
    track.current!.setPointerCapture(e.pointerId);
    track.current!.classList.add('is-active');
    manualOverride();
    nagIfLocked(armed);
    haptic('light');
    onMove(e);
  };
  const onMove = (e: RPointerEvent) => {
    if (active.current !== e.pointerId) return;
    const v = fromPointer(e);
    input.set({ [axis]: v } as { thr: number } | { str: number });
    detent(v);
    render(v, false);
  };
  const onUp = (e: RPointerEvent) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    track.current!.classList.remove('is-active');
    input.set({ [axis]: 0 } as { thr: number } | { str: number });
    render(0, true);
    detent(0);
  };
  useLayoutEffect(() => { render(0, false); }, [render]);
  useEffect(() => () => { input.set({ [axis]: 0 } as { thr: number } | { str: number }); }, [axis]);

  return (
    <div className={`axis2 ${vertical ? 'is-v' : 'is-h'}`} style={{ ['--travel' as string]: `${travel}px` }}>
      <span className="lg-label">{label}</span>
      <div className="axis2-track" ref={track} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onContextMenu={(e) => e.preventDefault()} role="slider" aria-label={label} aria-valuemin={-100} aria-valuemax={100} aria-valuenow={0}>
        <div className="axis2-fill is-pos" ref={fillPos} />
        <div className="axis2-fill is-neg" ref={fillNeg} />
        <span className="axis2-hint is-a">{hints[0]}</span>
        <span className="axis2-hint is-b">{hints[1]}</span>
        <div className="axis2-knob" ref={knob}><span ref={valueEl} /></div>
      </div>
    </div>
  );
}

/* ── Joystick (one thumb: throttle + steering), same compact size ── */
export function Joystick({ armed, steerTilt = false }: { armed: boolean; steerTilt?: boolean }) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const travel = TRAVEL[useSel(settings, (s) => s.controlSize)];
  const assist = useSel(settings, (s) => s.straightAssist);
  const detent = useDetents();
  const place = (x: number, y: number, spring: boolean) => {
    const k = knob.current!;
    k.classList.toggle('is-spring', spring);
    k.style.transform = `translate3d(${(x / 100) * travel}px, ${(-y / 100) * travel}px, 0)`;
  };
  const onMove = (e: RPointerEvent) => {
    if (active.current !== e.pointerId) return;
    const rect = base.current!.getBoundingClientRect();
    let x = (e.clientX - rect.left - rect.width / 2) / travel, y = (rect.top + rect.height / 2 - e.clientY) / travel;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    place(x * 100, y * 100, false);
    if (assist) {
      if (Math.abs(x) < Math.abs(y) * 0.26) x = 0;          // within ~15° of straight ahead / back
      else if (Math.abs(y) < Math.abs(x) * 0.2) y = 0;
    }
    if (Math.hypot(x, y) < 0.05) { x = 0; y = 0; }
    input.set(steerTilt ? { thr: y * 100 } : { thr: y * 100, str: x * 100 });
    detent(Math.hypot(x, y) * 100);
  };
  const onDown = (e: RPointerEvent) => {
    if (active.current != null) return;
    active.current = e.pointerId;
    base.current!.setPointerCapture(e.pointerId);
    base.current!.classList.add('is-active');
    manualOverride();
    nagIfLocked(armed);
    haptic('light');
    onMove(e);
  };
  const onUp = (e: RPointerEvent) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    base.current!.classList.remove('is-active');
    input.set(steerTilt ? { thr: 0 } : { thr: 0, str: 0 });
    place(0, 0, true);
    detent(0);
  };
  useEffect(() => () => input.set({ thr: 0, str: 0 }), []);
  return (
    <div className="joy2" ref={base} style={{ ['--travel' as string]: `${travel}px` }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()} role="application" aria-label="Joystick">
      <span className="joy2-tag is-n">D</span><span className="joy2-tag is-s">R</span><span className="joy2-tag is-w">L</span><span className="joy2-tag is-e">R</span>
      <div className="axis2-knob" ref={knob} />
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
