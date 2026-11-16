import { createStore } from './store';
import { DEFAULT_HOST, type DriveMode } from '../rover/protocol';

/** dual = throttle thumb + steering thumb · stick = one floating joystick. */
export type ControlLayout = 'dual' | 'stick';
export type ControlSize = 's' | 'm' | 'l';
export type SteerSource = 'touch' | 'tilt';
/** Views in the cockpit, in swipe order. */
export type ViewId = 'front' | 'chase' | 'driver' | 'rear' | 'top' | 'map' | 'gauge';
export type VoiceLang = 'en-US' | 'en-GB' | 'en-IN';
/** saver: 30 fps, 1× pixels · balanced: 60 fps, 1.5× · high: 60 fps, full density. */
export type Quality = 'saver' | 'balanced' | 'high';

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
  rearCameraUrl: string;
  view: ViewId;
  quality: Quality;
  novaTips: boolean;
}

const KEY = 'rcr-settings';
export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'cruise', maxPower: 100, deadzone: 5, expo: 30, invertThr: false, invertStr: false,
  trim: 0, layout: 'dual', controlSize: 'm', swapSides: false, straightAssist: true,
  haptics: true, keepAwake: true, host: DEFAULT_HOST,
  steerSource: 'touch', tiltRange: 28, tiltZero: 0, speakReplies: true, voiceLang: 'en-US',
  uiSounds: true, motorSound: true, volume: 85, cameraUrl: '', rearCameraUrl: '', view: 'chase', quality: 'balanced', novaTips: true,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings & { hudView?: string; layout: string };
      // 2.2 → 2.3: joystick layout renamed, the 3-way HUD became the view carousel
      if (s.layout !== 'dual' && s.layout !== 'stick') s.layout = s.layout === 'joystick' ? 'stick' : 'dual';
      if (s.hudView) { s.view = s.hudView === 'map' ? 'map' : s.hudView === 'gauge' ? 'gauge' : 'chase'; delete s.hudView; }
      return s as Settings;
    }
  } catch { /* storage unavailable */ }
  return DEFAULT_SETTINGS;
}

export const settings = createStore<Settings>(load());
settings.subscribe(() => {
  try { localStorage.setItem(KEY, JSON.stringify(settings.get())); } catch { /* ignore */ }
});
