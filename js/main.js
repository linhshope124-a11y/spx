import { state, loadState, persistPeriodState, getSalaryConfig, setSalaryConfig } from './state.js';
import { initTheme, toggleTheme } from './theme.js';
import { getTodayIso, getCurrentMonthIso } from './utils.js';
import {
  switchMainTab, switchModalSubTab, setOverviewFilter, setHistFilter,
  setRankTier, initRankUI,
  initRegionUI,
  setPeriodMode, periodPrev, periodNext, openPeriodPicker,
  jumpToMonth, jumpToDate, goToLatest, updatePeriodBarUI,
  syncRankUIForCurrentMonth,
  openAddModal, openEditModal, closeModal,
  openMenuModal, closeMenuModal,
  openHistoryTab,
  openSettingsModal, closeSettingsModal,
  openCoffeeModal, closeCoffeeModal, copyBankNumber,
  toggleThemeFromMenu,
  initPeriodLabelLongPress
} from './ui.js';
import {
  handleOcrImage, preloadTesseractWorker,
  openOcrLightbox, closeOcrLightbox,
  openBatchOcrModal, closeBatchOcrModal, appendBatchFiles,
  saveBatchAll, importBatchItem, removeBatchItem,
  backToBatch, hasBatchPending, showBackToBatchBtn
} from './ocr.js';
import { saveRecord, deleteRecord, clearAllHistory } from './entry.js';
import {
  copyDataJson, openPasteJsonModal, closePasteJsonModal,
  confirmImportJsonString, exportData, importData, restoreFromVault
} from './backup.js';
import { updateAllViews } from './render.js';
import {
  testCloudConnection, pushToCloud, pullFromCloud,
  initCloudUI, clearCloudToken
} from './cloud.js';
import { undoLast } from './undo.js';
import { WEIGHT_KEYS } from './config.js';

// ================ AUTO-CLEAR INPUT ================
function attachAutoClearInputs() {
  document.querySelectorAll('.auto-clear').forEach(input => {
    input.addEventListener('focus', function () { if (this.value === '0') this.value = ''; });
    input.addEventListener('blur',  function () { if (this.value.trim() === '') this.value = '0'; });
  });
}

// ================ SAVE CONFIG THEO THÁNG ================
let manualPointsTimer = null;
function _saveManualPoints() {
  const buuCuc = parseInt(document.getElementById('manualBuuCucInput').value, 10) || 0;
  const taiXe  = parseInt(document.getElementById('manualTaiXeInput').value, 10) || 0;
  const cfg = getSalaryConfig(state.currentMonth);
  setSalaryConfig(state.currentMonth, { ...cfg, buuCuc, taiXe });
  clearTimeout(manualPointsTimer);
  manualPointsTimer = setTimeout(() => updateAllViews(), 300);
}

let salaryTimer = null;
function _saveSalaryConfig() {
  const salary = parseFloat(document.getElementById('salaryBaseInput').value) || 0;
  const cfg = getSalaryConfig(state.currentMonth);
  setSalaryConfig(state.currentMonth, { ...cfg, base: salary });
  clearTimeout(salaryTimer);
  salaryTimer = setTimeout(() => updateAllViews(), 300);
}

// ================ DỌN TRÙNG LẶP ================
function _findDuplicates() {
  const dups = [];
  ['delivery', 'pickup', 'return'].forEach(type => {
    const seen = {};
    state.appData[type].forEach(r => {
      const key = r.date + '|' + WEIGHT_KEYS.map(k => parseInt(r.weights?.[k], 10) || 0).join('_');
      if (seen[key]) {
        dups.push({ type, id: r.id, date: r.date, keptId: seen[key].id });
      } else {
        seen[key] = r;
      }
    });
  });
  return dups;
}

function _cleanupDuplicates() {
  const dups = _findDuplicates();
  if (dups.length === 0) {
    alert('Không có bản ghi trùng lặp!');
    return;
  }
  const summary = { Giao: 0, Lấy: 0, Hoàn: 0 };
  dups.forEach(d => {
    const label = d.type === 'delivery' ? 'Giao' : d.type === 'pickup' ? 'Lấy' : 'Hoàn';
    summary[label]++;
  });
  let msg = `Tìm thấy ${dups.length} bản ghi trùng lặp:\n`;
  Object.keys(summary).forEach(k => {
    if (summary[k] > 0) msg += `• ${k}: ${summary[k]}\n`;
  });
  msg += '\nXóa hết các bản ghi trùng (giữ lại 1 bản gốc)?';
  if (!confirm(msg)) return;
  const idsByType = { delivery: [], pickup: [], return: [] };
  dups.forEach(d => idsByType[d.type].push(d.id));
  Object.keys(idsByType).forEach(type => {
    const ids = idsByType[type];
    state.appData[type] = state.appData[type].filter(r => !ids.includes(r.id));
  });
  updateAllViews();
  alert(`Đã xóa ${dups.length} bản ghi trùng lặp!`);
}

// ================ HERO COLLAPSIBLE ================
function _toggleHeroMetrics() {
  const wrap = document.getElementById('heroMetricsWrap');
  const text = document.getElementById('heroToggleText');
  if (!wrap) return;
  const isExpanded = wrap.classList.toggle('expanded');
  if (text) text.innerText = isExpanded ? 'Ẩn' : 'Chi tiết';
  try { localStorage.setItem('spx_hero_expanded', isExpanded ? '1' : '0'); } catch {}
}

function _initHeroExpandState() {
  const wrap = document.getElementById('heroMetricsWrap');
  const text = document.getElementById('heroToggleText');
  if (!wrap) return;
  const saved = localStorage.getItem('spx_hero_expanded') === '1';
  if (saved) {
    wrap.classList.add('expanded');
    if (text) text.innerText = 'Ẩn';
  }
}

// ================ AUTO-UPDATE ================
let swRegistration = null;
let currentAppVersion = null;
let waitingWorker = null;

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.log('[PWA] SW registered:', swRegistration.scope);

    swRegistration.addEventListener('updatefound', () => {
      const newWorker = swRegistration.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('[PWA] SW mới sẵn sàng (waiting)');
          waitingWorker = newWorker;
          showUpdateBanner();
        }
      });
    });

    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.type === 'SW_UPDATED') {
        console.log('[PWA] SW updated → reloading...');
        window.location.reload();
      }
    });
  } catch (e) {
    console.warn('[PWA] SW registration failed:', e);
  }
}

async function checkVersion() {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const serverVersion = data.version;
    if (!serverVersion) return;

    if (!currentAppVersion) {
      currentAppVersion = serverVersion;
      console.log('[Update] Current version:', serverVersion);
      return;
    }

    if (serverVersion !== currentAppVersion) {
      console.log('[Update] New version found:', serverVersion, '(current:', currentAppVersion + ')');
      if (swRegistration) {
        try { await swRegistration.update(); } catch {}
      }
      if (swRegistration && swRegistration.waiting) {
        waitingWorker = swRegistration.waiting;
      }
      showUpdateBanner(serverVersion);
    }
  } catch (e) {
    // Bỏ qua lỗi mạng
  }
}

function showUpdateBanner(newVer) {
  const banner = document.getElementById('updateBanner');
  if (!banner) return;
  const msg = document.getElementById('updateBannerMsg');
  if (msg) {
    msg.textContent = newVer ? `Có bản mới ${newVer}!` : 'Có bản mới!';
  }
  banner.classList.add('active');
}

function hideUpdateBanner() {
  const banner = document.getElementById('updateBanner');
  if (banner) banner.classList.remove('active');
}

async function applyUpdate() {
  hideUpdateBanner();
  try {
    const worker = waitingWorker
      || (swRegistration && swRegistration.waiting)
      || (swRegistration && swRegistration.installing);

    if (worker) {
      worker.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(() => {
        if (document.visibilityState === 'visible') {
          window.location.reload();
        }
      }, 2500);
    } else {
      window.location.reload();
    }
  } catch (e) {
    console.error('[Update] failed:', e);
    window.location.reload();
  }
}

// ================ EXPOSE TO WINDOW ================
Object.assign(window, {
  toggleTheme,
  toggleThemeFromMenu,
  switchMainTab, switchModalSubTab, setOverviewFilter, setHistFilter,
  setRankTier,
  syncRankUIForCurrentMonth,

  // Auto-update
  applyUpdate,
  checkVersion,

  // PERIOD BAR
  setPeriodMode,
  periodPrev,
  periodNext,
  openPeriodPicker,
  jumpToMonth,
  jumpToDate,
  goToLatest,

  // REGION — inline onclick
  changeRegion: function(regionKey, el) {
    try {
      console.log('[Region] change →', regionKey);
      if (!regionKey || (regionKey !== 'mien' && regionKey !== 'hcm_hn')) return;

      const oldRegion = state.region;
      if (oldRegion === regionKey) return;

      state.region = regionKey;
      localStorage.setItem('spx_region', regionKey);
      console.log('[Region] state updated:', oldRegion, '→', regionKey);

      document.querySelectorAll('.region-pill').forEach(p => p.classList.remove('active'));
      if (el) el.classList.add('active');

      updateAllViews();

      const label = regionKey === 'hcm_hn'
        ? 'TP.HCM & Hà Nội (80/40)'
        : 'Miền Bắc/Trung/Nam (60/30)';
      alert(`Đã chọn khu vực: ${label}`);
    } catch (e) {
      console.error('[Region] error:', e);
      alert('Lỗi đổi khu vực: ' + e.message);
    }
  },

  openAddModal, openEditModal, closeModal,
  openMenuModal, closeMenuModal,
  openHistoryTab,
  openSettingsModal, closeSettingsModal,
  openCoffeeModal, closeCoffeeModal, copyBankNumber,
  handleOcrImage, openOcrLightbox, closeOcrLightbox,
  openBatchOcrModal, closeBatchOcrModal, appendBatchFiles,
  saveBatchAll, importBatchItem, removeBatchItem,
  backToBatch, hasBatchPending, showBackToBatchBtn,
  saveRecord, deleteRecord, clearAllHistory,
  copyDataJson, openPasteJsonModal, closePasteJsonModal,
  confirmImportJsonString, exportData, importData, restoreFromVault,

  // Cloud — v50.8.5: thêm clearCloudToken
  testCloudConnection, pushToCloud, pullFromCloud, initCloudUI, clearCloudToken,

  undoLast,

  saveManualPoints: _saveManualPoints,
  saveSalaryConfig: _saveSalaryConfig,

  // force save config vào tháng hiện tại
  forceSaveConfig: function() {
    const buuCuc = parseInt(document.getElementById('manualBuuCucInput').value, 10) || 0;
    const taiXe  = parseInt(document.getElementById('manualTaiXeInput').value, 10) || 0;
    const salary = parseFloat(document.getElementById('salaryBaseInput').value) || 0;

    setSalaryConfig(state.currentMonth, { base: salary, buuCuc, taiXe });
    localStorage.setItem('spx_region', state.region);

    clearTimeout(manualPointsTimer);
    clearTimeout(salaryTimer);
    updateAllViews();

    const [y, m] = state.currentMonth.split('-');
    alert(
      `Đã lưu cấu hình cho Tháng ${parseInt(m, 10)}/${y}!\n\n` +
      `• Lương:   ${salary.toLocaleString('vi-VN')}\n` +
      `• Bưu cục: ${buuCuc.toLocaleString('vi-VN')}\n` +
      `• Tài xế:  ${taiXe.toLocaleString('vi-VN')}\n` +
      `• Khu vực: ${state.region === 'hcm_hn' ? 'TP.HCM & HN' : 'Miền'}`
    );
  },

  findDuplicates: _findDuplicates,
  cleanupDuplicates: _cleanupDuplicates,

  toggleHeroMetrics: _toggleHeroMetrics
});

// ================ INIT ================
(function init() {
  loadState();
  initTheme();
  initRankUI();
  initRegionUI();
  initPeriodLabelLongPress();   // v50.8.5: gắn long-press label Tháng

  updatePeriodBarUI();
  _initHeroExpandState();

  attachAutoClearInputs();
  updateAllViews();
  setTimeout(() => preloadTesseractWorker(), 2000);

  // Auto-update system
  registerSW();
  setTimeout(checkVersion, 2000);
  setInterval(checkVersion, 5 * 60 * 1000);
})();