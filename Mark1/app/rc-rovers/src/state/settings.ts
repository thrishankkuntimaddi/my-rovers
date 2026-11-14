import { createStore } from './store';
import { DEFAULT_HOST, type DriveMode } from '../rover/protocol';

export type ControlLayout = 'dual' | 'joystick';

export interface Settings {
  defaultMode: DriveMode;
  maxPower: number;     // 20…100 %
  deadzone: number;     // 0…20 %
  expo: number;         // 0…80
  invertThr: boolean;
  invertStr: boolean;
  trim: number;         // −20…20
  layout: ControlLayout;
  haptics: boolean;
  keepAwake: boolean;
  host: string;
}

const KEY = 'rcr-settings';
export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'cruise', maxPower: 100, deadzone: 5, expo: 30, invertThr: false, invertStr: false,
  trim: 0, layout: 'dual', haptics: true, keepAwake: true, host: DEFAULT_HOST,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return DEFAULT_SETTINGS;
}

export const settings = createStore<Settings>(load());
settings.subscribe(() => {
  try { localStorage.setItem(KEY, JSON.stringify(settings.get())); } catch { /* ignore */ }
});
