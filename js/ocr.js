// =============================================================
// OCR ENGINE v2.7 — PART 1/3
// Config · AbortController · Worker · Cache
// =============================================================

import { state } from './state.js';
import { WEIGHT_KEYS } from './config.js';
import { getTodayIso, formatDateDisplay, generateId } from './utils.js';
import { openAddModal, openEditModal, switchModalSubTab, showToast } from './ui.js';
import { updateAllViews } from './render.js';
import { showAlert, showConfirm } from './dialog.js';

// ==================== CONFIG ====================
const OCR_CACHE_VERSION = 'v4';
const OCR_TIMEOUT_MS    = 30000;
const OCR_CACHE_MAX     = 200;
const LS_CACHE_PREFIX   = 'spx_ocr_cache_';
const LS_CACHE_INDEX    = 'spx_ocr_cache_index';
const LS_CACHE_MAX_BYTES = 4 * 1024 * 1024;

// Auto-save khi score >= 92
const SCORE_AUTO_SAVE = 92;
const SCORE_REVIEW    = 85;
const SCORE_MAX_CHECKSUM_FAIL = 84;

const RANGE_KEY_BY_MIN = {
  0: '0_2',   2: '2_4',    4: '4_6',    6: '6_8',
  8: '8_10',  10: '10_12', 12: '12_15', 15: 'over_15'
};

// ==================== ABORT CONTROLLER ====================
let _ocrAbortController = null;

export function cancelOcr() {
  if (_ocrAbortController) {
    _ocrAbortController.abort();
    _ocrAbortController = null;
    return true;
  }
  return false;
}

function _newAbortController() {
  _ocrAbortController = new AbortController();
  return _ocrAbortController;
}

function _checkAborted(signal) {
  if (signal && signal.aborted) {
    throw new Error('OCR_CANCELLED');
  }
}

function _clearAbortController(ctrl) {
  if (_ocrAbortController === ctrl) {
    _ocrAbortController = null;
  }
}

// ==================== TESSERACT WORKER ====================
let cachedTesseractWorker = null;
let workerLoadingPromise  = null;

async function getTesseractWorker() {
  if (cachedTesseractWorker) return cachedTesseractWorker;
  if (workerLoadingPromise)  return workerLoadingPromise;

  workerLoadingPromise = (async () => {
    const worker = await Tesseract.createWorker('vie', 1, {
      logger: m => {
        const overlay = document.getElementById('ocrLoadingOverlay');
        if (!overlay || overlay.style.display !== 'flex') return;
        const desc = document.getElementById('ocrStatusDesc');
        if (!desc) return;
        let text = '';
        if (m.status === 'loading tesseract core')            text = 'Đang tải engine...';
        else if (m.status === 'initializing tesseract')       text = 'Đang khởi tạo...';
        else if (m.status === 'loading language traineddata') text = `Đang tải tiếng Việt ${Math.round((m.progress||0)*100)}%...`;
        else if (m.status === 'initializing api')             text = 'Đang chuẩn bị API...';
        else if (m.status === 'recognizing text')             text = `Đang nhận diện... ${Math.round((m.progress||0)*100)}%`;
        if (text) desc.innerText = text;
      }
    });

    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
      tessedit_do_invert: '0'
    });

    cachedTesseractWorker = worker;
    return worker;
  })();

  try {
    return await workerLoadingPromise;
  } catch (e) {
    workerLoadingPromise = null;
    throw e;
  }
}

async function resetTesseractWorker() {
  if (cachedTesseractWorker) {
    try { await cachedTesseractWorker.terminate(); } catch {}
  }
  cachedTesseractWorker = null;
  workerLoadingPromise  = null;
}

export async function preloadTesseractWorker() {
  try {
    await getTesseractWorker();
    console.log('[OCR] Worker sẵn sàng');
  } catch (e) {
    console.warn('[OCR] Preload thất bại:', e);
  }
}

// ==================== TIMEOUT WRAPPER ====================
function withTimeout(promise, ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`OCR timeout sau ${ms / 1000}s`)),
      ms
    );
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('OCR_CANCELLED'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    promise.then(v => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(v);
    }).catch(e => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(e);
    });
  });
}

// ==================== OCR RECOGNIZE ====================
async function ocrRecognize(preprocessedDataUrl, signal) {
  _checkAborted(signal);

  try {
    const worker = await getTesseractWorker();
    _checkAborted(signal);
    const result = await withTimeout(
      worker.recognize(preprocessedDataUrl),
      OCR_TIMEOUT_MS,
      signal
    );
    return result.data.text || '';
  } catch (err) {
    if (err.message === 'OCR_CANCELLED') throw err;

    console.warn('[OCR] Attempt 1 fail → reset worker + retry:', err.message);
    await resetTesseractWorker();
    _checkAborted(signal);

    try {
      const worker = await getTesseractWorker();
      _checkAborted(signal);
      const result = await withTimeout(
        worker.recognize(preprocessedDataUrl),
        OCR_TIMEOUT_MS,
        signal
      );
      return result.data.text || '';
    } catch (err2) {
      if (err2.message === 'OCR_CANCELLED') throw err2;
      console.warn('[OCR] Attempt 2 fail:', err2.message);
      throw new Error('Không đọc được ảnh — ' + err2.message);
    }
  }
}

// ==================== HASH BLOB (SHA-256) ====================
async function hashBlob(file) {
  try {
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'fb_' + Date.now().toString(16) + '_' + file.size + '_' +
           (file.name || '').length + '_' + (file.lastModified || 0);
  }
}

// ==================== CACHE 2 TẦNG ====================
const ocrCache = new Map();

function _cacheKey(hash) {
  return `${OCR_CACHE_VERSION}_${hash}`;
}

function readCacheIndex() {
  try {
    const raw = localStorage.getItem(LS_CACHE_INDEX);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeCacheIndex(index) {
  try {
    localStorage.setItem(LS_CACHE_INDEX, JSON.stringify(index));
  } catch (e) {
    console.warn('[OCR Cache] Ghi index thất bại:', e.message);
  }
}

function estimateLocalStorageBytes() {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LS_CACHE_PREFIX)) continue;
      const val = localStorage.getItem(key);
      if (val) total += key.length + val.length;
    }
    return total * 2;
  } catch {
    return 0;
  }
}

function evictOldestCache() {
  const index = readCacheIndex();
  if (index.length === 0) return false;
  const oldest = index.shift();
  try { localStorage.removeItem(LS_CACHE_PREFIX + oldest); } catch {}
  writeCacheIndex(index);
  ocrCache.delete(oldest);
  return true;
}

function pruneCacheIfNeeded() {
  const index = readCacheIndex();
  const targetCount = Math.floor(OCR_CACHE_MAX * 0.8);
  let removedCount = 0;

  while (index.length > targetCount) {
    const oldest = index.shift();
    try { localStorage.removeItem(LS_CACHE_PREFIX + oldest); } catch {}
    ocrCache.delete(oldest);
    removedCount++;
  }
  if (removedCount > 0) writeCacheIndex(index);

  let bytes = estimateLocalStorageBytes();
  const targetBytes = LS_CACHE_MAX_BYTES * 0.5;
  let safety = 100;
  while (bytes > targetBytes && safety-- > 0) {
    if (!evictOldestCache()) break;
    bytes = estimateLocalStorageBytes();
  }
}

function cacheGet(hash) {
  const key = _cacheKey(hash);

  if (ocrCache.has(key)) {
    const v = ocrCache.get(key);
    const index = readCacheIndex();
    const idx = index.indexOf(key);
    if (idx !== -1) {
      index.splice(idx, 1);
      index.push(key);
      writeCacheIndex(index);
    }
    return v;
  }

  try {
    const raw = localStorage.getItem(LS_CACHE_PREFIX + key);
    if (raw) {
      const value = JSON.parse(raw);
      ocrCache.set(key, value);

      const index = readCacheIndex();
      const idx = index.indexOf(key);
      if (idx !== -1) {
        index.splice(idx, 1);
        index.push(key);
        writeCacheIndex(index);
      }
      return value;
    }
  } catch (e) {
    console.warn('[OCR Cache] Đọc localStorage lỗi:', e.message);
  }

  return null;
}

function cacheSet(hash, value) {
  const key = _cacheKey(hash);
  ocrCache.set(key, value);

  try {
    localStorage.setItem(LS_CACHE_PREFIX + key, JSON.stringify(value));
    const index = readCacheIndex();
    if (!index.includes(key)) {
      index.push(key);
      writeCacheIndex(index);
    }
    pruneCacheIfNeeded();
  } catch (e) {
    console.warn('[OCR Cache] Ghi localStorage lỗi:', e.message);
    try {
      pruneCacheIfNeeded();
      localStorage.setItem(LS_CACHE_PREFIX + key, JSON.stringify(value));
    } catch (e2) {
      console.warn('[OCR Cache] Vẫn không ghi được:', e2.message);
    }
  }
}

// ==================== XÓA CACHE OCR ====================
export async function clearOcrCache() {
  const ok = await showConfirm(
    'Xóa toàn bộ cache OCR?\n\n' +
    'Lần sau quét lại ảnh cũ sẽ phải OCR từ đầu (chậm hơn).\n' +
    'Dữ liệu sản lượng đã lưu vẫn giữ nguyên.',
    {
      title: '🗑️ Xóa cache OCR',
      okText: 'Xóa cache',
      cancelText: 'Hủy',
      danger: true
    }
  );
  if (!ok) return 0;

  let count = 0;
  ocrCache.clear();

  try {
    const index = readCacheIndex();
    count = index.length;
    index.forEach(key => {
      try { localStorage.removeItem(LS_CACHE_PREFIX + key); } catch {}
    });
    localStorage.removeItem(LS_CACHE_INDEX);
  } catch (e) {
    console.warn('[OCR Cache] Xóa lỗi:', e.message);
  }

  try {
    let actualCount = 0;
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LS_CACHE_PREFIX)) {
        toRemove.push(key);
        actualCount++;
      }
    }
    toRemove.forEach(k => { try { localStorage.removeItem(k); } catch {} });
    count = Math.max(count, actualCount);
  } catch {}

  showToast(`Đã xóa ${count} cache OCR`, 'success', 2500);
  return count;
}

// ==================== THỐNG KÊ CACHE ====================
export function getOcrCacheStats() {
  const index = readCacheIndex();
  const ramCount = ocrCache.size;
  const lsCount  = index.length;
  const bytes    = estimateLocalStorageBytes();
  return {
    ramEntries: ramCount,
    lsEntries:  lsCount,
    sizeKB:     Math.round(bytes / 1024),
    maxEntries: OCR_CACHE_MAX,
    maxSizeKB:  Math.round(LS_CACHE_MAX_BYTES / 1024)
  };
}
// =============================================================
// OCR ENGINE v2.7 — PART 2/3
// Image · Preprocess · Parser · Validation · Scoring
// =============================================================

// ==================== IMAGE HELPERS ====================
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không load được ảnh'));
    img.src = src;
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = () => reject(new Error('Không đọc được file'));
    r.readAsDataURL(file);
  });
}

function makeThumbnail(dataUrl, maxW = 96) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.floor(img.width * scale);
        canvas.height = Math.floor(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.65));
      } catch { resolve(''); }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

// ==================== DETECT ACTIVE TAB ====================
const TAB_MIN_CONFIDENCE = 60;

const FALLBACK_ZONES = [
  { type: 'del',  min: 0.00, max: 0.30 },
  { type: 'pick', min: 0.30, max: 0.50 },
  { type: 'ret',  min: 0.50, max: 1.00 }
];

function detectActiveTab(imageSource) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);

        const tabY1 = Math.floor(img.height * 0.09);
        const tabY2 = Math.floor(img.height * 0.145);
        const tabH  = Math.max(1, tabY2 - tabY1);

        const tabData = ctx.getImageData(0, tabY1, img.width, tabH).data;

        const darkCount = new Array(img.width).fill(0);
        for (let y = 0; y < tabH; y++) {
          for (let x = 0; x < img.width; x++) {
            const idx = (y * img.width + x) * 4;
            const r = tabData[idx], g = tabData[idx+1], b = tabData[idx+2];
            const gray = 0.299*r + 0.587*g + 0.114*b;
            if (gray < 120) darkCount[x]++;
          }
        }

        const MIN_DARK = 3;
        const clusters = [];
        let clusterStart = -1;
        for (let x = 0; x < img.width; x++) {
          if (darkCount[x] >= MIN_DARK) {
            if (clusterStart === -1) clusterStart = x;
          } else {
            if (clusterStart !== -1) {
              clusters.push({ start: clusterStart, end: x - 1 });
              clusterStart = -1;
            }
          }
        }
        if (clusterStart !== -1) {
          clusters.push({ start: clusterStart, end: img.width - 1 });
        }

        const merged = [];
        clusters.forEach(c => {
          if (merged.length > 0 && c.start - merged[merged.length-1].end < 20) {
            merged[merged.length-1].end = c.end;
          } else {
            merged.push({ start: c.start, end: c.end });
          }
        });

        const tabCandidates = merged.filter(c => (c.end - c.start) >= 30);

        const camY1 = Math.floor(img.height * 0.12);
        const camY2 = Math.floor(img.height * 0.18);
        const camH  = Math.max(1, camY2 - camY1);

        const camData = ctx.getImageData(0, camY1, img.width, camH).data;
        const colOrange = new Array(img.width).fill(0);
        let totalOrange = 0;
        for (let y = 0; y < camH; y++) {
          for (let x = 0; x < img.width; x++) {
            const idx = (y * img.width + x) * 4;
            const r = camData[idx], g = camData[idx+1], b = camData[idx+2];
            if (r > 180 && g >= 40 && g <= 155 && b <= 90 && (r - g) > 45) {
              colOrange[x]++;
              totalOrange++;
            }
          }
        }

        console.log('[OCR Tab]', {
          imgW: img.width, imgH: img.height,
          tabYRange: [tabY1, tabY2],
          camYRange: [camY1, camY2],
          tabClusters: tabCandidates.length,
          clusterWidths: tabCandidates.map(c => c.end - c.start),
          totalOrange,
          orangeColsFound: colOrange.filter(v => v > 0).length
        });

        if (totalOrange < 30) {
          console.warn('[OCR Tab] totalOrange quá thấp → fail');
          resolve(null);
          return;
        }

        const winSize = 40;
        let maxSum = 0, bestCenter = 0;
        for (let x = 0; x < img.width; x++) {
          let sum = 0;
          const l = Math.max(0, x - winSize);
          const r = Math.min(img.width - 1, x + winSize);
          for (let k = l; k <= r; k++) sum += colOrange[k];
          if (sum > maxSum) { maxSum = sum; bestCenter = x; }
        }

        if (tabCandidates.length >= 3) {
          const sorted = [...tabCandidates]
            .sort((a, b) => (b.end - b.start) - (a.end - a.start))
            .slice(0, 3)
            .sort((a, b) => a.start - b.start);

          const TAB_ORDER = ['del', 'pick', 'ret'];

          let bestIdx = -1;
          let bestDist = Infinity;
          let secondDist = Infinity;

          sorted.forEach((c, i) => {
            const center = (c.start + c.end) / 2;
            const dist = Math.abs(bestCenter - center);
            if (dist < bestDist) {
              secondDist = bestDist;
              bestDist = dist;
              bestIdx = i;
            } else if (dist < secondDist) {
              secondDist = dist;
            }
          });

          if (bestIdx >= 0) {
            const width = img.width;
            const relativeDist = bestDist / width;
            const separation   = (secondDist - bestDist) / width;

            let conf = 100;
            conf -= Math.min(40, relativeDist * 300);
            conf -= Math.max(0, 30 - separation * 500);
            const confidence = Math.max(0, Math.min(100, Math.round(conf)));

            console.log('[OCR Tab] match:', {
              bestIdx, bestCenter,
              tabCenters: sorted.map(c => Math.round((c.start + c.end) / 2)),
              bestDist: Math.round(bestDist),
              secondDist: Math.round(secondDist),
              separation: separation.toFixed(3),
              confidence
            });

            if (confidence >= TAB_MIN_CONFIDENCE) {
              resolve({
                type: TAB_ORDER[bestIdx],
                confidence,
                method: 'tab-cluster'
              });
              return;
            }
          }
        }

        const rel = bestCenter / img.width;
        let fallbackType = null;
        for (const z of FALLBACK_ZONES) {
          if (rel >= z.min && rel < z.max) { fallbackType = z.type; break; }
        }
        if (!fallbackType) fallbackType = 'del';

        const fallbackConf = 65;
        console.log('[OCR Tab] fallback:', { rel: rel.toFixed(3), fallbackType, fallbackConf });

        if (fallbackConf < TAB_MIN_CONFIDENCE) {
          resolve(null);
          return;
        }

        resolve({
          type: fallbackType,
          confidence: fallbackConf,
          method: 'zone-fallback'
        });
      } catch (err) {
        console.warn('[OCR] detectActiveTab error:', err);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageSource;
  });
}

// ==================== PREPROCESS ====================
function _drawToCanvas(img, scale) {
  const s = Math.min(4, Math.max(1, scale));
  const canvas = document.createElement('canvas');
  canvas.width  = Math.floor(img.width  * s);
  canvas.height = Math.floor(img.height * s);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx, width: canvas.width, height: canvas.height };
}

function _toGrayscale(data) {
  const gray = new Uint8Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = Math.round(
      data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114
    );
  }
  return gray;
}

function _applyContrast(gray, lowPct = 0.02, highPct = 0.98) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

  const total = gray.length;
  const lowTarget  = total * lowPct;
  const highTarget = total * highPct;

  let acc = 0, lowVal = 0, highVal = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= lowTarget)  { lowVal = v; break; }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= (total - highTarget)) { highVal = v; break; }
  }

  if (highVal <= lowVal) return gray;

  const range = highVal - lowVal;
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    let v = ((gray[i] - lowVal) / range) * 255;
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    out[i] = v;
  }
  return out;
}

function _otsuThreshold(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0, wB = 0, wF = 0;
  let maxVar = 0, threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > maxVar) { maxVar = varBetween; threshold = t; }
  }
  return threshold;
}

function _binarize(gray, threshold) {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    const val = gray[i] > threshold ? 255 : 0;
    out[j]   = val;
    out[j+1] = val;
    out[j+2] = val;
    out[j+3] = 255;
  }
  return out;
}

async function preprocessPass1(rawDataUrl, signal) {
  _checkAborted(signal);
  const img = await loadImage(rawDataUrl);
  const { ctx, canvas } = _drawToCanvas(img, 2.0);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray    = _toGrayscale(imgData.data);
  const contrast = _applyContrast(gray, 0.02, 0.98);

  const out = new Uint8ClampedArray(contrast.length * 4);
  for (let i = 0, j = 0; i < contrast.length; i++, j += 4) {
    out[j]   = contrast[i];
    out[j+1] = contrast[i];
    out[j+2] = contrast[i];
    out[j+3] = 255;
  }
  ctx.putImageData(new ImageData(out, canvas.width, canvas.height), 0, 0);

  return canvas.toDataURL('image/png');
}

async function preprocessPass2(rawDataUrl, signal) {
  _checkAborted(signal);
  const img = await loadImage(rawDataUrl);
  const { ctx, canvas } = _drawToCanvas(img, 2.0);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray    = _toGrayscale(imgData.data);
  const contrast = _applyContrast(gray, 0.02, 0.98);
  const threshold = _otsuThreshold(contrast);
  const bin     = _binarize(contrast, threshold);

  ctx.putImageData(new ImageData(bin, canvas.width, canvas.height), 0, 0);
  return canvas.toDataURL('image/png');
}

async function preprocessPass3(rawDataUrl, fixedThreshold, signal) {
  _checkAborted(signal);
  const img = await loadImage(rawDataUrl);
  const { ctx, canvas } = _drawToCanvas(img, 2.5);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray    = _toGrayscale(imgData.data);
  const contrast = _applyContrast(gray, 0.02, 0.98);
  const bin     = _binarize(contrast, fixedThreshold);

  ctx.putImageData(new ImageData(bin, canvas.width, canvas.height), 0, 0);
  return canvas.toDataURL('image/png');
}

// ==================== PARSE ====================

/**
 * v2.7 — TẦNG 2: Fix chữ cái lẫn trong dải khối lượng.
 *
 * Match pattern: X.XXX - Y.YYY (cho phép chữ trong số)
 * Fix:
 *   O, o, Q → 0
 *   Z, z    → 2
 *   S, s    → 5
 *   G       → 6
 *   B       → 8
 *   l, I, | → 1
 *
 * VD:
 *   "O.OOO - 2.OO1"  → "0.000 - 2.001"
 *   "Z.OO1 - 4.OO1"  → "2.001 - 4.001"
 *   "4.00l - 6.00I"  → "4.001 - 6.001"
 */
function fixWeightRanges(text) {
  const RANGE_CHAR = '[0-9OoQlI|ZzSsGB]';
  const pattern = new RegExp(
    `(${RANGE_CHAR})\\s*([.,])\\s*(${RANGE_CHAR})(${RANGE_CHAR})(${RANGE_CHAR})` +
    `\\s*[-–—]\\s*` +
    `(${RANGE_CHAR})\\s*([.,])\\s*(${RANGE_CHAR})(${RANGE_CHAR})(${RANGE_CHAR})`,
    'g'
  );

  const fixChar = (c) => {
    switch (c) {
      case 'O': case 'o': case 'Q': return '0';
      case 'l': case 'I': case '|': return '1';
      case 'Z': case 'z': return '2';
      case 'S': case 's': return '5';
      case 'G': return '6';
      case 'B': return '8';
      default:  return c;
    }
  };

  const fixGroup = (str) => str.split('').map(fixChar).join('');

  return text.replace(pattern, (match, a, dot1, b, c, d, e, dot2, f, g, h) => {
    const left  = `${fixChar(a)}.${fixGroup(b + c + d)}`;
    const right = `${fixChar(e)}.${fixGroup(f + g + h)}`;
    return `${left} - ${right}`;
  });
}

function normalizeOcrText(text) {
  return fixWeightRanges(text)                    // v2.7 TẦNG 2 — fix dải TRƯỚC
    .replace(/[–—−]/g, '-')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/¡/g, '1')
    .replace(/\bO(\d)/g, '0$1')
    .replace(/(\d)O\b/g, '$10')

    // OCR đọc "1" thành Ì/Í/I/l/| trước "Đơn hàng"
    .replace(/(Ì|Í|I|l|\|)(\s*)(?=Đơn\s*hàng)/gi, '1$2')

    // ⭐ v2.7 TẦNG 1 — Fix 8 case chữ cái → số trước "Đơn hàng"
    .replace(/([Zz])(\s*)(?=Đơn\s*hàng)/g, '2$2')     // Z/z → 2
    .replace(/([Ss])(\s*)(?=Đơn\s*hàng)/g, '5$2')     // S/s → 5
    .replace(/([OoQ])(\s*)(?=Đơn\s*hàng)/g, '0$2')    // O/o/Q → 0
    .replace(/([G])(\s*)(?=Đơn\s*hàng)/g, '6$2')      // G → 6
    .replace(/([gq])(\s*)(?=Đơn\s*hàng)/g, '9$2')     // g/q → 9
    .replace(/([Bb])(\s*)(?=Đơn\s*hàng)/g, '8$2')     // B/b → 8
    .replace(/([AH])(\s*)(?=Đơn\s*hàng)/g, '4$2')     // A/H → 4
    .replace(/([T])(\s*)(?=Đơn\s*hàng)/g, '7$2')      // T → 7

    // Bắt biến thể "Đơn hàng"
    .replace(/[đĐ][ơơọo]n\s*h[àaàáạảãêềếệểễ]ng?/gi, 'Đơn hàng')
    .replace(/[đĐ][ơơọo]n\s*h[ềếệểễ]\b/gi, 'Đơn hàng')
    .replace(/[đĐ][ơơọo]n\s*h\b/gi, 'Đơn hàng')
    .replace(/[đĐ][ơơọo]nh\b/gi, 'Đơn hàng')
    .replace(/[đĐ]nh\b/gi, 'Đơn hàng')
    .replace(/[đĐ]n\s*h[àa]ng/gi, 'Đơn hàng')
    .replace(/[đĐ]n\s*h\b/gi, 'Đơn hàng')
    .replace(/\bDon\s*hang?/gi, 'Đơn hàng')
    .replace(/\bDon\s*h\b/gi, 'Đơn hàng')
    .replace(/\bHH\s+X\b/gi, 'Đơn hàng')
    .replace(/\bHH\s+I\b/gi, 'Đơn hàng')
    .replace(/\bnhang\b/gi, 'Đơn hàng')
    .replace(/\bơn\s+hàng\b/gi, 'Đơn hàng')

    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .filter(line => !/\b\d{1,2}:\d{2}\b/.test(line))
    .join('\n');
}

function extractTotal(text) {
  const patterns = [
    /Tổng\s*[:\-]?\s*(\d{1,6})\s*Đơn\s*hàng/i,
    /Tong\s*[:\-]?\s*(\d{1,6})\s*Don\s*hang/i,
    /Tổng\s*[:\-]?\s*(\d{1,6})/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0 && n < 100000) return n;
    }
  }
  return null;
}

function extractDate(text) {
  const clean = text.replace(/,/g, '.');

  const fullMatch = clean.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4}|\d{2})/);
  if (fullMatch) {
    const day = parseInt(fullMatch[1], 10);
    const month = parseInt(fullMatch[2], 10);
    let year = parseInt(fullMatch[3], 10);
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 &&
        year >= 2020 && year <= 2099) {
      return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }

  const dayMatch = clean.match(/(?:ngày|ngay)\s*[-–:]?\s*(\d{1,2})[\/\-\.](\d{1,2})/i);
  if (dayMatch) {
    const day = parseInt(dayMatch[1], 10);
    const month = parseInt(dayMatch[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const y = new Date().getFullYear();
      return `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }

  const allMatches = [...clean.matchAll(/(\d{1,2})[\/\-\.](\d{1,2})/g)];
  for (const m of allMatches) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const y = new Date().getFullYear();
      return `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }

  return getTodayIso();
}

function mapRangeToKey(minStr, maxStr) {
  const min = parseFloat(minStr);
  const max = parseFloat(maxStr);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  const minInt = Math.floor(min);

  if (RANGE_KEY_BY_MIN[minInt] !== undefined) {
    return RANGE_KEY_BY_MIN[minInt];
  }

  if (min >= 15) return 'over_15';

  return null;
}

function parseBlockBased(text) {
  const weights = {
    '0_2': 0, '2_4': 0, '4_6': 0, '6_8': 0,
    '8_10': 0, '10_12': 0, '12_15': 0, 'over_15': 0
  };

  const lines = text.split('\n');
  const lineOffsets = [];
  let offset = 0;
  lines.forEach(line => {
    lineOffsets.push({ start: offset, end: offset + line.length });
    offset += line.length + 1;
  });

  const rangeRegex = /(\d{1,6}\.\d{3})\s*-\s*(\d{1,6}\.\d{3})/g;
  const ranges = [];
  let m;
  while ((m = rangeRegex.exec(text)) !== null) {
    const pos = m.index;
    const lineIdx = lineOffsets.findIndex(o => pos >= o.start && pos < o.end);
    ranges.push({
      minStr: m[1],
      maxStr: m[2],
      pos:    m.index,
      endPos: m.index + m[0].length,
      lineIdx
    });
  }

  if (ranges.length === 0) {
    return { weights, detectedRanges: 0, parseMode: 'block-empty' };
  }

  const totalRegex = /Tổng\s*[:\-]?\s*\d{1,6}\s*Đơn\s*hàng/gi;
  const totalMatches = [...text.matchAll(totalRegex)];
  const isInsideTotal = (pos) =>
    totalMatches.some(t => pos >= t.index && pos < t.index + t[0].length);

  const orderRegex = /(\d{1,6})\s*Đơn\s*hàng/i;
  const LINE_WINDOW = 3;

  const usedMatches = new Set();

  ranges.forEach(r => {
    const key = mapRangeToKey(r.minStr, r.maxStr);
    if (!key) return;
    if (r.lineIdx === -1) return;

    const searchStart = Math.max(0, r.lineIdx - LINE_WINDOW);
    const searchEnd   = Math.min(lines.length - 1, r.lineIdx + LINE_WINDOW);

    let best = null, bestDist = Infinity;

    for (let i = searchStart; i <= searchEnd; i++) {
      const line = lines[i];
      const lineStart = lineOffsets[i].start;

      const re = new RegExp(orderRegex.source, 'gi');
      let mm;
      while ((mm = re.exec(line)) !== null) {
        const absPos = lineStart + mm.index;
        if (isInsideTotal(absPos)) continue;
        if (usedMatches.has(absPos)) continue;

        const val = parseInt(mm[1], 10);
        if (!Number.isFinite(val) || val < 0) continue;

        const lineDist = Math.abs(i - r.lineIdx);
        if (lineDist < bestDist) {
          bestDist = lineDist;
          best = { value: val, absPos };
        }
      }
    }

    if (best && weights[key] === 0) {
      weights[key] = best.value;
      if (best.absPos != null) usedMatches.add(best.absPos);
    }
  });

  return {
    weights,
    detectedRanges: ranges.length,
    parseMode: 'block-v4-owned'
  };
}

// ==================== VALIDATION ====================
function validateStructure(weights) {
  const values = Object.values(weights);
  const nonZero = values.filter(v => Number(v) > 0).length;
  const total   = values.reduce((a, b) => a + Number(b), 0);

  const errors = [];

  if (total === 0) errors.push('Không đọc được đơn nào');
  if (nonZero > 8) errors.push('Quá nhiều dải có dữ liệu (>8)');

  return { ok: errors.length === 0, errors, warnings: [], nonZero, total };
}

function validateDistribution(weights) {
  const w = {
    '0_2':    Number(weights['0_2'])    || 0,
    '2_4':    Number(weights['2_4'])    || 0,
    '4_6':    Number(weights['4_6'])    || 0,
    '6_8':    Number(weights['6_8'])    || 0,
    '8_10':   Number(weights['8_10'])   || 0,
    '10_12':  Number(weights['10_12'])  || 0,
    '12_15':  Number(weights['12_15'])  || 0,
    'over_15':Number(weights['over_15'])|| 0
  };
  const total = Object.values(w).reduce((s, v) => s + v, 0);
  if (total < 5) return { ok: true, warnings: [], suspectKeys: [] };

  const warnings = [];
  const suspects = new Set();

  const maxVal = Math.max(...Object.values(w));
  const maxKey = Object.keys(w).find(k => w[k] === maxVal);
  if (maxKey && maxKey !== '0_2' && w['0_2'] > 0 && maxVal > w['0_2'] * 10) {
    warnings.push(`Dải ${maxKey} cao gấp >10× dải 0-2`);
    suspects.add(maxKey);
  }

  if (w['2_4'] > w['0_2'] * 2 && w['0_2'] < 5) {
    warnings.push('Dải 2-4 cao hơn 0-2 gấp 2 lần — có thể lỗi');
    suspects.add('2_4');
  }

  return { ok: warnings.length === 0, warnings, suspectKeys: [...suspects] };
}

function findExactDuplicate(r) {
  const type = getTypeFromResult(r);
  if (!type) return null;
  const weights = buildWeights(r);
  return state.appData[type].find(rec =>
    rec.date === r.parsedDate &&
    WEIGHT_KEYS.every(k =>
      (parseInt(rec.weights[k], 10) || 0) === (parseInt(weights[k], 10) || 0)
    )
  ) || null;
}

function findSameDaySameType(r) {
  const type = getTypeFromResult(r);
  if (!type) return null;
  return state.appData[type].find(rec => rec.date === r.parsedDate) || null;
}

// ==================== SCORING ====================
function computeScore({
  expectedTotal,
  actualTotal,
  detectedRanges,
  nonZeroRanges,
  ocrConfidence,
  distributionWarnings
}) {
  let totalScore;
  if (expectedTotal === null) {
    totalScore = 70;
  } else if (expectedTotal === actualTotal) {
    totalScore = 100;
  } else {
    const diff = Math.abs(expectedTotal - actualTotal);
    const diffPct = diff / Math.max(expectedTotal, 1);
    if (diffPct <= 0.02)      totalScore = 90;
    else if (diffPct <= 0.05) totalScore = 75;
    else if (diffPct <= 0.10) totalScore = 55;
    else                      totalScore = 30;
  }

  let structureScore = 100;
  if (detectedRanges === 0)        structureScore = 30;
  else if (detectedRanges > 8)     structureScore = 60;
  else if (nonZeroRanges === 0)    structureScore = 30;

  const ocrScore = Number.isFinite(ocrConfidence)
    ? Math.max(0, Math.min(100, ocrConfidence))
    : 85;

  const distributionScore = distributionWarnings.length === 0
    ? 100
    : Math.max(50, 100 - distributionWarnings.length * 15);

  let finalScore =
    totalScore        * 0.50 +
    structureScore    * 0.25 +
    ocrScore          * 0.15 +
    distributionScore * 0.10;

  const checksumOk = expectedTotal !== null && expectedTotal === actualTotal;
  if (!checksumOk) {
    finalScore = Math.min(finalScore, SCORE_MAX_CHECKSUM_FAIL);
  }

  return {
    final:        Math.round(finalScore),
    total:        Math.round(totalScore),
    structure:    Math.round(structureScore),
    ocr:          Math.round(ocrScore),
    distribution: Math.round(distributionScore),
    checksumOk
  };
}

// ==================== HELPERS ====================
function buildWeights(r) {
  const suffixMap = {
    '0_2':    'w0_2',
    '2_4':    'w2_4',
    '4_6':    'w4_6',
    '6_8':    'w6_8',
    '8_10':   'w8_10',
    '10_12':  'w10_12',
    '12_15':  'w12_15',
    'over_15':'wover_15'
  };
  const w = {};
  WEIGHT_KEYS.forEach(wk => {
    const suffix = Object.keys(suffixMap).find(k => suffixMap[k] === wk);
    w[wk] = r.weights[suffix] || 0;
  });
  return w;
}

function getTypeFromResult(r) {
  if (!r.detectedColorType) return null;
  return r.detectedColorType === 'del'  ? 'delivery'
       : r.detectedColorType === 'pick' ? 'pickup'
       : 'return';
}

function getTypeLabel(r) {
  if (!r.detectedColorType) return 'Không rõ';
  return r.detectedColorType === 'del'  ? 'Giao'
       : r.detectedColorType === 'pick' ? 'Lấy'
       : 'Hoàn';
}
// =============================================================
// OCR ENGINE v2.7 — PART 3/3
// Pipeline · Routing · Modals · Batch · Exports
// =============================================================

// ==================== UNDO LOADER ====================
let _pushUndoFn = null;
let _pushUndoLoading = null;

async function ensurePushUndo() {
  if (_pushUndoFn) return _pushUndoFn;
  if (_pushUndoLoading) return _pushUndoLoading;
  _pushUndoLoading = (async () => {
    try {
      const mod = await import('./undo.js');
      _pushUndoFn = mod.pushUndo || null;
      return _pushUndoFn;
    } catch (e) {
      console.warn('[OCR] Không load được undo.js:', e);
      return null;
    }
  })();
  return _pushUndoLoading;
}

// ==================== PARSE FROM TEXT ====================
function parseFromText(rawText) {
  const normalized = normalizeOcrText(rawText);
  const expectedTotal = extractTotal(normalized);
  const parsedDate    = extractDate(normalized);
  const blockResult   = parseBlockBased(normalized);
  const weights       = blockResult.weights;
  const actualTotal   = Object.values(weights).reduce((a, b) => a + b, 0);

  return {
    normalized,
    expectedTotal,
    parsedDate,
    weights,
    actualTotal,
    detectedRanges: blockResult.detectedRanges,
    parseMode:      blockResult.parseMode
  };
}

// ==================== SCORE RESULT ====================
function scoreResult(parsed) {
  const structure = validateStructure(parsed.weights);
  const dist      = validateDistribution(parsed.weights);
  const nonZero   = Object.values(parsed.weights).filter(v => v > 0).length;

  const score = computeScore({
    expectedTotal: parsed.expectedTotal,
    actualTotal:   parsed.actualTotal,
    detectedRanges: parsed.detectedRanges,
    nonZeroRanges:  nonZero,
    ocrConfidence: 85,
    distributionWarnings: dist.warnings
  });

  return {
    score,
    structure,
    dist,
    nonZero,
    suspectKeys: dist.suspectKeys || []
  };
}

// ==================== BUILD FINAL RESULT ====================
function buildFinalResult({
  parsed, rawText, detectedColorType, tabConfidence, tabMethod,
  scoreBundle, attempts, blobUrl
}) {
  const confidences = {};
  Object.keys(parsed.weights).forEach(k => {
    confidences[k] = scoreBundle.score.final;
  });

  return {
    detectedColorType,
    tabConfidence: tabConfidence || 0,
    tabMethod: tabMethod || '',
    parsedDate:    parsed.parsedDate,
    weights:       parsed.weights,
    confidences,

    expectedTotal: parsed.expectedTotal,
    actualTotal:   parsed.actualTotal,
    totalFound:    parsed.actualTotal,

    score: scoreBundle.score,

    distWarnings: scoreBundle.dist.warnings,
    suspectKeys:  scoreBundle.suspectKeys,

    attempts,
    parseMode: parsed.parseMode,
    detectedRanges: parsed.detectedRanges,

    rawText,
    imageBlobUrl: blobUrl || '',
    fullDataUrl:  blobUrl || ''
  };
}

// ==================== PROCESS ONE FILE ====================
async function processOneFile(file, signal) {
  _checkAborted(signal);

  const hash = await hashBlob(file);
  const cached = cacheGet(hash);

  const blobUrl = URL.createObjectURL(file);

  if (cached) {
    return {
      file: file.name,
      thumbnail: cached.thumbnail,
      result: { ...cached.result, imageBlobUrl: blobUrl, fullDataUrl: blobUrl },
      error: null,
      fromCache: true
    };
  }

  _checkAborted(signal);
  const dataUrl = await readFileAsDataURL(file);
  const thumbnail = await makeThumbnail(dataUrl, 96);

  _checkAborted(signal);
  const tabInfo = await detectActiveTab(dataUrl);
  const detectedColorType = tabInfo ? tabInfo.type : null;
  const tabConfidence = tabInfo ? tabInfo.confidence : 0;
  const tabMethod = tabInfo ? (tabInfo.method || '') : '';

  let bestBundle = null;
  let bestScore  = -1;
  let attempts   = 0;

  const passes = [
    { name: 'P1-contrast',   run: () => preprocessPass1(dataUrl, signal) },
    { name: 'P2-otsu',       run: () => preprocessPass2(dataUrl, signal) },
    { name: 'P3-threshold',  run: () => preprocessPass3(dataUrl, 130, signal) }
  ];

  for (const pass of passes) {
    _checkAborted(signal);
    attempts++;

    try {
      const statusDesc = document.getElementById('ocrStatusDesc');
      if (statusDesc) statusDesc.innerText = `Đang nhận diện (${pass.name})...`;

      const preprocessed = await pass.run();
      _checkAborted(signal);

      const text = await ocrRecognize(preprocessed, signal);
      _checkAborted(signal);

      const parsed = parseFromText(text);
      const scoreBundle = scoreResult(parsed);

      const bundle = { parsed, rawText: text, scoreBundle, passName: pass.name };

      if (scoreBundle.score.final >= SCORE_AUTO_SAVE) {
        bestBundle = bundle;
        bestScore  = scoreBundle.score.final;
        break;
      }

      if (scoreBundle.score.final > bestScore) {
        bestScore  = scoreBundle.score.final;
        bestBundle = bundle;
      }
    } catch (err) {
      if (err.message === 'OCR_CANCELLED') throw err;
      console.warn(`[OCR] Pass ${pass.name} lỗi:`, err.message);
    }
  }

  if (!bestBundle) {
    return {
      file: file.name,
      thumbnail,
      result: null,
      error: 'Không đọc được ảnh (3 pass đều lỗi)'
    };
  }

  const result = buildFinalResult({
    parsed:          bestBundle.parsed,
    rawText:         bestBundle.rawText,
    detectedColorType,
    tabConfidence,
    tabMethod,
    scoreBundle:     bestBundle.scoreBundle,
    attempts,
    blobUrl
  });

  cacheSet(hash, {
    thumbnail,
    result: { ...result, imageBlobUrl: '', fullDataUrl: '' }
  });

  return { file: file.name, thumbnail, result, error: null };
}

// ==================== AUTO-SAVE ====================
async function tryAutoSave(r) {
  if (!r.detectedColorType) return false;
  if (r.score.final < SCORE_AUTO_SAVE) return false;
  if (r.actualTotal <= 0) return false;

  const type = getTypeFromResult(r);
  if (!type) return false;

  const weights = buildWeights(r);
  const newId = generateId();

  const pushUndoFn = await ensurePushUndo();
  if (pushUndoFn) {
    pushUndoFn({
      msg: `OCR tự lưu ${getTypeLabel(r)} ${formatDateDisplay(r.parsedDate)}`,
      restore: () => {
        state.appData[type] = state.appData[type].filter(it => it.id !== newId);
      }
    });
  }

  state.appData[type].unshift({ id: newId, date: r.parsedDate, weights });
  updateAllViews();
  return true;
}

async function tryAutoSaveForce(r) {
  if (!r.detectedColorType) return false;
  const type = getTypeFromResult(r);
  if (!type) return false;

  const weights = buildWeights(r);
  const newId = generateId();

  const pushUndoFn = await ensurePushUndo();
  if (pushUndoFn) {
    pushUndoFn({
      msg: `OCR lưu ${getTypeLabel(r)} ${formatDateDisplay(r.parsedDate)}`,
      restore: () => {
        state.appData[type] = state.appData[type].filter(it => it.id !== newId);
      }
    });
  }

  state.appData[type].unshift({ id: newId, date: r.parsedDate, weights });
  updateAllViews();
  return true;
}

// ==================== COPY OCR LOG ====================
export async function copyOcrLog() {
  const debugEl = document.getElementById('ocrDebugText');
  if (!debugEl) {
    showToast('Không có log để copy', 'warning', 1500);
    return;
  }
  const text = debugEl.innerText;
  if (!text || text.trim() === '') {
    showToast('Log trống', 'warning', 1500);
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      showToast('Đã copy log (' + text.length + ' ký tự)', 'success', 1800);
      return;
    }
  } catch (e) {
    console.warn('[OCR] Clipboard API fail:', e);
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) {
      showToast('Đã copy log (' + text.length + ' ký tự)', 'success', 1800);
    } else {
      showToast('Không copy được — thử giữ tay vào log', 'error', 2500);
    }
  } catch (e) {
    showToast('Không copy được: ' + e.message, 'error', 2500);
  }
}

// ==================== TAB PICKER MODAL ====================
function showTabPickerModal() {
  return new Promise(resolve => {
    const style = document.createElement('style');
    style.textContent = `
      .tab-picker-btn {
        padding: 14px 16px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text-1);
        font-size: 13.5px;
        font-weight: 600;
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        transition: all 0.15s;
      }
      .tab-picker-btn:hover {
        border-color: var(--accent);
        background: var(--accent-soft);
      }
      .tab-picker-btn:active { transform: scale(0.98); }
      .tab-picker-btn.skip { color: var(--danger); }
      .tab-picker-btn.skip:hover {
        background: var(--danger-bg);
        border-color: var(--danger-bd);
      }
    `;
    document.head.appendChild(style);

    const shade = document.createElement('div');
    shade.className = 'modal-shade active';
    shade.style.zIndex = '500';
    shade.innerHTML = `
      <div class="modal-box" style="max-width:380px;border-radius:20px;margin:auto 16px;">
        <div class="modal-box-head">
          <h3>Chọn loại đơn</h3>
        </div>
        <div class="modal-body" style="padding:20px">
          <p style="font-size:13px;color:var(--text-2);margin-bottom:16px;text-align:center;line-height:1.5">
            Không nhận diện được tab từ ảnh này.<br>
            Ảnh này là đơn gì?
          </p>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button class="tab-picker-btn" data-type="del">🚚 Giao — Đơn giao hàng</button>
            <button class="tab-picker-btn" data-type="pick">📦 Lấy — Đơn lấy hàng</button>
            <button class="tab-picker-btn" data-type="ret">↩️ Hoàn — Đơn hoàn</button>
            <button class="tab-picker-btn skip" data-type="skip">🗑️ Bỏ ảnh này</button>
          </div>
        </div>
      </div>
    `;

    shade.querySelectorAll('.tab-picker-btn').forEach(btn => {
      btn.onclick = () => {
        const type = btn.dataset.type;
        document.body.removeChild(shade);
        resolve(type === 'skip' ? null : type);
      };
    });

    document.body.appendChild(shade);
  });
}

// ==================== REVIEW MODAL ====================
function showReviewModal(item) {
  return new Promise(resolve => {
    const r = item.result;

    const style = document.createElement('style');
    style.textContent = `
      .review-btn {
        flex: 1;
        padding: 12px;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        border: 1px solid;
        transition: all 0.15s;
      }
      .review-btn-edit {
        background: var(--surface);
        border-color: var(--border);
        color: var(--text-1);
      }
      .review-btn-edit:hover { border-color: var(--accent); color: var(--accent); }
      .review-btn-save {
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
      }
      .review-btn-save:hover { filter: brightness(0.95); }
      .review-btn:active { transform: scale(0.97); }
    `;
    document.head.appendChild(style);

    let warningsHtml = '';
    if (r.distWarnings && r.distWarnings.length > 0) {
      warningsHtml = `<div style="background:var(--warning-bg);border:1px solid var(--warning-bd);border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:11.5px;color:var(--warning);line-height:1.6">
        ${r.distWarnings.map(w => '⚠️ ' + w).join('<br>')}
      </div>`;
    }

    const scoreColor = r.score.final >= 90 ? 'var(--success)' : 'var(--warning)';

    const shade = document.createElement('div');
    shade.className = 'modal-shade active';
    shade.style.zIndex = '500';
    shade.innerHTML = `
      <div class="modal-box" style="max-width:400px;border-radius:20px;margin:auto 16px;">
        <div class="modal-box-head">
          <h3>⚠️ Cần kiểm tra</h3>
        </div>
        <div class="modal-body" style="padding:20px">
          <div style="text-align:center;margin-bottom:16px">
            <div style="font-size:34px;font-weight:800;font-family:'JetBrains Mono',monospace;color:${scoreColor};line-height:1">
              ${r.score.final}<span style="font-size:16px;color:var(--text-3)">/100</span>
            </div>
            <div style="font-size:11px;color:var(--text-3);margin-top:4px;letter-spacing:0.5px;text-transform:uppercase">Điểm tin cậy</div>
          </div>

          <div style="background:var(--surface-2);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:12.5px;line-height:1.8">
            <div><b>Loại:</b> ${getTypeLabel(r)}</div>
            <div><b>Ngày:</b> ${formatDateDisplay(r.parsedDate)}</div>
            <div><b>Tổng OCR:</b> ${r.actualTotal} đơn</div>
            <div><b>Tổng ảnh:</b> ${r.expectedTotal !== null ? r.expectedTotal + ' đơn' : '—'}</div>
            <div><b>Checksum:</b> ${r.score.checksumOk ? '✅ Khớp' : '❌ Không khớp'}</div>
          </div>

          ${warningsHtml}

          <div style="font-size:11px;color:var(--text-3);margin-bottom:14px;font-family:'JetBrains Mono',monospace">
            Total ${r.score.total} · Structure ${r.score.structure} · OCR ${r.score.ocr} · Dist ${r.score.distribution}
          </div>

          <div style="display:flex;gap:8px">
            <button class="review-btn review-btn-edit">✏️ Sửa</button>
            <button class="review-btn review-btn-save">✅ Lưu luôn</button>
          </div>
        </div>
      </div>
    `;

    shade.querySelector('.review-btn-edit').onclick = () => {
      document.body.removeChild(shade);
      fillModalFromResult(item);
      resolve('edit');
    };

    shade.querySelector('.review-btn-save').onclick = async () => {
      document.body.removeChild(shade);
      if (await tryAutoSaveForce(r)) {
        showToast(`Đã lưu ${getTypeLabel(r)} ${formatDateDisplay(r.parsedDate)}`, 'success', 2500);
      } else {
        showToast('Không lưu được — thiếu loại đơn', 'error', 2500);
      }
      resolve('saved');
    };

    document.body.appendChild(shade);
  });
}

// ==================== CANCEL BUTTON ====================
function ensureCancelButton() {
  const overlay = document.getElementById('ocrLoadingOverlay');
  if (!overlay) return;

  let btn = overlay.querySelector('.ocr-cancel-btn');
  if (btn) return;

  btn = document.createElement('button');
  btn.className = 'ocr-cancel-btn';
  btn.innerText = '✕ Hủy';
  btn.style.cssText = `
    margin-top: 22px;
    padding: 10px 26px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    backdrop-filter: blur(4px);
    transition: all 0.15s;
  `;
  btn.onmouseenter = () => { btn.style.background = 'rgba(255,255,255,0.18)'; };
  btn.onmouseleave = () => { btn.style.background = 'rgba(255,255,255,0.1)'; };
  btn.onclick = () => cancelOcr();
  overlay.appendChild(btn);
}

// ==================== SUMMARY TOAST ====================
function showSummaryToast(saved, dup, need, delayMs = 0) {
  const parts = [];
  if (saved > 0) parts.push(`Đã lưu ${saved}`);
  if (dup > 0)   parts.push(`bỏ qua ${dup} trùng`);
  if (need > 0)  parts.push(`${need} cần check`);

  if (parts.length === 0) return;

  let type = 'success';
  if (need > 0) type = 'warning';
  else if (dup > 0 && saved === 0) type = 'warning';

  const msg = parts.join(', ');
  const fire = () => showToast(msg, type, 3000);
  if (delayMs > 0) setTimeout(fire, delayMs);
  else fire();
}

// ==================== PIPELINE CHUNG ====================
async function _runOcrFromFiles(files, wasAppend = false) {
  if (!files || files.length === 0) return;

  const ctrl = _newAbortController();
  const signal = ctrl.signal;

  const overlay = document.getElementById('ocrLoadingOverlay');
  const statusTitle = document.getElementById('ocrStatusTitle');
  const statusDesc  = document.getElementById('ocrStatusDesc');

  if (overlay) overlay.style.display = 'flex';
  ensureCancelButton();

  try {
    const results = [];

    for (let i = 0; i < files.length; i++) {
      _checkAborted(signal);
      if (statusTitle) statusTitle.innerText = `Ảnh ${i + 1}/${files.length}`;
      if (statusDesc)  statusDesc.innerText  = 'Đang xử lý...';

      const item = await processOneFile(files[i], signal);
      results.push(item);
    }

    if (overlay) overlay.style.display = 'none';

    const autoSaved     = [];
    const duplicates    = [];
    const needAttention = [];
    const needTab       = [];

    for (const item of results) {
      if (item.error) { needAttention.push(item); continue; }
      const r = item.result;

      if (!r.detectedColorType) {
        needTab.push(item);
        continue;
      }

      if (findExactDuplicate(r)) {
        duplicates.push({ item, kind: 'exact' });
        continue;
      }

      const sameDay = findSameDaySameType(r);
      if (sameDay) {
        duplicates.push({ item, kind: 'same_day', existing: sameDay });
        continue;
      }

      if (r.score.final >= SCORE_AUTO_SAVE) {
        if (await tryAutoSave(r)) {
          autoSaved.push(item);
        } else {
          needAttention.push(item);
        }
      } else {
        needAttention.push(item);
      }
    }

    for (const item of needTab) {
      _checkAborted(signal);
      const type = await showTabPickerModal();
      if (type === null) continue;

      item.result.detectedColorType = type;
      item.result.tabConfidence = 100;
      item.result.tabMethod = 'user-picker';

      if (findExactDuplicate(item.result)) {
        duplicates.push({ item, kind: 'exact' });
        continue;
      }
      const sameDay = findSameDaySameType(item.result);
      if (sameDay) {
        duplicates.push({ item, kind: 'same_day', existing: sameDay });
        continue;
      }

      if (item.result.score.final >= SCORE_AUTO_SAVE) {
        if (await tryAutoSave(item.result)) autoSaved.push(item);
        else needAttention.push(item);
      } else {
        needAttention.push(item);
      }
    }

    if (needAttention.length > 0) {
      if (wasAppend) {
        batchResults.push(...needAttention);
        renderBatchList();
        document.getElementById('batchOcrModal').classList.add('active');
        showSummaryToast(autoSaved.length, duplicates.length, needAttention.length);
        return;
      }

      if (files.length === 1) {
        const item = needAttention[0];
        if (item.error) {
          showToast('Không đọc được ảnh: ' + item.error, 'error', 3000);
          return;
        }
        const r = item.result;
        if (r.score.final >= SCORE_REVIEW && r.score.final < SCORE_AUTO_SAVE) {
          await showReviewModal(item);
        } else {
          fillModalFromResult(item);
        }
        return;
      }

      batchResults = needAttention;
      openBatchOcrModal();
      showSummaryToast(autoSaved.length, duplicates.length, needAttention.length, 400);
      return;
    }

    if (files.length === 1) {
      const item = results[0];

      if (duplicates.length === 1 && duplicates[0].kind === 'exact') {
        const r = item.result;
        showToast(
          `Ảnh đã tồn tại — ${getTypeLabel(r)} ${formatDateDisplay(r.parsedDate)}: ${r.actualTotal} đơn`,
          'warning', 2500
        );
        return;
      }

      if (duplicates.length === 1 && duplicates[0].kind === 'same_day') {
        await openCompareModal(duplicates[0].item, duplicates[0].existing);
        return;
      }
      return;
    }

    if (autoSaved.length > 0 || duplicates.length > 0) {
      showSummaryToast(autoSaved.length, duplicates.length, 0);
    }
  } catch (err) {
    if (overlay) overlay.style.display = 'none';

    if (err.message === 'OCR_CANCELLED') {
      showToast('Đã hủy OCR', 'warning', 2000);
      return;
    }

    console.error('[OCR] Pipeline error:', err);
    showToast('Lỗi khi quét ảnh: ' + err.message, 'error', 3000);
  } finally {
    _clearAbortController(ctrl);
  }
}

// ==================== ENTRY: INPUT FILE ====================
export async function handleOcrImage(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (files.length === 0) { pendingAppend = false; return; }

  const wasAppend = pendingAppend;
  pendingAppend = false;

  await _runOcrFromFiles(files, wasAppend);
}

// ==================== ENTRY: SHARE TARGET ====================
export async function handleSharedImage(sharedFiles) {
  const arr = Array.from(sharedFiles || []);
  if (arr.length === 0) {
    showToast('Không nhận được ảnh từ chia sẻ', 'warning', 2500);
    return;
  }

  const images = arr.filter(f => f && f.type && f.type.startsWith('image/'));
  const skipped = arr.length - images.length;

  if (images.length === 0) {
    showToast(
      skipped > 0 ? 'Chia sẻ không chứa ảnh — bỏ qua' : 'Không có file hợp lệ',
      'error', 3000
    );
    return;
  }

  if (skipped > 0) {
    showToast(`Bỏ qua ${skipped} mục không phải ảnh`, 'warning', 2000);
  }

  await _runOcrFromFiles(images, false);
}

// ==================== FILL MODAL FROM RESULT ====================
export function fillModalFromResult(item) {
  const r = item.result;
  state.lastOcrImageDataUrl = r.imageBlobUrl || r.fullDataUrl || '';
  state.isOcrScan = true;

  const debugEl = document.getElementById('ocrDebugText');
  if (debugEl) {
    const scoreStr = `[Score ${r.score.final} — Total ${r.score.total} / Structure ${r.score.structure} / OCR ${r.score.ocr} / Dist ${r.score.distribution}]`;
    const checksumStr = `[Checksum ${r.score.checksumOk ? 'OK' : 'FAIL'} — Expected ${r.expectedTotal} vs Actual ${r.actualTotal}]`;
    const tabStr = `[Tab ${r.detectedColorType || '?'} (conf ${r.tabConfidence || 0}) · ${r.tabMethod || '?'}]`;
    const attemptStr = `[Attempts ${r.attempts || 1} · ${r.parseMode || '?'}]`;
    debugEl.innerText = `${scoreStr}\n${checksumStr}\n${tabStr}\n${attemptStr}\n\n${r.rawText || '(không có text)'}`;
    debugEl.style.display = 'none';
    const toggleBtn = document.getElementById('ocrDebugToggle');
    if (toggleBtn) {
      toggleBtn.innerText = 'Xem log';

      if (!document.getElementById('ocrCopyLogBtn')) {
        const copyBtn = document.createElement('button');
        copyBtn.id = 'ocrCopyLogBtn';
        copyBtn.type = 'button';
        copyBtn.innerText = '📋 Copy log';
        copyBtn.style.cssText = `
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-3);
          font-size: 10px;
          padding: 4px 10px;
          border-radius: 6px;
          cursor: pointer;
          font-family: inherit;
          font-weight: 600;
          margin-left: 6px;
        `;
        copyBtn.onclick = () => copyOcrLog();
        toggleBtn.parentNode.appendChild(copyBtn);
      }
    }
  }

  openAddModal();
  document.getElementById('inputDate').value = r.parsedDate;
  switchModalSubTab(r.detectedColorType || 'del');

  const prefix = r.detectedColorType === 'del'  ? 'del_inp'
               : r.detectedColorType === 'pick' ? 'pick_inp'
               : 'ret_inp';
  Object.keys(r.weights).forEach(k => {
    const el = document.getElementById(prefix + '_' + k);
    if (el) el.value = r.weights[k];
  });

  applyConfidenceHighlight(r.confidences, r.detectedColorType || 'del');

  const typeText = getTypeLabel(r);
  let msg = `${typeText} ${formatDateDisplay(r.parsedDate)} · ${r.actualTotal} đơn`;
  if (r.expectedTotal !== null && r.actualTotal !== r.expectedTotal) {
    msg += ` · lệch ${Math.abs(r.expectedTotal - r.actualTotal)}`;
  }
  msg += ` · Score ${r.score.final}`;

  let toastType = 'success';
  if (r.score.final < SCORE_REVIEW) toastType = 'error';
  else if (r.score.final < SCORE_AUTO_SAVE) toastType = 'warning';

  if (r.distWarnings && r.distWarnings.length > 0) {
    showDistributionWarning(
      { warnings: r.distWarnings, suspectKeys: r.suspectKeys || [] },
      r.detectedColorType || 'del'
    );
  }

  showToast(msg + ' — kiểm tra và lưu', toastType, 3500);
}

// ==================== DISTRIBUTION WARNING ====================
function showDistributionWarning(distCheck, detectedType) {
  const old = document.getElementById('distWarningBanner');
  if (old) old.remove();

  const prefix = detectedType === 'del'  ? 'del_inp'
               : detectedType === 'pick' ? 'pick_inp' : 'ret_inp';

  const suffixMap = {
    '0_2':'0_2','2_4':'2_4','4_6':'4_6','6_8':'6_8',
    '8_10':'8_10','10_12':'10_12','12_15':'12_15','over_15':'over_15'
  };
  (distCheck.suspectKeys || []).forEach(k => {
    const inp = document.getElementById(prefix + '_' + suffixMap[k]);
    if (inp) inp.classList.add('conf-suspect');
  });

  const banner = document.createElement('div');
  banner.id = 'distWarningBanner';
  banner.className = 'dist-warning-banner';
  banner.innerHTML = `
    <div class="dist-warning-title">⚠️ Phân bố bất thường</div>
    <ul class="dist-warning-list">
      ${distCheck.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
    </ul>
    <div class="dist-warning-hint">Đối chiếu với ảnh gốc bên dưới trước khi lưu</div>
  `;

  const tabs = document.getElementById('modalSubTabGroup');
  if (tabs && tabs.parentNode) {
    tabs.parentNode.insertBefore(banner, tabs);
  }
}

// ==================== COMPARE MODAL ====================
function buildCompareText(ocrW, existingW) {
  const suffixToWeight = {
    '0_2':'w0_2','2_4':'w2_4','4_6':'w4_6','6_8':'w6_8',
    '8_10':'w8_10','10_12':'w10_12','12_15':'w12_15','over_15':'wover_15'
  };
  const labels = {
    '0_2':'>0-2kg','2_4':'>2-4','4_6':'>4-6','6_8':'>6-8',
    '8_10':'>8-10','10_12':'>10-12','12_15':'>12-15','over_15':'>15'
  };
  const diffs = [];
  let matches = 0;
  Object.keys(suffixToWeight).forEach(k => {
    const ocr = parseInt(ocrW[k], 10) || 0;
    const ex  = parseInt(existingW[suffixToWeight[k]], 10) || 0;
    if (ocr !== ex) diffs.push(`${labels[k]}: Đã lưu ${ex} ← OCR ${ocr}`);
    else if (ocr > 0 || ex > 0) matches++;
  });
  if (diffs.length === 0) return { text: `✅ Khớp hoàn toàn (${matches} dải)`, diffs: 0 };
  return {
    text: `⚠️ ${diffs.length} dải KHÁC BIỆT:\n\n${diffs.join('\n')}\n\n→ Xem ảnh gốc để đối chiếu.`,
    diffs: diffs.length
  };
}

export async function openCompareModal(batchItem, existingRecord) {
  const r = batchItem.result;
  const type = getTypeFromResult(r);
  if (!type) {
    fillModalFromResult(batchItem);
    return;
  }

  openEditModal(type, existingRecord.id);

  setTimeout(async () => {
    const previewBox = document.getElementById('ocrPreviewBox');
    const previewImg = document.getElementById('ocrPreviewImg');
    if (previewBox && previewImg && (r.imageBlobUrl || r.fullDataUrl)) {
      previewImg.src = r.imageBlobUrl || r.fullDataUrl;
      previewBox.style.display = 'block';
    }
    const cmp = buildCompareText(r.weights, existingRecord.weights);
    const dateStr = formatDateDisplay(r.parsedDate);
    let msg = `📊 SO SÁNH NGÀY ${dateStr}\n\n`;
    msg += `📁 Dữ liệu ĐÃ LƯU được hiển thị trong ô nhập.\n`;
    msg += `📷 Ảnh OCR được hiển thị bên dưới.\n\n`;
    msg += cmp.text;
    await showAlert(msg, { title: 'So sánh OCR', okText: 'Đã hiểu' });
  }, 200);
}

// ==================== BATCH STATE ====================
let batchResults = [];
let pendingAppend = false;

// ==================== BATCH MODAL ====================
export function openBatchOcrModal() {
  renderBatchList();
  document.getElementById('batchOcrModal').classList.add('active');
}
export function closeBatchOcrModal() {
  document.getElementById('batchOcrModal').classList.remove('active');
}
export function appendBatchFiles() {
  pendingAppend = true;
  document.getElementById('ocrFileInput').click();
}

function renderBatchList() {
  const list = document.getElementById('batchList');
  list.innerHTML = '';
  document.getElementById('batchCount').innerText = batchResults.length;

  if (batchResults.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-3);font-size:12px">Không có ảnh nào.</div>';
    return;
  }

  const typeMap = {
    del:  ['Giao', 'tag-delivery'],
    pick: ['Lấy',  'tag-pickup'],
    ret:  ['Hoàn', 'tag-return']
  };

  batchResults.forEach((item, idx) => {
    const div = document.createElement('div');

    if (item.error) {
      div.className = 'batch-item error';
      div.innerHTML = `
        <div class="batch-thumb" style="display:flex;align-items:center;justify-content:center;font-size:22px">⚠️</div>
        <div class="batch-info">
          <div class="batch-title">${escapeHtml(item.file)}</div>
          <div class="batch-meta" style="color:var(--danger)">Lỗi: ${escapeHtml(item.error)}</div>
        </div>
        <div class="batch-actions">
          <button class="batch-btn batch-btn-remove" onclick="removeBatchItem(${idx})">Bỏ</button>
        </div>`;
    } else {
      const r = item.result;
      const score = r.score.final;
      const scoreIcon = score >= SCORE_AUTO_SAVE ? '🟢'
                       : score >= SCORE_REVIEW    ? '🟡'
                       : '🔴';
      const checksumIcon = r.score.checksumOk ? '' : ' ⚠️';
      const distIcon = (r.distWarnings && r.distWarnings.length > 0) ? ' 🟠' : '';
      const cacheIcon = item.fromCache ? ' ⚡' : '';

      let typeLabel = '?', typeClass = 'tag-delivery';
      if (r.detectedColorType && typeMap[r.detectedColorType]) {
        [typeLabel, typeClass] = typeMap[r.detectedColorType];
      }

      const type = getTypeFromResult(r);
      const existing = type ? state.appData[type].find(rec => rec.date === r.parsedDate) : null;

      let actionBtn;
      if (!r.detectedColorType) {
        actionBtn = `<button class="batch-btn batch-btn-import" onclick="importBatchItem(${idx})">📝 Chọn loại</button>`;
      } else if (existing) {
        actionBtn = `<button class="batch-btn batch-btn-compare" onclick="importBatchItem(${idx})">🔍 So sánh</button>`;
      } else {
        actionBtn = `<button class="batch-btn batch-btn-import" onclick="importBatchItem(${idx})">📝 Nhập</button>`;
      }

      const existingBadge = existing
        ? ` <span style="font-size:9px;padding:1px 6px;border-radius:4px;background:var(--warning-bg);border:1px solid var(--warning-bd);color:var(--warning);font-weight:700">Đã có</span>`
        : '';

      div.className = 'batch-item';
      div.innerHTML = `
        <img class="batch-thumb" src="${item.thumbnail}" alt="">
        <div class="batch-info">
          <div class="batch-title">
            <span class="hist-badge-tag ${typeClass}">${typeLabel}</span>
            <span>${formatDateDisplay(r.parsedDate)} ${scoreIcon}${checksumIcon}${distIcon}${cacheIcon}${existingBadge}</span>
          </div>
          <div class="batch-meta">${escapeHtml(item.file)}</div>
          <div class="batch-total">
            ${r.actualTotal} đơn
            ${r.expectedTotal !== null ? `<span style="color:var(--text-3);font-weight:500;font-size:11px"> (tổng ảnh: ${r.expectedTotal})</span>` : ''}
            <span style="color:var(--text-3);font-weight:500;font-size:11px"> · Score ${score}</span>
          </div>
        </div>
        <div class="batch-actions">
          ${actionBtn}
          <button class="batch-btn batch-btn-remove" onclick="removeBatchItem(${idx})">Bỏ</button>
        </div>`;
    }

    list.appendChild(div);
  });
}

export function removeBatchItem(idx) {
  batchResults.splice(idx, 1);
  if (batchResults.length === 0) { closeBatchOcrModal(); return; }
  renderBatchList();
}

export async function importBatchItem(idx) {
  const item = batchResults[idx];
  if (!item || item.error) return;
  const r = item.result;

  closeBatchOcrModal();

  if (!r.detectedColorType) {
    const type = await showTabPickerModal();
    if (type === null) {
      openBatchOcrModal();
      return;
    }
    r.detectedColorType = type;
    r.tabConfidence = 100;
    r.tabMethod = 'user-picker';
  }

  const type = getTypeFromResult(r);
  const existing = type ? state.appData[type].find(rec => rec.date === r.parsedDate) : null;

  if (existing) {
    await openCompareModal(item, existing);
  } else {
    fillModalFromResult(item);
  }
  showBackToBatchBtn(true);
}

export function backToBatch() {
  if (batchResults.length === 0) {
    showToast('Batch đã trống', 'warning');
    showBackToBatchBtn(false);
    return;
  }
  const entryModal = document.getElementById('entryModal');
  if (entryModal) entryModal.classList.remove('active');
  showBackToBatchBtn(false);
  openBatchOcrModal();
}

export function showBackToBatchBtn(show) {
  const btn = document.getElementById('backToBatchBtn');
  if (btn) btn.style.display = show ? 'inline-flex' : 'none';
}

export function hasBatchPending() { return batchResults.length > 0; }

// ==================== SAVE BATCH ====================
export async function saveBatchAll() {
  const valid = batchResults.filter(r => !r.error);
  if (valid.length === 0) { showToast('Không có dữ liệu hợp lệ', 'error'); return; }

  const seenInBatch = new Set();
  const dedupedBatch = [];
  let dupInBatch = 0;

  valid.forEach(item => {
    const r = item.result;
    const type = getTypeFromResult(r);
    if (!type) { dupInBatch++; return; }
    const key = type + '|' + r.parsedDate;
    if (seenInBatch.has(key)) { dupInBatch++; return; }
    seenInBatch.add(key);
    dedupedBatch.push(item);
  });

  const finalList = [];
  let dupExisting = 0;

  dedupedBatch.forEach(item => {
    const r = item.result;
    const type = getTypeFromResult(r);
    if (!type) { dupInBatch++; return; }

    if (findExactDuplicate(r)) { dupExisting++; return; }
    if (findSameDaySameType(r)) { dupExisting++; return; }

    finalList.push({ item, type, weights: buildWeights(r) });
  });

  const totalSkipped = dupInBatch + dupExisting;

  if (finalList.length === 0) {
    let msg = 'Không có gì để lưu';
    if (totalSkipped > 0) msg += ` (bỏ qua ${totalSkipped} ảnh)`;
    showToast(msg, 'warning', 2500);
    return;
  }

  const addedIds = [];
  finalList.forEach(({ item, type, weights }) => {
    const id = generateId();
    state.appData[type].unshift({ id, date: item.result.parsedDate, weights });
    addedIds.push({ type, id });
  });

  if (addedIds.length > 0) {
    const pushUndoFn = await ensurePushUndo();
    if (pushUndoFn) {
      pushUndoFn({
        msg: `OCR lưu ${addedIds.length} bản ghi`,
        restore: () => {
          addedIds.forEach(({ type, id }) => {
            state.appData[type] = state.appData[type].filter(it => it.id !== id);
          });
        }
      });
    }
  }

  batchResults = [];
  showBackToBatchBtn(false);
  closeBatchOcrModal();
  updateAllViews();

  let doneMsg = `Đã lưu ${finalList.length} bản ghi`;
  if (totalSkipped > 0) doneMsg += ` (bỏ qua ${totalSkipped} ảnh)`;
  showToast(doneMsg, 'success', 3000);
}

// ==================== HIGHLIGHT ====================
export function applyConfidenceHighlight(confMap, detectedType) {
  const prefix = detectedType === 'del'  ? 'del_inp'
               : detectedType === 'pick' ? 'pick_inp' : 'ret_inp';
  const keys = ['0_2','2_4','4_6','6_8','8_10','10_12','12_15','over_15'];

  keys.forEach(k => {
    const input = document.getElementById(prefix + '_' + k);
    if (!input) return;
    input.classList.remove('conf-high', 'conf-mid', 'conf-low');
    const parent = input.closest('.weight-input-item');
    if (parent) {
      const old = parent.querySelector('.conf-badge');
      if (old) old.remove();
    }
    if (confMap[k] == null) return;

    const conf = confMap[k];
    const level = conf >= 85 ? 'high' : conf >= 70 ? 'mid' : 'low';
    input.classList.add('conf-' + level);

    if (parent) {
      const badge = document.createElement('span');
      badge.className = 'conf-badge ' + level;
      badge.textContent = Math.round(conf) + '%';
      parent.appendChild(badge);
    }
  });
}

export function clearAllConfidenceHighlights() {
  const prefixes = ['del_inp', 'pick_inp', 'ret_inp'];
  const keys = ['0_2','2_4','4_6','6_8','8_10','10_12','12_15','over_15'];
  prefixes.forEach(pfx => keys.forEach(k => {
    const input = document.getElementById(pfx + '_' + k);
    if (!input) return;
    input.classList.remove('conf-high', 'conf-mid', 'conf-low', 'conf-suspect');
    const parent = input.closest('.weight-input-item');
    if (parent) {
      const badge = parent.querySelector('.conf-badge');
      if (badge) badge.remove();
    }
  }));
}

// ==================== LIGHTBOX ====================
export function openOcrLightbox() {
  const src = document.getElementById('ocrPreviewImg').src;
  if (!src) return;
  document.getElementById('ocrLightboxImg').src = src;
  document.getElementById('ocrLightbox').classList.add('active');
}

export function closeOcrLightbox() {
  document.getElementById('ocrLightbox').classList.remove('active');
}

// ==================== ESCAPE HTML ====================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}