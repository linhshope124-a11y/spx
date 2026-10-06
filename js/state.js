import { STORAGE_KEYS, WEIGHT_KEYS } from './config.js';
import { generateId, getCurrentMonthIso, getTodayIso } from './utils.js';

export const state = {
  appData: { delivery: [], pickup: [], return: [] },

  // v50.4: Lương theo tháng
  salaryByMonth: {},
  salaryDays: 26,

  // v50.8.0: Hạng thưởng theo tháng
  rankByMonth: {},

  region: 'mien',

  activeTab: 'overview',
  histFilter: 'all',
  overviewFilter: 'all',

  periodMode: 'month',
  currentMonth: getCurrentMonthIso(),
  currentDate: getTodayIso(),

  lastOcrImageDataUrl: '',
  isOcrScan: false
};

const SALARY_BY_MONTH_KEY = 'spx_salary_by_month';
const LEGACY_SALARY_KEY   = 'spx_manual_salary';
const LEGACY_POINTS_KEY   = 'spx_manual_points';

const RANK_BY_MONTH_KEY   = 'spx_rank_by_month';
const LEGACY_RANK_KEY     = 'spx_rank_bonus';
const LEGACY_RANK_NAME_KEY= 'spx_rank_name';

// ============ v50.8.2: SAFE PARSE ============
/**
 * Parse localStorage an toàn — không crash khi data hỏng.
 * @param {string} key - tên key trong localStorage
 * @param {*} fallback - giá trị trả về nếu parse lỗi hoặc không có
 * @returns {*}
 */
function safeParseLocalStorage(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed === null || parsed === undefined) ? fallback : parsed;
  } catch (e) {
    console.warn('[Storage] Parse lỗi key:', key, e.message);
    return fallback;
  }
}

/**
 * Lấy giá trị localStorage dạng số an toàn.
 */
function safeParseNumber(key, fallback = 0) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === '') return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Lấy string localStorage an toàn — nếu parse ra không phải string thì trả fallback.
 */
function safeParseString(key, fallback = '') {
  try {
    const raw = localStorage.getItem(key);
    return typeof raw === 'string' ? raw : fallback;
  } catch {
    return fallback;
  }
}
// ============ /SAFE PARSE ============

// ============ v50.11.5: SANITIZE WEIGHTS ============
/**
 * Chuẩn hóa object weights — đảm bảo có đủ 8 key, đều là số nguyên ≥ 0.
 * Tránh crash khi import file backup cũ thiếu key / sai type.
 *
 * @param {*} w - object weights thô từ bất kỳ nguồn nào
 * @returns {Object} object weights có đủ 8 key hợp lệ
 */
function sanitizeWeights(w) {
  const out = {};
  const safe = (w && typeof w === 'object') ? w : {};
  WEIGHT_KEYS.forEach(k => {
    const v = parseInt(safe[k], 10);
    out[k] = (Number.isFinite(v) && v > 0) ? v : 0;
  });
  return out;
}
// ============ /SANITIZE WEIGHTS ============

function sanitizeRecords(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(r =>
      r && typeof r === 'object' &&
      typeof r.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.date)
    )
    .map(r => ({
      id: Number.isFinite(r.id) ? r.id : generateId(),
      date: r.date,
      weights: sanitizeWeights(r.weights)
    }));
}

// ============ v50.4: SALARY BY MONTH ============
export function persistSalaryByMonth() {
  try {
    localStorage.setItem(SALARY_BY_MONTH_KEY, JSON.stringify(state.salaryByMonth));
  } catch (e) {
    console.warn('[Storage] Không ghi được salaryByMonth:', e);
  }
}

export function getSalaryConfig(monthIso) {
  const m = monthIso || state.currentMonth || getCurrentMonthIso();
  const cfg = state.salaryByMonth[m];
  if (cfg && typeof cfg === 'object') {
    return {
      base:   Number(cfg.base)   || 0,
      buuCuc: Number(cfg.buuCuc) || 0,
      taiXe:  Number(cfg.taiXe)  || 0
    };
  }
  return { base: 0, buuCuc: 0, taiXe: 0 };
}

export function setSalaryConfig(monthIso, config) {
  const m = monthIso || state.currentMonth || getCurrentMonthIso();
  state.salaryByMonth[m] = {
    base:   Number(config.base)   || 0,
    buuCuc: Number(config.buuCuc) || 0,
    taiXe:  Number(config.taiXe)  || 0
  };
  persistSalaryByMonth();
}

export function hasSalaryConfig(monthIso) {
  const m = monthIso || state.currentMonth || getCurrentMonthIso();
  return Boolean(state.salaryByMonth[m]);
}

function loadSalaryByMonth() {
  // 1. Thử đọc cấu trúc mới
  const parsed = safeParseLocalStorage(SALARY_BY_MONTH_KEY, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    state.salaryByMonth = parsed;
    return;
  }

  // 2. Migration từ data cũ (chạy 1 lần duy nhất)
  const oldSalary = safeParseNumber(LEGACY_SALARY_KEY, 0);
  const oldPts = safeParseLocalStorage(LEGACY_POINTS_KEY, {});
  const oldBuuCuc = Number(oldPts?.buuCuc) || 0;
  const oldTaiXe  = Number(oldPts?.taiXe)  || 0;

  if (oldSalary > 0 || oldBuuCuc > 0 || oldTaiXe > 0) {
    const m = state.currentMonth || getCurrentMonthIso();
    state.salaryByMonth = {
      [m]: { base: oldSalary, buuCuc: oldBuuCuc, taiXe: oldTaiXe }
    };
    persistSalaryByMonth();
    try {
      localStorage.removeItem(LEGACY_SALARY_KEY);
      localStorage.removeItem(LEGACY_POINTS_KEY);
    } catch {}
    console.log('[Migration] Đã chuyển config lương cũ vào tháng', m);
  }
}
// ============ /SALARY BY MONTH ============

// ============ v50.8.0: RANK BY MONTH ============
export function persistRankByMonth() {
  try {
    localStorage.setItem(RANK_BY_MONTH_KEY, JSON.stringify(state.rankByMonth));
  } catch (e) {
    console.warn('[Storage] Không ghi được rankByMonth:', e);
  }
}

export function getRankConfig(monthIso) {
  const m = monthIso || state.currentMonth || getCurrentMonthIso();
  const cfg = state.rankByMonth[m];
  if (cfg && typeof cfg === 'object' && cfg.name) {
    return {
      name:  String(cfg.name),
      bonus: Number(cfg.bonus) || 0
    };
  }
  return { name: 'none', bonus: 0 };
}

export function setRankConfig(monthIso, config) {
  const m = monthIso || state.currentMonth || getCurrentMonthIso();
  const name  = config.name || 'none';
  const bonus = Number(config.bonus) || 0;

  if (name === 'none') {
    delete state.rankByMonth[m];
  } else {
    state.rankByMonth[m] = { name, bonus };
  }
  persistRankByMonth();
}

export function hasRankConfig(monthIso) {
  const m = monthIso || state.currentMonth || getCurrentMonthIso();
  return Boolean(state.rankByMonth[m]);
}

function loadRankByMonth() {
  const parsed = safeParseLocalStorage(RANK_BY_MONTH_KEY, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    state.rankByMonth = parsed;
    return;
  }

  // Migration từ data cũ
  const oldBonus = safeParseNumber(LEGACY_RANK_KEY, 0);
  const oldName  = safeParseString(LEGACY_RANK_NAME_KEY, 'none');

  if (oldName !== 'none' && oldBonus > 0) {
    const m = state.currentMonth || getCurrentMonthIso();
    state.rankByMonth = {
      [m]: { name: oldName, bonus: oldBonus }
    };
    persistRankByMonth();
    try {
      localStorage.removeItem(LEGACY_RANK_KEY);
      localStorage.removeItem(LEGACY_RANK_NAME_KEY);
    } catch {}
    console.log('[Migration] Đã chuyển hạng thưởng cũ vào tháng', m);
  }
}
// ============ /RANK BY MONTH ============

// ============ v50.8.2: LOAD STATE (HARDENED) ============
export function loadState() {
  // 1. Load records — an toàn với data hỏng
  let d = safeParseLocalStorage(STORAGE_KEYS.records, null);

  // Nếu không có records → thử vault
  if (!d || (!d.delivery && !d.pickup && !d.return)) {
    const vaultData = safeParseLocalStorage(STORAGE_KEYS.vault, null);
    if (vaultData) {
      d = vaultData;
      console.log('[loadState] Phục hồi từ vault');
    }
  }

  // Nếu vẫn không có → khởi tạo rỗng
  if (!d || typeof d !== 'object') {
    d = { delivery: [], pickup: [], return: [] };
  }

  // Sanitize từng loại (v50.11.5: sanitize cả weights)
  state.appData = {
    delivery: sanitizeRecords(d.delivery),
    pickup:   sanitizeRecords(d.pickup),
    return:   sanitizeRecords(d.return)
  };

  // 2. Period mode
  const savedMode = safeParseString('spx_period_mode', 'month');
  state.periodMode = (savedMode === 'day' || savedMode === 'month') ? savedMode : 'month';

  // 3. currentMonth — validate format
  const savedMonth = safeParseString('spx_current_month', '');
  if (/^\d{4}-\d{2}$/.test(savedMonth)) {
    state.currentMonth = savedMonth;
  } else {
    state.currentMonth = getCurrentMonthIso();
  }

  // 4. currentDate — validate format
  const savedDate = safeParseString('spx_current_date', '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(savedDate)) {
    state.currentDate = savedDate;
  } else {
    state.currentDate = getTodayIso();
  }

  // 5. Salary config
  state.salaryDays = 26;
  loadSalaryByMonth();

  // 6. Rank config
  loadRankByMonth();

  // 7. Region
  const reg = safeParseString('spx_region', 'mien');
  state.region = (reg === 'hcm_hn' || reg === 'mien') ? reg : 'mien';
}
// ============ /LOAD STATE ============

export function persistData() {
  try {
    localStorage.setItem(STORAGE_KEYS.records, JSON.stringify(state.appData));
    const total = state.appData.delivery.length + state.appData.pickup.length + state.appData.return.length;
    if (total > 0) {
      localStorage.setItem(STORAGE_KEYS.vault, JSON.stringify(state.appData));
    }
  } catch (e) {
    console.warn('[Storage] Không ghi được records:', e);
  }
}

export function persistSettings() {
  try {
    localStorage.setItem('spx_region', state.region);
  } catch {}
}

export function persistPeriodState() {
  try {
    localStorage.setItem('spx_period_mode',  state.periodMode);
    localStorage.setItem('spx_current_month', state.currentMonth);
    localStorage.setItem('spx_current_date',  state.currentDate);
  } catch {}
}

// Backward compat
export function persistCurrentMonth() {
  persistPeriodState();
}