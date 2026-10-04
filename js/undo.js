import { showAlert } from './dialog.js';

const undoStack = [];
const MAX_UNDO = 5;
let undoTimer = null;

export function pushUndo({ msg, restore }) {
  undoStack.push({ msg, restore });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  showBanner(msg);
}

export async function undoLast() {
  const action = undoStack.pop();
  if (!action) return;
  try {
    action.restore();
    hideBanner();
    const { updateAllViews } = await import('./render.js');
    updateAllViews();
  } catch (e) {
    console.error('Undo failed:', e);
    await showAlert('Không thể hoàn tác: ' + e.message, {
      title: 'Lỗi hoàn tác',
      okText: 'Đóng'
    });
  }
}

export function clearUndoStack() {
  undoStack.length = 0;
  hideBanner();
}

function showBanner(msg) {
  const banner = document.getElementById('undoBanner');
  if (!banner) return;
  const msgEl = document.getElementById('undoMsg');
  if (msgEl) msgEl.innerText = msg;
  banner.classList.add('active');

  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideBanner, 5000);
}

function hideBanner() {
  const banner = document.getElementById('undoBanner');
  if (banner) banner.classList.remove('active');
  clearTimeout(undoTimer);
}