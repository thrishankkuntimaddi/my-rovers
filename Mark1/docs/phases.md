# MARK 1 — Build Phases

← Back to [MARK 1 README](../README.md)

Rule: **finish and test one phase before starting the next.** Each phase has a goal, steps, and a checklist. Tick the boxes in this file as you go and commit.

---

## Phase 0 — Setup & inventory

**Goal:** tools ready, the ESP32 is alive, and you know what's inside the car.

1. Install **Arduino IDE 2.x** → Boards Manager → **esp32 by Espressif Systems** (3.x).
2. Plug in the ESP32 with a *data* USB cable → Tools → Board → **ESP32 Dev Module**; Port → `/dev/cu.usbserial-*` or `/dev/cu.SLAB_USBtoUART`.
   * No port? Try another cable. Then install the driver for the USB chip next to the micro-USB socket: **CP2102** → Silicon Labs CP210x driver; **CH340** → WCH CH34x driver.
3. File → Examples → 01.Basics → **Blink**. Change `LED_BUILTIN` to `2` and upload. The blue LED blinks.
4. Remove the car's body (4–6 screws). Photograph the stock board **before** unplugging anything. Count the motors and their wires. Read the battery label.

- [ ] Arduino IDE + ESP32 core installed
- [ ] ESP32 detected on a port
- [ ] Blink works
- [ ] Motors identified (count, wire colours, steering type: 2-wire or 5-wire)
- [ ] Stock battery voltage noted: ______ V
- [ ] Multimeter available

---

## Phase 1 — Wi-Fi link *(current)*

**Goal:** the tablet sends commands to the ESP32 over the ESP32's own Wi-Fi. **No motors.**
Sketch: [`firmware/MARK1_Firmware_V1/MARK1_Firmware_V1.ino`](../firmware/MARK1_Firmware_V1/MARK1_Firmware_V1.ino)

1. Open the sketch → Verify → Upload. (Hold **BOOT** if it hangs on `Connecting....`.)
2. Serial Monitor at 115200 → check for `MARK 1 is ready.` and `IP Address: 192.168.4.1`.
3. Pad 5 → Wi-Fi → `MARK1_ROVER` / `Mark1Rover26` → *stay connected*.
4. Chrome → `http://192.168.4.1` → press all five buttons.

- [ ] ESP32 connected to laptop
- [ ] Firmware compiled
- [ ] Firmware uploaded
- [ ] `MARK1_ROVER` network appeared
- [ ] Tablet connected
- [ ] Control dashboard opened
- [ ] All five commands appeared in Serial Monitor
- [ ] `http://192.168.4.1/api/status` returns JSON

---

## Phase 2 — Motor bench test

**Goal:** the ESP32 spins one motor forward/reverse at different speeds through the L298N.
Wiring: [hardware doc §3, Phase 2](hardware-and-wiring.md#phase-2-bench-test-one-motor-esp32-still-on-usb).
Sketch (to be written): `firmware/MARK1_Firmware_V2/`. It adds motor control to V1, with the buttons from the web page driving channel A.

1. Car on a box, **wheels in the air**.
2. Unplug the stock board's motor connectors and wire **one drive motor** to OUT1/OUT2.
3. Remove the ENA jumper. Wire D25→ENA, D26→IN1, D27→IN2, GND↔GND.
4. Battery + → L298N 12V, battery − → L298N GND. The ESP32 stays on USB.
5. Test forward / reverse / stop at 30%, 60%, 100% from the web page.
6. Repeat for the second drive motor and the steering motor (on channel B: D13/D32/D33).

- [ ] Drive motor 1 forward + reverse
- [ ] Drive motor 2 forward + reverse
- [ ] Steering left + right (note how far it turns at what PWM: ______)
- [ ] Minimum start PWM found: ______ %
- [ ] L298N not too hot after 2 min

---

## Phase 3 — Drive control

**Goal:** full driving with smooth, safe control.
Sketch: `firmware/MARK1_Firmware_V3/`. It adds the WebSocket (`ws://192.168.4.1/ws`), the protocol in [control-protocol.md](control-protocol.md), arm/disarm, E-stop, the 300 ms failsafe, ramping, drive modes, and a better control page (joystick) served from LittleFS.

- [ ] Both drive motors on channel A push the car the same way
- [ ] Steering on channel B, centre returns
- [ ] Joystick drive works with two thumbs at once
- [ ] Modes change the top speed
- [ ] Starts and stops are smooth (ramping)
- [ ] Turning Wi-Fi off on the tablet stops the car within 0.3 s (failsafe)
- [ ] E-stop works instantly
- [ ] Boots disarmed

---

## Phase 4 — Power system (untethered)

**Goal:** the rover runs on its own battery, with voltage sensing.
Wiring: [hardware doc §3 Phase 4 + §4](hardware-and-wiring.md#phase-4-on-battery-untethered).

1. Decide on the pack (3S recommended) and charging (BMS + charger, or TP4056 one cell at a time).
2. Set the buck converter to **5.0 V** with the multimeter, **before** connecting the ESP32.
3. Wire pack → fuse → switch → L298N + buck → ESP32 VIN. All grounds common.
4. Add the 100 kΩ / 22 kΩ divider to D34. Calibrate against the multimeter.
5. Low-voltage warning, power cap and cutoff active.

- [ ] Buck output measured at 5.0 V
- [ ] ESP32 boots from battery (USB unplugged)
- [ ] Driving doesn't reset the ESP32 (no brownout)
- [ ] Battery voltage reading within 0.1 V of the multimeter
- [ ] Low-battery cutoff tested (with a bench supply or a nearly-empty pack)

---

## Phase 5 — RC-Rovers app

**Goal:** a native Android app on the Pad 5 with the Liquid Glass UI. Spec: [app-design.md](app-design.md).

- [ ] Vite + React + TS project in `app/rc-rovers/`, Liquid Glass kit applied
- [ ] Garage → Connect → Drive flow
- [ ] Landscape drive screen with throttle, steering, modes, ignition, E-stop
- [ ] Capacitor Android build, installed on the Pad 5
- [ ] Haptics, keep-awake, immersive full screen
- [ ] 120 fps when dragging controls, no dropped commands
- [ ] Light default; Dark/Auto in Settings

---

## Phase 6 — Telemetry & polish

- [ ] Battery % + runtime estimate shown live
- [ ] RSSI + latency shown
- [ ] Telemetry screen with graphs + event log
- [ ] Settings saved on the ESP32 (NVS): trim, caps, deadzone, Wi-Fi password
- [ ] OTA firmware update over Wi-Fi (`ArduinoOTA` or an upload page)
- [ ] Rover name + status LED patterns

---

## Phase 7 — Integration & release (MARK 1 v1.0)

- [ ] Electronics mounted on a plate inside the chassis, wires tidy, switch reachable
- [ ] Field test: 3 full battery runs indoors + outdoors, range test (metres: ______)
- [ ] Known issues documented
- [ ] Docs complete, wiring photos added to `media/`
- [ ] Build video recorded
- [ ] Repo tagged `mark1-v1.0`, open-source licence added
- [ ] Announced on the community channels (see [README](../README.md#launch--community))
