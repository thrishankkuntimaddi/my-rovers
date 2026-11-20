import { createStore } from './store';
import { DEFAULT_HOST, type DriveMode } from '../rover/protocol';

/** dual = throttle thumb + steering thumb · stick = one floating joystick. */
export type ControlLayout = 'dual' | 'stick';
export type ControlSize = 's' | 'm' | 'l';
export type SteerSource = 'touch' | 'tilt';
export type HudView = 'gauge' | 'map' | 'camera';
export type VoiceLang = 'en-US' | 'en-GB' | 'en-IN';

export interface Settings {
  defaultMode: DriveMode;
  maxPower: number;     // 20…100 %
  deadzone: number;     // 0…20 %
  expo: number;         // 0…80
  invertThr: boolean;
  invertStr: boolean;
  trim: number;         // −20…20
  layout: ControlLayout;
  controlSize: ControlSize;   // thumb travel for full deflection
  swapSides: boolean;         // steering on the left, throttle on the right
  straightAssist: boolean;    // snap small steering to straight
  haptics: boolean;
  keepAwake: boolean;
  host: string;
  steerSource: SteerSource;
  tiltRange: number;    // degrees of tilt for full steering
  tiltZero: number;     // calibrated neutral angle
  speakReplies: boolean;
  voiceLang: VoiceLang;
  uiSounds: boolean;
  motorSound: boolean;  // synthesised motor, gears, terrain and servo
  volume: number;       // 0…100 master volume for all app sounds
  cameraUrl: string;    // optional MJPEG/JPEG stream URL (ESP32-CAM etc.)
  hudView: HudView;
  novaTips: boolean;
  stallA: number;       // 1.0…3.2 A, INA219 stall cut-off
}

const KEY = 'rcr-settings';
export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'cruise', maxPower: 100, deadzone: 5, expo: 30, invertThr: false, invertStr: false,
  trim: 0, layout: 'dual', controlSize: 'm', swapSides: false, straightAssist: true,
  haptics: true, keepAwake: true, host: DEFAULT_HOST,
  steerSource: 'touch', tiltRange: 28, tiltZero: 0, speakReplies: true, voiceLang: 'en-US',
  uiSounds: true, motorSound: true, volume: 85, cameraUrl: '', hudView: 'gauge', novaTips: true, stallA: 2.5,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings & { view?: string; quality?: string; rearCameraUrl?: string; layout: string };
      if (s.layout !== 'dual' && s.layout !== 'stick') s.layout = s.layout === 'joystick' ? 'stick' : 'dual';   // 2.2 name
      if (s.view) { s.hudView = s.view === 'map' ? 'map' : ['front', 'driver', 'rear'].includes(s.view) ? 'camera' : 'gauge'; }   // 2.3 carousel
      if (!['gauge', 'map', 'camera'].includes(s.hudView)) s.hudView = 'gauge';
      delete s.view; delete s.quality; delete s.rearCameraUrl;
      return s as Settings;
    }
  } catch { /* storage unavailable */ }
  return DEFAULT_SETTINGS;
}

export const settings = createStore<Settings>(load());
settings.subscribe(() => {
  try { localStorage.setItem(KEY, JSON.stringify(settings.get())); } catch { /* ignore */ }
});
