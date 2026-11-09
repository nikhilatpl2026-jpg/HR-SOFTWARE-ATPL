/**
 * ATPL Virtual Salary Grid — High-Performance DOM Virtualizer Patch
 * For: https://github.com/nikhilatpl2026-jpg/HR-SOFTWARE-ATPL/
 * 
 * Features:
 *  - 60 FPS Virtual Scrolling Window
 *  - Auto-filter blank/dash rows with toggle (Clean view without empty spaces)
 *  - High-contrast Excel-grade typography and aligned sticky columns (No overlap)
 */
(function() {
  'use strict';
  if (window.__ATPL_VIRTUAL_GRID_INSTALLED__) return;
  window.__ATPL_VIRTUAL_GRID_INSTALLED__ = true;

  console.log('%c🚀 ATPL Virtual Salary Grid Engine v3.0 Active — Blank Row Filter & Crisp View Enabled', 'background:#10b981;color:#000;font-weight:bold;padding:4px 8px;border-radius:4px');

  var hideEmptyRowsState = true; // Default ON for clean viewing

  function isRowMeaningful(row) {
    if (!row || !Array.isArray(row) || row.length === 0) return false;
    var nonBlankCount = 0;
    for (var c = 0; c < row.length; c++) {
      var v = row[c];
      if (v !== undefined && v !== null) {
        var s = String(v).trim();
        if (s !== '' && s !== '—' && s !== '-' && s !== 'null' && s !== 'undefined') {
          nonBlankCount++;
        }
      }
    }
    return nonBlankCount > 0;
  }

  function createVirtualTable(container, rawRows, chArr, title, opts) {
    opts = opts || {};
    var rowHeight = opts.rowHeight || 34;
    var viewportHeight = opts.viewportHeight || 550;
    var overscan = opts.overscan || 8;

    var chSet = new Set();
    (chArr || []).forEach(function(c) { chSet.add((c.r || 0) + '-' + (c.c || 0)); });

    var hdr = rawRows[0] || [];
    var allBodyRows = rawRows.slice(1);

    var filteredBody = [];
    for (var b = 0; b < allBodyRows.length; b++) {
      var rObj = { originalIndex: b + 1, data: allBodyRows[b] };
      if (!hideEmptyRowsState || isRowMeaningful(allBodyRows[b])) {
        filteredBody.push(rObj);
      }
    }

    var totalRows = allBodyRows.length;
    var displayedRows = filteredBody.length;
    var hiddenRowsCount = totalRows - displayedRows;

    container.innerHTML = 
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;background:#090d16;padding:8px 14px;border-radius:8px 8px 0 0;border:1px solid #334155;border-bottom:none">' +
        '<div style="font-family:system-ui,-apple-system,sans-serif;font-size:11px;color:#34d399;font-weight:700;display:flex;align-items:center;gap:8px">' +
          '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#34d399"></span>' +
          '<span>⚡ ' + displayedRows.toLocaleString() + ' DATA ROWS' + (hiddenRowsCount > 0 ? ' <span style="color:#94a3b8;font-weight:normal">(' + hiddenRowsCount + ' blank rows hidden)</span>' : '') + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<button id="atplToggleBlankRowsBtn" style="background:' + (hideEmptyRowsState ? '#065f46' : '#1e293b') + ';color:' + (hideEmptyRowsState ? '#a7f3d0' : '#cbd5e1') + ';border:1px solid ' + (hideEmptyRowsState ? '#059669' : '#475569') + ';border-radius:6px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px">' +
            (hideEmptyRowsState ? '✓ Khali Rows Hidden' : '👁️ Show All Rows (Including Blank)') +
          '</button>' +
          '<div style="font-size:11px;color:#cbd5e1;font-weight:600">' +
            (title ? String(title) : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="atpl-virtual-viewport" style="height:' + viewportHeight + 'px;overflow:auto;position:relative;border:1px solid #334155;border-radius:0 0 8px 8px;background:#0b0f19">' +
        '<div class="atpl-virtual-spacer" style="height:' + (displayedRows * rowHeight) + 'px;position:relative">' +
          '<table style="width:100%;border-collapse:collapse;font-size:11px;min-width:max-content;font-family:system-ui,-apple-system,sans-serif">' +
            '<thead style="position:sticky;top:0;z-index:30;background:#1e293b;border-bottom:2px solid #475569">' +
              '<tr>' +
                '<th style="padding:8px 8px;background:#1e293b;color:#94a3b8;position:sticky;left:0;z-index:40;width:48px;min-width:48px;max-width:48px;text-align:center;border-right:1px solid #334155">#</th>' +
                hdr.map(function(h, ci) {
                  var isSticky = ci === 0 || ci === 1;
                  var leftPos = ci === 0 ? '48px' : ci === 1 ? '138px' : 'auto';
                  var wStyle = ci === 0 ? 'width:90px;min-width:90px;max-width:90px;' : ci === 1 ? 'width:180px;min-width:180px;max-width:240px;' : 'min-width:40px;';
                  return '<th style="padding:8px 10px;color:#f8fafc;text-align:left;white-space:nowrap;border-right:1px solid #334155;' + wStyle +
                    (isSticky ? 'position:sticky;left:' + leftPos + ';z-index:40;background:#1e293b;' : '') + '">' +
                    (h || 'Col ' + (ci + 1)) + '</th>';
                }).join('') +
              '</tr>' +
            '</thead>' +
            '<tbody class="atpl-virtual-tbody" style="position:absolute;top:0;left:0;right:0"></tbody>' +
          '</table>' +
        '</div>' +
      '</div>';

    var viewport = container.querySelector('.atpl-virtual-viewport');
    var tbody = container.querySelector('.atpl-virtual-tbody');
    var toggleBtn = container.querySelector('#atplToggleBlankRowsBtn');

    if (toggleBtn) {
      toggleBtn.onclick = function() {
        hideEmptyRowsState = !hideEmptyRowsState;
        createVirtualTable(container, rawRows, chArr, title, opts);
      };
    }

    if (!viewport || !tbody) return;

    function renderSlice() {
      var scrollTop = viewport.scrollTop;
      var rawStart = Math.floor(scrollTop / rowHeight);
      var visibleCount = Math.ceil(viewportHeight / rowHeight);
      var startIndex = Math.max(0, rawStart - overscan);
      var endIndex = Math.min(displayedRows, rawStart + visibleCount + overscan);
      var startOffset = startIndex * rowHeight;

      tbody.style.transform = 'translateY(' + startOffset + 'px)';

      var html = '';
      for (var i = startIndex; i < endIndex; i++) {
        var item = filteredBody[i];
        var row = item.data;
        var isEven = i % 2 === 0;
        var bg = isEven ? '#0b0f19' : '#111827';

        html += '<tr style="height:' + rowHeight + 'px;background:' + bg + ';border-bottom:1px solid #1f2937">' +
          '<td style="padding:4px 8px;text-align:center;color:#64748b;font-family:monospace;position:sticky;left:0;background:' + bg + ';z-index:10;border-right:1px solid #334155;width:48px;min-width:48px;max-width:48px">' + item.originalIndex + '</td>';

        for (var c = 0; c < hdr.length; c++) {
          var val = row[c] !== undefined && row[c] !== null ? row[c] : '';
          var sVal = String(val).trim();
          var isC = chSet.has(item.originalIndex + '-' + c);
          var isSticky = c === 0 || c === 1;
          var leftPos = c === 0 ? '48px' : c === 1 ? '138px' : 'auto';
          var wStyle = c === 0 ? 'width:90px;min-width:90px;max-width:90px;' : c === 1 ? 'width:180px;min-width:180px;max-width:240px;' : 'min-width:40px;';

          var textColor = '#e2e8f0';
          var textAlign = 'left';
          var fontWeight = '400';

          if (c === 0) {
            textColor = '#38bdf8';
            fontWeight = '700';
            textAlign = 'center';
          } else if (c === 1) {
            textColor = '#ffffff';
            fontWeight = '600';
          } else if (sVal === '' || sVal === '—' || sVal === '-') {
            textColor = '#475569';
            textAlign = 'center';
          } else if (/^\d+(\.\d+)?$/.test(sVal)) {
            textColor = '#34d399';
            textAlign = 'center';
            fontWeight = '600';
          }

          html += '<td style="padding:4px 10px;white-space:nowrap;border-right:1px solid #1f2937;color:' + textColor + ';text-align:' + textAlign + ';font-weight:' + fontWeight + ';' + wStyle +
            (isC ? 'background:rgba(239,68,68,0.25);color:#f87171;font-weight:bold;' : '') +
            (isSticky ? 'position:sticky;left:' + leftPos + ';background:' + bg + ';z-index:10;' : '') + '">' +
            (sVal === '' || sVal === '—' || sVal === '-' ? '<span style="color:#475569">—</span>' : sVal) + '</td>';
        }
        html += '</tr>';
      }
      tbody.innerHTML = html;
    }

    viewport.addEventListener('scroll', renderSlice, { passive: true });
    renderSlice();
  }

  window.createVirtualTable = createVirtualTable;

  var originalRenderTbl = window.renderTbl;
  window.renderTbl = function(rows, chArr, title) {
    if (!rows || !rows.length) return;
    if (rows.length <= 30 && typeof originalRenderTbl === 'function') {
      return originalRenderTbl(rows, chArr, title);
    }
    var wrap = document.getElementById('tblWrap');
    if (!wrap) return;
    var sR = document.getElementById('sR');
    var sC = document.getElementById('sC');
    if (sR) sR.textContent = rows.length - 1;
    if (sC) sC.textContent = (rows[0] || []).length;
    createVirtualTable(wrap, rows, chArr, title, { viewportHeight: 540 });
  };

  var originalRenderViewerSheet = window.renderViewerSheet;
  window.renderViewerSheet = function(fi, si) {
    if (window.FILES && window.FILES[fi]) {
      var f = window.FILES[fi];
      var sn = f.wb.SheetNames[si];
      var rows = f.sheets[sn];
      if (rows && rows.length > 20) {
        var fvBody = document.getElementById('fvBody');
        if (fvBody) {
          createVirtualTable(fvBody, rows, [], sn + ' (' + (rows.length - 1) + ' rows)', { viewportHeight: 600 });
          return;
        }
      }
    }
    if (typeof originalRenderViewerSheet === 'function') {
      return originalRenderViewerSheet(fi, si);
    }
  };
})();
