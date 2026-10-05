import { state, persistSettings, persistPeriodState, getRankConfig, setRankConfig } from './state.js';
import { updateAllViews, renderHistory, setHistDateFilter, getHistDateFilter } from './render.js';
import { getTodayIso, getCurrentMonthIso } from './utils.js';
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

// ================ TABS ================
export function switchMainTab(tabId, el) {
  state.activeTab = tabId;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-' + tabId);
  if (panel) panel.classList.add('active');

  if (tabId === 'history') {
    state.histFilter = 'all';
    setHistDateFilter(null);
    document.querySelectorAll('#tab-history .filter-bar .filter-btn')
      .forEach((b, i) => b.classList.toggle('active', i === 0));
    renderHistory();
  }
}

export function openHistoryTab() {
  state.activeTab = 'history';
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-history');
  if (panel) panel.classList.add('active');
  state.histFilter = 'all';
  setHistDateFilter(null);
  document.querySelectorAll('#tab-history .filter-bar .filter-btn')
    .forEach((b, i) => b.classList.toggle('active', i === 0));
  renderHistory();
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

// ================ FILTERS ================
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

export function setHistFilter(filter, btn) {
  state.histFilter = filter;
  // v50.9.0: đổi loại (Giao/Lấy/Hoàn/Tất cả) → reset filter ngày
  setHistDateFilter(null);
  const bar = btn.closest('.filter-bar');
  if (bar) {
    bar.querySelectorAll('.filter-btn').forEach(b => {
      if (!b.classList.contains('filter-btn-date')) b.classList.remove('active');
    });
  }
  btn.classList.add('active');
  renderHistory();
}

// ================ v50.9.0: HISTORY DATE PICKER ================
export function openHistoryDatePicker() {
  // Nếu đang có filter ngày → bấm chip = bỏ filter (toggle)
  if (getHistDateFilter()) {
    setHistDateFilter(null);
    renderHistory();
    return;
  }

  const picker = document.getElementById('historyDatePickerInput');
  if (!picker) return;

  // Đặt giá trị mặc định = hôm nay hoặc max ngày trong state
  picker.value = getTodayIso();

  if (typeof picker.showPicker === 'function') {
    try { picker.showPicker(); } catch { picker.click(); }
  } else {
    picker.click();
  }
}

export function applyHistoryDateFilter(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    setHistDateFilter(null);
  } else {
    setHistDateFilter(value);
  }
  renderHistory();
}

export function clearHistoryDateFilter() {
  setHistDateFilter(null);
  renderHistory();
}

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