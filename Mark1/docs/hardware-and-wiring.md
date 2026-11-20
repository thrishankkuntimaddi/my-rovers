# MARK 1 — Hardware & Wiring

← Back to [MARK 1 README](../README.md)

This document explains **every physical part**, **how each one connects**, and **how to power the rover safely**. It is written for someone new to electronics, so every term is explained the first time it appears.

---

## 1. The parts and what they do

### ESP32 DevKit V1 (30-pin, ESP-WROOM-32): *the brain*
* A microcontroller with built-in **Wi-Fi** and Bluetooth. It runs our firmware, creates the `MARK1_ROVER` hotspot, receives commands and switches the motor driver.
* **Logic voltage is 3.3 V.** Never put more than 3.3 V on a GPIO pin.
* **Power in:** USB (micro-USB) **or** the `VIN` pin (5 V). The `3V3` pin is an *output*, not an input for batteries.
* Buttons: **EN** = reset, **BOOT** = hold while uploading if the upload hangs on `Connecting....`.
* Pin labels on this board:
  * top row: `VIN GND D13 D12 D14 D27 D26 D25 D33 D32 D35 D34 VN VP EN`
  * bottom row: `3V3 GND D15 D2 D4 RX2 TX2 D5 D18 D19 D21 RX0 TX0 D22 D23`

### L298N dual H-bridge: *the muscle*
* The ESP32 can't power a motor directly (a motor needs amps; a GPIO gives milliamps). The L298N switches battery power into the motors based on the ESP32's signals.
* An **H-bridge** can reverse the polarity, so a motor can spin both ways.
* Two channels: **A** (`OUT1/OUT2`, controlled by `ENA IN1 IN2`) and **B** (`OUT3/OUT4`, controlled by `ENB IN3 IN4`).
* `ENA`/`ENB` take a **PWM** signal. PWM switches the power on and off very fast, and the on-percentage sets the speed.
* Power terminal block: `12V` (motor supply in, labelled VS on some boards), `GND`, `5V`.
* **5V-EN jumper** (next to the power block): when fitted, an on-board regulator makes 5 V from the motor supply. That only works up to **12 V** input.
* It loses about **2 V** internally and gets warm. That's acceptable for MARK 1. MARK 2 can upgrade to a modern MOSFET driver (TB6612FNG / DRV8871 / BTS7960).

### The rock crawler: *the body*
* The 4WD rock crawler has **three motors** (confirmed):
  1. front axle drive motor ┐ wired **in parallel** → L298N channel A (forward / reverse)
  2. rear axle drive motor  ┘
  3. steering motor (front) → L298N channel B (left / right)
* One L298N is enough for MARK 1. No second driver and no handheld transmitter are needed; the RC-Rovers tablet app is the controller.
* The stock receiver board and its 2-pin battery plug (white JST, visible in the photos) are removed in Phase 2. **Keep the stock board.** Don't throw it away.
* **Check the original battery label** (often 4.8 V NiCd or 7.4 V Li-ion). The motors were designed for that voltage. A dedicated **motor buck converter** (see §4) steps the 3S pack down to suit them.
* **Steering type** (check in Phase 2):
  * **2 wires** → a plain DC motor with a return spring. The steering is left / centre / right; the amount of PWM sets how hard it turns.
  * **5 wires** (2 motor + 3 to a potentiometer) → position feedback is possible. Proportional steering becomes possible in a later phase.

### 18650 Li-ion cells + 3-slot holder: *the fuel*
* Each cell is 3.7 V nominal, 4.2 V full, 3.0 V empty, 2000 mAh.
* **Series (3S)** → 11.1 V nominal / 12.6 V full / 9.0 V empty. **Parallel** → 3.7 V with 3× the capacity.
* Most 3-slot holders with one red and one black lead are wired in **series**. **Measure it:** with cells inserted, the multimeter on DC volts across red/black should read about 11–12.6 V.

### TP4056 (HW-373, USB-C, with protection): *a single-cell charger*
* Charges **one** Li-ion cell to 4.2 V at up to 1 A. `B+ / B−` go to the cell, and `OUT+ / OUT−` is the protected output.
* ⚠️ **It cannot charge 2 or 3 cells in series.** Connecting it to the series pack is dangerous and won't work.
* Use it to charge **one cell at a time** (take the cell out of the holder) until a proper pack charger + BMS arrives. Red LED = charging, blue/green = full.

### INA219 current/voltage sensor: *the fuel gauge* (required)
* A small I²C board with a 0.1 Ω shunt resistor. It measures the **whole rover's current** (up to ±3.2 A) and the **pack voltage** (up to 26 V).
* It sits in the pack's + line, after the switch and before both buck converters, so every milliamp the rover uses passes through it.
* What it gives MARK 1:
  * **Accurate battery %** by counting the mAh actually used (coulomb counting), corrected by voltage when the rover is idle.
  * **Real runtime estimate** ("~38 min left at this pace") from the live current draw.
  * **Live amps / watts** in the app.
  * **Stall protection:** high current while the car isn't moving → cut the motors before the L298N or the motors overheat.
* Powered from the ESP32's **3V3** pin. I²C address **0x40** (default, no solder jumpers bridged).
* The 3 A fuse is below the INA219's 3.2 A limit, so the sensor is protected too.

### Breadboard and wires
* The breadboard is for **bench tests only**. Its contacts are loose and can't carry motor current. Inside the car, use screw terminals, soldered joints and heat-shrink.
* Jumper wires (Dupont) are fine for ESP32 → L298N signal wires. Use **thicker wire (≥ 22 AWG, ideally 20 AWG)** for battery and motor current.

---

## 2. Pin map (MARK 1 standard)

These pins are chosen because they are safe at boot (no strapping-pin trouble), support PWM, and use ADC1, which still works while Wi-Fi is on. **Every firmware version uses this map.**

| ESP32 pin | Goes to | Purpose |
|---|---|---|
| **GPIO 25** (`D25`) | L298N **ENA** | Drive speed (PWM) |
| **GPIO 26** (`D26`) | L298N **IN1** | Drive direction |
| **GPIO 27** (`D27`) | L298N **IN2** | Drive direction |
| **GPIO 13** (`D13`) | L298N **ENB** | Steering power (PWM) |
| **GPIO 32** (`D32`) | L298N **IN3** | Steering direction |
| **GPIO 33** (`D33`) | L298N **IN4** | Steering direction |
| **GPIO 21** (`D21`) | INA219 **SDA** | I²C data: current + pack voltage |
| **GPIO 22** (`D22`) | INA219 **SCL** | I²C clock |
| **3V3** | INA219 **VCC** | Sensor power (3.3 V logic) |
| **GPIO 34** (`D34`) | Battery voltage divider midpoint *(optional backup)* | Backup battery sense if the INA219 fails (input-only, ADC1) |
| **GPIO 2** | On-board blue LED | Status (blinks = AP up, solid = armed) |
| **GND** | L298N GND, battery −, both buck OUT−, INA219 GND | **Common ground** (mandatory) |
| **VIN** | Buck converter OUT+ (5.0 V) | Power from battery (Phase 4+) |

**Truth table (per channel):**

| IN1 | IN2 | ENA | Result |
|---|---|---|---|
| HIGH | LOW | PWM x% | Forward at x% |
| LOW | HIGH | PWM x% | Reverse at x% |
| LOW | LOW | any | Coast (free-wheel) |
| HIGH | HIGH | HIGH | Brake (motor shorted) |

**Remove the `ENA` and `ENB` jumper caps** on the L298N. Those caps tie enable to 5 V (always full speed). We connect our PWM wires to the **inner** pin of each (the pin nearer the `IN` pins).

---

## 3. Wiring by phase

### Phase 1: ESP32 only
```
Mac ──USB── ESP32
```
Nothing else is connected.

### Phase 2: bench test, one motor, ESP32 still on USB
```
                    ┌──────────────── L298N ────────────────┐
 ESP32 D25 ───────► ENA (jumper removed)        OUT1 ─────► motor wire 1
 ESP32 D26 ───────► IN1                         OUT2 ─────► motor wire 2
 ESP32 D27 ───────► IN2
 ESP32 GND ───────► GND ◄──── battery −
                    12V ◄──── battery + (through switch/fuse if you have them)
                    5V   (leave unconnected)
                    5V-EN jumper: leave as-is, it doesn't matter here
                    └───────────────────────────────────────┘
 ESP32 powered by the USB cable from the Mac
```
* Start with **one motor** and the **wheels off the ground**.
* The battery here can be the 3-cell pack, or 2 cells if your holder allows it (see §4).
* If the motor spins the "wrong" way, swap its two wires at OUT1/OUT2. Don't change the code.

### Phase 3: full drive (still on USB)
```
 L298N OUT1/OUT2 ─► FRONT drive motor  ┐  wired in parallel, same polarity
                 └► REAR  drive motor  ┘  (check both push the car forward)
 L298N OUT3/OUT4 ─► STEERING motor
 ESP32 D13 ─► ENB · D32 ─► IN3 · D33 ─► IN4
```
* Paralleling the two drive motors on channel A keeps MARK 1 within one L298N. Watch the heatsink temperature. If it gets too hot to touch after 2 minutes of driving, lower the mode caps or add a second driver.

### Phase 4: on battery (untethered)
```
 18650 pack + ──► FUSE (3 A) ──► SWITCH ──► INA219 VIN+ ··shunt·· VIN− ──┐
                                          ┌───────────────────────────────┘
                                          ├──► MOTOR BUCK (XL4015) IN+ ── OUT+ (≈ 8.5 V) ──► L298N 12V
                                          └──► LOGIC BUCK (LM2596/MP1584) IN+ ── OUT+ (5.0 V) ──► ESP32 VIN
 18650 pack − ────────────────────────────┬──► MOTOR BUCK IN− / OUT− ──► L298N GND
                                          ├──► LOGIC BUCK IN− / OUT−
                                          ├──► INA219 GND
                                          └──► ESP32 GND

 INA219:   VCC ◄── ESP32 3V3 · GND ── common GND · SDA ──► D21 · SCL ──► D22

 Optional backup sense:  pack+ (after switch) ──[100 kΩ]──┬──[22 kΩ]── GND
                                                          └──► ESP32 D34
```
* **Set both bucks with a multimeter before connecting anything to their outputs.** Logic buck → **5.0 V**. Motor buck → stock motor voltage **+ ~1.5 V** for the L298N's internal loss (e.g. 7.4 V motors → **8.5–9 V**).
* Two separate bucks: motor current spikes can't brown out (reset) the ESP32.
* **Keep the L298N 5V-EN jumper fitted.** Its on-board regulator powers the L298N's own logic from the ~8.5 V motor supply. Leave the L298N `5V` terminal **unconnected**. Never join it to the logic buck's 5 V.
* **INA219 direction matters:** current must flow **in at VIN+ and out at VIN−**. Reversed, it reads negative current.
* Use the INA219's **screw terminal** (or thick wire soldered to VIN+/VIN−) for the pack current. Don't run the full current through its thin header pins or a breadboard.
* Divider maths (3S): 12.6 V × 22 / 122 = **2.27 V** at the pin. That's safe, and it sits in the ESP32 ADC's accurate range. For a 2S pack use **100 kΩ + 47 kΩ** (8.4 V → 2.69 V).
* When flashing over USB with the battery connected, **turn the switch off** first.

---

## 4. Power system: decisions & battery safety

### Which pack voltage?

| Option | Voltage | Pros | Cons |
|---|---|---|---|
| **3S (3 × 18650 in series) + motor buck**, ✅ chosen | 9.0–12.6 V pack → fixed ≈ 8.5 V to the L298N | Uses all 3 cells (~22 Wh); motors get a safe, **constant** voltage from a full pack to an empty one; 100% throttle is always safe | Needs a second buck converter, a 3S BMS and a 12.6 V charger |
| **2S (2 cells)** | 6.0–8.4 V | Closer to stock motor voltage | After the L298N loss only ~4–6 V reaches the motors; sluggish when the cells are low |

**Why a motor buck:** the buck converter fixes the voltage the motors can ever see, so the drive modes (Crawl 25% … Full 100%) are plain PWM percentages, with no voltage-dependent caps in firmware. Speed also stays the same as the pack drains, because the buck holds ≈ 8.5 V until the pack itself drops near 9.5–10 V.

**Battery life:** the run time comes from the pack's energy, 3 × 7.4 Wh ≈ **22 Wh**. A buck converter is ~90% efficient. It doesn't add energy, but it wastes very little, and it keeps the motors in their safe range for the whole charge.

### Charging (in order of preference)
1. **3S BMS board (e.g. HX-3S-FL25A) + 12.6 V CC/CV charger.** The pack stays wired in the car, and the BMS protects against over-charge, over-discharge and short circuit. ✅ Best.
2. **TP4056, one cell at a time.** Take each cell out and charge it separately. Safe but slow. ✅ OK for now.
3. ❌ **Never** put the TP4056 across the series pack.

### Li-ion safety checklist
* Inspect each cell's wrap. If it's torn or dented, don't use it.
* Charge on a non-flammable surface, never unattended, never overnight.
* Never discharge below **3.0 V per cell** (9.0 V for 3S). The firmware disarms at **3.3 V/cell** (9.9 V) and warns at **3.5 V/cell**.
* Use a fuse close to the pack (+). It turns a short circuit into a blown fuse instead of a fire.
* Insulate every exposed joint with heat-shrink or electrical tape.

---

## 5. Mounting in the chassis (Phase 7)

* Mount the ESP32 and L298N on a small plate (acrylic or 3D-printed) with **nylon standoffs**, or with double-sided foam tape on the stock battery tray.
* Keep the **ESP32 antenna end** (the end with the zig-zag trace) away from metal and the motors, ideally sticking up or out.
* Give the L298N heatsink airflow.
* Mount the switch where you can reach it without removing the body.
* Zip-tie all wires clear of the wheels, axles and suspension travel. Leave strain relief at the motor leads.

---

## Shopping list

| Item | Why | Approx. |
|---|---|---|
| **Digital multimeter** | Measure voltages, set the buck converter, check polarity. Essential. | ₹500–1000 |
| **Logic buck converter** (MP1584EN mini or LM2596 adjustable) | Clean 5 V for the ESP32 from the pack | ₹60–150 |
| **Motor buck converter** (XL4015 5 A adjustable, CC/CV) | Steps the 12.6 V pack down to ≈ 8.5 V for the L298N + motors. Use 5 A or more: two drive motors spike at start-up | ₹150–300 |
| **3S BMS 18650** (10–25 A) | Protects the pack | ₹100–250 |
| **12.6 V 1–2 A Li-ion charger** (DC barrel) | Charges the 3S pack through the BMS | ₹250–500 |
| **Rocker / slide switch** (≥ 3 A) | Main power switch | ₹20–50 |
| **Inline fuse holder + 3 A fuses** | Short-circuit protection | ₹50–100 |
| **INA219 module** (CJMCU-219 or similar, 0.1 Ω shunt) | Current, power, mAh used, accurate battery % and runtime. **Required for MARK 1** | ₹150–250 |
| **Resistors 100 kΩ, 22 kΩ, 47 kΩ** (pack) | Optional backup voltage divider | ₹50 |
| **20–22 AWG silicone wire** (red/black) | Power wiring | ₹100 |
| **Heat-shrink assortment**, electrical tape | Insulation | ₹100 |
| **Soldering iron kit** + solder | Permanent joints | ₹400–800 |
| **XT30 or JST connectors** | Removable battery plug | ₹100 |
| Nylon M3 standoffs, zip ties, foam tape | Mounting | ₹150 |

Optional later: a MOSFET driver (TB6612FNG / DRV8871) if the L298N runs too hot with both drive motors on channel A.
