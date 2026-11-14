#include <WiFi.h>
#include <WebServer.h>

// =====================================
// PROJECT MARK 1 - FIRMWARE V1.0
// Phase 1: ESP32 Wi-Fi Communication Controller
// Commands are only printed to Serial - NO motors yet.
// Board: ESP32 Dev Module · Serial: 115200
// =====================================

// Wi-Fi Access Point credentials
const char* ssid = "MARK1_ROVER";
const char* password = "Mark1Rover26";

// HTTP server
WebServer server(80);

// Command tracking
String lastCommand = "NONE";
unsigned long lastCommandTime = 0;

// =====================================
// TABLET CONTROL PAGE
// =====================================

const char controlPage[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MARK 1 Rover</title>

<style>
body {
  margin: 0;
  background: #10141d;
  color: white;
  font-family: Arial, sans-serif;
  text-align: center;
  padding: 24px 12px;
}

h1 { letter-spacing: 3px; margin-bottom: 5px; }
.subtitle { color: #9ca3af; margin-bottom: 25px; }

.status {
  background: #202938;
  padding: 14px;
  border-radius: 12px;
  margin: 15px auto 25px;
  max-width: 350px;
}

.controls {
  display: grid;
  grid-template-columns: repeat(3, 90px);
  justify-content: center;
  gap: 12px;
  margin-top: 25px;
}

button {
  height: 75px;
  border: none;
  border-radius: 16px;
  font-size: 25px;
  color: white;
  background: #29364b;
  touch-action: none;
  cursor: pointer;
}

button:active { background: #2563eb; }

.stop {
  background: #dc2626;
  font-size: 16px;
  font-weight: bold;
}

.forward { grid-column: 2; }
.left { grid-column: 1; }
.stop { grid-column: 2; }
.right { grid-column: 3; }
.backward { grid-column: 2; }

.info {
  color: #9ca3af;
  margin-top: 35px;
  font-size: 13px;
}

#response {
  color: #60a5fa;
  margin-top: 18px;
}
</style>
</head>

<body>

<h1>MARK 1</h1>
<div class="subtitle">Wireless Rover Control System</div>

<div class="status">
  <div>CONNECTION: <span style="color:#4ade80">ONLINE</span></div>
  <div id="command">Last command: NONE</div>
</div>

<div class="controls">
  <button class="forward" onclick="sendCommand('forward')">▲</button>
  <button class="left" onclick="sendCommand('left')">◀</button>
  <button class="stop" onclick="sendCommand('stop')">STOP</button>
  <button class="right" onclick="sendCommand('right')">▶</button>
  <button class="backward" onclick="sendCommand('backward')">▼</button>
</div>

<div id="response">Waiting for commands...</div>

<div class="info">
  PROJECT MARK 1 · FIRMWARE V1.0<br>
  ESP32 Wireless Controller
</div>

<script>
async function sendCommand(command) {
  const display = document.getElementById('response');

  try {
    const response = await fetch('/api/cmd?move=' + command);
    const result = await response.json();

    document.getElementById('command').innerText =
      'Last command: ' + result.command.toUpperCase();

    display.innerText =
      'ESP32 acknowledged: ' + result.command.toUpperCase();

  } catch (error) {
    display.innerText = 'Communication error!';
  }
}
</script>

</body>
</html>
)rawliteral";

// =====================================
// JSON HELPER (CORS open so the RC-Rovers app / any browser can call the API)
// =====================================

void sendJson(int code, const String& body) {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-store");
  server.send(code, "application/json", body);
}

// =====================================
// COMMAND HANDLER
// =====================================

void handleCommand() {

  if (!server.hasArg("move")) {
    sendJson(400, "{\"error\":\"Missing command\"}");
    return;
  }

  String command = server.arg("move");
  command.toLowerCase();

  if (command != "forward" &&
      command != "backward" &&
      command != "left" &&
      command != "right" &&
      command != "stop") {

    sendJson(400, "{\"error\":\"Invalid command\"}");
    return;
  }

  lastCommand = command;
  lastCommandTime = millis();

  Serial.print("[MARK1] Received command: ");
  Serial.println(lastCommand);

  String response = "{\"ok\":true,\"command\":\"" + lastCommand + "\"}";
  sendJson(200, response);
}

// =====================================
// STATUS HANDLER
// =====================================

void handleStatus() {
  String response =
      "{\"device\":\"MARK1\",\"status\":\"online\","
      "\"lastCommand\":\"" + lastCommand + "\"}";

  sendJson(200, response);
}

// =====================================
// SETUP
// =====================================

void setup() {

  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("============================");
  Serial.println("   PROJECT MARK 1");
  Serial.println("   Firmware V1.0");
  Serial.println("============================");

  WiFi.mode(WIFI_AP);

  bool started = WiFi.softAP(ssid, password);

  if (started) {
    Serial.println("Wi-Fi hotspot started!");
    Serial.print("Network: ");
    Serial.println(ssid);
    Serial.print("Password: ");
    Serial.println(password);
    Serial.print("IP Address: ");
    Serial.println(WiFi.softAPIP());
  } else {
    Serial.println("Wi-Fi startup failed!");
    return;
  }

  server.on("/", HTTP_GET, []() {
    server.send_P(200, "text/html", controlPage);
  });

  server.on("/api/cmd", HTTP_GET, handleCommand);
  server.on("/api/status", HTTP_GET, handleStatus);

  server.begin();

  Serial.println("HTTP server started!");
  Serial.println("MARK 1 is ready.");
}

// =====================================
// MAIN LOOP
// =====================================

void loop() {
  server.handleClient();
}
