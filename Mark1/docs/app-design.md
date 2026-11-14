# RC-Rovers — App Design (MARK 1)

← Back to [MARK 1 README](../README.md)

**RC-Rovers** is the Android tablet app that drives every rover in the My Rovers series. MARK 1 is the first rover in its Garage. The app is built for the **Xiaomi Pad 5** (11", 2560×1600, 120 Hz), **landscape first**, with portrait supported. It uses the **Liquid Glass** theme in [`../app/design/`](../app/design/).

> Design north star: it should feel like an Apple first-party app on a tablet. Calm, clear glass. Everything springs under your thumb. Colour appears only when it means something.

---

## 1. Theme rules (from `LIQUID-GLASS-THEME.md`, applied to a rover app)

| Rule | In RC-Rovers |
|---|---|
| Glass has no colour | Bars, panels, joystick base and buttons are clear frosted glass. No brand blue. |
| Light by default | Light theme on first launch. Dark and Auto only when the user picks them in Settings. |
| Primary / selected = white glass, dark label | Active drive mode, *Connect* button, selected tab. |
| Colour only for meaning | 🟢 connected / armed-ready / battery OK · 🟠 battery low / weak signal · 🔴 E-stop, disconnected, critical battery · 🔵 throttle fill (optional, in a meter only) |
| Content scrolls under floating glass | Garage list and Settings scroll under the floating header and dock. |
| Everything reacts | Every control sinks on touch and springs back (`LiquidGlass.press()`), with a haptic tick. |
| No scrollbars, never laggy | Live blur only on floating bars and sheets. Tiles get no blur. 120 fps target on the Pad 5. |

The Pad 5 runs Chromium WebView, so the **edge-refraction lens** (`#lg-refract`) works on floating bars.

**References:** [`media/ui-reference/`](../media/ui-reference/) shows the floating glass search capsule, the glass dropdown menu (Home / Recents / Search / Library) with its pressed state, and list rows. These set the look for RC-Rovers' menus, mode picker and Garage list.

---

## 2. Screens

### 2.1 Splash → Garage (home)
* Light wallpaper colour field, app icon (clear glass tile with one crisp rover glyph).
* **Garage**: one glass tile per rover. MARK 1 shows a photo, its name and a status chip (`Online` green / `Offline` grey) from a background `GET /api/status`.
* Tap **MARK 1** → Connect. Long-press → Rover details.
* Floating header: `RC-Rovers` title, an icon button for Settings, and a theme button.

### 2.2 Connect
* Steps shown as glass rows with live ticks:
  1. **Wi-Fi**: "Join `MARK1_ROVER`". The button opens Android Wi-Fi settings (Phase 6: automatic join via `WifiNetworkSpecifier`).
  2. **Reach rover**: pings `192.168.4.1/api/status`.
  3. **Handshake**: WebSocket `hello` → `info` (firmware version, capabilities).
* When all three are green → spring transition into **Drive**.

### 2.3 Drive (the main screen, landscape)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ╭──────────────────────────────────────────────────────────────────────────────────╮ │
│ │ ‹ Garage   MARK 1  ● Connected   ▂▄▆ -47 dBm   ⏱ 12 ms     🔋 68% · 11.4 V · ~34m │ │  ← floating glass status bar
│ ╰──────────────────────────────────────────────────────────────────────────────────╯ │
│                                                                                      │
│  ╭─────────╮                    ╭───────────────────────────╮               ╭──────╮ │
│  │         │                    │        SPEED  48%         │               │ STOP │ │  ← E-stop (red glass, always
│  │ THROTTLE│                    │   ◜▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔◝   │               ╰──────╯ │     visible, top-right)
│  │    ▲    │                    │        ← steer −35         │                       │
│  │ ███     │                    │   ARMED · CRUISE · R1      │       ╭───────────╮   │
│  │ ███     │                    ╰───────────────────────────╯       │     ◉     │   │
│  │ ───     │                                                        │  ◀ ─┼─ ▶  │   │  ← steering pad / joystick
│  │    ▼    │       ╭─────────────────────────────────────╮          │           │   │     (right thumb)
│  ╰─────────╯       │ Crawl │ Cruise │ Sport │ Full       │          ╰───────────╯   │
│ (left thumb)       ╰─────────────────────────────────────╯                          │
│                    ╭──────────── slide to start  ⟶ ────────────╮                     │  ← ignition (arm/disarm)
│                    ╰────────────────────────────────────────────╯                     │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

* **Left thumb: throttle.** A vertical glass track. Drag up = forward, down = reverse. It **springs back to 0** on release, with a centre detent haptic. Optional *cruise lock*: double-tap to hold the current throttle.
* **Right thumb: steering.** A horizontal pad or a round joystick that springs back to centre. Alternative layout (Settings): a **single joystick** that combines throttle and steering, for one-hand play.
* **Both thumbs at once:** multi-touch through Pointer Events with `setPointerCapture`, so each control tracks its own finger.
* **Centre HUD** (clear tile): speed %, steering, armed state, mode, steering trim.
* **Mode picker:** `lg-segmented` with Crawl / Cruise / Sport / Full. The white-glass pill slides between modes.
* **Ignition:** "slide to start" glass capsule. When armed, it turns into a pulsing green chip "ARMED · slide to stop".
* **E-stop:** red tinted glass (`lg-btn is-tint` + `--lg-tint: var(--lg-red)`). One tap → `estop`, strong haptic, a red toast "Emergency stop".
* **Directional quick buttons** (optional overlay, as in the Phase 1 page): ▲ ▼ ◀ ▶ ◤ ◥ ◣ ◢ for tap-driving.
* **Portrait:** the controls stack. The HUD goes on top, and the throttle and steering sit side by side at the bottom.

### 2.4 Telemetry
* Battery voltage graph (last 10 min), battery % ring, runtime estimate, RSSI graph, latency, uptime, firmware version, motor output bars.
* Event log: armed, failsafe, low battery, E-stop, with timestamps.

### 2.5 Settings (glass sheet)
* **Driving:** default mode, max power, deadzone, expo, invert throttle/steering, steering trim (live slider), joystick layout, haptics on/off.
* **Rover:** name, Wi-Fi password, channel, battery calibration ("enter the multimeter reading"), low-battery thresholds. All saved on the ESP32.
* **App:** Light / Dark / Auto, keep screen awake, sounds.
* **About:** versions, open-source licences, community links.

---

## 3. Motion & feel

| Interaction | Animation |
|---|---|
| Any tap | Sink to 0.95 → spring back (`cubic-bezier(.3,1.6,.45,1)`) + light haptic |
| Joystick release | Knob springs back to centre with a slight overshoot. The value goes to 0 **immediately**; only the visual springs. |
| Mode change | White pill slides with the spring. Medium haptic. |
| Arm | Capsule fills left → right, chip turns green, two-pulse haptic |
| Connect success | Connect sheet morphs into the Drive screen (shared-element scale + fade) |
| Battery low | Battery chip turns orange, a gentle pulse every 5 s. Red + toast when critical. |
| Disconnect | Status bar chip turns red, controls dim to 40% and lock, and a "Reconnecting…" toast with a spinner appears |

Only `transform`, `opacity`, `box-shadow` and `background-color` animate. The control loop (30 Hz WebSocket sends) runs on a timer **separate from rendering**, so a dropped frame never delays a command.

---

## 4. Tech stack

| Layer | Choice | Why |
|---|---|---|
| UI | **Vite + TypeScript + React** | Fast dev, huge ecosystem. The joystick uses refs + `requestAnimationFrame`, not React state, for 120 fps. |
| Theme | `liquid-glass.css` + `liquid-glass.js` from [`app/design/LIQUID-GLASS-THEME.md`](../app/design/LIQUID-GLASS-THEME.md) §11–12 | Used unchanged |
| Native shell | **Capacitor** (Android) → APK `RC-Rovers` | Same web code becomes a real installable app |
| Plugins | `@capacitor/haptics`, `@capacitor/screen-orientation`, `@capacitor-community/keep-awake`, `@capacitor/status-bar` (immersive), `@capacitor/preferences` | Haptics, landscape lock, no screen sleep, full screen, saved settings |
| Comms | Native browser `WebSocket` + `fetch` | No library needed |

### Android gotchas (must-dos)
1. **Cleartext traffic:** the rover speaks plain `http://` / `ws://`. Set `server.androidScheme: "http"` in `capacitor.config.ts` and `android:usesCleartextTraffic="true"` in `AndroidManifest.xml`. Otherwise Android blocks it as mixed content.
2. **"No internet" Wi-Fi:** Android may warn about it. Pick *stay connected*. (On phones with mobile data, the app must bind to the Wi-Fi network. The Pad 5 has no SIM, so this doesn't apply to MARK 1.)
3. **Landscape lock** on the Drive screen. Free rotation elsewhere.
4. **Splash** stays light even in system dark mode (theme rule).

### Development path
1. **Phase 3:** the control page is served **by the ESP32** (from LittleFS), so you can iterate quickly in Chrome on the Pad.
2. **Phase 5:** move the same UI into `app/rc-rovers/` (Vite + Capacitor), build the APK, and sideload it onto the Pad 5 (`npx cap run android`, or install the APK via USB).
3. Keep both working. The ESP32-served page is a backup controller from any phone's browser.

---

## 5. App structure (Phase 5)

```
app/rc-rovers/
├── capacitor.config.ts
├── index.html               ← pre-paint theme script, theme-color meta
├── src/
│   ├── main.tsx
│   ├── styles/liquid-glass.css
│   ├── lib/liquid-glass.js
│   ├── rover/
│   │   ├── connection.ts    ← WebSocket, reconnect, 30 Hz send loop, ping/latency
│   │   ├── protocol.ts      ← message types from docs/control-protocol.md
│   │   └── rovers.ts        ← Garage registry (MARK 1 now, more later)
│   ├── screens/  Garage · Connect · Drive · Telemetry · Settings
│   └── components/ Joystick · ThrottleSlider · ModePicker · Ignition · EStop · BatteryChip · SignalChip
└── android/                 ← generated by Capacitor
```
