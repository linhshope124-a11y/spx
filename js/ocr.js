import { state } from './state.js';
import { WEIGHT_KEYS } from './config.js';
import { getTodayIso, formatDateDisplay, generateId } from './utils.js';
import { openAddModal, openEditModal, switchModalSubTab, showToast } from './ui.js';
import { updateAllViews } from './render.js';
import { showAlert, showConfirm } from './dialog.js';

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

// ==================== TESSERACT WORKER ====================
let cachedTesseractWorker = null;
let workerLoadingPromise = null;

async function getTesseractWorker() {
  if (cachedTesseractWorker) return cachedTesseractWorker;
  if (workerLoadingPromise) return workerLoadingPromise;
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
        else if (m.status === 'loading language traineddata') text = `Đang tải tiếng Việt ${Math.round((m.progress || 0) * 100)}%...`;
        else if (m.status === 'initializing api')             text = 'Đang chuẩn bị API...';
        else if (m.status === 'recognizing text')             text = `Đang nhận diện... ${Math.round((m.progress || 0) * 100)}%`;
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
  try { return await workerLoadingPromise; }
  catch (e) { workerLoadingPromise = null; throw e; }
}

export async function preloadTesseractWorker() {
  try { await getTesseractWorker(); console.log('[OCR] Worker sẵn sàng'); }
  catch (e) { console.warn('[OCR] Preload thất bại:', e); }
}

// ==================== HELPERS ====================
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
        const scale  = Math.min(1, maxW / img.width);
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

// ==================== OTSU ====================
function otsuThreshold(gray) {
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

// ==================== PREPROCESSING ====================
async function preprocessImage(rawDataUrl, options = {}) {
  const { upscale = 2.0, useOtsu = true, threshold = 145 } = options;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const scale = Math.min(4, upscale);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.floor(img.width  * scale);
        canvas.height = Math.floor(img.height * scale);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        const gray = new Uint8Array(data.length / 4);
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
          gray[j] = Math.round(data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114);
        }
        const th = useOtsu ? otsuThreshold(gray) : threshold;
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
          const val = gray[j] > th ? 255 : 0;
          data[i] = data[i+1] = data[i+2] = val;
          data[i+3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
        resolve({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = rawDataUrl;
  });
}

// ==================== PHÁT HIỆN TAB ====================
function detectActiveTabByOrangeLine(imageSource) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const scanHeight = Math.floor(img.height * 0.20);
        const imgData = ctx.getImageData(0, 0, img.width, scanHeight);
        const data = imgData.data;
        const colCount = new Array(img.width).fill(0);
        let totalOrange = 0;
        for (let y = 0; y < scanHeight; y++) {
          for (let x = 0; x < img.width; x++) {
            const idx = (y * img.width + x) * 4;
            const r = data[idx], g = data[idx+1], b = data[idx+2];
            if (r > 180 && g >= 40 && g <= 155 && b <= 90 && (r - g) > 45) { colCount[x]++; totalOrange++; }
          }
        }
        if (totalOrange < 20) { resolve(null); return; }
        const winSize = 40;
        let maxSum = 0, bestCenter = 0;
        for (let x = 0; x < img.width; x++) {
          let sum = 0;
          const l = Math.max(0, x - winSize);
          const r = Math.min(img.width - 1, x + winSize);
          for (let k = l; k <= r; k++) sum += colCount[k];
          if (sum > maxSum) { maxSum = sum; bestCenter = x; }
        }
        const rel = bestCenter / img.width;
        if (rel < 0.25) resolve('del');
        else if (rel < 0.42) resolve('pick');
        else resolve('ret');
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = imageSource;
  });
}

// ==================== OCR ====================
async function ocrRecognize(preprocessedDataUrl) {
  const worker = await getTesseractWorker();
  const result = await worker.recognize(preprocessedDataUrl);
  return result.data.text || '';
}

// ==================== RANGE DEFS ====================
const RANGE_DEFS = [
  { key: '0_2',     min: 0,  max: 2 },
  { key: '2_4',     min: 2,  max: 4 },
  { key: '4_6',     min: 4,  max: 6 },
  { key: '6_8',     min: 6,  max: 8 },
  { key: '8_10',    min: 8,  max: 10 },
  { key: '10_12',   min: 10, max: 12 },
  { key: '12_15',   min: 12, max: 15 },
  { key: 'over_15', min: 15, max: 999 }
];

function identifyRangeKey(minV, maxV) {
  for (const d of RANGE_DEFS) {
    if (d.min === minV && d.max === maxV) return d.key;
  }
  if (minV === 0)  return '0_2';
  if (minV === 2)  return '2_4';
  if (minV === 4)  return '4_6';
  if (minV === 6)  return '6_8';
  if (minV === 8)  return '8_10';
  if (minV === 10) return '10_12';
  if (minV === 12) return '12_15';
  if (minV === 15) return 'over_15';
  return null;
}

// ==================== PARSE ====================
function parseOcrText(cleanText) {
  const weights = { '0_2':0,'2_4':0,'4_6':0,'6_8':0,'8_10':0,'10_12':0,'12_15':0,'over_15':0 };
  const confidences = {};
  const text = cleanText
    .replace(/[–—]/g, '-')
    .replace(/,/g, '.')
    .replace(/¡/g, '1')
    .split('\n')
    .filter(line => !/\b\d{1,2}:\d{2}\b/.test(line))
    .join('\n');

  const totalRegex = /T[oôổ]ng\s*[:\-]?\s*(\d{1,6})/i;
  const totalMatch = text.match(totalRegex);
  let expectedTotal = totalMatch ? parseInt(totalMatch[1], 10) : null;
  if (!Number.isFinite(expectedTotal)) expectedTotal = null;

  const rangeRegex = /(\d{1,3})(?:[.,]\d{1,3})?\s*[-–~]\s*(\d{1,6})(?:[.,]\d{1,3})?/g;
  const ranges = [];
  let m;
  while ((m = rangeRegex.exec(text)) !== null) {
    const minV = parseInt(m[1], 10);
    const maxV = parseInt(m[2], 10);
    const key = identifyRangeKey(minV, maxV);
    if (key) ranges.push({ key, pos: m.index, endPos: m.index + m[0].length });
  }
  ranges.sort((a, b) => a.pos - b.pos);

  const totalPos = totalMatch ? totalMatch.index : -1;
  const totalEnd = totalMatch ? totalMatch.index + totalMatch[0].length : -1;

  const numRegex = /\d{1,6}/g;
  const nums = [];
  while ((m = numRegex.exec(text)) !== null) {
    const val = parseInt(m[0], 10);
    const pos = m.index;
    const endPos = pos + m[0].length;
    if (ranges.some(r => pos < r.endPos && endPos > r.pos)) continue;
    if (totalPos >= 0 && pos >= totalPos && pos <= totalEnd + 3) continue;
    if (val === 0) continue;
    if (val > 99999) continue;
    nums.push({ value: val, pos, endPos });
  }
  nums.sort((a, b) => a.pos - b.pos);

  function distanceMatch(mode) {
    const result = {};
    const used = new Set();
    ranges.forEach(r => {
      let best = null, bestDist = 9999;
      nums.forEach((n, idx) => {
        if (used.has(idx)) return;
        let dist;
        if (mode === 'before') {
          if (n.endPos > r.pos) return;
          dist = r.pos - n.endPos;
        } else if (mode === 'after') {
          if (n.pos < r.endPos) return;
          dist = n.pos - r.endPos;
        } else {
          dist = Math.min(
            Math.abs(n.pos - r.pos),
            Math.abs(n.endPos - r.endPos)
          );
        }
        if (dist < bestDist && dist < 800) {
          bestDist = dist;
          best = { idx, value: n.value };
        }
      });
      if (best) { result[r.key] = best.value; used.add(best.idx); }
    });
    return result;
  }

  const orderedResult = {};
  for (let i = 0; i < ranges.length && i < nums.length; i++) {
    orderedResult[ranges[i].key] = nums[i].value;
  }

  const sumOf = r => Object.values(r).reduce((a, b) => a + b, 0);
  const countOf = r => Object.keys(r).length;

  const mClosest = distanceMatch('closest');
  const mBefore  = distanceMatch('before');
  const mAfter   = distanceMatch('after');

  const candidates = [
    { name: 'ordered', res: orderedResult, cnt: countOf(orderedResult) },
    { name: 'closest', res: mClosest,      cnt: countOf(mClosest) },
    { name: 'before',  res: mBefore,       cnt: countOf(mBefore) },
    { name: 'after',   res: mAfter,        cnt: countOf(mAfter) }
  ];

  candidates.forEach(c => {
    c.diff = expectedTotal !== null ? Math.abs(sumOf(c.res) - expectedTotal) : 0;
  });
  candidates.sort((a, b) => {
    if (a.diff !== b.diff) return a.diff - b.diff;
    return b.cnt - a.cnt;
  });

  const best = candidates[0];
  let baseConf = 88;
  if (best.diff === 0) baseConf = 95;
  else if (best.diff <= 2) baseConf = 92;

  Object.keys(best.res).forEach(k => {
    weights[k] = best.res[k];
    confidences[k] = baseConf;
  });

  const totalFound = Object.values(weights).reduce((a, b) => a + b, 0);
  return { weights, confidences, expectedTotal, totalFound, mode: best.name };
}

// ==================== EXTRACT DATE ====================
function extractDate(text) {
  const cleanText = text.replace(/,/g, '.');

  const fullMatch = cleanText.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4}|\d{2})/);
  if (fullMatch) {
    const day = parseInt(fullMatch[1], 10);
    const month = parseInt(fullMatch[2], 10);
    let year = parseInt(fullMatch[3], 10);
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020 && year <= 2099) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const dayMatch = cleanText.match(/(?:ngày|ngay)\s*[-–:]?\s*(\d{1,2})[\/\-\.](\d{1,2})/i);
  if (dayMatch) {
    const day = parseInt(dayMatch[1], 10);
    const month = parseInt(dayMatch[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date().getFullYear() + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }
  }

  const allMatches = [...cleanText.matchAll(/(\d{1,2})[\/\-\.](\d{1,2})/g)];
  for (const m of allMatches) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date().getFullYear() + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }
  }

  return getTodayIso();
}

// ==================== v50.9.1: HASH BLOB (khôi phục) ====================
async function hashBlob(file) {
  try {
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-1', buf);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'fb_' + Date.now().toString(16) + '_' + file.size + '_' + (file.name || '').length;
  }
}

// ==================== CACHE 2 TẦNG (RAM + localStorage) ====================
const ocrCache = new Map();
const OCR_CACHE_MAX = 200;
const LS_CACHE_PREFIX = 'spx_ocr_cache_';
const LS_CACHE_INDEX = 'spx_ocr_cache_index';
const LS_CACHE_MAX_BYTES = 4 * 1024 * 1024;

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
  try {
    localStorage.removeItem(LS_CACHE_PREFIX + oldest);
  } catch {}
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
  if (ocrCache.has(hash)) {
    const v = ocrCache.get(hash);
    const index = readCacheIndex();
    const idx = index.indexOf(hash);
    if (idx !== -1) {
      index.splice(idx, 1);
      index.push(hash);
      writeCacheIndex(index);
    }
    return v;
  }

  try {
    const raw = localStorage.getItem(LS_CACHE_PREFIX + hash);
    if (raw) {
      const value = JSON.parse(raw);
      ocrCache.set(hash, value);

      const index = readCacheIndex();
      const idx = index.indexOf(hash);
      if (idx !== -1) {
        index.splice(idx, 1);
        index.push(hash);
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
  ocrCache.set(hash, value);

  try {
    localStorage.setItem(LS_CACHE_PREFIX + hash, JSON.stringify(value));

    const index = readCacheIndex();
    if (!index.includes(hash)) {
      index.push(hash);
      writeCacheIndex(index);
    }

    pruneCacheIfNeeded();
  } catch (e) {
    console.warn('[OCR Cache] Ghi localStorage lỗi:', e.message);
    try {
      pruneCacheIfNeeded();
      localStorage.setItem(LS_CACHE_PREFIX + hash, JSON.stringify(value));
    } catch (e2) {
      console.warn('[OCR Cache] Vẫn không ghi được:', e2.message);
    }
  }
}

// ==================== XÓA CACHE OCR (user) ====================
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
    index.forEach(hash => {
      try { localStorage.removeItem(LS_CACHE_PREFIX + hash); } catch {}
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
  const lsCount = index.length;
  const bytes = estimateLocalStorageBytes();
  return {
    ramEntries: ramCount,
    lsEntries: lsCount,
    sizeKB: Math.round(bytes / 1024),
    maxEntries: OCR_CACHE_MAX,
    maxSizeKB: Math.round(LS_CACHE_MAX_BYTES / 1024)
  };
}

// ==================== BATCH STATE ====================
let batchResults = [];
let pendingAppend = false;

// ==================== HELPERS ====================
function buildWeights(r) {
  const suffixMap = {
    '0_2':'w0_2','2_4':'w2_4','4_6':'w4_6','6_8':'w6_8',
    '8_10':'w8_10','10_12':'w10_12','12_15':'w12_15','over_15':'wover_15'
  };
  const w = {};
  WEIGHT_KEYS.forEach(wk => {
    const suffix = Object.keys(suffixMap).find(k => suffixMap[k] === wk);
    w[wk] = r.weights[suffix] || 0;
  });
  return w;
}

function getTypeFromResult(r) {
  return r.detectedColorType === 'del' ? 'delivery'
       : r.detectedColorType === 'pick' ? 'pickup' : 'return';
}

function getTypeLabel(r) {
  return r.detectedColorType === 'del' ? 'Giao'
       : r.detectedColorType === 'pick' ? 'Lấy' : 'Hoàn';
}

function findExactDuplicate(r) {
  const type = getTypeFromResult(r);
  const weights = buildWeights(r);
  return state.appData[type].find(rec =>
    rec.date === r.parsedDate &&
    WEIGHT_KEYS.every(k => (parseInt(rec.weights[k], 10) || 0) === (parseInt(weights[k], 10) || 0))
  ) || null;
}

// ==================== VALIDATE PHÂN BỐ ====================
function validateDistribution(weights) {
  const w = {
    '0_2':    parseInt(weights['0_2'], 10)   || 0,
    '2_4':    parseInt(weights['2_4'], 10)   || 0,
    '4_6':    parseInt(weights['4_6'], 10)   || 0,
    '6_8':    parseInt(weights['6_8'], 10)   || 0,
    '8_10':   parseInt(weights['8_10'], 10)  || 0,
    '10_12':  parseInt(weights['10_12'], 10) || 0,
    '12_15':  parseInt(weights['12_15'], 10) || 0,
    'over_15':parseInt(weights['over_15'], 10)|| 0
  };
  const total = Object.values(w).reduce((s, v) => s + v, 0);
  if (total < 5) return { ok: true, warnings: [], suspectKeys: [] };

  const warnings = [];
  const suspects = new Set();

  if (w['0_2'] / total < 0.5) {
    warnings.push(`Dải 0-2 chỉ ${Math.round(w['0_2']/total*100)}% (thường ≥50%)`);
    suspects.add('0_2');
  }
  if (w['2_4'] >= 10 && w['0_2'] < w['2_4'] * 0.33) {
    warnings.push('Dải 2-4 nhiều bất thường so với dải 0-2');
    suspects.add('0_2'); suspects.add('2_4');
  }
  if (w['4_6'] >= 5 && w['2_4'] < w['4_6'] * 0.33) {
    warnings.push('Dải 4-6 nhiều bất thường so với dải 2-4');
    suspects.add('2_4'); suspects.add('4_6');
  }
  const maxKey = Object.keys(w).reduce((a, b) => w[a] > w[b] ? a : b);
  if (w['0_2'] > 0 && w[maxKey] > w['0_2'] * 5) {
    warnings.push('Có dải cao bất thường');
    suspects.add(maxKey);
  }
  const small = w['0_2'] + w['2_4'] + w['4_6'];
  if (small / total < 0.7) {
    warnings.push(`Dải nhỏ chỉ ${Math.round(small/total*100)}% (thường ≥70%)`);
    suspects.add('0_2'); suspects.add('2_4'); suspects.add('4_6');
  }

  return { ok: warnings.length === 0, warnings, suspectKeys: [...suspects] };
}

// ==================== AUTO-SAVE + UNDO ====================
async function tryAutoSave(r) {
  const confs = Object.values(r.confidences).filter(c => c != null);
  if (confs.length === 0) return false;
  const allHigh = confs.every(c => c >= 85);
  if (!allHigh) return false;

  if (r.expectedTotal !== null && r.expectedTotal !== r.totalFound) return false;
  if (r.totalFound <= 0) return false;

  const dist = validateDistribution(r.weights);
  if (!dist.ok) return false;

  const type = getTypeFromResult(r);
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

// ==================== MAIN ====================
export async function handleOcrImage(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (files.length === 0) { pendingAppend = false; return; }

  const wasAppend = pendingAppend;
  pendingAppend = false;

  const overlay = document.getElementById('ocrLoadingOverlay');
  overlay.style.display = 'flex';

  try {
    const newResults = await processFiles(files);
    overlay.style.display = 'none';

    const autoSaved = [];
    const duplicates = [];
    const needAttention = [];

    for (const item of newResults) {
      if (item.error) {
        needAttention.push(item);
        continue;
      }
      const r = item.result;

      if (findExactDuplicate(r)) {
        duplicates.push(item);
        continue;
      }

      if (await tryAutoSave(r)) {
        autoSaved.push(item);
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
        const item = newResults[0];
        if (item.error) {
          showToast('Không đọc được ảnh: ' + item.error, 'error', 3000);
          return;
        }
        fillModalFromResult(item);
        return;
      }

      batchResults = needAttention;
      openBatchOcrModal();
      showSummaryToast(autoSaved.length, duplicates.length, needAttention.length, 400);
      return;
    }

    if (files.length === 1) {
      const item = newResults[0];
      const r = item.result;
      if (duplicates.length === 1) {
        showToast(
          `Ảnh đã tồn tại — ${getTypeLabel(r)} ${formatDateDisplay(r.parsedDate)}: ${r.totalFound} đơn`,
          'warning', 2500
        );
        return;
      }
      return;
    }

    if (autoSaved.length > 0 || duplicates.length > 0) {
      showSummaryToast(autoSaved.length, duplicates.length, 0);
    }
  } catch (err) {
    console.error(err);
    overlay.style.display = 'none';
    showToast('Lỗi khi quét ảnh', 'error', 3000);
  }
}

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

async function processFiles(files) {
  const out = [];
  const statusTitle = document.getElementById('ocrStatusTitle');
  const statusDesc  = document.getElementById('ocrStatusDesc');
  statusTitle.innerText = 'Đang khởi tạo...';
  statusDesc.innerText  = cachedTesseractWorker ? 'Worker sẵn sàng' : 'Lần đầu tải ~15MB...';

  await getTesseractWorker();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    statusTitle.innerText = `Ảnh ${i + 1}/${files.length}`;
    statusDesc.innerText  = 'Đang đọc file...';

    try {
      const hash = await hashBlob(file);
      const cached = cacheGet(hash);

      if (cached) {
        statusDesc.innerText = '⚡ Dùng cache...';
        const rawDataUrl = await readFileAsDataURL(file);
        const cachedResult = { ...cached.result, fullDataUrl: rawDataUrl };
        out.push({ file: file.name, thumbnail: cached.thumbnail, result: cachedResult, error: null, fromCache: true });
        continue;
      }

      statusDesc.innerText = 'Đang đọc file...';
      const rawDataUrl = await readFileAsDataURL(file);

      statusDesc.innerText = 'Xử lý ảnh...';
      const thumbnail = await makeThumbnail(rawDataUrl, 96);

      statusDesc.innerText = 'Xác định tab...';
      const detectedType = await detectActiveTabByOrangeLine(rawDataUrl);

      statusDesc.innerText = 'Quét lần 1...';
      const pre1 = await preprocessImage(rawDataUrl, { upscale: 2.0, useOtsu: true });
      const text1 = await ocrRecognize(pre1.dataUrl);
      const parsed1 = parseOcrText(text1);

      let bestResult = parsed1;
      let bestText = text1;
      let bestDiff = parsed1.expectedTotal !== null ? Math.abs(parsed1.totalFound - parsed1.expectedTotal) : 9999;

      if (bestDiff > 0) {
        statusDesc.innerText = 'Quét lần 2...';
        const pre2 = await preprocessImage(rawDataUrl, { upscale: 2.0, useOtsu: false, threshold: 130 });
        const text2 = await ocrRecognize(pre2.dataUrl);
        const parsed2 = parseOcrText(text2);
        const diff2 = parsed2.expectedTotal !== null ? Math.abs(parsed2.totalFound - parsed2.expectedTotal) : 9999;
        if (diff2 < bestDiff) { bestResult = parsed2; bestText = text2; bestDiff = diff2; }
      }

      if (bestDiff > 0) {
        statusDesc.innerText = 'Quét lần 3...';
        const pre3 = await preprocessImage(rawDataUrl, { upscale: 2.5, useOtsu: false, threshold: 160 });
        const text3 = await ocrRecognize(pre3.dataUrl);
        const parsed3 = parseOcrText(text3);
        const diff3 = parsed3.expectedTotal !== null ? Math.abs(parsed3.totalFound - parsed3.expectedTotal) : 9999;
        if (diff3 < bestDiff) { bestResult = parsed3; bestText = text3; bestDiff = diff3; }
      }

      const result = {
        detectedColorType: detectedType || 'del',
        parsedDate: extractDate(bestText),
        weights: bestResult.weights,
        confidences: bestResult.confidences,
        expectedTotal: bestResult.expectedTotal,
        totalFound: bestResult.totalFound,
        mode: bestResult.mode,
        rawText: bestText,
        fullDataUrl: rawDataUrl
      };

      out.push({ file: file.name, thumbnail, result, error: null });
      cacheSet(hash, { thumbnail, result: { ...result, fullDataUrl: '' } });
    } catch (err) {
      console.error('[OCR]', file.name, err);
      out.push({ file: file.name, thumbnail: '', result: null, error: err.message });
    }
  }
  return out;
}

// ==================== FILL MODAL ====================
export function fillModalFromResult(batchItem) {
  const r = batchItem.result;
  state.lastOcrImageDataUrl = r.fullDataUrl || '';
  state.isOcrScan = true;

  const distCheck = validateDistribution(r.weights);

  const debugEl = document.getElementById('ocrDebugText');
  if (debugEl) {
    const modeStr = r.mode ? `[mode: ${r.mode}]` : '';
    debugEl.innerText = `${modeStr}\n\n${r.rawText || '(không có text)'}`;
    debugEl.style.display = 'none';
    const toggleBtn = document.getElementById('ocrDebugToggle');
    if (toggleBtn) toggleBtn.innerText = 'Xem log';
  }

  openAddModal();
  document.getElementById('inputDate').value = r.parsedDate;
  switchModalSubTab(r.detectedColorType);

  const prefix = r.detectedColorType === 'del' ? 'del_inp'
               : r.detectedColorType === 'pick' ? 'pick_inp'
               : 'ret_inp';
  Object.keys(r.weights).forEach(k => {
    const el = document.getElementById(prefix + '_' + k);
    if (el) el.value = r.weights[k];
  });

  applyConfidenceHighlight(r.confidences, r.detectedColorType);

  const typeText = getTypeLabel(r);

  let msg = `${typeText} ${formatDateDisplay(r.parsedDate)} · ${r.totalFound} đơn`;

  if (r.expectedTotal !== null && r.totalFound !== r.expectedTotal) {
    msg += ` · lệch ${Math.abs(r.expectedTotal - r.totalFound)}`;
  }

  let lowCount = 0, midCount = 0;
  Object.values(r.confidences).forEach(c => {
    if (c == null) return;
    if (c < 70) lowCount++;
    else if (c < 85) midCount++;
  });

  let toastType = 'success';
  if (lowCount > 0) { msg += ' · có dải đỏ'; toastType = 'error'; }
  else if (midCount > 0) { msg += ' · có dải vàng'; toastType = 'warning'; }
  if (!distCheck.ok) { msg += ' · ⚠️ phân bố bất thường'; toastType = 'error'; }

  if (!distCheck.ok) {
    showDistributionWarning(distCheck, r.detectedColorType);
  }

  showToast(msg + ' — kiểm tra và lưu', toastType, 3500);
}

function showDistributionWarning(distCheck, detectedType) {
  const old = document.getElementById('distWarningBanner');
  if (old) old.remove();

  const prefix = detectedType === 'del' ? 'del_inp'
               : detectedType === 'pick' ? 'pick_inp' : 'ret_inp';

  const suffixMap = {
    '0_2':'0_2','2_4':'2_4','4_6':'4_6','6_8':'6_8',
    '8_10':'8_10','10_12':'10_12','12_15':'12_15','over_15':'over_15'
  };
  distCheck.suspectKeys.forEach(k => {
    const inp = document.getElementById(prefix + '_' + suffixMap[k]);
    if (!inp) return;
    inp.classList.add('conf-suspect');
  });

  const banner = document.createElement('div');
  banner.id = 'distWarningBanner';
  banner.className = 'dist-warning-banner';
  banner.innerHTML = `
    <div class="dist-warning-title">⚠️ Phân bố bất thường</div>
    <ul class="dist-warning-list">
      ${distCheck.warnings.map(w => `<li>${w}</li>`).join('')}
    </ul>
    <div class="dist-warning-hint">Đối chiếu với ảnh gốc bên dưới trước khi lưu</div>
  `;

  const tabs = document.getElementById('modalSubTabGroup');
  if (tabs && tabs.parentNode) {
    tabs.parentNode.insertBefore(banner, tabs);
  }
}

// ==================== COMPARE ====================
function buildCompareText(ocrW, existingW) {
  const suffixToWeight = {
    '0_2':'w0_2','2_4':'w2_4','4_6':'w4_6','6_8':'w6_8',
    '8_10':'w8_10','10_12':'w10_12','12_15':'w12_15','over_15':'wover_15'
  };
  const labels = {
    '0_2':'>0-2kg','2_4':'>2-4','4_6':'>4-6','6_8':'>6-8',
    '8_10':'>8-10','10_12':'>10-12','12_15':'>12-15','over_15':'>15'
  };
  let diffs = [];
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

  openEditModal(type, existingRecord.id);

  setTimeout(async () => {
    const previewBox = document.getElementById('ocrPreviewBox');
    const previewImg = document.getElementById('ocrPreviewImg');
    if (previewBox && previewImg && r.fullDataUrl) {
      previewImg.src = r.fullDataUrl;
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
  const typeMap = { del: ['Giao', 'tag-delivery'], pick: ['Lấy', 'tag-pickup'], ret: ['Hoàn', 'tag-return'] };
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
      const [typeLabel, typeClass] = typeMap[r.detectedColorType];
      let lowCount = 0, midCount = 0;
      Object.values(r.confidences).forEach(c => {
        if (c == null) return;
        if (c < 70) lowCount++;
        else if (c < 85) midCount++;
      });
      const distCheck = validateDistribution(r.weights);
      const confIcon  = lowCount > 0 ? ' 🔴' : midCount > 0 ? ' 🟡' : ' 🟢';
      const warnIcon  = (r.expectedTotal !== null && r.totalFound !== r.expectedTotal) ? ' ⚠️' : '';
      const distIcon  = !distCheck.ok ? ' 🟠' : '';
      const cacheIcon = item.fromCache ? ' ⚡' : '';
      const type = getTypeFromResult(r);
      const existing = state.appData[type].find(rec => rec.date === r.parsedDate);
      const actionBtn = existing
        ? `<button class="batch-btn batch-btn-compare" onclick="importBatchItem(${idx})">🔍 So sánh</button>`
        : `<button class="batch-btn batch-btn-import" onclick="importBatchItem(${idx})">📝 Nhập</button>`;
      const existingBadge = existing
        ? ` <span style="font-size:9px;padding:1px 6px;border-radius:4px;background:var(--warning-bg);border:1px solid var(--warning-bd);color:var(--warning);font-weight:700">Đã có</span>`
        : '';
      div.className = 'batch-item';
      div.innerHTML = `
        <img class="batch-thumb" src="${item.thumbnail}" alt="">
        <div class="batch-info">
          <div class="batch-title">
            <span class="hist-badge-tag ${typeClass}">${typeLabel}</span>
            <span>${formatDateDisplay(r.parsedDate)}${confIcon}${warnIcon}${distIcon}${cacheIcon}${existingBadge}</span>
          </div>
          <div class="batch-meta">${escapeHtml(item.file)}</div>
          <div class="batch-total">${r.totalFound} đơn</div>
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

export function importBatchItem(idx) {
  const item = batchResults[idx];
  if (!item || item.error) return;
  const r = item.result;
  const type = getTypeFromResult(r);
  const existing = state.appData[type].find(rec => rec.date === r.parsedDate);
  closeBatchOcrModal();
  if (existing) openCompareModal(item, existing);
  else fillModalFromResult(item);
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
    const key = getTypeFromResult(r) + '|' + r.parsedDate;
    if (seenInBatch.has(key)) { dupInBatch++; return; }
    seenInBatch.add(key);
    dedupedBatch.push(item);
  });

  const finalList = [];
  let dupExisting = 0;
  let suspectSkipped = 0;
  dedupedBatch.forEach(item => {
    const r = item.result;
    const type = getTypeFromResult(r);
    const existing = state.appData[type].find(rec => rec.date === r.parsedDate);
    if (existing) { dupExisting++; return; }

    const dist = validateDistribution(r.weights);
    if (!dist.ok) { suspectSkipped++; return; }

    finalList.push({ item, type, weights: buildWeights(r) });
  });

  const totalSkipped = dupInBatch + dupExisting + suspectSkipped;

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
  if (suspectSkipped > 0) doneMsg += ` · ⚠️ ${suspectSkipped} nghi ngờ`;
  showToast(doneMsg, 'success', 3000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

// ==================== HIGHLIGHT ====================
export function applyConfidenceHighlight(confMap, detectedType) {
  const prefix = detectedType === 'del' ? 'del_inp'
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