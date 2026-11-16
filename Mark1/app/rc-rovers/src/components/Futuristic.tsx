/* 2.0 building blocks: navigation menu, trail map (radar), path preview, mic button. */
import { createContext, useContext, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { odo } from '../state/odometry';
import { voice, startListening, stopListening } from '../ai/voice';
import { haptic } from '../lib/native';
import { installUpdate, update } from '../lib/updater';
import { Icon, type IconName } from './Icon';
import { useBack } from '../lib/back';

/* ── navigation: glass menu pill (top-left) + Drive button (top-right) ──
   Replaces the bottom dock. The pill shows where you are; tapping it opens a
   floating Liquid Glass menu that grows out of it (like iPadOS 26 menus). */
export type Tab = 'garage' | 'missions' | 'nova' | 'logs' | 'academy';
export const TABS: { id: Tab; label: string; icon: IconName; sub: string }[] = [
  { id: 'garage', label: 'Garage', icon: 'rover', sub: 'Your rovers' },
  { id: 'missions', label: 'Missions', icon: 'route', sub: 'Routes · record & replay' },
  { id: 'nova', label: 'Nova', icon: 'spark', sub: 'AI co-pilot' },
  { id: 'logs', label: 'Logs', icon: 'list', sub: 'Events · trips · stats' },
  { id: 'academy', label: 'Academy', icon: 'trophy', sub: 'School · achievements' },
];

export interface NavApi { tab: Tab; go(t: Tab): void; drive(): void; live: boolean; settings(): void }
export const NavCtx = createContext<NavApi>({ tab: 'garage', go: () => {}, drive: () => {}, live: false, settings: () => {} });

export function NavMenu() {
  const nav = useContext(NavCtx);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [at, setAt] = useState({ x: 16, y: 72 });
  const btn = useRef<HTMLButtonElement>(null);
  const cur = TABS.find((t) => t.id === nav.tab)!;

  const show = () => {
    const r = btn.current!.getBoundingClientRect();
    setAt({ x: Math.max(8, r.left), y: r.bottom + 8 });
    setOpen(true); haptic('light');
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
  };
  const hide = () => { setShown(false); setTimeout(() => setOpen(false), 260); };
  useBack(open, hide);
  const pick = (fn: () => void) => { haptic('tick'); hide(); setTimeout(fn, 120); };

  return (
    <>
      <button ref={btn} className={`navpill${open ? ' is-open' : ''}`} onClick={() => (open ? hide() : show())} aria-haspopup="menu" aria-expanded={open}>
        <Icon name={cur.icon} size={19} />
        <span className="navpill-text"><b>{cur.label}</b><small>{cur.sub}</small></span>
        <Icon name="down" size={15} className="navpill-chev" />
      </button>
      {open && createPortal(
        <div className={`navmenu-layer${shown ? ' is-shown' : ''}`} onPointerDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
          <div className="navmenu" role="menu" style={{ left: at.x, top: at.y }}>
            <div className="navmenu-brand"><span className="brand-mark sm"><Icon name="rover" size={16} /></span><b>RC-Rovers</b></div>
            {TABS.map((t) => (
              <button key={t.id} role="menuitem" className={`navmenu-item${t.id === nav.tab ? ' is-active' : ''}`} onClick={() => pick(() => nav.go(t.id))}>
                <Icon name={t.icon} size={20} /><span><b>{t.label}</b><small>{t.sub}</small></span>
              </button>
            ))}
            <div className="navmenu-sep" />
            <button role="menuitem" className="navmenu-item" onClick={() => pick(nav.drive)}>
              <Icon name="gamepad" size={20} /><span><b>Drive</b><small>{nav.live ? 'Back to the cockpit' : 'Connect and drive'}</small></span>
              {nav.live && <i className="navmenu-dot" />}
            </button>
            <button role="menuitem" className="navmenu-item" onClick={() => pick(nav.settings)}>
              <Icon name="gear" size={20} /><span><b>Settings</b><small>Controls · voice · theme</small></span>
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export function DriveButton() {
  const nav = useContext(NavCtx);
  return (
    <button className={`lg-btn is-primary drive-btn${nav.live ? ' is-live' : ''}`} onClick={() => { haptic('medium'); nav.drive(); }} aria-label="Drive">
      {nav.live && <i className="live-dot" />}<Icon name="gamepad" size={19} /><span>Drive</span>
    </button>
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

/* ── mic: tap to talk (stops when you pause) · hold for push-to-talk ── */
export function MicButton({ size = 'md', label }: { size?: 'md' | 'lg'; label?: string }) {
  const v = useStore(voice);
  const press = useRef<{ id: number; at: number; wasOn: boolean } | null>(null);
  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    press.current = { id: e.pointerId, at: performance.now(), wasOn: voice.get().listening };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (voice.get().listening) stopListening(); else startListening();
  };
  const up = (e: RPointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (!p.wasOn && performance.now() - p.at > 450) stopListening();   // held: push-to-talk
  };
  useEffect(() => () => { if (press.current) stopListening(); }, []);
  return (
    <button className={`mic is-${size}${v.listening ? ' is-listening' : ''}${v.speaking ? ' is-speaking' : ''}`} onPointerDown={down} onPointerUp={up} onPointerCancel={up}
      style={{ ['--lvl' as string]: v.level.toFixed(2) }}
      onContextMenu={(e) => e.preventDefault()} aria-label={v.listening ? 'Listening: tap to finish' : 'Tap to talk to Nova'}>
      <span className="mic-ring" /><span className="mic-ring is-2" />
      <Icon name="mic" size={size === 'lg' ? 28 : 21} />
      {label && <span className="mic-label">{v.listening ? 'Listening…' : label}</span>}
    </button>
  );
}

/* ── update card: shown when a newer RC-Rovers is on GitHub ────── */
export function UpdateCard({ compact }: { compact?: boolean }) {
  const u = useStore(update);
  if (u.state !== 'available' && u.state !== 'downloading' && u.state !== 'installing') return null;
  const pct = Math.round(u.progress * 100);
  return (
    <div className={`update-card lg-tile${compact ? ' is-compact' : ''}`}>
      <span className="update-icon"><Icon name="download" size={18} /></span>
      <div className="update-text">
        <b>RC-Rovers {u.latest} is ready</b>
        <span>{u.state === 'downloading' ? `Downloading… ${pct}%` : u.state === 'installing' ? 'Tap “Update” on the Android screen. Your data is kept.' : 'Installs over this version. Missions, XP and settings are kept.'}</span>
        {u.state === 'downloading' && <span className="update-bar"><i style={{ transform: `scaleX(${u.progress})` }} /></span>}
      </div>
      {u.state === 'available' && <button className="lg-btn is-primary update-btn" onClick={installUpdate}>Update</button>}
    </div>
  );
}
