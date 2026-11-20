/* MARK 1 full circuit: pack → fuse → switch → INA219 → motor buck → L298N → motors,
   and → logic buck → ESP32, plus the control and I²C wires. Pure SVG, themed by CSS vars.
   `focus` dims every wire group except one. */
import type { ReactNode } from 'react';
import { WIRE, type WireGroup } from './mark1';

type Pt = [number, number];

function W({ d, c, g, focus }: { d: string; c: string; g: WireGroup; focus: WireGroup | 'all' }) {
  return <path d={d} className={`cd-wire${focus !== 'all' && focus !== g ? ' is-dim' : ''}`} style={{ stroke: c }} />;
}
function Dot({ at: [x, y], c, g, focus }: { at: Pt; c: string; g: WireGroup; focus: WireGroup | 'all' }) {
  return <circle cx={x} cy={y} r={4.5} className={`cd-dot${focus !== 'all' && focus !== g ? ' is-dim' : ''}`} style={{ fill: c }} />;
}
function Box({ x, y, w, h, title, sub, children }: { x: number; y: number; w: number; h: number; title: string; sub?: string[]; children?: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={14} className="cd-box" />
      <text x={x + w / 2} y={y + h / 2 - (sub ? sub.length * 9 : 0) + 5} className="cd-t">{title}</text>
      {sub?.map((s, i) => <text key={s} x={x + w / 2} y={y + h / 2 - sub.length * 9 + 26 + i * 18} className="cd-s">{s}</text>)}
      {children}
    </g>
  );
}
const PinL = ({ x, y, t }: { x: number; y: number; t: string }) => <text x={x} y={y + 4} className="cd-p" textAnchor="start">{t}</text>;
const PinR = ({ x, y, t }: { x: number; y: number; t: string }) => <text x={x} y={y + 4} className="cd-p" textAnchor="end">{t}</text>;
const PinC = ({ x, y, t }: { x: number; y: number; t: string }) => <text x={x} y={y} className="cd-p" textAnchor="middle">{t}</text>;

// ESP32 top-edge pins (drawing order, not physical order) and where the L298N control pins sit
const ESP: Record<string, number> = { VIN: 430, GND: 470, '3V3': 510, D21: 570, D22: 600, D25: 670, D26: 705, D27: 740, D32: 775, D33: 810, D13: 845 };
const CTRL: [string, string, number, number, string][] = [
  // esp pin, l298 pin, l298 x, lane y, colour
  ['D25', 'ENA', 980, 380, WIRE.en], ['D26', 'IN1', 1005, 395, WIRE.dir], ['D27', 'IN2', 1030, 410, WIRE.dir],
  ['D32', 'IN3', 1060, 425, WIRE.dir], ['D33', 'IN4', 1085, 440, WIRE.dir], ['D13', 'ENB', 1110, 455, WIRE.en],
];

export function Circuit({ focus = 'all' }: { focus?: WireGroup | 'all' }) {
  const f = focus;
  return (
    <svg className="circuit" viewBox="0 0 1320 600" role="img" aria-label="MARK 1 wiring diagram">
      {/* ── wires (under the boxes) ── */}
      {/* pack + → fuse → switch → INA219 → split to both bucks */}
      <W g="power" d="M210 97 H245 M325 97 H355 M445 97 H480" c={WIRE.pack} focus={f} />
      <W g="power" d="M640 97 H670 V70 H710 M670 97 V200 H710" c={WIRE.pack} focus={f} />
      <Dot at={[670, 97]} c={WIRE.pack} g="power" focus={f} />
      {/* ground rail */}
      <W g="power" d="M210 163 H222 V300 H910 M710 104 H684 V300 M710 234 H696 V300 M890 234 H910 V300" c={WIRE.gnd} focus={f} />
      <Dot at={[684, 300]} c={WIRE.gnd} g="power" focus={f} />
      <Dot at={[696, 300]} c={WIRE.gnd} g="power" focus={f} />
      {/* motor buck → L298N */}
      <W g="power" d="M890 70 H960" c={WIRE.motorV} focus={f} />
      <W g="power" d="M890 104 H960" c={WIRE.gnd} focus={f} />
      {/* logic buck 5 V → ESP32 VIN */}
      <W g="power" d={`M890 200 H925 V360 H${ESP.VIN} V470`} c={WIRE.logic5} focus={f} />
      {/* ESP32 GND → rail (common ground for L298N signals + INA219) */}
      <W g="control" d={`M${ESP.GND} 470 V300`} c={WIRE.gnd} focus={f} />
      <Dot at={[ESP.GND, 300]} c={WIRE.gnd} g="control" focus={f} />
      {/* INA219 sensor wires */}
      <W g="sensor" d="M540 170 V300" c={WIRE.gnd} focus={f} />
      <Dot at={[540, 300]} c={WIRE.gnd} g="sensor" focus={f} />
      <W g="sensor" d={`M${ESP['3V3']} 470 V170`} c={WIRE.v33} focus={f} />
      <W g="sensor" d={`M${ESP.D21} 470 V170`} c={WIRE.sda} focus={f} />
      <W g="sensor" d={`M${ESP.D22} 470 V170`} c={WIRE.scl} focus={f} />
      {/* control: ESP32 → L298N */}
      {CTRL.map(([p, , lx, ly, c]) => <W key={p} g="control" d={`M${ESP[p]} 470 V${ly} H${lx} V260`} c={c} focus={f} />)}
      {/* motors: channel A in parallel, channel B steering */}
      <W g="motors" d="M1140 62 H1165 M1165 52 V132 M1165 52 H1215 M1165 132 H1215" c={WIRE.motor} focus={f} />
      <W g="motors" d="M1140 88 H1185 M1185 68 V148 M1185 68 H1215 M1185 148 H1215" c={WIRE.motor} focus={f} />
      <Dot at={[1165, 62]} c={WIRE.motor} g="motors" focus={f} />
      <Dot at={[1185, 88]} c={WIRE.motor} g="motors" focus={f} />
      <W g="motors" d="M1140 195 H1180 V200 H1215 M1140 221 H1190 V216 H1215" c={WIRE.motor} focus={f} />

      {/* ── components ── */}
      <Box x={30} y={50} w={180} h={140} title="BATTERY PACK" sub={['3 × 18650 · 3S + BMS', '9.0–12.6 V · 2000 mAh']}>
        <PinR x={202} y={97} t="P+" /><PinR x={202} y={163} t="P−" />
      </Box>
      <text x={120} y={214} className="cd-s">Charge: 12.6 V charger → P+ / P−</text>
      <Box x={245} y={84} w={80} h={26} title="FUSE 3 A" />
      <Box x={355} y={84} w={90} h={26} title="SWITCH" />
      <Box x={480} y={50} w={160} h={120} title="INA219" sub={['current sensor', 'I²C 0x40']}>
        <PinL x={486} y={97} t="VIN+" /><PinR x={634} y={97} t="VIN−" />
        <PinC x={510} y={162} t="VCC" /><PinC x={540} y={162} t="GND" /><PinC x={570} y={162} t="SDA" /><PinC x={600} y={162} t="SCL" />
      </Box>
      <Box x={710} y={40} w={180} h={80} title="MOTOR BUCK" sub={['XL4015 · set ≈ 8.5 V']}>
        <PinL x={716} y={70} t="IN+" /><PinL x={716} y={104} t="IN−" /><PinR x={884} y={70} t="OUT+" /><PinR x={884} y={104} t="OUT−" />
      </Box>
      <Box x={710} y={170} w={180} h={80} title="LOGIC BUCK" sub={['LM2596 · set 5.0 V']}>
        <PinL x={716} y={200} t="IN+" /><PinL x={716} y={234} t="IN−" /><PinR x={884} y={200} t="OUT+" /><PinR x={884} y={234} t="OUT−" />
      </Box>
      <Box x={960} y={40} w={180} h={220} title="L298N" sub={['motor driver', '5V-EN jumper ON']}>
        <PinL x={966} y={70} t="12V" /><PinL x={966} y={104} t="GND" /><PinL x={966} y={138} t="5V" />
        <PinR x={1134} y={62} t="OUT1" /><PinR x={1134} y={88} t="OUT2" /><PinR x={1134} y={195} t="OUT3" /><PinR x={1134} y={221} t="OUT4" />
        {CTRL.map(([, l, lx]) => <PinC key={l} x={lx} y={252} t={l} />)}
      </Box>
      <text x={954} y={142} className="cd-p cd-nc" textAnchor="end">empty ✕</text>
      {[['F', 60, 'Front'], ['R', 140, 'Rear'], ['S', 208, 'Steering']].map(([m, y, label]) => (
        <g key={m}>
          <circle cx={1233} cy={Number(y)} r={18} className="cd-box" />
          <text x={1233} y={Number(y) + 5} className="cd-t">M</text>
          <text x={1257} y={Number(y) + 4} className="cd-s cd-left">{label}</text>
        </g>
      ))}
      <text x={1233} y={176} className="cd-s">A: in parallel</text>
      <Box x={400} y={470} w={480} h={110} title="ESP32 DevKit V1" sub={['Wi-Fi brain · micro-USB to laptop']}>
        {Object.entries(ESP).map(([p, x]) => <PinC key={p} x={x} y={490} t={p} />)}
      </Box>

      {/* wire labels */}
      <text x={925} y={62} className="cd-w">≈ 8.5 V</text>
      <text x={932} y={330} className="cd-w cd-left">5.0 V</text>
      <text x={300} y={292} className="cd-w">GND (common)</text>
      <text x={285} y={76} className="cd-w">9–12.6 V</text>
      <text x={585} y={445} className="cd-w">I²C</text>
      <text x={1045} y={482} className="cd-w">PWM + direction</text>
    </svg>
  );
}
