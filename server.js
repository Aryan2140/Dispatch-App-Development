/**
 * ============================================================================
 * AIMEX WAREHOUSE DISPATCH SERVER
 * ============================================================================
 * Runs on Windows (production, optimized with persistent Windows.Media.Ocr)
 * and macOS/Linux (testing, macOS Vision + offline Node Tesseract fallback).
 * All OCR runs on the host machine; temporary OCR images are deleted
 * immediately after processing finishes.
 * Includes Admin authentication and configurable daily product summary emails.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { URL } = require('url');
const labelParser = require('./public/ocr-parser.js');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const TIMEZONE = 'Australia/Sydney';

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const OCR_DIR = path.join(__dirname, 'ocr');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const DISPATCHES_FILE = path.join(DATA_DIR, 'dispatches.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const USER_PREFS_FILE = path.join(DATA_DIR, 'user-prefs.json');
const DEFAULT_PRODUCTS_FILE = path.join(__dirname, 'default-products.json');
const APPS_SCRIPT_FILE = path.join(__dirname, 'google-apps-script', 'Code.gs');

for (const dir of [PUBLIC_DIR, DATA_DIR, UPLOADS_DIR, OCR_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw || '')).digest('hex');
}

const DEFAULT_ADMIN_PASSWORD = 'aimexadmin';

const DEFAULT_QUICK_ACCESS = [
  { sku: 'AIM8STAGE', name: '8 Stage Filter X 1' },
  { sku: 'AIMAA1', name: 'AA Filter X 1' },
  { sku: 'AIMG128STAGE', name: 'G12 With 3 8 Stage Filter' },
  null,
  null,
  null
];

const DEFAULT_CONFIG = {
  googleScriptUrl: '',
  googleSheetUrl: '',
  ocrMode: 'auto', // 'auto' | 'host' | 'gemini'
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  adminPasswordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
  dailyEmail: {
    enabled: true,
    adminEmail: '',
    time: '15:00',
    lastSentDate: '',
    lastSentStatus: '',
    lastSentError: ''
  }
};

function loadDefaultProducts() {
  try {
    if (fs.existsSync(DEFAULT_PRODUCTS_FILE)) {
      return JSON.parse(fs.readFileSync(DEFAULT_PRODUCTS_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
      return JSON.parse(JSON.stringify(fallback));
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return JSON.parse(JSON.stringify(fallback));
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getConfig() {
  const cfg = readJsonFile(CONFIG_FILE, DEFAULT_CONFIG);
  let changed = false;
  if (!cfg.adminPasswordHash) {
    cfg.adminPasswordHash = hashPassword(DEFAULT_ADMIN_PASSWORD);
    changed = true;
  }
  if (!cfg.dailyEmail || typeof cfg.dailyEmail !== 'object') {
    cfg.dailyEmail = { ...DEFAULT_CONFIG.dailyEmail };
    changed = true;
  }
  if (changed) writeJsonFile(CONFIG_FILE, cfg);
  return cfg;
}

// Initialize local JSON stores
getConfig();
readJsonFile(DISPATCHES_FILE, []);
readJsonFile(PRODUCTS_FILE, loadDefaultProducts());
readJsonFile(USER_PREFS_FILE, {});

// In-memory Admin session tokens
const activeAdminTokens = new Set();

function requireAdmin(req, res) {
  const token = (req.headers['x-admin-token'] || '').trim();
  if (!token || !activeAdminTokens.has(token)) {
    sendJson(res, 401, { success: false, error: 'Admin authentication required.' });
    return false;
  }
  return true;
}

function getLocalNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const [name, netList] of Object.entries(interfaces)) {
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({
          interface: name,
          ip: net.address,
          url: `http://${net.address}:${PORT}`
        });
      }
    }
  }
  return addresses;
}

function fetchWithRedirects(targetUrl, options = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const lib = parsedUrl.protocol === 'https:' ? https : http;

    const headers = { ...(options.headers || {}) };
    if (
      parsedUrl.hostname.endsWith('script.google.com') &&
      headers['Content-Type'] === 'application/json'
    ) {
      headers['Content-Type'] = 'text/plain;charset=utf-8';
    }

    const reqOptions = {
      method: options.method || 'GET',
      headers,
      timeout: options.timeout || 45000
    };

    const req = lib.request(parsedUrl, reqOptions, (res) => {
      if (
        [301, 302, 303, 307, 308].includes(res.statusCode) &&
        res.headers.location &&
        maxRedirects > 0
      ) {
        const redirectUrl = new URL(res.headers.location, parsedUrl).toString();
        const nextMethod =
          res.statusCode === 302 || res.statusCode === 303 ? 'GET' : reqOptions.method;
        const nextHeaders = { ...reqOptions.headers };
        if (nextMethod === 'GET') {
          delete nextHeaders['Content-Type'];
          delete nextHeaders['Content-Length'];
        }
        res.resume();
        return resolve(
          fetchWithRedirects(
            redirectUrl,
            {
              method: nextMethod,
              headers: nextHeaders,
              body: nextMethod === 'GET' ? undefined : options.body,
              timeout: options.timeout
            },
            maxRedirects - 1
          )
        );
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(rawBody);
        } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          rawBody,
          json
        });
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

// ============================================================================
// DAILY PACKAGED PRODUCTS SUMMARY & SCHEDULER (Sydney Time)
// ============================================================================

function getSydneyDateAndTime(dateObj = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(dateObj);

  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    timeStr: `${hour}:${map.minute}`
  };
}

function buildDailySummary(dateStr) {
  const dispatches = readJsonFile(DISPATCHES_FILE, []);
  const productMap = new Map();
  const staffMap = new Map();
  const entries = [];
  let totalOrders = 0;
  let totalUnits = 0;

  for (const d of dispatches) {
    let loggedDate = '';
    let loggedTime = '';
    if (d.createdAtIso) {
      const syd = getSydneyDateAndTime(new Date(d.createdAtIso));
      loggedDate = syd.dateStr;
      loggedTime = syd.timeStr;
    } else if (d.timestamp) {
      const tm = String(d.timestamp).match(/\b(\d{2}:\d{2})/);
      if (tm) loggedTime = tm[1];
    }
    const orderDate = String(d.orderDate || '').slice(0, 10);
    if (loggedDate !== dateStr && orderDate !== dateStr) continue;

    totalOrders++;
    const staff = String(d.staffName || d.staffMember || 'Unknown').trim() || 'Unknown';
    if (!staffMap.has(staff)) {
      staffMap.set(staff, { staffName: staff, orders: 0, units: 0 });
    }
    const staffRec = staffMap.get(staff);
    staffRec.orders++;

    const prods = Array.isArray(d.products) ? d.products : [];
    for (const p of prods) {
      const qty = Math.max(0, Number(p.quantity) || 0);
      const sku = String(p.sku || '').trim();
      const name = String(p.name || '').trim();
      const location = String(p.location || '').trim();
      if (!name || !qty) continue;

      totalUnits += qty;
      staffRec.units += qty;

      entries.push({
        time: loggedTime || '-',
        sortKey: d.createdAtIso || `${orderDate}T${loggedTime || '00:00'}:00`,
        sku,
        name,
        quantity: qty,
        location: location || '-',
        staffName: staff,
        dispatchId: d.dispatchId || '',
        trackingNumber: d.trackingNumber || d.connote || ''
      });

      const key = `${sku.toLowerCase()}::${name.toLowerCase()}`;
      if (!productMap.has(key)) {
        productMap.set(key, { sku, name, quantity: 0, locations: new Set() });
      }
      const agg = productMap.get(key);
      agg.quantity += qty;
      if (location) agg.locations.add(location);
    }
  }

  entries.sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
  const cleanEntries = entries.map(({ sortKey, ...rest }) => rest);

  const products = Array.from(productMap.values())
    .map((p) => ({
      sku: p.sku,
      name: p.name,
      quantity: p.quantity,
      location: Array.from(p.locations).join(', ') || '-'
    }))
    .sort((a, b) => b.quantity - a.quantity);
  const byStaff = Array.from(staffMap.values()).sort((a, b) => b.units - a.units);

  return {
    date: dateStr,
    totalOrders,
    totalUnits,
    entries: cleanEntries,
    products,
    byStaff
  };
}

async function sendDailySummaryEmail(dateStr) {
  const config = getConfig();
  const adminEmail = String(config.dailyEmail?.adminEmail || '').trim();
  if (!adminEmail) {
    throw new Error('Administrator email is not configured.');
  }
  if (!config.googleScriptUrl) {
    throw new Error('Google Sheet Web App URL is not connected (used to send emails).');
  }

  const summary = buildDailySummary(dateStr);
  const payload = JSON.stringify({
    action: 'sendDailySummary',
    adminEmail,
    date: dateStr,
    summary
  });

  const gsRes = await fetchWithRedirects(config.googleScriptUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    body: payload,
    timeout: 30000
  });

  if (!gsRes.json || !gsRes.json.success) {
    const errMsg = gsRes.json?.error || `Apps Script returned status ${gsRes.statusCode}`;
    config.dailyEmail.lastSentStatus = 'error';
    config.dailyEmail.lastSentError = errMsg;
    writeJsonFile(CONFIG_FILE, config);
    throw new Error(errMsg);
  }

  config.dailyEmail.lastSentDate = dateStr;
  config.dailyEmail.lastSentStatus = `Sent at ${getSydneyDateAndTime().timeStr} (${summary.totalUnits} units)`;
  config.dailyEmail.lastSentError = '';
  writeJsonFile(CONFIG_FILE, config);

  return {
    success: true,
    sentTo: adminEmail,
    summary
  };
}

let dailyCheckInProgress = false;
function startDailyEmailScheduler() {
  setInterval(async () => {
    if (dailyCheckInProgress) return;
    dailyCheckInProgress = true;
    try {
      const config = getConfig();
      const de = config.dailyEmail || {};
      if (!de.enabled || !de.adminEmail || !config.googleScriptUrl) return;

      const { dateStr, timeStr } = getSydneyDateAndTime();
      const targetTime = /^\d{2}:\d{2}$/.test(de.time || '') ? de.time : '15:00';

      if (de.lastSentDate === dateStr) return;
      if (timeStr >= targetTime) {
        console.log(`[Scheduler] Sending daily dispatch summary for ${dateStr} to ${de.adminEmail}...`);
        await sendDailySummaryEmail(dateStr);
        console.log(`[Scheduler] Daily summary sent successfully.`);
      }
    } catch (err) {
      console.error('[Scheduler] Daily summary error:', err.message);
    } finally {
      dailyCheckInProgress = false;
    }
  }, 30000);
}

// ============================================================================
// HOST-SIDE OCR ENGINES (Windows WinRT -> macOS Vision -> Host Tesseract)
// ============================================================================

let winOcrProc = null;
let winOcrQueue = Promise.resolve();

function ensureWindowsOcrProcess() {
  if (winOcrProc && !winOcrProc.killed && winOcrProc.exitCode === null) {
    return winOcrProc;
  }
  const psScriptPath = path.join(OCR_DIR, 'win-ocr.ps1');
  if (!fs.existsSync(psScriptPath)) return null;

  winOcrProc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psScriptPath],
    { stdio: ['pipe', 'pipe', 'ignore'] }
  );
  winOcrProc.on('exit', () => {
    winOcrProc = null;
  });
  winOcrProc.on('error', () => {
    winOcrProc = null;
  });
  return winOcrProc;
}

function runWindowsOcrOnFile(imgPath) {
  if (process.platform !== 'win32') return Promise.resolve(null);

  const task = winOcrQueue.then(
    () =>
      new Promise((resolve) => {
        const proc = ensureWindowsOcrProcess();
        if (!proc) return resolve(null);

        let buffer = '';
        let settled = false;

        const timer = setTimeout(() => {
          cleanup();
          try { proc.kill(); } catch (e) {}
          winOcrProc = null;
          resolve(null);
        }, 10000);

        function onData(chunk) {
          buffer += chunk.toString('utf8');
          const markerIdx = buffer.indexOf('<<AIMEX_OCR_DONE>>');
          if (markerIdx !== -1) {
            const output = buffer.slice(0, markerIdx).replace(/\r/g, '').trim();
            cleanup();
            if (!output || output.includes('<<AIMEX_OCR_ERR>>')) {
              resolve(null);
            } else {
              resolve(output);
            }
          }
        }

        function onExit() {
          cleanup();
          resolve(null);
        }

        function cleanup() {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          proc.stdout.off('data', onData);
          proc.off('exit', onExit);
        }

        proc.stdout.on('data', onData);
        proc.once('exit', onExit);

        try {
          proc.stdin.write(imgPath + '\n');
        } catch (err) {
          cleanup();
          resolve(null);
        }
      })
  );

  winOcrQueue = task.catch(() => {});
  return task;
}

function runMacOcrOnFile(imgPath) {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  const binPath = path.join(OCR_DIR, 'mac-ocr');
  if (!fs.existsSync(binPath)) return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile(binPath, [imgPath], { timeout: 12000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) {
        return resolve(null);
      }
      resolve(stdout.trim());
    });
  });
}

let hostTesseractWorkerPromise = null;
let tesseractQueue = Promise.resolve();

function getHostTesseractWorker() {
  if (hostTesseractWorkerPromise) return hostTesseractWorkerPromise;

  hostTesseractWorkerPromise = (async () => {
    try {
      const { createWorker } = require('tesseract.js');
      const hasLocalData = fs.existsSync(path.join(OCR_DIR, 'eng.traineddata'));
      const workerOpts = {
        cachePath: OCR_DIR,
        ...(hasLocalData ? { langPath: OCR_DIR, gzip: false } : {})
      };
      const worker = await createWorker('eng', 1, workerOpts);
      await worker.setParameters({
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1'
      });
      return worker;
    } catch (err) {
      console.warn('Host Tesseract init warning:', err.message);
      hostTesseractWorkerPromise = null;
      return null;
    }
  })();

  return hostTesseractWorkerPromise;
}

function runHostTesseractOnFile(imgPath) {
  const task = tesseractQueue.then(async () => {
    const worker = await getHostTesseractWorker();
    if (!worker) return null;
    try {
      const { data } = await worker.recognize(imgPath);
      const text = (data?.text || '').trim();
      if (!text) return null;
      return {
        text,
        confidence: typeof data?.confidence === 'number' ? data.confidence : 80
      };
    } catch (err) {
      console.warn('Host Tesseract recognize error:', err.message);
      return null;
    }
  });
  tesseractQueue = task.catch(() => {});
  return task;
}

async function extractLabelWithGemini(imageBase64, apiKey, modelName = 'gemini-2.5-flash') {
  let mimeType = 'image/jpeg';
  let cleanBase64 = imageBase64;
  if (imageBase64.includes('base64,')) {
    const parts = imageBase64.split('base64,');
    const mimeMatch = parts[0].match(/data:(.*?);/);
    if (mimeMatch && mimeMatch[1]) mimeType = mimeMatch[1];
    cleanBase64 = parts[1];
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const prompt = `Extract shipping label details for Aimex Australia Pty Ltd.
IMPORTANT: Do NOT extract the sender ("From: Aimex Australia Pty Ltd") as the customerName. Always extract the "To:" recipient.
Return a JSON object with these exact keys:
- "customerName": string (recipient full name or company name after "To:" / "Deliver To:")
- "trackingNumber": string (the Connote / Tracking number / Consignment number, e.g. "CPCTOZE0000179" — prefer the Connote at top over item barcode if both exist)
- "orderDate": string (YYYY-MM-DD if an order or dispatch date is printed on the label, otherwise "")`;

  const payload = JSON.stringify({
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: cleanBase64 } }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  });

  const response = await fetchWithRedirects(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    body: payload,
    timeout: 30000
  });

  if (response.statusCode !== 200 || !response.json) {
    const errMsg = response.json?.error?.message || response.rawBody || `HTTP ${response.statusCode}`;
    throw new Error(`Gemini API error: ${errMsg}`);
  }

  const candidateText = response.json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const parsed = JSON.parse(candidateText);
  return {
    customerName: String(parsed.customerName || '').trim(),
    trackingNumber: String(parsed.trackingNumber || '').trim(),
    orderDate: String(parsed.orderDate || '').trim()
  };
}

/**
 * Runs Host-Side OCR on a base64 JPEG image.
 * Writes temp image ONLY for the duration of OCR processing and deletes it immediately after.
 */
async function processImageOcrOnHost(imageBase64, config) {
  const useGemini =
    config.ocrMode === 'gemini' ||
    (config.ocrMode === 'auto' && Boolean(config.geminiApiKey));

  if (useGemini && config.geminiApiKey) {
    try {
      const gRes = await extractLabelWithGemini(
        imageBase64,
        config.geminiApiKey,
        config.geminiModel || 'gemini-2.5-flash'
      );
      return {
        engine: 'gemini',
        extracted: {
          ...gRes,
          customerNameCertainty: gRes.customerName ? 96 : 0,
          trackingNumberCertainty: gRes.trackingNumber ? 96 : 0
        },
        rawText: ''
      };
    } catch (err) {
      console.warn('Gemini OCR error, falling back to host OCR:', err.message);
    }
  }

  let cleanBase64 = imageBase64;
  if (cleanBase64.includes('base64,')) {
    cleanBase64 = cleanBase64.split('base64,')[1];
  }

  const tmpImgPath = path.join(
    os.tmpdir(),
    `aimex-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
  );

  try {
    fs.writeFileSync(tmpImgPath, Buffer.from(cleanBase64, 'base64'));

    let rawText = null;
    let engine = '';

    if (process.platform === 'win32') {
      rawText = await runWindowsOcrOnFile(tmpImgPath);
      if (rawText) engine = 'windows-ocr';
    } else if (process.platform === 'darwin') {
      rawText = await runMacOcrOnFile(tmpImgPath);
      if (rawText) engine = 'macos-vision';
    }

    let extracted = rawText ? labelParser.parseTrackingSlipText(rawText, 90) : null;
    const needsFallback =
      !rawText ||
      !extracted.customerName ||
      !extracted.trackingNumber ||
      (extracted.customerNameCertainty || 0) < 78 ||
      (extracted.trackingNumberCertainty || 0) < 78;

    if (needsFallback) {
      const tessRes = await runHostTesseractOnFile(tmpImgPath);
      if (tessRes && tessRes.text) {
        const tessExtracted = labelParser.parseTrackingSlipText(tessRes.text, tessRes.confidence);
        if (!extracted) {
          extracted = tessExtracted;
          rawText = tessRes.text;
          engine = 'host-tesseract';
        } else {
          const pickTessName =
            (!extracted.customerName && Boolean(tessExtracted.customerName)) ||
            ((tessExtracted.customerNameCertainty || 0) > (extracted.customerNameCertainty || 0));
          const pickTessTrack =
            (!extracted.trackingNumber && Boolean(tessExtracted.trackingNumber)) ||
            ((tessExtracted.trackingNumberCertainty || 0) > (extracted.trackingNumberCertainty || 0));

          extracted = {
            customerName: pickTessName ? tessExtracted.customerName : extracted.customerName,
            customerNameCertainty: pickTessName
              ? tessExtracted.customerNameCertainty
              : extracted.customerNameCertainty,
            trackingNumber: pickTessTrack ? tessExtracted.trackingNumber : extracted.trackingNumber,
            trackingNumberCertainty: pickTessTrack
              ? tessExtracted.trackingNumberCertainty
              : extracted.trackingNumberCertainty,
            orderDate: extracted.orderDate || tessExtracted.orderDate
          };
          engine = `${engine}+tesseract`;
        }
      }
    }

    return {
      engine: engine || 'host-ocr',
      extracted: extracted || {
        customerName: '',
        customerNameCertainty: 0,
        trackingNumber: '',
        trackingNumberCertainty: 0,
        orderDate: ''
      },
      rawText: rawText || ''
    };
  } finally {
    try {
      if (fs.existsSync(tmpImgPath)) {
        fs.unlinkSync(tmpImgPath);
      }
    } catch (delErr) {
      console.error('Failed to delete temporary OCR file:', delErr.message);
    }
  }
}

// ============================================================================
// DISPATCH STORAGE & HELPERS
// ============================================================================

function saveImageLocally(dispatchId, base64DataUrl, filename) {
  if (!base64DataUrl) return null;
  try {
    const folder = path.join(UPLOADS_DIR, dispatchId);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    let cleanBase64 = base64DataUrl;
    if (base64DataUrl.includes('base64,')) {
      cleanBase64 = base64DataUrl.split('base64,')[1];
    }
    const filePath = path.join(folder, filename);
    fs.writeFileSync(filePath, Buffer.from(cleanBase64, 'base64'));
    return `/uploads/${dispatchId}/${filename}`;
  } catch (err) {
    console.error('Failed to save local image:', err.message);
    return null;
  }
}

function readLocalImageAsBase64(relativeUrl) {
  if (!relativeUrl || !relativeUrl.startsWith('/uploads/')) return null;
  try {
    const relPath = relativeUrl.replace(/^\/uploads\//, '');
    const fullPath = path.join(UPLOADS_DIR, relPath);
    if (!fs.existsSync(fullPath)) return null;
    const buf = fs.readFileSync(fullPath);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    return null;
  }
}

function generateDispatchId(existingDispatches) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = `DSP-${yyyy}${mm}${dd}-`;

  let maxSeq = 0;
  for (const d of existingDispatches) {
    if (d.dispatchId && d.dispatchId.startsWith(prefix)) {
      const num = parseInt(d.dispatchId.slice(prefix.length), 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    }
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
}

function parseJsonBody(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large (max 50MB)'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

async function handleRequest(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  try {
    // 1. Network & Public Status Info
    if (pathname === '/api/network-info' && req.method === 'GET') {
      const config = getConfig();
      const dispatches = readJsonFile(DISPATCHES_FILE, []);
      return sendJson(res, 200, {
        success: true,
        hostname: os.hostname(),
        platform: process.platform,
        port: PORT,
        addresses: getLocalNetworkAddresses(),
        googleConnected: Boolean(config.googleScriptUrl),
        googleSheetUrl: config.googleSheetUrl || '',
        geminiConfigured: Boolean(config.geminiApiKey),
        ocrMode: config.ocrMode || 'auto',
        totalLocalDispatches: dispatches.length,
        pendingSyncCount: dispatches.filter((d) => d.syncStatus !== 'synced').length
      });
    }

    // Public non-sensitive config
    if (pathname === '/api/config' && req.method === 'GET') {
      const config = getConfig();
      return sendJson(res, 200, {
        success: true,
        config: {
          googleConnected: Boolean(config.googleScriptUrl),
          googleScriptUrl: config.googleScriptUrl || '',
          googleSheetUrl: config.googleSheetUrl || '',
          ocrMode: config.ocrMode || 'auto',
          hasGeminiApiKey: Boolean(config.geminiApiKey)
        }
      });
    }

    // 2. Admin Authentication & Protected Admin Routes
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const config = getConfig();
      const candidateHash = hashPassword(body.password || '');
      if (candidateHash !== config.adminPasswordHash) {
        return sendJson(res, 401, { success: false, error: 'Incorrect admin password.' });
      }
      const token = crypto.randomBytes(24).toString('hex');
      activeAdminTokens.add(token);
      return sendJson(res, 200, {
        success: true,
        token,
        isDefaultPassword: config.adminPasswordHash === hashPassword(DEFAULT_ADMIN_PASSWORD)
      });
    }

    if (pathname === '/api/admin/config' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const config = getConfig();
      return sendJson(res, 200, {
        success: true,
        config: {
          googleScriptUrl: config.googleScriptUrl || '',
          googleSheetUrl: config.googleSheetUrl || '',
          ocrMode: config.ocrMode || 'auto',
          geminiApiKeyMasked: config.geminiApiKey
            ? config.geminiApiKey.slice(0, 6) + '••••' + config.geminiApiKey.slice(-4)
            : '',
          hasGeminiApiKey: Boolean(config.geminiApiKey),
          dailyEmail: config.dailyEmail || DEFAULT_CONFIG.dailyEmail,
          isDefaultPassword: config.adminPasswordHash === hashPassword(DEFAULT_ADMIN_PASSWORD)
        }
      });
    }

    if (pathname === '/api/admin/config' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const body = await parseJsonBody(req);
      const current = getConfig();

      const updated = {
        ...current,
        googleScriptUrl: typeof body.googleScriptUrl === 'string' ? body.googleScriptUrl.trim() : current.googleScriptUrl,
        googleSheetUrl: typeof body.googleSheetUrl === 'string' ? body.googleSheetUrl.trim() : current.googleSheetUrl,
        ocrMode: body.ocrMode || current.ocrMode,
        geminiModel: body.geminiModel || current.geminiModel || 'gemini-2.5-flash',
        dailyEmail: {
          ...current.dailyEmail,
          ...(body.dailyEmail && typeof body.dailyEmail === 'object' ? {
            enabled: Boolean(body.dailyEmail.enabled),
            adminEmail: typeof body.dailyEmail.adminEmail === 'string'
              ? body.dailyEmail.adminEmail.trim()
              : current.dailyEmail.adminEmail,
            time: /^\d{2}:\d{2}$/.test(body.dailyEmail.time || '')
              ? body.dailyEmail.time
              : current.dailyEmail.time || '15:00'
          } : {})
        }
      };

      if (typeof body.geminiApiKey === 'string') {
        const trimmedKey = body.geminiApiKey.trim();
        if (trimmedKey === '__CLEAR__') {
          updated.geminiApiKey = '';
        } else if (trimmedKey && !trimmedKey.includes('••••')) {
          updated.geminiApiKey = trimmedKey;
        }
      }

      writeJsonFile(CONFIG_FILE, updated);
      return sendJson(res, 200, {
        success: true,
        config: {
          googleScriptUrl: updated.googleScriptUrl,
          googleSheetUrl: updated.googleSheetUrl,
          ocrMode: updated.ocrMode,
          hasGeminiApiKey: Boolean(updated.geminiApiKey),
          dailyEmail: updated.dailyEmail
        }
      });
    }

    if (pathname === '/api/admin/change-password' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const body = await parseJsonBody(req);
      const newPw = String(body.newPassword || '').trim();
      if (newPw.length < 4) {
        return sendJson(res, 400, { success: false, error: 'Password must be at least 4 characters.' });
      }
      const config = getConfig();
      config.adminPasswordHash = hashPassword(newPw);
      writeJsonFile(CONFIG_FILE, config);
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/admin/daily-summary' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const dateStr = parsedUrl.searchParams.get('date') || getSydneyDateAndTime().dateStr;
      return sendJson(res, 200, {
        success: true,
        summary: buildDailySummary(dateStr)
      });
    }

    if (pathname === '/api/admin/send-daily-summary' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const body = await parseJsonBody(req);
      const dateStr = String(body.date || getSydneyDateAndTime().dateStr).trim();
      try {
        const result = await sendDailySummaryEmail(dateStr);
        return sendJson(res, 200, result);
      } catch (err) {
        const config = getConfig();
        return sendJson(res, 500, {
          success: false,
          error: err.message || 'Failed to send summary email.',
          summary: buildDailySummary(dateStr),
          adminEmail: String(config.dailyEmail?.adminEmail || '').trim(),
          date: dateStr
        });
      }
    }

    if (pathname === '/api/apps-script-code' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const code = fs.existsSync(APPS_SCRIPT_FILE)
        ? fs.readFileSync(APPS_SCRIPT_FILE, 'utf8')
        : '';
      return sendJson(res, 200, { success: true, code });
    }

    // 3. Per-User Quick Access Grid Preferences
    if (pathname === '/api/user-prefs' && req.method === 'GET') {
      const rawUser = (parsedUrl.searchParams.get('user') || '').trim();
      const userKey = rawUser.toLowerCase();
      if (!userKey) {
        return sendJson(res, 200, { success: true, quickAccess: DEFAULT_QUICK_ACCESS });
      }
      const allPrefs = readJsonFile(USER_PREFS_FILE, {});
      if (!allPrefs[userKey] || !Array.isArray(allPrefs[userKey].quickAccess)) {
        allPrefs[userKey] = {
          displayName: rawUser,
          quickAccess: JSON.parse(JSON.stringify(DEFAULT_QUICK_ACCESS))
        };
        writeJsonFile(USER_PREFS_FILE, allPrefs);
      }
      const slots = allPrefs[userKey].quickAccess.slice(0, 6);
      while (slots.length < 6) slots.push(null);
      return sendJson(res, 200, { success: true, quickAccess: slots });
    }

    if (pathname === '/api/user-prefs' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const rawUser = String(body.user || '').trim();
      const userKey = rawUser.toLowerCase();
      if (!userKey) {
        return sendJson(res, 400, { success: false, error: 'User name is required.' });
      }
      const incoming = Array.isArray(body.quickAccess) ? body.quickAccess.slice(0, 6) : [];
      const sanitized = [];
      for (let i = 0; i < 6; i++) {
        const slot = incoming[i];
        if (slot && slot.name) {
          sanitized.push({
            sku: String(slot.sku || '').trim(),
            name: String(slot.name).trim()
          });
        } else {
          sanitized.push(null);
        }
      }
      const allPrefs = readJsonFile(USER_PREFS_FILE, {});
      allPrefs[userKey] = {
        displayName: rawUser,
        quickAccess: sanitized
      };
      writeJsonFile(USER_PREFS_FILE, allPrefs);
      return sendJson(res, 200, { success: true, quickAccess: sanitized });
    }

    // 4. Unified Host-Side OCR Endpoint (Deletes temp image immediately after processing)
    if (pathname === '/api/ocr' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body.imageBase64) {
        return sendJson(res, 400, { success: false, error: 'Missing imageBase64' });
      }
      const config = getConfig();
      const result = await processImageOcrOnHost(body.imageBase64, config);
      return sendJson(res, 200, {
        success: true,
        engine: result.engine,
        extracted: result.extracted
      });
    }

    // 5. Google Sheet Test & Setup (Admin protected)
    if (pathname === '/api/google-sheet/test' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const body = await parseJsonBody(req);
      const config = getConfig();
      const scriptUrl = (body.googleScriptUrl || config.googleScriptUrl || '').trim();

      if (!scriptUrl) {
        return sendJson(res, 400, {
          success: false,
          error: 'Please enter a Google Apps Script Web App URL first.'
        });
      }

      const action = body.initSheet ? 'init' : 'ping';
      const targetUrl = `${scriptUrl}${scriptUrl.includes('?') ? '&' : '?'}action=${action}`;
      const gsRes = await fetchWithRedirects(targetUrl, { method: 'GET', timeout: 30000 });

      if (!gsRes.json || !gsRes.json.success) {
        return sendJson(res, 400, {
          success: false,
          error: gsRes.json?.error || 'Could not verify Google Apps Script response. Ensure "Who has access" is set to "Anyone".'
        });
      }

      if (Array.isArray(gsRes.json.products) && gsRes.json.products.length > 0) {
        writeJsonFile(PRODUCTS_FILE, gsRes.json.products);
      }

      if (gsRes.json.spreadsheetUrl) {
        config.googleScriptUrl = scriptUrl;
        config.googleSheetUrl = gsRes.json.spreadsheetUrl;
        writeJsonFile(CONFIG_FILE, config);
      }

      return sendJson(res, 200, { success: true, ...gsRes.json });
    }

    // 5b. Persist client-side Apps Script fallback results (when host DNS/network is restricted)
    if (pathname === '/api/google-sheet/client-sync' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const config = getConfig();
      let configChanged = false;

      if (body.googleScriptUrl && typeof body.googleScriptUrl === 'string') {
        config.googleScriptUrl = body.googleScriptUrl.trim();
        configChanged = true;
      }
      if (body.googleSheetUrl && typeof body.googleSheetUrl === 'string') {
        config.googleSheetUrl = body.googleSheetUrl.trim();
        configChanged = true;
      }
      if (Array.isArray(body.products) && body.products.length > 0) {
        writeJsonFile(PRODUCTS_FILE, body.products);
      }
      if (body.dailySummarySent && typeof body.dailySummarySent === 'object') {
        config.dailyEmail = {
          ...(config.dailyEmail || DEFAULT_CONFIG.dailyEmail),
          lastSentDate: String(body.dailySummarySent.date || ''),
          lastSentStatus: String(body.dailySummarySent.status || 'Sent'),
          lastSentError: ''
        };
        configChanged = true;
      }
      if (configChanged) {
        writeJsonFile(CONFIG_FILE, config);
      }

      let updatedDispatch = null;
      if (body.dispatchUpdate && body.dispatchUpdate.dispatchId) {
        const dispatches = readJsonFile(DISPATCHES_FILE, []);
        const idx = dispatches.findIndex((d) => d.dispatchId === body.dispatchUpdate.dispatchId);
        if (idx !== -1) {
          const rec = dispatches[idx];
          rec.syncStatus = 'synced';
          rec.syncError = null;
          rec.driveFolderUrl = body.dispatchUpdate.driveFolderUrl || rec.driveFolderUrl || '';
          rec.trackingSlipDriveUrl =
            body.dispatchUpdate.trackingSlipDriveUrl || rec.trackingSlipDriveUrl || '';
          rec.packagingDriveUrls =
            body.dispatchUpdate.packagingDriveUrls || rec.packagingDriveUrls || [];
          rec.sheetRowNumber = body.dispatchUpdate.sheetRowNumber || rec.sheetRowNumber || null;
          writeJsonFile(DISPATCHES_FILE, dispatches);
          updatedDispatch = rec;
        }
      }

      return sendJson(res, 200, {
        success: true,
        dispatch: updatedDispatch
      });
    }

    // 6. Products Catalog (GET / POST)
    if (pathname === '/api/products' && req.method === 'GET') {
      const shouldSync = parsedUrl.searchParams.get('sync') === 'true';
      const config = getConfig();
      let products = readJsonFile(PRODUCTS_FILE, loadDefaultProducts());
      let syncedFromGoogle = false;

      if (shouldSync && config.googleScriptUrl) {
        try {
          const targetUrl = `${config.googleScriptUrl}${config.googleScriptUrl.includes('?') ? '&' : '?'}action=products`;
          const gsRes = await fetchWithRedirects(targetUrl, { method: 'GET', timeout: 20000 });
          if (gsRes.json && gsRes.json.success && Array.isArray(gsRes.json.products) && gsRes.json.products.length > 0) {
            products = gsRes.json.products;
            writeJsonFile(PRODUCTS_FILE, products);
            syncedFromGoogle = true;
          }
        } catch (err) {
          console.warn('Products sync warning:', err.message);
        }
      }

      return sendJson(res, 200, {
        success: true,
        syncedFromGoogle,
        products
      });
    }

    if (pathname === '/api/products' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const name = String(body.name || '').trim();
      const sku = String(body.sku || '').trim() || `AIM-${Math.floor(100 + Math.random() * 900)}`;
      const category = String(body.category || 'General').trim();
      const unit = String(body.unit || 'Unit').trim();

      if (!name) {
        return sendJson(res, 400, { success: false, error: 'Product name is required.' });
      }

      const products = readJsonFile(PRODUCTS_FILE, loadDefaultProducts());
      const exists = products.some(
        (p) => p.name.toLowerCase() === name.toLowerCase() || (p.sku && p.sku.toLowerCase() === sku.toLowerCase())
      );

      if (!exists) {
        products.push({ sku, name, category, unit });
        writeJsonFile(PRODUCTS_FILE, products);
      }

      const config = getConfig();
      let pushedToGoogle = false;
      if (config.googleScriptUrl) {
        try {
          const payload = JSON.stringify({ action: 'addProduct', sku, name, category, unit });
          const gsRes = await fetchWithRedirects(config.googleScriptUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            },
            body: payload,
            timeout: 20000
          });
          if (gsRes.json && gsRes.json.success && Array.isArray(gsRes.json.products)) {
            writeJsonFile(PRODUCTS_FILE, gsRes.json.products);
            pushedToGoogle = true;
          }
        } catch (e) {}
      }

      return sendJson(res, 200, {
        success: true,
        pushedToGoogle,
        product: { sku, name, category, unit },
        products: readJsonFile(PRODUCTS_FILE, loadDefaultProducts())
      });
    }

    // 7. Dispatches (GET Search / Sync / POST Create / DELETE / CSV Export / Retry Sync)
    if (pathname === '/api/dispatches' && req.method === 'GET') {
      const q = (parsedUrl.searchParams.get('q') || '').toLowerCase().trim();
      const syncFilter = (parsedUrl.searchParams.get('syncStatus') || '').toLowerCase().trim();
      const shouldSync = parsedUrl.searchParams.get('sync') === 'true';

      let dispatches = readJsonFile(DISPATCHES_FILE, []);
      let syncedFromGoogle = false;

      if (shouldSync) {
        const config = getConfig();
        if (config.googleScriptUrl) {
          try {
            const targetUrl = `${config.googleScriptUrl}${config.googleScriptUrl.includes('?') ? '&' : '?'}action=search&limit=200`;
            const gsRes = await fetchWithRedirects(targetUrl, { method: 'GET', timeout: 25000 });
            if (gsRes.json && gsRes.json.success && Array.isArray(gsRes.json.dispatches)) {
              const localById = new Map(dispatches.map((d) => [d.dispatchId, d]));
              const merged = [];
              const seen = new Set();

              // Keep local pending_sync / local_only records at the top
              for (const local of dispatches) {
                if (local.syncStatus !== 'synced') {
                  merged.push(local);
                  seen.add(local.dispatchId);
                }
              }

              // Add/update synced records from Google Sheet
              for (const remote of gsRes.json.dispatches) {
                if (!remote || !remote.dispatchId || seen.has(remote.dispatchId)) continue;
                seen.add(remote.dispatchId);
                const existing = localById.get(remote.dispatchId);
                if (existing) {
                  merged.push({
                    ...existing,
                    syncStatus: 'synced',
                    syncError: null,
                    driveFolderUrl: remote.driveFolderUrl || existing.driveFolderUrl || ''
                  });
                } else {
                  merged.push({
                    dispatchId: remote.dispatchId,
                    timestamp: remote.timestamp || '',
                    createdAtIso: '',
                    orderDate: remote.orderDate || '',
                    trackingNumber: remote.trackingNumber || '',
                    customerName: remote.customerName || '',
                    staffName: remote.staffName || '',
                    products: Array.isArray(remote.products) ? remote.products : [],
                    totalQty: Number(remote.totalQty) || 0,
                    localTrackingSlipUrl: null,
                    localPackagingUrls: [],
                    syncStatus: 'synced',
                    syncError: null,
                    driveFolderUrl: remote.driveFolderUrl || ''
                  });
                }
              }

              dispatches = merged;
              writeJsonFile(DISPATCHES_FILE, dispatches);
              syncedFromGoogle = true;
            }
          } catch (err) {
            console.warn('Dispatches sync warning:', err.message);
          }
        }
      }

      const filtered = dispatches.filter((d) => {
        if (syncFilter && (d.syncStatus || '').toLowerCase() !== syncFilter) return false;
        if (!q) return true;
        const productNames = Array.isArray(d.products)
          ? d.products.map((p) => `${p.sku || ''} ${p.name || ''} ${p.location || ''}`).join(' ')
          : '';
        const haystack = [
          d.dispatchId,
          d.orderNumber,
          d.orderDate,
          d.timestamp,
          d.trackingNumber || d.connote,
          d.customerName,
          d.staffName || d.staffMember,
          productNames
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });

      return sendJson(res, 200, {
        success: true,
        syncedFromGoogle,
        total: dispatches.length,
        count: filtered.length,
        dispatches: filtered
      });
    }

    if (pathname === '/api/dispatches/export.csv' && req.method === 'GET') {
      const dispatches = readJsonFile(DISPATCHES_FILE, []);
      const csvHeaders = [
        'Dispatch ID',
        'Order Number',
        'Logged Timestamp',
        'Order Date',
        'Tracking Number',
        'Customer Name',
        'Products Packed',
        'Total Qty',
        'Staff Name',
        'Sync Status',
        'Google Drive Folder URL'
      ];

      const escapeCsv = (val) => {
        const s = String(val ?? '');
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };

      const rows = [csvHeaders.map(escapeCsv).join(',')];
      for (const d of dispatches) {
        const prodSummary = Array.isArray(d.products)
          ? d.products
              .map((p) => `${p.quantity}x ${p.sku ? '[' + p.sku + '] ' : ''}${p.name}${p.location ? ' (Loc: ' + p.location + ')' : ''}`)
              .join('; ')
          : '';
        rows.push(
          [
            d.dispatchId,
            d.orderNumber || '',
            d.timestamp,
            d.orderDate || '',
            d.trackingNumber || d.connote || '',
            d.customerName,
            prodSummary,
            d.totalQty || 0,
            d.staffName || d.staffMember || '',
            d.syncStatus,
            d.driveFolderUrl || ''
          ]
            .map(escapeCsv)
            .join(',')
        );
      }

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="aimex-dispatches-${new Date().toISOString().slice(0, 10)}.csv"`
      });
      return res.end(rows.join('\r\n'));
    }

    if (pathname === '/api/dispatches' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const dispatches = readJsonFile(DISPATCHES_FILE, []);
      const config = getConfig();

      const dispatchId = generateDispatchId(dispatches);
      const now = new Date();
      const timestamp = now.toLocaleString('en-AU', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });

      const products = Array.isArray(body.products)
        ? body.products
            .filter((p) => p && String(p.name || '').trim())
            .map((p) => ({
              sku: String(p.sku || '').trim(),
              name: String(p.name || '').trim(),
              quantity: Math.max(1, Number(p.quantity) || 1),
              location: String(p.location || '').trim()
            }))
        : [];

      const totalQty = products.reduce((sum, p) => sum + p.quantity, 0);

      const localTrackingSlipUrl = body.trackingSlipImage
        ? saveImageLocally(dispatchId, body.trackingSlipImage, 'tracking-slip.jpg')
        : null;

      const localPackagingUrls = [];
      if (Array.isArray(body.packagingImages)) {
        body.packagingImages.forEach((imgBase64, idx) => {
          const saved = saveImageLocally(dispatchId, imgBase64, `packaging-${idx + 1}.jpg`);
          if (saved) localPackagingUrls.push(saved);
        });
      }

      const orderNumber = String(body.orderNumber || '').trim();
      const trackingNumber = String(body.trackingNumber || body.connote || '').trim();
      const customerName = String(body.customerName || '').trim();
      const orderDate = String(body.orderDate || getSydneyDateAndTime(now).dateStr).trim();
      const staffName = String(body.staffName || body.staffMember || '').trim();

      const record = {
        dispatchId,
        orderNumber,
        timestamp,
        createdAtIso: now.toISOString(),
        orderDate,
        trackingNumber,
        customerName,
        staffName,
        products,
        totalQty,
        localTrackingSlipUrl,
        localPackagingUrls,
        syncStatus: 'local_only',
        syncError: null,
        driveFolderUrl: '',
        trackingSlipDriveUrl: '',
        packagingDriveUrls: [],
        sheetRowNumber: null
      };

      if (config.googleScriptUrl) {
        try {
          const gsPayload = JSON.stringify({
            action: 'createDispatch',
            dispatchId: record.dispatchId,
            orderNumber: record.orderNumber,
            orderDate: record.orderDate,
            trackingNumber: record.trackingNumber,
            customerName: record.customerName,
            staffName: record.staffName,
            products: record.products,
            trackingSlipImage: body.trackingSlipImage || null,
            packagingImages: Array.isArray(body.packagingImages) ? body.packagingImages : []
          });

          const gsRes = await fetchWithRedirects(config.googleScriptUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(gsPayload)
            },
            body: gsPayload,
            timeout: 45000
          });

          if (gsRes.json && gsRes.json.success) {
            record.syncStatus = 'synced';
            record.driveFolderUrl = gsRes.json.driveFolderUrl || '';
            record.trackingSlipDriveUrl = gsRes.json.trackingSlipUrl || '';
            record.packagingDriveUrls = gsRes.json.packagingImageUrls || [];
            record.sheetRowNumber = gsRes.json.rowNumber || null;
          } else {
            record.syncStatus = 'pending_sync';
            record.syncError = gsRes.json?.error || `Google Script returned status ${gsRes.statusCode}`;
          }
        } catch (err) {
          record.syncStatus = 'pending_sync';
          record.syncError = err.message;
        }
      }

      dispatches.unshift(record);
      writeJsonFile(DISPATCHES_FILE, dispatches);

      return sendJson(res, 200, {
        success: true,
        dispatch: record
      });
    }

    const deleteMatch = pathname.match(/^\/api\/dispatches\/([^/]+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      const targetId = decodeURIComponent(deleteMatch[1]);
      const dispatches = readJsonFile(DISPATCHES_FILE, []);
      const idx = dispatches.findIndex((d) => d.dispatchId === targetId);
      if (idx === -1) {
        return sendJson(res, 404, { success: false, error: 'Dispatch not found.' });
      }

      dispatches.splice(idx, 1);
      writeJsonFile(DISPATCHES_FILE, dispatches);

      // Clean up local uploaded photo folder if it exists
      try {
        const folder = path.join(UPLOADS_DIR, path.basename(targetId));
        if (fs.existsSync(folder)) {
          fs.rmSync(folder, { recursive: true, force: true });
        }
      } catch (e) {}

      const config = getConfig();
      let sheetDeleted = false;
      let sheetError = null;
      if (config.googleScriptUrl) {
        try {
          const gsPayload = JSON.stringify({ action: 'deleteDispatch', dispatchId: targetId });
          const gsRes = await fetchWithRedirects(config.googleScriptUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(gsPayload)
            },
            body: gsPayload,
            timeout: 25000
          });
          if (gsRes.json && gsRes.json.success) {
            sheetDeleted = true;
          } else {
            sheetError = gsRes.json?.error || `Sheet delete returned status ${gsRes.statusCode}`;
          }
        } catch (err) {
          sheetError = err.message;
        }
      }

      return sendJson(res, 200, {
        success: true,
        dispatchId: targetId,
        sheetDeleted,
        sheetError
      });
    }

    const syncMatch = pathname.match(/^\/api\/dispatches\/([^/]+)\/sync$/);
    if (syncMatch && req.method === 'POST') {
      const targetId = syncMatch[1];
      const config = getConfig();
      if (!config.googleScriptUrl) {
        return sendJson(res, 400, {
          success: false,
          error: 'Google Apps Script URL is not configured in Admin Settings.'
        });
      }

      const dispatches = readJsonFile(DISPATCHES_FILE, []);
      const idx = dispatches.findIndex((d) => d.dispatchId === targetId);
      if (idx === -1) {
        return sendJson(res, 404, { success: false, error: 'Dispatch not found.' });
      }

      const record = dispatches[idx];
      const trackingSlipImage = readLocalImageAsBase64(record.localTrackingSlipUrl);
      const packagingImages = (record.localPackagingUrls || [])
        .map((u) => readLocalImageAsBase64(u))
        .filter(Boolean);

      const gsPayload = JSON.stringify({
        action: 'createDispatch',
        dispatchId: record.dispatchId,
        orderNumber: record.orderNumber || '',
        orderDate: record.orderDate || '',
        trackingNumber: record.trackingNumber || record.connote || '',
        customerName: record.customerName || '',
        staffName: record.staffName || record.staffMember || '',
        products: record.products,
        trackingSlipImage,
        packagingImages
      });

      const gsRes = await fetchWithRedirects(config.googleScriptUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(gsPayload)
        },
        body: gsPayload,
        timeout: 45000
      });

      if (gsRes.json && gsRes.json.success) {
        record.syncStatus = 'synced';
        record.syncError = null;
        record.driveFolderUrl = gsRes.json.driveFolderUrl || '';
        record.trackingSlipDriveUrl = gsRes.json.trackingSlipUrl || '';
        record.packagingDriveUrls = gsRes.json.packagingImageUrls || [];
        record.sheetRowNumber = gsRes.json.rowNumber || null;
        writeJsonFile(DISPATCHES_FILE, dispatches);
        return sendJson(res, 200, { success: true, dispatch: record });
      } else {
        record.syncStatus = 'pending_sync';
        record.syncError = gsRes.json?.error || `Sync failed (${gsRes.statusCode})`;
        writeJsonFile(DISPATCHES_FILE, dispatches);
        return sendJson(res, 400, {
          success: false,
          error: record.syncError,
          dispatch: record
        });
      }
    }

    // 8. Local Uploaded Photos
    if (pathname.startsWith('/uploads/') && req.method === 'GET') {
      const relPath = pathname.replace(/^\/uploads\//, '');
      const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
      const fullPath = path.join(UPLOADS_DIR, safePath);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'image/jpeg' });
        return fs.createReadStream(fullPath).pipe(res);
      }
      res.writeHead(404);
      return res.end('Image not found');
    }

    // 9. Static Files
    let staticFile = pathname === '/' ? '/index.html' : pathname;
    const safeStatic = path.normalize(staticFile).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(PUBLIC_DIR, safeStatic);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexPath).pipe(res);
    }

    res.writeHead(404);
    res.end('Not Found');
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, {
      success: false,
      error: err.message || 'Internal Server Error'
    });
  }
}

const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  const addresses = getLocalNetworkAddresses();
  console.log('\n======================================================================');
  console.log('  AIMEX AUSTRALIA — WAREHOUSE DISPATCH SERVER');
  console.log('======================================================================');
  console.log(`  Local URL:          http://localhost:${PORT}`);
  if (addresses.length > 0) {
    addresses.forEach((a) => {
      console.log(`  Wi-Fi Network URL:  ${a.url}  (${a.interface})`);
    });
  }
  console.log('======================================================================\n');

  if (process.platform === 'win32') {
    ensureWindowsOcrProcess();
  }
  getHostTesseractWorker();
  startDailyEmailScheduler();
});
