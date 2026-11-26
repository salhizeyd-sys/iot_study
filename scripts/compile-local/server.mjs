import http from 'node:http';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  buildCorsHeaders,
  findMissingLibraries,
  mapBinArtifacts,
  parseInstalledLibrariesOutput,
  parseLibrarySearchOutput,
  resolveMainSketchName,
  sanitizeSketchFilename,
  validateEsp32Fqbn,
  validateLibraryName,
} from './lib.mjs';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const ARDUINO_CLI = process.env.ARDUINO_CLI_PATH || 'arduino-cli';
const LIB_CMD_TIMEOUT_MS = 60_000;

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...buildCorsHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > maxBytes) {
      const err = new Error('حجم الطلب أكبر من المسموح');
      err.statusCode = 413;
      throw err;
    }
  }
  return JSON.parse(raw || '{}');
}

async function listInstalledLibrariesCli() {
  const { stdout } = await execFileAsync(ARDUINO_CLI, ['lib', 'list', '--format', 'json'], {
    timeout: LIB_CMD_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseInstalledLibrariesOutput(stdout);
}

async function searchLibrariesCli(query) {
  const cleanQuery = validateLibraryName(query);
  const { stdout } = await execFileAsync(
    ARDUINO_CLI,
    ['lib', 'search', cleanQuery, '--format', 'json'],
    {
      timeout: LIB_CMD_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    }
  );
  return parseLibrarySearchOutput(stdout, 15);
}

async function installLibraryCli(name) {
  const cleanName = validateLibraryName(name);
  const { stdout, stderr } = await execFileAsync(
    ARDUINO_CLI,
    ['lib', 'install', cleanName],
    {
      timeout: LIB_CMD_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    }
  );
  return {
    ok: true,
    name: cleanName,
    logs: [stdout, stderr].filter(Boolean).join('\n'),
  };
}

async function checkArduinoCli() {
  try {
    const { stdout: verOut } = await execFileAsync(ARDUINO_CLI, ['version', '--format', 'json'], {
      timeout: 8000,
    });
    const versionInfo = JSON.parse(verOut);
    let esp32Core = false;
    try {
      const { stdout: coreOut } = await execFileAsync(ARDUINO_CLI, ['core', 'list', '--format', 'json'], {
        timeout: 8000,
      });
      const cores = JSON.parse(coreOut);
      const platforms = Array.isArray(cores?.platforms)
        ? cores.platforms
        : Array.isArray(cores)
          ? cores
          : [];
      esp32Core = platforms.some((p) => String(p?.id || '').startsWith('esp32:esp32'));
    } catch {
      esp32Core = false;
    }
    return { ok: true, arduinoCli: true, esp32Core, version: versionInfo?.VersionString || 'ok' };
  } catch (err) {
    return {
      ok: false,
      arduinoCli: false,
      esp32Core: false,
      error: err?.message || 'arduino-cli غير متوفر في PATH',
    };
  }
}

async function handleCompile(body) {
  const fqbn = validateEsp32Fqbn(body?.fqbn);
  const rawFiles = Array.isArray(body?.files) ? body.files : [];
  if (!rawFiles.length) {
    throw new Error('لا توجد ملفات برمجية للترجمة');
  }

  const sanitized = [];
  for (const f of rawFiles) {
    const safeName = sanitizeSketchFilename(f?.name);
    if (!safeName) {
      throw new Error(`اسم ملف غير مسموح: ${f?.name}`);
    }
    sanitized.push({ name: safeName, content: String(f?.content || '') });
  }

  // Auto-install any missing required libraries before compiling
  const requiredLibs = Array.isArray(body?.libraries)
    ? body.libraries.map((l) => String(l || '').trim()).filter(Boolean)
    : [];
  const installLogs = [];
  if (requiredLibs.length > 0) {
    const installed = await listInstalledLibrariesCli();
    const missing = findMissingLibraries(requiredLibs, installed);
    for (const libName of missing) {
      const res = await installLibraryCli(libName);
      installLogs.push(`[Auto-install] ${libName}\n${res.logs}`.trim());
    }
  }

  const sketchName = resolveMainSketchName(sanitized);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sharara-compile-'));
  const sketchDir = path.join(tmpRoot, sketchName);
  const outDir = path.join(tmpRoot, 'out');
  fs.mkdirSync(sketchDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  try {
    let mainInoWritten = false;
    for (const f of sanitized) {
      let targetName = f.name;
      if (!mainInoWritten && f.name.toLowerCase().endsWith('.ino')) {
        targetName = `${sketchName}.ino`;
        mainInoWritten = true;
      }
      fs.writeFileSync(path.join(sketchDir, targetName), f.content, 'utf8');
    }

    if (!mainInoWritten) {
      throw new Error('يجب أن يحتوي المشروع على ملف .ino واحد على الأقل');
    }

    const args = ['compile', '--fqbn', fqbn, '--output-dir', outDir, sketchDir];
    const { stdout, stderr } = await execFileAsync(ARDUINO_CLI, args, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const outFiles = fs
      .readdirSync(outDir)
      .map((name) => path.join(outDir, name));
    const bins = mapBinArtifacts(outFiles, (p) => fs.readFileSync(p));
    if (!bins.length) {
      throw new Error('نجحت الترجمة لكن لم يُعثر على ملفات .bin الناتجة');
    }

    return {
      ok: true,
      fqbn,
      bins,
      logs: [...installLogs, stdout, stderr].filter(Boolean).join('\n'),
    };
  } catch (err) {
    const detail = [...installLogs, err?.stderr, err?.stdout, err?.message]
      .filter(Boolean)
      .join('\n');
    const wrapped = new Error(detail || 'فشلت الترجمة المحلية');
    wrapped.logs = detail || wrapped.message;
    throw wrapped;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, buildCorsHeaders());
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = reqUrl.pathname;

  if (req.method === 'GET' && pathname === '/health') {
    const status = await checkArduinoCli();
    sendJson(res, status.ok ? 200 : 503, status);
    return;
  }

  if (req.method === 'GET' && pathname === '/libraries') {
    try {
      const libraries = await listInstalledLibrariesCli();
      sendJson(res, 200, { ok: true, libraries });
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: err?.stderr || err?.message || 'تعذّر قراءة قائمة المكتبات المثبتة',
      });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/libraries/search') {
    try {
      const q = reqUrl.searchParams.get('q') || '';
      const libraries = await searchLibrariesCli(q);
      sendJson(res, 200, { ok: true, libraries });
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        error: err?.stderr || err?.message || 'تعذّر البحث في مكتبات Arduino',
      });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/libraries/install') {
    try {
      const body = await readJsonBody(req, 64 * 1024);
      const result = await installLibraryCli(body?.name);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, err?.statusCode || 400, {
        ok: false,
        error: err?.stderr || err?.message || 'فشل تثبيت المكتبة',
      });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/compile') {
    try {
      const body = await readJsonBody(req, 2 * 1024 * 1024);
      const result = await handleCompile(body);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, err?.statusCode || 400, {
        ok: false,
        error: err?.message || 'خطأ في الترجمة',
        logs: err?.logs || err?.message || '',
      });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Sharara local compiler listening on http://${HOST}:${PORT}`);
});
