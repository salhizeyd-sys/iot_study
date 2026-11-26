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

export function validateLibraryName(name) {
  const clean = String(name ?? '').trim();
  if (!clean) {
    throw new Error('اسم المكتبة مطلوب ولا يمكن أن يكون فارغاً');
  }
  if (clean.length > 120) {
    throw new Error('اسم المكتبة طويل جداً');
  }
  if (clean.startsWith('-') || /[\x00-\x1f\x7f]/.test(clean)) {
    throw new Error(`اسم مكتبة غير صالح: ${clean}`);
  }
  return clean;
}

export function parseInstalledLibrariesOutput(rawJsonText) {
  if (!rawJsonText || !String(rawJsonText).trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(String(rawJsonText));
  } catch {
    return [];
  }

  const rawList = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.installed_libraries)
      ? parsed.installed_libraries
      : Array.isArray(parsed?.libraries)
        ? parsed.libraries
        : [];

  return rawList
    .map((entry) => {
      const lib = entry?.library || entry || {};
      const name = String(lib?.name || '').trim();
      if (!name) return null;
      return {
        name,
        version: String(lib?.version || '').trim(),
        sentence: typeof lib?.sentence === 'string' ? lib.sentence : '',
      };
    })
    .filter(Boolean);
}

export function parseLibrarySearchOutput(rawJsonText, limit = 15) {
  if (!rawJsonText || !String(rawJsonText).trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(String(rawJsonText));
  } catch {
    return [];
  }

  const rawList = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.libraries)
      ? parsed.libraries
      : [];

  return rawList
    .map((entry) => {
      const name = String(entry?.name || '').trim();
      if (!name) return null;
      const latest = entry?.latest && typeof entry.latest === 'object' ? entry.latest : entry;
      return {
        name,
        version: String(latest?.version || entry?.version || '').trim(),
        author: typeof latest?.author === 'string' ? latest.author : '',
        sentence: typeof latest?.sentence === 'string' ? latest.sentence : '',
      };
    })
    .filter(Boolean)
    .slice(0, Math.max(1, limit));
}

export function findMissingLibraries(requiredLibraries, installedLibraries) {
  const installedSet = new Set(
    (Array.isArray(installedLibraries) ? installedLibraries : [])
      .map((l) => String(l?.name || l || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const seen = new Set();
  const missing = [];
  for (const raw of Array.isArray(requiredLibraries) ? requiredLibraries : []) {
    const clean = String(raw || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (installedSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    missing.push(clean);
  }
  return missing;
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
