/* Centre HUD: speed gauge, top-down rover with live steering, status line. */
import { useStore } from '../state/store';
import { input } from '../state/ui';
import { modeSpec, shape, type DriveMode, type Telemetry } from '../rover/protocol';
import { settings } from '../state/settings';
import { cruise } from '../rover/controller';

// 240° sweep around (110,110): 0 % at 150° (bottom-left) clockwise to 100 % at 30° (bottom-right)
const CX = 110, CY = 110;
const pt = (t: number, r: number) => { const a = (-210 + t * 240) * (Math.PI / 180); return [CX + r * Math.cos(a), CY + r * Math.sin(a)] as const; };
const TICKS = 48;

/** Segmented speed ring: lit segments = actual output, notch = mode cap, dot = where the stick is asking. */
export function Gauge({ thr, mode }: { thr: number; mode: DriveMode }) {
  const raw = useStore(input);
  const cr = useStore(cruise);
  const cmd = cr.on ? { thr: cr.thr } : raw;
  const st = useStore(settings);
  const a = Math.min(100, Math.abs(thr));
  const dir = thr > 1 ? 'FWD' : thr < -1 ? 'REV' : 'N';
  const cap = modeSpec(mode).cap;
  const cfg = { deadzone: st.deadzone, expo: st.expo, invertThr: st.invertThr, invertStr: st.invertStr, maxPct: st.maxPower };
  const c = Math.min(100, Math.abs(shape(cmd.thr, cfg, false) * cap / 100)) / 100;
  const [gx, gy] = pt(c, 78);
  const [n1x, n1y] = pt(cap / 100, 96), [n2x, n2y] = pt(cap / 100, 103);
  const lit = Math.round((a / 100) * TICKS);
  return (
    <svg className={`gauge${dir === 'REV' ? ' is-rev' : ''}`} viewBox="0 0 220 180" aria-label={`Speed ${Math.round(a)} percent ${dir}`}>
      {Array.from({ length: TICKS + 1 }, (_, i) => {
        const t = i / TICKS, major = i % 6 === 0;
        const [x1, y1] = pt(t, major ? 82 : 85), [x2, y2] = pt(t, 92);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={`gauge-seg${i <= lit && a >= 0.5 ? ' is-on' : ''}${major ? ' is-major' : ''}${t * 100 > cap ? ' is-over' : ''}`} />;
      })}
      <circle cx={CX} cy={CY} r={70} className="gauge-ring" />
      <circle cx={CX} cy={CY} r={64} className="gauge-ring is-faint" />
      <line x1={n1x} y1={n1y} x2={n2x} y2={n2y} className="gauge-cap" />
      <circle className="gauge-ghost" cx={gx} cy={gy} r={3.5} style={{ opacity: c > 0.02 ? 1 : 0 }} />
      <text x={CX} y={CY - 30} className="gauge-dir">{dir === 'N' ? 'NEUTRAL' : dir === 'FWD' ? 'FORWARD' : 'REVERSE'}</text>
      <text x={CX} y={CY + 14} className="gauge-num">{Math.round(a)}</text>
      <text x={CX} y={CY + 28} className="gauge-unit">% OUTPUT</text>
      <text x={CX} y={CY + 50} className="gauge-mode">{modeSpec(mode).label.toUpperCase()} · CAP {cap}</text>
    </svg>
  );
}

/** Wireframe rover from above: front wheels steer, treads roll, dashed arc shows where it's heading. */
export function RoverTopView({ thr, str }: { thr: number; str: number }) {
  const steer = (str / 100) * 28;
  const speed = Math.abs(thr);
  const dur = speed < 2 ? 0 : Math.max(0.12, 1.2 - speed / 100);
  const roll = { animationDuration: `${dur}s`, animationPlayState: dur ? 'running' : 'paused', animationDirection: thr < 0 ? 'reverse' : 'normal' } as const;
  const wheel = (x: number, y: number, front: boolean) => (
    <g className="tv-wheel" style={{ transform: `translate(${x}px, ${y}px) rotate(${front ? steer : 0}deg)` }}>
      <rect x="-6" y="-11" width="12" height="22" rx="4" className="tv-tyre" />
      <rect x="-6" y="-11" width="12" height="22" rx="4" className="tv-tread" style={roll} />
    </g>
  );
  // projected path: arc ahead of (or behind) the front axle
  const k = str / 100, rev = thr < -1;
  const y0 = rev ? 116 : 24, y1 = rev ? 150 : -14;
  const path = `M50 ${y0} Q ${50 + k * 10} ${(y0 + y1) / 2} ${50 + k * 34} ${y1}`;
  return (
    <svg className="topview" viewBox="0 -18 100 172" aria-hidden="true">
      <path d={path} className={`tv-path${speed > 2 ? ' is-moving' : ''}`} />
      <line x1="50" y1="32" x2="50" y2="98" className="tv-axle" />
      <line x1="20" y1="32" x2="80" y2="32" className="tv-axle" />
      <line x1="20" y1="98" x2="80" y2="98" className="tv-axle" />
      <rect x="32" y="20" width="36" height="90" rx="11" className="tv-body" />
      <rect x="37" y="40" width="26" height="26" rx="6" className="tv-cab" />
      <line x1="38" y1="22" x2="62" y2="22" className="tv-lamp" />
      {wheel(20, 32, true)}{wheel(80, 32, true)}{wheel(20, 98, false)}{wheel(80, 98, false)}
    </svg>
  );
}

export function Hud({ tel, trim }: { tel: Telemetry; trim: number }) {
  const spec = modeSpec(tel.mode);
  return (
    <div className="hud lg-tile">
      <div className="hud-main">
        <Gauge thr={tel.thr} mode={tel.mode} />
        <RoverTopView thr={tel.thr} str={tel.str} />
      </div>
      <div className="hud-line">
        <span className={`lg-chip${tel.armed ? ' is-green' : ''}`}>{tel.armed ? 'ARMED' : 'SAFE'}</span>
        <span className="hud-kv"><b>{spec.label}</b> · cap {spec.cap}%</span>
        <span className="hud-kv">Steer <b>{tel.str > 0 ? 'R' : tel.str < 0 ? 'L' : ''}{Math.abs(Math.round(tel.str))}</b></span>
        <span className="hud-kv">Trim <b>{trim > 0 ? '+' : ''}{trim}</b></span>
      </div>
    </div>
  );
}
