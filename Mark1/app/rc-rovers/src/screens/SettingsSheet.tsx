import { Row, Sheet, Slider, Switch } from '../components/Common';
import { checkForUpdate, installUpdate, update } from '../lib/updater';
import { Segmented } from '../components/Controls';
import { useStore } from '../state/store';
import { DEFAULT_SETTINGS, settings, type ControlLayout, type SteerSource, type VoiceLang } from '../state/settings';
import { calibrateTilt, pad } from '../input/sources';
import { speak } from '../ai/voice';
import { exportLogs } from '../state/logs';
import { resetAcademy } from '../state/academy';
import { toast } from '../state/ui';
import { MODES, APP_VERSION, type DriveMode } from '../rover/protocol';
import { disconnect, rover } from '../rover/controller';
import type { ThemePref } from '../lib/liquid-glass';

const CHANNELS = ['Website', 'YouTube', 'LinkedIn', 'Twitter / X', 'Discord', 'Reddit', 'Instagram', 'Facebook'];

export function SettingsSheet({ open, onClose, theme, onTheme }: { open: boolean; onClose(): void; theme: ThemePref; onTheme(t: ThemePref): void }) {
  const s = useStore(settings);
  const r = useStore(rover);
  const gp = useStore(pad);
  const upd = useStore(update);
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

          <h3 className="section-title">Steering & controllers</h3>
          <div className="lg-tile group">
            <Row title="Steering" sub="Thumb slider, or tilt the device like a wheel">
              <Segmented<SteerSource> value={s.steerSource} onChange={(v) => set({ steerSource: v })}
                options={[{ id: 'touch', label: 'Touch' }, { id: 'tilt', label: 'Tilt' }]} />
            </Row>
            <Row title="Tilt range" sub="Degrees of tilt for full lock">
              <Slider label="Tilt range" value={s.tiltRange} min={12} max={45} onChange={(v) => set({ tiltRange: v })} format={(v) => `${v}°`} />
            </Row>
            <Row title="Tilt centre" sub={`Neutral angle ${s.tiltZero.toFixed(1)}°`}><button className="lg-btn" onClick={calibrateTilt}>Calibrate</button></Row>
            <Row title="Gamepad" sub={gp.connected ? gp.id : 'Pair a Bluetooth controller in Android settings'}>
              <span className={`lg-chip${gp.connected ? ' is-green' : ''}`}>{gp.connected ? 'Connected' : 'None'}</span>
            </Row>
            <Row title="Gamepad buttons" sub="Sticks/triggers drive · A arm · B e-stop · X stop · Y record · LB/RB mode" />
            <Row title="Keyboard" sub="WASD/arrows drive · Shift boost · Space stop · Esc e-stop · E ignition · 1–4 modes · R record" />
          </div>
        </div>

        <div className="settings-col">
          <h3 className="section-title">Nova & voice</h3>
          <div className="lg-tile group">
            <Row title="Spoken replies" sub="Nova answers out loud after voice commands"><Switch label="Spoken replies" checked={s.speakReplies} onChange={(v) => set({ speakReplies: v })} /></Row>
            <Row title="Voice language">
              <Segmented<VoiceLang> value={s.voiceLang} onChange={(v) => set({ voiceLang: v })}
                options={[{ id: 'en-US', label: 'US' }, { id: 'en-GB', label: 'UK' }, { id: 'en-IN', label: 'India' }]} />
            </Row>
            <Row title="Proactive tips" sub="Battery, signal and safety advice"><Switch label="Tips" checked={s.novaTips} onChange={(v) => set({ novaTips: v })} /></Row>
            <Row title="Test voice"><button className="lg-btn" onClick={() => speak('Nova online. All systems nominal.')}>Speak</button></Row>
          </div>

          <h3 className="section-title">Sound</h3>
          <div className="lg-tile group">
            <Row title="UI sounds" sub="Chimes for ignition, stop, missions"><Switch label="UI sounds" checked={s.uiSounds} onChange={(v) => set({ uiSounds: v })} /></Row>
            <Row title="Motor sound" sub="Motor whine, gears, gravel and steering servo that follow the rover"><Switch label="Motor sound" checked={s.motorSound} onChange={(v) => set({ motorSound: v })} /></Row>
            <Row title="Volume" sub="Motor and chimes">
              <Slider label="Volume" value={s.volume} min={0} max={100} step={5} onChange={(v) => set({ volume: v })} format={(v) => `${v}%`} />
            </Row>
          </div>

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
            <Row title="Camera stream" sub="Optional. ESP32-CAM: http://<ip>:81/stream · blank = auto">
              <input className="lg-field addr cam-field" value={s.cameraUrl} placeholder="auto" spellCheck={false} inputMode="url"
                onChange={(e) => set({ cameraUrl: e.target.value })} />
            </Row>
            <Row title="Connection" sub={r.status === 'idle' ? 'Not connected' : r.kind === 'demo' ? 'Demo rover' : r.status}>
              {r.status !== 'idle' && <button className="lg-btn" onClick={() => { disconnect(); onClose(); }}>Disconnect</button>}
            </Row>
            <Row title="Export logs" sub="JSON with events and trips">
              <button className="lg-btn" onClick={() => exportLogs('json').then((n) => toast(`Exported ${n}`, 'good'), (e) => toast(String(e), 'bad'))}>Export</button>
            </Row>
            <Row title="Reset Academy" sub="XP, achievements and lessons">
              <button className="lg-btn" onClick={() => { resetAcademy(); toast('Academy reset'); }}>Reset</button>
            </Row>
            <Row title="Reset driving settings">
              <button className="lg-btn" onClick={() => set({ ...DEFAULT_SETTINGS, host: s.host, keepAwake: s.keepAwake })}>Reset</button>
            </Row>
          </div>

          <h3 className="section-title">About</h3>
          <div className="lg-tile group">
            <Row title="RC-Rovers" sub={`Version ${APP_VERSION} · My Rovers series`} />
            <Row title="Updates" sub={upd.state === 'checking' ? 'Checking…' : upd.state === 'available' ? `Version ${upd.latest} is available` : upd.state === 'current' ? 'You have the latest version' : upd.state === 'downloading' ? `Downloading… ${Math.round(upd.progress * 100)}%` : upd.state === 'installing' ? 'Installer opened' : upd.error ?? 'Updates install over the app; nothing is lost'}>
              {upd.state === 'available'
                ? <button className="lg-btn is-primary" onClick={installUpdate}>Update</button>
                : <button className="lg-btn" disabled={upd.state === 'checking' || upd.state === 'downloading'} onClick={() => checkForUpdate(true)}>Check</button>}
            </Row>
            <Row title="Community" sub="Links arrive with the MARK 1 launch">
              <div className="channels">{CHANNELS.map((c) => <span key={c} className="lg-chip">{c}</span>)}</div>
            </Row>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
