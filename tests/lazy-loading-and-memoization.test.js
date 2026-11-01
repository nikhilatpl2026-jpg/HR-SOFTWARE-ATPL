const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('wbToSheets lazy proxy and memoization guarantees', async (t) => {
  // Mock XLSX worksheet
  const mockSheet = {
    '!ref': 'A1:H250',
    A1: { v: 'Emp Code' },
    B1: { v: 'Name' },
    C1: { v: 'Basic' },
    A2: { v: 'EMP001' },
    B2: { v: 'Ramesh' },
    C2: { v: '18000' }
  };

  const mockWb = {
    SheetNames: ['Salary_June', 'Summary_Sheet'],
    Sheets: {
      Salary_June: mockSheet,
      Summary_Sheet: { '!ref': 'A1:B10' }
    }
  };

  // Mock XLSX utils with call counter
  let sheetToJsonCalls = 0;
  const mockXlsx = {
    utils: {
      sheet_to_json: (ws, opts) => {
        sheetToJsonCalls++;
        return [
          ['Emp Code', 'Name', 'Basic'],
          ['EMP001', 'Ramesh', '18000']
        ];
      }
    }
  };

  global.window = {
    XLSX: mockXlsx
  };

  // createLazySheets implementation
  function createLazySheets(wb) {
    if (!wb || !Array.isArray(wb.SheetNames)) return {};
    if (wb.__lazySheets) return wb.__lazySheets;
    var target = {};
    wb.SheetNames.forEach(function(sn) {
      Object.defineProperty(target, sn, {
        enumerable: true,
        configurable: true,
        get: function() {
          var ws = wb.Sheets && wb.Sheets[sn];
          if (!ws) return [];
          if (ws.__cachedRowsFmt) return ws.__cachedRowsFmt;
          var res = (window.XLSX && window.XLSX.utils && typeof window.XLSX.utils.sheet_to_json === 'function')
            ? window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
            : [];
          try {
            Object.defineProperty(ws, '__cachedRowsFmt', { value: res, enumerable: false, configurable: true });
          } catch (_) {
            ws.__cachedRowsFmt = res;
          }
          return res;
        },
        set: function(val) {
          var ws = wb.Sheets && wb.Sheets[sn];
          if (ws) ws.__cachedRowsFmt = val;
        }
      });
    });
    wb.__lazySheets = target;
    return target;
  }

  function fastSheetRowCount(ws) {
    if (!ws || !ws['!ref']) return 0;
    if (typeof ws.__fastRows === 'number') return ws.__fastRows;
    var m = String(ws['!ref']).match(/:[A-Za-z]+(\d+)$/);
    ws.__fastRows = m ? Math.max(0, parseInt(m[1], 10) - 1) : 0;
    return ws.__fastRows;
  }

  function fastTotalWorkbookRows(wb) {
    if (!wb || !Array.isArray(wb.SheetNames)) return 0;
    if (typeof wb.__totalRows === 'number') return wb.__totalRows;
    var total = 0;
    for (var i = 0; i < wb.SheetNames.length; i++) {
      total += fastSheetRowCount(wb.Sheets && wb.Sheets[wb.SheetNames[i]]);
    }
    wb.__totalRows = total;
    return total;
  }

  // 1. Initial proxy creation must do ZERO sheet conversions
  const sheets = createLazySheets(mockWb);
  assert.equal(sheetToJsonCalls, 0, 'Creating lazy sheets proxy must not call sheet_to_json');

  // 2. fastSheetRowCount and fastTotalWorkbookRows must compute without calling sheet_to_json
  const totalRows = fastTotalWorkbookRows(mockWb);
  assert.equal(totalRows, 258, 'Fast row calculation should correctly sum up rows');
  assert.equal(sheetToJsonCalls, 0, 'fastTotalWorkbookRows must not call sheet_to_json');

  // 3. Accessing a sheet triggers conversion exactly once
  const rows = sheets['Salary_June'];
  assert.equal(sheetToJsonCalls, 1, 'First sheet access triggers sheet_to_json once');
  assert.equal(rows.length, 2, 'Row data should be returned');

  // 4. Repeated access to the same sheet must be memoized
  const rows2 = sheets['Salary_June'];
  assert.equal(sheetToJsonCalls, 1, 'Subsequent access must use memoized cached rows');
  assert.equal(rows2, rows, 'Cached object reference must be returned');

  // 5. Unaccessed sheets must remain unparsed
  assert.equal(mockWb.Sheets['Summary_Sheet'].__cachedRowsFmt, undefined, 'Summary_Sheet was never accessed, remains unparsed');
});
