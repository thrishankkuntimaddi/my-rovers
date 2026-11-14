# MARK 1 — Control Protocol

← Back to [MARK 1 README](../README.md)

This document defines how the **RC-Rovers app** and the **ESP32 firmware** talk to each other. Both sides must follow it exactly, so that any future rover (MARK 2, 3 …) can speak the same language.

---

## 1. Network

| Item | Value |
|---|---|
| Wi-Fi mode | ESP32 Access Point (soft-AP) |
| SSID / password | `MARK1_ROVER` / `Mark1Rover26` (changeable in Settings, Phase 6) |
| Rover IP | `192.168.4.1` (fixed) |
| HTTP | port 80: control page (Phase 1), `/api/status`, `/api/info` |
| WebSocket | `ws://192.168.4.1/ws` (Phase 3+). Low-latency, two-way channel |
| Channel | Wi-Fi channel 1/6/11. Pick the least crowded one in Settings if control stutters. |

**Why WebSocket and not one HTTP request per button?** An HTTP request opens a new connection every time (~20–80 ms, uneven). A WebSocket stays open, and each message takes a few milliseconds. That smoothness is what makes the joystick feel connected to the wheels.

---

## 2. Phase 1 API (HTTP, current)

| Request | Response |
|---|---|
| `GET /` | Control page (HTML) |
| `GET /api/cmd?move=forward\|backward\|left\|right\|stop` | `{"ok":true,"command":"forward"}` or `400 {"error":…}` |
| `GET /api/status` | `{"device":"MARK1","status":"online","lastCommand":"stop"}` |

---

## 3. Phase 3+ messages (WebSocket, JSON)

All messages are small JSON objects with a type field `t`.

### App → Rover

| `t` | Fields | When | Effect |
|---|---|---|---|
| `hello` | `app`, `ver` | on connect | Rover replies with `info` |
| `drive` | `thr` −100…100, `str` −100…100, `seq` | **every 33 ms (30 Hz)** while the Drive screen is open, *even if the values haven't changed* | Sets target throttle and steering |
| `arm` | — | slide-to-start | Motors enabled (ignition on) |
| `disarm` | — | ignition off | Motors disabled, coast |
| `estop` | — | E-stop button | Brake, then disarm. Needs a fresh `arm` to drive again |
| `mode` | `m`: `crawl` \| `cruise` \| `sport` \| `full` | mode picker | Changes power cap + ramp rate |
| `trim` | `str` −20…20 | settings | Steering centre offset |
| `cfg` | `deadzone`, `invertThr`, `invertStr`, `maxPct` | settings | Saved to ESP32 flash (NVS) |
| `ping` | `ts` | every 1 s | Rover echoes it back (`pong`). The app measures latency. |

Example:
```json
{"t":"drive","thr":62,"str":-35,"seq":1842}
```

### Rover → App

| `t` | Fields | Rate |
|---|---|---|
| `info` | `name` "MARK 1", `model` "mark1", `fw` "1.x.y", `caps` (e.g. `["drive","steer","battery"]`) | once, after `hello` |
| `tel` | `armed`, `mode`, `thr`, `str` (actual output, after ramping), `vbat` (V), `pct` (%), `rssi` (dBm), `up` (s), `estMin` (estimated runtime minutes), `warn` (array) | **5 Hz** |
| `pong` | `ts` | reply to `ping` |
| `evt` | `e`: `failsafe` \| `lowbat` \| `cutoff` \| `estop` \| `armed` \| `disarmed` | when it happens |

Example:
```json
{"t":"tel","armed":true,"mode":"cruise","thr":48,"str":-35,"vbat":11.42,"pct":68,"rssi":-47,"up":512,"estMin":34,"warn":[]}
```

`caps` lets the app adapt to any rover. For example, MARK 2 adds `"camera"` and the app shows a video panel.

---

## 4. Safety logic (inside the firmware)

| Rule | Behaviour |
|---|---|
| **Disarmed on boot** | The motors never move until an `arm` arrives. |
| **Failsafe** | No `drive` message for **300 ms** → throttle ramps to 0 and steering centres. An `evt failsafe` is sent. After **2 s** of silence → auto-disarm. |
| **Client lost** | WebSocket disconnects → same as failsafe, then disarm. |
| **One driver** | Only one connected app can control. A second app gets view-only telemetry. |
| **E-stop** | Brake (both INs HIGH) for 300 ms, then coast and disarm. |
| **Low battery** | < 3.5 V/cell → `warn:["lowbat"]`; < 3.3 V/cell for 3 s → caps drop to *Crawl*; < 3.2 V/cell → `cutoff` and disarm. |
| **Direction change** | Forward ↔ reverse passes through 0 with a 120 ms pause. This protects the gears and the L298N. |

---

## 5. Drive modes (presets)

| Mode | Max power | Ramp (0 → max) | Feel |
|---|---|---|---|
| **Crawl** | 25% | 600 ms | Rock crawling, indoors, precise |
| **Cruise** | 50% | 400 ms | Everyday driving (default) |
| **Sport** | 75% | 250 ms | Quick |
| **Full** | 100% (of the voltage-safe cap) | 150 ms | Everything it has |

**Max power** is relative to the *voltage-safe cap* (see [hardware doc §4](hardware-and-wiring.md#4-power-system-decisions--battery-safety)), so even *Full* won't over-volt the toy motors.

**Throttle curve:** the app sends linear −100…100. The firmware applies a **deadzone** (default 5%), a **minimum start PWM** (the motor doesn't move below about 25% duty, so output jumps from 0 to the start value), and an **expo curve** for fine control at low speeds.

**PWM:** `ledcAttach(pin, 20000, 10)` → 20 kHz (silent, above hearing), 10-bit resolution (0–1023).

---

## 6. Battery % and runtime estimate

* `vbat` is sampled at 50 Hz on GPIO34 and averaged over 1 s. It's calibrated against a multimeter once (stored as a factor in NVS).
* `pct` comes from a per-cell lookup table, not a linear scale, because Li-ion voltage is flat in the middle:

| V/cell | 4.20 | 4.05 | 3.90 | 3.80 | 3.70 | 3.60 | 3.50 | 3.30 |
|---|---|---|---|---|---|---|---|---|
| % | 100 | 85 | 70 | 55 | 40 | 25 | 10 | 0 |

* Voltage sags under load, so `pct` uses voltage measured while the motors are idle or lightly loaded.
* `estMin` is the % drop rate over the last few minutes of real driving, extrapolated to 0%. It shows "—" until there's enough data. An INA219 current sensor (optional) makes this accurate.
