/* Centre HUD: speed gauge, top-down rover with live steering, status line. */
import { useStore } from '../state/store';
import { input } from '../state/ui';
import { modeSpec, shape, type DriveMode, type Telemetry } from '../rover/protocol';
import { settings } from '../state/settings';

// 240° sweep around (110,106), r=88, from 150° (bottom-left) clockwise to 30° (bottom-right)
const ARC = 'M 33.79 150 A 88 88 0 1 1 186.21 150';

export function Gauge({ thr, mode }: { thr: number; mode: DriveMode }) {
  const cmd = useStore(input);
  const st = useStore(settings);
  const a = Math.min(100, Math.abs(thr));
  const dir = thr > 1 ? 'FWD' : thr < -1 ? 'REV' : 'N';
  // commanded position marker on the arc (ghost dot): 0…100 → −210°…30°
  // where the rover is heading: stick → deadzone/expo/max power → mode cap
  const cfg = { deadzone: st.deadzone, expo: st.expo, invertThr: st.invertThr, invertStr: st.invertStr, maxPct: st.maxPower };
  const c = Math.min(100, Math.abs(shape(cmd.thr, cfg, false) * modeSpec(mode).cap / 100)) / 100;
  const ang = (-210 + c * 240) * (Math.PI / 180);
  const mx = 110 + 88 * Math.cos(ang), my = 106 + 88 * Math.sin(ang);
  return (
    <svg className="gauge" viewBox="0 0 220 168" aria-label={`Speed ${Math.round(a)} percent ${dir}`}>
      <path d={ARC} pathLength={100} className="gauge-track" />
      <path d={ARC} pathLength={100} className={`gauge-val${thr < -1 ? ' is-rev' : ''}`} style={{ strokeDashoffset: 100 - a, opacity: a < 0.5 ? 0 : 1 }} />
      {[0, 25, 50, 75, 100].map((t) => {
        const r = (-210 + t * 2.4) * (Math.PI / 180);
        return <line key={t} className="gauge-tick" x1={110 + 70 * Math.cos(r)} y1={106 + 70 * Math.sin(r)} x2={110 + 76 * Math.cos(r)} y2={106 + 76 * Math.sin(r)} />;
      })}
      <circle className="gauge-ghost" cx={mx} cy={my} r={5.5} style={{ opacity: c > 0.02 ? 1 : 0 }} />
      <text x="110" y="112" className="gauge-num">{Math.round(a)}</text>
      <text x="110" y="136" className="gauge-unit">{dir === 'N' ? 'NEUTRAL' : `% · ${dir}`}</text>
    </svg>
  );
}

/** Top-down rover: front wheels turn with steering, treads roll with throttle. */
export function RoverTopView({ thr, str }: { thr: number; str: number }) {
  const steer = (str / 100) * 28;
  const speed = Math.abs(thr);
  const dur = speed < 2 ? 0 : Math.max(0.12, 1.2 - speed / 100);
  const roll = { animationDuration: `${dur}s`, animationPlayState: dur ? 'running' : 'paused', animationDirection: thr < 0 ? 'reverse' : 'normal' } as const;
  const wheel = (x: number, y: number, front: boolean) => (
    <g className="tv-wheel" style={{ transform: `translate(${x}px, ${y}px) rotate(${front ? steer : 0}deg)` }}>
      <rect x="-7" y="-12" width="14" height="24" rx="5" className="tv-tyre" />
      <rect x="-7" y="-12" width="14" height="24" rx="5" className="tv-tread" style={roll} />
    </g>
  );
  return (
    <svg className="topview" viewBox="0 0 100 130" aria-hidden="true">
      <line x1="50" y1="30" x2="50" y2="100" className="tv-axle" />
      <line x1="22" y1="30" x2="78" y2="30" className="tv-axle" />
      <line x1="22" y1="100" x2="78" y2="100" className="tv-axle" />
      <rect x="31" y="20" width="38" height="90" rx="12" className="tv-body" />
      <rect x="36" y="38" width="28" height="30" rx="7" className="tv-cab" />
      <circle cx="50" cy="96" r="7" className="tv-spare" />
      {wheel(22, 30, true)}{wheel(78, 30, true)}{wheel(22, 100, false)}{wheel(78, 100, false)}
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
