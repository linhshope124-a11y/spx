import {
  state,
  persistData,
  persistSalaryByMonth,
  persistRankByMonth
} from './state.js';
import { STORAGE_KEYS, APP_VERSION } from './config.js';
import { applyImportedPayload, askImportMode } from './backup.js';
import { updateAllViews } from './render.js';
import { showAlert, showConfirm } from './dialog.js';

const GH_API = 'https://api.github.com';
const GIST_FILENAME = 'spx-tracker-backup.json';

const getToken    = () => localStorage.getItem('spx_gh_token') || '';
const getGistId   = () => localStorage.getItem('spx_gist_id') || '';
const isAutoBackup = () => localStorage.getItem('spx_auto_backup') === '1';

function setStatus(msg, type) {
  const el = document.getElementById('cloudStatus');
  if (!el) return;
  el.className = 'cloud-status ' + (type || 'idle');
  el.innerText = msg;
}

function buildPayload() {
  return {
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      rankByMonth:   state.rankByMonth,
      salaryByMonth: state.salaryByMonth,
      salaryDays:    state.salaryDays,
      region:        state.region,
      theme:         localStorage.getItem(STORAGE_KEYS.theme) || 'light'
    },
    data: state.appData
  };
}

// ==================== TEST CONNECTION ====================
export async function testCloudConnection() {
  const input = document.getElementById('ghTokenInput');
  const token = (input?.value || '').trim() || getToken();

  if (!token) { setStatus('❌ Chưa nhập token', 'err'); return; }
  setStatus('⏳ Đang kiểm tra...', 'idle');
  try {
    const res = await fetch(`${GH_API}/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok) throw new Error('Token sai hoặc hết hạn');
    const user = await res.json();
    localStorage.setItem('spx_gh_token', token);
    if (input) input.value = '';
    updateTokenUI();
    setStatus(`✅ OK — ${user.login}`, 'ok');
  } catch (e) {
    setStatus(`❌ ${e.message}`, 'err');
  }
}

// ==================== PUSH TO CLOUD ====================
export async function pushToCloud() {
  const input = document.getElementById('ghTokenInput');
  const token = (input?.value || '').trim() || getToken();

  if (!token) { setStatus('❌ Chưa có token', 'err'); return; }

  if (input?.value?.trim()) {
    localStorage.setItem('spx_gh_token', input.value.trim());
    input.value = '';
    updateTokenUI();
  }

  let gistId = (document.getElementById('gistIdInput')?.value.trim()) || getGistId();
  const payload = buildPayload();
  setStatus('⏳ Đang backup...', 'idle');

  try {
    let res;
    if (gistId) {
      res = await fetch(`${GH_API}/gists/${gistId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          files: { [GIST_FILENAME]: { content: JSON.stringify(payload, null, 2) } }
        })
      });
    } else {
      res = await fetch(`${GH_API}/gists`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          description: 'SPX Tracker auto-backup',
          public: false,
          files: { [GIST_FILENAME]: { content: JSON.stringify(payload, null, 2) } }
        })
      });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const gist = await res.json();
    localStorage.setItem('spx_gist_id', gist.id);
    const gistInput = document.getElementById('gistIdInput');
    if (gistInput) gistInput.value = gist.id;

    const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    localStorage.setItem('spx_last_backup', now);
    setStatus(`✅ Đã backup lúc ${now}`, 'ok');
  } catch (e) {
    setStatus(`❌ Lỗi: ${e.message}`, 'err');
  }
}

// ==================== PULL FROM CLOUD ====================
export async function pullFromCloud() {
  const input = document.getElementById('ghTokenInput');
  const token = (input?.value || '').trim() || getToken();
  const gistId = (document.getElementById('gistIdInput')?.value.trim()) || getGistId();

  if (!token || !gistId) { setStatus('❌ Chưa cấu hình token/gist', 'err'); return; }

  const ok = await showConfirm(
    'Khôi phục từ Cloud sẽ áp dụng dữ liệu từ Gist.\n\nTiếp tục?',
    { title: 'Khôi phục từ Cloud', okText: 'Khôi phục', cancelText: 'Hủy' }
  );
  if (!ok) return;

  if (input?.value?.trim()) {
    localStorage.setItem('spx_gh_token', input.value.trim());
    input.value = '';
    updateTokenUI();
  }

  setStatus('⏳ Đang tải...', 'idle');
  try {
    const res = await fetch(`${GH_API}/gists/${gistId}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const gist = await res.json();
    const content = gist.files[GIST_FILENAME]?.content;
    if (!content) throw new Error('Không tìm thấy dữ liệu trong Gist');

    const parsed = JSON.parse(content);
    if (!parsed.data || !parsed.data.delivery) throw new Error('Dữ liệu không hợp lệ');

    const newCount = (parsed.data.delivery?.length || 0)
                   + (parsed.data.pickup?.length   || 0)
                   + (parsed.data.return?.length   || 0);
    const mode = await askImportMode(newCount);
    if (mode === 'cancel') { setStatus('Đã hủy', 'idle'); return; }

    const result = applyImportedPayload(parsed, mode);
    if (!result.success) throw new Error('Áp dụng dữ liệu thất bại');

    persistData();

    const { initRankUI, initRegionUI } = await import('./ui.js');
    const { updateAllViews } = await import('./render.js');
    initRankUI();
    initRegionUI();
    updateAllViews();

    const doneMsg = mode === 'overwrite'
      ? `Đã GHI ĐÈ từ Cloud: ${result.addedCount} bản ghi`
      : `Đã THÊM VÀO từ Cloud: +${result.addedCount} bản ghi` +
        (result.removedCount > 0 ? `\nBỏ qua ${result.removedCount} trùng` : '');

    setStatus('✅ Khôi phục thành công!', 'ok');
    await showAlert(doneMsg, { title: '✅ Hoàn tất', okText: 'OK' });
  } catch (e) {
    setStatus(`❌ Lỗi: ${e.message}`, 'err');
  }
}

// ==================== TOKEN MANAGEMENT ====================
function updateTokenUI() {
  const hasToken = Boolean(getToken());
  const wrapper = document.getElementById('tokenStatusWrap');
  const savedLabel = document.getElementById('tokenSavedLabel');
  const clearBtn = document.getElementById('clearTokenBtn');

  if (wrapper) wrapper.style.display = hasToken ? 'flex' : 'none';
  if (savedLabel) savedLabel.textContent = hasToken ? '✅ Đã lưu token' : '';
  if (clearBtn) clearBtn.style.display = hasToken ? 'inline-flex' : 'none';
}

export async function clearCloudToken() {
  if (!getToken()) return;

  const ok = await showConfirm(
    'Xóa token GitHub đã lưu?\n\nBạn sẽ cần nhập lại token để backup Cloud.',
    {
      title: '🗑️ Xóa token',
      okText: 'Xóa',
      cancelText: 'Hủy',
      danger: true
    }
  );
  if (!ok) return;

  localStorage.removeItem('spx_gh_token');
  const input = document.getElementById('ghTokenInput');
  if (input) input.value = '';
  updateTokenUI();
  setStatus('Đã xóa token', 'idle');
}

// ==================== INIT CLOUD UI ====================
export function initCloudUI() {
  const gistId = getGistId();
  const autoBackup = isAutoBackup();
  const hasToken = Boolean(getToken());

  const tokenInput = document.getElementById('ghTokenInput');
  const gistInput  = document.getElementById('gistIdInput');
  const toggle     = document.getElementById('autoBackupToggle');

  if (tokenInput) {
    tokenInput.value = '';
    if (hasToken) {
      tokenInput.placeholder = '•••••••• (đã lưu — để trống nếu không đổi)';
    } else {
      tokenInput.placeholder = 'ghp_... (dán token mới)';
    }
  }

  if (gistInput) gistInput.value = gistId;

  if (toggle) {
    toggle.checked = autoBackup;
    toggle.onchange = () => {
      localStorage.setItem('spx_auto_backup', toggle.checked ? '1' : '0');
      setStatus(toggle.checked ? '✅ Đã bật auto-backup' : 'Đã tắt auto-backup', toggle.checked ? 'ok' : 'idle');
    };
  }

  updateTokenUI();

  if (!hasToken) {
    setStatus('Chưa cấu hình — cần tạo token', 'idle');
  } else if (!gistId) {
    setStatus('Đã có token — bấm "Backup" để tạo Gist lần đầu', 'idle');
  } else {
    const last = localStorage.getItem('spx_last_backup');
    setStatus(last ? `✅ Backup cuối: ${last}` : '✅ Đã cấu hình', 'ok');
  }
}

// ==================== AUTO BACKUP ====================
let autoBackupTimer = null;
export function scheduleAutoBackup() {
  if (!isAutoBackup() || !getToken()) return;
  clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(() => {
    pushToCloud().catch(e => console.warn('[Cloud] Auto-backup failed:', e));
  }, 10000);
}

window.addEventListener('spx:datachanged', scheduleAutoBackup);