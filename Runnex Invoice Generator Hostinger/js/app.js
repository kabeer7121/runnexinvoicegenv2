/* Runnex Logistics Invoice Generator — shared utilities */

// ============ API HELPER ============
const api = {
  async get(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  },

  async post(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'same-origin'
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Request failed');
    return json;
  },

  async put(url, data) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'same-origin'
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Request failed');
    return json;
  },

  async delete(url) {
    const res = await fetch(url, { method: 'DELETE', credentials: 'same-origin' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Request failed');
    return json;
  },

  async postForm(url, formData) {
    const res = await fetch(url, { method: 'POST', body: formData, credentials: 'same-origin' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Request failed');
    return json;
  }
};

/** PDF / print: show Runnex Logistics instead of legacy Invoice Pilot names from settings */
function resolvePdfCompanyName(co) {
  const brand = 'Runnex Logistics';
  if (!co || co.company_name == null || String(co.company_name).trim() === '') return brand;
  const raw = String(co.company_name).trim();
  if (/invoice[\s_-]*pilot/i.test(raw)) return brand;
  return raw;
}
window.resolvePdfCompanyName = resolvePdfCompanyName;

/**
 * Bottom-left payment / wire instructions (mirrors total dispatch fee row height).
 * @returns {{ rowHeight: number }} row height in mm; 0 if nothing drawn
 */
function drawInvoicePdfPaymentBlock(doc, options) {
  const { margin, pageW, y, paymentAccount, redBoxWidth = 65, gap = 8 } = options;
  const LIGHT_GRAY = [240, 240, 240];
  const GRAY = [100, 100, 100];
  const DARK = [15, 15, 15];

  if (!paymentAccount || !String(paymentAccount.details || '').trim()) {
    return { rowHeight: 0 };
  }

  const payBoxW = Math.max(42, pageW - margin * 2 - redBoxWidth - gap);
  const pad = 5;
  const innerW = payBoxW - pad * 2;
  const details = String(paymentAccount.details || '').trim();
  const title = (String(paymentAccount.label || '').trim() || 'Payment details').toUpperCase();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  const titleLines = doc.splitTextToSize(title, innerW);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  const bodyLines = doc.splitTextToSize(details.toUpperCase(), innerW);
  const lineH = 3.6;
  const boxH = Math.max(30, pad * 2 + titleLines.length * lineH + 2 + bodyLines.length * lineH);

  doc.setFillColor(...LIGHT_GRAY);
  doc.roundedRect(margin, y, payBoxW, boxH, 2, 2, 'F');

  let ty = y + pad + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  titleLines.forEach((ln) => {
    doc.text(ln, margin + pad, ty);
    ty += lineH;
  });
  ty += 1;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...DARK);
  bodyLines.forEach((ln) => {
    doc.text(ln, margin + pad, ty);
    ty += lineH;
  });

  return { rowHeight: boxH };
}
window.drawInvoicePdfPaymentBlock = drawInvoicePdfPaymentBlock;

// ============ TOAST ============
function initToasts() {
  if (!document.getElementById('toast-container')) {
    const el = document.createElement('div');
    el.id = 'toast-container';
    document.body.appendChild(el);
  }
}

function showToast(message, type = 'info', duration = 3500) {
  initToasts();
  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠'
  };
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span style="font-size:16px;font-weight:700">${icons[type]||'•'}</span> ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============ THEME ============
function initTheme() {
  const saved = localStorage.getItem('ip-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeToggle(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ip-theme', next);
  updateThemeToggle(next);
}

function updateThemeToggle(theme) {
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.innerHTML = theme === 'dark'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> Light'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg> Dark';
  }
}

// ============ AUTH ============
let _currentUser = null;

async function requireLogin(requiredRole) {
  try {
    _currentUser = await api.get('/api/auth/me');
    if (requiredRole && _currentUser.role !== requiredRole) {
      if (_currentUser.role === 'admin') window.location.href = '/admin';
      else window.location.href = '/agent';
      return null;
    }
    return _currentUser;
  } catch {
    window.location.href = '/login';
    return null;
  }
}

async function logout() {
  try {
    await api.post('/api/auth/logout', {});
  } catch {}
  window.location.href = '/login';
}

function getCurrentUser() { return _currentUser; }

function ensureChangePasswordModal() {
  if (document.getElementById('change-password-modal')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
<div class="modal-overlay" id="change-password-modal" onclick="closeModalOnOverlay(event)" style="display:none">
  <div class="modal" style="max-width:420px;width:95%">
    <div class="modal-header">
      <span class="modal-title">Change password</span>
      <button type="button" class="modal-close" onclick="closeModal('change-password-modal')">&times;</button>
    </div>
    <div class="modal-body">
      <form id="change-password-form" onsubmit="submitChangePassword(event)">
        <div class="form-group">
          <label class="form-label">Current password</label>
          <input type="password" id="cp-current" class="form-control" autocomplete="current-password" required>
        </div>
        <div class="form-group">
          <label class="form-label">New password</label>
          <input type="password" id="cp-new" class="form-control" autocomplete="new-password" required minlength="6">
        </div>
        <div class="form-group">
          <label class="form-label">Confirm new password</label>
          <input type="password" id="cp-new2" class="form-control" autocomplete="new-password" required minlength="6">
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;color:var(--text-muted);cursor:pointer">
          <input type="checkbox" id="cp-show-password" onchange="toggleChangePasswordFields()"> Show passwords
        </label>
        <div id="cp-error" style="display:none;color:var(--red);font-size:13px;margin-bottom:12px"></div>
        <div class="modal-footer" style="padding:0;margin-top:16px;border:0;justify-content:flex-end;gap:8px">
          <button type="button" class="btn btn-secondary" onclick="closeModal('change-password-modal')">Cancel</button>
          <button type="submit" class="btn btn-primary" id="cp-submit">Save password</button>
        </div>
      </form>
    </div>
  </div>
</div>`;
  document.body.appendChild(wrap.firstElementChild);
}

function openChangePasswordModal() {
  ensureChangePasswordModal();
  const f = document.getElementById('change-password-form');
  const err = document.getElementById('cp-error');
  if (f) f.reset();
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  toggleChangePasswordFields();
  openModal('change-password-modal');
}

function toggleChangePasswordFields() {
  const show = document.getElementById('cp-show-password');
  const ids = ['cp-current', 'cp-new', 'cp-new2'];
  const nextType = show && show.checked ? 'text' : 'password';
  ids.forEach(id => {
    const input = document.getElementById(id);
    if (input) input.type = nextType;
  });
}

async function submitChangePassword(e) {
  e.preventDefault();
  const errEl = document.getElementById('cp-error');
  const btn = document.getElementById('cp-submit');
  const cur = document.getElementById('cp-current').value;
  const nw = document.getElementById('cp-new').value;
  const nw2 = document.getElementById('cp-new2').value;
  errEl.style.display = 'none';
  if (nw !== nw2) {
    errEl.textContent = 'New passwords do not match.';
    errEl.style.display = 'block';
    return;
  }
  btn.disabled = true;
  try {
    await api.post('/api/auth/change-password', { current_password: cur, new_password: nw });
    closeModal('change-password-modal');
    showToast('Password updated.', 'success');
  } catch (err) {
    errEl.textContent = err.message || 'Could not update password';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

// ============ MODAL HELPERS ============
function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.style.display = 'flex';
  requestAnimationFrame(() => overlay.classList.add('show'));
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('show');
  setTimeout(() => overlay.style.display = 'none', 200);
}

function closeModalOnOverlay(e) {
  if (e.target === e.currentTarget) closeModal(e.currentTarget.id);
}

// ============ FORMAT HELPERS ============
function formatCurrency(val, currency = 'USD') {
  const num = parseFloat(val) || 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num);
}

function formatNumber(val, decimals = 2) {
  const num = parseFloat(val) || 0;
  return num.toFixed(decimals);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}

// ============ NAV ACTIVE STATE ============
function setActiveNav(id) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ============ RENDER USER CHIP ============
function renderUserChip(user) {
  const initials = (user.full_name || user.username).split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  const el = document.getElementById('user-chip-container');
  if (!el) return;
  el.innerHTML = `
    <div class="user-chip">
      <div class="user-avatar">${initials}</div>
      <div class="user-info">
        <div class="user-name">${escHtml(user.full_name || user.username)}</div>
        <div class="user-role">${escHtml(user.role)}</div>
      </div>
      <button type="button" class="btn-logout" onclick="openChangePasswordModal()" title="Change password" style="margin-right:2px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </button>
      <button class="btn-logout" onclick="logout()" title="Logout">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
        </svg>
      </button>
    </div>
  `;
}

function toggleMobileSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
}

function closeMobileSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
}

// Init on load
initTheme();
