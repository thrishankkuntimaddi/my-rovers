/* The cockpit views, in swipe order, and helpers to move between them. */
import { settings, type ViewId } from './settings';
import { haptic } from '../lib/native';

export const VIEWS: { id: ViewId; label: string; cam: boolean }[] = [
  { id: 'chase', label: 'Chase cam', cam: true },
  { id: 'front', label: 'Front cam', cam: true },
  { id: 'driver', label: 'Driver view', cam: true },
  { id: 'rear', label: 'Rear cam', cam: true },
  { id: 'top', label: 'Top down', cam: true },
  { id: 'map', label: 'Trail map', cam: false },
  { id: 'gauge', label: 'Gauges', cam: false },
];
export const viewLabel = (v: ViewId) => VIEWS.find((x) => x.id === v)?.label ?? v;

/** Direction of the last change (+1 next, −1 previous), for the slide animation. */
export let lastViewDir = 1;
export function stepView(dir: 1 | -1) {
  const i = VIEWS.findIndex((v) => v.id === settings.get().view);
  lastViewDir = dir;
  settings.set({ view: VIEWS[(i + dir + VIEWS.length) % VIEWS.length].id });
  haptic('tick');
}
export function setView(v: ViewId) {
  const a = VIEWS.findIndex((x) => x.id === settings.get().view), b = VIEWS.findIndex((x) => x.id === v);
  lastViewDir = b >= a ? 1 : -1;
  settings.set({ view: v });
  haptic('tick');
}
