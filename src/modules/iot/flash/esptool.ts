import { FlashBinaryPart } from './compiler';

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export async function flashEsp32WebSerial(options: {
  port: any;
  bins: FlashBinaryPart[];
  baudRate?: number;
  onLog: (line: string) => void;
  onProgress: (percent: number) => void;
}): Promise<string> {
  if (!options.bins.length) {
    throw new Error('لا توجد ملفات .bin للرفع');
  }

  const { Transport, ESPLoader } = await import('esptool-js');
  const transport = new Transport(options.port, true);

  const terminal = {
    clean: () => {},
    writeLine: (data: string) => options.onLog(data),
    write: (data: string) => options.onLog(data),
  };

  try {
    const loader = new ESPLoader({
      transport,
      baudrate: options.baudRate || 460800,
      romBaudrate: 115200,
      terminal,
    });

    const chip = await loader.main();
    options.onLog(`تم التعرف على الشريحة: ${chip}`);

    const fileArray = options.bins.map((b) => ({
      data: base64ToUint8Array(b.dataBase64),
      address: b.offset,
    }));

    const totalBytes = fileArray.reduce((sum, f) => sum + f.data.length, 0) || 1;
    const writtenPerFile = new Array<number>(fileArray.length).fill(0);

    await loader.writeFlash({
      fileArray,
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (fileIndex, written) => {
        writtenPerFile[fileIndex] = written;
        const sumWritten = writtenPerFile.reduce((a, b) => a + b, 0);
        const pct = Math.min(100, Math.round((sumWritten / totalBytes) * 100));
        options.onProgress(pct);
      },
    });

    options.onProgress(100);
    await loader.after('hard_reset');
    options.onLog('تم الرفع وإعادة تشغيل ESP32 بنجاح.');
    return chip;
  } finally {
    await transport.disconnect().catch(() => {});
  }
}
