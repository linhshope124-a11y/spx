import { state, persistSettings, persistPeriodState, getRankConfig, setRankConfig } from './state.js';
import {
  updateAllViews, renderHistory,
  getHistFilters, setHistFilters, resetHistFilters,
  hasActiveHistFilters, countActiveHistFilters,
  // backward compat v50.9.0
  setHistDateFilter, getHistDateFilter
} from './render.js';
import { getTodayIso, getCurrentMonthIso, formatDateDisplay } from './utils.js';
import { toggleTheme } from './theme.js';
import { showConfirm } from './dialog.js';

// ================ HELPERS ================
function formatDateLabel(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return '';
  const [y, m, d] = isoDate.split('-');
  const dt = new Date(isoDate + 'T00:00:00');
  const wd = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][dt.getDay()];
  return `${wd}, ${d}/${m}/${y}`;
}

function formatMonthLabelShort(isoMonth) {
  if (!isoMonth || !/^\d{4}-\d{2}$/.test(isoMonth)) return '';
  const [y, m] = isoMonth.split('-');
  return `Tháng ${parseInt(m, 10)}/${y}`;
}

function _shiftDateIso(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ================ TABS ================
export function switchMainTab(tabId, el) {
  state.activeTab = tabId;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-' + tabId);
  if (panel) panel.classList.add('active');

  if (tabId === 'history') {
    _resetHistoryView();
  }
}

export function openHistoryTab() {
  state.activeTab = 'history';
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-history');
  if (panel) panel.classList.add('active');
  _resetHistoryView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Reset filter history về mặc định (dùng khi vào tab Nhật ký)
 */
function _resetHistoryView() {
  state.histFilter = 'all';
  resetHistFilters();
  // Reset filter bar 4 nút cũ
  document.querySelectorAll('#tab-history .filter-bar .filter-btn').forEach(b => {
    if (b.classList.contains('filter-btn-search')) return;
    if (b.classList.contains('filter-btn-date')) return;
    const isAllBtn = b.textContent.trim() === 'Tất cả';
    b.classList.toggle('active', isAllBtn);
  });
  renderHistory();
}

export function switchModalSubTab(tabKey) {
  ['del', 'pick', 'ret'].forEach(k => {
    const btn = document.getElementById('subtab-btn-' + k);
    const pane = document.getElementById('pane-' + k);
    if (btn) btn.classList.remove('active');
    if (pane) pane.style.display = 'none';
  });
  const btn = document.getElementById('subtab-btn-' + tabKey);
  const pane = document.getElementById('pane-' + tabKey);
  if (btn) btn.classList.add('active');
  if (pane) pane.style.display = 'block';
}

// ================ FILTERS (OVERVIEW) ================
export function setOverviewFilter(filter, el) {
  state.overviewFilter = filter;
  const bar = el.closest('.filter-bar');
  if (bar) bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('#overviewMilestoneList .suggestion-item').forEach(item => {
    if (filter === 'all')       item.style.display = 'flex';
    else if (filter === 'del')  item.style.display = item.classList.contains('sugg-del')  ? 'flex' : 'none';
    else if (filter === 'pick') item.style.display = item.classList.contains('sugg-pick') ? 'flex' : 'none';
    else if (filter === 'ret')  item.style.display = item.classList.contains('sugg-ret')  ? 'flex' : 'none';
  });
}

// ================ v50.11.0: HISTORY FILTER (SPX-H) ================

/**
 * Filter bar 4 nút cũ [Tất cả/Giao/Lấy/Hoàn]
 * Đồng bộ 2 chiều với _histFilters.types (qua API render.js)
 */
export function setHistFilter(filter, btn) {
  state.histFilter = filter;

  const types = {
    delivery: filter === 'all' || filter === 'delivery',
    pickup:   filter === 'all' || filter === 'pickup',
    return:   filter === 'all' || filter === 'return'
  };
  setHistFilters({ types });

  // Active state cho 4 nút cũ (bỏ qua chip 🔍)
  const bar = btn.closest('.filter-bar');
  if (bar) {
    bar.querySelectorAll('.filter-btn').forEach(b => {
      if (b.classList.contains('filter-btn-search')) return;
      if (b.classList.contains('filter-btn-date')) return;
      b.classList.remove('active');
    });
  }
  btn.classList.add('active');

  // Đồng bộ chip trong panel (nếu đang có DOM)
  document.querySelectorAll('#filterTypeChips .filter-toggle-chip').forEach(b => {
    b.classList.toggle('active', types[b.dataset.filterType] === true);
  });

  renderHistory();
}

/**
 * Mở panel filter nâng cao (bottom sheet)
 */
export function openHistoryFilterPanel() {
  _bindFilterPanelInputs();
  _fillFilterPanelFromState();
  document.getElementById('historyFilterPanel').classList.add('active');
}

export function closeHistoryFilterPanel() {
  document.getElementById('historyFilterPanel').classList.remove('active');
}

/**
 * Nạp state filter hiện tại vào DOM panel
 */
function _fillFilterPanelFromState() {
  const f = getHistFilters();

  const fromEl = document.getElementById('filterDateFrom');
  const toEl   = document.getElementById('filterDateTo');
  const minEl  = document.getElementById('filterMinOrders');
  const maxEl  = document.getElementById('filterMaxOrders');

  if (fromEl) fromEl.value = f.dateFrom || '';
  if (toEl)   toEl.value   = f.dateTo   || '';
  if (minEl)  minEl.value  = f.minOrders != null ? f.minOrders : '';
  if (maxEl)  maxEl.value  = f.maxOrders != null ? f.maxOrders : '';

  // Type chips
  document.querySelectorAll('#filterTypeChips .filter-toggle-chip').forEach(b => {
    b.classList.toggle('active', f.types[b.dataset.filterType] === true);
  });

  // Score chips
  document.querySelectorAll('#filterScoreChips .filter-radio-chip').forEach(b => {
    b.classList.toggle('active', b.dataset.score === f.scoreFilter);
  });

  // Clear active trên quick buttons
  document.querySelectorAll('.filter-quick-btn[data-range]').forEach(b => b.classList.remove('active'));

  _updateApplyBtnLabel();
}

/**
 * Bind oninput/onchange cho các input trong panel (chỉ 1 lần)
 */
function _bindFilterPanelInputs() {
  ['filterDateFrom', 'filterDateTo', 'filterMinOrders', 'filterMaxOrders'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.bound === '1') return;
    el.dataset.bound = '1';
    el.addEventListener('input', _updateApplyBtnLabel);
    el.addEventListener('change', _updateApplyBtnLabel);
  });
}

/**
 * Đếm số filter đang bật TRONG PANEL (chưa commit)
 */
function _countFiltersInPanel() {
  let n = 0;

  const fromEl = document.getElementById('filterDateFrom');
  const toEl   = document.getElementById('filterDateTo');
  if ((fromEl && fromEl.value) || (toEl && toEl.value)) n++;

  const activeTypeCount = document.querySelectorAll('#filterTypeChips .filter-toggle-chip.active').length;
  if (activeTypeCount < 3) n++;

  const minEl = document.getElementById('filterMinOrders');
  const maxEl = document.getElementById('filterMaxOrders');
  if ((minEl && minEl.value !== '') || (maxEl && maxEl.value !== '')) n++;

  const scoreActive = document.querySelector('#filterScoreChips .filter-radio-chip.active');
  if (scoreActive && scoreActive.dataset.score !== 'all') n++;

  return n;
}

function _updateApplyBtnLabel() {
  const btn = document.getElementById('applyFilterBtn');
  if (!btn) return;
  const n = _countFiltersInPanel();
  btn.innerText = n > 0 ? `✨ Áp dụng (${n})` : '✨ Áp dụng';
}

/**
 * Quick pick date range: today / 7d / 30d / month
 */
export function quickPickDateRange(range, btn) {
  const today = getTodayIso();
  let from = null, to = today;

  if (range === 'today') {
    from = today;
  } else if (range === '7d') {
    from = _shiftDateIso(today, -6);
  } else if (range === '30d') {
    from = _shiftDateIso(today, -29);
  } else if (range === 'month') {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    from = `${y}-${m}-01`;
  }

  const fromEl = document.getElementById('filterDateFrom');
  const toEl   = document.getElementById('filterDateTo');
  if (fromEl) fromEl.value = from || '';
  if (toEl)   toEl.value   = to || '';

  // Active state: chỉ toggle cho nhóm date quick buttons
  const dateRanges = ['today', '7d', '30d', 'month'];
  document.querySelectorAll('.filter-quick-btn[data-range]').forEach(b => {
    if (dateRanges.includes(b.dataset.range)) {
      b.classList.toggle('active', b === btn);
    }
  });

  _updateApplyBtnLabel();
}

/**
 * Quick pick orders range: lt50 / 50-100 / 100-200 / gt200
 */
export function quickPickOrders(range, btn) {
  const minEl = document.getElementById('filterMinOrders');
  const maxEl = document.getElementById('filterMaxOrders');

  let min = null, max = null;
  if (range === 'lt50')         { min = null; max = 49; }
  else if (range === '50-100')  { min = 50;   max = 100; }
  else if (range === '100-200') { min = 100;  max = 200; }
  else if (range === 'gt200')   { min = 201;  max = null; }

  if (minEl) minEl.value = min != null ? min : '';
  if (maxEl) maxEl.value = max != null ? max : '';

  const ordersRanges = ['lt50', '50-100', '100-200', 'gt200'];
  document.querySelectorAll('.filter-quick-btn[data-range]').forEach(b => {
    if (ordersRanges.includes(b.dataset.range)) {
      b.classList.toggle('active', b === btn);
    }
  });

  _updateApplyBtnLabel();
}

/**
 * Toggle 1 chip loại đơn
 */
export function toggleFilterType(btn) {
  if (!btn) return;
  btn.classList.toggle('active');
  _updateApplyBtnLabel();
}

/**
 * Chọn 1 radio chip điểm (loại trừ lẫn nhau)
 */
export function pickFilterScore(score, btn) {
  document.querySelectorAll('#filterScoreChips .filter-radio-chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _updateApplyBtnLabel();
}

/**
 * Reset form panel (CHƯA commit vào state)
 */
export function resetHistoryFilterPanel() {
  const fromEl = document.getElementById('filterDateFrom');
  const toEl   = document.getElementById('filterDateTo');
  const minEl  = document.getElementById('filterMinOrders');
  const maxEl  = document.getElementById('filterMaxOrders');

  if (fromEl) fromEl.value = '';
  if (toEl)   toEl.value   = '';
  if (minEl)  minEl.value  = '';
  if (maxEl)  maxEl.value  = '';

  document.querySelectorAll('#filterTypeChips .filter-toggle-chip').forEach(b => b.classList.add('active'));
  document.querySelectorAll('#filterScoreChips .filter-radio-chip').forEach(b => {
    b.classList.toggle('active', b.dataset.score === 'all');
  });
  document.querySelectorAll('.filter-quick-btn[data-range]').forEach(b => b.classList.remove('active'));

  _updateApplyBtnLabel();
}

/**
 * Đọc DOM panel → commit vào _histFilters → render → đóng panel
 */
export function applyHistoryFilterPanel() {
  const fromEl = document.getElementById('filterDateFrom');
  const toEl   = document.getElementById('filterDateTo');
  const minEl  = document.getElementById('filterMinOrders');
  const maxEl  = document.getElementById('filterMaxOrders');

  const types = { delivery: false, pickup: false, return: false };
  document.querySelectorAll('#filterTypeChips .filter-toggle-chip.active').forEach(b => {
    types[b.dataset.filterType] = true;
  });

  const scoreActive = document.querySelector('#filterScoreChips .filter-radio-chip.active');
  const score = scoreActive ? scoreActive.dataset.score : 'all';

  setHistFilters({
    dateFrom: (fromEl && fromEl.value) ? fromEl.value : null,
    dateTo:   (toEl   && toEl.value)   ? toEl.value   : null,
    types,
    minOrders: (minEl && minEl.value !== '') ? Number(minEl.value) : null,
    maxOrders: (maxEl && maxEl.value !== '') ? Number(maxEl.value) : null,
    scoreFilter: score
  });

  // Đồng bộ lại filter bar 4 nút cũ theo types mới
  _syncFilterBarFromTypes(types);

  renderHistory();
  closeHistoryFilterPanel();
}

/**
 * Xóa toàn bộ filter (từ chip summary)
 */
export function clearAllHistoryFilters() {
  resetHistFilters();
  state.histFilter = 'all';

  // Đồng bộ filter bar 4 nút cũ về "Tất cả"
  document.querySelectorAll('#tab-history .filter-bar .filter-btn').forEach(b => {
    if (b.classList.contains('filter-btn-search')) return;
    if (b.classList.contains('filter-btn-date')) return;
    const isAllBtn = b.textContent.trim() === 'Tất cả';
    b.classList.toggle('active', isAllBtn);
  });

  renderHistory();
}

/**
 * Đồng bộ 4 nút filter bar cũ theo types object
 */
function _syncFilterBarFromTypes(types) {
  const btns = document.querySelectorAll('#tab-history .filter-bar .filter-btn');
  const onlyOne = (types.delivery && !types.pickup && !types.return) ? 'Giao'
                : (!types.delivery && types.pickup && !types.return) ? 'Lấy'
                : (!types.delivery && !types.pickup && types.return) ? 'Hoàn'
                : null;

  btns.forEach(b => {
    if (b.classList.contains('filter-btn-search')) return;
    if (b.classList.contains('filter-btn-date')) return;
    const txt = b.textContent.trim();
    if (onlyOne) {
      b.classList.toggle('active', txt === onlyOne);
    } else {
      b.classList.toggle('active', txt === 'Tất cả');
    }
  });
}

// ---- Backward compat: 3 hàm cũ của v50.9.0 ----
export function openHistoryDatePicker() {
  // Redirect sang panel filter nâng cao
  openHistoryFilterPanel();
}

export function applyHistoryDateFilter(value) {
  // No-op — v50.11.0 đã thay bằng panel
}

export function clearHistoryDateFilter() {
  clearAllHistoryFilters();
}
// ================ /HISTORY FILTER ================


// ================ PERIOD BAR ================
export function setPeriodMode(mode, el) {
  if (mode !== 'month') return;
  if (state.periodMode === mode) return;

  state.periodMode = mode;
  persistPeriodState();
  updatePeriodBarUI();
  updateAllViews();
}

export function periodPrev() {
  const [y, m] = state.currentMonth.split('-').map(Number);
  let newY = y, newM = m - 1;
  if (newM < 1) { newM = 12; newY--; }
  if (newY < 2020) return;
  state.currentMonth = `${newY}-${String(newM).padStart(2, '0')}`;
  persistPeriodState();
  updatePeriodBarUI();
  syncRankUIForCurrentMonth();
  updateAllViews();
}

export function periodNext() {
  const nowMonth = getCurrentMonthIso();
  if (state.currentMonth >= nowMonth) return;
  const [y, m] = state.currentMonth.split('-').map(Number);
  let newY = y, newM = m + 1;
  if (newM > 12) { newM = 1; newY++; }
  state.currentMonth = `${newY}-${String(newM).padStart(2, '0')}`;
  persistPeriodState();
  updatePeriodBarUI();
  syncRankUIForCurrentMonth();
  updateAllViews();
}

export function openPeriodPicker() {
  if (window.__periodLongPressFired) {
    window.__periodLongPressFired = false;
    return;
  }
  const p = document.getElementById('monthPickerInput');
  if (!p) return;
  p.value = state.currentMonth;
  if (typeof p.showPicker === 'function') {
    try { p.showPicker(); } catch { p.click(); }
  } else p.click();
}

export function jumpToMonth(value) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return;
  const nowMonth = getCurrentMonthIso();
  state.currentMonth = value > nowMonth ? nowMonth : value;
  persistPeriodState();
  updatePeriodBarUI();
  syncRankUIForCurrentMonth();
  updateAllViews();
}

export function jumpToDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const today = getTodayIso();
  state.currentDate = value > today ? today : value;
  persistPeriodState();
  updatePeriodBarUI();
  updateAllViews();
}

export function goToLatest() {
  const allDates = [
    ...state.appData.delivery.map(r => r.date),
    ...state.appData.pickup.map(r => r.date),
    ...state.appData.return.map(r => r.date)
  ].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));

  let targetDate;
  if (allDates.length > 0) {
    allDates.sort();
    targetDate = allDates[allDates.length - 1];
  } else {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    targetDate = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  }

  state.currentMonth = targetDate.slice(0, 7);
  persistPeriodState();
  updatePeriodBarUI();
  syncRankUIForCurrentMonth();
  updateAllViews();
}

export function updatePeriodBarUI() {
  const label = document.getElementById('periodLabel');
  const prevBtn = document.getElementById('periodPrev');
  const nextBtn = document.getElementById('periodNext');
  if (!label) return;

  label.innerText = formatMonthLabelShort(state.currentMonth || getCurrentMonthIso());

  if (prevBtn) {
    const atLowerBound = state.currentMonth <= '2020-01';
    prevBtn.disabled = atLowerBound;
    prevBtn.classList.toggle('disabled', atLowerBound);
  }

  if (nextBtn) {
    const nowMonth = getCurrentMonthIso();
    const atUpperBound = state.currentMonth >= nowMonth;
    nextBtn.disabled = atUpperBound;
    nextBtn.classList.toggle('disabled', atUpperBound);
  }
}

// ================ LONG-PRESS LABEL → NHẢY MỚI NHẤT ================
let _periodLongPressAttached = false;
function attachPeriodLabelLongPress() {
  if (_periodLongPressAttached) return;
  _periodLongPressAttached = true;

  const label = document.getElementById('periodLabel');
  if (!label) return;

  let timer = null;

  const start = () => {
    window.__periodLongPressFired = false;
    label.classList.add('long-pressing');
    timer = setTimeout(() => {
      window.__periodLongPressFired = true;
      if (navigator.vibrate) { try { navigator.vibrate(30); } catch {} }
      goToLatest();
      label.classList.remove('long-pressing');
      setTimeout(() => { window.__periodLongPressFired = false; }, 350);
    }, 550);
  };

  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    label.classList.remove('long-pressing');
  };

  label.addEventListener('touchstart',  start,  { passive: true });
  label.addEventListener('touchend',    cancel);
  label.addEventListener('touchcancel', cancel);
  label.addEventListener('touchmove',   cancel, { passive: true });
  label.addEventListener('mousedown',   start);
  label.addEventListener('mouseup',     cancel);
  label.addEventListener('mouseleave',  cancel);
}

export function initPeriodLabelLongPress() {
  attachPeriodLabelLongPress();
}

// ================ TOGGLE OCR DEBUG ================
export function toggleOcrDebugText() {
  const el = document.getElementById('ocrDebugText');
  const btn = document.getElementById('ocrDebugToggle');
  if (!el) return;
  const isHidden = el.style.display === 'none';
  el.style.display = isHidden ? 'block' : 'none';
  if (btn) btn.innerText = isHidden ? 'Ẩn log' : 'Xem log';
}

// ================ RANK ================
export function setRankTier(rankKey, bonusPct, el) {
  if (window.__spxLongPressFired) {
    window.__spxLongPressFired = false;
    return;
  }

  setRankConfig(state.currentMonth, { name: rankKey, bonus: bonusPct });

  el.parentElement.querySelectorAll('.rank-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  const label = document.getElementById('currentBonusPctLabel');
  if (label) label.innerText = `+${Math.round(bonusPct * 100)}%`;
  updateAllViews();
}

function resetRankToNone() {
  setRankConfig(state.currentMonth, { name: 'none', bonus: 0 });

  document.querySelectorAll('.rank-pill').forEach(p => {
    p.classList.remove('active');
    p.classList.remove('long-pressing');
  });
  const label = document.getElementById('currentBonusPctLabel');
  if (label) label.innerText = '+0%';
  updateAllViews();
  showToast('Đã bỏ chọn hạng thưởng tháng này', 'success', 1800);
}

let _rankLongPressAttached = false;
function attachRankLongPress() {
  if (_rankLongPressAttached) return;
  _rankLongPressAttached = true;

  document.querySelectorAll('.rank-pill').forEach(pill => {
    let timer = null;
    const start = () => {
      window.__spxLongPressFired = false;
      pill.classList.add('long-pressing');
      timer = setTimeout(() => {
        window.__spxLongPressFired = true;
        if (pill.classList.contains('active')) {
          if (navigator.vibrate) { try { navigator.vibrate(30); } catch {} }
          resetRankToNone();
        } else {
          pill.classList.remove('long-pressing');
        }
      }, 550);
    };
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
      pill.classList.remove('long-pressing');
    };
    pill.addEventListener('touchstart',  start,  { passive: true });
    pill.addEventListener('touchend',    cancel);
    pill.addEventListener('touchcancel', cancel);
    pill.addEventListener('touchmove',   cancel, { passive: true });
    pill.addEventListener('mousedown',   start);
    pill.addEventListener('mouseup',     cancel);
    pill.addEventListener('mouseleave',  cancel);
  });
}

export function syncRankUIForCurrentMonth() {
  const cfg = getRankConfig(state.currentMonth);
  document.querySelectorAll('.rank-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.rank === cfg.name);
  });
  const label = document.getElementById('currentBonusPctLabel');
  if (label) label.innerText = `+${Math.round((cfg.bonus || 0) * 100)}%`;
}

export function initRankUI() {
  syncRankUIForCurrentMonth();
  attachRankLongPress();
}

// ================ REGION ================
export function initRegionUI() {
  document.querySelectorAll('.region-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.region === state.region);
  });
}

// ================ THEME ================
export function toggleThemeFromMenu() {
  toggleTheme();
  updateMenuThemeUI();
  closeMenuModal();
}

export function updateMenuThemeUI() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const title = document.getElementById('menuThemeTitle');
  const sub   = document.getElementById('menuThemeSub');
  if (current === 'dark') {
    if (title) title.innerText = 'Chế độ sáng';
    if (sub)   sub.innerText   = 'Chuyển về giao diện sáng';
  } else {
    if (title) title.innerText = 'Chế độ tối';
    if (sub)   sub.innerText   = 'Chuyển sang giao diện tối';
  }
}

// ================ MODALS ================
export function openAddModal() {
  document.getElementById('modalTitle').innerText = 'Nhập sản lượng ngày';
  document.getElementById('editEntryId').value = '';
  document.getElementById('editEntryType').value = '';
  document.getElementById('modalSubTabGroup').style.display = 'flex';
  document.getElementById('inputDate').value = getTodayIso();

  ['0_2','2_4','4_6','6_8','8_10','10_12','12_15','over_15'].forEach(id => {
    document.getElementById('del_inp_'  + id).value = 0;
    document.getElementById('pick_inp_' + id).value = 0;
    document.getElementById('ret_inp_'  + id).value = 0;
  });
  switchModalSubTab('del');
  clearAllConfidenceHighlightsLocal();

  if (state.isOcrScan && state.lastOcrImageDataUrl) {
    document.getElementById('ocrPreviewImg').src = state.lastOcrImageDataUrl;
    document.getElementById('ocrPreviewBox').style.display = 'block';
    state.isOcrScan = false;
  } else {
    document.getElementById('ocrPreviewBox').style.display = 'none';
  }
  document.getElementById('entryModal').classList.add('active');
}

export function openEditModal(type, id) {
  const item = (state.appData[type] || []).find(r => r.id === id);
  if (!item) { showToast('Không tìm thấy bản ghi', 'error'); return; }

  document.getElementById('modalTitle').innerText =
    `Sửa (${type === 'delivery' ? 'Giao' : type === 'pickup' ? 'Lấy' : 'Hoàn'})`;
  document.getElementById('editEntryId').value = id;
  document.getElementById('editEntryType').value = type;
  document.getElementById('inputDate').value = item.date;

  ['0_2','2_4','4_6','6_8','8_10','10_12','12_15','over_15'].forEach(sfx => {
    document.getElementById('del_inp_'  + sfx).value = 0;
    document.getElementById('pick_inp_' + sfx).value = 0;
    document.getElementById('ret_inp_'  + sfx).value = 0;
  });

  const prefix = type === 'delivery' ? 'del_inp' : type === 'pickup' ? 'pick_inp' : 'ret_inp';
  const subTab = type === 'delivery' ? 'del'     : type === 'pickup' ? 'pick'    : 'ret';
  document.getElementById('modalSubTabGroup').style.display = 'none';
  switchModalSubTab(subTab);

  const mapKey = {
    w0_2:'0_2', w2_4:'2_4', w4_6:'4_6', w6_8:'6_8',
    w8_10:'8_10', w10_12:'10_12', w12_15:'12_15', wover_15:'over_15'
  };
  Object.keys(mapKey).forEach(k => {
    const inp = document.getElementById(prefix + '_' + mapKey[k]);
    if (inp) inp.value = item.weights[k] || 0;
  });

  document.getElementById('ocrPreviewBox').style.display = 'none';
  clearAllConfidenceHighlightsLocal();
  document.getElementById('entryModal').classList.add('active');
}

export async function closeModal(force) {
  if (!force) {
    const hasData = ['del_inp','pick_inp','ret_inp'].some(pfx =>
      ['0_2','2_4','4_6','6_8','8_10','10_12','12_15','over_15'].some(sfx => {
        const el = document.getElementById(pfx + '_' + sfx);
        return el && parseInt(el.value, 10) > 0;
      })
    );
    const isEditing = document.getElementById('editEntryId').value !== '';
    if (hasData && !isEditing) {
      const ok = await showConfirm(
        'Bạn đang có dữ liệu chưa lưu.\n\nĐóng và bỏ qua?',
        {
          title: 'Dữ liệu chưa lưu',
          okText: 'Bỏ qua',
          cancelText: 'Ở lại',
          danger: true
        }
      );
      if (!ok) return;
    }
  }
  document.getElementById('entryModal').classList.remove('active');
  state.isOcrScan = false;
  state.lastOcrImageDataUrl = '';
}

// ================ MENU MODAL ================
export function openMenuModal() {
  updateMenuThemeUI();
  document.getElementById('menuModal').classList.add('active');
}
export function closeMenuModal() {
  document.getElementById('menuModal').classList.remove('active');
}

// ================ v50.11.0: SHARE TARGET MODAL (SPX-F) ================
/**
 * Detect trạng thái Share Target dựa vào platform + cài PWA
 */
function _detectShareTargetStatus() {
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches;

  // Chưa cài PWA → chưa kích hoạt
  if (!isStandalone) {
    return {
      type: 'inactive',
      icon: '📲',
      title: 'Chưa kích hoạt',
      sub: 'Cần cài app vào màn hình chính để dùng tính năng Chia sẻ ảnh.'
    };
  }

  // iOS → hỗ trợ hạn chế
  if (isIOS) {
    return {
      type: 'limited',
      icon: '⚠️',
      title: 'iOS hỗ trợ hạn chế',
      sub: 'iOS Safari 17+ chỉ nhận 1 ảnh/lần — không nhận nhiều ảnh cùng lúc.'
    };
  }

  // Android đã cài PWA → full support
  if (isAndroid) {
    return {
      type: 'active',
      icon: '✅',
      title: 'Đã kích hoạt',
      sub: 'Android Chrome hỗ trợ đầy đủ — share nhiều ảnh cùng lúc.'
    };
  }

  // Desktop hoặc khác
  return {
    type: 'inactive',
    icon: '💻',
    title: 'Không hỗ trợ trên desktop',
    sub: 'Tính năng này chỉ hoạt động trên mobile (Android/iOS).'
  };
}

export function openShareTargetModal() {
  const status = _detectShareTargetStatus();

  const box   = document.getElementById('shareStatusBox');
  const icon  = document.getElementById('shareStatusIcon');
  const title = document.getElementById('shareStatusTitle');
  const sub   = document.getElementById('shareStatusSub');

  if (box)   box.className = 'share-status-box share-status-' + status.type;
  if (icon)  icon.innerText  = status.icon;
  if (title) title.innerText = status.title;
  if (sub)   sub.innerText   = status.sub;

  document.getElementById('shareTargetModal').classList.add('active');
}

export function closeShareTargetModal() {
  document.getElementById('shareTargetModal').classList.remove('active');
}
// ================ /SHARE TARGET MODAL ================

// ================ SETTINGS MODAL ================
export function openSettingsModal() {
  if (typeof window.initCloudUI === 'function') window.initCloudUI();
  document.getElementById('settingsModal').classList.add('active');
}
export function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('active');
}

// ================ COFFEE MODAL ================
export function openCoffeeModal()  { document.getElementById('coffeeModal').classList.add('active'); }
export function closeCoffeeModal() { document.getElementById('coffeeModal').classList.remove('active'); }

export function copyBankNumber() {
  const stk = document.getElementById('bankSTK').innerText.trim();
  const btn = document.getElementById('copyBankBtn');
  const ok = () => {
    btn.innerHTML = '✓ Đã sao chép!';
    btn.style.background = 'var(--success)';
    btn.style.borderColor = 'var(--success)';
    setTimeout(() => {
      btn.innerHTML = '📋 Sao chép số tài khoản';
      btn.style.background = '';
      btn.style.borderColor = '';
    }, 2000);
  };
  const fb = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = stk; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      ok();
    } catch { showToast('STK: ' + stk, 'warning'); }
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(stk).then(ok).catch(fb);
  else fb();
}

// ================ TOAST ================
export function showToast(message, type = 'success', duration = 2200) {
  const toast = document.getElementById('appToast');
  if (!toast) return;
  toast.className = 'app-toast ' + type;
  toast.innerText = message;
  void toast.offsetWidth;
  toast.classList.add('active');
  clearTimeout(window.__spxToastTimer);
  window.__spxToastTimer = setTimeout(() => {
    toast.classList.remove('active');
  }, duration);
}

// ================ HELPERS ================
function clearAllConfidenceHighlightsLocal() {
  const banner = document.getElementById('distWarningBanner');
  if (banner) banner.remove();

  ['del_inp','pick_inp','ret_inp'].forEach(pfx =>
    ['0_2','2_4','4_6','6_8','8_10','10_12','12_15','over_15'].forEach(k => {
      const input = document.getElementById(pfx + '_' + k);
      if (!input) return;
      input.classList.remove('conf-high', 'conf-mid', 'conf-low', 'conf-suspect');
      const parent = input.closest('.weight-input-item');
      if (parent) {
        const badge = parent.querySelector('.conf-badge');
        if (badge) badge.remove();
      }
    })
  );
}