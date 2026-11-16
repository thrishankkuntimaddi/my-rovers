import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { toasts } from '../state/ui';
import { Icon } from './Icon';
import { useBack } from '../lib/back';

/** Glass sheet: centred dialog on wide screens, bottom sheet on narrow ones. */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose(): void; title: string; children: ReactNode; wide?: boolean }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) { setMounted(true); const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true))); return () => cancelAnimationFrame(r); }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 380);
    return () => clearTimeout(t);
  }, [open]);
  useBack(open, onClose);
  if (!mounted) return null;
  return createPortal(
    <div className={`sheet-layer${shown ? ' is-shown' : ''}`}>
      <div className="lg-scrim" onClick={onClose} />
      <section className={`lg-sheet sheet${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="lg-icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}

export function Toasts() {
  const { list } = useStore(toasts);
  return createPortal(
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`lg-toast toast is-${t.tone}`}>
          <span className="toast-dot" />{t.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return <button className="lg-switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function Row({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="row">
      <div className="row-text"><div className="row-title">{title}</div>{sub && <div className="row-sub">{sub}</div>}</div>
      <div className="row-ctl">{children}</div>
    </div>
  );
}

export function Slider({ value, min, max, step = 1, onChange, format, label }: {
  value: number; min: number; max: number; step?: number; onChange(v: number): void; format?(v: number): string; label: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        style={{ '--fill': `${pct}%` } as CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{format ? format(value) : value}</output>
    </div>
  );
}

/** Minimal sparkline for telemetry history. */
export function Sparkline({ data, min, max, tone = 'var(--lg-text)' }: { data: (number | null)[]; min: number; max: number; tone?: string }) {
  const pts = data.map((v, i) => (v == null ? null : [i / Math.max(1, data.length - 1) * 300, 80 - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * 72 - 4] as const));
  let d = '';
  let pen = false;
  for (const p of pts) { if (!p) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)} `; pen = true; }
  return (
    <svg className="spark" viewBox="0 0 300 80" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="40" x2="300" y2="40" className="spark-grid" />
      {d ? <path d={d} style={{ stroke: tone }} /> : <text x="150" y="44" className="spark-empty">No data yet</text>}
    </svg>
  );
}
