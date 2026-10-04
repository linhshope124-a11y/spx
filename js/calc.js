import { TABLE_4_DATA, TABLE_5_DATA, TABLE_6_DATA, WEIGHT_KEYS } from './config.js';
import { getCurrentMonthIso, getTodayIso } from './utils.js';

export function lookupTier(orders, colIdx, tableData) {
  if (orders === 0) {
    return {
      matched: { range: "-", pt: 0, maxA: 0 },
      next:    { range: tableData[0].range, min: tableData[0].min, pt: tableData[0].pts[colIdx] },
      pct:     0
    };
  }
  let lo = 0, hi = tableData.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = tableData[mid];
    if (orders >= row.min && orders < row.max) { found = mid; break; }
    if (orders < row.min) hi = mid - 1; else lo = mid + 1;
  }
  if (found === -1) {
    const last = tableData[tableData.length - 1];
    return {
      matched: { range: last.range, pt: last.pts[colIdx], maxA: last.max },
      next:    null,
      pct:     100
    };
  }
  const row     = tableData[found];
  const nextRow = tableData[found + 1] || null;
  const span    = row.max - row.min;
  const pct     = Math.min(100, Math.round(((orders - row.min) / span) * 100));
  return {
    matched: { range: row.range, pt: row.pts[colIdx], maxA: row.max },
    next:    nextRow ? { range: nextRow.range, min: nextRow.min, pt: nextRow.pts[colIdx] } : null,
    pct
  };
}

/**
 * v46: Kiểm tra 1 ngày có thuộc kỳ đang xem hay không
 *
 * @param {string} isoDate      - "2026-10-02"
 * @param {string} periodMode   - 'month' | 'day'
 * @param {string} currentMonth - "2026-10"  (chỉ dùng khi mode='month')
 * @param {string} currentDate  - "2026-10-02" (chỉ dùng khi mode='day')
 * @returns {boolean}
 */
export function isDateInCurrentPeriod(isoDate, periodMode, currentMonth, currentDate) {
  if (!isoDate || typeof isoDate !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;

  // ===== Mode: DAY — so khớp chính xác =====
  if (periodMode === 'day') {
    const cd = currentDate || getTodayIso();
    return isoDate === cd;
  }

  // ===== Mode: MONTH (default) =====
  const cm = currentMonth || getCurrentMonthIso();
  const monthPrefix = cm + '-';
  return isoDate.startsWith(monthPrefix);
}

/**
 * v46: Aggregate weights theo kỳ đang xem
 */
export function aggregateWeights(records, periodMode, currentMonth, currentDate) {
  const agg = { del: [0,0,0,0,0,0,0,0], pick: [0,0,0,0,0,0,0,0], ret: [0,0,0,0,0,0,0,0] };
  const total = { del: 0, pick: 0, ret: 0 };

  records.delivery
    .filter(r => isDateInCurrentPeriod(r.date, periodMode, currentMonth, currentDate))
    .forEach(r => WEIGHT_KEYS.forEach((k, i) => {
      const v = parseInt(r.weights[k], 10) || 0;
      agg.del[i] += v;
      total.del += v;
    }));

  records.pickup
    .filter(r => isDateInCurrentPeriod(r.date, periodMode, currentMonth, currentDate))
    .forEach(r => WEIGHT_KEYS.forEach((k, i) => {
      const v = parseInt(r.weights[k], 10) || 0;
      agg.pick[i] += v;
      total.pick += v;
    }));

  records.return
    .filter(r => isDateInCurrentPeriod(r.date, periodMode, currentMonth, currentDate))
    .forEach(r => WEIGHT_KEYS.forEach((k, i) => {
      const v = parseInt(r.weights[k], 10) || 0;
      agg.ret[i] += v;
      total.ret += v;
    }));

  return { agg, total };
}

export function getTableFor(type) {
  if (type === 'delivery') return TABLE_5_DATA;
  if (type === 'pickup')   return TABLE_4_DATA;
  return TABLE_6_DATA;
}