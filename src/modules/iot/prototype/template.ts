export const ESP32_NVS_REFERENCE_SNIPPET = `#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebServer.h>
#include <Update.h>
#include "mbedtls/sha256.h"

#define FIRMWARE_VERSION "1.0.0"

Preferences prefs;
WebServer portalServer(80);
bool portalActive = false;
String wifiSsid, wifiPass, deviceToken, ingestUrl;
unsigned long lastSendMs = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 5000;

void saveProvisionJson(const String& line) {
  // Expected: {"wifi_ssid":"...","wifi_pass":"...","device_token":"...","ingest_url":"..."}
  auto extractVal = [&](const char* key) -> String {
    String pattern = String("\\"") + key + "\\":\\"";
    int s = line.indexOf(pattern);
    if (s < 0) return "";
    s += pattern.length();
    int e = line.indexOf("\\"", s);
    return e > s ? line.substring(s, e) : "";
  };
  String ssid = extractVal("wifi_ssid");
  if (!ssid.length()) return;
  prefs.begin("iot_vault", false);
  prefs.putString("wifi_ssid", ssid);
  prefs.putString("wifi_pass", extractVal("wifi_pass"));
  String tok = extractVal("device_token");
  if (tok.length()) prefs.putString("device_token", tok);
  String url = extractVal("ingest_url");
  if (url.length()) prefs.putString("ingest_url", url);
  prefs.end();
  Serial.println("{\\"provisioned\\":true}");
  delay(200);
  ESP.restart();
}

void pollSerialProvisioning() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\\n');
    line.trim();
    if (line.startsWith("{") && line.indexOf("wifi_ssid") >= 0) {
      saveProvisionJson(line);
    }
  }
}

void startCaptivePortalFallback() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP("Sharara-Setup");
  portalServer.on("/", []() {
    portalServer.send(200, "text/html; charset=utf-8",
      "<form method='POST' action='/save'>SSID:<input name='s'><br>Pass:<input name='p' type='password'><br><button>Save</button></form>");
  });
  portalServer.on("/save", HTTP_POST, []() {
    prefs.begin("iot_vault", false);
    prefs.putString("wifi_ssid", portalServer.arg("s"));
    prefs.putString("wifi_pass", portalServer.arg("p"));
    prefs.end();
    portalServer.send(200, "text/plain", "Saved. Rebooting...");
    delay(300);
    ESP.restart();
  });
  portalServer.begin();
  portalActive = true;
}

void loadConfigFromNVS() {
  prefs.begin("iot_vault", true);
  wifiSsid = prefs.getString("wifi_ssid", "");
  wifiPass = prefs.getString("wifi_pass", "");
  deviceToken = prefs.getString("device_token", "");
  ingestUrl = prefs.getString("ingest_url", "");
  prefs.end();
}

// Track executed command IDs to acknowledge in next ingest-telemetry POST ("ack_commands":[...])
String pendingAckIds = "";
void handleServerCommands(const String& responseJson) {
  // Parse "commands":[{"id":"...","action":"...","value":...}] and apply GPIO/PWM, then queue id in pendingAckIds
  if (responseJson.indexOf("\\"commands\\":[{") >= 0) {
    Serial.println("[CMD] Received commands: " + responseJson);
  }
}

// Verify SHA-256 of streamed OTA binary before committing Update
bool verifyAndInstallOta(const String& otaUrl, const String& expectedSha256) {
  HTTPClient http;
  if (!http.begin(otaUrl)) return false;
  int code = http.GET();
  int len = http.getSize();
  if (code != HTTP_CODE_OK || len <= 0 || !Update.begin(len)) {
    http.end();
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0);

  uint8_t buf[1024];
  int remaining = len;
  while (http.connected() && remaining > 0) {
    size_t avail = stream->available();
    if (avail) {
      int n = stream->readBytes(buf, min((int)sizeof(buf), (int)avail));
      mbedtls_sha256_update(&ctx, buf, n);
      if (Update.write(buf, n) != (size_t)n) {
        Update.abort();
        mbedtls_sha256_free(&ctx);
        http.end();
        return false;
      }
      remaining -= n;
    } else {
      delay(10);
    }
  }

  uint8_t hash[32];
  mbedtls_sha256_finish(&ctx, hash);
  mbedtls_sha256_free(&ctx);
  http.end();

  String actualHex = "";
  for (int i = 0; i < 32; i++) {
    char hex[3];
    sprintf(hex, "%02x", hash[i]);
    actualHex += hex;
  }
  if (!actualHex.equalsIgnoreCase(expectedSha256)) {
    Update.abort();
    Serial.println("[OTA] SHA-256 mismatch! Aborting update.");
    return false;
  }
  if (Update.end(true)) {
    Serial.println("[OTA] Verified & installed. Rebooting...");
    ESP.restart();
    return true;
  }
  return false;
}
`;

export function hasHardcodedSecrets(code: string): boolean {
  const suspiciousPatterns = [
    /const\s+char\s*\*\s*(?:ssid|wifi_ssid|password|wifi_pass|token|api_key)\s*=\s*"[^"]{3,}"/i,
    /WiFi\.begin\s*\(\s*"[^"]+"\s*,\s*"[^"]+"\s*\)/i,
    /Bearer\s+[A-Za-z0-9._-]{12,}/,
  ];
  return suspiciousPatterns.some((re) => re.test(code));
}

export function sysPrototype(
  projectContext: string,
  revisionFeedback?: string
): string {
  const feedbackBlock = revisionFeedback
    ? `\n\n=== طلب تعديل المستخدم على النموذج ===\n${revisionFeedback}`
    : '';

  return `أنت مهندس أنظمة مدمجة خبير في ESP32. حوّل المشروع إلى نموذج أولي كامل بصيغة PrototypeV1 JSON فقط (بلا شرح أو markdown).

قواعد إلزامية:
1. اللوحة في الإصدار الأول ESP32 فقط (مثل "esp32:esp32:esp32"، و"ota": true).
2. ممنوع تماماً كتابة كلمة مرور Wi-Fi أو SSID أو رمز الجهاز (token) أو رابط ثابت كقيم سرية داخل الكود. يجب أن يقرأ الكود إعداداته ("wifi_ssid", "wifi_pass", "device_token", "ingest_url") من NVS عبر مكتبة <Preferences.h> (namespace "iot_vault")، ويدعم استقبال سطر JSON التهيئة عبر Serial وكذلك بوابة Captive Portal ("Sharara-Setup") عند خلو NVS.
3. إرسال القراءات عبر HTTP POST (مع ترويسة Authorization: Bearer <device_token> وتضمين "firmware_version": FIRMWARE_VERSION) كل 5000 مللي ثانية (5 ثوانٍ) بدون delay يعطّل الحلقة الرئيسية (استخدم millis())، وتنفيذ مصفوفة "commands" الراجعة مع إرسال "ack_commands": ["<id>"] في الطلب التالي لتأكيد التنفيذ، والتحقق من "firmware": {"version","url","sha256"} عند وجوده عبر verifyAndInstallOta(url, sha256) قبل تثبيت تحديث OTA.
4. تجنب أرجل الفلاش (GPIO6..11)، وتجنب أرجل الإدخال فقط (34, 35, 36, 39) للمخرجات أو الحساسات ثنائية الاتجاه مثل DHT22، ولا تكرر نفس الرجل.
5. أخرج JSON يطابق المخطط التالي حرفياً:
{
  "schema_version": 1,
  "board": { "fqbn": "esp32:esp32:esp32", "ota": true },
  "wiring": [{ "part": "", "part_pin": "", "mcu_pin": "GPIO4", "note": "" }],
  "firmware": {
    "files": [{ "name": "main.ino", "content": "..." }],
    "libraries": ["DHT sensor library", "ArduinoJson"]
  },
  "dashboard": [{ "type": "gauge|line_chart|status_badge|toggle_switch|slider", "key": "temp", "label": "الحرارة", "min": 0, "max": 50, "unit": "°C" }],
  "simulation": { "interval_ms": 1000, "frames": [{ "temp": 24.5 }] },
  "warnings": ["أي افتراض يحتاج مراجعة بشرية"]
}

مرجع NVS والتهيئة المطلوب اتباعه داخل main.ino:
${ESP32_NVS_REFERENCE_SNIPPET}

=== سياق المشروع ===
${projectContext}${feedbackBlock}`;
}
