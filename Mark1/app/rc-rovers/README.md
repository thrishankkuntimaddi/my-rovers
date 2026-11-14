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
| **Settings** | Controls layout, start-up mode, max power, deadzone, expo, steering trim, invert, haptics, theme (Light / Dark / Auto), keep awake, rover address. |

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

**[⬇ RC-Rovers 1.0.0 APK](https://github.com/thrishankkuntimaddi/my-rovers/releases/latest/download/RC-Rovers-1.0.0.apk)** · [all releases](https://github.com/thrishankkuntimaddi/my-rovers/releases)

Open the link on your Android tablet or phone, install it, and tap **Try demo**.

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

---

## Code map

```
src/
├── App.tsx                 screens + sheets
├── screens/                Garage · Drive · ConnectSheet · TelemetrySheet · SettingsSheet
├── components/             Controls (throttle, steering, joystick, d-pad, ignition, modes, E-stop) · Hud · Icon · Common
├── rover/
│   ├── protocol.ts         message types, drive modes, battery table, input shaping
│   ├── transports.ts       WebSocket · HTTP basic mode · demo simulator
│   └── controller.ts       connect flow, 30 Hz loop, ping, watchdog, auto-reconnect, log
├── state/                  tiny stores: settings (persisted), toasts, live stick input
├── lib/                    liquid-glass.js (kit, unchanged) · native.ts (haptics, keep-awake, splash)
└── styles/                 liquid-glass.css (kit, unchanged) · app.css
```

**Android specifics:** `capacitor.config.ts` serves the app over `http` and turns on native HTTP (the rover speaks plain `http://` / `ws://`). The manifest allows cleartext. `MainActivity` runs immersive full screen. The icon and splash are vector drawables in `android/app/src/main/res/drawable/`.
