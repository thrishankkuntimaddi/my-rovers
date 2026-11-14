import { useEffect } from 'react';
import { AxisControl, DPad, EStop, Ignition, Joystick, ModePicker } from '../components/Controls';
import { Hud } from '../components/Hud';
import { BatteryGlyph, Icon, SignalGlyph } from '../components/Icon';
import { useStore } from '../state/store';
import { settings } from '../state/settings';
import { control, rover } from '../rover/controller';
import { haptic, keepAwake } from '../lib/native';

export function Drive({ onBack, onTelemetry, onSettings }: { onBack(): void; onTelemetry(): void; onSettings(): void }) {
  const r = useStore(rover);
  const s = useStore(settings);
  const { tel } = r;
  const live = r.status === 'connected';

  useEffect(() => {
    control.setDriving(true);
    return () => control.setDriving(false);
  }, []);
  useEffect(() => { keepAwake(s.keepAwake); return () => keepAwake(false); }, [s.keepAwake]);

  const link = r.status === 'lost'
    ? <span className="lg-chip is-red"><span className="spinner sm" />Reconnecting…</span>
    : r.kind === 'demo' ? <span className="lg-chip"><i className="dot is-blue" />Demo</span>
    : r.kind === 'http' ? <span className="lg-chip is-green"><i className="dot" />Basic mode</span>
    : <span className="lg-chip is-green"><i className="dot" />Connected</span>;

  const batTone = tel.pct == null ? '' : tel.pct <= 15 ? ' is-red' : tel.pct <= 30 ? ' is-orange' : '';

  return (
    <section className={`screen drive layout-${s.layout}${live ? '' : ' is-offline'}`}>
      <header className="lg-bar drive-bar">
        <button className="lg-icon-btn" onClick={onBack} aria-label="Back to garage"><Icon name="back" size={20} /></button>
        <div className="drive-title">
          <b>{r.info?.name ?? 'MARK 1'}</b>
          {link}
        </div>
        <div className="drive-stats">
          <span className="stat" title="Signal"><SignalGlyph rssi={tel.rssi} live={live} /><span>{tel.rssi != null ? `${tel.rssi} dBm` : live ? 'Wi-Fi' : '—'}</span></span>
          <span className="stat hide-xs" title="Latency"><Icon name="pulse" size={16} /><span>{r.latency != null ? `${r.latency} ms` : '—'}</span></span>
          <span className={`stat${batTone}`} title="Battery">
            <BatteryGlyph pct={tel.pct} />
            <span>{tel.pct != null ? `${tel.pct}%` : '—'}</span>
            <span className="hide-sm lg-text-2">{tel.vbat != null ? `${tel.vbat.toFixed(1)} V` : ''}{tel.estMin != null ? ` · ~${tel.estMin} min` : ''}</span>
          </span>
        </div>
        <div className="head-actions">
          <button className="lg-icon-btn" onClick={onTelemetry} aria-label="Telemetry"><Icon name="pulse" size={19} /></button>
          <button className="lg-icon-btn" onClick={onSettings} aria-label="Settings"><Icon name="gear" size={19} /></button>
        </div>
      </header>

      <div className="drive-grid">
        <div className="zone zone-left lg-tile">
          {s.layout === 'dual'
            ? <AxisControl axis="thr" armed={tel.armed} label="Throttle" hints={['FWD', 'REV']} />
            : <DPad armed={tel.armed} />}
        </div>

        <div className="zone zone-center">
          <Hud tel={tel} trim={s.trim} />
          <ModePicker value={tel.mode} onChange={(m) => control.mode(m)} />
          <Ignition armed={tel.armed} disabled={!live} onArm={() => control.arm()} onDisarm={() => control.disarm()} />
        </div>

        <div className="zone zone-right lg-tile">
          <EStop disabled={!live} onStop={() => { control.estop(); haptic('heavy'); }} />
          <div className="quick">
            <div className={`quick-cell${batTone}`}><span className="lg-label">Battery</span><b>{tel.pct != null ? `${tel.pct}%` : '—'}</b><small>{tel.vbat != null ? `${tel.vbat.toFixed(2)} V` : 'no sensor'}</small></div>
            <div className="quick-cell"><span className="lg-label">Runtime</span><b>{tel.estMin != null ? `${tel.estMin}m` : '—'}</b><small>{tel.estMin != null ? 'estimated' : 'learning…'}</small></div>
            <div className="quick-cell"><span className="lg-label">Signal</span><b>{tel.rssi != null ? tel.rssi : '—'}</b><small>{tel.rssi != null ? 'dBm' : 'Wi-Fi'}</small></div>
            <div className="quick-cell"><span className="lg-label">Latency</span><b>{r.latency != null ? r.latency : '—'}</b><small>ms</small></div>
          </div>
          {s.layout === 'dual'
            ? <AxisControl axis="str" armed={tel.armed} label="Steering" hints={['L', 'R']} />
            : <Joystick armed={tel.armed} />}
        </div>
      </div>

      {r.status === 'lost' && <div className="lost-veil"><span className="spinner" />Reconnecting to rover…</div>}
    </section>
  );
}
