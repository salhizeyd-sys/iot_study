export interface ProvisioningPayload {
  wifi_ssid: string;
  wifi_pass: string;
  device_token?: string;
  ingest_url?: string;
}

export function formatProvisioningLine(payload: ProvisioningPayload): string {
  const ssid = payload.wifi_ssid.trim();
  if (!ssid) {
    throw new Error('أدخل اسم شبكة الواي فاي (SSID) أولاً');
  }
  const clean: Record<string, string> = {
    wifi_ssid: ssid,
    wifi_pass: payload.wifi_pass || '',
  };
  if (payload.device_token?.trim()) {
    clean.device_token = payload.device_token.trim();
  }
  if (payload.ingest_url?.trim()) {
    clean.ingest_url = payload.ingest_url.trim();
  }
  return JSON.stringify(clean) + '\n';
}

export async function requestWebSerialPort(): Promise<any> {
  const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
  if (!nav?.serial) {
    throw new Error('المتصفح الحالي لا يدعم Web Serial (استخدم Chrome أو Edge على الحاسوب)');
  }
  return nav.serial.requestPort();
}

export async function sendProvisioningOverSerial(
  port: any,
  payload: ProvisioningPayload,
  onLog?: (msg: string) => void
): Promise<void> {
  const line = formatProvisioningLine(payload);
  await port.open({ baudRate: 115200 });

  let writer: any = null;
  let reader: any = null;
  try {
    const encoder = new TextEncoder();
    writer = port.writable.getWriter();
    await writer.write(encoder.encode(line));
    writer.releaseLock();
    writer = null;
    onLog?.('تم إرسال إعدادات Wi-Fi والرمز عبر USB إلى NVS.');

    // Read brief confirmation from ESP32 if available
    if (port.readable) {
      reader = port.readable.getReader();
      const decoder = new TextDecoder();
      const timeout = new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), 1200)
      );
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk?.value) {
        onLog?.(decoder.decode(chunk.value));
      }
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      reader = null;
    }
  } finally {
    try {
      writer?.releaseLock();
    } catch {
      // ignore
    }
    try {
      reader?.releaseLock();
    } catch {
      // ignore
    }
    await port.close().catch(() => {});
  }
}

export class SerialMonitorController {
  private port: any = null;
  private reader: any = null;
  private reading = false;

  isConnected(): boolean {
    return this.port !== null && this.reading;
  }

  async connect(
    port: any,
    baudRate: number = 115200,
    onData: (text: string) => void,
    onDisconnect?: () => void
  ): Promise<void> {
    if (this.reading) await this.disconnect();
    this.port = port;
    await port.open({ baudRate });
    this.reading = true;

    const decoder = new TextDecoder();
    void (async () => {
      try {
        while (this.reading && port.readable) {
          this.reader = port.readable.getReader();
          try {
            while (this.reading) {
              const { value, done } = await this.reader.read();
              if (done) break;
              if (value) onData(decoder.decode(value, { stream: true }));
            }
          } finally {
            try {
              this.reader.releaseLock();
            } catch {
              // ignore
            }
            this.reader = null;
          }
        }
      } catch {
        // port disconnected or read canceled
      } finally {
        this.reading = false;
        onDisconnect?.();
      }
    })();
  }

  async sendLine(line: string): Promise<void> {
    if (!this.port?.writable) {
      throw new Error('المنفذ غير متصل');
    }
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(line + '\n'));
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect(): Promise<void> {
    this.reading = false;
    try {
      await this.reader?.cancel();
    } catch {
      // ignore
    }
    try {
      await this.port?.close();
    } catch {
      // ignore
    }
    this.port = null;
  }
}
