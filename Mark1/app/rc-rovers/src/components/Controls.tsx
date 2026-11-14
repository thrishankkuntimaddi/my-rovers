/* Driving controls. They write straight to the `input` store and move their knobs
   via transforms on refs — no React re-render per pointer move, so dragging stays
   at the display's full refresh rate (120 Hz on the Pad 5). */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { input, toast } from '../state/ui';
import { haptic } from '../lib/native';
import { MODES, type DriveMode } from '../rover/protocol';
import { Icon } from './Icon';

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

/* ── Single-axis spring-return control (throttle: vertical, steering: horizontal) ── */
export function AxisControl({ axis, armed, label, hints }: { axis: 'thr' | 'str'; armed: boolean; label: string; hints: [string, string] }) {
  const vertical = axis === 'thr';
  const track = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const fillPos = useRef<HTMLDivElement>(null);
  const fillNeg = useRef<HTMLDivElement>(null);
  const valueEl = useRef<HTMLSpanElement>(null);
  const active = useRef<number | null>(null);
  const detent = useDetents();

  const render = useCallback((v: number, spring: boolean) => {
    const t = track.current, k = knob.current;
    if (!t || !k) return;
    const len = vertical ? t.clientHeight - k.offsetHeight : t.clientWidth - k.offsetWidth;
    const off = (v / 100) * (len / 2);
    k.classList.toggle('is-spring', spring);
    fillPos.current?.classList.toggle('is-spring', spring);
    fillNeg.current?.classList.toggle('is-spring', spring);
    k.style.transform = vertical ? `translate3d(0, ${-off}px, 0)` : `translate3d(${off}px, 0, 0)`;
    const s = (n: number) => (vertical ? `scaleY(${n})` : `scaleX(${n})`);
    if (fillPos.current) fillPos.current.style.transform = s(Math.max(0, v) / 100);
    if (fillNeg.current) fillNeg.current.style.transform = s(Math.max(0, -v) / 100);
    if (valueEl.current) valueEl.current.textContent = v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v))}`;
  }, [vertical]);

  const fromPointer = (e: RPointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    const k = knob.current!;
    const half = ((vertical ? r.height - k.offsetHeight : r.width - k.offsetWidth) / 2) || 1;
    const raw = vertical ? (r.top + r.height / 2 - e.clientY) / half : (e.clientX - r.left - r.width / 2) / half;
    return clamp(raw * 100);
  };

  const onDown = (e: RPointerEvent) => {
    if (active.current != null) return;
    active.current = e.pointerId;
    track.current!.setPointerCapture(e.pointerId);
    track.current!.classList.add('is-active');
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
    input.set({ [axis]: 0 } as { thr: number } | { str: number });   // value returns to 0 immediately…
    render(0, true);                                                   // …only the knob springs
    detent(0);
  };

  useEffect(() => {
    const ro = new ResizeObserver(() => render(0, false));
    if (track.current) ro.observe(track.current);
    return () => { ro.disconnect(); input.set({ [axis]: 0 } as { thr: number } | { str: number }); };
  }, [axis, render]);

  return (
    <div className={`axis ${vertical ? 'is-v' : 'is-h'}`}>
      <div className="axis-head"><span className="lg-label">{label}</span><span className="axis-value" ref={valueEl}>0</span></div>
      <div className="axis-track" ref={track} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        role="slider" aria-label={label} aria-valuemin={-100} aria-valuemax={100} aria-valuenow={0}>
        <div className="axis-fill is-pos" ref={fillPos} />
        <div className="axis-fill is-neg" ref={fillNeg} />
        <div className="axis-mid" />
        <span className="axis-hint is-a">{hints[0]}</span>
        <span className="axis-hint is-b">{hints[1]}</span>
        <div className="axis-knob" ref={knob}><span /></div>
      </div>
    </div>
  );
}

/* ── Two-axis joystick (one thumb: throttle + steering) ─────────── */
export function Joystick({ armed }: { armed: boolean }) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const detent = useDetents();

  const place = (x: number, y: number, spring: boolean) => {
    const b = base.current!, k = knob.current!;
    const r = (b.clientWidth - k.offsetWidth) / 2;
    k.classList.toggle('is-spring', spring);
    k.style.transform = `translate3d(${(x / 100) * r}px, ${(-y / 100) * r}px, 0)`;
  };
  const fromPointer = (e: RPointerEvent) => {
    const rect = base.current!.getBoundingClientRect();
    const r = (rect.width - knob.current!.offsetWidth) / 2 || 1;
    let dx = (e.clientX - rect.left - rect.width / 2) / r;
    let dy = (rect.top + rect.height / 2 - e.clientY) / r;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    return { x: dx * 100, y: dy * 100 };
  };
  const onDown = (e: RPointerEvent) => {
    if (active.current != null) return;
    active.current = e.pointerId;
    base.current!.setPointerCapture(e.pointerId);
    base.current!.classList.add('is-active');
    nagIfLocked(armed);
    haptic('light');
    onMove(e);
  };
  const onMove = (e: RPointerEvent) => {
    if (active.current !== e.pointerId) return;
    const { x, y } = fromPointer(e);
    input.set({ thr: y, str: x });
    detent(Math.hypot(x, y));
    place(x, y, false);
  };
  const onUp = (e: RPointerEvent) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    base.current!.classList.remove('is-active');
    input.set({ thr: 0, str: 0 });
    place(0, 0, true);
    detent(0);
  };
  useEffect(() => () => input.set({ thr: 0, str: 0 }), []);

  return (
    <div className="joy-wrap">
    <div className="joy" ref={base} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      role="application" aria-label="Joystick">
      <div className="joy-ring" />
      <div className="joy-cross" />
      <span className="joy-tag is-n">FWD</span><span className="joy-tag is-s">REV</span>
      <span className="joy-tag is-w">L</span><span className="joy-tag is-e">R</span>
      <div className="joy-knob" ref={knob}><span /></div>
    </div>
    </div>
  );
}

/* ── Tap-and-hold direction pad ────────────────────────────────── */
const DIRS: { k: string; thr: number; str: number; glyph: string }[] = [
  { k: 'fl', thr: 100, str: -70, glyph: '↖' }, { k: 'f', thr: 100, str: 0, glyph: '↑' }, { k: 'fr', thr: 100, str: 70, glyph: '↗' },
  { k: 'l', thr: 0, str: -100, glyph: '←' }, { k: 'c', thr: 0, str: 0, glyph: '' }, { k: 'r', thr: 0, str: 100, glyph: '→' },
  { k: 'bl', thr: -100, str: -70, glyph: '↙' }, { k: 'b', thr: -100, str: 0, glyph: '↓' }, { k: 'br', thr: -100, str: 70, glyph: '↘' },
];
export function DPad({ armed }: { armed: boolean }) {
  const [held, setHeld] = useState<string | null>(null);
  const pid = useRef<number | null>(null);
  const down = (d: (typeof DIRS)[number]) => (e: RPointerEvent<HTMLButtonElement>) => {
    if (d.k === 'c') return;
    pid.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    nagIfLocked(armed);
    haptic('light');
    setHeld(d.k);
    input.set({ thr: d.thr, str: d.str });
  };
  const up = (e: RPointerEvent) => {
    if (pid.current !== e.pointerId) return;
    pid.current = null;
    setHeld(null);
    input.set({ thr: 0, str: 0 });
  };
  useEffect(() => () => input.set({ thr: 0, str: 0 }), []);
  return (
    <div className="dpad-wrap">
    <div className="dpad" aria-label="Direction pad">
      {DIRS.map((d) => d.k === 'c'
        ? <div key="c" className="dpad-hub"><Icon name="gamepad" size={22} /></div>
        : <button key={d.k} className={`dpad-btn is-${d.k}${held === d.k ? ' is-held' : ''}`}
            onPointerDown={down(d)} onPointerUp={up} onPointerCancel={up} aria-label={d.k}>{d.glyph}</button>)}
    </div>
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
