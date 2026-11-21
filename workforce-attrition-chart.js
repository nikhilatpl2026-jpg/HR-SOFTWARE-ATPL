/**
 * ATPL Workforce Dashboard — 12-Month Attrition Rate D3 Line Chart Engine
 * Visualizes Monthly Attrition Rate (Left vs. Active employees) across 12 months
 * with seasonal turnover spike detection, interactive tooltips, department filter,
 * and click-to-inspect period synchronization.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ATPLWorkforceAttrition = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_LONG = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  function escapeHtml(val) {
    return String(val == null ? '' : val).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function normDept(val) {
    return String(val || 'General').trim() || 'General';
  }

  function normKey(val) {
    return String(val || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function empIdentityKey(emp, fallbackPrefix) {
    var code = normKey(emp && (emp.emp_id || emp.empCode || emp.code));
    if (code) return 'ID:' + code;
    var name = normKey(emp && (emp.name || emp.empName));
    if (name) return 'NM:' + name;
    return fallbackPrefix || '';
  }

  function parseFlexibleDate(val) {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    var s = String(val).trim();
    if (!s || s === '—' || s === '-' || s === 'NA' || s === 'N/A' || s === 'NIL') return null;

    // DD-MM-YYYY or DD/MM/YYYY
    var dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s.*)?$/.exec(s);
    if (dmy) {
      var day = parseInt(dmy[1], 10);
      var mon = parseInt(dmy[2], 10);
      var yr = parseInt(dmy[3], 10);
      if (yr < 100) yr += yr < 50 ? 2000 : 1900;
      if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
        var dt1 = new Date(yr, mon - 1, day);
        if (!isNaN(dt1.getTime()) && dt1.getMonth() === mon - 1) return dt1;
      }
    }

    // YYYY-MM-DD or YYYY/MM/DD (with optional ISO time)
    var ymd = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[T\s].*)?$/.exec(s);
    if (ymd) {
      var yr2 = parseInt(ymd[1], 10);
      var mon2 = parseInt(ymd[2], 10);
      var day2 = parseInt(ymd[3], 10);
      if (mon2 >= 1 && mon2 <= 12 && day2 >= 1 && day2 <= 31) {
        var dt2 = new Date(yr2, mon2 - 1, day2);
        if (!isNaN(dt2.getTime()) && dt2.getMonth() === mon2 - 1) return dt2;
      }
    }

    // DD-MMM-YYYY or DD MMM YYYY (e.g. 15-Aug-2025)
    var dMonY = /^(\d{1,2})[\s\-]([A-Za-z]{3,9})[\s\-](\d{2,4})$/.exec(s);
    if (dMonY) {
      var mIdx = MONTH_SHORT.findIndex(function (m) {
        return dMonY[2].toLowerCase().indexOf(m.toLowerCase()) === 0;
      });
      if (mIdx >= 0) {
        var yr3 = parseInt(dMonY[3], 10);
        if (yr3 < 100) yr3 += 2000;
        var dt3 = new Date(yr3, mIdx, parseInt(dMonY[1], 10));
        if (!isNaN(dt3.getTime())) return dt3;
      }
    }

    var parsed = new Date(s);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function isMarkedLeft(emp) {
    if (!emp) return false;
    var s = String(emp.status || '').toUpperCase().trim();
    if (s === 'LEFT' || s === 'EXITED' || s === 'RESIGNED' || s === 'TERMINATED' || s === 'DOL' || s === 'INACTIVE') {
      return true;
    }
    var dol = String(emp.dol || emp.leaving_date || emp.dolField || emp.date_of_leaving || '').trim();
    return Boolean(dol && dol !== 'NA' && dol !== 'N/A' && dol !== '-' && dol !== '—');
  }

  function build12MonthWindows(anchorYear, anchorMonthNum, windowMode) {
    var windows = [];
    var endY = parseInt(anchorYear, 10) || new Date().getFullYear();
    var endM = parseInt(anchorMonthNum, 10) || (new Date().getMonth() + 1);

    if (windowMode === 'calendar') {
      for (var m = 1; m <= 12; m++) {
        var mk = String(m).padStart(2, '0');
        windows.push({
          year: endY,
          monthNum: m,
          monthKey: mk,
          ym: endY + '-' + mk,
          shortLabel: MONTH_SHORT[m - 1] + " '" + String(endY).slice(2),
          monthName: MONTH_SHORT[m - 1],
          fullLabel: MONTH_LONG[m - 1] + ' ' + endY,
          startD: new Date(endY, m - 1, 1, 0, 0, 0),
          endD: new Date(endY, m, 0, 23, 59, 59, 999)
        });
      }
      return windows;
    }

    // Default: rolling last 12 months ending at (endY, endM)
    for (var offset = 11; offset >= 0; offset--) {
      var d = new Date(endY, endM - 1 - offset, 1);
      var y = d.getFullYear();
      var mNum = d.getMonth() + 1;
      var mKey = String(mNum).padStart(2, '0');
      windows.push({
        year: y,
        monthNum: mNum,
        monthKey: mKey,
        ym: y + '-' + mKey,
        shortLabel: MONTH_SHORT[mNum - 1] + " '" + String(y).slice(2),
        monthName: MONTH_SHORT[mNum - 1],
        fullLabel: MONTH_LONG[mNum - 1] + ' ' + y,
        startD: new Date(y, mNum - 1, 1, 0, 0, 0),
        endD: new Date(y, mNum, 0, 23, 59, 59, 999)
      });
    }
    return windows;
  }

  function loadComplianceSheetsByMonth(storageObj) {
    var byYm = {};
    try {
      var store = storageObj || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!store || typeof store.getItem !== 'function') return byYm;
      var raw = store.getItem('ATPL_ComplianceSheets_V1');
      if (!raw) return byYm;
      var parsed = JSON.parse(raw);
      var list = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
      list.forEach(function (sh) {
        if (!sh || !Array.isArray(sh.rows) || !sh.rows.length) return;
        var ym = String(sh.month || '').trim();
        if (!/^\d{4}-\d{2}$/.test(ym)) return;
        if (!byYm[ym] || (sh.updatedAt && (!byYm[ym].updatedAt || sh.updatedAt > byYm[ym].updatedAt))) {
          byYm[ym] = sh;
        }
      });
    } catch (_) {}
    return byYm;
  }

  function collectDepartments(employees, complianceMap, seriesRaw) {
    var deptSet = Object.create(null);
    (employees || []).forEach(function (e) {
      if (!e) return;
      deptSet[normDept(e.dept || e.department || e.category)] = true;
    });
    Object.keys(complianceMap || {}).forEach(function (ym) {
      var sh = complianceMap[ym];
      (sh && sh.rows || []).forEach(function (r) {
        if (r && (r.department || r.category)) {
          deptSet[normDept(r.department || r.category)] = true;
        }
      });
    });
    (seriesRaw || []).forEach(function (m) {
      if (m && m.deptMap) {
        Object.keys(m.deptMap).forEach(function (d) { deptSet[normDept(d)] = true; });
      }
    });
    return Object.keys(deptSet).sort(function (a, b) { return a.localeCompare(b); });
  }

  /**
   * Computes 12-month monthly attrition dataset (Left vs. Active + Attrition Rate %)
   */
  function computeAttritionSeries(employees, options) {
    var opts = options || {};
    var anchorYear = parseInt(opts.anchorYear, 10) || new Date().getFullYear();
    var anchorMonthNum = parseInt(opts.anchorMonthNum, 10) || (new Date().getMonth() + 1);
    var windowMode = opts.windowMode === 'calendar' ? 'calendar' : 'rolling12';
    var deptFilter = opts.dept && opts.dept !== 'ALL' ? normDept(opts.dept) : 'ALL';
    var getSalaryFileFn = typeof opts.getMonthlySalaryFileData === 'function'
      ? opts.getMonthlySalaryFileData
      : null;

    var empList = Array.isArray(employees) ? employees : [];
    var filteredMaster = deptFilter === 'ALL'
      ? empList
      : empList.filter(function (e) {
        return normDept(e && (e.dept || e.department || e.category)) === deptFilter;
      });

    var complianceByYm = opts.complianceSheetsByYm || loadComplianceSheetsByMonth(opts.storage);
    var windows = build12MonthWindows(anchorYear, anchorMonthNum, windowMode);

    var salaryByYm = {};
    windows.forEach(function (w) {
      if (getSalaryFileFn) {
        try {
          var fd = getSalaryFileFn(w.year, w.monthKey);
          if (fd && fd.hasFile) salaryByYm[w.ym] = fd;
        } catch (_) {}
      }
    });

    var departments = collectDepartments(empList, complianceByYm, Object.keys(salaryByYm).map(function (k) {
      return salaryByYm[k];
    }));

    var prevActive = null;
    var points = windows.map(function (w, idx) {
      var leftKeys = Object.create(null);
      var activeKeys = Object.create(null);
      var joinedKeys = Object.create(null);
      var dataSource = 'Master';

      var compSheet = complianceByYm[w.ym];
      var fileData = salaryByYm[w.ym];

      // 1. Always capture Master DOJs & DOLs falling in this month window
      var masterActive = 0;
      filteredMaster.forEach(function (e, ei) {
        if (!e) return;
        var key = empIdentityKey(e, 'M_' + ei);
        var doj = parseFlexibleDate(e.doj || e.joining_date || e.date_of_joining);
        var dol = parseFlexibleDate(e.dol || e.leaving_date || e.dolField || e.date_of_leaving);
        var leftFlag = isMarkedLeft(e);

        // If marked LEFT without explicit DOL, check _status_updated_at timestamp if valid
        var inferredLeftDate = null;
        if (!dol && leftFlag && e._status_updated_at) {
          var ts = new Date(Number(e._status_updated_at));
          if (!isNaN(ts.getTime())) inferredLeftDate = ts;
        }
        var effectiveDol = dol || inferredLeftDate;

        if (doj && doj >= w.startD && doj <= w.endD) {
          joinedKeys[key] = true;
        }
        if (effectiveDol && effectiveDol >= w.startD && effectiveDol <= w.endD) {
          leftKeys[key] = true;
        }

        var joinedBeforeEnd = !doj || doj <= w.endD;
        var notLeftBeforeStart = !effectiveDol
          ? (!leftFlag || true)
          : (effectiveDol >= w.startD);
        // If explicitly marked LEFT before this month without a DOL date, treat as inactive after status date
        if (leftFlag && !effectiveDol) {
          notLeftBeforeStart = false;
        }

        if (joinedBeforeEnd && notLeftBeforeStart) {
          masterActive++;
          activeKeys[key] = true;
        }
      });

      var activeCount = masterActive;

      // 2. If uploaded Salary File exists for this month, refine Active count & capture file-level DOL/zero exits
      if (fileData && fileData.hasFile && Array.isArray(fileData.roster)) {
        dataSource = 'Salary File';
        var fileRoster = deptFilter === 'ALL'
          ? fileData.roster
          : fileData.roster.filter(function (r) { return normDept(r && r.dept) === deptFilter; });

        var fActive = 0;
        fileRoster.forEach(function (r, ri) {
          var key = empIdentityKey(r, 'F_' + ri);
          var rDol = parseFlexibleDate(r.dol);
          var rLeft = isMarkedLeft(r) || (rDol && rDol >= w.startD && rDol <= w.endD);
          if (rDol && rDol >= w.startD && rDol <= w.endD) {
            leftKeys[key] = true;
          }
          if (!rLeft || (rDol && rDol >= w.startD)) {
            fActive++;
          }
        });
        activeCount = fActive;
      }

      // 3. If saved Compliance Studio sheet exists for this month, enrich active vs 0-day/off-roll exits
      if (compSheet && Array.isArray(compSheet.rows) && compSheet.rows.length) {
        var compRows = deptFilter === 'ALL'
          ? compSheet.rows
          : compSheet.rows.filter(function (r) {
            return normDept(r && (r.department || r.category)) === deptFilter;
          });
        if (compRows.length > 0) {
          if (dataSource === 'Master') dataSource = 'Compliance Sheet';
          var cActive = 0;
          compRows.forEach(function (r, ci) {
            var key = empIdentityKey({ emp_id: r.empId, name: r.name }, 'C_' + ci);
            var paid = Number(r.paidDays) || 0;
            var rem = String(r.remarks || '').trim().toUpperCase();
            if (paid <= 0 || r.isLeft || rem === 'OFF ROLL' || rem.indexOf('LEFT') >= 0) {
              leftKeys[key] = true;
            } else {
              cActive++;
            }
          });
          if (dataSource === 'Compliance Sheet' && cActive > 0) {
            activeCount = cActive;
          }
        }
      }

      var leftCount = Object.keys(leftKeys).length;
      var joinedCount = Object.keys(joinedKeys).length;

      // Average headcount denominator for standard HR monthly attrition formula
      var avgHeadcount = prevActive !== null && prevActive > 0
        ? (prevActive + activeCount) / 2
        : (activeCount > 0 ? activeCount : (leftCount > 0 ? leftCount : 0));

      var attritionRatePct = avgHeadcount > 0
        ? Number(((leftCount / avgHeadcount) * 100).toFixed(2))
        : 0;

      prevActive = activeCount;

      return {
        index: idx,
        year: w.year,
        monthNum: w.monthNum,
        monthKey: w.monthKey,
        ym: w.ym,
        shortLabel: w.shortLabel,
        monthName: w.monthName,
        fullLabel: w.fullLabel,
        active: activeCount,
        left: leftCount,
        joined: joinedCount,
        netChange: joinedCount - leftCount,
        avgHeadcount: Number(avgHeadcount.toFixed(1)),
        attritionRatePct: attritionRatePct,
        dataSource: dataSource,
        isSpike: false,
        deltaFromAvg: 0
      };
    });

    var totalLeft = points.reduce(function (s, p) { return s + p.left; }, 0);
    var totalJoined = points.reduce(function (s, p) { return s + p.joined; }, 0);
    var activeMonths = points.filter(function (p) { return p.active > 0 || p.left > 0; });
    var avgAttritionPct = activeMonths.length > 0
      ? Number((activeMonths.reduce(function (s, p) { return s + p.attritionRatePct; }, 0) / activeMonths.length).toFixed(2))
      : 0;
    var avgLeftCount = activeMonths.length > 0
      ? Number((totalLeft / activeMonths.length).toFixed(1))
      : 0;
    var avgActiveHeadcount = activeMonths.length > 0
      ? Math.round(activeMonths.reduce(function (s, p) { return s + p.active; }, 0) / activeMonths.length)
      : 0;

    // Seasonal turnover spike detection using mean + standard deviation
    var variance = activeMonths.length > 0
      ? activeMonths.reduce(function (s, p) {
        var diff = p.attritionRatePct - avgAttritionPct;
        return s + diff * diff;
      }, 0) / activeMonths.length
      : 0;
    var stdDev = Math.sqrt(variance);
    var spikeThreshold = avgAttritionPct > 0
      ? Math.max(avgAttritionPct * 1.35, avgAttritionPct + Math.max(0.75, 0.85 * stdDev))
      : 0;

    var peakPoint = null;
    var spikePoints = [];
    points.forEach(function (p) {
      p.deltaFromAvg = Number((p.attritionRatePct - avgAttritionPct).toFixed(2));
      if (p.left > 0 && spikeThreshold > 0 && p.attritionRatePct >= spikeThreshold) {
        p.isSpike = true;
        spikePoints.push(p);
      }
      if (p.left > 0 && (!peakPoint || p.attritionRatePct > peakPoint.attritionRatePct || (p.attritionRatePct === peakPoint.attritionRatePct && p.left > peakPoint.left))) {
        peakPoint = p;
      }
    });

    // If exits happened & there's a clear peak strictly above average even below 1.35x, ensure peak is surfaced
    if (!spikePoints.length && peakPoint && peakPoint.attritionRatePct > avgAttritionPct && peakPoint.left > 0) {
      peakPoint.isSpike = true;
      spikePoints.push(peakPoint);
    }

    var latestPoint = points[points.length - 1] || null;
    var hasAnyData = points.some(function (p) { return p.active > 0 || p.left > 0; });

    return {
      points: points,
      departments: departments,
      deptFilter: deptFilter,
      windowMode: windowMode,
      summary: {
        hasAnyData: hasAnyData,
        hasAnyExits: totalLeft > 0,
        totalLeft: totalLeft,
        totalJoined: totalJoined,
        avgAttritionPct: avgAttritionPct,
        avgLeftCount: avgLeftCount,
        avgActiveHeadcount: avgActiveHeadcount,
        spikeThreshold: Number(spikeThreshold.toFixed(2)),
        spikeCount: spikePoints.length,
        spikeMonthsLabel: spikePoints.map(function (p) { return p.shortLabel; }).join(', '),
        peakPoint: peakPoint,
        latestActive: latestPoint ? latestPoint.active : 0,
        latestRatePct: latestPoint ? latestPoint.attritionRatePct : 0
      }
    };
  }

  /**
   * Renders the interactive D3 v7 Line Chart inside the Workforce Dashboard container
   */
  function renderAttritionD3LineChart(containerEl, seriesResult, opts) {
    var options = opts || {};
    var d3Lib = options.d3 || (typeof window !== 'undefined' ? window.d3 : (typeof globalThis !== 'undefined' ? globalThis.d3 : null));
    if (!containerEl) return null;

    var points = (seriesResult && seriesResult.points) || [];
    var summary = (seriesResult && seriesResult.summary) || {};
    var mode = options.mode || 'rate_vs_active'; // 'rate_vs_active' | 'left_vs_active' | 'rate_only'
    var selectedYm = options.selectedYm || '';
    var onMonthSelect = typeof options.onMonthSelect === 'function' ? options.onMonthSelect : null;
    var onSyncClick = typeof options.onSyncClick === 'function' ? options.onSyncClick : null;

    var hostDoc = containerEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
    containerEl.innerHTML = '';

    if (!d3Lib) {
      containerEl.innerHTML = '<div style="padding:36px 20px;text-align:center;color:#94a3b8;font-size:12px">Chart engine loading... Refresh or sync dashboard to render the 12-month attrition curve.</div>';
      return null;
    }

    if (!summary.hasAnyData) {
      var emptyWrap = hostDoc.createElement('div');
      emptyWrap.style.cssText = 'padding:38px 20px;text-align:center;background:#090d16;border:1px dashed #1e293b;border-radius:10px';
      emptyWrap.innerHTML =
        '<div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:6px">No workforce or salary records available for this 12-month window</div>' +
        '<div style="font-size:11px;color:#94a3b8;max-width:480px;margin:0 auto 14px;line-height:1.5">Sync Employee Master or upload monthly salary sheets to visualize monthly attrition rate (Left vs. Active) and detect seasonal turnover spikes.</div>';
      var syncBtn = hostDoc.createElement('button');
      syncBtn.type = 'button';
      syncBtn.textContent = 'Sync Workforce Data';
      syncBtn.style.cssText = 'padding:7px 14px;background:#0284c7;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer';
      syncBtn.onclick = function () {
        if (onSyncClick) onSyncClick();
        else if (typeof window !== 'undefined' && typeof window.syncAllAtplModules === 'function') window.syncAllAtplModules(true);
      };
      emptyWrap.appendChild(syncBtn);
      containerEl.appendChild(emptyWrap);
      return null;
    }

    var rectW = (containerEl.getBoundingClientRect && containerEl.getBoundingClientRect().width) || containerEl.clientWidth || 920;
    var width = Math.max(540, Math.round(rectW));
    var height = 290;
    var showActiveLine = mode !== 'rate_only';
    var isCountMode = mode === 'left_vs_active';
    var margin = { top: 26, right: showActiveLine ? 58 : 24, bottom: 34, left: 50 };
    var innerW = Math.max(240, width - margin.left - margin.right);
    var innerH = Math.max(160, height - margin.top - margin.bottom);

    var rootSel = d3Lib.select(containerEl);
    var svg = rootSel.append('svg')
      .attr('class', 'dash-attrition-svg')
      .attr('viewBox', '0 0 ' + width + ' ' + height)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('role', 'img')
      .attr('aria-label', '12-Month Monthly Attrition Rate Left vs Active Line Chart')
      .style('width', '100%')
      .style('height', height + 'px')
      .style('display', 'block')
      .style('overflow', 'visible');

    var defs = svg.append('defs');
    var gradId = 'attrAreaGrad_' + Math.random().toString(36).slice(2, 8);
    var grad = defs.append('linearGradient')
      .attr('id', gradId)
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#f43f5e').attr('stop-opacity', 0.28);
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#f43f5e').attr('stop-opacity', 0.01);

    var g = svg.append('g')
      .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    var x = d3Lib.scalePoint()
      .domain(points.map(function (d) { return d.shortLabel; }))
      .range([0, innerW])
      .padding(0.42);

    var leftValFn = function (d) { return isCountMode ? d.left : d.attritionRatePct; };
    var rawMaxLeft = d3Lib.max(points, leftValFn) || 0;
    var leftMax = isCountMode
      ? Math.max(4, Math.ceil(rawMaxLeft * 1.25))
      : Math.max(2, Math.ceil(rawMaxLeft * 1.3 * 10) / 10);

    var yLeft = d3Lib.scaleLinear()
      .domain([0, leftMax])
      .nice(5)
      .range([innerH, 0]);

    var actMinRaw = d3Lib.min(points, function (d) { return d.active; }) || 0;
    var actMaxRaw = d3Lib.max(points, function (d) { return d.active; }) || 0;
    var actSpan = Math.max(10, actMaxRaw - actMinRaw);
    var yRightMin = Math.max(0, Math.floor((actMinRaw - actSpan * 0.35) / 10) * 10);
    var yRightMax = Math.max(yRightMin + 10, Math.ceil((actMaxRaw + actSpan * 0.2) / 10) * 10);

    var yRight = d3Lib.scaleLinear()
      .domain([yRightMin, yRightMax])
      .nice(5)
      .range([innerH, 0]);

    // 1. Seasonal Spike Vertical Bands (placed behind grid/lines)
    var bandWidth = Math.max(22, Math.min(48, (x.step ? x.step() : innerW / 12) * 0.65));
    var spikeBands = g.selectAll('.attr-spike-band')
      .data(points.filter(function (d) { return d.isSpike; }))
      .enter()
      .append('g')
      .attr('class', 'attr-spike-band');

    spikeBands.append('rect')
      .attr('x', function (d) { return x(d.shortLabel) - bandWidth / 2; })
      .attr('y', 0)
      .attr('width', bandWidth)
      .attr('height', innerH)
      .attr('rx', 4)
      .attr('fill', 'rgba(244, 63, 94, 0.08)')
      .attr('stroke', 'rgba(244, 63, 94, 0.22)')
      .attr('stroke-dasharray', '3,3');

    spikeBands.append('text')
      .attr('x', function (d) { return x(d.shortLabel); })
      .attr('y', -8)
      .attr('text-anchor', 'middle')
      .attr('fill', '#fda4af')
      .style('font-size', '9px')
      .style('font-weight', '700')
      .style('letter-spacing', '0.03em')
      .text('SPIKE');

    // 2. Horizontal Gridlines
    var gridAxis = d3Lib.axisLeft(yLeft)
      .ticks(5)
      .tickSize(-innerW)
      .tickFormat('');
    var gridG = g.append('g')
      .attr('class', 'attr-grid')
      .call(gridAxis);
    gridG.select('.domain').remove();
    gridG.selectAll('line')
      .attr('stroke', 'rgba(148, 163, 184, 0.12)')
      .attr('stroke-dasharray', '2,3');

    // 3. Axes (Bottom X, Left Y, optional Right Y)
    var xAxisG = g.append('g')
      .attr('class', 'attr-axis-x')
      .attr('transform', 'translate(0,' + innerH + ')')
      .call(d3Lib.axisBottom(x).tickSize(0).tickPadding(10));
    xAxisG.select('.domain').attr('stroke', '#1e293b');
    xAxisG.selectAll('text')
      .attr('fill', function (label) {
        var pt = points.find(function (p) { return p.shortLabel === label; });
        if (pt && pt.ym === selectedYm) return '#a5b4fc';
        if (pt && pt.isSpike) return '#fda4af';
        return '#94a3b8';
      })
      .style('font-size', '10px')
      .style('font-weight', function (label) {
        var pt = points.find(function (p) { return p.shortLabel === label; });
        return (pt && (pt.ym === selectedYm || pt.isSpike)) ? '700' : '500';
      })
      .style('font-family', "'JetBrains Mono', monospace");

    var yLeftAxis = d3Lib.axisLeft(yLeft)
      .ticks(5)
      .tickSize(0)
      .tickPadding(8)
      .tickFormat(function (v) {
        return isCountMode ? String(Math.round(v)) : (Number(v).toFixed(v % 1 === 0 ? 0 : 1) + '%');
      });
    var yLeftG = g.append('g').attr('class', 'attr-axis-yleft').call(yLeftAxis);
    yLeftG.select('.domain').remove();
    yLeftG.selectAll('text')
      .attr('fill', '#fda4af')
      .style('font-size', '10px')
      .style('font-family', "'JetBrains Mono', monospace");

    g.append('text')
      .attr('x', -margin.left + 4)
      .attr('y', -10)
      .attr('fill', '#fda4af')
      .style('font-size', '10px')
      .style('font-weight', '700')
      .text(isCountMode ? 'Left (Staff)' : 'Attrition %');

    if (showActiveLine) {
      var yRightAxis = d3Lib.axisRight(yRight)
        .ticks(5)
        .tickSize(0)
        .tickPadding(8)
        .tickFormat(function (v) { return String(Math.round(v)); });
      var yRightG = g.append('g')
        .attr('class', 'attr-axis-yright')
        .attr('transform', 'translate(' + innerW + ',0)')
        .call(yRightAxis);
      yRightG.select('.domain').remove();
      yRightG.selectAll('text')
        .attr('fill', '#6ee7b7')
        .style('font-size', '10px')
        .style('font-family', "'JetBrains Mono', monospace");

      g.append('text')
        .attr('x', innerW + margin.right - 4)
        .attr('y', -10)
        .attr('text-anchor', 'end')
        .attr('fill', '#6ee7b7')
        .style('font-size', '10px')
        .style('font-weight', '700')
        .text('Active Staff');
    }

    // 4. 12M Average Baseline Reference Line
    var avgPrimaryVal = isCountMode ? (summary.avgLeftCount || 0) : (summary.avgAttritionPct || 0);
    if (avgPrimaryVal > 0 && avgPrimaryVal <= yLeft.domain()[1]) {
      var avgY = yLeft(avgPrimaryVal);
      g.append('line')
        .attr('class', 'attr-avg-line')
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', avgY)
        .attr('y2', avgY)
        .attr('stroke', '#f59e0b')
        .attr('stroke-width', 1.25)
        .attr('stroke-dasharray', '5,4')
        .attr('opacity', 0.8);

      g.append('text')
        .attr('x', innerW - 4)
        .attr('y', Math.max(10, avgY - 5))
        .attr('text-anchor', 'end')
        .attr('fill', '#fbbf24')
        .style('font-size', '9.5px')
        .style('font-weight', '700')
        .style('font-family', "'JetBrains Mono', monospace")
        .text('12M Avg: ' + (isCountMode ? (avgPrimaryVal + ' left') : (avgPrimaryVal.toFixed(2) + '%')));
    }

    // 5. Area Under Primary Curve
    var areaGen = d3Lib.area()
      .x(function (d) { return x(d.shortLabel); })
      .y0(innerH)
      .y1(function (d) { return yLeft(leftValFn(d)); })
      .curve(d3Lib.curveMonotoneX);

    g.append('path')
      .datum(points)
      .attr('class', 'attr-area-primary')
      .attr('fill', 'url(#' + gradId + ')')
      .attr('d', areaGen);

    // 6. Active Employees Secondary Comparison Line (Left vs Active)
    if (showActiveLine) {
      var activeLineGen = d3Lib.line()
        .x(function (d) { return x(d.shortLabel); })
        .y(function (d) { return yRight(d.active); })
        .curve(d3Lib.curveMonotoneX);

      g.append('path')
        .datum(points)
        .attr('class', 'attr-line-active')
        .attr('fill', 'none')
        .attr('stroke', '#34d399')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '6,4')
        .attr('opacity', 0.92)
        .attr('d', activeLineGen);

      g.selectAll('.attr-dot-active')
        .data(points)
        .enter()
        .append('circle')
        .attr('class', 'attr-dot-active')
        .attr('cx', function (d) { return x(d.shortLabel); })
        .attr('cy', function (d) { return yRight(d.active); })
        .attr('r', 3)
        .attr('fill', '#090d16')
        .attr('stroke', '#34d399')
        .attr('stroke-width', 1.75);
    }

    // 7. Primary Attrition Line (Attrition Rate % or Left Count)
    var primaryLineGen = d3Lib.line()
      .x(function (d) { return x(d.shortLabel); })
      .y(function (d) { return yLeft(leftValFn(d)); })
      .curve(d3Lib.curveMonotoneX);

    var primaryPath = g.append('path')
      .datum(points)
      .attr('class', 'attr-line-primary')
      .attr('fill', 'none')
      .attr('stroke', '#f43f5e')
      .attr('stroke-width', 2.75)
      .attr('stroke-linecap', 'round')
      .attr('d', primaryLineGen);

    // Respect prefers-reduced-motion during path reveal animation
    var reduceMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion && primaryPath.node() && typeof primaryPath.node().getTotalLength === 'function') {
      try {
        var totalLen = primaryPath.node().getTotalLength();
        if (totalLen > 0) {
          primaryPath
            .attr('stroke-dasharray', totalLen + ' ' + totalLen)
            .attr('stroke-dashoffset', totalLen)
            .transition()
            .duration(520)
            .ease(d3Lib.easeCubicOut)
            .attr('stroke-dashoffset', 0)
            .on('end', function () {
              d3Lib.select(this).attr('stroke-dasharray', null);
            });
        }
      } catch (_) {}
    }

    // 8. Data Nodes + Spike Rings + Labels
    var nodeGroups = g.selectAll('.attr-node')
      .data(points)
      .enter()
      .append('g')
      .attr('class', 'attr-node')
      .attr('transform', function (d) { return 'translate(' + x(d.shortLabel) + ',' + yLeft(leftValFn(d)) + ')'; })
      .style('cursor', 'pointer')
      .attr('tabindex', '0')
      .attr('role', 'button')
      .attr('aria-label', function (d) {
        return d.fullLabel + ': ' + d.attritionRatePct.toFixed(2) + '% attrition rate, ' + d.left + ' left vs ' + d.active + ' active';
      });

    // Spike halo ring
    nodeGroups.filter(function (d) { return d.isSpike; })
      .append('circle')
      .attr('r', 8.5)
      .attr('fill', 'rgba(244, 63, 94, 0.20)')
      .attr('stroke', '#fb7185')
      .attr('stroke-width', 1.25);

    // Selected dashboard month indicator ring
    nodeGroups.filter(function (d) { return d.ym === selectedYm; })
      .append('circle')
      .attr('r', 7)
      .attr('fill', 'none')
      .attr('stroke', '#818cf8')
      .attr('stroke-width', 2);

    // Core point circle
    nodeGroups.append('circle')
      .attr('class', 'attr-dot-primary')
      .attr('r', function (d) { return d.isSpike ? 4.8 : (d.ym === selectedYm ? 4.5 : 3.6); })
      .attr('fill', function (d) { return d.isSpike ? '#f43f5e' : '#090d16'; })
      .attr('stroke', function (d) { return d.isSpike ? '#ffe4e6' : '#f43f5e'; })
      .attr('stroke-width', 2);

    // Value label on spike or non-zero months (clean, non-overlapping)
    nodeGroups.filter(function (d) { return d.isSpike || (d.left > 0 && points.filter(function (p) { return p.left > 0; }).length <= 6); })
      .append('text')
      .attr('y', -11)
      .attr('text-anchor', 'middle')
      .attr('fill', function (d) { return d.isSpike ? '#fecdd3' : '#cbd5e1'; })
      .style('font-size', '9.5px')
      .style('font-weight', '700')
      .style('font-family', "'JetBrains Mono', monospace")
      .text(function (d) { return isCountMode ? (d.left + ' left') : (d.attritionRatePct.toFixed(1) + '%'); });

    // 9. Interactive Crosshair & Floating Tooltip
    var hoverLine = g.append('line')
      .attr('class', 'attr-hover-line')
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', '#475569')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .style('opacity', 0)
      .style('pointer-events', 'none');

    var hoverDotPrimary = g.append('circle')
      .attr('r', 6)
      .attr('fill', '#f43f5e')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .style('opacity', 0)
      .style('pointer-events', 'none');

    var hoverDotActive = g.append('circle')
      .attr('r', 5)
      .attr('fill', '#34d399')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .style('opacity', 0)
      .style('pointer-events', 'none');

    var tooltip = hostDoc.createElement('div');
    tooltip.id = 'dashAttritionTooltip';
    tooltip.className = 'dash-attrition-tooltip';
    containerEl.appendChild(tooltip);

    function showTooltipFor(d) {
      if (!d) return;
      var cx = x(d.shortLabel);
      var cyPrim = yLeft(leftValFn(d));
      hoverLine.attr('x1', cx).attr('x2', cx).style('opacity', 1);
      hoverDotPrimary.attr('cx', cx).attr('cy', cyPrim).style('opacity', 1);
      if (showActiveLine) {
        hoverDotActive.attr('cx', cx).attr('cy', yRight(d.active)).style('opacity', 1);
      }

      var deltaSign = d.deltaFromAvg > 0 ? '+' : '';
      var deltaColor = d.deltaFromAvg > 0 ? '#fda4af' : '#6ee7b7';
      var spikeBanner = d.isSpike
        ? '<div style="margin-bottom:6px;padding:2px 6px;background:rgba(244,63,94,0.18);color:#fda4af;border-radius:4px;font-size:10px;font-weight:700;display:inline-block">Seasonal Turnover Spike</div>'
        : '';

      tooltip.innerHTML =
        spikeBanner +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px;border-bottom:1px solid #1e293b;padding-bottom:5px">' +
          '<strong style="color:#f8fafc;font-size:12px">' + escapeHtml(d.fullLabel) + '</strong>' +
          '<span style="color:#94a3b8;font-size:10px">' + escapeHtml(d.dataSource) + '</span>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr auto;gap:3px 14px;font-size:11px">' +
          '<span style="color:#fda4af">Attrition Rate</span><strong style="color:#fff;font-family:\'JetBrains Mono\',monospace">' + d.attritionRatePct.toFixed(2) + '%</strong>' +
          '<span style="color:#cbd5e1">Left Employees</span><strong style="color:#f87171;font-family:\'JetBrains Mono\',monospace">' + d.left + '</strong>' +
          '<span style="color:#cbd5e1">Active Employees</span><strong style="color:#34d399;font-family:\'JetBrains Mono\',monospace">' + d.active + '</strong>' +
          '<span style="color:#cbd5e1">New Joinees</span><strong style="color:#93c5fd;font-family:\'JetBrains Mono\',monospace">+' + d.joined + '</strong>' +
          '<span style="color:#94a3b8">vs 12M Avg</span><strong style="color:' + deltaColor + ';font-family:\'JetBrains Mono\',monospace">' + deltaSign + d.deltaFromAvg.toFixed(2) + '%</strong>' +
        '</div>' +
        '<div style="margin-top:6px;font-size:10px;color:#64748b">Click point to inspect ' + escapeHtml(d.shortLabel) + ' roster</div>';

      var rawLeft = margin.left + cx + 14;
      if (cx > innerW * 0.62) {
        rawLeft = Math.max(8, margin.left + cx - 228);
      }
      var rawTop = Math.max(8, Math.min(height - 145, margin.top + cyPrim - 36));
      tooltip.style.left = rawLeft + 'px';
      tooltip.style.top = rawTop + 'px';
      tooltip.style.opacity = '1';
    }

    function hideTooltip() {
      hoverLine.style('opacity', 0);
      hoverDotPrimary.style('opacity', 0);
      hoverDotActive.style('opacity', 0);
      tooltip.style.opacity = '0';
    }

    function findNearestPoint(mx) {
      var best = points[0];
      var bestDist = Infinity;
      points.forEach(function (pt) {
        var dist = Math.abs(x(pt.shortLabel) - mx);
        if (dist < bestDist) {
          bestDist = dist;
          best = pt;
        }
      });
      return best;
    }

    g.append('rect')
      .attr('class', 'attr-overlay')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('mousemove touchmove', function (event) {
        var pt = null;
        if (typeof d3Lib.pointer === 'function') {
          var coords = d3Lib.pointer(event, this);
          pt = findNearestPoint(coords[0]);
        }
        if (pt) showTooltipFor(pt);
      })
      .on('mouseleave', hideTooltip)
      .on('click', function (event) {
        if (!onMonthSelect) return;
        var pt = null;
        if (typeof d3Lib.pointer === 'function') {
          var coords = d3Lib.pointer(event, this);
          pt = findNearestPoint(coords[0]);
        }
        if (pt) onMonthSelect(pt);
      });

    nodeGroups
      .on('focus', function (event, d) { showTooltipFor(d); })
      .on('blur', hideTooltip)
      .on('keydown', function (event, d) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (onMonthSelect) onMonthSelect(d);
        }
      })
      .on('click', function (event, d) {
        if (onMonthSelect) onMonthSelect(d);
      });

    return {
      width: width,
      height: height,
      points: points,
      summary: summary
    };
  }

  return {
    parseFlexibleDate: parseFlexibleDate,
    isMarkedLeft: isMarkedLeft,
    build12MonthWindows: build12MonthWindows,
    computeAttritionSeries: computeAttritionSeries,
    renderAttritionD3LineChart: renderAttritionD3LineChart
  };
});
