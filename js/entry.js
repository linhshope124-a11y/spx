import { state } from './state.js';
import { WEIGHT_KEYS, WEIGHT_SUFFIXES } from './config.js';
import { sanitizeInt, generateId, getTodayIso, formatDateDisplay, deepClone } from './utils.js';
import { closeModal } from './ui.js';
import { updateAllViews } from './render.js';
import { hasBatchPending, backToBatch } from './ocr.js';
import { pushUndo } from './undo.js';

function parseWeights(prefix) {
  const out = {};
  WEIGHT_SUFFIXES.forEach((sfx, i) => {
    out[WEIGHT_KEYS[i]] = sanitizeInt(document.getElementById(`${prefix}_${sfx}`).value);
  });
  return out;
}

function weightsEqual(a, b) {
  return WEIGHT_KEYS.every(k => (parseInt(a[k], 10) || 0) === (parseInt(b[k], 10) || 0));
}

function findDuplicate(type, date, weights) {
  return state.appData[type].find(r => r.date === date && weightsEqual(r.weights, weights));
}

export function saveRecord() {
  const date = document.getElementById('inputDate').value || getTodayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { alert('Ngày không hợp lệ!'); return; }
  if (isNaN(new Date(date).getTime()))   { alert('Ngày không hợp lệ!'); return; }

  const editId   = document.getElementById('editEntryId').value;
  const editType = document.getElementById('editEntryType').value;
  const wasFromBatch = hasBatchPending();

  if (editId && editType) {
    // === SỬA ===
    const numId  = parseInt(editId, 10);
    const prefix = editType === 'delivery' ? 'del_inp'
                 : editType === 'pickup'   ? 'pick_inp'
                 : 'ret_inp';
    const weights = parseWeights(prefix);
    const idx = state.appData[editType].findIndex(it => it.id === numId);
    if (idx === -1) {
      alert('Không tìm thấy bản ghi để cập nhật.');
      closeModal(true); updateAllViews(); return;
    }

    const dup = state.appData[editType].find(r =>
      r.id !== numId && r.date === date && weightsEqual(r.weights, weights)
    );
    if (dup) {
      const typeLabel = editType === 'delivery' ? 'Giao' : editType === 'pickup' ? 'Lấy' : 'Hoàn';
      alert(`🚫 Không thể lưu!\n\nBản ghi ${typeLabel} ngày ${formatDateDisplay(date)} đã tồn tại với CÙNG số liệu.\n\nHãy sửa số liệu khác hoặc xóa bản ghi cũ trước.`);
      return;
    }

    const oldRecord = deepClone(state.appData[editType][idx]);
    state.appData[editType][idx].date    = date;
    state.appData[editType][idx].weights = weights;

    pushUndo({
      msg: `Đã sửa bản ghi ${formatDateDisplay(date)}`,
      restore: () => {
        const i = state.appData[editType].findIndex(it => it.id === numId);
        if (i !== -1) state.appData[editType][i] = oldRecord;
      }
    });
  } else {
    // === THÊM MỚI ===
    const delW  = parseWeights('del_inp');
    const pickW = parseWeights('pick_inp');
    const retW  = parseWeights('ret_inp');
    const delT  = Object.values(delW).reduce((a, b) => a + b, 0);
    const pickT = Object.values(pickW).reduce((a, b) => a + b, 0);
    const retT  = Object.values(retW).reduce((a, b) => a + b, 0);
    if (delT + pickT + retT === 0) { alert('Chưa nhập số liệu nào!'); return; }

    const dups = [];
    if (delT  > 0 && findDuplicate('delivery', date, delW))  dups.push('Giao');
    if (pickT > 0 && findDuplicate('pickup',   date, pickW)) dups.push('Lấy');
    if (retT  > 0 && findDuplicate('return',   date, retW))  dups.push('Hoàn');

    if (dups.length > 0) {
      alert(`🚫 Không thể lưu!\n\nNgày ${formatDateDisplay(date)} đã tồn tại bản ghi ${dups.join(', ')} với CÙNG số liệu.\n\nHãy:\n• Sửa số liệu khác\n• Hoặc xóa bản ghi cũ trước`);
      return;
    }

    const addedIds = [];
    if (delT  > 0) {
      const id = generateId();
      state.appData.delivery.unshift({ id, date, weights: delW });
      addedIds.push({ type: 'delivery', id });
    }
    if (pickT > 0) {
      const id = generateId();
      state.appData.pickup.unshift({ id, date, weights: pickW });
      addedIds.push({ type: 'pickup', id });
    }
    if (retT  > 0) {
      const id = generateId();
      state.appData.return.unshift({ id, date, weights: retW });
      addedIds.push({ type: 'return', id });
    }

    pushUndo({
      msg: `Đã thêm ${addedIds.length} bản ghi ngày ${formatDateDisplay(date)}`,
      restore: () => {
        addedIds.forEach(({ type, id }) => {
          state.appData[type] = state.appData[type].filter(it => it.id !== id);
        });
      }
    });
  }

  closeModal(true);
  updateAllViews();

  if (wasFromBatch) {
    setTimeout(() => backToBatch(), 200);
  }
}

export function deleteRecord(type, id) {
  const arr = state.appData[type];
  const idx = arr.findIndex(it => it.id === id);
  if (idx === -1) return;
  if (!confirm('Bạn muốn xóa bản ghi này?')) return;

  const removed = deepClone(arr[idx]);
  const typeLabel = type === 'delivery' ? 'Giao' : type === 'pickup' ? 'Lấy' : 'Hoàn';

  pushUndo({
    msg: `Đã xóa bản ghi ${typeLabel} ngày ${formatDateDisplay(removed.date)}`,
    restore: () => {
      state.appData[type].splice(idx, 0, removed);
    }
  });

  arr.splice(idx, 1);
  updateAllViews();
}

export function clearAllHistory() {
  const total = state.appData.delivery.length + state.appData.pickup.length + state.appData.return.length;
  if (total === 0) return;
  if (!confirm('Bạn chắc chắn muốn xóa toàn bộ lịch sử?\nBản sao lưu tự động cũng sẽ bị xóa.')) return;

  const backup = deepClone(state.appData);
  const vaultBackup = localStorage.getItem('spx_backup_vault');

  pushUndo({
    msg: `Đã xóa ${total} bản ghi`,
    restore: () => {
      state.appData = backup;
      if (vaultBackup) localStorage.setItem('spx_backup_vault', vaultBackup);
    }
  });

  state.appData = { delivery: [], pickup: [], return: [] };
  localStorage.removeItem('spx_backup_vault');
  localStorage.removeItem('spx_dual_records');
  updateAllViews();
}