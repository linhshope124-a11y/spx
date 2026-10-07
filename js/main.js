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
  initPeriodLabelLongPress,
  toggleOcrDebugText,
  openShareTargetModal, closeShareTargetModal,
  openHistoryFilterPanel, closeHistoryFilterPanel,
  quickPickDateRange, quickPickOrders,
  toggleFilterType, pickFilterScore,
  resetHistoryFilterPanel, applyHistoryFilterPanel,
  clearAllHistoryFilters,
  openAllOpportunitiesModal, closeAllOpportunitiesModal,
  showToast
} from './ui.js';
import {
  handleOcrImage, preloadTesseractWorker,
  openOcrLightbox, closeOcrLightbox,
  openBatchOcrModal, closeBatchOcrModal, appendBatchFiles,
  saveBatchAll, importBatchItem, removeBatchItem,
  backToBatch, hasBatchPending, showBackToBatchBtn,
  clearOcrCache, getOcrCacheStats,
  handleSharedImage
} from './ocr.js';
import { saveRecord, deleteRecord, clearAllHistory } from './entry.js';
import {
  copyDataJson, openPasteJsonModal, closePasteJsonModal,
  confirmImportJsonString, exportData, importData, restoreFromVault
} from './backup.js';
import {
  updateAllViews, renderReminderBanner, dismissReminderBanner,
  setAllOppFilter
} from './render.js';
import {
  testCloudConnection, pushToCloud, pullFromCloud,
  initCloudUI, clearCloudToken
} from './cloud.js';
import { undoLast } from './undo.js';
import { showAlert, showConfirm } from './dialog.js';
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

async function _cleanupDuplicates() {
  const dups = _findDuplicates();
  if (dups.length === 0) {
    await showAlert('Không có bản ghi trùng lặp!', { title: 'Không tìm thấy', okText: 'Đã hiểu' });
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

  const ok = await showConfirm(msg, {
    title: 'Dọn bản ghi trùng',
    okText: 'Xóa trùng',
    cancelText: 'Hủy',
    danger: true
  });
  if (!ok) return;

  const idsByType = { delivery: [], pickup: [], return: [] };
  dups.forEach(d => idsByType[d.type].push(d.id));
  Object.keys(idsByType).forEach(type => {
    const ids = idsByType[type];
    state.appData[type] = state.appData[type].filter(r => !ids.includes(r.id));
  });
  updateAllViews();
  await showAlert(`Đã xóa ${dups.length} bản ghi trùng lặp!`, { title: 'Hoàn tất', okText: 'OK' });
}

// ================ OCR CACHE STATS + CLEAR ================
function _updateOcrCacheStats() {
  const el = document.getElementById('ocrCacheStats');
  if (!el) return;
  try {
    const stats = getOcrCacheStats();
    el.innerText = `RAM: ${stats.ramEntries} · LS: ${stats.lsEntries} · ~${stats.sizeKB} KB (max ${stats.maxEntries}/${stats.maxSizeKB}KB)`;
  } catch (e) {
    el.innerText = 'Không đọc được thống kê';
  }
}

async function _clearOcrCacheFromSettings() {
  try {
    await clearOcrCache();
    _updateOcrCacheStats();
  } catch (e) {
    console.error('[OCR Cache] Lỗi xóa:', e);
    await showAlert('Không xóa được cache: ' + e.message, { title: 'Lỗi', okText: 'Đóng' });
  }
}

// ================ HERO COLLAPSIBLE ================
function _toggleHeroMetrics() {
  const wrap = document.getElementById('heroMetricsWrap');
  if (!wrap) return;
  const isExpanded = wrap.classList.toggle('expanded');
  try { localStorage.setItem('spx_hero_expanded', isExpanded ? '1' : '0'); } catch {}
}

function _initHeroExpandState() {
  const wrap = document.getElementById('heroMetricsWrap');
  if (!wrap) return;
  const saved = localStorage.getItem('spx_hero_expanded') === '1';
  if (saved) {
    wrap.classList.add('expanded');
  }
}

// ================ INFO ICON: HƯỚNG DẪN TÍNH THU NHẬP ================
function _showIncomeInfo() {
  showAlert(
    'Lương 1 công = (LCB + Bưu cục + Tài xế) / số ngày tối đa\n\n' +
    '⚡ Tài xế CHỈ được cộng khi đơn Giao ≥ 1.500/tháng.\n' +
    'Nếu < 1.500 → không cộng Tài xế vào lương.\n\n' +
    'Đã tích lũy = Lương 1 công × số công\n\n' +
    'Quy đổi: Giao + Lấy/6 + Hoàn\n' +
    '• Miền Trung: ≥60 = 1 công, ≥30 = 0.5 công\n' +
    '• TP.HCM & HN: ≥80 = 1 công, ≥40 = 0.5 công\n\n' +
    '⚡ Lương được lưu RIÊNG theo từng tháng.\n' +
    'Chuyển tháng để cấu hình tháng đó.',
    { title: 'Cách tính thu nhập', okText: 'Đã hiểu' }
  );
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

/**
 * v50.11.10: Kiểm tra version từ server.
 * @param {boolean} manual - true nếu user bấm menu "Kiểm tra cập nhật"
 *   → hiện toast phản hồi (có bản mới / đã mới nhất / lỗi mạng)
 */
async function checkVersion(manual = false) {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      if (manual) showToast('⚠️ Không kiểm tra được — thử lại sau', 'warning', 2500);
      return;
    }
    const data = await res.json();
    const serverVersion = data.version;
    if (!serverVersion) {
      if (manual) showToast('⚠️ Không đọc được version', 'warning', 2500);
      return;
    }

    if (!currentAppVersion) {
      currentAppVersion = serverVersion;
      console.log('[Update] Current version:', serverVersion);
      if (manual) showToast(`ℹ️ Bản hiện tại: ${serverVersion}`, 'info', 2500);
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
      if (manual) showToast(`🎉 Có bản mới ${serverVersion}!`, 'success', 2500);
    } else if (manual) {
      showToast(`✅ Đã là bản mới nhất (${serverVersion})`, 'success', 2500);
    }
  } catch (e) {
    if (manual) showToast('⚠️ Không kiểm tra được — kiểm tra mạng', 'warning', 2500);
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

// ================ SHARE TARGET LAUNCH ================
const SHARED_CACHE_NAME = 'spx-shared-files';
const SHARED_QUERY_KEY = 'shared';

function _detectShareTargetLaunch() {
  try {
    const url = new URL(window.location.href);
    const hasSharedQuery = url.searchParams.get(SHARED_QUERY_KEY) === '1';
    const isShareTargetPath = /\/share-target\/?$/.test(url.pathname);
    return hasSharedQuery || isShareTargetPath;
  } catch {
    return false;
  }
}

async function _consumeSharedFiles() {
  if (!('caches' in window)) return [];

  try {
    const cache = await caches.open(SHARED_CACHE_NAME);
    const keys = await cache.keys();

    if (keys.length === 0) return [];

    const files = [];
    const consumedKeys = [];

    const metaReq = keys.find(req => req.url.endsWith('/spx-shared-meta'));
    let meta = { count: 0, names: [], types: [] };

    if (metaReq) {
      try {
        const metaRes = await cache.match(metaReq);
        if (metaRes) meta = await metaRes.json();
      } catch (e) {
        console.warn('[ShareTarget] Parse meta lỗi:', e);
      }
      consumedKeys.push(metaReq);
    }

    for (let i = 0; i < (meta.count || 0); i++) {
      const req = keys.find(r => r.url.endsWith(`/spx-shared-file-${i}`));
      if (!req) continue;

      const res = await cache.match(req);
      if (!res) continue;

      const blob = await res.blob();
      const name = meta.names?.[i] || `shared_${i}.jpg`;
      const type = meta.types?.[i] || blob.type || 'image/jpeg';

      const file = new File([blob], name, { type });
      files.push(file);
      consumedKeys.push(req);
    }

    await Promise.all(consumedKeys.map(req => cache.delete(req)));

    const remaining = await cache.keys();
    await Promise.all(
      remaining
        .filter(req => req.url.includes('/spx-shared-'))
        .map(req => cache.delete(req))
    );

    return files;
  } catch (e) {
    console.warn('[ShareTarget] Đọc cache lỗi:', e);
    return [];
  }
}

function _cleanShareQueryFromUrl() {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has(SHARED_QUERY_KEY)) {
      url.searchParams.delete(SHARED_QUERY_KEY);
      window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    }
  } catch {}
}

async function _runShareTargetIfNeeded() {
  if (!_detectShareTargetLaunch()) return;

  console.log('[ShareTarget] Phát hiện launch từ chia sẻ ảnh');

  await new Promise(r => setTimeout(r, 400));

  const files = await _consumeSharedFiles();

  _cleanShareQueryFromUrl();

  if (files.length === 0) {
    console.warn('[ShareTarget] Không có file trong cache');
    showAlert(
      'Không đọc được ảnh từ chia sẻ.\n\n' +
      'Hãy:\n' +
      '• Share lại từ Gallery\n' +
      '• Hoặc mở app → bấm 📷 để chọn ảnh thủ công',
      { title: '📤 Chia sẻ ảnh', okText: 'Đã hiểu' }
    );
    return;
  }

  console.log(`[ShareTarget] Nhận ${files.length} file — bắt đầu OCR`);
  try {
    await handleSharedImage(files);
  } catch (e) {
    console.error('[ShareTarget] Lỗi pipeline:', e);
    showAlert('Lỗi xử lý ảnh chia sẻ: ' + e.message, { title: 'Lỗi', okText: 'Đóng' });
  }
}

// ================ EXPOSE TO WINDOW ================
Object.assign(window, {
  toggleTheme,
  toggleThemeFromMenu,
  switchMainTab, switchModalSubTab, setOverviewFilter, setHistFilter,
  setRankTier,
  syncRankUIForCurrentMonth,

  applyUpdate,
  checkVersion: () => checkVersion(true),   // menu gọi → manual mode

  setPeriodMode,
  periodPrev,
  periodNext,
  openPeriodPicker,
  jumpToMonth,
  jumpToDate,
  goToLatest,

  showIncomeInfo: _showIncomeInfo,
  toggleOcrDebugText,
  clearOcrCacheFromSettings: _clearOcrCacheFromSettings,
  updateOcrCacheStats: _updateOcrCacheStats,
  dismissReminderBanner,

  openShareTargetModal,
  closeShareTargetModal,
  handleSharedImage,

  openHistoryFilterPanel,
  closeHistoryFilterPanel,
  quickPickDateRange,
  quickPickOrders,
  toggleFilterType,
  pickFilterScore,
  resetHistoryFilterPanel,
  applyHistoryFilterPanel,
  clearAllHistoryFilters,

  openAllOpportunitiesModal,
  closeAllOpportunitiesModal,
  setAllOppFilter,

  // REGION
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
        : 'Miền Trung (60/30)';
      showAlert(`Đã chọn khu vực: ${label}`, { title: 'Khu vực', okText: 'OK' });
    } catch (e) {
      console.error('[Region] error:', e);
      showAlert('Lỗi đổi khu vực: ' + e.message, { title: 'Lỗi', okText: 'Đóng' });
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
  testCloudConnection, pushToCloud, pullFromCloud, initCloudUI, clearCloudToken,
  undoLast,

  saveManualPoints: _saveManualPoints,
  saveSalaryConfig: _saveSalaryConfig,

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
    const taiXeNote = taiXe > 0
      ? `\n⚡ Tài xế chỉ được cộng khi đơn Giao ≥ 1.500/tháng.`
      : '';

    showAlert(
      `Đã lưu cấu hình cho Tháng ${parseInt(m, 10)}/${y}!\n\n` +
      `• Lương:   ${salary.toLocaleString('vi-VN')}\n` +
      `• Bưu cục: ${buuCuc.toLocaleString('vi-VN')}\n` +
      `• Tài xế:  ${taiXe.toLocaleString('vi-VN')}\n` +
      `• Khu vực: ${state.region === 'hcm_hn' ? 'TP.HCM & HN' : 'Miền Trung'}` +
      taiXeNote,
      { title: 'Đã lưu cấu hình', okText: 'OK' }
    );
  },

  findDuplicates: _findDuplicates,
  cleanupDuplicates: _cleanupDuplicates,

  toggleHeroMetrics: _toggleHeroMetrics
});

// ================ HOOK SETTINGS MODAL → UPDATE STATS ================
const _origOpenSettingsModal = openSettingsModal;
window.openSettingsModal = function() {
  _origOpenSettingsModal();
  setTimeout(_updateOcrCacheStats, 100);
};

// ================ INIT ================
(async function init() {
  loadState();
  initTheme();
  initRankUI();
  initRegionUI();
  initPeriodLabelLongPress();

  updatePeriodBarUI();
  _initHeroExpandState();

  attachAutoClearInputs();
  updateAllViews();
  setTimeout(() => preloadTesseractWorker(), 2000);

  registerSW();
  setTimeout(() => checkVersion(false), 2000);
  setInterval(() => checkVersion(false), 5 * 60 * 1000);

  _runShareTargetIfNeeded();
})();