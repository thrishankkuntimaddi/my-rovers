# RC-Rovers — the driving app

The Android app (tablet + phone) that drives the My Rovers series. Built with **React + TypeScript + Vite**, wrapped as a native app with **Capacitor 8**, and styled with the **Liquid Glass** kit in [`../design/`](../design/).

Design spec: [`../../docs/app-design.md`](../../docs/app-design.md) · Protocol: [`../../docs/control-protocol.md`](../../docs/control-protocol.md)

---

## What's in it

| Screen | What it does |
|---|---|
| **Garage** | Your rovers. MARK 1 card with photo, live "In range" check, Connect / Try demo. MARK 2–5 shown as coming next. |
| **Connect** | Three live steps: Wi-Fi → reach rover → handshake. Clear help if it fails, plus a one-tap fallback to demo. |
| **Drive** | Cockpit. Throttle (left thumb) + steering (right thumb), *or* joystick + tap pad. Speed gauge, top-down rover with live steering, drive modes (Crawl / Cruise / Sport / Full), **slide-to-start ignition**, **emergency STOP** (fires on touch-down), live battery / signal / latency / runtime. |
| **Telemetry** | Battery ring, voltage / signal / latency graphs, session info, event log. |
| **Missions** | Built-in and custom routes with path previews, step editor, record & replay. |
| **Nova** | Offline co-pilot chat with voice, suggestions and command history (`/raw {"t":"mode","m":"sport"}` for raw protocol). |
| **Logs** | Events / Trips / Stats, filters, search, export. |
| **Academy** | Rank, driving school lessons, achievements. |
| **Settings** | Controls layout, steering source (touch / tilt) and tilt calibration, gamepad and keyboard help, start-up mode, max power, deadzone, expo, steering trim, invert, haptics, Nova voice (spoken replies, language, tips), sounds, theme (Light / Dark / Auto), keep awake, rover address, log export, Academy reset. |

**Layouts:** tablet landscape (primary), tablet portrait, phone landscape, phone portrait.
**Feel:** springs everywhere, haptics on every control, controls run at the screen's full refresh rate (refs + transforms, no re-render per touch), and a 30 Hz command loop separate from rendering.

### Three ways to reach a rover
| Link | When | How |
|---|---|---|
| **Demo** | No hardware | A simulated MARK 1 inside the app: ramping, mode caps, failsafe, battery drain (sped up), Wi-Fi signal. |
| **Basic mode** | Rover runs **Firmware V1** (Phase 1) | HTTP `/api/cmd?move=…`. The stick is mapped to forward / backward / left / right / stop. Ignition is enforced in the app. |
| **Full link** | Rover runs Firmware V3+ (WebSocket) | `ws://192.168.4.1/ws`, protocol from the docs, telemetry at 5 Hz. |

The app tries the WebSocket first and falls back to basic mode automatically. It only accepts a reply whose `device` is `MARK…`, so a home router on 192.168.4.1 is never mistaken for the rover.

---

## Download

**[⬇ RC-Rovers for Android (latest)](https://github.com/thrishankkuntimaddi/my-rovers/releases/latest/download/RC-Rovers.apk)** · [all releases](https://github.com/thrishankkuntimaddi/my-rovers/releases)

Open the link on your Android tablet or phone, install it, and tap **Try demo**.

**Updating:** never uninstall. Every release is signed with the same key and has a higher version code, so it installs *over* the old app and keeps your missions, XP, logs and settings. From 2.2.0 on, the app checks for new releases itself: when one is out, an **Update** card appears in the Garage (also *Settings → About → Updates*). Tap it, then tap **Update** on Android's screen. The first time, Android asks you to allow *Install unknown apps* for RC-Rovers.

---

## What's new in 2.3

| | Fix / feature |
|---|---|
| 👍 | **Floating thumb controls**: touch anywhere on the left to drive (slide up/down), anywhere on the right to steer. A short push = full power or full lock (Small / Medium / Large in Settings). Both thumbs work at once (true multi-touch). Joystick layout and *Swap sides* available. |
| ↔︎ | **Drives straight**: straight-line assist ignores small sideways thumb drift; tilt steering zeroes itself when the cockpit opens; trim shows when it's pulling and has a *Centre* button. |
| 🎥 | **Seven views, swipe between them**: Chase · Front · Driver (steering wheel turns with you) · Rear (mirrored, parking guides) · Top-down · Map · Gauges. Drag up/down to zoom or tilt, double-tap to reset. Real rover: Front/Driver/Rear show live streams (rear stream URL in Settings); demo: everything is simulated and labelled DEMO SIM. |
| 📸 | **Photo and video work**: ⏺ now records *video* (route recording moved to Missions). Files go to the Gallery: Pictures/RC-Rovers and Movies/RC-Rovers. |
| ⤢ | **Full view** opens and closes (✕ button, Android back). Back now closes the top-most thing everywhere. |
| ✦ | **Nova voice works offline**: on-device recognition first (no internet on the rover's Wi-Fi), clear errors, tap to talk or hold for push-to-talk. Nova starts the ignition itself when you ask it to drive, and understands “chase view”, “rear camera”, “take a photo”, “record video”, “hold speed”, “faster” / “slower”. |
| 🛞 | **Speed hold** (was “Cruise”) sits above the throttle; the 50% drive mode is now called **Normal** so the two aren't confused. |
| 🔋 | **Smoother, lighter**: only the widgets that change re-render, hidden tabs are frozen, no live blur over the camera, 60/30 fps cap (Settings → Graphics), ~20 fps when parked, nothing drawn in the background. Demo battery lasts ~25 min instead of 5. |

## What's new in 2.0

| | Feature |
|---|---|
| ✦ | **Nova, the offline AI co-pilot**: chat or talk in plain English. “Forward slowly for 2 seconds then turn right”, “reverse 1 meter”, “sport mode”, “run the figure 8”, “battery?”, “status report”, “trim left 3”, “dark mode”. Multi-step routes, distances and speeds, live status answers, proactive battery / signal / failsafe tips. No internet needed. |
| 🎙 | **Voice driving**: hold the mic, speak, release. Nova answers out loud. A spoken **“stop”** acts on the partial transcript, before you finish talking. “Emergency” cuts the motors. |
| 🗺 | **Missions**: 8 built-in routes (Square, Circle, Figure 8, Zig-zag, Patrol, Three-point turn, Dance, Crawl test) with path previews, a step editor for your own routes, and **record & replay** of your real drives. Touch any control to take over. |
| 📡 | **Trail map**: a radar-style live map of where the rover has driven (dead-reckoning estimate), switchable with the gauge. |
| 📱 | **Tilt steering**: steer by tilting the tablet like a wheel, with calibration and range. |
| 🎮 | **Gamepads and keyboards**: Bluetooth controllers (sticks/triggers drive, A arm, B e-stop, X stop, Y record, LB/RB modes) and WASD/arrow keys. |
| 🎓 | **Academy**: XP and 6 ranks (Rookie → Legend), 16 achievements, and an 8-lesson driving school checked live as you drive. |
| 🧾 | **Logs**: every event by category (link, drive, voice, Nova, missions, academy, telemetry), search and filters, per-trip stats, lifetime stats, JSON/CSV export via Android share. |
| 🔊 | **Sound**: synthesised chimes for ignition, stop, missions and unlocks, plus an optional engine hum that follows the throttle. |
| ◐ | **Redesigned shell**: a Liquid Glass menu pill (top-left) that opens a floating glass menu, a Drive button (top-right), and a cockpit with a Nova strip, mission progress, recording and lesson banners. |

## Run it

```bash
npm install
npm run dev          # http://localhost:5180 — open on the Mac, or on the tablet via the Network URL
```

Use **Try demo** to drive the simulated rover.

## Build the Android app (APK)

Needs: Android SDK (`~/Library/Android/sdk`) and JDK 21 (`brew install openjdk@21`).

```bash
npm run android:apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

### Install on the Xiaomi Pad 5 (or any Android phone)
**Option A (USB):** enable *Developer options → USB debugging* on the tablet, plug it in, then:
```bash
~/Library/Android/sdk/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```
**Option B (no cable):** send the `.apk` to the tablet (Google Drive, Telegram, USB file copy), open it, and allow *Install unknown apps* for that app when asked.

`npm run android:open` opens the project in Android Studio if you prefer that.

### Publishing a release
1. Bump the version in `package.json`, `src/rover/protocol.ts` (`APP_VERSION`) and `android/app/build.gradle` (`versionName`, and `versionCode` +1).
2. `npm run release:apk` builds the APK and **refuses** if it isn't signed with the RC-Rovers key or if `versionCode` isn't higher than the last release. Either would stop it installing as an update.
3. Create the GitHub release with tag `rc-rovers-vX.Y.Z` and attach `android/app/build/release/RC-Rovers.apk` and `RC-Rovers-X.Y.Z.apk`. Installed apps find it automatically.

The signing key is `~/.android/debug.keystore` on the build Mac. **Back it up.** If it's lost, future APKs can't update existing installs.

---

## Code map

```
src/
├── App.tsx                 dock navigation, screens + sheets
├── effects.ts              app-wide wiring (chimes, engine sound, gamepad, voice)
├── screens/                Garage · Drive · Missions · Nova · Logs · Academy · Connect/Telemetry/Settings sheets
├── ai/                     copilot.ts (Nova language engine) · voice.ts (speech in/out)
├── missions/               missions.ts (built-ins, editor model, autopilot, recorder)
├── input/                  sources.ts (tilt, gamepad, keyboard)
├── components/             Controls (throttle, steering, joystick, d-pad, ignition, modes, E-stop) · Hud · Icon · Common
├── rover/
│   ├── protocol.ts         message types, drive modes, battery table, input shaping
│   ├── transports.ts       WebSocket · HTTP basic mode · demo simulator
│   └── controller.ts       connect flow, 30 Hz loop, ping, watchdog, auto-reconnect, log
├── state/                  settings · logs & trips · odometry · academy · event bus · toasts / live stick input
├── lib/                    liquid-glass.js (kit, unchanged) · native.ts (haptics, keep-awake, splash)
└── styles/                 liquid-glass.css (kit, unchanged) · app.css
```

**Android specifics:** `capacitor.config.ts` serves the app over `http` and turns on native HTTP (the rover speaks plain `http://` / `ws://`). The manifest allows cleartext. `MainActivity` runs immersive full screen. The icon and splash are vector drawables in `android/app/src/main/res/drawable/`.
