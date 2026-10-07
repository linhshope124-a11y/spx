import { state, persistData, getSalaryConfig, hasSalaryConfig, getRankConfig } from './state.js';
import { WEIGHT_LABELS, WEIGHT_KEYS, TABLE_4_DATA, TABLE_5_DATA, TABLE_6_DATA } from './config.js';
import { lookupTier, aggregateWeights, isDateInCurrentPeriod } from './calc.js';
import { formatPts, formatDateDisplay, _fmt, getCurrentMonthIso, getTodayIso } from './utils.js';

const NEED_HIGHLIGHT = 'color:#dc2626;font-size:1.35em;font-weight:900;letter-spacing:0.5px;';
const TOP_OVERVIEW_COUNT = 4;

// Dải nặng — ẩn gợi ý khi đã có ≥1 đơn
const HEAVY_WEIGHT_KEYS = ['10_12', '12_15', 'over_15'];
const SUFFIX_BY_COL = ['0_2', '2_4', '4_6', '6_8', '8_10', '10_12', '12_15', 'over_15'];

// ============ v50.11.11: Hash check throttle ============
let _lastDataHash = null;
let _lastHashCheckTime = 0;
const HASH_CHECK_INTERVAL_MS = 500;

function _checkDataChanged() {
  const now = Date.now();
  if (now - _lastHashCheckTime < HASH_CHECK_INTERVAL_MS) return;
  _lastHashCheckTime = now;

  let currentHash;
  try {
    currentHash = JSON.stringify(state.appData);
  } catch {
    return;
  }

  if (_lastDataHash === null) {
    _lastDataHash = currentHash;
  } else if (currentHash !== _lastDataHash) {
    _lastDataHash = currentHash;
    window.dispatchEvent(new CustomEvent('spx:datachanged'));
  }
}

// ============ v50.11.11: All opportunities modal state ============
let _allOppFilter = 'del';
let _allOppCache = [];

// ============ v50.11.11: History filters (đơn giản hóa) ============
// Chỉ còn: { date, types }
// - date: 'YYYY-MM-DD' hoặc null (null = theo tháng đang xem)
// - types: { delivery, pickup, return }
const DEFAULT_HIST_FILTERS = {
  date: null,
  types: { delivery: true, pickup: true, return: true }
};

let _histFilters = {
  date: null,
  types: { ...DEFAULT_HIST_FILTERS.types }
};

export function getHistFilters() {
  return {
    date: _histFilters.date,
    types: { ..._histFilters.types }
  };
}

export function setHistFilters(partial) {
  if (!partial || typeof partial !== 'object') return;

  if ('date' in partial) {
    const d = partial.date;
    _histFilters.date = (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? d : null;
  }
  if ('types' in partial && partial.types) {
    _histFilters.types = {
      delivery: partial.types.delivery !== false,
      pickup:   partial.types.pickup   !== false,
      return:   partial.types.return   !== false
    };
  }
}

export function resetHistFilters() {
  _histFilters = {
    date: null,
    types: { ...DEFAULT_HIST_FILTERS.types }
  };
}

export function hasActiveHistFilters() {
  if (_histFilters.date) return true;
  const t = _histFilters.types;
  if (!t.delivery || !t.pickup || !t.return) return true;
  return false;
}

/**
 * Filter 1 record theo state hiện tại.
 * - Nếu có `date` → chỉ khớp ngày đó.
 * - Nếu không → khớp period đang xem (tháng).
 */
function recordPassesHistoryFilter(r, type) {
  if (!_histFilters.types[type]) return false;

  if (_histFilters.date) {
    return r.date === _histFilters.date;
  }
  return isDateInCurrentPeriod(r.date, state.periodMode, state.currentMonth, state.currentDate);
}
// ============ /History filters ============


// ==================== REMINDER BANNER ====================
function computeMissedDays() {
  const allDates = [
    ...state.appData.delivery.map(r => r.date),
    ...state.appData.pickup.map(r => r.date),
    ...state.appData.return.map(r => r.date)
  ].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));

  if (allDates.length === 0) return { count: 0, dates: [] };

  allDates.sort();
  const lastDate = allDates[allDates.length - 1];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const last = new Date(lastDate + 'T00:00:00');
  if (last >= yesterday) return { count: 0, dates: [] };

  const missed = [];
  const cursor = new Date(last);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= yesterday) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;
    missed.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }

  return { count: missed.length, dates: missed };
}

function formatMissedDate(iso) {
  const p = iso.split('-');
  return `${p[2]}/${p[1]}`;
}

export function renderReminderBanner() {
  const banner = document.getElementById('reminderBanner');
  if (!banner) return;

  const { count, dates } = computeMissedDays();

  if (count === 0) {
    banner.style.display = 'none';
    return;
  }

  const todayIso = getTodayIso();
  const dismissed = localStorage.getItem('spx_reminder_dismissed') || '';
  if (dismissed === todayIso) {
    banner.style.display = 'none';
    return;
  }

  let stateClass = 'reminder-state-1';
  let icon = '⚠️';
  if (count >= 5) { stateClass = 'reminder-state-3'; icon = '🔴'; }
  else if (count >= 3) { stateClass = 'reminder-state-2'; }

  banner.className = 'reminder-banner ' + stateClass;

  const iconEl = document.getElementById('reminderIcon');
  const titleEl = document.getElementById('reminderTitle');
  const subEl = document.getElementById('reminderSub');
  const secondaryBtn = document.getElementById('reminderSecondaryBtn');

  if (iconEl) iconEl.innerText = icon;

  if (titleEl) {
    if (count === 1) {
      titleEl.innerText = `Chưa quét ngày ${formatMissedDate(dates[0])}`;
    } else {
      titleEl.innerText = `Chưa quét ${count} ngày`;
    }
  }

  if (subEl) {
    if (count === 1) {
      subEl.innerText = '';
    } else if (count <= 4) {
      subEl.innerText = dates.map(formatMissedDate).join(' · ');
    } else {
      subEl.innerText = `Từ ${formatMissedDate(dates[0])} đến ${formatMissedDate(dates[dates.length-1])}`;
    }
  }

  if (secondaryBtn) {
    secondaryBtn.style.display = count >= 5 ? 'inline-flex' : 'none';
  }

  banner.style.display = 'block';
}

export function dismissReminderBanner() {
  const todayIso = getTodayIso();
  try { localStorage.setItem('spx_reminder_dismissed', todayIso); } catch {}
  const banner = document.getElementById('reminderBanner');
  if (banner) banner.style.display = 'none';
}

// ==================== HELPERS ====================
function getRegionThresholds(region) {
  if (region === 'hcm_hn') return { full: 80, half: 40 };
  return { full: 60, half: 30 };
}

function getSalaryDaysForPeriod() {
  const monthStr = state.currentMonth || getCurrentMonthIso();
  const month = parseInt(monthStr.split('-')[1], 10);
  return month === 2 ? 24 : 26;
}

function getWorkDaysByPeriod() {
  const dailyByType = {};
  ['delivery', 'pickup', 'return'].forEach(type => {
    const key = type === 'delivery' ? 'del' : type === 'pickup' ? 'pick' : 'ret';
    state.appData[type].forEach(r => {
      if (!isDateInCurrentPeriod(r.date, state.periodMode, state.currentMonth, state.currentDate)) return;
      if (!dailyByType[r.date]) dailyByType[r.date] = { del: 0, pick: 0, ret: 0 };
      const dayTotal = WEIGHT_KEYS.reduce(
        (sum, k) => sum + (parseInt(r.weights[k], 10) || 0), 0
      );
      dailyByType[r.date][key] += dayTotal;
    });
  });

  const { full, half } = getRegionThresholds(state.region);
  let workDays = 0;
  Object.values(dailyByType).forEach(({ del, pick, ret }) => {
    const converted = del + (pick / 6) + ret;
    if (converted >= full)      workDays += 1;
    else if (converted >= half) workDays += 0.5;
  });
  return workDays;
}

function updateHeroContextLabel() {
  const el = document.getElementById('heroContext');
  if (!el) return;
  const cm = state.currentMonth || getCurrentMonthIso();
  const [y, m] = cm.split('-');
  el.innerText = `Tháng ${parseInt(m, 10)}/${y}`;
}

// ==================== TÀI XẾ CONDITION BANNER ====================
const TAIXE_ORDER_THRESHOLD = 1500;

function renderTaiXeConditionBanner(delOrders, taiXeAmount) {
  const banner = document.getElementById('taixeConditionBanner');
  if (!banner) return;

  const amt = Number(taiXeAmount) || 0;
  if (amt === 0) {
    banner.style.display = 'none';
    return;
  }

  const orders = Number(delOrders) || 0;
  const isMet = orders >= TAIXE_ORDER_THRESHOLD;
  const pct = Math.min(100, (orders / TAIXE_ORDER_THRESHOLD) * 100);
  const pctStr = pct.toFixed(1);

  banner.className = 'taixe-condition-banner ' + (isMet ? 'taixe-state-success' : 'taixe-state-warning');

  const icon = document.getElementById('taixeBannerIcon');
  const title = document.getElementById('taixeBannerTitle');
  const progressText = document.getElementById('taixeProgressText');
  const progressFill = document.getElementById('taixeProgressFill');
  const sub = document.getElementById('taixeBannerSub');

  if (icon) icon.innerText = isMet ? '✅' : '⚠️';
  if (title) title.innerText = isMet
    ? 'Đã đủ điều kiện cộng Tài xế'
    : 'Chưa đủ điều kiện cộng Tài xế';

  if (progressText) {
    progressText.innerText = `Đơn Giao: ${_fmt(orders)}/${_fmt(TAIXE_ORDER_THRESHOLD)}`;
  }
  if (progressFill) {
    progressFill.style.width = pct + '%';
  }
  if (sub) {
    if (isMet) {
      sub.innerText = `${pctStr}% — sẽ cộng ${_fmt(amt)}đ vào lương tháng này`;
    } else {
      const missing = TAIXE_ORDER_THRESHOLD - orders;
      sub.innerText = `Còn thiếu ${_fmt(missing)} đơn — chưa cộng Tài xế`;
    }
  }

  banner.style.display = 'block';
}
// ==================== /TÀI XẾ CONDITION BANNER ====================


// ==================== RENDER ROWS & SUGGESTIONS ====================
function renderRow(weightLabel, orders, tier, typeClass) {
  const shortLabel = weightLabel.replace(/\s+/g, '').replace('kg', '');

  const ptsText = tier.matched.pt === 0
    ? '<span class="zero-dash">—</span>'
    : _fmt(tier.matched.pt);

  let needText, gainText;

  if (orders <= 0) {
    needText = '<span class="zero-dash">—</span>';
    gainText = '<span class="zero-dash">—</span>';
  } else if (!tier.next || !isFinite(tier.matched.maxA)) {
    needText = '<span class="max-tag">MAX</span>';
    gainText = '<span class="zero-dash">—</span>';
  } else {
    const need = tier.matched.maxA - orders;
    const gain = tier.next.pt - tier.matched.pt;
    needText = `<span class="need-num">+${_fmt(need)}</span>`;
    gainText = `<span class="gain-num">+${_fmt(gain)}</span><span class="gain-unit"> điểm</span>`;
  }

  return `<td class="weight-name">${shortLabel}</td>
    <td class="order-num ${typeClass} ${orders === 0 ? 'zero' : ''}">${_fmt(orders)}</td>
    <td class="range-cell">${tier.matched.range}</td>
    <td class="points-badge ${orders === 0 ? 'zero' : ''}">${ptsText}</td>
    <td class="next-cell need-cell">${needText}</td>
    <td class="next-cell gain-cell">${gainText}</td>`;
}

function buildOverviewSuggestion(type, label, orders, tier, weightKey) {
  const isZero = orders === 0;

  // Lấy/Hoàn: không hiện dải 0 đơn
  if (isZero && type !== 'del') return null;

  // Dải nặng có ≥1 đơn → ẩn (cả 3 loại)
  if (!isZero && HEAVY_WEIGHT_KEYS.includes(weightKey)) return null;

  // Không có mốc tiếp → ẩn
  if (!tier.next || !isFinite(tier.matched.maxA)) return null;

  const need = isZero
    ? (tier.next.min || 1)
    : (tier.matched.maxA - orders);
  const gain = isZero
    ? tier.next.pt
    : (tier.next.pt - tier.matched.pt);

  const hasPoint = orders > 0 && tier.matched.pt > 0;

  const badge = type === 'del' ? 'G' : type === 'pick' ? 'L' : 'H';
  const cls   = type === 'del' ? 'sugg-del'  : type === 'pick' ? 'sugg-pick'  : 'sugg-ret';
  const bcls  = type === 'del' ? 'sugg-type-del' : type === 'pick' ? 'sugg-type-pick' : 'sugg-type-ret';

  const html = `<div class="suggestion-item ${cls}">
    <div class="sugg-left"><h4><span class="sugg-type-badge ${bcls}">${badge}</span> ${label} · ${_fmt(orders)} đơn</h4>
    <p>Thêm <b style="${NEED_HIGHLIGHT}">+${_fmt(need)}</b> đơn đạt ${tier.next.range}</p></div>
    <div class="sugg-points">+${formatPts(gain)}</div>
  </div>`;

  return { type, need, gain, hasPoint, weightKey, html };
}

function renderOverviewSuggestions(sorted) {
  const ovBox = document.getElementById('overviewMilestoneList');
  const btnViewAll = document.getElementById('viewAllOpportunitiesBtn');

  if (!ovBox) return;

  if (sorted.length === 0) {
    ovBox.innerHTML = `<div style="font-size:11.5px;color:var(--text-3);text-align:center;padding:16px">Không có cơ hội tăng điểm nào trong kỳ này</div>`;
    if (btnViewAll) btnViewAll.style.display = 'none';
    return;
  }

  const top = sorted.slice(0, TOP_OVERVIEW_COUNT);
  ovBox.innerHTML = top.map(o => o.html).join('');

  if (btnViewAll) {
    btnViewAll.style.display = sorted.length > TOP_OVERVIEW_COUNT ? 'flex' : 'none';
  }
}

// ==================== ALL OPPORTUNITIES MODAL ====================
export function renderAllOpportunitiesList() {
  const box = document.getElementById('allOpportunitiesList');
  if (!box) return;

  const filtered = _allOppCache.filter(o => o.type === _allOppFilter);
  if (filtered.length === 0) {
    const label = _allOppFilter === 'del' ? 'Giao' : _allOppFilter === 'pick' ? 'Lấy' : 'Hoàn';
    box.innerHTML = `<div style="font-size:12px;color:var(--text-3);text-align:center;padding:24px 16px">Không có cơ hội tăng điểm cho loại ${label}</div>`;
    return;
  }
  box.innerHTML = filtered.map(o => o.html).join('');
}

export function setAllOppFilter(filter, btn) {
  const valid = ['del', 'pick', 'ret'];
  _allOppFilter = valid.includes(filter) ? filter : 'del';

  const bar = btn?.closest('.filter-bar');
  if (bar) {
    bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }

  renderAllOpportunitiesList();
}

export function getAllOppFilter() {
  return _allOppFilter;
}


// ==================== UPDATE ALL VIEWS ====================
function _updateAllViews() {
  const { agg, total } = aggregateWeights(
    state.appData,
    state.periodMode,
    state.currentMonth,
    state.currentDate
  );

  const delTbody  = document.getElementById('delTableBody');  delTbody.innerHTML = '';
  const pickTbody = document.getElementById('pickTableBody'); pickTbody.innerHTML = '';
  const retTbody  = document.getElementById('retTableBody');  retTbody.innerHTML = '';

  const ovSuggBuf = [];
  let delPts = 0, pickPts = 0, retPts = 0;

  for (let col = 0; col < 8; col++) {
    const dOrders = agg.del[col], pOrders = agg.pick[col], rOrders = agg.ret[col];
    const dTier = lookupTier(dOrders, col, TABLE_5_DATA);
    const pTier = lookupTier(pOrders, col, TABLE_4_DATA);
    const rTier = lookupTier(rOrders, col, TABLE_6_DATA);
    delPts  += dTier.matched.pt;
    pickPts += pTier.matched.pt;
    retPts  += rTier.matched.pt;

    delTbody.insertAdjacentHTML('beforeend',  `<tr>${renderRow(WEIGHT_LABELS[col], dOrders, dTier, 'delivery-num')}</tr>`);
    pickTbody.insertAdjacentHTML('beforeend', `<tr>${renderRow(WEIGHT_LABELS[col], pOrders, pTier, 'pickup-num')}</tr>`);
    retTbody.insertAdjacentHTML('beforeend',  `<tr>${renderRow(WEIGHT_LABELS[col], rOrders, rTier, 'return-num')}</tr>`);

    const wKey = SUFFIX_BY_COL[col];

    const o1 = buildOverviewSuggestion('del',  WEIGHT_LABELS[col], dOrders, dTier, wKey); if (o1) ovSuggBuf.push(o1);
    const o2 = buildOverviewSuggestion('pick', WEIGHT_LABELS[col], pOrders, pTier, wKey); if (o2) ovSuggBuf.push(o2);
    const o3 = buildOverviewSuggestion('ret',  WEIGHT_LABELS[col], rOrders, rTier, wKey); if (o3) ovSuggBuf.push(o3);
  }

  // Sort 3 tầng
  ovSuggBuf.sort((a, b) => {
    if (a.hasPoint !== b.hasPoint) return a.hasPoint ? 1 : -1;

    if (!a.hasPoint && !b.hasPoint) {
      if (a.gain !== b.gain) return b.gain - a.gain;
      if (a.need !== b.need) return a.need - b.need;
      return 0;
    }

    if (a.need !== b.need) return a.need - b.need;
    if (a.gain !== b.gain) return b.gain - a.gain;
    return 0;
  });

  _allOppCache = ovSuggBuf;

  if (total.del + total.pick + total.ret === 0) {
    const ovBox = document.getElementById('overviewMilestoneList');
    const btnViewAll = document.getElementById('viewAllOpportunitiesBtn');
    if (ovBox) {
      ovBox.innerHTML = `<div style="font-size:11.5px;color:var(--text-3);text-align:center;padding:16px">Chưa có dữ liệu kỳ này. Bấm menu → Nhập sản lượng để bắt đầu.</div>`;
    }
    if (btnViewAll) btnViewAll.style.display = 'none';
  } else {
    renderOverviewSuggestions(ovSuggBuf);
  }

  const rawBase = delPts + pickPts + retPts;

  const rankCfg   = getRankConfig(state.currentMonth);
  const rankBonus = Math.round(rawBase * rankCfg.bonus);

  const salaryDays  = getSalaryDaysForPeriod();
  const workDays    = getWorkDaysByPeriod();
  const displayDays = Math.min(workDays, salaryDays);

  const salaryCfg    = getSalaryConfig(state.currentMonth);
  const salaryBase   = salaryCfg.base;
  const manualBuuCuc = salaryCfg.buuCuc;
  const manualTaiXe  = salaryCfg.taiXe;

  const delOrders = total.del;
  let monthlyTotal = salaryBase + manualBuuCuc;
  if (delOrders >= TAIXE_ORDER_THRESHOLD) {
    monthlyTotal += manualTaiXe;
  }

  const perDay = salaryDays > 0 ? monthlyTotal / salaryDays : 0;
  const incomeAccumulated = Math.round(perDay * displayDays);

  const finalTotal  = rawBase + rankBonus + incomeAccumulated;
  const totalOrders = total.del + total.pick + total.ret;
  const isEmpty = totalOrders === 0;

  // ===== HERO =====
  const heroEl       = document.getElementById('overviewHero');
  const heroDataEl   = document.getElementById('heroData');
  const heroEmptyEl  = document.getElementById('heroEmpty');
  const heroValueEl  = document.getElementById('overallTotalPoints');
  const heroBaseEl   = document.getElementById('heroBase');
  const heroBonusEl  = document.getElementById('heroBonus');
  const heroIncomeEl = document.getElementById('heroIncome');

  if (heroEl) heroEl.classList.toggle('no-data', isEmpty);
  if (heroDataEl)  heroDataEl.style.display  = isEmpty ? 'none'  : 'block';
  if (heroEmptyEl) heroEmptyEl.style.display = isEmpty ? 'block' : 'none';

  if (!isEmpty) {
    if (heroValueEl) heroValueEl.innerHTML = `${_fmt(finalTotal)} <span class="hero-value-unit">Điểm</span>`;
    if (heroBaseEl)   heroBaseEl.innerText   = _fmt(rawBase);
    if (heroBonusEl)  heroBonusEl.innerText  = '+' + _fmt(rankBonus);
    if (heroIncomeEl) heroIncomeEl.innerText = '+' + _fmt(incomeAccumulated);
  }

  updateHeroContextLabel();

  // ===== HERO TILES =====
  const heroTileDelEl  = document.getElementById('heroTileDel');
  const heroTilePickEl = document.getElementById('heroTilePick');
  const heroTileRetEl  = document.getElementById('heroTileRet');

  if (heroTileDelEl) {
    heroTileDelEl.innerText = total.del === 0 ? '0' : _fmt(total.del);
    heroTileDelEl.classList.toggle('is-zero', total.del === 0);
  }
  if (heroTilePickEl) {
    heroTilePickEl.innerText = total.pick === 0 ? '0' : _fmt(total.pick);
    heroTilePickEl.classList.toggle('is-zero', total.pick === 0);
  }
  if (heroTileRetEl) {
    heroTileRetEl.innerText = total.ret === 0 ? '0' : _fmt(total.ret);
    heroTileRetEl.classList.toggle('is-zero', total.ret === 0);
  }

  document.getElementById('delTotalPoints').innerHTML =
    `${_fmt(delPts)} <span class="hero-value-unit">Điểm</span>`;
  document.getElementById('delTotalOrders').innerText = `${_fmt(total.del)} đơn`;
  document.getElementById('pickTotalPoints').innerHTML =
    `${_fmt(pickPts)} <span class="hero-value-unit">Điểm</span>`;
  document.getElementById('pickTotalOrders').innerText = `${_fmt(total.pick)} đơn`;
  document.getElementById('retTotalPoints').innerHTML =
    `${_fmt(retPts)} <span class="hero-value-unit">Điểm</span>`;
  document.getElementById('retTotalOrders').innerText = `${_fmt(total.ret)} đơn`;

  // ===== Income UI =====
  const salaryBaseEl   = document.getElementById('salaryBaseInput');
  const buuCucInput    = document.getElementById('manualBuuCucInput');
  const taiXeInput     = document.getElementById('manualTaiXeInput');
  const incomeDayCount = document.getElementById('incomeDayCount');
  const incomePerDay   = document.getElementById('incomePerDayText');
  const incomeTotal    = document.getElementById('incomeTotalDisplay');
  const incomeTotalInner = document.getElementById('incomeTotalDisplayInner');
  const progressFill   = document.getElementById('incomeProgressFill');

  if (salaryBaseEl && document.activeElement !== salaryBaseEl) salaryBaseEl.value = salaryBase;
  if (buuCucInput && document.activeElement !== buuCucInput)   buuCucInput.value  = manualBuuCuc;
  if (taiXeInput  && document.activeElement !== taiXeInput)    taiXeInput.value   = manualTaiXe;

  const salaryMonthHint = document.getElementById('salaryMonthHint');
  if (salaryMonthHint) {
    const [y, m] = state.currentMonth.split('-');
    const label = `Tháng ${parseInt(m, 10)}/${y}`;
    if (hasSalaryConfig(state.currentMonth)) {
      salaryMonthHint.innerText = `📅 Áp dụng cho: ${label}`;
      salaryMonthHint.classList.remove('salary-month-hint--empty');
    } else {
      salaryMonthHint.innerText = `⚠️ Chưa thiết lập cho: ${label}`;
      salaryMonthHint.classList.add('salary-month-hint--empty');
    }
  }

  const workDaysText = Number.isInteger(displayDays)
    ? displayDays.toString()
    : displayDays.toFixed(1);

  const progressPct = salaryDays > 0
    ? Math.min(100, Math.round((displayDays / salaryDays) * 100))
    : 0;

  if (incomeDayCount) {
    incomeDayCount.innerText = `${workDaysText}/${salaryDays} công · ${progressPct}%`;
  }
  if (incomePerDay)   incomePerDay.innerText   = formatPts(Math.round(perDay)) + '/công';
  if (incomeTotal)    incomeTotal.innerText    = '+' + formatPts(incomeAccumulated);
  if (incomeTotalInner) incomeTotalInner.innerText = '+' + formatPts(incomeAccumulated);

  if (progressFill) {
    progressFill.style.width = progressPct + '%';
  }

  renderTaiXeConditionBanner(delOrders, manualTaiXe);

  const filteredCount =
    state.appData.delivery.filter(r => isDateInCurrentPeriod(r.date, state.periodMode, state.currentMonth, state.currentDate)).length +
    state.appData.pickup.filter(r => isDateInCurrentPeriod(r.date, state.periodMode, state.currentMonth, state.currentDate)).length +
    state.appData.return.filter(r => isDateInCurrentPeriod(r.date, state.periodMode, state.currentMonth, state.currentDate)).length;
  document.getElementById('histCountNote').innerText = `${filteredCount} bản ghi`;

  persistData();

  renderReminderBanner();

  // Throttled hash check → dispatch event cho cloud auto-backup
  _checkDataChanged();

  renderHistory();
}

let _updateAllViews_debounced = null;
export function updateAllViews() {
  if (!_updateAllViews_debounced) {
    _updateAllViews_debounced = (() => {
      let t = null;
      return () => { clearTimeout(t); t = setTimeout(_updateAllViews, 60); };
    })();
  }
  _updateAllViews_debounced();
}

// ==================== RENDER HISTORY ====================
export function renderHistory() {
  const container = document.getElementById('historyEntries');
  if (!container) return;
  const prevScroll = container.scrollTop;
  container.innerHTML = '';

  // Toggle active state cho nút 📅 Ngày
  const dateBtn = document.getElementById('histFilterDateBtn');
  if (dateBtn) {
    const f = getHistFilters();
    dateBtn.classList.toggle('active', !!f.date);
  }

  let list = [];
  ['delivery', 'pickup', 'return'].forEach(type => {
    if (!_histFilters.types[type]) return;
    state.appData[type].forEach(r => {
      if (recordPassesHistoryFilter(r, type)) {
        list.push({ ...r, type });
      }
    });
  });

  list.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.id - a.id));

  if (list.length === 0) {
    const emptyMsg = hasActiveHistFilters()
      ? 'Không có bản ghi khớp bộ lọc hiện tại.'
      : 'Chưa có bản ghi nào trong kỳ được chọn.';
    container.innerHTML = `<div style="font-size:11.5px;color:var(--text-3);text-align:center;padding:20px">${emptyMsg}</div>`;
    return;
  }

  list.forEach(r => {
    let dayTotal = 0;
    const parts = [];
    WEIGHT_KEYS.forEach((k, col) => {
      const v = parseInt(r.weights[k], 10) || 0;
      dayTotal += v;
      if (v > 0) parts.push(`${WEIGHT_LABELS[col].replace('>', '').replace(' kg', '')}: ${_fmt(v)}`);
    });

    const tagMap = { delivery: ['tag-delivery', 'Giao'], pickup: ['tag-pickup', 'Lấy'], return: ['tag-return', 'Hoàn'] };
    const [tagClass, tagText] = tagMap[r.type];

    const div = document.createElement('div');
    div.className = 'history-entry';
    div.innerHTML = `<div>
      <div class="hist-meta"><span class="hist-badge-tag ${tagClass}">${tagText}</span>${formatDateDisplay(r.date)} · <span>${_fmt(dayTotal)} đơn</span></div>
      <div class="hist-detail">${parts.join(' • ') || '0 đơn'}</div></div>
      <div class="hist-actions">
        <button class="hist-btn hist-edit-btn" onclick="openEditModal('${r.type}', ${r.id})">Sửa</button>
        <button class="hist-btn hist-del-btn" onclick="deleteRecord('${r.type}', ${r.id})">Xóa</button>
      </div>`;
    container.appendChild(div);
  });

  requestAnimationFrame(() => { container.scrollTop = prevScroll; });
}