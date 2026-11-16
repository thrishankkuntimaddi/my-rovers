/* The cockpit. The active view (camera / map / gauges) fills the screen; the thumb controls
   float over the left and right edges where your hands already are:
     left  — throttle (touch anywhere, slide up/down)      · Speed hold above it
     right — steering (touch anywhere, slide left/right)   · STOP above it
     centre bottom — speed, drive mode, ignition, Nova mic
   Full view hides everything but the controls; ✕ or Android back brings it back.
   Every widget subscribes only to the values it shows, so telemetry doesn't re-render
   the whole cockpit (that was the lag). */
import { useEffect, useState } from 'react';
import { EStop, Ignition, ModePicker, ThumbZone, TiltPad } from '../components/Controls';
import { BatteryGlyph, Icon, SignalGlyph } from '../components/Icon';
import { MicButton } from '../components/Futuristic';
import { ViewStage } from '../components/Views';
import { setView, stepView, viewLabel, VIEWS } from '../state/views';
import { Sheet } from '../components/Common';
import { useSel, useStore } from '../state/store';
import { settings } from '../state/settings';
import { control, cruise, rover } from '../rover/controller';
import { COURSES } from '../sim/world';
import { fmtTime, PENALTY_MS, startTrial, stopTrial, trial } from '../sim/trials';
import { haptic, keepAwake } from '../lib/native';
import { useBack } from '../lib/back';
import { capture, snapshot, toggleClip } from '../lib/capture';
import { nova } from '../ai/copilot';
import { voice } from '../ai/voice';
import { allMissions, autopilot, missionMs, recorder, runMission, startRecording, stopMission, stopRecording } from '../missions/missions';
import { missions as missionStore } from '../missions/missions';
import { academy, LESSONS, stopLesson } from '../state/academy';
import { startKeyboard, startTilt, stopKeyboard, stopTilt } from '../input/sources';
import { odo } from '../state/odometry';
import { modeSpec } from '../rover/protocol';
import { toast } from '../state/ui';

const useNow = (on: boolean, ms = 500) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!on) return; const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [on, ms]);
  return now;
};
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/* ── top bar ───────────────────────────────────────────────────── */
function LinkChip() {
  const status = useSel(rover, (s) => s.status), kind = useSel(rover, (s) => s.kind);
  if (status === 'lost') return <span className="ck-chip is-red"><span className="spinner sm" />Reconnecting</span>;
  if (kind === 'demo') return <span className="ck-chip"><i className="dot is-blue" />Demo</span>;
  return <span className="ck-chip is-green"><i className="dot" />{kind === 'http' ? 'Basic' : 'Live'}</span>;
}
function Stats() {
  const rssi = useSel(rover, (s) => s.tel.rssi), lat = useSel(rover, (s) => s.latency), pct = useSel(rover, (s) => s.tel.pct);
  const live = useSel(rover, (s) => s.status === 'connected');
  const est = useSel(rover, (s) => (s.tel.estMin == null ? null : Math.round(s.tel.estMin)));
  const tone = pct == null ? '' : pct <= 15 ? ' is-red' : pct <= 30 ? ' is-orange' : '';
  return (
    <div className="ck-stats">
      <span className="ck-stat"><SignalGlyph rssi={rssi} live={live} /><span>{rssi ?? (live ? 'Wi-Fi' : '—')}<small>{rssi != null ? 'dBm' : ''}</small></span></span>
      <span className="ck-stat hide-xs"><Icon name="pulse" size={14} /><span>{lat ?? '—'}<small>ms</small></span></span>
      <span className={`ck-stat${tone}`}><BatteryGlyph pct={pct} /><span>{pct ?? '—'}<small>%</small></span>{est != null && <small className="ck-est hide-sm">~{est} min</small>}</span>
    </div>
  );
}
function ClipButton() {
  const cap = useStore(capture);
  const now = useNow(cap.clip);
  return (
    <button className={`ck-btn rec-btn${cap.clip ? ' is-on' : ''}`} onClick={toggleClip} aria-label={cap.clip ? 'Stop video' : 'Record video'}>
      <Icon name={cap.clip ? 'stop' : 'video'} size={17} />{cap.clip && <span className="ck-rec-t">{mmss(Math.floor((now - cap.since) / 1000))}</span>}
    </button>
  );
}

/* ── view switcher: ◀ name ▶ + dots (or swipe the picture) ─────── */
function ViewSwitcher() {
  const view = useSel(settings, (s) => s.view);
  return (
    <div className="ck-views" onPointerDown={(e) => e.stopPropagation()}>
      <button className="ck-arrow" onClick={() => stepView(-1)} aria-label="Previous view"><Icon name="back" size={16} /></button>
      <div className="ck-view-name"><b>{viewLabel(view)}</b>
        <span className="ck-dots">{VIEWS.map((v) => <button key={v.id} className={v.id === view ? 'is-on' : ''} onClick={() => setView(v.id)} aria-label={v.label} />)}</span>
      </div>
      <button className="ck-arrow" onClick={() => stepView(1)} aria-label="Next view"><Icon name="chevron" size={16} /></button>
    </div>
  );
}

/* ── Nova / mission / route-recording strip ────────────────────── */
function NovaBubble() {
  const v = useStore(voice);
  const reply = useSel(nova, (n) => n.lastReply);
  const ap = useStore(autopilot);
  const rec = useSel(recorder, (r) => (r.on ? r.since : 0));
  const now = useNow(!!rec);
  const [shown, setShown] = useState('');
  useEffect(() => { if (!reply) return; setShown(reply); const t = setTimeout(() => setShown(''), 7000); return () => clearTimeout(t); }, [reply]);
  let body = null;
  if (ap.running) body = (
    <span className="ck-mission">
      <b>{ap.running.name}</b>
      <span className="ck-bar"><i style={{ transform: `scaleX(${ap.progress})` }} /></span>
      <span>{Math.max(0, (ap.total - ap.elapsed) / 1000).toFixed(1)} s</span>
      <button className="ck-pill" onClick={() => stopMission('stopped by you')}><Icon name="stop" size={13} />Take over</button>
    </span>
  );
  else if (v.listening || v.partial) body = <span className="ck-say is-live"><i className="ck-lvl" style={{ transform: `scaleX(${0.15 + v.level * 0.85})` }} />{v.partial || (v.offline ? 'Listening (offline)…' : 'Listening…')}</span>;
  else if (shown) body = <span className="ck-say"><Icon name="spark" size={14} />{shown}</span>;
  return (
    <div className="ck-nova">
      {body && <div className="ck-bubble">{body}</div>}
      {rec > 0 && <span className="ck-route-rec" onPointerDown={(e) => e.stopPropagation()} onClick={() => { const m = stopRecording(true); toast(m ? `Saved “${m.name}” to Missions` : 'Nothing recorded', m ? 'good' : 'neutral'); }}><i />ROUTE {mmss(Math.floor((now - rec) / 1000))} · tap to save</span>}
    </div>
  );
}

function LessonBanner() {
  const a = useStore(academy);
  if (!a.lesson) return null;
  const l = LESSONS.find((x) => x.id === a.lesson)!;
  return (
    <div className="ck-banner">
      <Icon name="school" size={16} />
      <div className="ck-banner-text"><b>{l.title}</b><span>{l.goal}</span></div>
      <span className="ck-meter"><i style={{ transform: `scaleX(${a.lessonProgress})` }} /></span>
      <button className="ck-x" onClick={stopLesson} aria-label="End lesson"><Icon name="x" size={14} /></button>
    </div>
  );
}

function TrialBanner() {
  const t = useStore(trial);
  const [now, setNow] = useState(0);
  useEffect(() => { if (t.phase !== 'running') return; const id = setInterval(() => setNow(performance.now()), 100); return () => clearInterval(id); }, [t.phase]);
  if (t.phase === 'idle') return null;
  const c = COURSES.find((x) => x.id === t.course)!;
  const best = t.best[c.id];
  if (t.phase === 'done' && t.result) {
    const r = t.result;
    return (
      <div className="ck-banner is-done">
        <span>{r.best ? '🏆' : '🏁'}</span>
        <div className="ck-banner-text">
          <b>{c.name} · {fmtTime(r.ms)}{r.best && <em className="trial-new">{r.prevBest == null ? 'First run' : 'New best'}</em>}</b>
          <span>{r.bumps ? `${fmtTime(r.raw)} + ${r.bumps} bump${r.bumps > 1 ? 's' : ''}` : 'Clean run'} · par {fmtTime(r.par)}{r.ms <= r.par ? ' ✓' : ''}</span>
        </div>
        <button className="ck-pill" onClick={() => startTrial(c.id)}><Icon name="refresh" size={13} />Retry</button>
        <button className="ck-x" onClick={stopTrial} aria-label="Close trial"><Icon name="x" size={14} /></button>
      </div>
    );
  }
  const ms = t.phase === 'running' ? Math.max(0, now - t.t0) + t.bumps * PENALTY_MS : 0;
  return (
    <div className="ck-banner">
      <span>{c.icon}</span>
      <div className="ck-banner-text">
        <b>{c.name}</b>
        <span>{t.phase === 'countdown' ? `Get ready… ${t.count}` : `Gate ${Math.min(t.next + 1, c.gates.length)}/${c.gates.length}`}{t.bumps ? ` · ${t.bumps}× +${PENALTY_MS / 1000}s` : ''}{best ? ` · best ${fmtTime(best)}` : ''}</span>
      </div>
      <span className="ck-trial-time">{fmtTime(ms)}</span>
      <button className="ck-x" onClick={stopTrial} aria-label="Quit trial"><Icon name="x" size={14} /></button>
    </div>
  );
}

/* ── speed hold (cruise control): lives next to the throttle it holds ── */
function SpeedHold() {
  const c = useStore(cruise);
  const armed = useSel(rover, (s) => s.status === 'connected' && s.tel.armed);
  return (
    <button className={`ck-hold${c.on ? ' is-on' : ''}${armed ? '' : ' is-off'}`} onClick={() => control.cruise()} aria-pressed={c.on} aria-label="Speed hold">
      <Icon name="cruise" size={17} />
      <span><b>{c.on ? `Holding ${Math.abs(c.thr)}% ${c.thr > 0 ? '▲' : '▼'}` : 'Speed hold'}</b><small>{c.on ? 'Touch throttle or tap to release' : 'Locks your current speed'}</small></span>
    </button>
  );
}

/* ── speed cluster ─────────────────────────────────────────────── */
function SpeedCluster() {
  const kmh = useSel(odo, (o) => Math.round(o.speed * 36) / 10);
  const thr = useSel(rover, (s) => s.tel.thr), mode = useSel(rover, (s) => s.tel.mode), armed = useSel(rover, (s) => s.tel.armed);
  const gear = !armed ? 'P' : thr > 1 ? 'D' : thr < -1 ? 'R' : 'N';
  const cap = modeSpec(mode).cap;
  return (
    <div className={`ck-speed${gear === 'R' ? ' is-rev' : ''}`}>
      <span className={`ck-gear is-${gear}`}>{gear}</span>
      <b className="ck-kmh">{kmh.toFixed(1)}</b>
      <span className="ck-unit">km/h</span>
      <span className="ck-out"><i style={{ transform: `scaleX(${Math.min(1, Math.abs(thr) / 100)})` }} /><em style={{ left: `${cap}%` }} /></span>
    </div>
  );
}

function MissionPicker({ open, onClose }: { open: boolean; onClose(): void }) {
  useStore(missionStore);
  const r = useStore(rover);
  const rec = useStore(recorder);
  const run = (id: string) => {
    const m = allMissions().find((x) => x.id === id)!;
    const go = () => { const res = runMission(m); if (!res.ok) toast(res.reason!, 'warn'); else onClose(); };
    if (!r.tel.armed && r.status === 'connected') { control.arm(); haptic('success'); setTimeout(go, 400); } else go();
  };
  const t = useStore(trial);
  const demo = r.kind === 'demo' && r.status === 'connected';
  const go = (id: string) => { const res = startTrial(id); if (!res.ok) toast(res.reason!, 'warn'); else onClose(); };
  const toggleRoute = () => {
    if (rec.on) { const m = stopRecording(true); toast(m ? `Saved “${m.name}” to Missions` : 'Nothing recorded', m ? 'good' : 'neutral'); }
    else { startRecording(); toast('Recording your route: drive, then tap ROUTE to save', 'neutral', 2400); onClose(); }
    haptic('medium');
  };
  return (
    <Sheet open={open} onClose={onClose} title="Missions & trials">
      <h3 className="section-title sheet-sub"><Icon name="record" size={15} />Route recorder</h3>
      <div className="pick-list">
        <button className="pick lg-tile lg-pressable" onClick={toggleRoute}>
          <span className="pick-icon">{rec.on ? '■' : '●'}</span>
          <span className="pick-text"><b>{rec.on ? 'Stop and save route' : 'Record a route'}</b><small>Saves your driving as a mission you can replay</small></span>
        </button>
      </div>
      <h3 className="section-title sheet-sub"><Icon name="flag" size={15} />Time trials {!demo && <small>· demo rover</small>}</h3>
      <div className="pick-list">
        {COURSES.map((c) => (
          <button key={c.id} className="pick lg-tile lg-pressable" disabled={!demo} onClick={() => go(c.id)}>
            <span className="pick-icon">{c.icon}</span>
            <span className="pick-text"><b>{c.name}</b><small>{c.desc} · {c.gates.length} gates · par {fmtTime(c.par)}</small></span>
            <span className="pick-best">{t.best[c.id] ? fmtTime(t.best[c.id]) : '—'}</span>
          </button>
        ))}
      </div>
      <h3 className="section-title sheet-sub"><Icon name="route" size={15} />Autopilot missions</h3>
      <p className="lg-text-2 sheet-note">The rover arms itself and drives the route. Touch any control to take over instantly.</p>
      <div className="pick-list">
        {allMissions().map((m) => (
          <button key={m.id} className="pick lg-tile lg-pressable" onClick={() => run(m.id)}>
            <span className="pick-icon">{m.icon}</span>
            <span className="pick-text"><b>{m.name}</b><small>{m.desc} · {(missionMs(m) / 1000).toFixed(1)} s</small></span>
            <Icon name="play" size={16} />
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function Drive({ onBack, onTelemetry, onSettings }: { onBack(): void; onTelemetry(): void; onSettings(): void }) {
  const status = useSel(rover, (s) => s.status);
  const name = useSel(rover, (s) => s.info?.name ?? 'MARK 1');
  const armed = useSel(rover, (s) => s.tel.armed);
  const mode = useSel(rover, (s) => s.tel.mode);
  const layout = useSel(settings, (s) => s.layout), swap = useSel(settings, (s) => s.swapSides);
  const tiltOn = useSel(settings, (s) => s.steerSource === 'tilt'), awake = useSel(settings, (s) => s.keepAwake);
  const [picker, setPicker] = useState(false);
  const [focus, setFocus] = useState(false);
  const live = status === 'connected';

  useEffect(() => { control.setDriving(true); startKeyboard(); return () => { control.setDriving(false); stopKeyboard(); }; }, []);
  useEffect(() => { keepAwake(awake); return () => keepAwake(false); }, [awake]);
  useEffect(() => { if (tiltOn) { startTilt(); return () => stopTilt(); } }, [tiltOn]);
  useBack(true, onBack);
  useBack(focus, () => setFocus(false));

  const left: 'thr' | 'str' | 'stick' | null = layout === 'stick' ? (swap ? null : 'stick') : swap ? 'str' : 'thr';
  const right: 'thr' | 'str' | 'stick' | null = layout === 'stick' ? (swap ? 'stick' : null) : swap ? 'thr' : 'str';
  const zone = (side: 'left' | 'right', kind: typeof left) => {
    if (kind === 'str' && tiltOn) return <div className={`thumb is-${side} is-tilt`}><TiltPad /></div>;
    if (!kind) return <div className={`thumb is-${side} is-empty`} />;
    return <ThumbZone key={`${side}-${kind}`} kind={kind} side={side} armed={armed} steerTilt={tiltOn} />;
  };
  const estop = () => { stopMission('emergency stop', true); control.estop(); haptic('heavy'); };

  return (
    <section className={`screen ck${focus ? ' is-focus' : ''}${live ? '' : ' is-offline'}${armed ? ' is-armed' : ''}`}>
      <ViewStage />

      <header className="ck-top">
        <button className="ck-btn" onClick={onBack} aria-label="Back to garage"><Icon name="back" size={18} /></button>
        <div className="ck-title"><b>{name}</b><LinkChip /></div>
        <Stats />
        <div className="ck-actions">
          <button className="ck-btn" onClick={snapshot} aria-label="Take photo"><Icon name="aperture" size={17} /></button>
          <ClipButton />
          <button className="ck-btn" onClick={() => setFocus(true)} aria-label="Full view"><Icon name="expand" size={17} /></button>
          <button className="ck-btn" onClick={() => setPicker(true)} aria-label="Missions"><Icon name="route" size={17} /></button>
          <button className="ck-btn hide-xs" onClick={onTelemetry} aria-label="Telemetry"><Icon name="pulse" size={17} /></button>
          <button className="ck-btn" onClick={onSettings} aria-label="Settings"><Icon name="gear" size={17} /></button>
        </div>
      </header>
      {focus && (
        <button className="ck-exit" onClick={() => setFocus(false)} aria-label="Exit full view"><Icon name="shrink" size={17} /><span>Exit full view</span></button>
      )}

      <div className="ck-center-top">
        <ViewSwitcher />
        <LessonBanner />
        <TrialBanner />
        <NovaBubble />
      </div>

      {zone('left', left)}
      {zone('right', right)}

      <div className="ck-side is-left"><SpeedHold /></div>
      <div className="ck-side is-right"><EStop disabled={!live} onStop={estop} /></div>

      <div className="ck-console">
        <SpeedCluster />
        <div className="ck-modes"><ModePicker value={mode} onChange={(m) => control.mode(m)} /></div>
        <div className="ck-ign-row">
          <Ignition armed={armed} disabled={!live} onArm={() => control.arm()} onDisarm={() => control.disarm()} />
          <MicButton />
        </div>
      </div>

      {status === 'lost' && <div className="lost-veil"><span className="spinner" />Reconnecting to rover…</div>}
      <MissionPicker open={picker} onClose={() => setPicker(false)} />
    </section>
  );
}
