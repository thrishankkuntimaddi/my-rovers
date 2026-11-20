// =====================================================================
// PROJECT MARK 1 - FIRMWARE V3.0
// Phases 2-4: motors + WebSocket protocol + INA219 power telemetry.
// Spec: Mark1/docs/control-protocol.md · Wiring: Mark1/docs/hardware-and-wiring.md
//
// Board: "ESP32 Dev Module" (Arduino-ESP32 core 3.x) · Serial: 115200
// Libraries (Arduino IDE → Tools → Manage Libraries):
//   - ESP Async WebServer   (by ESP32Async)  + its dependency Async TCP (by ESP32Async)
//   - ArduinoJson           (by Benoit Blanchon, v7)
//   - Adafruit INA219       (by Adafruit)
//
// Safety summary (control-protocol.md §4):
//   disarmed on boot · 300 ms failsafe, 2 s auto-disarm · one driver ·
//   E-stop = brake 300 ms then disarm · low battery warn / crawl / cutoff ·
//   forward<->reverse passes through 0 with a 120 ms pause · INA219 stall cut-off.
// =====================================================================

#include <WiFi.h>
#include <esp_wifi.h>
#include <Wire.h>
#include <Preferences.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <Adafruit_INA219.h>

// ---------- identity / network ----------
#define FW_VERSION "3.0.0"
const char* AP_SSID = "MARK1_ROVER";
const char* AP_PASS = "Mark1Rover26";

// ---------- pin map (hardware-and-wiring.md §2) ----------
const int PIN_ENA = 25, PIN_IN1 = 26, PIN_IN2 = 27;   // channel A: front + rear drive (parallel)
const int PIN_ENB = 13, PIN_IN3 = 32, PIN_IN4 = 33;   // channel B: steering
const int PIN_SDA = 21, PIN_SCL = 22;                 // INA219
const int PIN_VSENSE = 34;                            // optional backup divider (100k / 22k)
const int PIN_LED = 2;

// ---------- tuning ----------
const uint32_t PWM_FREQ = 20000;      // 20 kHz, silent
const uint8_t  PWM_BITS = 10;         // 0..1023
const int      PWM_MAX = 1023;
const float    MIN_START = 25.0f;     // % duty where the drive motors start to turn
const float    STEER_MAX = 85.0f;     // % duty at full steering lock (limits stall heat)
const uint32_t FAILSAFE_MS = 300, AUTODISARM_MS = 2000;
const uint32_t ESTOP_BRAKE_MS = 300, REVERSE_PAUSE_MS = 120;
const uint32_t TEL_MS = 200;          // 5 Hz telemetry
const float    PACK_MAH = 2000.0f;
const int      CELLS = 3;
const float    DIVIDER_RATIO = (100.0f + 22.0f) / 22.0f;

struct ModeSpec { const char* id; float cap; float rampMs; };
const ModeSpec MODES[] = { {"crawl", 25, 600}, {"cruise", 50, 400}, {"sport", 75, 250}, {"full", 100, 150} };
enum { M_CRAWL = 0, M_CRUISE = 1, M_SPORT = 2, M_FULL = 3 };

// ---------- shared state (written by the WebSocket task, read by loop) ----------
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
volatile float    tgtThr = 0, tgtStr = 0;      // raw app input, -100..100
volatile uint32_t lastDriveMs = 0;
volatile bool     reqArm = false, reqDisarm = false, reqEstop = false, cfgDirty = false;
volatile int      modeIdx = M_CRUISE;
volatile uint32_t driverId = 0;                // WebSocket client allowed to drive (0 = none)

struct Cfg { float deadzone = 5, expo = 30, maxPct = 100, stallA = 2.5f, trim = 0; bool invThr = false, invStr = false; };
Cfg cfg;

// ---------- loop-owned state ----------
bool armed = false, failsafe = false, estopActive = false, cutoff = false, stallLatched = false;
uint32_t estopUntil = 0, reversePauseUntil = 0, bootMs = 0;
float outThr = 0, outStr = 0;                  // after ramping, -100..100
bool lowWarned = false;

// power
Adafruit_INA219 ina;
bool inaOk = false;
float vbat = NAN, amps = NAN, mah = 0, ampsAvg = NAN;
float vAvgAcc = 0, aAvgAcc = 0; int avgN = 0;
uint32_t lastPowerMs = 0, lastAvgMs = 0, idleSince = 0, lowSince = 0, critSince = 0, stallSince = 0, armedMs = 0;

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");
Preferences prefs;

// =====================================================================
// Helpers
// =====================================================================
static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }

// Li-ion % from per-cell voltage (control-protocol.md §6)
const float CELL_V[] = {4.20, 4.05, 3.90, 3.80, 3.70, 3.60, 3.50, 3.30};
const float CELL_P[] = {100, 85, 70, 55, 40, 25, 10, 0};
float cellPct(float v) {
  if (v >= CELL_V[0]) return 100;
  for (int i = 1; i < 8; i++)
    if (v >= CELL_V[i]) return CELL_P[i] + (v - CELL_V[i]) / (CELL_V[i - 1] - CELL_V[i]) * (CELL_P[i - 1] - CELL_P[i]);
  return 0;
}

// deadzone + expo + invert + max power (same maths as the app's shape())
float shape(float v, bool invert) {
  float x = clampf(v, -100, 100) / 100.0f;
  if (invert) x = -x;
  float s = x < 0 ? -1 : 1, a = fabsf(x), dz = cfg.deadzone / 100.0f;
  a = a < dz ? 0 : (a - dz) / (1 - dz);
  float e = cfg.expo / 100.0f;
  a = e * a * a * a + (1 - e) * a;
  return s * a * cfg.maxPct;
}

void sendEvt(const char* e) {
  char buf[48];
  snprintf(buf, sizeof buf, "{\"t\":\"evt\",\"e\":\"%s\"}", e);
  ws.textAll(buf);
  Serial.printf("[MARK1] evt %s\n", e);
}

void loadCfg() {
  prefs.begin("mark1", true);
  cfg.deadzone = prefs.getFloat("dz", 5);  cfg.expo = prefs.getFloat("expo", 30);
  cfg.maxPct = prefs.getFloat("max", 100); cfg.stallA = prefs.getFloat("stall", 2.5f);
  cfg.trim = prefs.getFloat("trim", 0);    cfg.invThr = prefs.getBool("invT", false); cfg.invStr = prefs.getBool("invS", false);
  prefs.end();
}
void saveCfg() {
  prefs.begin("mark1", false);
  prefs.putFloat("dz", cfg.deadzone); prefs.putFloat("expo", cfg.expo); prefs.putFloat("max", cfg.maxPct);
  prefs.putFloat("stall", cfg.stallA); prefs.putFloat("trim", cfg.trim);
  prefs.putBool("invT", cfg.invThr);  prefs.putBool("invS", cfg.invStr);
  prefs.end();
}

// =====================================================================
// Motors (L298N)
// =====================================================================
// channel output: pct -100..100; brake = both INs HIGH with EN HIGH
void setChannel(int en, int a, int b, float pct, bool brake = false) {
  if (brake) { digitalWrite(a, HIGH); digitalWrite(b, HIGH); ledcWrite(en, PWM_MAX); return; }
  if (fabsf(pct) < 0.5f) { digitalWrite(a, LOW); digitalWrite(b, LOW); ledcWrite(en, 0); return; }   // coast
  digitalWrite(a, pct > 0 ? HIGH : LOW);
  digitalWrite(b, pct > 0 ? LOW : HIGH);
  ledcWrite(en, (int)(clampf(fabsf(pct), 0, 100) / 100.0f * PWM_MAX));
}

void applyOutputs() {
  if (estopActive) { setChannel(PIN_ENA, PIN_IN1, PIN_IN2, 0, true); setChannel(PIN_ENB, PIN_IN3, PIN_IN4, 0); return; }
  // drive: jump from 0 to the start duty so tiny throttle still moves the car
  float d = fabsf(outThr) < 0.5f ? 0 : (outThr > 0 ? 1 : -1) * (MIN_START + (100 - MIN_START) * fabsf(outThr) / 100.0f);
  setChannel(PIN_ENA, PIN_IN1, PIN_IN2, d);
  setChannel(PIN_ENB, PIN_IN3, PIN_IN4, outStr * STEER_MAX / 100.0f);
}

void disarm(const char* why) {
  armed = false; outThr = 0; outStr = 0; failsafe = false;
  portENTER_CRITICAL(&mux); tgtThr = 0; tgtStr = 0; portEXIT_CRITICAL(&mux);
  applyOutputs();
  if (why) sendEvt(why);
}

// =====================================================================
// Power: INA219 (fallback: divider on D34)
// =====================================================================
void powerBegin() {
  Wire.begin(PIN_SDA, PIN_SCL);
  inaOk = ina.begin();          // default calibration: 32 V, up to 3.2 A with the 0.1 Ω shunt
  Serial.printf("[MARK1] INA219 %s\n", inaOk ? "found at 0x40" : "NOT found: check VCC/GND/SDA(D21)/SCL(D22)");
  analogSetPinAttenuation(PIN_VSENSE, ADC_11db);
}

float readPackV() {
  if (inaOk) return ina.getBusVoltage_V() + ina.getShuntVoltage_mV() / 1000.0f;   // VIN- to GND + shunt drop
  float v = analogReadMilliVolts(PIN_VSENSE) / 1000.0f * DIVIDER_RATIO;
  return v > 5.0f ? v : NAN;     // nothing on D34 → no reading
}

void powerTick(uint32_t now) {
  if (now - lastPowerMs < 20) return;                  // 50 Hz sampling
  float dt = (now - lastPowerMs) / 1000.0f;
  lastPowerMs = now;
  float v = readPackV();
  float a = inaOk ? ina.getCurrent_mA() / 1000.0f : NAN;
  if (!isnan(v)) { vAvgAcc += v; }
  if (!isnan(a)) { aAvgAcc += a; mah += max(0.0f, a) * 1000.0f * dt / 3600.0f; }  // coulomb counting
  avgN++;

  if (now - lastAvgMs < 1000 || avgN == 0) return;     // 1 s averages
  lastAvgMs = now;
  bool first = isnan(vbat);
  vbat = isnan(v) ? NAN : vAvgAcc / avgN;
  amps = inaOk ? aAvgAcc / avgN : NAN;
  vAvgAcc = aAvgAcc = 0; avgN = 0;
  if (isnan(vbat)) return;
  float perCell = vbat / CELLS;

  // starting charge from the resting voltage, and drift correction while idle
  bool idle = !inaOk || amps < 0.2f;
  if (idle) { if (!idleSince) idleSince = now; } else idleSince = 0;
  bool restedIdle = idleSince && now - idleSince > 3000;
  float vPct = cellPct(perCell);
  if (first) mah = (1 - vPct / 100.0f) * PACK_MAH;
  else if (restedIdle) {
    if (perCell >= 4.15f) mah = 0;                                       // freshly charged
    else if (fabsf((1 - mah / PACK_MAH) * 100 - vPct) > 15) mah = (1 - vPct / 100.0f) * PACK_MAH;
  }
  mah = clampf(mah, 0, PACK_MAH);

  // runtime estimate: average current over ~2 min of driving
  if (inaOk && armed) { ampsAvg = isnan(ampsAvg) ? amps : ampsAvg + (amps - ampsAvg) * (1.0f / 120.0f); armedMs += 1000; }

  // low battery (control-protocol.md §4)
  if (perCell < 3.5f && !lowWarned) { lowWarned = true; sendEvt("lowbat"); }
  if (perCell >= 3.6f) lowWarned = false;
  if (perCell < 3.3f) { if (!lowSince) lowSince = now; } else lowSince = 0;
  if (perCell < 3.2f) { if (!critSince) critSince = now; } else critSince = 0;
  if (critSince && now - critSince > 3000 && !cutoff) { cutoff = true; if (armed) disarm("cutoff"); else sendEvt("cutoff"); }
}

// =====================================================================
// WebSocket protocol
// =====================================================================
void sendInfo(AsyncWebSocketClient* c) {
  JsonDocument d;
  d["t"] = "info"; d["name"] = "MARK 1"; d["model"] = "mark1"; d["fw"] = FW_VERSION;
  JsonArray caps = d["caps"].to<JsonArray>();
  caps.add("drive"); caps.add("steer"); caps.add("battery"); if (inaOk) caps.add("current");
  String s; serializeJson(d, s); c->text(s);
}

void handleMsg(AsyncWebSocketClient* c, const char* data, size_t len) {
  JsonDocument d;
  if (deserializeJson(d, data, len)) return;
  const char* t = d["t"] | "";
  uint32_t id = c->id();

  if (!strcmp(t, "ping")) {                         // anyone may ping
    char buf[64]; snprintf(buf, sizeof buf, "{\"t\":\"pong\",\"ts\":%.0f}", d["ts"] | 0.0);
    c->text(buf); return;
  }
  if (!strcmp(t, "hello")) {
    // first app drives; a reconnecting app takes over once the old driver has been silent > 2 s
    portENTER_CRITICAL(&mux); if (driverId == 0 || millis() - lastDriveMs > AUTODISARM_MS) driverId = id; portEXIT_CRITICAL(&mux);
    sendInfo(c); return;
  }
  if (driverId != id) return;                       // one driver; others are view-only

  if (!strcmp(t, "drive")) {
    portENTER_CRITICAL(&mux);
    tgtThr = clampf(d["thr"] | 0.0f, -100, 100); tgtStr = clampf(d["str"] | 0.0f, -100, 100); lastDriveMs = millis();
    portEXIT_CRITICAL(&mux);
  } else if (!strcmp(t, "arm"))    reqArm = true;
  else if (!strcmp(t, "disarm"))   reqDisarm = true;
  else if (!strcmp(t, "estop"))    reqEstop = true;
  else if (!strcmp(t, "mode")) {
    const char* m = d["m"] | "cruise";
    for (int i = 0; i < 4; i++) if (!strcmp(m, MODES[i].id)) modeIdx = i;
  } else if (!strcmp(t, "trim")) { cfg.trim = clampf(d["str"] | 0.0f, -20, 20); cfgDirty = true; }
  else if (!strcmp(t, "cfg")) {
    cfg.deadzone = clampf(d["deadzone"] | cfg.deadzone, 0, 30);
    cfg.expo     = clampf(d["expo"] | cfg.expo, 0, 100);
    cfg.maxPct   = clampf(d["maxPct"] | cfg.maxPct, 10, 100);
    cfg.stallA   = clampf(d["stallA"] | cfg.stallA, 0.5f, 3.2f);
    cfg.invThr   = d["invertThr"] | cfg.invThr;
    cfg.invStr   = d["invertStr"] | cfg.invStr;
    cfgDirty = true;
  }
}

void onWs(AsyncWebSocket*, AsyncWebSocketClient* c, AwsEventType type, void* arg, uint8_t* data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    Serial.printf("[MARK1] app #%u connected\n", c->id());
  } else if (type == WS_EVT_DISCONNECT) {
    Serial.printf("[MARK1] app #%u left\n", c->id());
    portENTER_CRITICAL(&mux);
    if (driverId == c->id()) { driverId = 0; tgtThr = 0; tgtStr = 0; lastDriveMs = 0; }   // → failsafe, then disarm
    portEXIT_CRITICAL(&mux);
  } else if (type == WS_EVT_DATA) {
    AwsFrameInfo* info = (AwsFrameInfo*)arg;
    if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) handleMsg(c, (const char*)data, len);
  }
}

int stationRssi() {
  wifi_sta_list_t list;
  if (esp_wifi_ap_get_sta_list(&list) != ESP_OK || list.num == 0) return 0;
  return list.sta[0].rssi;
}

void sendTelemetry(uint32_t now) {
  if (!ws.count()) return;
  JsonDocument d;
  d["t"] = "tel"; d["armed"] = armed; d["mode"] = MODES[modeIdx].id;
  d["thr"] = (int)roundf(outThr); d["str"] = (int)roundf(outStr);
  if (isnan(vbat)) d["vbat"] = nullptr; else d["vbat"] = roundf(vbat * 100) / 100;
  if (inaOk && !isnan(amps)) {
    d["amps"] = roundf(amps * 100) / 100;
    d["watts"] = isnan(vbat) ? 0 : roundf(vbat * amps * 10) / 10;
    d["mah"] = (int)roundf(mah);
  } else { d["amps"] = nullptr; d["watts"] = nullptr; d["mah"] = nullptr; }
  if (isnan(vbat)) d["pct"] = nullptr;
  else d["pct"] = (int)roundf(inaOk ? 100 * (1 - mah / PACK_MAH) : cellPct(vbat / CELLS));
  int rssi = stationRssi(); if (rssi) d["rssi"] = rssi; else d["rssi"] = nullptr;
  d["up"] = (now - bootMs) / 1000;
  if (inaOk && armedMs >= 30000 && !isnan(ampsAvg)) d["estMin"] = (int)roundf((PACK_MAH - mah) / (max(0.15f, ampsAvg) * 1000.0f) * 60);
  else d["estMin"] = nullptr;
  JsonArray w = d["warn"].to<JsonArray>();
  if (!isnan(vbat) && vbat / CELLS < 3.5f) w.add("lowbat");
  if (stallLatched) w.add("stall");
  if (failsafe) w.add("failsafe");
  if (cutoff) w.add("cutoff");
  if (!inaOk) w.add("nosensor");
  String s; serializeJson(d, s); ws.textAll(s);
}

// =====================================================================
// HTTP: status/info for the app's connect check + a bench-test page
// =====================================================================
uint32_t benchUntil = 0; float benchThr = 0, benchStr = 0;
const float BENCH_PCT = 35;   // bench page power

const char BENCH_PAGE[] PROGMEM = R"HTML(<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MARK 1 bench</title><style>body{font-family:system-ui;background:#10141d;color:#fff;text-align:center;margin:0;padding:20px}
button{width:110px;height:80px;margin:6px;border:0;border-radius:18px;font-size:18px;font-weight:700;background:#2b3345;color:#fff}
button:active{background:#0a84ff}p{color:#9aa3b5}</style></head><body><h2>MARK 1 · bench test</h2>
<p>Wheels off the ground. Hold a button: 35% power, stops when released. Drive with the RC-Rovers app.</p>
<div><button data-m="forward">▲</button></div><div><button data-m="left">◀</button><button data-m="stop">■</button><button data-m="right">▶</button></div>
<div><button data-m="backward">▼</button></div><p id="s"></p><script>
let t=null;const go=m=>fetch('/api/cmd?move='+m).then(r=>r.json()).then(j=>s.textContent=j.command||j.error).catch(()=>{});
document.querySelectorAll('button').forEach(b=>{const m=b.dataset.m;
b.onpointerdown=()=>{go(m);clearInterval(t);if(m!=='stop')t=setInterval(()=>go(m),150)};
b.onpointerup=b.onpointerleave=()=>{clearInterval(t);go('stop')}});</script></body></html>)HTML";

void sendJson(AsyncWebServerRequest* r, int code, const String& body) {
  AsyncWebServerResponse* res = r->beginResponse(code, "application/json", body);
  res->addHeader("Access-Control-Allow-Origin", "*");
  res->addHeader("Cache-Control", "no-store");
  r->send(res);
}

void setupHttp() {
  server.on("/", HTTP_GET, [](AsyncWebServerRequest* r) { r->send(200, "text/html", BENCH_PAGE); });
  server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest* r) {
    String s = String("{\"device\":\"MARK1\",\"status\":\"online\",\"fw\":\"") + FW_VERSION + "\",\"armed\":" + (armed ? "true" : "false") +
               ",\"vbat\":" + (isnan(vbat) ? String("null") : String(vbat, 2)) + ",\"ina219\":" + (inaOk ? "true" : "false") + "}";
    sendJson(r, 200, s);
  });
  server.on("/api/info", HTTP_GET, [](AsyncWebServerRequest* r) {
    sendJson(r, 200, String("{\"name\":\"MARK 1\",\"model\":\"mark1\",\"fw\":\"") + FW_VERSION + "\"}");
  });
  server.on("/api/cmd", HTTP_GET, [](AsyncWebServerRequest* r) {
    if (!r->hasParam("move")) return sendJson(r, 400, "{\"error\":\"Missing command\"}");
    String m = r->getParam("move")->value(); m.toLowerCase();
    if (armed) return sendJson(r, 409, "{\"error\":\"App is driving\"}");
    float t = 0, s = 0;
    if (m == "forward") t = BENCH_PCT; else if (m == "backward") t = -BENCH_PCT;
    else if (m == "left") s = -100; else if (m == "right") s = 100;
    else if (m != "stop") return sendJson(r, 400, "{\"error\":\"Invalid command\"}");
    portENTER_CRITICAL(&mux); benchThr = t; benchStr = s; benchUntil = m == "stop" ? 0 : millis() + 400; portEXIT_CRITICAL(&mux);
    Serial.printf("[MARK1] bench %s\n", m.c_str());
    sendJson(r, 200, "{\"ok\":true,\"command\":\"" + m + "\"}");
  });
  ws.onEvent(onWs);
  server.addHandler(&ws);
  server.begin();
}

// =====================================================================
// Setup / loop
// =====================================================================
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n============================\n   PROJECT MARK 1\n   Firmware " FW_VERSION "\n============================");

  pinMode(PIN_IN1, OUTPUT); pinMode(PIN_IN2, OUTPUT); pinMode(PIN_IN3, OUTPUT); pinMode(PIN_IN4, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  ledcAttach(PIN_ENA, PWM_FREQ, PWM_BITS);
  ledcAttach(PIN_ENB, PWM_FREQ, PWM_BITS);
  applyOutputs();                                   // everything off: disarmed on boot

  loadCfg();
  powerBegin();

  WiFi.mode(WIFI_AP);
  WiFi.setSleep(false);                             // lower, steadier latency
  if (!WiFi.softAP(AP_SSID, AP_PASS)) Serial.println("Wi-Fi startup failed!");
  Serial.printf("Wi-Fi %s · %s · %s\n", AP_SSID, AP_PASS, WiFi.softAPIP().toString().c_str());

  setupHttp();
  bootMs = lastPowerMs = lastAvgMs = millis();
  Serial.println("MARK 1 ready. Connect with RC-Rovers.");
}

void loop() {
  uint32_t now = millis();
  static uint32_t lastTick = now, lastTel = 0, lastClean = 0, lastSave = 0;
  float dt = (float)(now - lastTick); lastTick = now;

  powerTick(now);

  // ---- commands from the app ----
  if (reqEstop) {
    reqEstop = false; reqArm = false;
    armed = false; estopActive = true; estopUntil = now + ESTOP_BRAKE_MS; outThr = 0; outStr = 0;
    portENTER_CRITICAL(&mux); tgtThr = 0; tgtStr = 0; portEXIT_CRITICAL(&mux);
    sendEvt("estop");
  }
  if (estopActive && now >= estopUntil) { estopActive = false; applyOutputs(); }
  if (reqDisarm) { reqDisarm = false; if (armed) disarm("disarmed"); }
  if (reqArm) {
    reqArm = false;
    if (cutoff) sendEvt("cutoff");                  // battery flat: refuse
    else if (!armed && !estopActive) { armed = true; failsafe = false; stallLatched = false; portENTER_CRITICAL(&mux); lastDriveMs = now; portEXIT_CRITICAL(&mux); sendEvt("armed"); }
  }
  if (cfgDirty && now - lastSave > 1000) { cfgDirty = false; lastSave = now; saveCfg(); }

  // ---- snapshot inputs ----
  portENTER_CRITICAL(&mux);
  float inThr = tgtThr, inStr = tgtStr; uint32_t lastDrive = lastDriveMs;
  float bThr = benchThr, bStr = benchStr; uint32_t bUntil = benchUntil;
  portEXIT_CRITICAL(&mux);

  // ---- failsafe ----
  uint32_t silent = now - lastDrive;
  if (armed && silent > FAILSAFE_MS && !failsafe) { failsafe = true; sendEvt("failsafe"); }
  if (armed && silent <= FAILSAFE_MS) failsafe = false;
  if (armed && silent > AUTODISARM_MS) disarm("disarmed");

  // ---- targets ----
  int mi = (lowSince && now - lowSince > 3000) ? M_CRAWL : modeIdx;   // weak battery → Crawl caps
  const ModeSpec& spec = MODES[mi];
  float wantThr = 0, wantStr = 0;
  if (armed && !failsafe && !estopActive) {
    if (stallLatched && fabsf(inThr) < 5) stallLatched = false;       // throttle released → may drive again
    wantThr = stallLatched ? 0 : shape(inThr, cfg.invThr) * spec.cap / 100.0f;
    wantStr = clampf(shape(inStr, cfg.invStr) + cfg.trim, -100, 100);
  } else if (!armed && !estopActive && now < bUntil) {                // bench page (disarmed only)
    wantThr = bThr; wantStr = bStr;
  }

  // ---- ramping, with a pause through zero on direction change ----
  if (now < reversePauseUntil) wantThr = 0;
  else if (fabsf(outThr) > 0.5f && wantThr != 0 && (wantThr > 0) != (outThr > 0)) wantThr = 0;   // come down first
  float stepThr = 100.0f / spec.rampMs * dt;
  float before = outThr;
  outThr += clampf(wantThr - outThr, -stepThr, stepThr);
  if (fabsf(before) > 0.5f && fabsf(outThr) <= 0.5f && wantThr == 0 && fabsf(inThr) > 0 && armed) reversePauseUntil = now + REVERSE_PAUSE_MS;
  float stepStr = 0.9f * dt;                                          // ~110 ms lock to lock
  outStr += clampf(wantStr - outStr, -stepStr, stepStr);

  // ---- stall protection (INA219) ----
  if (inaOk && armed && !isnan(amps) && amps > cfg.stallA && fabsf(outThr) > 5) {
    if (!stallSince) stallSince = now;
    if (now - stallSince > 1500 && !stallLatched) { stallLatched = true; outThr = 0; sendEvt("stall"); }
  } else stallSince = 0;

  applyOutputs();

  // ---- status LED: blink = Wi-Fi up, solid = armed ----
  digitalWrite(PIN_LED, armed ? HIGH : ((now / 500) % 2 ? HIGH : LOW));

  if (now - lastTel >= TEL_MS) { lastTel = now; sendTelemetry(now); }
  if (now - lastClean >= 1000) { lastClean = now; ws.cleanupClients(); }
  delay(2);
}
