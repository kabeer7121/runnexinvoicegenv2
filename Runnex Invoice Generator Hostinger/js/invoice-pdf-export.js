/**
 * Build invoice PDF from /api/invoices/:id/export-data payload (admin download & reuse).
 * Requires: window.jspdf, autoTable plugin, formatCurrency, formatDate on window (from app.js).
 */
(function () {
  function parseMoney(val) {
    if (val == null || val === '') return 0;
    const s = String(val).trim().replace(/\$/g, '').replace(/,/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  function cellNumeric(row, col) {
    if (col.col_type === 'number') return parseFloat(row[col.name]) || 0;
    if (/rate|fee|amount|total|mile|haul|rpm/i.test(col.name || '')) {
      return parseMoney(row[col.name]);
    }
    return parseFloat(row[col.name]) || 0;
  }

  function formatTableCell(row, col, currency) {
    const v = row[col.name];
    const fc = typeof window.formatCurrency === 'function' ? window.formatCurrency : (n, c) => String(n);
    let out = '';
    if (col.col_type === 'number' && v !== '' && v !== undefined) {
      const num = parseFloat(v);
      if (!Number.isFinite(num)) {
        out = String(v || '');
        return out.toUpperCase();
      }
      const key = (col.name || '').toLowerCase();
      if (key.includes('fee') || key.includes('rate') || key.includes('amount')) {
        out = fc(num, currency || 'USD');
      } else {
        out = num.toLocaleString();
      }
    } else if (col.col_type === 'text' && /rate|fee|amount|total/i.test(col.name || '') && v) {
      const n = parseMoney(String(v));
      out = n ? fc(n, currency || 'USD') : String(v || '');
    } else {
      out = String(v || '');
    }
    return out.toUpperCase();
  }

  function loadImageAsBase64(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
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

  function buildTemplates(payload) {
    const tables = payload.tables || [];
    const columns = payload.columns || [];
    return tables.map((t) => ({
      ...t,
      columns: columns
        .filter((c) => c.table_id === t.id)
        .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    }));
  }

  function buildInvoiceRows(payload) {
    const invoiceRows = {};
    for (const r of payload.rows || []) {
      const tid = r.table_id;
      if (tid == null) continue;
      if (!invoiceRows[tid]) invoiceRows[tid] = [];
      let rd = r.row_data;
      if (typeof rd === 'string') {
        try {
          rd = JSON.parse(rd);
        } catch {
          rd = {};
        }
      }
      invoiceRows[tid].push(rd || {});
    }
    return invoiceRows;
  }

  function dispatchOverrideFromDraft(draft) {
    try {
      const meta = draft && draft.notes ? JSON.parse(draft.notes) : {};
      if (!meta || meta.dispatch_fee_override == null || meta.dispatch_fee_override === '') return null;
      const n = parseMoney(meta.dispatch_fee_override);
      return Number.isFinite(n) ? n : null;
    } catch (_) {
      return null;
    }
  }

  function loadCountOverrideFromDraft(draft) {
    try {
      const meta = draft && draft.notes ? JSON.parse(draft.notes) : {};
      if (!meta || meta.load_count_override == null || meta.load_count_override === '') return null;
      const n = parseInt(String(meta.load_count_override), 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    } catch (_) {
      return null;
    }
  }

  async function generateInvoicePdfFromExportData(payload) {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) throw new Error('PDF library not loaded');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

    const RED = [200, 16, 46];
    const DARK = [15, 15, 15];
    const GRAY = [100, 100, 100];
    const LIGHT_GRAY = [240, 240, 240];
    const WHITE = [255, 255, 255];

    const co = payload.company || {};
    const displayCoName =
      typeof window.resolvePdfCompanyName === 'function'
        ? window.resolvePdfCompanyName(co)
        : co.company_name || 'Runnex Logistics';
    const client = payload.client || null;
    const draft = payload.draft || {};
    const currency = co.currency || 'USD';
    const fc = typeof window.formatCurrency === 'function' ? window.formatCurrency : (n, c) => String(n);
    const fd =
      typeof window.formatDate === 'function'
        ? window.formatDate
        : (d) => (d ? String(d) : '—');

    const templates = buildTemplates(payload);
    const invoiceRows = buildInvoiceRows(payload);

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 18;
    let y = margin;

    doc.setFillColor(...RED);
    doc.rect(0, 0, pageW, 38, 'F');

    let logoLoaded = false;
    if (co.logo_path) {
      try {
        const imgData = await loadImageAsBase64(co.logo_path);
        if (imgData) {
          const logoMaxW = 45;
          const logoMaxH = 22;
          const dims = await getImageDims(imgData.data, imgData.type);
          const ratio = Math.min(logoMaxW / dims.w, logoMaxH / dims.h);
          const lw = dims.w * ratio;
          const lh = dims.h * ratio;
          doc.addImage(imgData.data, imgData.type.toUpperCase(), margin, (38 - lh) / 2, lw, lh);
          logoLoaded = true;
        }
      } catch (_) {}
    }
    if (!logoLoaded) {
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...WHITE);
      doc.text(displayCoName, margin, 24);
    }

    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...WHITE);
    doc.text('INVOICE', pageW - margin, 18, { align: 'right' });

    y = 46;
    const colW = (pageW - margin * 2 - 8) / 2;

    doc.setFillColor(...LIGHT_GRAY);
    doc.roundedRect(margin, y, colW, 34, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GRAY);
    doc.text('FROM', margin + 5, y + 7);
    doc.setFontSize(9.5);
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

    const rx = margin + colW + 8;
    doc.setFillColor(...LIGHT_GRAY);
    doc.roundedRect(rx, y, colW, 34, 2, 2, 'F');
    const invNum = draft.invoice_number || '—';
    const invDate = draft.invoice_date || '';
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GRAY);
    doc.text('INVOICE DETAILS', rx + 5, y + 7);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DARK);
    doc.text('Invoice #:', rx + 5, y + 14);
    doc.setFont('helvetica', 'bold');
    doc.text(String(invNum), rx + colW - 5, y + 14, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text('Date:', rx + 5, y + 20);
    doc.setFont('helvetica', 'bold');
    doc.text(invDate ? fd(invDate) : '—', rx + colW - 5, y + 20, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text('Currency:', rx + 5, y + 26);
    doc.setFont('helvetica', 'bold');
    doc.text(currency, rx + colW - 5, y + 26, { align: 'right' });

    y += 40;

    if (client) {
      doc.setFillColor(...LIGHT_GRAY);
      doc.roundedRect(margin, y, pageW - margin * 2, 28, 2, 2, 'F');
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...GRAY);
      doc.text('BILL TO', margin + 5, y + 7);
      doc.setFontSize(10);
      doc.setTextColor(...DARK);
      doc.text(client.company_name || '', margin + 5, y + 14);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...GRAY);
      const billLine = [client.contact_name, client.email, client.phone].filter(Boolean).join('  |  ');
      if (billLine) doc.text(billLine, margin + 5, y + 21);
      y += 34;
    } else {
      y += 4;
    }

    let totalLoads = 0;
    let totalMiles = 0;
    let totalRates = 0;
    let totalDispFee = 0;
    let totalAmountFallback = 0;
    templates.forEach((table) => {
      (invoiceRows[table.id] || []).forEach((row) => {
        totalLoads++;
        (table.columns || []).forEach((col) => {
          const v = cellNumeric(row, col);
          const key = (col.name || '').toLowerCase();
          if (key === 'miles' || key === 'mileage') totalMiles += v;
          if (key === 'rate' || key === 'line_haul') totalRates += v;
          if (key === 'dispatcher_fee' || key === 'dispatch_fee') totalDispFee += v;
          if (key === 'amount' || key === 'total') totalAmountFallback += v;
        });
      });
    });
    if (totalDispFee === 0 && totalAmountFallback > 0) totalDispFee = totalAmountFallback;
    const overrideDispatch = dispatchOverrideFromDraft(draft);
    const effectiveDispatchFee = overrideDispatch != null ? overrideDispatch : totalDispFee;
    const overrideLoads = loadCountOverrideFromDraft(draft);
    const effectiveLoads = overrideLoads != null ? overrideLoads : totalLoads;

    for (const table of templates) {
      const rows = invoiceRows[table.id] || [];
      if (!rows.length) continue;

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...RED);
      doc.text(String(table.name || '').toUpperCase(), margin, y + 5);
      y += 8;

      const cols = table.columns || [];
      const headers = cols.map((c) => String(c.label || '').toUpperCase());
      const body = rows.map((row) => cols.map((col) => formatTableCell(row, col, currency)));

      const subtotalMiles = rows.reduce((sum, row) => {
        let m = 0;
        cols.forEach((c) => {
          const key = String(c.name || '').toLowerCase();
          if (key === 'miles' || key === 'mileage' || key === 'loaded_miles' || key === 'distance') m += cellNumeric(row, c);
        });
        return sum + m;
      }, 0);
      const subtotalRates = rows.reduce((sum, row) => {
        let r = 0;
        cols.forEach((c) => {
          const key = String(c.name || '').toLowerCase();
          if (key === 'rate' || key === 'line_haul' || key === 'linehaul' || key === 'total_rate') r += cellNumeric(row, c);
        });
        return sum + r;
      }, 0);
      const subRow = cols.map((col) => {
        const key = (col.name || '').toLowerCase();
        if (col.col_type === 'number' || /rate|fee|amount|total|mile|haul|rpm/i.test(key)) {
          if (key.includes('rpm')) {
            const rpmVal = subtotalMiles > 0 ? subtotalRates / subtotalMiles : 0;
            return String(Number(rpmVal).toFixed(3)).toUpperCase();
          }
          if (key === 'dispatcher_fee' || key === 'dispatch_fee') {
            return String(fc(effectiveDispatchFee, currency)).toUpperCase();
          }
          const total = rows.reduce((s, r) => s + cellNumeric(r, col), 0);
          let cell = '';
          if (key.includes('fee') || key.includes('rate') || key.includes('amount')) {
            cell = fc(total, currency);
          } else {
            cell = total.toLocaleString();
          }
          return String(cell).toUpperCase();
        }
        return '';
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
        didParseCell(data) {
          if (data.row.index === body.length) {
            data.cell.styles.fillColor = LIGHT_GRAY;
            data.cell.styles.fontStyle = 'bold';
          }
        }
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    const rpm = totalMiles > 0 ? (totalRates / totalMiles).toFixed(3) : '0.000';

    if (y > pageH - 55) {
      doc.addPage();
      y = margin;
    }

    y += 4;
    const metricW = (pageW - margin * 2) / 5;
    const metrics = [
      ['LOADS', effectiveLoads],
      ['TOTAL MILES', Math.round(totalMiles).toLocaleString()],
      ['TOTAL RATES', fc(totalRates, currency)],
      ['RPM', rpm],
      ['DISPATCHER FEE', fc(effectiveDispatchFee, currency)]
    ];
    metrics.forEach((m, i) => {
      const mx = margin + i * metricW;
      doc.setFillColor(...LIGHT_GRAY);
      doc.rect(mx, y, metricW - 2, 16, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...GRAY);
      doc.text(m[0], mx + (metricW - 2) / 2, y + 6, { align: 'center' });
      doc.setFontSize(9.5);
      doc.setTextColor(...DARK);
      doc.text(String(m[1]), mx + (metricW - 2) / 2, y + 13, { align: 'center' });
    });
    y += 22;

    const payAcc = payload.payment_account || null;
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
    doc.text(fc(effectiveDispatchFee, currency), pageW - margin - 5, y + feeRowH - 7, { align: 'right' });

    y += feeRowH + 8;

    doc.setFillColor(...DARK);
    doc.rect(0, pageH - 12, pageW, 12, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text(
      `Runnex Logistics Invoice  |  ${displayCoName}  |  ${co.email || ''}`,
      pageW / 2,
      pageH - 4.5,
      { align: 'center' }
    );

    const safeNum = String(invNum).replace(/[^\w.-]+/g, '_');
    const safeDate = String(invDate || 'draft').replace(/[^\w.-]+/g, '_');
    doc.save(`Invoice-${safeNum}-${safeDate}.pdf`);
  }

  window.generateInvoicePdfFromExportData = generateInvoicePdfFromExportData;
})();
