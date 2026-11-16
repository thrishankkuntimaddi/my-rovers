import { useEffect, useState } from 'react';
import { AxisControl, EStop, Ignition, Joystick, ModePicker, Segmented, TiltPad } from '../components/Controls';
import { Gauge, RoverTopView } from '../components/Hud';
import { BatteryGlyph, Icon, SignalGlyph } from '../components/Icon';
import { MicButton, TrailMap } from '../components/Futuristic';
import { CameraView } from '../components/Camera';
import { Sheet } from '../components/Common';
import { useStore } from '../state/store';
import { settings, type HudView } from '../state/settings';
import { control, cruise, rover } from '../rover/controller';
import { haptic, keepAwake } from '../lib/native';
import { useBack } from '../lib/back';
import { nova } from '../ai/copilot';
import { voice } from '../ai/voice';
import { allMissions, autopilot, missionMs, recorder, runMission, startRecording, stopMission, stopRecording } from '../missions/missions';
import { missions as missionStore } from '../missions/missions';
import { academy, LESSONS, stopLesson } from '../state/academy';
import { startKeyboard, startTilt, stopKeyboard, stopTilt } from '../input/sources';
import { odo, resetOdo } from '../state/odometry';
import { toast } from '../state/ui';

function NovaStrip() {
  const v = useStore(voice);
  const n = useStore(nova);
  const ap = useStore(autopilot);
  const rec = useStore(recorder);
  const [, tick] = useState(0);
  useEffect(() => { if (!rec.on) return; const t = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(t); }, [rec.on]);
  let body;
  if (v.listening || v.partial) body = <span className="strip-text is-live">{v.partial || 'Listening…'}</span>;
  else if (ap.running) body = (
    <span className="strip-mission">
      <b>{ap.running.name}</b>
      <span className="strip-bar"><i style={{ transform: `scaleX(${ap.progress})` }} /></span>
      <span className="lg-text-2">{Math.max(0, (ap.total - ap.elapsed) / 1000).toFixed(1)} s</span>
      <button className="lg-btn strip-stop" onClick={() => stopMission('stopped by you')}><Icon name="stop" size={15} />Take over</button>
    </span>
  );
  else body = <span className="strip-text"><Icon name="spark" size={15} />{n.lastReply || 'Hold the mic and talk to Nova: “forward slowly for 2 seconds”'}</span>;
  return (
    <div className="nova-strip lg-tile">
      <MicButton />
      <div className="strip-body">{body}</div>
      {rec.on && <span className="rec-pill"><i />REC {Math.floor((Date.now() - rec.since) / 1000)}s</span>}
    </div>
  );
}

function LessonBanner() {
  const a = useStore(academy);
  if (!a.lesson) return null;
  const l = LESSONS.find((x) => x.id === a.lesson)!;
  return (
    <div className="lesson-banner">
      <Icon name="school" size={17} />
      <div className="lesson-text"><b>{l.title}</b><span>{l.goal}</span></div>
      <span className="lesson-meter"><i style={{ transform: `scaleX(${a.lessonProgress})` }} /></span>
      <button className="lg-icon-btn sm" onClick={stopLesson} aria-label="End lesson"><Icon name="x" size={15} /></button>
    </div>
  );
}

function CruiseButton() {
  const c = useStore(cruise);
  return (
    <button className={`cruise-btn${c.on ? ' is-on' : ''}`} onClick={() => control.cruise()} aria-pressed={c.on} aria-label="Speed hold">
      <Icon name="cruise" size={15} /><span>{c.on ? `Holding ${Math.abs(c.thr)}% ${c.thr > 0 ? '▲' : '▼'}` : 'Speed hold'}</span>
    </button>
  );
}

function MissionPicker({ open, onClose }: { open: boolean; onClose(): void }) {
  useStore(missionStore);
  const r = useStore(rover);
  const run = (id: string) => {
    const m = allMissions().find((x) => x.id === id)!;
    const go = () => { const res = runMission(m); if (!res.ok) toast(res.reason!, 'warn'); else onClose(); };
    if (!r.tel.armed && r.status === 'connected') { control.arm(); haptic('success'); setTimeout(go, 400); } else go();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Missions">
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

/** Power rail: battery bar, voltage and estimated drive time left. */
function PowerRail() {
  const { tel } = useStore(rover);
  const pct = tel.pct;
  const tone = pct == null ? '' : pct <= 15 ? ' is-red' : pct <= 30 ? ' is-orange' : '';
  const left = tel.estMin == null ? null : tel.estMin >= 10 ? `${Math.round(tel.estMin)} min` : `${Math.floor(tel.estMin)}:${String(Math.round((tel.estMin % 1) * 60)).padStart(2, '0')}`;
  return (
    <div className={`power${tone}`}>
      <div className="power-head"><span className="lg-label">Power</span><b>{pct != null ? `${pct}%` : '—'}</b></div>
      <div className="power-bar">{Array.from({ length: 20 }, (_, i) => <i key={i} className={pct != null && i < Math.ceil(pct / 5) ? 'is-on' : ''} />)}</div>
      <div className="power-sub"><span>{tel.vbat != null ? `${tel.vbat.toFixed(2)} V` : 'no sensor'}</span><span>{left ? `${left} left` : 'learning…'}</span></div>
    </div>
  );
}

/** Trip read-out: estimated speed, distance, top speed, drive time. */
function TripPanel() {
  const o = useStore(odo);
  const { tel } = useStore(rover);
  const up = tel.up;
  const cells: [string, string, string][] = [
    ['Speed', o.speed.toFixed(1), 'm/s'],
    ['Distance', o.dist < 100 ? o.dist.toFixed(1) : Math.round(o.dist).toString(), 'm'],
    ['Top speed', o.maxSpeed.toFixed(1), 'm/s'],
    ['Session', `${Math.floor(up / 60)}:${String(up % 60).padStart(2, '0')}`, 'min'],
  ];
  return (
    <div className="trip">
      {cells.map(([k, v, u]) => <div key={k} className="trip-cell"><span className="lg-label">{k}</span><b>{v}<small>{u}</small></b></div>)}
    </div>
  );
}

export function Drive({ onBack, onTelemetry, onSettings }: { onBack(): void; onTelemetry(): void; onSettings(): void }) {
  const r = useStore(rover);
  const s = useStore(settings);
  const rec = useStore(recorder);
  const [picker, setPicker] = useState(false);
  const [camWanted, setCamFull] = useState(false);
  const { tel } = r;
  const live = r.status === 'connected';
  const camFull = camWanted && s.hudView === 'camera';

  useEffect(() => { control.setDriving(true); startKeyboard(); return () => { control.setDriving(false); stopKeyboard(); }; }, []);
  useEffect(() => { keepAwake(s.keepAwake); return () => keepAwake(false); }, [s.keepAwake]);
  useEffect(() => { if (s.steerSource === 'tilt') { startTilt(); return () => stopTilt(); } }, [s.steerSource]);

  const link = r.status === 'lost'
    ? <span className="lg-chip is-red"><span className="spinner sm" />Reconnecting</span>
    : r.kind === 'demo' ? <span className="lg-chip"><i className="dot is-blue" />Demo</span>
    : r.kind === 'http' ? <span className="lg-chip is-green"><i className="dot" />Basic</span>
    : <span className="lg-chip is-green"><i className="dot" />Live</span>;
  const batTone = tel.pct == null ? '' : tel.pct <= 15 ? ' is-red' : tel.pct <= 30 ? ' is-orange' : '';
  const toggleRec = () => { if (rec.on) { const m = stopRecording(true); toast(m ? `Saved “${m.name}” to Missions` : 'Nothing recorded', m ? 'good' : 'neutral'); } else { startRecording(); toast('Recording your drive', 'neutral', 1600); } haptic('medium'); };
  const toggleCam = () => { settings.set({ hudView: s.hudView === 'camera' ? 'gauge' : 'camera' }); haptic('light'); };

  const tiltOn = s.steerSource === 'tilt';
  const thrCtl = <AxisControl axis="thr" armed={tel.armed} label="Throttle" hints={['D', 'R']} />;
  const strCtl = tiltOn ? <TiltPad /> : <AxisControl axis="str" armed={tel.armed} label="Steering" hints={['L', 'R']} />;
  const stick = <Joystick armed={tel.armed} steerTilt={tiltOn} />;
  // two thumbs: throttle left, steering right (swap in Settings) · joystick: right side (left if swapped)
  const leftCtl = s.layout === 'stick' ? (s.swapSides ? stick : null) : s.swapSides ? strCtl : thrCtl;
  const rightCtl = s.layout === 'stick' ? (s.swapSides ? null : stick) : s.swapSides ? thrCtl : strCtl;
  useBack(true, onBack);
  useBack(camFull, () => setCamFull(false));

  return (
    <section className={`screen drive cockpit layout-${s.layout}${live ? '' : ' is-offline'}${camFull ? ' is-camfull' : ''}${tel.armed ? ' is-armed' : ''}`}>
      {camFull && <div className="cam-backdrop"><CameraView full onToggleFull={() => setCamFull(false)} /></div>}
      <header className="lg-bar drive-bar">
        <button className="lg-icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={18} /></button>
        <div className="drive-title"><b>{r.info?.name ?? 'MARK 1'}</b>{link}</div>
        <div className="drive-stats">
          <span className="stat stat-signal" title="Signal"><SignalGlyph rssi={tel.rssi} live={live} /><span>{tel.rssi != null ? tel.rssi : live ? 'Wi-Fi' : '—'}<small>dBm</small></span></span>
          <span className="stat hide-xs" title="Latency"><Icon name="pulse" size={14} /><span>{r.latency != null ? r.latency : '—'}<small>ms</small></span></span>
          <span className={`stat${batTone}`} title="Battery"><BatteryGlyph pct={tel.pct} /><span>{tel.pct != null ? tel.pct : '—'}<small>%</small></span></span>
        </div>
        <div className="head-actions">
          {camFull
            ? <button className="lg-btn exit-full" onClick={() => setCamFull(false)}><Icon name="shrink" size={16} />Exit full screen</button>
            : <button className={`lg-icon-btn${s.hudView === 'camera' ? ' is-on' : ''}`} onClick={toggleCam} aria-label="Camera view"><Icon name="camera" size={17} /></button>}
          <button className={`lg-icon-btn rec-btn${rec.on ? ' is-on' : ''}`} onClick={toggleRec} aria-label={rec.on ? 'Stop recording route' : 'Record route'}><Icon name="record" size={16} /></button>
          <button className="lg-icon-btn" onClick={() => setPicker(true)} aria-label="Missions"><Icon name="route" size={17} /></button>
          <button className="lg-icon-btn hide-xs" onClick={onTelemetry} aria-label="Telemetry"><Icon name="pulse" size={17} /></button>
          <button className="lg-icon-btn" onClick={onSettings} aria-label="Settings"><Icon name="gear" size={17} /></button>
        </div>
      </header>

      <div className="drive-grid">
        <div className="zone zone-left lg-tile">
          <CruiseButton />
          <div className="ctl-slot">{leftCtl}</div>
        </div>

        <div className="zone zone-center">
          <LessonBanner />
          {!camFull && (
            <div className={`hud lg-tile is-${s.hudView}`}>
              <div className="hud-top">
                <Segmented<HudView> value={s.hudView} onChange={(v) => settings.set({ hudView: v })}
                  options={[{ id: 'gauge', label: 'Gauge' }, { id: 'map', label: 'Map' }, { id: 'camera', label: 'Camera' }]} />
                <div className="hud-flags">
                  {s.hudView === 'map' && <button className="lg-btn hud-reset" onClick={() => { resetOdo(); haptic('light'); }}>Reset</button>}
                  <span className={`hud-flag${tel.armed ? ' is-armed' : ''}`}><i />{tel.armed ? 'ARMED' : 'SAFE'}</span>
                </div>
              </div>
              <div className={`hud-main is-${s.hudView}`}>
                {s.hudView === 'map' ? <TrailMap />
                  : s.hudView === 'camera' ? <CameraView onToggleFull={() => setCamFull(true)} />
                  : <><Gauge thr={tel.thr} mode={tel.mode} /><RoverTopView thr={tel.thr} str={tel.str} /></>}
              </div>
              <div className="hud-line">
                <span className="hud-kv">Steer <b>{tel.str > 0 ? 'R' : tel.str < 0 ? 'L' : ''}{Math.abs(Math.round(tel.str))}</b></span>
                <span className="hud-kv">Trim <b>{s.trim > 0 ? '+' : ''}{s.trim}</b></span>
                <span className="hud-kv hide-sm">Runtime <b>{tel.estMin != null ? `~${tel.estMin < 10 ? tel.estMin.toFixed(1) : Math.round(tel.estMin)} min` : '—'}</b></span>
                {s.steerSource === 'tilt' && <span className="hud-kv"><b>Tilt</b></span>}
              </div>
            </div>
          )}
          <NovaStrip />
          <div className="console">
            <ModePicker value={tel.mode} onChange={(m) => control.mode(m)} />
            <Ignition armed={tel.armed} disabled={!live} onArm={() => control.arm()} onDisarm={() => control.disarm()} />
          </div>
        </div>

        <div className="zone zone-right lg-tile">
          <EStop disabled={!live} onStop={() => { stopMission('emergency stop', true); control.estop(); haptic('heavy'); }} />
          <PowerRail />
          <TripPanel />
          <div className="ctl-slot">{rightCtl}</div>
        </div>
      </div>

      {r.status === 'lost' && <div className="lost-veil"><span className="spinner" />Reconnecting to rover…</div>}
      <MissionPicker open={picker} onClose={() => setPicker(false)} />
    </section>
  );
}
