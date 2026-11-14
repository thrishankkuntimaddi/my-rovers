import { Row, Sheet, Slider, Switch } from '../components/Common';
import { Segmented } from '../components/Controls';
import { useStore } from '../state/store';
import { DEFAULT_SETTINGS, settings, type ControlLayout } from '../state/settings';
import { MODES, APP_VERSION, type DriveMode } from '../rover/protocol';
import { disconnect, rover } from '../rover/controller';
import type { ThemePref } from '../lib/liquid-glass';

const CHANNELS = ['Website', 'YouTube', 'LinkedIn', 'Twitter / X', 'Discord', 'Reddit', 'Instagram', 'Facebook'];

export function SettingsSheet({ open, onClose, theme, onTheme }: { open: boolean; onClose(): void; theme: ThemePref; onTheme(t: ThemePref): void }) {
  const s = useStore(settings);
  const r = useStore(rover);
  const set = settings.set;
  return (
    <Sheet open={open} onClose={onClose} title="Settings" wide>
      <div className="settings">
        <div className="settings-col">
          <h3 className="section-title">Driving</h3>
          <div className="lg-tile group">
            <Row title="Controls" sub="Two thumbs, or a joystick with a tap pad">
              <Segmented<ControlLayout> value={s.layout} onChange={(v) => set({ layout: v })}
                options={[{ id: 'dual', label: 'Dual' }, { id: 'joystick', label: 'Joystick' }]} />
            </Row>
            <Row title="Start-up mode">
              <Segmented<DriveMode> value={s.defaultMode} onChange={(v) => set({ defaultMode: v })}
                options={MODES.map((m) => ({ id: m.id, label: m.label }))} />
            </Row>
            <Row title="Max power" sub="Caps every mode">
              <Slider label="Max power" value={s.maxPower} min={20} max={100} step={5} onChange={(v) => set({ maxPower: v })} format={(v) => `${v}%`} />
            </Row>
            <Row title="Deadzone" sub="Ignore tiny stick movements">
              <Slider label="Deadzone" value={s.deadzone} min={0} max={20} onChange={(v) => set({ deadzone: v })} format={(v) => `${v}%`} />
            </Row>
            <Row title="Expo" sub="Finer control at low speed">
              <Slider label="Expo" value={s.expo} min={0} max={80} step={5} onChange={(v) => set({ expo: v })} format={(v) => `${v}`} />
            </Row>
            <Row title="Steering trim" sub="Nudge until it drives straight">
              <Slider label="Steering trim" value={s.trim} min={-20} max={20} onChange={(v) => set({ trim: v })} format={(v) => (v > 0 ? `+${v}` : `${v}`)} />
            </Row>
            <Row title="Invert throttle"><Switch label="Invert throttle" checked={s.invertThr} onChange={(v) => set({ invertThr: v })} /></Row>
            <Row title="Invert steering"><Switch label="Invert steering" checked={s.invertStr} onChange={(v) => set({ invertStr: v })} /></Row>
            <Row title="Haptics"><Switch label="Haptics" checked={s.haptics} onChange={(v) => set({ haptics: v })} /></Row>
          </div>
        </div>

        <div className="settings-col">
          <h3 className="section-title">Appearance</h3>
          <div className="lg-tile group">
            <Row title="Theme">
              <Segmented<ThemePref> value={theme} onChange={onTheme}
                options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }, { id: 'system', label: 'Auto' }]} />
            </Row>
            <Row title="Keep screen awake" sub="While driving"><Switch label="Keep screen awake" checked={s.keepAwake} onChange={(v) => set({ keepAwake: v })} /></Row>
          </div>

          <h3 className="section-title">Rover</h3>
          <div className="lg-tile group">
            <Row title="Rover address" sub="The ESP32's IP on its own Wi-Fi">
              <input className="lg-field addr" value={s.host} inputMode="decimal" spellCheck={false}
                onChange={(e) => set({ host: e.target.value })} />
            </Row>
            <Row title="Wi-Fi" sub="MARK1_ROVER · Mark1Rover26" />
            <Row title="Connection" sub={r.status === 'idle' ? 'Not connected' : r.kind === 'demo' ? 'Demo rover' : r.status}>
              {r.status !== 'idle' && <button className="lg-btn" onClick={() => { disconnect(); onClose(); }}>Disconnect</button>}
            </Row>
            <Row title="Reset driving settings">
              <button className="lg-btn" onClick={() => set({ ...DEFAULT_SETTINGS, host: s.host, keepAwake: s.keepAwake })}>Reset</button>
            </Row>
          </div>

          <h3 className="section-title">About</h3>
          <div className="lg-tile group">
            <Row title="RC-Rovers" sub={`Version ${APP_VERSION} · My Rovers series`} />
            <Row title="Community" sub="Links arrive with the MARK 1 launch">
              <div className="channels">{CHANNELS.map((c) => <span key={c} className="lg-chip">{c}</span>)}</div>
            </Row>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
