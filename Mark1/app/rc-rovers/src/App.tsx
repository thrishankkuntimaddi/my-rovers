import { useCallback, useEffect, useState } from 'react';
import { LiquidGlass, type ThemePref } from './lib/liquid-glass';
import { Toasts } from './components/Common';
import { Garage } from './screens/Garage';
import { Drive } from './screens/Drive';
import { ConnectSheet } from './screens/ConnectSheet';
import { TelemetrySheet } from './screens/TelemetrySheet';
import { SettingsSheet } from './screens/SettingsSheet';
import { cancelConnect, connect, rover } from './rover/controller';
import { useStore } from './state/store';
import { haptic, nativeBoot } from './lib/native';

type Screen = 'garage' | 'drive';
type SheetId = null | 'connect' | 'telemetry' | 'settings';

export default function App() {
  const [screen, setScreen] = useState<Screen>('garage');
  const [sheet, setSheet] = useState<SheetId>(null);
  const [demo, setDemo] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(() => LiquidGlass.theme.get());
  const r = useStore(rover);

  useEffect(() => { LiquidGlass.init(); nativeBoot(); }, []);

  // leaving the cockpit when the session ends (disconnect from Settings)
  useEffect(() => { if (screen === 'drive' && r.status === 'idle') setScreen('garage'); }, [screen, r.status]);

  const start = useCallback(async (asDemo: boolean) => {
    setDemo(asDemo);
    setSheet('connect');
    const ok = await connect(asDemo);
    if (ok) {
      haptic('success');
      setTimeout(() => { setSheet(null); setScreen('drive'); }, 420);
    } else if (rover.get().error) {
      haptic('error');
    }
  }, []);

  const applyTheme = (t: ThemePref) => { LiquidGlass.theme.set(t); setTheme(t); };
  const cycleTheme = () => applyTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light');
  const themeIcon = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'refresh';

  return (
    <>
      <div className={`stage is-${screen}`}>
        {screen === 'garage' && (
          <Garage onConnect={() => start(false)} onDemo={() => start(true)} onResume={() => setScreen('drive')}
            onSettings={() => setSheet('settings')} onTheme={cycleTheme} themeIcon={themeIcon} />
        )}
        {screen === 'drive' && (
          <Drive onBack={() => setScreen('garage')} onTelemetry={() => setSheet('telemetry')} onSettings={() => setSheet('settings')} />
        )}
      </div>
      <ConnectSheet open={sheet === 'connect'} demo={demo} onClose={() => { cancelConnect(); setSheet(null); }}
        onRetry={() => start(false)} onDemo={() => start(true)} />
      <TelemetrySheet open={sheet === 'telemetry'} onClose={() => setSheet(null)} />
      <SettingsSheet open={sheet === 'settings'} onClose={() => setSheet(null)} theme={theme} onTheme={applyTheme} />
      <Toasts />
    </>
  );
}
