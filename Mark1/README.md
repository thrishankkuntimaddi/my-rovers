# MARK 1 — Tablet-Controlled Rock Crawler

> **Model:** MARK 1 · **Series:** [My Rovers](../README.md) · **Status:** 🟡 In development: RC-Rovers app v2.0 (Nova co-pilot, voice, missions, academy); hardware at Phase 1
> **Goal:** Drive a 4WD rock crawler from a Xiaomi Pad 5 running **RC-Rovers**, a premium Liquid Glass tablet app, over the ESP32's own Wi-Fi.

MARK 1 is the first rover in the **My Rovers** series. It takes an off-the-shelf toy rock crawler, removes its stock radio board, and gives it a new brain: an **ESP32** that creates its own Wi-Fi hotspot and drives the motors through an **L298N** motor driver. The driver uses an Android tablet app built with an Apple-style **Liquid Glass** interface.

MARK 1 is deliberately small in scope: **reliable, smooth, wireless driving with live status**. Cameras, arms, autonomy and LiDAR come in later Marks (see [Roadmap](#the-mark-series-roadmap)).

---

## Contents

1. [What MARK 1 does](#what-mark-1-does)
2. [System overview](#system-overview)
3. [Hardware on hand](#hardware-on-hand)
4. [Development phases](#development-phases)
5. [Folder structure](#folder-structure)
6. [Quick start (Phase 1)](#quick-start-phase-1)
7. [The Mark series roadmap](#the-mark-series-roadmap)
8. [Launch & community](#launch--community)
9. [Safety rules](#safety-rules)

Detailed documents:

| Doc | What's inside |
|---|---|
| [docs/hardware-and-wiring.md](docs/hardware-and-wiring.md) | Every component, pin map, wiring diagrams per phase, power system, battery safety, shopping list |
| [docs/app-design.md](docs/app-design.md) | RC-Rovers app: screens, landscape layout, Liquid Glass mapping, animations, tech stack |
| [docs/control-protocol.md](docs/control-protocol.md) | How the app and the ESP32 talk: commands, telemetry, failsafe, drive modes |
| [docs/phases.md](docs/phases.md) | Step-by-step guide for each phase with test checklists |

---

## What MARK 1 does

| Feature | Description |
|---|---|
| **Direct connect** | The rover broadcasts its own Wi-Fi (`MARK1_ROVER`). The tablet joins it, opens RC-Rovers, and connects. No router or internet needed. |
| **Ignition (Arm / Disarm)** | Motors stay locked until you "start the engine" with slide-to-arm in the app. Disarm locks them again. |
| **Drive** | Forward, reverse, left, right, and combinations (forward-left, forward-right, back-left, back-right). |
| **Proportional throttle** | A throttle control from slow crawl to full power, with smooth ramping (no jerky starts). |
| **Steering** | Left / centre / right. Proportional if the car's steering mechanism allows it (checked in Phase 2). |
| **Drive modes (presets)** | **Crawl** (25%), **Cruise** (50%), **Sport** (75%), **Full** (100%). These are max-power caps with different ramp speeds. |
| **Emergency stop** | One big tap stops everything immediately. |
| **Failsafe** | If the tablet goes silent for 300 ms (Wi-Fi drop, app closed), the rover stops by itself. |
| **Live status** | Connection state, signal strength (RSSI), battery voltage and %, live current (A) and power (W), mAh used, estimated runtime remaining, armed state, current mode, uptime. |
| **Settings** | Steering trim, max speed, deadzone, invert controls, light/dark theme, saved on the rover. |

---

## System overview

```
┌──────────────────────────┐        Wi-Fi (ESP32 hotspot)        ┌────────────────────────────────────┐
│  Xiaomi Pad 5            │   SSID MARK1_ROVER · 192.168.4.1    │  MARK 1 rover                      │
│  RC-Rovers app           │ ──────────────────────────────────► │                                    │
│  (landscape, 120 Hz)     │   drive commands @ 30 Hz (WebSocket)│  ESP32 DevKit (ESP-WROOM-32)       │
│                          │ ◄────────────────────────────────── │   ├─ PWM + direction ─► L298N      │
│  Liquid Glass UI         │   telemetry @ 5 Hz                  │   │                     ├─► drive  │
│  joystick / throttle     │                                     │   │                     └─► steer  │
│  modes · E-stop · HUD    │                                     │   └─ I²C ◄─ INA219 (amps + volts)  │
└──────────────────────────┘                                     │                                    │
                                                                 │  18650 pack ─► fuse ─► switch      │
                                                                 │     ─► INA219 current sensor       │
                                                                 │     ├─► motor buck 8.5 V ─► L298N  │
                                                                 │     └─► logic buck 5 V ─► ESP32    │
                                                                 └────────────────────────────────────┘
```

* **Brain:** ESP32 runs Arduino-framework firmware (Arduino IDE).
* **Muscle:** L298N dual H-bridge. Channel A drives the wheels, channel B drives the steering.
* **Power:** 18650 Li-ion pack. A buck converter makes a clean 5 V for the ESP32.
* **Link:** The ESP32 runs in Access-Point mode. Phase 1 uses simple HTTP. From Phase 3 the app uses a WebSocket for low-latency continuous control.
* **App:** Web technology (HTML/CSS/TS) wrapped as a native Android app with Capacitor. This lets the Liquid Glass CSS kit in [`app/design/`](app/design/) be used unchanged.

---

## Hardware on hand

| # | Component | Photo | Notes |
|---|---|---|---|
| 1 | 4WD rock crawler (blue "ROCK CRAWLER", ~1:18) | [side](media/hardware/01-rock-crawler-side.jpeg) · [body off](media/hardware/02-rock-crawler-body-off.jpeg) | **3 motors (confirmed):** front drive + rear drive (wired in parallel on L298N channel A) and steering (channel B). No handheld controller needed; the tablet is the controller. |
| 2 | ESP32 DevKit V1, 30-pin (ESP-WROOM-32, micro-USB) | [photo](media/hardware/03-esp32-devkit.jpeg) | Wi-Fi + Bluetooth microcontroller. |
| 3 | L298N dual H-bridge motor driver | [photo](media/hardware/04-l298n-motor-driver.jpeg) | 2 channels, ~2 V voltage drop, gets warm. Fine for Mark 1. |
| 4 | 3 × 18650 Li-ion cells (3.7 V, 2000 mAh) + 3-cell holder | [photo](media/hardware/05-18650-cells-holder.jpeg) | Check whether the holder wires the cells in **series** (11.1 V) with a multimeter. |
| 5 | TP4056 charger with protection (HW-373, USB-C) | [photo](media/hardware/06-tp4056-hw373-charger.jpeg) | ⚠️ Charges **one cell (1S) only**. It cannot charge the series pack. See hardware doc. |
| 6 | 830-point breadboard | [photo](media/hardware/07-breadboard.jpeg) | For bench testing only, not inside the moving car. |
| 7 | Jumper wires (M-M), hook-up wire, 2-pin leads | [photo](media/hardware/08-wires-and-jumpers.jpeg) | |
| 8 | Micro-USB cable | | Must be a **data** cable, not charge-only. |
| 9 | Xiaomi Pad 5 (Android, 11", 2560×1600, 120 Hz) | | Runs RC-Rovers. |

**Still needed:** multimeter (essential), 5 V logic buck converter (MP1584 or LM2596), motor buck converter (XL4015 5 A, ≈ 8.5 V for the motors), rocker switch, inline fuse, **INA219 current sensor (required)**, and a proper pack charger / BMS. Resistors (100 kΩ + 22 kΩ) only for the optional backup voltage sense. See the [shopping list](docs/hardware-and-wiring.md#shopping-list).

---

## Development phases

Each phase ends with a **test checklist**. Don't move on until every box is ticked.

| Phase | Name | Outcome | Status |
|---|---|---|---|
| **0** | Setup & inventory | Arduino IDE + ESP32 core installed, board detected, Blink works, car opened and motors identified | ⬜ |
| **1** | Wi-Fi link | ESP32 hotspot plus a basic control page. Commands show in Serial Monitor. **No motors.** | 🟡 current |
| **2** | Motor bench test | L298N + one motor at a time, wheels off the ground, ESP32 on USB. Direction + speed work. | ⬜ |
| **3** | Drive control | Both channels, WebSocket control, ramping, drive modes, arm/disarm, E-stop, 300 ms failsafe | ⬜ |
| **4** | Power system | Battery pack → fuse → switch → L298N + buck 5 V → ESP32. Battery voltage sensing. **Untethered.** | ⬜ |
| **5** | RC-Rovers app | Android app (Capacitor) with Liquid Glass UI, landscape drive screen, connect flow | ✅ v2.0: [`app/rc-rovers/`](app/rc-rovers/README.md) |
| **6** | Telemetry & polish | Battery %, runtime estimate, RSSI, trims, settings saved on the ESP32, OTA firmware updates | ⬜ |
| **7** | Integration & release | Everything mounted in the chassis, field tested, docs + video, **MARK 1 v1.0** published | ⬜ |

The full guide for each phase is in [docs/phases.md](docs/phases.md).

---

## Folder structure

```
Mark1/
├── README.md                    ← you are here: the description of MARK 1
├── docs/
│   ├── phases.md                ← step-by-step build guide + checklists
│   ├── hardware-and-wiring.md   ← components, pin map, wiring, power, safety
│   ├── app-design.md            ← RC-Rovers app spec (Liquid Glass, landscape)
│   └── control-protocol.md      ← app ↔ ESP32 messages, failsafe, modes
├── firmware/
│   └── MARK1_Firmware_V1/       ← Arduino sketch (folder name = sketch name)
│       └── MARK1_Firmware_V1.ino   Phase 1: Wi-Fi AP + web control, no motors
├── app/
│   ├── rc-rovers/               ← the RC-Rovers Android app (React + Capacitor) — see its README
│   └── design/                  ← Liquid Glass theme: spec, CSS kit, token table
│       ├── LIQUID-GLASS-THEME.md
│       ├── liquid-glass-theme.css
│       └── liquid-glass-theme.csv
└── media/
    ├── hardware/                ← photos of the parts and the car
    └── ui-reference/            ← Liquid Glass UI references (menus, lists, press states)
```

Later phases add `firmware/MARK1_Firmware_V2/` (motors), `V3/` (WebSocket + modes) and so on.

---

## Quick start (Phase 1)

1. Install **Arduino IDE 2.x**. In **Boards Manager**, install **esp32 by Espressif Systems**.
2. Plug the ESP32 in with a data micro-USB cable. Select **Tools → Board → esp32 → ESP32 Dev Module** and the matching **Port** (`/dev/cu.usbserial-…` or `/dev/cu.SLAB_USBtoUART` on macOS).
3. Open `firmware/MARK1_Firmware_V1/MARK1_Firmware_V1.ino` → **Upload**. If it gets stuck on `Connecting....`, hold the **BOOT** button until the upload starts.
4. Open **Serial Monitor** at **115200** baud. You should see `MARK 1 is ready.` and `IP Address: 192.168.4.1`.
5. On the tablet, join Wi-Fi **MARK1_ROVER** (password `Mark1Rover26`). Choose "stay connected" if Android warns there's no internet.
6. Open Chrome → `http://192.168.4.1` and press the buttons. Each one should print `[MARK1] Received command: …` in Serial Monitor.

> Don't connect the L298N, batteries or motors in Phase 1. First prove the wireless link works.

---

## The Mark series roadmap

| Model | Theme | Headline features |
|---|---|---|
| **MARK 1** | *Remote control* | Tablet app (Liquid Glass), Wi-Fi drive, modes, telemetry, failsafe |
| **MARK 2** | *Eyes* | Camera with live video in the app (FPV), lights, better motor drivers |
| **MARK 3** | *Hands* | Pan/tilt gimbal and a small arm, current/temperature sensors |
| **MARK 4** | *Brain* | On-board computer (Raspberry Pi / Jetson), AI-assisted driving, waypoint missions |
| **MARK 5** | *Vision in 3D* | LiDAR, SLAM mapping, autonomous navigation, "go run this errand" |
| **MARK N** | *New bodies* | New chassis, same platform: the app's **Garage** lists every rover you own |

Every Mark is released openly once complete (code, wiring, docs, build video).

---

## Launch & community

When MARK 1 hits v1.0, it gets announced and documented across these channels:

1. Website
2. YouTube channel: build videos, phase-by-phase
3. LinkedIn
4. Twitter / X
5. Discord: community and support
6. Reddit (r/esp32, r/arduino, r/rccars, r/robotics)
7. Instagram
8. Facebook

*(Add links here once the accounts exist.)*

---

## Safety rules

1. **Wheels off the ground** for every motor test. Put the car on a box.
2. **Common ground:** ESP32 GND, L298N GND and battery − must be connected.
3. **Never short an 18650.** A shorted Li-ion cell can burn. Use a fuse and insulate every joint.
4. **Never charge unattended.** Never charge a series pack with a single-cell TP4056.
5. **Don't discharge cells below 3.0 V.** The firmware stops the motors at a low-voltage cutoff (Phase 4).
6. **Unplug the battery while rewiring.** Switch the car off while flashing over USB.
7. **Set the buck converter to 5.0 V with a multimeter *before* connecting the ESP32.**
