# Sharara Local Compiler (`arduino-cli`)

خادم محلي خفيف يغلّف `arduino-cli` لترجمة مشاريع ESP32 إلى ملفات `.bin` ورفعها من المتصفح عبر Web Serial.

## المتطلبات
1. تثبيت [arduino-cli](https://arduino.github.io/arduino-cli/latest/installation/) وإضافته إلى `PATH`.
2. تثبيت نواة ESP32:
   ```bash
   arduino-cli config init
   arduino-cli config add board_manager.additional_urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   arduino-cli core update-index
   arduino-cli core install esp32:esp32
   ```
3. تثبيت المكتبات التي يستخدمها مشروعك (مثل `DHT sensor library` و`ArduinoJson`):
   ```bash
   arduino-cli lib install "DHT sensor library" "ArduinoJson"
   ```

## التشغيل
```bash
npm run compile-local
```
يعمل الخادم افتراضياً على `http://127.0.0.1:8787` مع دعم CORS وPrivate Network Access للاتصال المباشر من تطبيق Sharara.
