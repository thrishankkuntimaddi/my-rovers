import { useEffect, useState } from 'react';
import { AxisControl, DPad, EStop, Ignition, Joystick, ModePicker, Segmented, TiltPad } from '../components/Controls';
import { Gauge, RoverTopView } from '../components/Hud';
import { BatteryGlyph, Icon, SignalGlyph } from '../components/Icon';
import { MicButton, TrailMap } from '../components/Futuristic';
import { Sheet } from '../components/Common';
import { useStore } from '../state/store';
import { settings, type HudView } from '../state/settings';
import { control, rover } from '../rover/controller';
import { modeSpec } from '../rover/protocol';
import { haptic, keepAwake } from '../lib/native';
import { nova } from '../ai/copilot';
import { voice } from '../ai/voice';
import { allMissions, autopilot, missionMs, recorder, runMission, startRecording, stopMission, stopRecording } from '../missions/missions';
import { missions as missionStore } from '../missions/missions';
import { academy, LESSONS, stopLesson } from '../state/academy';
import { startKeyboard, startTilt, stopKeyboard, stopTilt } from '../input/sources';
import { resetOdo } from '../state/odometry';
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

function MissionPicker({ open, onClose }: { open: boolean; onClose(): void }) {
  useStore(missionStore);
  const r = useStore(rover);
  const run = (id: string) => {
    const m = allMissions().find((x) => x.id === id)!;
    const go = () => { const res = runMission(m); if (!res.ok) toast(res.reason!, 'warn'); else onClose(); };
    if (!r.tel.armed && r.status === 'connected') { control.arm(); haptic('success'); setTimeout(go, 400); } else go();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Run a mission">
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
  const r = useStore(rover);
  const s = useStore(settings);
  const rec = useStore(recorder);
  const [picker, setPicker] = useState(false);
  const { tel } = r;
  const live = r.status === 'connected';

  useEffect(() => { control.setDriving(true); startKeyboard(); return () => { control.setDriving(false); stopKeyboard(); }; }, []);
  useEffect(() => { keepAwake(s.keepAwake); return () => keepAwake(false); }, [s.keepAwake]);
  useEffect(() => { if (s.steerSource === 'tilt') { startTilt(); return () => stopTilt(); } }, [s.steerSource]);

  const link = r.status === 'lost'
    ? <span className="lg-chip is-red"><span className="spinner sm" />Reconnecting…</span>
    : r.kind === 'demo' ? <span className="lg-chip"><i className="dot is-blue" />Demo</span>
    : r.kind === 'http' ? <span className="lg-chip is-green"><i className="dot" />Basic mode</span>
    : <span className="lg-chip is-green"><i className="dot" />Connected</span>;
  const batTone = tel.pct == null ? '' : tel.pct <= 15 ? ' is-red' : tel.pct <= 30 ? ' is-orange' : '';
  const toggleRec = () => { if (rec.on) { const m = stopRecording(true); toast(m ? `Saved “${m.name}” to Missions` : 'Nothing recorded', m ? 'good' : 'neutral'); } else { startRecording(); toast('Recording your drive', 'neutral', 1600); } haptic('medium'); };

  const steer = s.layout === 'joystick' ? <Joystick armed={tel.armed} />
    : s.steerSource === 'tilt' ? <TiltPad />
    : <AxisControl axis="str" armed={tel.armed} label="Steering" hints={['L', 'R']} />;

  return (
    <section className={`screen drive layout-${s.layout}${live ? '' : ' is-offline'}`}>
      <header className="lg-bar drive-bar">
        <button className="lg-icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={20} /></button>
        <div className="drive-title"><b>{r.info?.name ?? 'MARK 1'}</b>{link}</div>
        <div className="drive-stats">
          <span className="stat stat-signal" title="Signal"><SignalGlyph rssi={tel.rssi} live={live} /><span>{tel.rssi != null ? `${tel.rssi} dBm` : live ? 'Wi-Fi' : '—'}</span></span>
          <span className="stat hide-xs" title="Latency"><Icon name="pulse" size={16} /><span>{r.latency != null ? `${r.latency} ms` : '—'}</span></span>
          <span className={`stat${batTone}`} title="Battery"><BatteryGlyph pct={tel.pct} /><span>{tel.pct != null ? `${tel.pct}%` : '—'}</span>
            <span className="hide-sm lg-text-2">{tel.vbat != null ? `${tel.vbat.toFixed(1)} V` : ''}{tel.estMin != null ? ` · ~${tel.estMin} min` : ''}</span></span>
        </div>
        <div className="head-actions">
          <button className={`lg-icon-btn rec-btn${rec.on ? ' is-on' : ''}`} onClick={toggleRec} aria-label={rec.on ? 'Stop recording' : 'Record drive'}><Icon name="record" size={18} /></button>
          <button className="lg-icon-btn" onClick={() => setPicker(true)} aria-label="Missions"><Icon name="route" size={19} /></button>
          <button className="lg-icon-btn hide-xs" onClick={onTelemetry} aria-label="Telemetry"><Icon name="pulse" size={19} /></button>
          <button className="lg-icon-btn" onClick={onSettings} aria-label="Settings"><Icon name="gear" size={19} /></button>
        </div>
      </header>

      <div className="drive-grid">
        <div className="zone zone-left lg-tile">
          {s.layout === 'dual' ? <AxisControl axis="thr" armed={tel.armed} label="Throttle" hints={['FWD', 'REV']} /> : <DPad armed={tel.armed} />}
        </div>

        <div className="zone zone-center">
          <LessonBanner />
          <div className="hud lg-tile">
            <div className="hud-top">
              <Segmented<HudView> value={s.hudView} onChange={(v) => settings.set({ hudView: v })}
                options={[{ id: 'gauge', label: 'Gauge' }, { id: 'map', label: 'Map' }]} />
              {s.hudView === 'map' && <button className="lg-btn hud-reset" onClick={() => { resetOdo(); haptic('light'); }}>Reset</button>}
            </div>
            <div className={`hud-main${s.hudView === 'map' ? ' is-map' : ''}`}>
              {s.hudView === 'map' ? <TrailMap /> : <><Gauge thr={tel.thr} mode={tel.mode} /><RoverTopView thr={tel.thr} str={tel.str} /></>}
            </div>
            <div className="hud-line">
              <span className={`lg-chip${tel.armed ? ' is-green' : ''}`}>{tel.armed ? 'ARMED' : 'SAFE'}</span>
              <span className="hud-kv"><b>{modeSpec(tel.mode).label}</b> · cap {modeSpec(tel.mode).cap}%</span>
              <span className="hud-kv">Steer <b>{tel.str > 0 ? 'R' : tel.str < 0 ? 'L' : ''}{Math.abs(Math.round(tel.str))}</b></span>
              <span className="hud-kv hide-sm">Trim <b>{s.trim > 0 ? '+' : ''}{s.trim}</b></span>
              {s.steerSource === 'tilt' && <span className="hud-kv"><b>Tilt</b></span>}
            </div>
          </div>
          <NovaStrip />
          <ModePicker value={tel.mode} onChange={(m) => control.mode(m)} />
          <Ignition armed={tel.armed} disabled={!live} onArm={() => control.arm()} onDisarm={() => control.disarm()} />
        </div>

        <div className="zone zone-right lg-tile">
          <EStop disabled={!live} onStop={() => { stopMission('emergency stop', true); control.estop(); haptic('heavy'); }} />
          <div className="quick">
            <div className={`quick-cell${batTone}`}><span className="lg-label">Battery</span><b>{tel.pct != null ? `${tel.pct}%` : '—'}</b><small>{tel.vbat != null ? `${tel.vbat.toFixed(2)} V` : 'no sensor'}</small></div>
            <div className="quick-cell"><span className="lg-label">Runtime</span><b>{tel.estMin != null ? `${tel.estMin}m` : '—'}</b><small>{tel.estMin != null ? 'estimated' : 'learning…'}</small></div>
            <div className="quick-cell"><span className="lg-label">Signal</span><b>{tel.rssi != null ? tel.rssi : '—'}</b><small>{tel.rssi != null ? 'dBm' : 'Wi-Fi'}</small></div>
            <div className="quick-cell"><span className="lg-label">Latency</span><b>{r.latency != null ? r.latency : '—'}</b><small>ms</small></div>
          </div>
          {steer}
        </div>
      </div>

      {r.status === 'lost' && <div className="lost-veil"><span className="spinner" />Reconnecting to rover…</div>}
      <MissionPicker open={picker} onClose={() => setPicker(false)} />
    </section>
  );
}
