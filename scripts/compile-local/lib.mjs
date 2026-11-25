import path from 'node:path';

export const ALLOWED_EXTENSIONS = new Set(['.ino', '.h', '.hpp', '.cpp', '.c']);

export function sanitizeSketchFilename(name) {
  const base = path.basename(String(name || '').trim());
  if (!base || base === '.' || base === '..') return null;
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function resolveMainSketchName(files) {
  const ino = files.find((f) => f.name.toLowerCase().endsWith('.ino'));
  if (ino) {
    return path.basename(ino.name, path.extname(ino.name)) || 'sketch';
  }
  return 'sketch';
}

export function validateEsp32Fqbn(fqbn) {
  const clean = String(fqbn || 'esp32:esp32:esp32').trim();
  if (!/^esp32:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_=,-]+)?$/.test(clean)) {
    throw new Error(`FQBN غير مدعوم في الإصدار الأول (ESP32 فقط): ${clean}`);
  }
  return clean;
}

export function mapBinArtifacts(fileNames, readFileBuffer) {
  const bins = [];

  // Look for bootloader, partitions, and main application binary
  const bootloader = fileNames.find((n) => n.endsWith('.bootloader.bin'));
  const partitions = fileNames.find((n) => n.endsWith('.partitions.bin'));
  const appBin = fileNames.find(
    (n) =>
      n.endsWith('.bin') &&
      !n.endsWith('.bootloader.bin') &&
      !n.endsWith('.partitions.bin') &&
      !n.endsWith('.merged.bin')
  );
  const mergedBin = fileNames.find((n) => n.endsWith('.merged.bin'));

  if (bootloader && partitions && appBin) {
    bins.push({
      name: path.basename(bootloader),
      offset: 0x1000,
      dataBase64: readFileBuffer(bootloader).toString('base64'),
    });
    bins.push({
      name: path.basename(partitions),
      offset: 0x8000,
      dataBase64: readFileBuffer(partitions).toString('base64'),
    });
    bins.push({
      name: path.basename(appBin),
      offset: 0x10000,
      dataBase64: readFileBuffer(appBin).toString('base64'),
    });
  } else if (mergedBin) {
    bins.push({
      name: path.basename(mergedBin),
      offset: 0x0,
      dataBase64: readFileBuffer(mergedBin).toString('base64'),
    });
  } else if (appBin) {
    bins.push({
      name: path.basename(appBin),
      offset: 0x10000,
      dataBase64: readFileBuffer(appBin).toString('base64'),
    });
  }

  return bins;
}

export function buildCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
  };
}
