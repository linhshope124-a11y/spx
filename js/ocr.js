// =============================================================
// OCR ENGINE v3.0 — PART 1/3
// Config · AbortController · Worker · Cache
// =============================================================

import { state } from './state.js';
import { WEIGHT_KEYS } from './config.js';
import { getTodayIso, formatDateDisplay, generateId } from './utils.js';
import { openAddModal, openEditModal, switchModalSubTab, showToast } from './ui.js';
import { updateAllViews } from './render.js';
import { showAlert, showConfirm } from './dialog.js';

// ==================== CONFIG ====================
const OCR_CACHE_VERSION = 'v5';
const OCR_TIMEOUT_MS    = 30000;
const OCR_CACHE_MAX     = 200;
const LS_CACHE_PREFIX   = 'spx_ocr_cache_';
const LS_CACHE_INDEX    = 'spx_ocr_cache_index';
const LS_CACHE_MAX_BYTES = 4 * 1024 * 1024;

// ⚠️ TEST MODE: 999 = tắt auto-save. Đổi lại 92 khi test xong!
const SCORE_AUTO_SAVE = 999;
const SCORE_REVIEW    = 85;
const SCORE_MAX_CHECKSUM_FAIL = 84;

// v3.0 — Crop-based config
const CARD_REGION_TOP_PCT    = 0.22;
const CARD_REGION_BOTTOM_PCT = 0.92;
const CARD_NUM_CROP_X1_PCT   = 0.45;
const CARD_NUM_CROP_X2_PCT   = 0.95;
const CARD_NUM_CROP_Y1_PCT   = 0.05;
const CARD_NUM_CROP_Y2_PCT   = 0.50;
const CARD_NUM_UPSCALE       = 4;

// v3.0 — Debug log (hiện trong ocrDebugText)
let _lastCropLog = [];

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

// ==================== HASH BLOB ====================
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