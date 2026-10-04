const _nf = new Intl.NumberFormat('vi-VN');
export const _fmt = n => _nf.format(n);

// ===== generateId không bao giờ trùng, tăng dần đơn điệu =====
let _lastId = 0;
export const generateId = () => {
  const base = Date.now() * 1000;
  if (base <= _lastId) {
    _lastId += 1;
  } else {
    _lastId = base + Math.floor(Math.random() * 1000);
  }
  return _lastId;
};

export const sanitizeInt = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
export const formatPts   = n => _fmt(Math.round(n)) + ' Điểm';

export function getTodayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDateDisplay(iso) {
  if (!iso) return '';
  const p = iso.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

// ===== v42: Month picker helpers =====

/**
 * Trả về tháng hiện tại dạng ISO: "2026-10"
 */
export function getCurrentMonthIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Format tháng để hiển thị: "2026-10" → "Tháng 10/2026"
 */
export function formatMonthLabel(isoMonth) {
  if (!isoMonth || !/^\d{4}-\d{2}$/.test(isoMonth)) return '';
  const [y, m] = isoMonth.split('-');
  return `Tháng ${parseInt(m, 10)}/${y}`;
}

/**
 * So sánh 2 tháng ISO: trả về true nếu monthA >= monthB
 */
export function monthIsoGte(monthA, monthB) {
  return monthA >= monthB; // ISO format so sánh string trực tiếp được
}

export function debounce(fn, delay) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}