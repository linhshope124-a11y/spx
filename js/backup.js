import {
  state,
  persistData,
  persistSalaryByMonth,
  persistRankByMonth
} from './state.js';
import { APP_VERSION, STORAGE_KEYS, WEIGHT_KEYS } from './config.js';
import { getTodayIso } from './utils.js';
import { updateAllViews } from './render.js';
import { initRankUI, initRegionUI, showToast } from './ui.js';

// ==================== HELPERS ====================
function weightsEqual(a, b) {
  return WEIGHT_KEYS.every(k => (parseInt(a[k], 10) || 0) === (parseInt(b[k], 10) || 0));
}

function dedupeList(list) {
  const seen = new Set();
  return list.filter(r => {
    const key = r.date + '|' + WEIGHT_KEYS.map(k => parseInt(r.weights?.[k], 10) || 0).join('_');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function totalRecords(data) {
  return (data.delivery?.length || 0) + (data.pickup?.length || 0) + (data.return?.length || 0);
}

// ==================== COPY / PASTE JSON ====================
export function copyDataJson() {
  const jsonStr = JSON.stringify(state.appData, null, 2);
  const btn = document.getElementById('copyJsonBtn');
  const ok = () => {
    btn.innerHTML = '✓ Đã chép!';
    btn.style.background = '#10b981'; btn.style.borderColor = '#10b981'; btn.style.color = '#fff';
    setTimeout(() => { btn.innerHTML = '📋 Chép JSON'; btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = ''; }, 2000);
  };
  const fb = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = jsonStr; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      ok();
    } catch { alert('Không chép được.'); }
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(jsonStr).then(ok).catch(fb);
  else fb();
}

export function openPasteJsonModal()  {
  document.getElementById('jsonPasteInput').value = '';
  document.getElementById('pasteJsonModal').classList.add('active');
}
export function closePasteJsonModal() { document.getElementById('pasteJsonModal').classList.remove('active'); }

// ==================== APPLY IMPORT ====================
/**
 * v50.8.0: Áp dụng payload import với 2 chế độ:
 *   - overwrite: GHI ĐÈ (xóa hết cũ, thay bằng file)
 *   - merge:     THÊM VÀO (giữ cũ, thêm mới, skip trùng)
 *
 * EXPORT để cloud.js dùng chung.
 */
export function applyImportedPayload(parsed, mode = 'overwrite') {
  let importedData = null, importedSettings = null;
  if (parsed?.data && (parsed.data.delivery || parsed.data.pickup || parsed.data.return)) {
    importedData = parsed.data; importedSettings = parsed.settings || null;
  } else if (parsed && (parsed.delivery || parsed.pickup || parsed.return)) {
    importedData = parsed;
  } else return { success: false };

  // Chuẩn hóa dữ liệu từ file
  const newDel  = dedupeList(importedData.delivery || []);
  const newPick = dedupeList(importedData.pickup   || []);
  const newRet  = dedupeList(importedData.return   || []);

  let removedCount = 0;
  let addedCount = 0;

  if (mode === 'overwrite') {
    // === GHI ĐÈ ===
    const oldTotal = totalRecords(state.appData);
    state.appData = {
      delivery: newDel,
      pickup:   newPick,
      return:   newRet
    };
    addedCount = totalRecords(state.appData);
    removedCount = 0;
    console.log(`[Import] OVERWRITE: ${oldTotal} → ${addedCount} bản ghi`);
  } else {
    // === MERGE (THÊM VÀO) ===
    const mergeList = (oldList, newList) => {
      const merged = [...oldList];
      let added = 0;
      newList.forEach(r => {
        const dup = oldList.find(o => o.date === r.date && weightsEqual(o.weights, r.weights));
        if (dup) return; // Skip trùng
        merged.push(r);
        added++;
      });
      return { list: merged, added };
    };

    const m1 = mergeList(state.appData.delivery, newDel);
    const m2 = mergeList(state.appData.pickup,   newPick);
    const m3 = mergeList(state.appData.return,   newRet);

    state.appData = {
      delivery: m1.list,
      pickup:   m2.list,
      return:   m3.list
    };
    addedCount = m1.added + m2.added + m3.added;
    const newTotal = totalRecords({ delivery: newDel, pickup: newPick, return: newRet });
    removedCount = newTotal - addedCount;
    console.log(`[Import] MERGE: thêm ${addedCount}, skip ${removedCount} trùng`);
  }

  localStorage.setItem(STORAGE_KEYS.records, JSON.stringify(state.appData));
  localStorage.setItem(STORAGE_KEYS.vault,   JSON.stringify(state.appData));

  // ===== Settings =====
  if (importedSettings) {
    // Region
    if (typeof importedSettings.region === 'string' &&
        (importedSettings.region === 'mien' || importedSettings.region === 'hcm_hn')) {
      state.region = importedSettings.region;
      localStorage.setItem('spx_region', state.region);
    }

    // Theme
    if (typeof importedSettings.theme === 'string') {
      localStorage.setItem(STORAGE_KEYS.theme, importedSettings.theme);
      document.documentElement.setAttribute('data-theme', importedSettings.theme);
    }

    // ===== v50.4: salaryByMonth =====
    if (importedSettings.salaryByMonth && typeof importedSettings.salaryByMonth === 'object') {
      if (mode === 'overwrite') {
        state.salaryByMonth = importedSettings.salaryByMonth;
      } else {
        Object.keys(importedSettings.salaryByMonth).forEach(m => {
          if (!state.salaryByMonth[m]) {
            state.salaryByMonth[m] = importedSettings.salaryByMonth[m];
          }
        });
      }
      persistSalaryByMonth();
    } else {
      // Legacy: manualSalary + manualPoints
      const legacySalary = Number(importedSettings.manualSalary) || 0;
      const legacyBuuCuc = importedSettings.manualPoints?.buuCuc || 0;
      const legacyTaiXe  = importedSettings.manualPoints?.taiXe  || 0;
      if (legacySalary > 0 || legacyBuuCuc > 0 || legacyTaiXe > 0) {
        const m = state.currentMonth || new Date().toISOString().slice(0, 7);
        if (!state.salaryByMonth[m]) {
          state.salaryByMonth[m] = { base: legacySalary, buuCuc: legacyBuuCuc, taiXe: legacyTaiXe };
          persistSalaryByMonth();
        }
      }
    }

    // ===== v50.8.0: rankByMonth =====
    if (importedSettings.rankByMonth && typeof importedSettings.rankByMonth === 'object') {
      if (mode === 'overwrite') {
        state.rankByMonth = importedSettings.rankByMonth;
      } else {
        Object.keys(importedSettings.rankByMonth).forEach(m => {
          if (!state.rankByMonth[m]) {
            state.rankByMonth[m] = importedSettings.rankByMonth[m];
          }
        });
      }
      persistRankByMonth();
    } else if (typeof importedSettings.rankName === 'string' && importedSettings.rankName !== 'none') {
      // Legacy: rankName + rankBonus (global)
      const m = state.currentMonth || new Date().toISOString().slice(0, 7);
      if (!state.rankByMonth[m]) {
        state.rankByMonth[m] = {
          name: importedSettings.rankName,
          bonus: Number(importedSettings.rankBonus) || 0
        };
        persistRankByMonth();
      }
    }

    if (Number.isFinite(importedSettings.salaryDays)) {
      state.salaryDays = importedSettings.salaryDays;
      localStorage.setItem('spx_salary_days', state.salaryDays);
    }
  }

  persistData();
  return { success: true, addedCount, removedCount, mode };
}

/**
 * v50.8.2: Kiểm tra app đang có dữ liệu → hỏi user muốn GHI ĐÈ hay THÊM VÀO.
 * EXPORT để cloud.js dùng chung.
 * @param {number} newCount - Số bản ghi chuẩn bị nạp (để hiển thị cho user)
 * @returns {Promise<string>} 'overwrite' | 'merge'
 */
export function askImportMode(newCount = 0) {
  const currentTotal = totalRecords(state.appData);
  if (currentTotal === 0) return Promise.resolve('overwrite'); // App trống → ghi đè

  const newInfo = newCount > 0 ? `\n📁 File muốn nạp: ${newCount} bản ghi\n` : '';
  const msg =
    `⚠️ App đang có ${currentTotal} bản ghi.` + newInfo + `\n` +
    `Bạn muốn:\n\n` +
    `• OK → GHI ĐÈ\n` +
    `  Xóa hết data cũ, thay bằng dữ liệu mới\n\n` +
    `• Cancel → THÊM VÀO\n` +
    `  Giữ data cũ + thêm mới (bỏ qua bản ghi trùng)`;

  const ok = window.confirm(msg);
  return Promise.resolve(ok ? 'overwrite' : 'merge');
}

// ==================== IMPORT (paste JSON) ====================
export async function confirmImportJsonString() {
  const text = document.getElementById('jsonPasteInput').value.trim();
  if (!text) { alert('Vui lòng dán chuỗi JSON!'); return; }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    alert('Dữ liệu JSON không hợp lệ!');
    return;
  }

  // v50.8.2: đếm số bản ghi sắp nạp để hiển thị
  const newCount = (parsed.data?.delivery?.length || 0)
                 + (parsed.data?.pickup?.length   || 0)
                 + (parsed.data?.return?.length   || 0);
  const mode = await askImportMode(newCount);
  if (mode === 'cancel') return;

  const result = applyImportedPayload(parsed, mode);
  if (!result.success) {
    alert('Chuỗi JSON không đúng định dạng!');
    return;
  }

  updateAllViews();
  initRankUI();
  initRegionUI();
  closePasteJsonModal();

  const msg = mode === 'overwrite'
    ? `✅ Đã GHI ĐÈ: ${result.addedCount} bản ghi mới`
    : `✅ Đã THÊM VÀO: +${result.addedCount} bản ghi` +
      (result.removedCount > 0 ? `\n🧹 Bỏ qua ${result.removedCount} bản ghi trùng` : '');
  alert(msg);
}

// ==================== EXPORT ====================
export function exportData() {
  const payload = {
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      // v50.8.0
      rankByMonth:   state.rankByMonth,
      salaryByMonth: state.salaryByMonth,
      salaryDays:    state.salaryDays,
      region:        state.region,
      theme:         localStorage.getItem(STORAGE_KEYS.theme) || 'light'
    },
    data: state.appData
  };
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
  const a = document.createElement('a');
  a.setAttribute('href', dataStr);
  a.setAttribute('download', `SPX_Data_${getTodayIso()}.json`);
  document.body.appendChild(a); a.click(); a.remove();
}

// ==================== IMPORT FILE ====================
export async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async e => {
    let parsed;
    try {
      parsed = JSON.parse(e.target.result);
    } catch {
      alert('Không đọc được file sao lưu!');
      event.target.value = '';
      return;
    }

    // v50.8.2: đếm số bản ghi sắp nạp
    const newCount = (parsed.data?.delivery?.length || 0)
                   + (parsed.data?.pickup?.length   || 0)
                   + (parsed.data?.return?.length   || 0);
    const mode = await askImportMode(newCount);
    if (mode === 'cancel') { event.target.value = ''; return; }

    const result = applyImportedPayload(parsed, mode);
    if (!result.success) {
      alert('File sao lưu không đúng định dạng!');
      event.target.value = '';
      return;
    }

    updateAllViews();
    initRankUI();
    initRegionUI();

    const msg = mode === 'overwrite'
      ? `✅ Đã GHI ĐÈ: ${result.addedCount} bản ghi mới`
      : `✅ Đã THÊM VÀO: +${result.addedCount} bản ghi` +
        (result.removedCount > 0 ? `\n🧹 Bỏ qua ${result.removedCount} bản ghi trùng` : '');
    alert(msg);
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ==================== RESTORE FROM VAULT ====================
export function restoreFromVault() {
  const vault = JSON.parse(localStorage.getItem(STORAGE_KEYS.vault));
  const hasData = vault && (
    (vault.delivery && vault.delivery.length > 0) ||
    (vault.pickup   && vault.pickup.length   > 0) ||
    (vault.return   && vault.return.length   > 0)
  );
  if (!hasData) { alert('Không tìm thấy dữ liệu tự động lưu trữ.'); return; }
  if (!confirm('Đã tìm thấy bản sao lưu tự động. Bạn có muốn phục hồi không?')) return;
  state.appData = vault;
  updateAllViews();
  alert('Đã phục hồi dữ liệu!');
}