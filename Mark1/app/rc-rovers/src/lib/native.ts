/* Thin wrappers over Capacitor plugins that degrade gracefully in a browser. */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { settings } from '../state/settings';

export const isNative = Capacitor.isNativePlatform();

type Feel = 'tick' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

let lastTick = 0;
export function haptic(feel: Feel = 'light') {
  if (!settings.get().haptics) return;
  if (feel === 'tick') {               // selection ticks: never more than one per 40 ms
    const now = performance.now();
    if (now - lastTick < 40) return;
    lastTick = now;
  }
  if (isNative) {
    if (feel === 'tick') Haptics.selectionChanged().catch(() => {});
    else if (feel === 'success') Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    else if (feel === 'warning') Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
    else if (feel === 'error') Haptics.notification({ type: NotificationType.Error }).catch(() => {});
    else Haptics.impact({ style: feel === 'heavy' ? ImpactStyle.Heavy : feel === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {});
    return;
  }
  const ms = { tick: 4, light: 8, medium: 14, heavy: 24, success: [10, 40, 16], warning: [20, 60, 20], error: [30, 50, 30, 50, 30] }[feel];
  try { navigator.vibrate?.(ms as number | number[]); } catch { /* unsupported */ }
}

export async function nativeBoot() {
  if (!isNative) return;
  StatusBar.hide().catch(() => {});
  // belt and braces: hide once the UI has painted, and again a bit later on slow devices
  for (const ms of [300, 1500]) setTimeout(() => SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => {}), ms);
}

export function keepAwake(on: boolean) {
  if (!isNative) return;
  (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {});
}
