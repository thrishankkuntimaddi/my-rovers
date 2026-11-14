import { useCallback, useEffect, useState } from 'react';
import { LiquidGlass, type ThemePref } from './lib/liquid-glass';
import { Toasts } from './components/Common';
import { Dock, type Tab } from './components/Futuristic';
import { Garage } from './screens/Garage';
import { Drive } from './screens/Drive';
import { Missions } from './screens/Missions';
import { Nova } from './screens/Nova';
import { Logs } from './screens/Logs';
import { Academy } from './screens/Academy';
import { ConnectSheet } from './screens/ConnectSheet';
import { TelemetrySheet } from './screens/TelemetrySheet';
import { SettingsSheet } from './screens/SettingsSheet';
import { cancelConnect, connect, rover } from './rover/controller';
import { consumeNav, nova } from './ai/copilot';
import { startLesson } from './state/academy';
import { useStore } from './state/store';
import { haptic, nativeBoot } from './lib/native';

type SheetId = null | 'connect' | 'telemetry' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('garage');
  const [driving, setDriving] = useState(false);
  const [sheet, setSheet] = useState<SheetId>(null);
  const [demo, setDemo] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(() => LiquidGlass.theme.get());
  const r = useStore(rover);
  const n = useStore(nova);
  const live = r.status === 'connected' || r.status === 'lost';

  useEffect(() => { LiquidGlass.init(); nativeBoot(); }, []);
  useEffect(() => { const f = () => setTheme(LiquidGlass.theme.get()); window.addEventListener('rcr-theme', f); return () => window.removeEventListener('rcr-theme', f); }, []);
  useEffect(() => { if (driving && r.status === 'idle') setDriving(false); }, [driving, r.status]);

  const start = useCallback(async (asDemo: boolean) => {
    setDemo(asDemo);
    setSheet('connect');
    const ok = await connect(asDemo);
    if (ok) { haptic('success'); setTimeout(() => { setSheet(null); setDriving(true); }, 420); }
    else if (rover.get().error) haptic('error');
    return ok;
  }, []);

  // navigation requested by Nova ("open missions", "go to cockpit")
  useEffect(() => {
    if (!n.navRequest) return;
    const to = consumeNav();
    if (to === 'settings') setSheet('settings');
    else if (to === 'drive') { if (rover.get().status !== 'idle') setDriving(true); }
    else if (to) { setDriving(false); setTab(to); }
  }, [n.navRequest]);

  const drive = () => { if (live) setDriving(true); else start(false); };
  const lesson = (id: string) => { startLesson(id); if (live) setDriving(true); else start(true); };
  const applyTheme = (t: ThemePref) => { LiquidGlass.theme.set(t); setTheme(t); };
  const cycleTheme = () => applyTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light');
  const themeIcon = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'refresh';

  return (
    <>
      <div className={`stage is-${driving ? 'drive' : tab}`}>
        {driving ? (
          <Drive onBack={() => setDriving(false)} onTelemetry={() => setSheet('telemetry')} onSettings={() => setSheet('settings')} />
        ) : (
          <div className="tab-host" key={tab}>
            {tab === 'garage' && <Garage onConnect={() => start(false)} onDemo={() => start(true)} onResume={() => setDriving(true)}
              onSettings={() => setSheet('settings')} onTheme={cycleTheme} themeIcon={themeIcon} />}
            {tab === 'missions' && <Missions onDrive={() => setDriving(true)} />}
            {tab === 'nova' && <Nova />}
            {tab === 'logs' && <Logs />}
            {tab === 'academy' && <Academy onLesson={lesson} />}
          </div>
        )}
        {!driving && <Dock tab={tab} onTab={setTab} onDrive={drive} live={live} />}
      </div>
      <ConnectSheet open={sheet === 'connect'} demo={demo} onClose={() => { cancelConnect(); setSheet(null); }}
        onRetry={() => start(false)} onDemo={() => start(true)} />
      <TelemetrySheet open={sheet === 'telemetry'} onClose={() => setSheet(null)} />
      <SettingsSheet open={sheet === 'settings'} onClose={() => setSheet(null)} theme={theme} onTheme={applyTheme} />
      <Toasts />
    </>
  );
}
