import { useEffect, useState } from 'react';
import { DriveButton, NavMenu, UpdateCard } from '../components/Futuristic';
import { Icon, type IconName } from '../components/Icon';
import { useStore } from '../state/store';
import { settings } from '../state/settings';
import { rover } from '../rover/controller';
import { probeRover } from '../rover/transports';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Background probe: is MARK 1 in Wi-Fi range right now? */
function useInRange(enabled: boolean) {
  const { host } = useStore(settings);
  const [state, setState] = useState<'checking' | 'online' | 'offline'>('checking');
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const probe = () => probeRover(host, 1200).then((ok) => alive && setState(ok ? 'online' : 'offline'));
    probe();
    const t = setInterval(probe, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [enabled, host]);
  return state;
}

export function Garage({ active = true, onConnect, onDemo, onResume, onSettings, onTheme, themeIcon }: {
  active?: boolean; onConnect(): void; onDemo(): void; onResume(): void; onSettings(): void; onTheme(): void; themeIcon: IconName;
}) {
  const r = useStore(rover);
  const live = r.status === 'connected' || r.status === 'lost';
  const range = useInRange(active && !live);
  const chip = live
    ? r.kind === 'demo' ? <span className="lg-chip">Demo session</span> : <span className="lg-chip is-green"><i className="dot" />Connected</span>
    : range === 'online' ? <span className="lg-chip is-green"><i className="dot" />In range</span>
    : range === 'offline' ? <span className="lg-chip">Not in range</span>
    : <span className="lg-chip">Looking…</span>;

  return (
    <section className="screen garage">
      <header className="lg-header lg-bar garage-head">
        <NavMenu />
        <div className="head-actions">
          <button className="lg-icon-btn" onClick={onTheme} aria-label="Theme"><Icon name={themeIcon} size={19} /></button>
          <button className="lg-icon-btn" onClick={onSettings} aria-label="Settings"><Icon name="gear" size={19} /></button>
          <DriveButton />
        </div>
      </header>

      <div className="lg-scroll garage-scroll">
        <div className="garage-inner">
          <div className="hello">
            <h1>{greeting()}</h1>
            <p className="lg-text-2">1 rover in your garage</p>
          </div>

          <UpdateCard />

          <article className="lg-tile rover-card">
            <div className="rover-photo"><img src="img/mark1.jpeg" alt="MARK 1 rock crawler" draggable={false} /><span className="rover-badge">MARK 1</span></div>
            <div className="rover-body">
              <div className="rover-title">
                <div>
                  <h2>MARK 1</h2>
                  <p className="lg-text-2">Rock Crawler · 4WD · ESP32</p>
                </div>
                {chip}
              </div>
              <div className="spec-grid">
                <div><span className="lg-label">Network</span><b>MARK1_ROVER</b></div>
                <div><span className="lg-label">Address</span><b>{settings.get().host}</b></div>
                <div><span className="lg-label">Firmware</span><b>{r.info?.fw ?? 'V1'}</b></div>
                <div><span className="lg-label">Battery</span><b>{r.tel.pct != null && live ? `${r.tel.pct}%` : '—'}</b></div>
              </div>
              <div className="rover-actions">
                {live ? (
                  <button className="lg-btn is-primary btn-lg" onClick={onResume}><Icon name="gamepad" size={20} />Resume driving</button>
                ) : (
                  <>
                    <button className="lg-btn is-primary btn-lg" onClick={onConnect}><Icon name="link" size={19} />Connect</button>
                    <button className="lg-btn btn-lg" onClick={onDemo}><Icon name="play" size={17} />Try demo</button>
                  </>
                )}
              </div>
            </div>
          </article>

        </div>
      </div>
    </section>
  );
}
