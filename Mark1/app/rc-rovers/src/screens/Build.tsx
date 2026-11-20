/* Build: the complete MARK 1 build guide. Parts, circuit diagram, every wire, and the
   step-by-step guide from laptop setup to mounting. Ticks are saved on this device. */
import { useState } from 'react';
import { DriveButton, NavMenu } from '../components/Futuristic';
import { Segmented } from '../components/Controls';
import { Icon } from '../components/Icon';
import { createStore, useStore } from '../state/store';
import { haptic } from '../lib/native';
import { Circuit } from '../guide/Circuit';
import { ALL_STEPS, PARTS, PINS, SAFETY, STAGES, WIRE, WIRE_GROUPS, WIRES, type WireGroup } from '../guide/mark1';

type Section = 'parts' | 'circuit' | 'wiring' | 'guide';
type Ticks = Record<string, true>;
interface BuildState { parts: Ticks; wires: Ticks; steps: Ticks }

const KEY = 'rcr-build-mark1';
function load(): BuildState {
  try { const raw = localStorage.getItem(KEY); if (raw) return { parts: {}, wires: {}, steps: {}, ...JSON.parse(raw) }; } catch { /* ignore */ }
  return { parts: {}, wires: {}, steps: {} };
}
const build = createStore<BuildState>(load());
build.subscribe(() => { try { localStorage.setItem(KEY, JSON.stringify(build.get())); } catch { /* ignore */ } });

function toggle(kind: keyof BuildState, id: string) {
  haptic('tick');
  build.set((s) => {
    const next = { ...s[kind] };
    if (next[id]) delete next[id]; else next[id] = true;
    return { [kind]: next };
  });
}

function Check({ on, onClick, label }: { on: boolean; onClick(): void; label: string }) {
  return (
    <button className={`bd-check${on ? ' is-on' : ''}`} role="checkbox" aria-checked={on} aria-label={label} onClick={onClick}>
      {on && <Icon name="check" size={15} />}
    </button>
  );
}

const count = (t: Ticks, ids: string[]) => ids.filter((id) => t[id]).length;

export function Build() {
  const b = useStore(build);
  const [sec, setSec] = useState<Section>('parts');
  const [focus, setFocus] = useState<WireGroup | 'all'>('all');

  const buy = PARTS.filter((p) => !p.have);
  const need = buy.filter((p) => !p.optional);
  const got = count(b.parts, need.map((p) => p.id));
  const wiresDone = count(b.wires, WIRES.map((w) => w.id));
  const stepsDone = count(b.steps, ALL_STEPS.map((s) => s.id));

  return (
    <section className="screen tabscreen">
      <header className="lg-header lg-bar page-head">
        <NavMenu />
        <div className="head-actions"><span className="lg-chip">{stepsDone}/{ALL_STEPS.length} steps</span><DriveButton /></div>
      </header>
      <div className="lg-scroll page-scroll">
        <div className="page-inner">
          <div className="bd-hero">
            <div>
              <h1>Build MARK 1</h1>
              <p className="lg-text-2">Rock crawler · ESP32 · L298N · INA219 · 3S 18650. The complete guide, from parts to driving.</p>
            </div>
            <div className="bd-stats">
              <button className="lg-tile bd-stat" onClick={() => setSec('parts')}><b>{got}/{need.length}</b><small>parts bought</small></button>
              <button className="lg-tile bd-stat" onClick={() => setSec('wiring')}><b>{wiresDone}/{WIRES.length}</b><small>wires done</small></button>
              <button className="lg-tile bd-stat" onClick={() => setSec('guide')}><b>{stepsDone}/{ALL_STEPS.length}</b><small>steps done</small></button>
            </div>
          </div>

          <div className="bd-tabs">
            <Segmented<Section> value={sec} onChange={setSec} size="lg"
              options={[{ id: 'parts', label: 'Parts' }, { id: 'circuit', label: 'Circuit' }, { id: 'wiring', label: 'Wiring' }, { id: 'guide', label: 'Guide' }]} />
          </div>

          {sec === 'parts' && <>
            <h3 className="section-title">Still to buy · tick when it arrives</h3>
            <div className="lg-tile group bd-list">
              {buy.map((p) => (
                <div key={p.id} className={`bd-row${b.parts[p.id] ? ' is-done' : ''}`}>
                  <Check on={!!b.parts[p.id]} onClick={() => toggle('parts', p.id)} label={p.name} />
                  <div className="bd-row-text">
                    <b>{p.name}{p.optional && <span className="lg-chip bd-tag">optional</span>}</b>
                    <small>{p.role}</small>
                  </div>
                  <span className="bd-qty">{p.qty}</span>
                  <span className="bd-price">₹{p.price}</span>
                </div>
              ))}
            </div>
            <h3 className="section-title">Already on the bench</h3>
            <div className="lg-tile group bd-list">
              {PARTS.filter((p) => p.have).map((p) => (
                <div key={p.id} className="bd-row">
                  <span className="bd-have"><Icon name="check" size={15} /></span>
                  <div className="bd-row-text"><b>{p.name}</b><small>{p.role}{p.note ? ` · ${p.note}` : ''}</small></div>
                  <span className="bd-qty">{p.qty}</span>
                </div>
              ))}
            </div>
            <p className="bd-foot lg-text-3">Not needed for MARK 1: a handheld transmitter, a second L298N, a camera. Front + rear drive motors share L298N channel A in parallel.</p>
          </>}

          {sec === 'circuit' && <>
            <div className="bd-tabs bd-filter">
              <Segmented<WireGroup | 'all'> value={focus} onChange={setFocus}
                options={[{ id: 'all', label: 'All' }, ...WIRE_GROUPS]} />
            </div>
            <div className="lg-tile bd-circuit"><Circuit focus={focus} /></div>
            <div className="bd-legend">
              {([['Pack + (9–12.6 V)', WIRE.pack], ['Motor supply ≈ 8.5 V', WIRE.motorV], ['5.0 V logic', WIRE.logic5], ['3.3 V', WIRE.v33], ['Ground', WIRE.gnd],
                ['SDA', WIRE.sda], ['SCL', WIRE.scl], ['PWM (speed)', WIRE.en], ['Direction', WIRE.dir], ['Motor leads', WIRE.motor]] as const).map(([l, c]) => (
                <span key={l}><i style={{ background: c }} />{l}</span>
              ))}
            </div>
            <h3 className="section-title">ESP32 pin map</h3>
            <div className="lg-tile group bd-list">
              {PINS.map((p) => (
                <div key={p.pin} className="bd-row">
                  <span className="bd-pin" style={{ borderColor: p.color }}>{p.pin}</span>
                  <div className="bd-row-text"><b>{p.to}</b><small>{p.purpose}</small></div>
                </div>
              ))}
            </div>
            <h3 className="section-title">L298N truth table (per channel)</h3>
            <div className="lg-tile bd-table">
              <div><b>IN1</b><b>IN2</b><b>ENA</b><b>Result</b></div>
              <div><span>HIGH</span><span>LOW</span><span>PWM x%</span><span>Forward at x%</span></div>
              <div><span>LOW</span><span>HIGH</span><span>PWM x%</span><span>Reverse at x%</span></div>
              <div><span>LOW</span><span>LOW</span><span>any</span><span>Coast</span></div>
              <div><span>HIGH</span><span>HIGH</span><span>HIGH</span><span>Brake</span></div>
            </div>
          </>}

          {sec === 'wiring' && <>
            {WIRE_GROUPS.map((g) => {
              const list = WIRES.filter((w) => w.group === g.id);
              return (
                <div key={g.id}>
                  <h3 className="section-title">{g.label} · {count(b.wires, list.map((w) => w.id))}/{list.length}</h3>
                  <div className="lg-tile group bd-list">
                    {list.map((w) => (
                      <div key={w.id} className={`bd-row${b.wires[w.id] ? ' is-done' : ''}`}>
                        <Check on={!!b.wires[w.id]} onClick={() => toggle('wires', w.id)} label={`${w.from} to ${w.to}`} />
                        <i className="bd-swatch" style={{ background: w.color }} />
                        <div className="bd-row-text">
                          <b>{w.from} <span className="bd-arrow">→</span> {w.to}</b>
                          {w.note && <small>{w.note}</small>}
                        </div>
                        <span className="bd-qty">{w.spec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </>}

          {sec === 'guide' && <>
            <div className="lg-tile bd-safety">
              <b><Icon name="info" size={17} />Safety rules</b>
              <ul>{SAFETY.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            {STAGES.map((st) => {
              const done = count(b.steps, st.steps.map((s) => s.id));
              return (
                <div key={st.id}>
                  <h3 className="section-title">{st.title} · {done}/{st.steps.length}</h3>
                  <p className="bd-goal lg-text-2">{st.goal}</p>
                  <div className="lg-tile group bd-list">
                    {st.steps.map((s, i) => (
                      <div key={s.id} className={`bd-row bd-step${b.steps[s.id] ? ' is-done' : ''}`}>
                        <Check on={!!b.steps[s.id]} onClick={() => toggle('steps', s.id)} label={s.title} />
                        <div className="bd-row-text">
                          <b><span className="bd-n">{i + 1}</span>{s.title}</b>
                          <p>{s.body}</p>
                          {s.code && <code className="bd-code">{s.code}</code>}
                          {s.warn && <p className="bd-warn">⚠️ {s.warn}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </>}
        </div>
      </div>
    </section>
  );
}
