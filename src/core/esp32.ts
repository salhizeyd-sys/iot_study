import { WiringItem } from './types';

export interface PinIssue {
  severity: 'error' | 'warning';
  code: 'duplicate' | 'boot_pin' | 'flash_pin' | 'input_only';
  pin: string;
  message: string;
}

export interface PinCheckResult {
  valid: boolean;
  issues: PinIssue[];
}

const POWER_OR_NON_GPIO = /^(3v3|3\.3v|5v|vin|vcc|gnd|en|rst|reset|nc)$/i;
const BOOT_STRAPPING_GPIOS = new Set([0, 2, 5, 12, 15]);
const SPI_FLASH_GPIOS = new Set([6, 7, 8, 9, 10, 11]);
const INPUT_ONLY_GPIOS = new Set([34, 35, 36, 39]);

const OUTPUT_OR_BIDIR_HINT =
  /\b(led|relay|buzzer|motor|servo|pwm|out|output|tx|mosi|sck|scl|sda|dht|data|trig|cs)\b|مرحل|ليد|مخرج|مروحة|طنان|محرك/i;

export function normalizeEsp32Gpio(pinName: string): number | null {
  const clean = pinName.trim();
  if (!clean || POWER_OR_NON_GPIO.test(clean)) return null;

  const upper = clean.toUpperCase();
  if (upper === 'VP' || upper === 'SENSOR_VP') return 36;
  if (upper === 'VN' || upper === 'SENSOR_VN') return 39;
  if (upper === 'TX0' || upper === 'TX') return 1;
  if (upper === 'RX0' || upper === 'RX') return 3;

  const match = upper.match(/^(?:GPIO|IO|D|PIN)?[\s_-]*(\d{1,2})$/);
  if (!match) return null;

  const num = Number(match[1]);
  return num >= 0 && num <= 39 ? num : null;
}

export function checkEsp32Pins(wiring: WiringItem[]): PinCheckResult {
  const issues: PinIssue[] = [];
  const pinUsers = new Map<number, WiringItem[]>();

  for (const item of wiring) {
    const gpio = normalizeEsp32Gpio(item.mcu_pin);
    if (gpio === null) continue;

    const list = pinUsers.get(gpio) || [];
    list.push(item);
    pinUsers.set(gpio, list);

    if (SPI_FLASH_GPIOS.has(gpio)) {
      issues.push({
        severity: 'error',
        code: 'flash_pin',
        pin: `GPIO${gpio}`,
        message: `الرجل GPIO${gpio} (${item.part}) محجوزة لذاكرة الفلاش الداخلية في ESP32 ولا يجوز استخدامها.`,
      });
    }

    if (BOOT_STRAPPING_GPIOS.has(gpio)) {
      issues.push({
        severity: 'warning',
        code: 'boot_pin',
        pin: `GPIO${gpio}`,
        message: `الرجل GPIO${gpio} (${item.part}) من أرجل الإقلاع (strapping pin)؛ تأكد ألا تؤثر الدائرة على حالة الإقلاع.`,
      });
    }

    if (INPUT_ONLY_GPIOS.has(gpio)) {
      const hintText = `${item.part} ${item.part_pin} ${item.note || ''}`;
      const needsOutput = OUTPUT_OR_BIDIR_HINT.test(hintText);
      issues.push({
        severity: needsOutput ? 'error' : 'warning',
        code: 'input_only',
        pin: `GPIO${gpio}`,
        message: needsOutput
          ? `الرجل GPIO${gpio} (${item.part}) إدخال فقط في ESP32 ولا تدعم الإخراج أو الإشارات ثنائية الاتجاه.`
          : `الرجل GPIO${gpio} (${item.part}) إدخال فقط بدون مقاومة سحب داخلية (pull-up/down).`,
      });
    }
  }

  for (const [gpio, items] of pinUsers.entries()) {
    if (items.length > 1) {
      const parts = items.map((x) => `${x.part} (${x.part_pin})`).join('، ');
      issues.push({
        severity: 'error',
        code: 'duplicate',
        pin: `GPIO${gpio}`,
        message: `تعارض تكرار على GPIO${gpio}: مستخدمة مع أكثر من طرف (${parts}).`,
      });
    }
  }

  return {
    valid: !issues.some((i) => i.severity === 'error'),
    issues,
  };
}
