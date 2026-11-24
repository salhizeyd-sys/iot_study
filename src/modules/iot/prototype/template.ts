export const ESP32_NVS_REFERENCE_SNIPPET = `#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>

Preferences prefs;
String wifiSsid, wifiPass, deviceToken, ingestUrl;
unsigned long lastSendMs = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 5000;

void loadConfigFromNVS() {
  prefs.begin("iot_vault", true);
  wifiSsid = prefs.getString("wifi_ssid", "");
  wifiPass = prefs.getString("wifi_pass", "");
  deviceToken = prefs.getString("device_token", "");
  ingestUrl = prefs.getString("ingest_url", "");
  prefs.end();
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
2. ممنوع تماماً كتابة كلمة مرور Wi-Fi أو SSID أو رمز الجهاز (token) أو رابط ثابت كقيم سرية داخل الكود. يجب أن يقرأ الكود إعداداته ("wifi_ssid", "wifi_pass", "device_token", "ingest_url") من NVS عبر مكتبة <Preferences.h> (namespace "iot_vault").
3. إرسال القراءات عبر HTTP POST كل 5000 مللي ثانية (5 ثوانٍ) بدون delay يعطّل الحلقة الرئيسية (استخدم millis()).
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

مرجع NVS المطلوب اتباعه داخل main.ino:
${ESP32_NVS_REFERENCE_SNIPPET}

=== سياق المشروع ===
${projectContext}${feedbackBlock}`;
}
