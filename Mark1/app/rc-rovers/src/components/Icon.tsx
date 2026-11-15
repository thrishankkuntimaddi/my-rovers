/* SF-Symbols-style line icons (24×24, 1.75 stroke). */
const PATHS: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4.9a7.6 7.6 0 0 0-2.6-1.5L14 2.4h-4l-.4 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.4-.9-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4.9 2-3.4z',
  pulse: 'M3 12h4l2.5-6 5 12L17 12h4',
  wifi: 'M2.5 8.8a14 14 0 0 1 19 0 M5.6 12.2a9.5 9.5 0 0 1 12.8 0 M8.8 15.5a5 5 0 0 1 6.4 0 M12 19h.01',
  bolt: 'M13 2L4.5 13.5H12L11 22l8.5-11.5H12z',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 9v4l2.5 1.5 M9.5 2.5h5',
  power: 'M12 3v8 M6.3 6.6a8 8 0 1 0 11.4 0',
  stop: 'M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12 M18 6L6 18',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.4L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.6 4.4L20 16 M20 20v-4h-4',
  lock: 'M6.5 11h11v9.5h-11z M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  play: 'M7 4.5v15l12.5-7.5z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5.5 M12 7.6h.01',
  link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1 M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1',
  gamepad: 'M7 8h10a5 5 0 0 1 4.8 6.4l-.6 2.2a2.6 2.6 0 0 1-4.4 1.1L14.5 15.5h-5l-2.3 2.2a2.6 2.6 0 0 1-4.4-1.1l-.6-2.2A5 5 0 0 1 7 8z M7.5 10.5v3 M6 12h3 M16 11h.01 M17.5 13h.01',
  camera: 'M3 8h3.5L8 5.5h8L17.5 8H21v11H3z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  arm: 'M4 20h6 M7 20v-4l5-6 M12 10l4-3 3 2 M15.5 7.5L17 4',
  cube: 'M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z M12 12l8.5-4.7 M12 12v9.5 M12 12L3.5 7.3',
  rover: 'M4 14.5h16v-3.5l-2.5-3.5h-11L4 11z M7 7.5L8.5 4h7L17 7.5 M7.5 18.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M16.5 18.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  battery: 'M3 8h15v8H3z M20.5 10.5v3',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c2.5 2.6 3.6 5.6 3.6 9s-1.1 6.4-3.6 9c-2.5-2.6-3.6-5.6-3.6-9S9.5 5.6 12 3z',
  plus: 'M12 5v14 M5 12h14',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8 17h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  list: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0z M8 6H5a3 3 0 0 0 3 4 M16 6h3a3 3 0 0 1-3 4 M12 13v4 M8.5 20h7 M10 17h4v3h-4z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5.5 11a6.5 6.5 0 0 0 13 0 M12 17.5V21',
  send: 'M4 12l16-8-6 16-2.5-6.5z M11.5 13.5L20 4',
  record: 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14',
  gauge: 'M4.5 17a8.5 8.5 0 1 1 15 0 M12 13l4-4.5',
  trash: 'M4 7h16 M9 7V4h6v3 M6.5 7l1 13h9l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  copy: 'M8 8h11v12H8z M5 16V4h11',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  download: 'M12 4v11 M7 10.5l5 5 5-5 M5 20h14',
  tilt: 'M7 3h10v18H7z M11 18h2 M2 12a10 10 0 0 1 3-7 M22 12a10 10 0 0 1-3 7',
  keyboard: 'M3 6h18v12H3z M7 10h.01 M11 10h.01 M15 10h.01 M7 14h10',
  school: 'M2 9l10-5 10 5-10 5z M6 11v5c3 2 9 2 12 0v-5 M22 9v6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  aperture: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M14.3 3.3L9.5 12 M20.4 9.2l-10 .2 M17.6 19L12.6 10.4 M9.7 20.7L14.5 12 M3.6 14.8l10-.2 M6.4 5l5 8.6',
  video: 'M3 7h12v10H3z M15 10.5l6-3.5v10l-6-3.5',
  flag: 'M5 21V4 M5 4h11l-2 4 2 4H5',
  cruise: 'M12 20a8 8 0 1 0-8-8 M12 12l4.5-4.5 M4 16h5 M6 19h3',
  expand: 'M14 4h6v6 M20 4l-7 7 M10 20H4v-6 M4 20l7-7',
  shrink: 'M19 11h-6V5 M13 11l7-7 M5 13h6v6 M11 13l-7 7',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name].split(' M').map((d, i) => <path key={i} d={i ? 'M' + d : d} />)}
    </svg>
  );
}

/** Battery glyph filled to `pct`, coloured only by meaning. */
export function BatteryGlyph({ pct }: { pct: number | null }) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const tone = pct == null ? 'var(--lg-text-3)' : p <= 15 ? 'var(--lg-red)' : p <= 30 ? 'var(--lg-orange)' : 'var(--lg-green)';
  return (
    <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">
      <rect x="0.75" y="0.75" width="21.5" height="12.5" rx="3.6" fill="none" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.3" />
      <rect x="23.4" y="4.6" width="1.9" height="4.8" rx="0.9" fill="currentColor" fillOpacity=".45" />
      <rect x="2.6" y="2.6" width={Math.max(0.01, 17.8 * p / 100)} height="8.8" rx="2.2" fill={tone} />
    </svg>
  );
}

/** Four signal bars from RSSI (dBm). */
export function SignalGlyph({ rssi, live }: { rssi: number | null; live: boolean }) {
  const bars = rssi == null ? (live ? 4 : 0) : rssi > -55 ? 4 : rssi > -65 ? 3 : rssi > -75 ? 2 : 1;
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={i * 4.6} y={10 - i * 3.2} width="3.2" height={4 + i * 3.2} rx="1"
          fill="currentColor" fillOpacity={i < bars ? 0.9 : 0.2} />
      ))}
    </svg>
  );
}
