/* Runnex Logistics Invoice Generator — Agent workflow */

function parseMoney(val) {
  if (val == null || val === '') return 0;
  const s = String(val).trim().replace(/\$/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function numericCell(row, col) {
  const raw = row[col.name];
  if (raw == null || raw === '') return 0;
  if (col.col_type === 'number') return parseFloat(raw) || 0;
  return parseMoney(raw);
}

function colKey(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, '_').trim();
}

function isMilesColumnName(name) {
  const k = colKey(name);
  return k === 'miles' || k === 'mileage' || k === 'loaded_miles' || k === 'distance' || k === 'total_miles';
}

function isRateColumnName(name) {
  const k = colKey(name);
  return k === 'rate' || k === 'line_haul' || k === 'linehaul' || k === 'total_rate' || k === 'haul_rate';
}

function isRpmColumnName(name) {
  const k = colKey(name);
  return k === 'rpm' || k === 'rate_per_mile' || k === 'rev_per_mile';
}

function computeRowRpm(rowData, columns) {
  let miles = 0;
  let rate = 0;
  (columns || []).forEach((c) => {
    if (isMilesColumnName(c.name)) miles += numericCell(rowData, c);
    if (isRateColumnName(c.name)) rate += numericCell(rowData, c);
  });
  if (!Number.isFinite(miles) || miles <= 0 || !Number.isFinite(rate)) return '';
  return (rate / miles).toFixed(3);
}

function recomputeDerivedForRow(table, rowData) {
  if (!table || !rowData) return;
  const rpm = computeRowRpm(rowData, table.columns || []);
  (table.columns || []).forEach((c) => {
    if (!isRpmColumnName(c.name)) return;
    const hasManualValue = String(rowData[c.name] == null ? '' : rowData[c.name]).trim() !== '';
    // Keep agent-entered RPM values; only auto-fill when empty.
    if (!hasManualValue) rowData[c.name] = rpm;
  });
}

function recomputeDerivedForTable(table) {
  if (!table) return;
  const rows = invoiceRows[table.id] || [];
  rows.forEach((r) => recomputeDerivedForRow(table, r));
}

function syncDerivedRowInputs(tableId, rowIndex, rowData) {
  const rowEl = document.getElementById(`row-${tableId}-${rowIndex}`);
  if (!rowEl || !rowData) return;
  const inputs = rowEl.querySelectorAll('input[data-col]');
  inputs.forEach((el) => {
    const col = String(el.dataset.col || '');
    if (isRpmColumnName(col)) el.value = String(rowData[col] || '');
  });
}

function getDispatchFeeOverrideValue() {
  const el = document.getElementById('dispatch-fee-override');
  if (!el) return null;
  const raw = String(el.value || '').trim();
  if (!raw) return null;
  const n = parseMoney(raw);
  return Number.isFinite(n) ? n : null;
}

function getDraftMetaFromNotes(notes) {
  try {
    const obj = notes ? JSON.parse(notes) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch (_) {
    return {};
  }
}

function buildDraftNotesMeta() {
  const override = getDispatchFeeOverrideValue();
  return JSON.stringify({
    dispatch_fee_override: override != null ? override : null,
  });
}

let myClients = [];
let templates = [];
let extracted = {};
let pendingBatchResults = [];
let currentDraftId = null;
let companySettings = {};
let paymentAccounts = [];
let invoiceRows = {}; // tableId -> array of row objects
let currentClientReport = null;
let calcExpr = '0';

function setCalcDisplay(v) {
  const el = document.getElementById('calc-display');
  if (el) el.value = v;
}

function calcIsOpen() {
  const pop = document.getElementById('calc-pop');
  return !!(pop && pop.style.display === 'block');
}

function openCalculator() {
  const pop = document.getElementById('calc-pop');
  if (!pop) return;
  pop.style.display = 'block';
  pop.setAttribute('aria-hidden', 'false');
  try {
    pop.focus({ preventScroll: true });
  } catch (_) {
    pop.focus();
  }
}

function closeCalculator() {
  const pop = document.getElementById('calc-pop');
  if (!pop) return;
  pop.style.display = 'none';
  pop.setAttribute('aria-hidden', 'true');
}

function toggleCalculator() {
  if (calcIsOpen()) closeCalculator();
  else openCalculator();
}

/**
 * Evaluate arithmetic without eval/Function (works with strict CSP on Hostinger).
 * Percent behavior matches normal calculators:
 * - 5000-95% => 250 (95% of 5000 is subtracted)
 * - 5000+10% => 5500
 * - 200*10% => 20
 * - 200/10% => 2000
 */
function calcEvaluateExpression(raw) {
  let s = String(raw || '').replace(/\s+/g, '');
  // Trim only trailing binary operators; keep '%' because it's a valid postfix percent.
  s = s.replace(/[+\-*/.]+$/, '');
  if (s === '') return 0;
  if (!/^[0-9+\-*/.%()]+$/.test(s)) return NaN;

  let depth = 0;
  for (let j = 0; j < s.length; j++) {
    if (s[j] === '(') depth++;
    else if (s[j] === ')') {
      depth--;
      if (depth < 0) return NaN;
    }
  }
  if (depth !== 0) return NaN;

  let i = 0;
  const peek = () => s[i] || '';

  const parsePrimary = () => {
    if (peek() === '-') {
      i++;
      const p = parsePrimary();
      return { value: -p.value, percent: p.percent };
    }
    if (peek() === '+') {
      i++;
      return parsePrimary();
    }
    if (peek() === '(') {
      i++;
      const v = parseExpr();
      if (peek() !== ')') throw new Error('paren');
      i++;
      let out = { value: v, percent: false };
      while (peek() === '%') {
        i++;
        out = { value: out.value, percent: true };
      }
      return out;
    }
    const start = i;
    if (!/[\d.]/.test(peek())) throw new Error('num');
    while (i < s.length && /[\d.]/.test(s[i])) i++;
    const num = parseFloat(s.slice(start, i));
    if (!Number.isFinite(num)) throw new Error('nan');
    let out = { value: num, percent: false };
    while (peek() === '%') {
      i++;
      out = { value: out.value, percent: true };
    }
    return out;
  };

  const asFactor = (obj) => (obj.percent ? obj.value / 100 : obj.value);

  const parseMul = () => {
    let left = parsePrimary();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++];
      const right = parsePrimary();
      const l = asFactor(left);
      const r = asFactor(right);
      const v = op === '*' ? l * r : (r === 0 ? NaN : l / r);
      left = { value: v, percent: false };
    }
    return left;
  };

  const parseExpr = () => {
    let left = parseMul();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const right = parseMul();
      const base = left.value;
      const addSubValue = right.percent ? (base * right.value) / 100 : right.value;
      const v = op === '+' ? base + addSubValue : base - addSubValue;
      left = { value: v, percent: false };
    }
    return left.value;
  };

  try {
    const val = parseExpr();
    if (i !== s.length) return NaN;
    return Number.isFinite(val) ? val : NaN;
  } catch (_) {
    return NaN;
  }
}

function formatCalcNumber(n) {
  if (!Number.isFinite(n)) return 'Error';
  const rounded = Math.round(n * 1e12) / 1e12;
  let out = String(rounded);
  if (out.includes('e')) out = Number(rounded.toPrecision(12)).toString();
  return out;
}

function calcPress(key) {
  const k = String(key || '');
  if (k === 'C') {
    calcExpr = '0';
    setCalcDisplay(calcExpr);
    return;
  }
  if (k === 'BS') {
    calcExpr = calcExpr.length > 1 ? calcExpr.slice(0, -1) : '0';
    setCalcDisplay(calcExpr);
    return;
  }
  if (k === '=') {
    const result = calcEvaluateExpression(calcExpr);
    const shown = formatCalcNumber(result);
    setCalcDisplay(shown);
    calcExpr = shown === 'Error' ? '0' : shown;
    return;
  }
  if (calcExpr === '0' || calcExpr === 'Error') calcExpr = '';
  calcExpr += k;
  setCalcDisplay(calcExpr || '0');
}

const CALC_CODE_MAP = {
  Numpad0: '0',
  Numpad1: '1',
  Numpad2: '2',
  Numpad3: '3',
  Numpad4: '4',
  Numpad5: '5',
  Numpad6: '6',
  Numpad7: '7',
  Numpad8: '8',
  Numpad9: '9',
  NumpadDecimal: '.',
  Digit0: '0',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
  Period: '.',
  NumpadAdd: '+',
  NumpadSubtract: '-',
  NumpadMultiply: '*',
  NumpadDivide: '/',
};

function onCalculatorGlobalKeydown(e) {
  if (!calcIsOpen()) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    closeCalculator();
    return;
  }

  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
    const pop = document.getElementById('calc-pop');
    if (!pop || !pop.contains(t)) return;
  }

  if (e.code === 'NumpadEnter' || e.code === 'Enter') {
    e.preventDefault();
    calcPress('=');
    return;
  }
  if (e.key === 'Backspace') {
    e.preventDefault();
    calcPress('BS');
    return;
  }
  if (e.key === 'Delete') {
    e.preventDefault();
    calcPress('C');
    return;
  }

  let sym = CALC_CODE_MAP[e.code];
  if (!sym) {
    if (e.key >= '0' && e.key <= '9') sym = e.key;
    else if (e.key === '.' || e.key === ',') sym = '.';
    else if (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/') sym = e.key;
    else if (e.key === '%') sym = '%';
    else if (e.key === '(' || e.key === ')') sym = e.key;
    else if (e.key === '=' && !e.shiftKey) {
      e.preventDefault();
      calcPress('=');
      return;
    }
  }

  if (sym) {
    e.preventDefault();
    calcPress(sym);
  }
}

function debounceAgent(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

const debouncedLoadDraftsList = debounceAgent(() => loadDraftsList(), 320);

// ============ INIT ============
async function init() {
  const user = await requireLogin();
  if (!user) return;
  renderUserChip(user);

  const invSearch = document.getElementById('agent-invoices-search');
  if (invSearch) {
    invSearch.addEventListener('input', debouncedLoadDraftsList);
  }
  document.addEventListener('click', (e) => {
    const pop = document.getElementById('calc-pop');
    const fab = document.getElementById('calc-fab');
    if (!pop || !fab || pop.style.display !== 'block') return;
    const t = e.target;
    if (pop.contains(t) || fab.contains(t)) return;
    closeCalculator();
  });
  document.addEventListener('keydown', onCalculatorGlobalKeydown, true);
  setCalcDisplay(calcExpr);
  // Set today's date
  document.getElementById('invoice-date').valueAsDate = new Date();
  // Generate invoice number
  document.getElementById('invoice-number').value = 'INV-' + Date.now().toString().slice(-6);

  // Load data (payment accounts: dedicated refresh so errors aren’t silently dropped)
  [myClients, templates, companySettings] = await Promise.all([
    api.get('/api/clients'),
    api.get('/api/templates/tables'),
    api.get('/api/company').catch(() => ({})),
  ]);

  await refreshPaymentAccounts({ notifyFailure: true });

  renderClientDropdown();
  renderInvoiceTables();
  showExportButtons(false);

  // Check if loading a draft from URL
  const params = new URLSearchParams(window.location.search);
  const draftId = params.get('draft');
  if (draftId) {
    await loadDraft(draftId);
  }
}

function showSection(name) {
  closeMobileSidebar();
  document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
  document.getElementById('section-' + name).style.display = '';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('nav-' + name)?.classList.add('active');
  const titleMap = { new: 'New Invoice', drafts: 'My Drafts', reports: 'Client Reports' };
  document.getElementById('page-title').textContent = titleMap[name] || 'New Invoice';
  if (name === 'drafts') loadDraftsList();
  if (name === 'reports') renderReportClientDropdown();
  if (name === 'new') {
    showExportButtons(!!currentDraftId);
    refreshPaymentAccounts({ notifyFailure: false });
  }
}

function showExportButtons(show) {
  document.getElementById('btn-save-draft').style.display = show || hasAnyRows() ? '' : 'none';
  document.getElementById('btn-export-pdf').style.display = show || hasAnyRows() ? '' : 'none';
}

function hasAnyRows() {
  return Object.values(invoiceRows).some(rows => rows.length > 0);
}

// ============ CLIENT ============
function renderClientDropdown() {
  const sel = document.getElementById('client-select');
  sel.innerHTML = '<option value="">— Select Client —</option>';
  myClients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.company_name;
    sel.appendChild(opt);
  });
}

async function refreshPaymentAccounts(opts = {}) {
  const { notifyFailure = false } = opts;
  try {
    const rows = await api.get('/api/payment-accounts');
    paymentAccounts = Array.isArray(rows) ? rows : [];
  } catch (e) {
    paymentAccounts = [];
    if (notifyFailure) {
      showToast(
        'Payment accounts could not be loaded. Check that /api/payment-accounts works and the database migration was run. ' +
          (e.message || ''),
        'error'
      );
    }
  }
  renderPaymentAccountSelect();
}

function renderPaymentAccountSelect() {
  const sel = document.getElementById('payment-account-select');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— None —</option>';
  (paymentAccounts || []).forEach((p) => {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = p.label || `Account #${p.id}`;
    sel.appendChild(opt);
  });
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function getSelectedPaymentAccountForPdf() {
  const sel = document.getElementById('payment-account-select');
  if (!sel || !sel.value) return null;
  const id = parseInt(sel.value, 10);
  if (!id) return null;
  return paymentAccounts.find((p) => Number(p.id) === id) || null;
}

function onClientSelect() {
  const cid = parseInt(document.getElementById('client-select').value);
  const client = myClients.find(c => c.id === cid);
  const row = document.getElementById('client-info-row');
  if (client) {
    document.getElementById('ci-contact').textContent = client.contact_name || '—';
    document.getElementById('ci-company').textContent = client.company_name || '—';
    document.getElementById('ci-email').textContent = client.email || '—';
    document.getElementById('ci-phone').textContent = client.phone || '—';
    row.style.display = '';
  } else {
    row.style.display = 'none';
  }
  updateTotals();
}

// ============ FILE UPLOAD & PARSE ============
function onFileDrop(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.remove('dragover');
  const pdfs = Array.from(e.dataTransfer.files || []).filter(f => f.type === 'application/pdf');
  if (pdfs.length) processPDFFiles(pdfs);
  else showToast('Please drop one or more PDF files', 'error');
}

function isPdfFile(f) {
  if (!f || !f.name) return false;
  if (/\.pdf$/i.test(f.name)) return true;
  const t = (f.type || '').toLowerCase();
  return t === 'application/pdf' || t === 'application/x-pdf';
}

function onFileSelect(input) {
  const pdfs = Array.from(input.files || []).filter(isPdfFile);
  if (!pdfs.length) {
    showToast('No PDF files selected (.pdf)', 'warning');
    input.value = '';
    return;
  }
  processPDFFiles(pdfs);
  input.value = '';
}

function renderExtractionGrid(ext, conf) {
  const grid = document.getElementById('extraction-grid');
  const fields = [
    { key: 'origin', label: 'Origin' },
    { key: 'destination', label: 'Destination' },
    { key: 'miles', label: 'Miles' },
    { key: 'rate', label: 'Total rate' },
    { key: 'reference', label: 'Reference #' },
    { key: 'load_id', label: 'Load ID' },
    { key: 'broker_name', label: 'Broker name' },
    { key: 'commodity', label: 'Commodity' },
    { key: 'weight', label: 'Weight' }
  ];
  grid.innerHTML = fields.map(f => {
    const val = ext[f.key] || '';
    const c = conf[f.key] || 0;
    const pct = Math.round(c * 100);
    const cls = pct >= 80 ? 'high' : pct >= 50 ? 'medium' : 'low';
    return `<div style="background:var(--bg);border-radius:8px;padding:10px 12px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:4px">${f.label}</div>
      <input type="text" value="${escHtml(val)}" oninput="extracted['${f.key}']=this.value"
        style="background:transparent;border:none;outline:none;width:100%;font-size:13.5px;font-weight:600;color:var(--text-primary);"
        placeholder="Not found">
      <div class="confidence-bar"><div class="confidence-fill ${cls}" style="width:${pct}%"></div></div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${pct}% confidence</div>
    </div>`;
  }).join('');
}

function clearBatchPanel() {
  pendingBatchResults = [];
  const p = document.getElementById('batch-parse-panel');
  if (p) { p.style.display = 'none'; p.innerHTML = ''; }
}

function renderBatchPanel() {
  const el = document.getElementById('batch-parse-panel');
  if (!el || !pendingBatchResults.length) {
    if (el) el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  const ok = pendingBatchResults.filter(r => r.ok !== false);
  const failed = pendingBatchResults.filter(r => r.ok === false);
  el.innerHTML = `
    <div class="card-header">
      <span class="card-title">Parsed ${pendingBatchResults.length} PDF(s)</span>
    </div>
    <div class="card-body" style="padding-top:0">
      ${failed.length ? `<p style="font-size:13px;color:var(--amber);margin:12px 0">${failed.length} file(s) failed — add those loads manually.</p>` : ''}
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button type="button" class="btn btn-primary btn-sm" onclick="addAllBatchRows()" ${ok.length ? '' : 'disabled'}>Add all ${ok.length} to invoice table</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="clearBatchPanel()">Dismiss list</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead><tr><th>File</th><th>Route / status</th><th></th></tr></thead>
          <tbody>
            ${pendingBatchResults.map((r, i) => {
              if (r.ok === false) {
                const failMsg = r.claudeError || r.error || r.warning || 'Failed';
                return `<tr><td>${escHtml(r.fileName)}</td><td colspan="2" style="color:var(--red);word-break:break-word">${escHtml(failMsg)}</td></tr>`;
              }
              const ex = r.extracted || {};
              const route = `${escHtml(ex.origin || '—')} → ${escHtml(ex.destination || '—')}`;
              const metaParts = [];
              if (typeof r.textLength === 'number') metaParts.push(`${r.textLength} chars from PDF text`);
              if (r.claude) metaParts.push(r.claudeVia ? `Claude (${r.claudeVia})` : 'Claude');
              const meta = metaParts.length ? metaParts.join(' · ') : '';
              const warn =
                r.sparse && r.sparseReason
                  ? `<div class="text-sm" style="color:var(--amber);margin-top:4px">${escHtml(r.sparseReason)}</div>`
                  : '';
              const aiErr = r.claudeError
                ? `<div class="text-sm" style="color:var(--red);margin-top:4px;word-break:break-word">Claude: ${escHtml(r.claudeError)}</div>`
                : '';
              const extra = [ex.miles && `Mi: ${escHtml(ex.miles)}`, ex.reference && `Ref: ${escHtml(ex.reference)}`].filter(Boolean).join(' · ');
              return `<tr>
                <td><strong>${escHtml(r.fileName)}</strong>${meta ? `<div class="text-muted text-sm" style="margin-top:2px">${escHtml(meta)}</div>` : ''}${aiErr}</td>
                <td style="font-size:13px">${route}${extra ? `<div class="text-muted text-sm" style="margin-top:4px">${extra}</div>` : ''}${warn}</td>
                <td><button type="button" class="btn btn-ghost btn-sm" onclick="addRowFromBatchIndex(${i})">Add row</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function addRowFromBatchIndex(i) {
  const r = pendingBatchResults[i];
  if (!r || r.ok === false) return;
  addRowFromExtracted(r.extracted || {});
  showToast('Row added from ' + (r.fileName || 'PDF'), 'success');
}

function addAllBatchRows() {
  const ok = pendingBatchResults.filter(r => r.ok !== false);
  if (!ok.length) return;
  let emptyCells = 0;
  ok.forEach(r => {
    const ex = r.extracted || {};
    const has = ['origin', 'destination', 'miles', 'reference', 'rate'].some(k => String(ex[k] || '').trim());
    if (!has) emptyCells++;
    addRowFromExtracted(ex);
  });
  if (emptyCells > 0) {
    showToast(`Added ${ok.length} row(s). ${emptyCells} PDF(s) had no extracted fields — edit rows or check Claude errors above.`, 'warning');
  } else {
    showToast(`Added ${ok.length} row(s) from PDFs`, 'success');
  }
  clearBatchPanel();
}

async function processPDFFiles(files) {
  const zone = document.getElementById('upload-zone');
  const statusEl = document.getElementById('parse-status');
  clearBatchPanel();
  document.getElementById('extraction-results').style.display = 'none';

  const label = files.length === 1 ? escHtml(files[0].name) : `${files.length} PDFs`;
  zone.innerHTML = `<div class="spinner"></div><div style="margin-top:8px;font-size:13px;color:var(--text-muted)">Parsing ${label}...</div>`;
  statusEl.innerHTML = '';

  const fd = new FormData();
  /* Field name must be ratecon[] so PHP receives all files (plain ratecon often keeps only the last on shared hosting). */
  files.forEach(f => fd.append('ratecon[]', f, f.name));

  try {
    const result = await api.postForm('/api/upload/parse', fd);

    if (result.batch && Array.isArray(result.results)) {
      pendingBatchResults = result.results;
      extracted = {};
      renderBatchPanel();
      const aiFails = result.results.filter(r => r.claudeError);
      if (aiFails.length) {
        showToast(
          `${aiFails.length} file(s): Claude error — open each failed row for details. Add credits at console.anthropic.com if you see a billing message.`,
          'warning'
        );
      }
      zone.innerHTML = `
        <div style="color:var(--green)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="upload-title" style="color:var(--green)">${result.count} PDF(s) parsed</div>
        <div class="upload-sub">Use the list below to add rows, or upload more PDFs</div>
        <div style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('pdf-file-input').click()">Upload more PDFs</button></div>`;
      showToast(`Parsed ${result.count} PDF(s). Add loads as rows below.`, 'success');
      showExportButtons(true);
      return;
    }

    if (result.ok === false) {
      document.getElementById('extraction-results').style.display = 'none';
      const msg = result.claudeError || result.warning || result.error || 'PDF parse failed';
      zone.innerHTML = `
        <div class="upload-icon" style="color:var(--red)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
        <div class="upload-title">Parse failed</div>
        <div class="upload-sub" style="max-width:420px;text-align:center">${escHtml(msg)}</div>
        <div style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('pdf-file-input').click()">Try again</button></div>`;
      showToast(msg, 'error');
      return;
    }

    extracted = result.extracted || {};
    const conf = result.confidence || {};
    document.getElementById('extraction-results').style.display = '';
    renderExtractionGrid(extracted, conf);

    zone.innerHTML = `
      <div style="color:var(--green)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="upload-title" style="color:var(--green)">${escHtml(result.fileName || files[0].name)} parsed</div>
      <div class="upload-sub">${result.claude ? 'Claude · ' : ''}Broker: ${escHtml(result.broker || 'generic')} | ${result.textLength || 0} chars from PDF text</div>
      <div style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('pdf-file-input').click()">Upload more PDFs</button></div>`;

    if (result.claudeError) showToast('Claude: ' + result.claudeError, 'error');
    else if (result.warning) showToast(result.warning, 'warning');
    else showToast('PDF parsed successfully! Review extracted data.', 'success');

    showExportButtons(true);
  } catch (e) {
    zone.innerHTML = `<div class="upload-icon" style="color:var(--red)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
      <div class="upload-title">Parse failed</div>
      <div class="upload-sub">${escHtml(e.message)}</div>
      <div style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('pdf-file-input').click()">Try Again</button></div>`;
    showToast('Parse failed: ' + e.message, 'error');
  }
}

/**
 * Map admin column `name` → parser output keys (origin, destination, miles, reference, rate).
 * Lets templates use load_number, bol, pickup, etc. and still receive PDF extraction.
 */
function parserKeyForColumnName(colName) {
  const n = String(colName || '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .trim();
  const aliasToParser = {
    origin: 'origin',
    pickup: 'origin',
    ship_from: 'origin',
    pu: 'origin',
    pickup_location: 'origin',
    load_at: 'origin',
    shipper: 'origin',
    destination: 'destination',
    dest: 'destination',
    delivery: 'destination',
    drop: 'destination',
    dropoff: 'destination',
    consignee: 'destination',
    unload: 'destination',
    miles: 'miles',
    mileage: 'miles',
    loaded_miles: 'miles',
    distance: 'miles',
    reference: 'reference',
    ref: 'reference',
    load_number: 'reference',
    load_no: 'reference',
    load_id: 'reference',
    bol: 'reference',
    pro: 'reference',
    pro_number: 'reference',
    confirmation: 'reference',
    order_number: 'reference',
    shipment_id: 'reference',
    trip_id: 'reference',
    rate: 'rate',
    line_haul: 'rate',
    linehaul: 'rate',
    total_rate: 'rate',
    haul_rate: 'rate',
    total_miles: 'miles',
    rpm: 'rpm',
    rate_per_mile: 'rpm',
    rev_per_mile: 'rpm',
    pickup_date: 'pickup_date',
    pu_date: 'pickup_date',
    ship_date: 'pickup_date',
    load_date: 'pickup_date',
    dropoff_date: 'dropoff_date',
    delivery_date: 'dropoff_date',
    drop_date: 'dropoff_date',
    del_date: 'dropoff_date',
    load_id: 'load_id',
    load_number: 'load_id',
    pro_number: 'load_id',
    pro: 'load_id',
    bol: 'load_id',
    broker_name: 'broker_name',
    broker: 'broker_name',
    commodity: 'commodity',
    commodities: 'commodity',
    weight: 'weight',
    load_weight: 'weight',
    total_weight: 'weight',
    lbs: 'weight'
  };
  if (aliasToParser[n]) return aliasToParser[n];
  if (
    [
      'origin',
      'destination',
      'miles',
      'reference',
      'rate',
      'rpm',
      'pickup_date',
      'dropoff_date',
      'load_id',
      'broker_name',
      'commodity',
      'weight',
    ].includes(n)
  )
    return n;
  return null;
}

/** First numeric token only (strips LBS, KG, etc.). */
function digitsOnlyWeight(value) {
  const t = String(value == null ? '' : value).replace(/,/g, '').trim();
  const m = t.match(/\d+\.?\d*/);
  if (!m) return '';
  const n = parseFloat(m[0]);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(Math.round(n)) : String(n);
}

function normalizeExtractedCell(value, colName) {
  const key = String(colName || '').toLowerCase();
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (/_date$|_dt$|^pickup_date$|^dropoff_date$/i.test(key)) return text;
  if (key === 'weight' || key.endsWith('_weight') || key === 'lbs' || key === 'total_weight') {
    return digitsOnlyWeight(text);
  }
  const numericLike = /(miles?|rate|fee|amount|total|rpm|dispatch)/i.test(key);
  return numericLike ? text : text.toUpperCase();
}

/** Add one invoice row from an extracted field map (PDF or batch item). */
function addRowFromExtracted(ext) {
  if (!templates.length) return showToast('No tables configured', 'warning');
  const table = templates[0];
  if (!invoiceRows[table.id]) invoiceRows[table.id] = [];

  const rowData = {};
  table.columns.forEach(col => {
    const pk = parserKeyForColumnName(col.name);
    const colKey = String(col.name || '').toLowerCase().replace(/\s+/g, '_');
    const isDispatchFeeCol =
      colKey === 'dispatcher_fee' ||
      colKey === 'dispatch_fee' ||
      (colKey.includes('dispatch') && colKey.includes('fee'));
    let v = '';
    if (!isDispatchFeeCol) {
      if (pk != null && ext[pk] != null && String(ext[pk]).trim() !== '') v = String(ext[pk]);
      else if (ext[col.name] != null && String(ext[col.name]).trim() !== '') v = String(ext[col.name]);
      else if ((col.name === 'rate' || col.name === 'line_haul') && ext.total_rate) v = String(ext.total_rate);
      else if (col.name === 'amount' && ext.amount) v = String(ext.amount);
      if (!v && ext && typeof ext === 'object') {
        const colNorm = String(col.name).toLowerCase().replace(/\s+/g, '_');
        for (const [ek, ev] of Object.entries(ext)) {
          if (ev == null || String(ev).trim() === '') continue;
          if (String(ek).toLowerCase().replace(/\s+/g, '_') === colNorm) {
            v = String(ev);
            break;
          }
        }
      }
    }
    rowData[col.name] = isDispatchFeeCol ? '' : normalizeExtractedCell(v, col.name);
  });
  if (ext.load_id != null && String(ext.load_id).trim() !== '') {
    rowData.load_id = normalizeExtractedCell(String(ext.load_id), 'load_id');
  }
  if (ext.broker_name != null && String(ext.broker_name).trim() !== '') {
    rowData.broker_name = normalizeExtractedCell(String(ext.broker_name), 'broker_name');
  }
  {
    const comm = ext.commodity != null ? String(ext.commodity).trim() : '';
    rowData.commodity = comm ? normalizeExtractedCell(comm, 'commodity') : 'FAK';
  }
  if (ext.weight != null && String(ext.weight).trim() !== '') {
    rowData.weight = digitsOnlyWeight(ext.weight);
  }
  ['pickup_date', 'dropoff_date'].forEach((k) => {
    if (ext[k] != null && String(ext[k]).trim() !== '') {
      rowData[k] = normalizeExtractedCell(String(ext[k]), k);
    }
  });
  recomputeDerivedForRow(table, rowData);

  invoiceRows[table.id].push(rowData);
  renderInvoiceTables();
  updateTotals();
  showExportButtons(true);
}

function renderReportClientDropdown() {
  const sel = document.getElementById('report-client-select');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— Select Client —</option>';
  myClients.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.company_name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function loadClientReport() {
  const clientId = document.getElementById('report-client-select')?.value;
  const from = document.getElementById('report-from')?.value || '';
  const to = document.getElementById('report-to')?.value || '';
  if (!clientId) return showToast('Select a client first', 'warning');

  const weeklyEl = document.getElementById('weekly-report-container');
  const rowsEl = document.getElementById('rows-report-container');
  weeklyEl.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  rowsEl.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  try {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const q = qs.toString();
    const data = await api.get(`/api/invoices/client/${encodeURIComponent(clientId)}/report${q ? `?${q}` : ''}`);
    currentClientReport = data;
    document.getElementById('btn-export-report-csv').disabled = !(data.rows && data.rows.length);

    const weekly = data.weekly || [];
    if (!weekly.length) {
      weeklyEl.innerHTML = '<div class="empty-state"><p>No weekly data for the selected range.</p></div>';
    } else {
      weeklyEl.innerHTML = `<div class="table-responsive"><table class="data-table"><thead><tr>
        <th>Week Start</th><th>Loads</th><th>Total Miles</th><th>Total Rates</th><th>RPM</th>
      </tr></thead><tbody>
      ${weekly.map(w => `<tr>
        <td>${escHtml(w.week_start || '')}</td>
        <td>${Number(w.loads || 0)}</td>
        <td>${Math.round(Number(w.total_miles || 0)).toLocaleString()}</td>
        <td>${formatCurrency(Number(w.total_rates || 0), companySettings.currency || 'USD')}</td>
        <td>${formatNumber(Number(w.rpm || 0), 3)}</td>
      </tr>`).join('')}
      </tbody></table></div>`;
    }

    const rows = data.rows || [];
    if (!rows.length) {
      rowsEl.innerHTML = '<div class="empty-state"><p>No load rows found for this client/range.</p></div>';
    } else {
      rowsEl.innerHTML = `<div class="table-responsive"><table class="data-table"><thead><tr>
        <th>Invoice #</th><th>Invoice date</th><th>Agent</th><th>Load ID</th><th>Broker</th><th>Commodity</th><th>Weight</th><th>Pickup date</th><th>Dropoff date</th><th>Pickup</th><th>Dropoff</th><th>Miles</th><th>Rate</th><th>RPM</th>
      </tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td class="text-mono">${escHtml(r.invoice_number || '')}</td>
        <td>${escHtml(r.invoice_date || '')}</td>
        <td>${escHtml(r.agent_name || '')}</td>
        <td class="text-mono">${escHtml(r.load_id || '—')}</td>
        <td>${escHtml(String(r.broker_name || '').toUpperCase())}</td>
        <td>${escHtml(String(r.commodity || 'FAK').toUpperCase())}</td>
        <td>${escHtml(String(r.weight || '—'))}</td>
        <td>${escHtml(r.pickup_date || '')}</td>
        <td>${escHtml(r.dropoff_date || '')}</td>
        <td>${escHtml(String(r.origin || '').toUpperCase())}</td>
        <td>${escHtml(String(r.destination || '').toUpperCase())}</td>
        <td>${Math.round(Number(r.miles || 0)).toLocaleString()}</td>
        <td>${formatCurrency(Number(r.rate || 0), companySettings.currency || 'USD')}</td>
        <td>${formatNumber(Number(r.rpm || 0), 3)}</td>
      </tr>`).join('')}
      </tbody></table></div>`;
    }
    showToast('Client report loaded', 'success');
  } catch (e) {
    currentClientReport = null;
    document.getElementById('btn-export-report-csv').disabled = true;
    weeklyEl.innerHTML = '<div class="empty-state"><p>Failed to load report.</p></div>';
    rowsEl.innerHTML = '<div class="empty-state"><p>Failed to load report.</p></div>';
    showToast('Report failed: ' + e.message, 'error');
  }
}

function exportClientReportCsv() {
  if (!currentClientReport || !Array.isArray(currentClientReport.rows) || !currentClientReport.rows.length) {
    return showToast('No report data to export', 'warning');
  }
  const rows = currentClientReport.rows;
  const header = [
    'invoice_number',
    'invoice_date',
    'status',
    'agent_name',
    'load_id',
    'broker_name',
    'commodity',
    'weight',
    'pickup_date',
    'dropoff_date',
    'pickup',
    'dropoff',
    'miles',
    'rate',
    'rpm',
  ];
  const lines = [header.join(',')];
  rows.forEach((r) => {
    const arr = [
      r.invoice_number,
      r.invoice_date,
      r.status,
      r.agent_name,
      r.load_id || '',
      String(r.broker_name || '').toUpperCase(),
      String(r.commodity || 'FAK').toUpperCase(),
      String(r.weight || ''),
      r.pickup_date || '',
      r.dropoff_date || '',
      String(r.origin || '').toUpperCase(),
      String(r.destination || '').toUpperCase(),
      Number(r.miles || 0),
      Number(r.rate || 0),
      Number(r.rpm || 0),
    ];
    lines.push(arr.map(csvEscape).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const clientName = String(currentClientReport.client?.company_name || 'client').replace(/[^\w\-]+/g, '_');
  a.href = url;
  a.download = `${clientName}_loads_report.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('CSV downloaded', 'success');
}

// Apply extracted data (single-PDF editor) to a new row
function applyExtracted() {
  addRowFromExtracted(extracted);
  showToast('Row added with extracted data', 'success');
  document.getElementById('extraction-results').style.display = 'none';
}

// ============ INVOICE TABLES ============
function renderInvoiceTables() {
  const container = document.getElementById('invoice-tables-container');
  if (!templates.length) {
    container.innerHTML = `<div class="card mb-4"><div class="card-body"><div class="empty-state"><p>No table templates configured. Ask admin to set up invoice columns.</p></div></div></div>`;
    return;
  }
  templates.forEach((t) => recomputeDerivedForTable(t));
  container.innerHTML = templates.map(t => renderTableCard(t)).join('');
  updateTotals();
}

function renderTableCard(table) {
  const rows = invoiceRows[table.id] || [];
  const cols = table.columns;
  return `
    <div class="card mb-4">
      <div class="card-header">
        <span class="card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          ${escHtml(table.name)}
        </span>
        <button class="btn btn-primary btn-sm" onclick="addRow(${table.id})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Row
        </button>
      </div>
      <div class="table-responsive">
        <table class="data-table invoice-table" id="table-${table.id}">
          <thead><tr>
            ${cols.map(c => `<th>${escHtml(c.label)}</th>`).join('')}
            <th style="width:120px">Actions</th>
          </tr></thead>
          <tbody id="tbody-${table.id}">
            ${rows.length ? rows.map((row, ri) => renderRow(table, row, ri)).join('') : `
              <tr><td colspan="${cols.length + 1}" style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px">
                No rows yet. Upload a RateCon or click "Add Row".
              </td></tr>`}
          </tbody>
        </table>
      </div>
      ${rows.length > 0 ? renderTableSubtotal(table) : ''}
    </div>`;
}

function renderRow(table, rowData, rowIndex) {
  return `<tr id="row-${table.id}-${rowIndex}">
    ${table.columns.map(col => {
      const key = String(col.name || '').toLowerCase();
      const useDecimalText = /rate|dispatcher|dispatch|amount|total|fee|mile|haul|rpm|weight/i.test(key);
      const inputMode = useDecimalText ? ' inputmode="decimal"' : '';
      const nm = String(col.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const handlers = `onchange="updateRowValue(${table.id}, ${rowIndex}, '${nm}', this.value)" oninput="updateRowValue(${table.id}, ${rowIndex}, '${nm}', this.value)"`;
      return `
      <td>
        <input type="text"${inputMode}
          data-col="${escHtml(String(col.name || ''))}"
          value="${escHtml(String(rowData[col.name] || ''))}"
          placeholder="${escHtml(col.label)}"
          style="background:transparent;border:none;outline:none;width:100%;font-size:13.5px;font-weight:600;color:var(--text-primary);"
          ${handlers}>
      </td>`;
    }).join('')}
    <td>
      <div style="display:flex;gap:4px;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" onclick="moveRow(${table.id}, ${rowIndex}, -1)" title="Move up"
        style="padding:3px 7px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
      <button class="btn btn-ghost btn-sm" onclick="moveRow(${table.id}, ${rowIndex}, 1)" title="Move down"
        style="padding:3px 7px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <button class="btn btn-danger btn-sm" onclick="deleteRow(${table.id}, ${rowIndex})" title="Delete row"
        style="padding:3px 7px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      </button>
      </div>
    </td>
  </tr>`;
}

function renderTableSubtotal(table) {
  const rows = invoiceRows[table.id] || [];
  const sumCols = table.columns.filter(c =>
    c.col_type === 'number' ||
    (c.col_type === 'text' && /rate|dispatcher|dispatch|amount|total|mile|fee|haul|rpm/i.test(c.name || ''))
  );
  if (!sumCols.length) return '';
  return `<div style="padding:10px 16px; background:var(--bg); border-top:1px solid var(--border); display:flex; gap:24px; font-size:12.5px;flex-wrap:wrap">
    ${sumCols.map(col => {
      const key = String(col.name || '').toLowerCase();
      const totalMiles = rows.reduce((sum, row) => sum + numericCell(row, { name: 'miles', col_type: 'number' }), 0);
      const totalRates = rows.reduce((sum, row) => sum + numericCell(row, { name: 'rate', col_type: 'text' }), 0);
      if (key.includes('rpm')) {
        const rpm = totalMiles > 0 ? totalRates / totalMiles : 0;
        return `<span><span style="color:var(--text-muted)">${escHtml(col.label)}: </span><strong>${formatNumber(rpm, 3)}</strong></span>`;
      }
      const total = rows.reduce((sum, row) => sum + numericCell(row, col), 0);
      if (key.includes('rate') || key.includes('fee') || key.includes('amount') || key.includes('total')) {
        return `<span><span style="color:var(--text-muted)">${escHtml(col.label)}: </span><strong>${formatCurrency(total, companySettings.currency || 'USD')}</strong></span>`;
      }
      return `<span><span style="color:var(--text-muted)">${escHtml(col.label)}: </span><strong>${formatNumber(total)}</strong></span>`;
    }).join('')}
  </div>`;
}

function addRow(tableId) {
  if (!invoiceRows[tableId]) invoiceRows[tableId] = [];
  const table = templates.find(t => t.id === tableId);
  const rowData = {};
  table.columns.forEach(c => rowData[c.name] = '');
  invoiceRows[tableId].push(rowData);
  // Re-render just this table
  const card = document.getElementById(`table-${tableId}`)?.closest('.card');
  if (card) {
    card.outerHTML = renderTableCard(table);
    // Re-find (DOM replaced)
  }
  renderInvoiceTables();
  updateTotals();
  showExportButtons(true);
}

function moveRow(tableId, rowIndex, direction) {
  const rows = invoiceRows[tableId];
  if (!rows || !rows.length) return;
  const target = rowIndex + direction;
  if (target < 0 || target >= rows.length) return;
  [rows[rowIndex], rows[target]] = [rows[target], rows[rowIndex]];
  renderInvoiceTables();
  showExportButtons(true);
}

function deleteRow(tableId, rowIndex) {
  if (!invoiceRows[tableId]) return;
  invoiceRows[tableId].splice(rowIndex, 1);
  renderInvoiceTables();
  updateTotals();
}

function updateRowValue(tableId, rowIndex, colName, value) {
  if (!invoiceRows[tableId] || !invoiceRows[tableId][rowIndex]) return;
  invoiceRows[tableId][rowIndex][colName] = value;
  updateTotals();
  showExportButtons(true);
}

// ============ TOTALS ============
function updateTotals() {
  const allRows = Object.values(invoiceRows).flat();
  if (!allRows.length) {
    document.getElementById('totals-card').style.display = 'none';
    return;
  }
  document.getElementById('totals-card').style.display = '';

  let totalLoads = 0, totalMiles = 0, totalRates = 0, totalDispFee = 0, totalAmountFallback = 0;
  const currency = companySettings.currency || 'USD';

  templates.forEach(table => {
    const rows = invoiceRows[table.id] || [];
    rows.forEach(row => {
      totalLoads++;
      table.columns.forEach(col => {
        const v = numericCell(row, col);
        const key = col.name.toLowerCase();
        if (key === 'miles' || key === 'mileage') totalMiles += v;
        if (key === 'rate' || key === 'line_haul') totalRates += v;
        if (key === 'dispatcher_fee' || key === 'dispatch_fee') totalDispFee += v;
        if (key === 'amount' || key === 'total') totalAmountFallback += v;
      });
    });
  });
  if (totalDispFee === 0 && totalAmountFallback > 0) totalDispFee = totalAmountFallback;

  const overrideDispatch = getDispatchFeeOverrideValue();
  const effectiveDispatchFee = overrideDispatch != null ? overrideDispatch : totalDispFee;

  const rpm = totalMiles > 0 ? totalRates / totalMiles : 0;

  document.getElementById('totals-grid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Loads</div><div class="stat-value">${totalLoads}</div></div>
    <div class="stat-card"><div class="stat-label">Total Miles</div><div class="stat-value">${Math.round(totalMiles).toLocaleString()}</div></div>
    <div class="stat-card"><div class="stat-label">Total Rates</div><div class="stat-value">${formatCurrency(totalRates, currency)}</div></div>
    <div class="stat-card"><div class="stat-label">RPM</div><div class="stat-value">${formatNumber(rpm, 3)}</div></div>
    <div class="stat-card"><div class="stat-label">Dispatcher Fee</div><div class="stat-value red">${formatCurrency(effectiveDispatchFee, currency)}</div></div>`;
}

// ============ SAVE/LOAD DRAFTS ============
async function saveDraft() {
  const clientId = document.getElementById('client-select').value;
  const invNum = document.getElementById('invoice-number').value;
  const invDate = document.getElementById('invoice-date').value;

  const rows = [];
  templates.forEach(table => {
    (invoiceRows[table.id] || []).forEach((rowData, i) => {
      rows.push({ table_id: table.id, row_order: i, row_data: rowData });
    });
  });

  const paySel = document.getElementById('payment-account-select');
  const payId = paySel && paySel.value ? parseInt(paySel.value, 10) : null;
  const payload = {
    client_id: clientId || null,
    invoice_number: invNum,
    invoice_date: invDate,
    payment_account_id: payId && Number.isFinite(payId) ? payId : null,
    notes: buildDraftNotesMeta(),
    rows
  };

  try {
    if (currentDraftId) {
      await api.put(`/api/invoices/${currentDraftId}`, payload);
      showToast('Draft saved', 'success');
    } else {
      const result = await api.post('/api/invoices', payload);
      currentDraftId = result.id;
      document.getElementById('current-draft-id').value = currentDraftId;
      showDraftBadge('draft');
      window.history.replaceState({}, '', `${window.location.pathname}?draft=${encodeURIComponent(currentDraftId)}`);
      showToast('Draft created', 'success');
    }
    return true;
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
    return false;
  }
}

function showDraftBadge(status) {
  document.getElementById('draft-status-badge').innerHTML =
    `<span class="badge badge-${status}">${status}</span>`;
}

async function loadDraft(draftId) {
  try {
    const draft = await api.get(`/api/invoices/${draftId}`);
    currentDraftId = draftId;
    document.getElementById('current-draft-id').value = draftId;
    document.getElementById('client-select').value = draft.client_id || '';
    document.getElementById('invoice-number').value = draft.invoice_number || '';
    document.getElementById('invoice-date').value = draft.invoice_date || '';
    const paSel = document.getElementById('payment-account-select');
    if (paSel) paSel.value = draft.payment_account_id ? String(draft.payment_account_id) : '';
    const meta = getDraftMetaFromNotes(draft.notes);
    const dfo = document.getElementById('dispatch-fee-override');
    if (dfo) dfo.value = meta.dispatch_fee_override != null ? String(meta.dispatch_fee_override) : '';
    onClientSelect();
    showDraftBadge(draft.status);

    // Restore rows
    invoiceRows = {};
    if (draft.rows) {
      draft.rows.forEach(r => {
        const tid = r.table_id;
        if (tid) {
          if (!invoiceRows[tid]) invoiceRows[tid] = [];
          invoiceRows[tid].push(r.row_data);
        }
      });
    }
    renderInvoiceTables();
    showExportButtons(true);
    showSection('new');
  } catch(e) { showToast('Failed to load draft: ' + e.message, 'error'); }
}

async function loadDraftsList() {
  try {
    const qEl = document.getElementById('agent-invoices-search');
    const q = qEl && qEl.value ? qEl.value.trim() : '';
    const url = q ? `/api/invoices?q=${encodeURIComponent(q)}` : '/api/invoices';
    const drafts = await api.get(url);
    if (!drafts.length) {
      const emptyMsg = q
        ? `No invoices match your search.`
        : 'No invoices yet. Start by creating a new invoice.';
      document.getElementById('drafts-container').innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>${emptyMsg}</p></div>`;
      return;
    }
    document.getElementById('drafts-container').innerHTML = `
      <div class="table-responsive"><table class="data-table"><thead><tr><th>Invoice #</th><th>Client</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${drafts.map(d => `<tr>
        <td class="text-mono"><strong>${escHtml(d.invoice_number)}</strong></td>
        <td>${escHtml(d.client_company||'—')}</td>
        <td>${formatDate(d.invoice_date)}</td>
        <td><span class="badge badge-${d.status}">${d.status}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="loadDraft('${d.id}');showSection('new')">Open</button>
          <button class="btn btn-primary btn-sm" onclick="loadDraft('${d.id}').then(()=>exportPDF())">Export PDF</button>
          <button class="btn btn-danger btn-sm" onclick="deleteDraft('${d.id}')">Delete</button>
        </td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch(e) { showToast('Failed to load drafts', 'error'); }
}

async function deleteDraft(id) {
  if (!confirm('Delete this invoice draft?')) return;
  try {
    await api.delete(`/api/invoices/${id}`);
    if (currentDraftId === id) { currentDraftId = null; newInvoice(); }
    showToast('Draft deleted', 'success');
    loadDraftsList();
  } catch(e) { showToast(e.message, 'error'); }
}

function newInvoice() {
  currentDraftId = null;
  document.getElementById('current-draft-id').value = '';
  document.getElementById('client-select').value = '';
  document.getElementById('client-info-row').style.display = 'none';
  document.getElementById('invoice-number').value = 'INV-' + Date.now().toString().slice(-6);
  document.getElementById('invoice-date').valueAsDate = new Date();
  document.getElementById('draft-status-badge').innerHTML = '';
  const paSel = document.getElementById('payment-account-select');
  if (paSel) paSel.value = '';
  const dfo = document.getElementById('dispatch-fee-override');
  if (dfo) dfo.value = '';
  document.getElementById('extraction-results').style.display = 'none';
  invoiceRows = {};
  extracted = {};
  renderInvoiceTables();
  showExportButtons(false);
  showSection('new');
  window.history.replaceState({}, '', window.location.pathname);

  clearBatchPanel();
  document.getElementById('extraction-results').style.display = 'none';

  // Reset upload zone
  document.getElementById('upload-zone').innerHTML = `
    <div class="upload-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    </div>
    <div class="upload-title">Drop RateCon PDFs here or click to browse</div>
    <div class="upload-sub">Up to 15 PDFs at once, 20MB each — auto-extracts load data</div>`;
}

// ============ PDF EXPORT ============
async function exportPDF() {
  const saved = await saveDraft();
  if (!saved) {
    showToast('Save the invoice first, then export PDF.', 'error');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  const RED = [200, 16, 46];
  const DARK = [15, 15, 15];
  const GRAY = [100, 100, 100];
  const LIGHT_GRAY = [240, 240, 240];
  const WHITE = [255, 255, 255];

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  let y = margin;

  // ---- HEADER BAND ----
  doc.setFillColor(...RED);
  doc.rect(0, 0, pageW, 38, 'F');

  // Logo (if available)
  const co = companySettings;
  const displayCoName =
    typeof window.resolvePdfCompanyName === 'function'
      ? window.resolvePdfCompanyName(co)
      : co.company_name || 'Runnex Logistics';
  let logoLoaded = false;
  if (co.logo_path) {
    try {
      const imgData = await loadImageAsBase64(co.logo_path);
      if (imgData) {
        // Draw logo preserving aspect ratio in top-left
        const logoMaxW = 45, logoMaxH = 22;
        const dims = await getImageDims(imgData.data, imgData.type);
        const ratio = Math.min(logoMaxW / dims.w, logoMaxH / dims.h);
        const lw = dims.w * ratio, lh = dims.h * ratio;
        doc.addImage(imgData.data, imgData.type.toUpperCase(), margin, (38 - lh) / 2, lw, lh);
        logoLoaded = true;
      }
    } catch {}
  }
  if (!logoLoaded) {
    // Text logo
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...WHITE);
    doc.text(displayCoName, margin, 24);
  }

  // Invoice label on right
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...WHITE);
  doc.text('INVOICE', pageW - margin, 18, { align: 'right' });

  y = 46;

  // ---- TWO COLUMN: From / Invoice Details ----
  const colW = (pageW - margin * 2 - 8) / 2;

  // Company info box (left)
  doc.setFillColor(...LIGHT_GRAY);
  doc.roundedRect(margin, y, colW, 34, 2, 2, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...GRAY);
  doc.text('FROM', margin + 5, y + 7);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(displayCoName, margin + 5, y + 14);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  let fromLineY = y + 20;
  if (co.address) {
    doc.text(String(co.address), margin + 5, fromLineY);
    fromLineY += 6;
  }
  if (co.phone) {
    doc.text(String(co.phone), margin + 5, fromLineY);
    fromLineY += 5;
  }
  if (co.email) {
    doc.text(String(co.email), margin + 5, fromLineY);
  }

  // Invoice details box (right)
  const rx = margin + colW + 8;
  doc.setFillColor(...LIGHT_GRAY);
  doc.roundedRect(rx, y, colW, 34, 2, 2, 'F');
  const invNum = document.getElementById('invoice-number').value;
  const invDate = document.getElementById('invoice-date').value;
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...GRAY);
  doc.text('INVOICE DETAILS', rx + 5, y + 7);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DARK);
  doc.text(`Invoice #:`, rx + 5, y + 14);
  doc.setFont('helvetica', 'bold');
  doc.text(invNum, rx + colW - 5, y + 14, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(`Date:`, rx + 5, y + 20);
  doc.setFont('helvetica', 'bold');
  doc.text(invDate ? formatDate(invDate) : '—', rx + colW - 5, y + 20, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(`Currency:`, rx + 5, y + 26);
  doc.setFont('helvetica', 'bold');
  doc.text(co.currency || 'USD', rx + colW - 5, y + 26, { align: 'right' });

  y += 40;

  // ---- BILL TO ----
  const clientId = parseInt(document.getElementById('client-select').value);
  const client = myClients.find(c => c.id === clientId);
  if (client) {
    doc.setFillColor(...LIGHT_GRAY);
    doc.roundedRect(margin, y, pageW - margin * 2, 28, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GRAY);
    doc.text('BILL TO', margin + 5, y + 7);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK);
    doc.text(client.company_name, margin + 5, y + 14);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    let billLine = [];
    if (client.contact_name) billLine.push(client.contact_name);
    if (client.email) billLine.push(client.email);
    if (client.phone) billLine.push(client.phone);
    doc.text(billLine.join('  |  '), margin + 5, y + 21);
    y += 34;
  } else {
    y += 4;
  }

  // Invoice totals (used in summary + subtotal dispatch fee must match effective total / override)
  let totalLoads = 0, totalMiles = 0, totalRates = 0, totalDispFee = 0, totalAmountFallback = 0;
  templates.forEach((table) => {
    (invoiceRows[table.id] || []).forEach((row) => {
      totalLoads++;
      table.columns.forEach((col) => {
        const v = numericCell(row, col);
        const key = col.name.toLowerCase();
        if (key === 'miles' || key === 'mileage') totalMiles += v;
        if (key === 'rate' || key === 'line_haul') totalRates += v;
        if (key === 'dispatcher_fee' || key === 'dispatch_fee') totalDispFee += v;
        if (key === 'amount' || key === 'total') totalAmountFallback += v;
      });
    });
  });
  if (totalDispFee === 0 && totalAmountFallback > 0) totalDispFee = totalAmountFallback;
  const overrideDispatch = getDispatchFeeOverrideValue();
  const effectiveDispatchFee = overrideDispatch != null ? overrideDispatch : totalDispFee;

  // ---- LOAD TABLES ----
  for (const table of templates) {
    const rows = invoiceRows[table.id] || [];
    if (!rows.length) continue;

    // Table header label
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...RED);
    doc.text(table.name.toUpperCase(), margin, y + 5);
    y += 8;

    const cols = table.columns;
    const headers = cols.map((c) => String(c.label || '').toUpperCase());
    const body = rows.map((row) =>
      cols.map((col) => {
        const v = row[col.name];
        if (col.col_type === 'number' && v !== '' && v !== undefined) {
          const num = parseFloat(v);
          if (!Number.isFinite(num)) {
            return String(v || '').toUpperCase();
          }
          const formatted =
            col.name.toLowerCase().includes('fee') ||
            col.name.toLowerCase().includes('rate') ||
            col.name.toLowerCase().includes('amount')
              ? formatCurrency(num, co.currency || 'USD')
              : num.toLocaleString();
          return String(formatted).toUpperCase();
        }
        return String(v || '').toUpperCase();
      })
    );

    const subtotalMiles = rows.reduce((sum, row) => {
      let m = 0;
      cols.forEach((c) => {
        const key = String(c.name || '').toLowerCase();
        if (key === 'miles' || key === 'mileage' || key === 'loaded_miles' || key === 'distance') m += numericCell(row, c);
      });
      return sum + m;
    }, 0);
    const subtotalRates = rows.reduce((sum, row) => {
      let r = 0;
      cols.forEach((c) => {
        const key = String(c.name || '').toLowerCase();
        if (key === 'rate' || key === 'line_haul' || key === 'linehaul' || key === 'total_rate') r += numericCell(row, c);
      });
      return sum + r;
    }, 0);
    // Subtotals row
    const subRow = cols.map((col) => {
      const key = String(col.name || '').toLowerCase();
      const numericLike =
        col.col_type === 'number' || /rate|fee|amount|total|mile|haul|rpm/i.test(key);
      if (!numericLike) return '';
      if (key.includes('rpm')) {
        const rpmVal = subtotalMiles > 0 ? subtotalRates / subtotalMiles : 0;
        return String(formatNumber(rpmVal, 3)).toUpperCase();
      }
      if (key === 'dispatcher_fee' || key === 'dispatch_fee') {
        return String(formatCurrency(effectiveDispatchFee, co.currency || 'USD')).toUpperCase();
      }
      const total = rows.reduce((s, r) => s + numericCell(r, col), 0);
      const formatted =
        key.includes('fee') || key.includes('rate') || key.includes('amount')
          ? formatCurrency(total, co.currency || 'USD')
          : total.toLocaleString();
      return String(formatted).toUpperCase();
    });
    subRow[0] = 'SUBTOTAL';

    doc.autoTable({
      startY: y,
      head: [headers],
      body: [...body, subRow],
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 3, textColor: DARK },
      headStyles: { fillColor: RED, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5, cellPadding: 3.5 },
      bodyStyles: { fillColor: WHITE },
      alternateBodyStyles: { fillColor: [250, 250, 250] },
      footStyles: { fillColor: LIGHT_GRAY, fontStyle: 'bold' },
      didParseCell(data) {
        if (data.row.index === body.length) {
          data.cell.styles.fillColor = LIGHT_GRAY;
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ---- SUMMARY BOX ----
  const rpm = totalMiles > 0 ? (totalRates / totalMiles).toFixed(3) : '0.000';

  if (y > pageH - 55) { doc.addPage(); y = margin; }

  y += 4;
  // Summary metrics row
  doc.setFontSize(7.5);
  const metricW = (pageW - margin * 2) / 5;
  const metrics = [
    ['LOADS', totalLoads],
    ['TOTAL MILES', Math.round(totalMiles).toLocaleString()],
    ['TOTAL RATES', formatCurrency(totalRates, co.currency||'USD')],
    ['RPM', rpm],
    ['DISPATCHER FEE', formatCurrency(effectiveDispatchFee, co.currency||'USD')]
  ];
  metrics.forEach((m, i) => {
    const mx = margin + i * metricW;
    doc.setFillColor(...LIGHT_GRAY);
    doc.rect(mx, y, metricW - 2, 16, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GRAY);
    doc.text(m[0], mx + (metricW - 2) / 2, y + 6, { align: 'center' });
    doc.setFontSize(9.5);
    doc.setTextColor(...DARK);
    doc.text(String(m[1]), mx + (metricW - 2) / 2, y + 13, { align: 'center' });
    doc.setFontSize(7.5);
  });
  y += 22;

  const payAcc = getSelectedPaymentAccountForPdf();
  const payDraw =
    typeof window.drawInvoicePdfPaymentBlock === 'function'
      ? window.drawInvoicePdfPaymentBlock(doc, { margin, pageW, y, paymentAccount: payAcc })
      : { rowHeight: 0 };
  const feeRowH = Math.max(30, payDraw.rowHeight || 0);

  doc.setFillColor(...RED);
  doc.roundedRect(pageW - margin - 65, y, 65, feeRowH, 2, 2, 'F');
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...WHITE);
  doc.text('TOTAL DISPATCH FEE', pageW - margin - 5, y + 8, { align: 'right' });
  doc.setFontSize(14);
  doc.text(formatCurrency(effectiveDispatchFee, co.currency || 'USD'), pageW - margin - 5, y + feeRowH - 7, { align: 'right' });

  y += feeRowH + 8;

  // ---- FOOTER ----
  doc.setFillColor(...DARK);
  doc.rect(0, pageH - 12, pageW, 12, 'F');
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  doc.text(`Runnex Logistics Invoice  |  ${displayCoName}  |  ${co.email || ''}`, pageW / 2, pageH - 4.5, { align: 'center' });

  const filename = `Invoice-${invNum}-${invDate || 'draft'}.pdf`;
  doc.save(filename);
  showToast(`PDF exported: ${filename}`, 'success');

  // Mark as finalized
  if (currentDraftId) {
    api.put(`/api/invoices/${currentDraftId}`, { status: 'finalized' }).catch(() => {});
    showDraftBadge('finalized');
  }
}

// ---- PDF helpers ----
function loadImageAsBase64(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const ext = src.split('.').pop().toLowerCase();
      const type = ext === 'png' ? 'png' : 'jpeg';
      resolve({ data: canvas.toDataURL(`image/${type}`), type });
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function getImageDims(dataUrl, type) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 100, h: 40 });
    img.src = dataUrl;
  });
}

init();
