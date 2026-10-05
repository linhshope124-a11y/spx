import { state, persistData, getSalaryConfig, hasSalaryConfig, getRankConfig } from './state.js';
import { WEIGHT_LABELS, WEIGHT_KEYS, TABLE_4_DATA, TABLE_5_DATA, TABLE_6_DATA } from './config.js';
import { lookupTier, aggregateWeights, isDateInCurrentPeriod } from './calc.js';
import { formatPts, formatDateDisplay, _fmt, getCurrentMonthIso, getTodayIso } from './utils.js';

const NEED_HIGHLIGHT = 'color:#dc2626;font-size:1.35em;font-weight:900;letter-spacing:0.5px;';

let _lastDataHash = null;
let _histDateFilter = null;   // v50.9.0: filter Nhật ký theo ngày

// ==================== v50.9.0: HISTORY DATE FILTER ====================
export function getHistDateFilter() { return _histDateFilter; }

export function setHistDateFilter(v) {
  _histDateFilter = (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null;
}

// ==================== v50.9.0: REMINDER BANNER ====================
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

function buildOverviewSuggestion(type, label, orders, tier) {
  if (orders <= 0 || !tier.next || !isFinite(tier.matched.maxA)) return null;
  const need  = tier.matched.maxA - orders;
  const badge = type === 'del' ? 'G' : type === 'pick' ? 'L' : 'H';
  const cls   = type === 'del' ? 'sugg-del'  : type === 'pick' ? 'sugg-pick'  : 'sugg-ret';
  const bcls  = type === 'del' ? 'sugg-type-del' : type === 'pick' ? 'sugg-type-pick' : 'sugg-type-ret';
  return `<div class="suggestion-item ${cls}">
    <div class="sugg-left"><h4><span class="sugg-type-badge ${bcls}">${badge}</span> ${label} · ${_fmt(orders)} đơn</h4>
    <p>Thêm <b style="${NEED_HIGHLIGHT}">+${_fmt(need)}</b> đơn đạt ${tier.next.range}</p></div>
    <div class="sugg-points">+${formatPts(tier.next.pt - tier.matched.pt)}</div>
  </div>`;
}

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

    const o1 = buildOverviewSuggestion('del',  WEIGHT_LABELS[col], dOrders, dTier); if (o1) ovSuggBuf.push(o1);
    const o2 = buildOverviewSuggestion('pick', WEIGHT_LABELS[col], pOrders, pTier); if (o2) ovSuggBuf.push(o2);
    const o3 = buildOverviewSuggestion('ret',  WEIGHT_LABELS[col], rOrders, rTier); if (o3) ovSuggBuf.push(o3);
  }

  const ovBox = document.getElementById('overviewMilestoneList');
  if (total.del + total.pick + total.ret === 0) {
    const emptyMsg = 'Chưa có dữ liệu kỳ này. Bấm menu → Nhập sản lượng để bắt đầu.';
    ovBox.innerHTML = `<div style="font-size:11.5px;color:var(--text-3);text-align:center;padding:16px">${emptyMsg}</div>`;
  } else {
    ovBox.innerHTML = ovSuggBuf.join('');
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
  const monthlyTotal = salaryBase + manualBuuCuc + manualTaiXe;

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

  // Hero tab chi tiết
  document.getElementById('delTotalPoints').innerHTML =
    `${_fmt(delPts)} <span class="hero-value-unit">Điểm</span>`;
  document.getElementById('delTotalOrders').innerText = `${_fmt(total.del)} đơn`;
  document.getElementById('pickTotalPoints').innerHTML =
    `${_fmt(pickPts)} <span class="hero-value-unit">Điểm</span>`;
  document.getElementById('pickTotalOrders').innerText = `${_fmt(total.pick)} đơn`;
  document.getElementById('retTotalPoints').innerHTML =
    `${_fmt(retPts)} <span class="hero-value-unit">Điểm</span>`;
  document.getElementById('retTotalOrders').innerText = `${_fmt(total.ret)} đơn`;

  // ===== RATIO BAR =====
  const ratioContentEl = document.getElementById('ratioContent');
  const ratioEmptyEl   = document.getElementById('ratioEmpty');
  const pctDelEl  = document.getElementById('ratioPctDel');
  const pctPickEl = document.getElementById('ratioPctPick');
  const pctRetEl  = document.getElementById('ratioPctRet');

  if (totalOrders > 0) {
    if (ratioContentEl) ratioContentEl.style.display = 'block';
    if (ratioEmptyEl)   ratioEmptyEl.style.display   = 'none';

    const rawDel  = (total.del  / totalOrders) * 100;
    const rawPick = (total.pick / totalOrders) * 100;
    const rawRet  = (total.ret  / totalOrders) * 100;
    let pDel  = Math.floor(rawDel);
    let pPick = Math.floor(rawPick);
    let pRet  = Math.floor(rawRet);
    const remainder = 100 - (pDel + pPick + pRet);
    const fracs = [
      { k: 'del',  f: rawDel  - pDel  },
      { k: 'pick', f: rawPick - pPick },
      { k: 'ret',  f: rawRet  - pRet  }
    ].sort((a, b) => b.f - a.f);
    for (let i = 0; i < remainder; i++) {
      if (fracs[i % 3].k === 'del') pDel++;
      else if (fracs[i % 3].k === 'pick') pPick++;
      else pRet++;
    }
    document.getElementById('ratioBarDel').style.width  = pDel  + '%';
    document.getElementById('ratioBarPick').style.width = pPick + '%';
    document.getElementById('ratioBarRet').style.width  = pRet  + '%';
    if (pctDelEl)  pctDelEl.innerText  = pDel  + '%';
    if (pctPickEl) pctPickEl.innerText = pPick + '%';
    if (pctRetEl)  pctRetEl.innerText  = pRet  + '%';
  } else {
    if (ratioContentEl) ratioContentEl.style.display = 'none';
    if (ratioEmptyEl)   ratioEmptyEl.style.display   = 'block';
  }

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

  if (incomeDayCount) incomeDayCount.innerText = `${workDaysText}/${salaryDays} công`;
  if (incomePerDay)   incomePerDay.innerText   = formatPts(Math.round(perDay)) + '/công';
  if (incomeTotal)    incomeTotal.innerText    = '+' + formatPts(incomeAccumulated);
  if (incomeTotalInner) incomeTotalInner.innerText = '+' + formatPts(incomeAccumulated);

  if (progressFill) {
    const pct = salaryDays > 0 ? Math.min(100, Math.round((displayDays / salaryDays) * 100)) : 0;
    progressFill.style.width = pct + '%';
  }

  // ===== Count bản ghi =====
  const filteredCount =
    state.appData.delivery.filter(r => isDateInCurrentPeriod(r.date, state.periodMode, state.currentMonth, state.currentDate)).length +
    state.appData.pickup.filter(r => isDateInCurrentPeriod(r.date, state.periodMode, state.currentMonth, state.currentDate)).length +
    state.appData.return.filter(r => isDateInCurrentPeriod(r.date, state.periodMode, state.currentMonth, state.currentDate)).length;
  document.getElementById('histCountNote').innerText = `${filteredCount} bản ghi`;

  persistData();

  // ===== v50.9.0: Reminder banner =====
  renderReminderBanner();

  const currentHash = JSON.stringify(state.appData);
  if (_lastDataHash === null) {
    _lastDataHash = currentHash;
  } else if (currentHash !== _lastDataHash) {
    _lastDataHash = currentHash;
    window.dispatchEvent(new CustomEvent('spx:datachanged'));
  }

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

// ==================== v50.9.0: RENDER HISTORY (có filter ngày) ====================
export function renderHistory() {
  const container = document.getElementById('historyEntries');
  if (!container) return;
  const prevScroll = container.scrollTop;
  container.innerHTML = '';

  // Update chip label
  const chip = document.getElementById('histDateChip');
  if (chip) {
    if (_histDateFilter) {
      chip.innerText = '📅 ' + formatDateDisplay(_histDateFilter) + ' ✕';
      chip.classList.add('active');
    } else {
      chip.innerText = '📅 Ngày';
      chip.classList.remove('active');
    }
  }

  let list = [];
  if (state.histFilter === 'all' || state.histFilter === 'delivery')
    state.appData.delivery.forEach(r => list.push({ ...r, type: 'delivery' }));
  if (state.histFilter === 'all' || state.histFilter === 'pickup')
    state.appData.pickup.forEach(r => list.push({ ...r, type: 'pickup' }));
  if (state.histFilter === 'all' || state.histFilter === 'return')
    state.appData.return.forEach(r => list.push({ ...r, type: 'return' }));

  // v50.9.0: filter theo ngày (nếu có) — bỏ qua filter theo tháng
  if (_histDateFilter) {
    list = list.filter(r => r.date === _histDateFilter);
  } else {
    list = list.filter(r => isDateInCurrentPeriod(r.date, state.periodMode, state.currentMonth, state.currentDate));
  }

  list.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.id - a.id));

  if (list.length === 0) {
    const emptyMsg = _histDateFilter
      ? `Không có bản ghi ngày ${formatDateDisplay(_histDateFilter)}`
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