/* MARK 1 build guide: the single source for parts, pin map, every wire and every build step.
   Mirrors Mark1/docs/hardware-and-wiring.md and docs/phases.md. Change it here and the
   Build screen (and its circuit diagram) follow. */

export type WireGroup = 'power' | 'motors' | 'control' | 'sensor';

/** Wire colours used in the circuit diagram and the wiring list. */
export const WIRE = {
  pack: '#FF3B30',      // pack + (9–12.6 V, after fuse/switch)
  motorV: '#FF9500',    // motor buck out ≈ 8.5 V
  logic5: '#AF52DE',    // 5.0 V to the ESP32
  v33: '#D4A000',       // 3.3 V to the INA219
  gnd: 'var(--lg-text-2)',
  sda: '#0A84FF',
  scl: '#32ADE6',
  en: '#34C759',        // PWM (speed)
  dir: '#5E5CE6',       // direction
  motor: '#A2845E',     // motor leads
} as const;

export interface Part {
  id: string;
  name: string;
  qty: string;
  role: string;
  have: boolean;          // already on the bench
  price?: string;         // ₹, for parts still to buy
  optional?: boolean;
  note?: string;
}

export const PARTS: Part[] = [
  // already have
  { id: 'chassis', name: '4WD rock crawler chassis', qty: '1', role: 'Body + 3 motors: front drive, rear drive, steering', have: true, note: 'Keep the stock receiver board. Don’t throw it away.' },
  { id: 'esp32', name: 'ESP32 DevKit V1 (30-pin, ESP-WROOM-32)', qty: '1 (+1 spare)', role: 'Brain: Wi-Fi hotspot, drive control, telemetry', have: true },
  { id: 'l298n', name: 'L298N dual H-bridge', qty: '1', role: 'Motor driver: channel A = both drive motors, channel B = steering', have: true },
  { id: 'cells', name: '18650 Li-ion cells, 3.7 V 2000 mAh', qty: '3', role: 'Fuel: 3S pack, ≈ 22 Wh', have: true },
  { id: 'holder', name: '3 × 18650 holder (series, one red/black lead)', qty: '1', role: 'Holds the cells in series: 9.0–12.6 V', have: true },
  { id: 'tp4056', name: 'TP4056 charger (HW-373, USB-C)', qty: '1', role: 'Charges ONE loose cell at a time. Never the pack', have: true },
  { id: 'bread', name: 'Breadboard + jumper wires', qty: '1 set', role: 'Bench tests only, not inside the car', have: true },
  { id: 'usb', name: 'Micro-USB data cable', qty: '1', role: 'Laptop ↔ ESP32 (flash firmware, Serial Monitor)', have: true, note: 'Must be a data cable, not charge-only.' },
  { id: 'tablet', name: 'Xiaomi Pad 5 + RC-Rovers', qty: '1', role: 'The controller. No handheld transmitter needed', have: true },
  { id: 'laptop', name: 'Laptop with Arduino IDE 2', qty: '1', role: 'Writes and flashes the firmware', have: true },
  // to buy
  { id: 'meter', name: 'Digital multimeter', qty: '1', role: 'Set the bucks, check polarity, verify readings. Essential', have: false, price: '500–1000' },
  { id: 'mbuck', name: 'Motor buck converter XL4015 (5 A, adjustable)', qty: '1', role: 'Pack 12.6 V → ≈ 8.5 V for the L298N + motors', have: false, price: '150–300' },
  { id: 'lbuck', name: 'Logic buck converter LM2596 or MP1584', qty: '1', role: 'Pack → 5.0 V for the ESP32 VIN', have: false, price: '60–150' },
  { id: 'ina', name: 'INA219 current/voltage sensor (0.1 Ω shunt)', qty: '1', role: 'Amps, watts, mAh used, accurate battery %, stall protection', have: false, price: '150–250' },
  { id: 'bms', name: '3S BMS for 18650 (10–25 A)', qty: '1', role: 'Protects the pack: over-charge, over-discharge, short', have: false, price: '100–250' },
  { id: 'charger', name: '12.6 V 1–2 A Li-ion charger + DC jack', qty: '1', role: 'Charges the 3S pack through the BMS', have: false, price: '250–500' },
  { id: 'switch', name: 'Rocker / slide switch (≥ 3 A)', qty: '1', role: 'Main power on/off', have: false, price: '20–50' },
  { id: 'fuse', name: 'Inline fuse holder + 3 A fuses', qty: '1 + spares', role: 'Short-circuit protection right after the pack', have: false, price: '50–100' },
  { id: 'solder', name: 'Soldering iron kit + solder', qty: '1', role: 'Permanent joints, BMS balance wires', have: false, price: '400–800' },
  { id: 'wire', name: '20–22 AWG silicone wire (red/black)', qty: '2 m each', role: 'Battery and motor current', have: false, price: '100' },
  { id: 'shrink', name: 'Heat-shrink + electrical tape', qty: '1 set', role: 'Insulate every joint', have: false, price: '100' },
  { id: 'xt30', name: 'XT30 connector pair', qty: '2', role: 'Removable battery plug', have: false, price: '100' },
  { id: 'mount', name: 'Nylon M3 standoffs, zip ties, foam tape', qty: '1 set', role: 'Mount the boards in the chassis', have: false, price: '150' },
  { id: 'divider', name: 'Resistors 100 kΩ + 22 kΩ', qty: '1 each', role: 'Backup battery-voltage sense on D34 if the INA219 fails', have: false, price: '50', optional: true },
];

export interface Pin { pin: string; to: string; purpose: string; color: string }

export const PINS: Pin[] = [
  { pin: 'D25', to: 'L298N ENA', purpose: 'Drive speed (PWM)', color: WIRE.en },
  { pin: 'D26', to: 'L298N IN1', purpose: 'Drive direction', color: WIRE.dir },
  { pin: 'D27', to: 'L298N IN2', purpose: 'Drive direction', color: WIRE.dir },
  { pin: 'D13', to: 'L298N ENB', purpose: 'Steering power (PWM)', color: WIRE.en },
  { pin: 'D32', to: 'L298N IN3', purpose: 'Steering direction', color: WIRE.dir },
  { pin: 'D33', to: 'L298N IN4', purpose: 'Steering direction', color: WIRE.dir },
  { pin: 'D21', to: 'INA219 SDA', purpose: 'I²C data', color: WIRE.sda },
  { pin: 'D22', to: 'INA219 SCL', purpose: 'I²C clock', color: WIRE.scl },
  { pin: '3V3', to: 'INA219 VCC', purpose: 'Sensor power', color: WIRE.v33 },
  { pin: 'VIN', to: 'Logic buck OUT+ (5.0 V)', purpose: 'ESP32 power from the pack', color: WIRE.logic5 },
  { pin: 'GND', to: 'Common ground', purpose: 'Logic buck OUT−, L298N GND, INA219 GND', color: WIRE.gnd },
  { pin: 'D34', to: 'Divider midpoint (optional)', purpose: 'Backup battery sense', color: WIRE.pack },
  { pin: 'D2', to: 'On-board LED', purpose: 'Status: blinks = Wi-Fi up, solid = armed', color: WIRE.gnd },
];

export interface Wire { id: string; group: WireGroup; from: string; to: string; color: string; spec: string; note?: string }

export const WIRES: Wire[] = [
  // power
  { id: 'p1', group: 'power', from: 'Pack / BMS P+', to: 'Fuse (3 A) in', color: WIRE.pack, spec: '20 AWG red' , note: 'Fuse as close to the pack as possible.' },
  { id: 'p2', group: 'power', from: 'Fuse out', to: 'Switch', color: WIRE.pack, spec: '20 AWG red' },
  { id: 'p3', group: 'power', from: 'Switch', to: 'INA219 VIN+', color: WIRE.pack, spec: '20 AWG red', note: 'Use the INA219 screw terminal, not the header pins.' },
  { id: 'p4', group: 'power', from: 'INA219 VIN−', to: 'Motor buck IN+', color: WIRE.pack, spec: '20 AWG red' },
  { id: 'p5', group: 'power', from: 'INA219 VIN−', to: 'Logic buck IN+', color: WIRE.pack, spec: '22 AWG red' },
  { id: 'p6', group: 'power', from: 'Pack / BMS P−', to: 'Motor buck IN−', color: WIRE.gnd, spec: '20 AWG black' },
  { id: 'p7', group: 'power', from: 'Pack / BMS P−', to: 'Logic buck IN−', color: WIRE.gnd, spec: '22 AWG black' },
  { id: 'p8', group: 'power', from: 'Motor buck OUT+ (≈ 8.5 V)', to: 'L298N 12V terminal', color: WIRE.motorV, spec: '20 AWG red', note: 'Set the buck to 8.5 V with the multimeter BEFORE connecting.' },
  { id: 'p9', group: 'power', from: 'Motor buck OUT−', to: 'L298N GND terminal', color: WIRE.gnd, spec: '20 AWG black' },
  { id: 'p10', group: 'power', from: 'Logic buck OUT+ (5.0 V)', to: 'ESP32 VIN', color: WIRE.logic5, spec: '22 AWG / jumper', note: 'Set the buck to 5.0 V BEFORE connecting the ESP32.' },
  { id: 'p11', group: 'power', from: 'Logic buck OUT−', to: 'ESP32 GND', color: WIRE.gnd, spec: '22 AWG / jumper' },
  { id: 'p12', group: 'power', from: 'L298N 5V terminal', to: 'Nothing (leave empty)', color: WIRE.gnd, spec: '—', note: 'Keep the 5V-EN jumper fitted. Never join this to the logic buck’s 5 V.' },
  { id: 'p13', group: 'power', from: 'Charge jack + / −', to: 'BMS P+ / P−', color: WIRE.pack, spec: '20 AWG', note: 'Charge with the switch OFF.' },
  // motors
  { id: 'm1', group: 'motors', from: 'L298N OUT1', to: 'Front motor wire A + Rear motor wire A', color: WIRE.motor, spec: '22 AWG', note: 'Front and rear in parallel, same polarity.' },
  { id: 'm2', group: 'motors', from: 'L298N OUT2', to: 'Front motor wire B + Rear motor wire B', color: WIRE.motor, spec: '22 AWG', note: 'If one axle fights the other, swap that motor’s two wires.' },
  { id: 'm3', group: 'motors', from: 'L298N OUT3', to: 'Steering motor wire A', color: WIRE.motor, spec: '22 AWG' },
  { id: 'm4', group: 'motors', from: 'L298N OUT4', to: 'Steering motor wire B', color: WIRE.motor, spec: '22 AWG', note: 'Steering turns the wrong way? Swap OUT3/OUT4 wires.' },
  // control
  { id: 'c1', group: 'control', from: 'ESP32 D25', to: 'L298N ENA', color: WIRE.en, spec: 'jumper', note: 'Remove the ENA jumper cap; use the inner pin (next to IN1).' },
  { id: 'c2', group: 'control', from: 'ESP32 D26', to: 'L298N IN1', color: WIRE.dir, spec: 'jumper' },
  { id: 'c3', group: 'control', from: 'ESP32 D27', to: 'L298N IN2', color: WIRE.dir, spec: 'jumper' },
  { id: 'c4', group: 'control', from: 'ESP32 D32', to: 'L298N IN3', color: WIRE.dir, spec: 'jumper' },
  { id: 'c5', group: 'control', from: 'ESP32 D33', to: 'L298N IN4', color: WIRE.dir, spec: 'jumper' },
  { id: 'c6', group: 'control', from: 'ESP32 D13', to: 'L298N ENB', color: WIRE.en, spec: 'jumper', note: 'Remove the ENB jumper cap; use the inner pin (next to IN4).' },
  { id: 'c7', group: 'control', from: 'ESP32 GND', to: 'L298N GND', color: WIRE.gnd, spec: 'jumper', note: 'Common ground: the signals need it. Mandatory.' },
  // sensor
  { id: 's1', group: 'sensor', from: 'ESP32 3V3', to: 'INA219 VCC', color: WIRE.v33, spec: 'jumper' },
  { id: 's2', group: 'sensor', from: 'ESP32 GND', to: 'INA219 GND', color: WIRE.gnd, spec: 'jumper' },
  { id: 's3', group: 'sensor', from: 'ESP32 D21', to: 'INA219 SDA', color: WIRE.sda, spec: 'jumper' },
  { id: 's4', group: 'sensor', from: 'ESP32 D22', to: 'INA219 SCL', color: WIRE.scl, spec: 'jumper' },
];

export const WIRE_GROUPS: { id: WireGroup; label: string }[] = [
  { id: 'power', label: 'Power' }, { id: 'motors', label: 'Motors' }, { id: 'control', label: 'Control' }, { id: 'sensor', label: 'Sensor' },
];

export interface Step { id: string; title: string; body: string; warn?: string; code?: string }
export interface Stage { id: string; title: string; goal: string; steps: Step[] }

export const STAGES: Stage[] = [
  {
    id: 'laptop', title: 'Laptop setup', goal: 'Your laptop can write firmware to the ESP32 and read its Serial Monitor.',
    steps: [
      { id: 'l1', title: 'Install Arduino IDE 2', body: 'Download it from arduino.cc/en/software and install it.' },
      { id: 'l2', title: 'Add the ESP32 boards', body: 'Arduino IDE → Settings → “Additional boards manager URLs”, paste the URL below. Then Boards Manager → search “esp32” → install “esp32 by Espressif Systems”.', code: 'https://espressif.github.io/arduino-esp32/package_esp32_index.json' },
      { id: 'l3', title: 'USB driver', body: 'Look at the small chip next to the ESP32’s USB port. CP2102 → install the Silicon Labs “CP210x VCP” driver. CH340 / CH9102 → install the WCH driver (newer macOS often has it built in).' },
      { id: 'l4', title: 'Plug in and pick the port', body: 'Connect with the micro-USB DATA cable. Tools → Board → esp32 → “ESP32 Dev Module”. Tools → Port → the one that appears when you plug in.', code: '/dev/cu.usbserial-…   /dev/cu.SLAB_USBtoUART   /dev/cu.wchusbserial…' },
      { id: 'l5', title: 'Install the libraries', body: 'Tools → Manage Libraries → install each (accept dependencies): “ESP Async WebServer” and “Async TCP” (both by ESP32Async), “ArduinoJson” (v7, Benoit Blanchon), “Adafruit INA219”. Only Firmware V3 needs them.' },
      { id: 'l6', title: 'Upload a sketch', body: 'Open firmware/MARK1_Firmware_V1/MARK1_Firmware_V1.ino from the project folder → Upload.', warn: '“Failed to connect… waiting for packet header”? Hold the BOOT button while it says Connecting…, let go when the % starts.' },
      { id: 'l7', title: 'Serial Monitor', body: 'Tools → Serial Monitor → 115200 baud. Press EN on the ESP32 to restart it and watch the boot messages.' },
      { id: 'l8', title: 'USB + battery rule', body: 'Once the battery is wired in (Phase 4), turn the rover’s power switch OFF before plugging the laptop in.', warn: 'Never feed the ESP32 from USB and the logic buck at the same time with the motors running.' },
    ],
  },
  {
    id: 'p1', title: 'Phase 1 · Wi-Fi link', goal: 'ESP32 hotspot works and the tablet’s commands show in the Serial Monitor. No motors.',
    steps: [
      { id: '1a', title: 'Flash Firmware V1', body: 'Upload MARK1_Firmware_V1.ino with the ESP32 on USB. The Serial Monitor shows the access point starting.' },
      { id: '1b', title: 'Join the rover’s Wi-Fi', body: 'On the Pad 5: Wi-Fi → MARK1_ROVER → password Mark1Rover26. Choose “stay connected” when Android says there’s no internet.' },
      { id: '1c', title: 'Connect from RC-Rovers', body: 'Garage → Connect. Drive: each command (forward, left, stop…) appears in the Serial Monitor.' },
    ],
  },
  {
    id: 'p2', title: 'Phase 2 · Motor bench test', goal: 'Each motor spins both ways at controlled speed. ESP32 on USB, wheels OFF the ground.',
    steps: [
      { id: '2a', title: 'Open the car', body: 'Remove the body. Unplug the stock receiver board and keep it. Label each motor’s wires with tape: F (front), R (rear), S (steering).' },
      { id: '2b', title: 'Note the stock voltage', body: 'Read the old battery’s label (often 4.8 V or 7.4 V). The motor buck is set to this + 1.5 V (7.4 V motors → 8.5–9 V).' },
      { id: '2b2', title: 'Flash Firmware V3', body: 'Upload firmware/MARK1_Firmware_V3/MARK1_Firmware_V3.ino. It boots disarmed. Its page at http://192.168.4.1 is a bench pad: hold a button to run at 35%, release to stop.' },
      { id: '2c', title: 'Prepare the L298N', body: 'Pull off the ENA and ENB jumper caps. Keep the 5V-EN jumper (next to the power terminal) fitted.' },
      { id: '2d', title: 'Wire channel A control', body: 'D25 → ENA (inner pin), D26 → IN1, D27 → IN2, ESP32 GND → L298N GND.' },
      { id: '2e', title: 'Motor power', body: 'With the motor buck: set it to ≈ 8.5 V first, then OUT+ → L298N 12V, OUT− → L298N GND. Before it arrives: pack → L298N directly, and keep the test PWM at 50% or less.', warn: 'Check polarity with the multimeter before every power connection.' },
      { id: '2f', title: 'Test each drive motor', body: 'Front motor on OUT1/OUT2: hold ▲ / ▼ on the bench page (short bursts). Then the rear motor alone. Wrong direction? Swap the motor’s two wires, not the code.' },
      { id: '2g', title: 'Test the steering motor', body: 'D13 → ENB, D32 → IN3, D33 → IN4, steering motor on OUT3/OUT4. Short pulses only. Count its wires: 2 = simple motor with return spring, 5 = has a position sensor.', warn: 'Don’t hold the steering against its end stop: a stalled motor heats up fast.' },
    ],
  },
  {
    id: 'p3', title: 'Phase 3 · Full drive', goal: 'Both channels, WebSocket control, ramping, modes, arm/disarm, E-stop, 300 ms failsafe. Still on USB.',
    steps: [
      { id: '3a', title: 'Drive motors in parallel', body: 'Front + rear on OUT1/OUT2 together. Lift the car: on “forward” both axles must push forward. If one fights, swap that motor’s wires.' },
      { id: '3b', title: 'Steering on channel B', body: 'Steering motor on OUT3/OUT4. “Right” on the tablet must turn the wheels right; otherwise swap the two wires.' },
      { id: '3c', title: 'Connect in full mode', body: 'Firmware V3 is already on the ESP32. RC-Rovers connects over WebSocket (Telemetry shows “Wi-Fi · WebSocket”); the bench pad is locked while the app is armed.' },
      { id: '3d', title: 'Safety tests', body: 'Arm → drive → disarm. E-stop stops instantly. Turn the tablet’s Wi-Fi off while driving: the rover must stop within 0.3 s.' },
      { id: '3e', title: 'Heat check', body: 'After 2 minutes of driving, touch the L298N heatsink. Too hot to hold? Lower the Max power in Settings.' },
    ],
  },
  {
    id: 'p4', title: 'Phase 4 · Power + INA219', goal: 'The rover runs on its own battery, with current and voltage sensing.',
    steps: [
      { id: '4a', title: 'Check the cells', body: 'Charge each cell with the TP4056 (one at a time). Measure each: 3.0–4.2 V and within 0.1 V of each other. Insert them and measure the holder’s red/black: 11–12.6 V confirms series.', warn: 'Damaged or dented wrap? Don’t use that cell.' },
      { id: '4b', title: 'Fit the BMS', body: 'Wire the 3S BMS exactly as printed on its board (B−, B1, B2, B+). The two balance wires (B1, B2) are soldered to the holder’s cell-to-cell links. Its P+ / P− are the pack’s output from now on.' },
      { id: '4c', title: 'Set both bucks (no load)', body: 'Feed each buck from the pack and turn its brass screw while measuring the output: logic buck 5.0 V, motor buck ≈ 8.5 V.', warn: 'Nothing connected to the outputs while adjusting. Never connect the ESP32 before you’ve measured 5.0 V.' },
      { id: '4d', title: 'Fuse + switch', body: 'P+ → 3 A fuse → switch. Keep the fuse as close to the pack as possible.' },
      { id: '4e', title: 'INA219 in the + line', body: 'Switch → INA219 VIN+. INA219 VIN− → motor buck IN+ and logic buck IN+. Use its screw terminal. Current must flow in at VIN+ and out at VIN−.' },
      { id: '4f', title: 'Outputs', body: 'Motor buck → L298N 12V / GND. Logic buck → ESP32 VIN / GND. L298N 5V terminal stays EMPTY (5V-EN jumper on).' },
      { id: '4g', title: 'INA219 signals', body: 'VCC → ESP32 3V3, GND → GND, SDA → D21, SCL → D22. All grounds are now common.' },
      { id: '4h', title: 'First power-up', body: 'USB unplugged, wheels off the ground, switch ON. ESP32 LED lights. Run an I²C scan: it must find 0x40.', warn: 'Smell, smoke or a hot part? Switch off immediately and recheck polarity.' },
      { id: '4i', title: 'Verify the readings', body: 'App → Telemetry: voltage within 0.1 V of the multimeter; current positive while driving and within 10% of the multimeter (in series, 10 A range).' },
      { id: '4j', title: 'Brownout test', body: 'Floor the throttle and reverse quickly: the ESP32 must not restart. Hold the wheels briefly in Crawl: the stall cut-off must trigger.' },
    ],
  },
  {
    id: 'charge', title: 'Charging', goal: 'Charge the pack safely every time.',
    steps: [
      { id: 'ch1', title: 'Charge through the BMS', body: 'Switch OFF. 12.6 V charger into the charge jack (BMS P+ / P−). Charger LED turns green when full.' },
      { id: 'ch2', title: 'Where and when', body: 'On a non-flammable surface. Never unattended, never overnight.' },
      { id: 'ch3', title: 'TP4056 is for single cells only', body: 'Only for a loose cell taken out of the holder.', warn: 'Never connect the TP4056 across the 3-cell pack.' },
    ],
  },
  {
    id: 'p7', title: 'Phase 7 · Into the chassis', goal: 'Everything mounted, field-tested: MARK 1 v1.0.',
    steps: [
      { id: '7a', title: 'Mount the boards', body: 'ESP32 and L298N on nylon standoffs or foam tape; heatsink with airflow. Bucks and INA219 on foam tape, away from the motors.' },
      { id: '7b', title: 'Permanent wiring', body: 'Replace breadboard joints with solder + heat-shrink. Battery on an XT30 plug. Switch and fuse reachable without opening the car.' },
      { id: '7c', title: 'Cable routing', body: 'Zip-tie all wires clear of the wheels, drive shafts and steering linkage. Full steering lock must not pull any wire.' },
      { id: '7d', title: 'Field test', body: 'Shake test, then a full battery run. Note the runtime from the app and check the L298N temperature.' },
    ],
  },
];

export const SAFETY: string[] = [
  'Wheels off the ground for every bench test.',
  'Check polarity with the multimeter before connecting any power.',
  'Set both bucks with the multimeter before anything is connected to them.',
  'One common ground: pack −, both bucks, L298N, INA219 and ESP32.',
  'Never discharge below 3.0 V per cell (9.0 V pack). Firmware warns at 10.5 V and cuts off at 9.6 V.',
  'Charge with the switch off, on a non-flammable surface, never unattended.',
  'The breadboard is for testing. In the car: solder, screw terminals, heat-shrink.',
];

export const ALL_STEPS = STAGES.flatMap((s) => s.steps);
