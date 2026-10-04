// ==================== DIALOG MODULE ====================
// Thay thế alert() / confirm() bằng custom modal đẹp
// API:
//   await showAlert(message, { title, okText })
//   const ok = await showConfirm(message, { title, okText, cancelText, danger })
// ======================================================

let _currentResolve = null;
let _currentType = 'alert';   // 'alert' | 'confirm'

export function isDialogOpen() {
  return _currentResolve !== null;
}

/**
 * Hiện dialog thông báo (thay alert())
 * @param {string} message
 * @param {object} [options] { title, okText }
 * @returns {Promise<void>}
 */
export function showAlert(message, options = {}) {
  return new Promise(resolve => {
    _openDialog({
      type: 'alert',
      title: options.title || 'Thông báo',
      message: String(message),
      okText: options.okText || 'OK',
      cancelText: '',
      danger: false,
      resolve
    });
  });
}

/**
 * Hiện dialog xác nhận (thay confirm())
 * @param {string} message
 * @param {object} [options] { title, okText, cancelText, danger }
 * @returns {Promise<boolean>}
 */
export function showConfirm(message, options = {}) {
  return new Promise(resolve => {
    _openDialog({
      type: 'confirm',
      title: options.title || 'Xác nhận',
      message: String(message),
      okText: options.okText || 'Đồng ý',
      cancelText: options.cancelText || 'Hủy',
      danger: !!options.danger,
      resolve
    });
  });
}

/**
 * Mở dialog nội bộ
 */
function _openDialog({ type, title, message, okText, cancelText, danger, resolve }) {
  // Nếu đang có dialog mở → tự đóng với kết quả mặc định (false / undefined)
  if (_currentResolve) {
    const prevResolve = _currentResolve;
    const prevType = _currentType;
    _currentResolve = null;
    _currentType = 'alert';
    prevResolve(prevType === 'confirm' ? false : undefined);
  }

  _currentResolve = resolve;
  _currentType = type;

  const shade    = document.getElementById('dialogModal');
  const titleEl  = document.getElementById('dialogTitle');
  const msgEl    = document.getElementById('dialogMessage');
  const iconEl   = document.getElementById('dialogIcon');
  const okBtn    = document.getElementById('dialogOkBtn');
  const cancelBtn = document.getElementById('dialogCancelBtn');

  // Fallback nếu HTML chưa có dialog modal
  if (!shade || !titleEl || !msgEl || !okBtn || !cancelBtn) {
    console.warn('[Dialog] Modal chưa có trong HTML → fallback về native');
    _currentResolve = null;
    if (type === 'confirm') {
      resolve(window.confirm(message));
    } else {
      window.alert(message);
      resolve(undefined);
    }
    return;
  }

  // Set nội dung
  titleEl.innerText = title;
  msgEl.innerText = message;
  okBtn.innerText = okText;

  // Icon theo loại
  if (iconEl) {
    if (danger) iconEl.innerText = '⚠️';
    else if (type === 'confirm') iconEl.innerText = '❓';
    else iconEl.innerText = 'ℹ️';
  }

  // Style danger cho nút OK
  okBtn.classList.toggle('dialog-btn-danger', danger);

  // Cancel button
  if (type === 'confirm') {
    cancelBtn.style.display = '';
    cancelBtn.innerText = cancelText;
  } else {
    cancelBtn.style.display = 'none';
  }

  shade.classList.add('active');
}

/**
 * Đóng dialog hiện tại với kết quả
 * @param {*} result - true/false cho confirm, undefined cho alert
 */
export function closeDialog(result) {
  const shade = document.getElementById('dialogModal');
  if (shade) shade.classList.remove('active');

  if (_currentResolve) {
    const resolve = _currentResolve;
    const type = _currentType;
    _currentResolve = null;
    _currentType = 'alert';
    resolve(type === 'confirm' ? !!result : undefined);
  }
}

// ==================== GLOBAL HANDLERS (cho onclick) ====================
// Expose ra window để HTML gọi được
if (typeof window !== 'undefined') {
  window.dialogOk = () => closeDialog(true);
  window.dialogCancel = () => closeDialog(false);

  // Đóng khi click backdrop
  document.addEventListener('DOMContentLoaded', () => {
    const shade = document.getElementById('dialogModal');
    if (shade) {
      shade.addEventListener('click', e => {
        if (e.target === shade) {
          closeDialog(false);
        }
      });
    }
  });

  // Đóng khi nhấn Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _currentResolve) {
      closeDialog(false);
    }
  });
}