/* 2.0 building blocks: navigation dock, trail map (radar), path preview, mic button. */
import { useEffect, useLayoutEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { useStore } from '../state/store';
import { odo } from '../state/odometry';
import { voice, startListening, stopListening } from '../ai/voice';
import { haptic } from '../lib/native';
import { Icon, type IconName } from './Icon';

/* ── dock ──────────────────────────────────────────────────────── */
export type Tab = 'garage' | 'missions' | 'nova' | 'logs' | 'academy';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'garage', label: 'Garage', icon: 'rover' }, { id: 'missions', label: 'Missions', icon: 'route' },
  { id: 'nova', label: 'Nova', icon: 'spark' }, { id: 'logs', label: 'Logs', icon: 'list' }, { id: 'academy', label: 'Academy', icon: 'trophy' },
];

export function Dock({ tab, onTab, onDrive, live }: { tab: Tab; onTab(t: Tab): void; onDrive(): void; live: boolean }) {
  const nav = useRef<HTMLElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = nav.current?.querySelector<HTMLElement>('.lg-dock-tab.is-active'); const p = pill.current;
      if (!el || !p) return;
      p.style.width = `${el.offsetWidth}px`; p.style.height = `${el.offsetHeight}px`;
      p.style.transform = `translate3d(${el.offsetLeft}px, ${el.offsetTop}px, 0)`; p.style.opacity = '1';
    };
    place();
    requestAnimationFrame(() => pill.current?.classList.add('is-ready'));
    const ro = new ResizeObserver(place); if (nav.current) ro.observe(nav.current);
    return () => ro.disconnect();
  }, [tab]);
  const btn = (t: (typeof TABS)[number]) => (
    <button key={t.id} className={`lg-dock-tab${tab === t.id ? ' is-active' : ''}`} onClick={() => { if (t.id !== tab) { haptic('tick'); onTab(t.id); } }} aria-label={t.label}>
      <Icon name={t.icon} size={20} /><span>{t.label}</span>
    </button>
  );
  return (
    <nav className="lg-dock lg-bar dock" ref={nav}>
      <span className="lg-dock-pill" ref={pill} aria-hidden="true" />
      {TABS.slice(0, 2).map(btn)}
      <button className={`lg-dock-action drive-orb${live ? ' is-live' : ''}`} onClick={() => { haptic('medium'); onDrive(); }} aria-label="Drive">
        <Icon name="gamepad" size={24} />
      </button>
      {TABS.slice(2).map(btn)}
    </nav>
  );
}

/* ── trail map: estimated path, radar rings, rover heading ─────── */
export function TrailMap({ compact }: { compact?: boolean }) {
  const o = useStore(odo);
  const pts = o.trail;
  let minX = -1, maxX = 1, minY = -1, maxY = 1;
  for (const [x, y] of pts) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const span = Math.max(maxX - minX, maxY - minY, 2) * 1.25;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const W = 200, H = 150;
  const k = Math.min(W, H) / span;
  const sx = (x: number) => W / 2 + (x - cx) * k;
  const sy = (y: number) => H / 2 - (y - cy) * k;
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(' ');
  const gridStep = span > 20 ? 5 : span > 8 ? 2 : 1;
  const rings = [1, 2, 3].map((i) => i * gridStep * k);
  return (
    <svg className={`trail${compact ? ' is-compact' : ''}`} viewBox={`0 0 ${W} ${H}`} aria-label="Trail map">
      <defs>
        <radialGradient id="tr-glow"><stop offset="0" stopColor="currentColor" stopOpacity=".18" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></radialGradient>
      </defs>
      {rings.map((r, i) => <circle key={i} cx={sx(o.x)} cy={sy(o.y)} r={r} className="trail-ring" />)}
      <line x1={0} y1={sy(0)} x2={W} y2={sy(0)} className="trail-axis" /><line x1={sx(0)} y1={0} x2={sx(0)} y2={H} className="trail-axis" />
      <circle cx={sx(0)} cy={sy(0)} r={3} className="trail-origin" />
      <path d={d} className="trail-path" />
      <circle cx={sx(o.x)} cy={sy(o.y)} r={16} fill="url(#tr-glow)" className="trail-glow" />
      <g transform={`translate(${sx(o.x)} ${sy(o.y)}) rotate(${(o.h * 180) / Math.PI})`}>
        <path d="M0 -7 L5 5 L0 2.5 L-5 5 Z" className="trail-rover" />
      </g>
      <text x={6} y={H - 6} className="trail-scale">grid {gridStep} m · {o.dist.toFixed(1)} m driven</text>
    </svg>
  );
}

/** Small static path preview for a mission card. */
export function PathPreview({ pts }: { pts: [number, number][] }) {
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const span = Math.max(maxX - minX, maxY - minY, 0.5) * 1.3;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const sx = (x: number) => 50 + ((x - cx) / span) * 100, sy = (y: number) => 50 - ((y - cy) / span) * 100;
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(' ');
  const [ex, ey] = pts[pts.length - 1] ?? [0, 0];
  return (
    <svg className="path-preview" viewBox="0 0 100 100" aria-hidden="true">
      <path d={d} className="pp-path" />
      <circle cx={sx(0)} cy={sy(0)} r={3.2} className="pp-start" />
      <circle cx={sx(ex)} cy={sy(ey)} r={3.2} className="pp-end" />
    </svg>
  );
}

/* ── hold-to-talk mic ──────────────────────────────────────────── */
export function MicButton({ size = 'md', label }: { size?: 'md' | 'lg'; label?: string }) {
  const v = useStore(voice);
  const pid = useRef<number | null>(null);
  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    pid.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    startListening();
  };
  const up = (e: RPointerEvent) => { if (pid.current !== e.pointerId) return; pid.current = null; stopListening(); };
  useEffect(() => () => { if (pid.current != null) stopListening(); }, []);
  return (
    <button className={`mic is-${size}${v.listening ? ' is-listening' : ''}${v.speaking ? ' is-speaking' : ''}`} onPointerDown={down} onPointerUp={up} onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()} aria-label="Hold to talk">
      <span className="mic-ring" /><span className="mic-ring is-2" />
      <Icon name="mic" size={size === 'lg' ? 28 : 21} />
      {label && <span className="mic-label">{v.listening ? 'Listening…' : label}</span>}
    </button>
  );
}
