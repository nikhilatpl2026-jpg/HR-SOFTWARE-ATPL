/* ATPL Attendance & Multi-Machine Auditor V1
   Features:
   Case 1: Multiple machine worker detection & recheck total across all cards
   Case 2: Grand Total match with sum of all worker totals + variance alert
   Case 3: Advance deduction handling across machines for accurate final payout
   Card-wise mistake finder with isolated card views & export
*/
(function(g){
  "use strict";
  if(!g || g.__ATPL_ATTENDANCE_MACHINE_AUDITOR_V1__) return;
  g.__ATPL_ATTENDANCE_MACHINE_AUDITOR_V1__ = "2026.10.27-v1";

  var state = {
    records: [],
    employees: [],
    cards: [],
    activeCard: "ALL",
    filter: "all",
    searchQuery: "",
    sheetGrandTotal: null,
    summary: {
      totalRows: 0,
      totalEmployees: 0,
      multiMachineEmployees: 0,
      totalGross: 0,
      totalAdvance: 0,
      totalFinalPayout: 0,
      sheetGrandTotal: 0,
      grandTotalDiff: 0,
      isGrandTotalMatched: true,
      mistakeCount: 0
    }
  };

  function q(id){ return document.getElementById(id); }
  function esc(v){
    return String(v == null ? "" : v).replace(/[&<>"\x27]/g, function(c){
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "\"" ? "&quot;" : "&#39;";
    });
  }
  function num(v){ var n = parseFloat(String(v == null ? 0 : v).replace(/,/g, "").trim()); return isNaN(n) ? 0 : n; }
  function money(v){
    var n = Number(v);
    if(!isFinite(n)) return "₹0";
    var dec = Math.abs(n - Math.round(n)) > 0.001 ? 2 : 0;
    try {
      return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: 2 });
    } catch(_) {
      return "₹" + n.toFixed(dec);
    }
  }

  var SAMPLE_DATA = [
    { code: "25659", name: "PARESH BARMAN", card: "CARD NO 01", machine: "M-01", days: 12, rate: 600, amount: 7200, advance: 1000, sheetTotal: 6200 },
    { code: "25659", name: "PARESH BARMAN", card: "CARD NO 05", machine: "M-05", days: 14, rate: 600, amount: 8400, advance: 0, sheetTotal: 8400 },
    { code: "26510", name: "MAHESHWAR PRASAD", card: "CARD NO 13", machine: "C-13", days: 26, rate: 580, amount: 15080, advance: 2500, sheetTotal: 12580 },
    { code: "26447", name: "ARCHANA DEBSINGHA", card: "CARD NO 13", machine: "C-13", days: 24, rate: 580, amount: 13920, advance: 1500, sheetTotal: 12420 },
    { code: "26489", name: "ASHIK SHAH", card: "CONSTRUCTION", machine: "CONST-1", days: 25, rate: 800, amount: 20000, advance: 3000, sheetTotal: 17000 },
    { code: "26166", name: "KISHAN SINGH", card: "PAKKI WASHING", machine: "WASH-01", days: 15, rate: 580, amount: 8700, advance: 1000, sheetTotal: 7700 },
    { code: "26166", name: "KISHAN SINGH", card: "KACHI WASHING", machine: "WASH-02", days: 10, rate: 580, amount: 5800, advance: 500, sheetTotal: 5300 },
    { code: "26581", name: "MAGH SINGH", card: "PAKKI WASHING", machine: "WASH-01", days: 20, rate: 580, amount: 11000, advance: 1000, sheetTotal: 10000 },
    { code: "26407", name: "BACHA SAH", card: "KACHI WASHING", machine: "WASH-02", days: 22, rate: 580, amount: 12760, advance: 2000, sheetTotal: 12760 },
    { code: "26147", name: "MANJAY MAHTO", card: "KACHI WASHING", machine: "WASH-02", days: 24, rate: 580, amount: 13920, advance: 0, sheetTotal: 13920 },
    { code: "22269", name: "SAMUNDER", card: "DYING", machine: "DYE-01", days: 18, rate: 750, amount: 13500, advance: 2000, sheetTotal: 11500 },
    { code: "22269", name: "SAMUNDER", card: "BLENDING", machine: "BLEND-01", days: 8, rate: 750, amount: 6000, advance: 0, sheetTotal: 6000 },
    { code: "22239", name: "SOHAN SINGH SISODHIYA", card: "DYING", machine: "DYE-01", days: 26, rate: 750, amount: 19500, advance: 1500, sheetTotal: 18000 },
    { code: "22294", name: "GHANSHYAM RAJBHAR", card: "BLENDING", machine: "BLEND-01", days: 25, rate: 750, amount: 18750, advance: 2500, sheetTotal: 16250 },
    { code: "26363", name: "PRABHA DEVI", card: "SHORTING", machine: "SORT-01", days: 24, rate: 580, amount: 13920, advance: 1200, sheetTotal: 12720 },
    { code: "26647", name: "MUNNA KUMAR", card: "CARD NO 05", machine: "M-05", days: 26, rate: 580, amount: 15080, advance: 2000, sheetTotal: 13080 },
    { code: "26648", name: "REHANUMA", card: "CARD NO 05", machine: "M-05", days: 12, rate: 750, amount: 9000, advance: 0, sheetTotal: 9000 },
    { code: "26648", name: "REHANUMA", card: "CARD NO 13", machine: "C-13", days: 14, rate: 750, amount: 10500, advance: 1500, sheetTotal: 9000 },
    { code: "26649", name: "AVTAR SINGH", card: "OFFICE STAFF", machine: "OFFICE", days: 30, rate: 800, amount: 24000, advance: 0, sheetTotal: 24000 },
    { code: "26650", name: "ABHINEK KUMAR", card: "CARD NO 09", machine: "M-09", days: 25, rate: 580, amount: 14500, advance: 1500, sheetTotal: 13000 },
    { code: "26651", name: "PRADEEP RAJBHAR", card: "CARD NO 05", machine: "M-05", days: 26, rate: 580, amount: 15080, advance: 2000, sheetTotal: 13080 },
    { code: "25699", name: "PAPPU BANO", card: "SHORTING", machine: "SORT-01", days: 22, rate: 580, amount: 12760, advance: 1000, sheetTotal: 11760 },
    { code: "26425", name: "RINA BARMAN", card: "CONDENSER", machine: "COND-01", days: 24, rate: 580, amount: 13920, advance: 1500, sheetTotal: 12420 },
    { code: "26424", name: "BIJOY BARMAN", card: "CONDENSER", machine: "COND-01", days: 26, rate: 750, amount: 19500, advance: 2000, sheetTotal: 17500 }
  ];

  function recalculate(){
    var empMap = {};
    var cardsSet = new Set();
    var mistakeCount = 0;
    var totalGross = 0;
    var totalAdvance = 0;
    var totalFinalPayout = 0;

    state.records.forEach(function(r, idx){
      var code = String(r.code || r.emp_id || "").trim().toUpperCase();
      if(!code) code = "EMP-" + (idx + 1);
      var name = String(r.name || r.emp_name || "Worker " + code).trim().toUpperCase();
      var card = String(r.card || r.dept || r.card_no || "GENERAL").trim().toUpperCase();
      var machine = String(r.machine || r.machine_no || card).trim().toUpperCase();
      var days = num(r.days != null ? r.days : (r.attendance || r.shift || r.qty || 0));
      var rate = num(r.rate != null ? r.rate : 0);
      
      var calcRowAmount = (days > 0 && rate > 0) ? Math.round(days * rate * 100) / 100 : num(r.amount);
      var statedRowAmount = num(r.amount != null ? r.amount : calcRowAmount);
      var advance = num(r.advance != null ? r.advance : (r.adv || r.loan || r.kharcha || 0));
      var statedSheetTotal = num(r.sheetTotal != null ? r.sheetTotal : (r.net || r.payout || (statedRowAmount - advance)));

      cardsSet.add(card);
      var hasRowMathError = Math.abs(calcRowAmount - statedRowAmount) > 1 && days > 0 && rate > 0;

      if(!empMap[code]){
        empMap[code] = {
          code: code,
          name: name,
          entries: [],
          machinesWorked: new Set(),
          cardsWorked: new Set(),
          totalDays: 0,
          totalGrossCalculated: 0,
          totalGrossStated: 0,
          totalAdvance: 0,
          sheetFinalPayoutStated: 0,
          calculatedFinalPayout: 0,
          mistakes: []
        };
      }

      var emp = empMap[code];
      emp.machinesWorked.add(machine);
      emp.cardsWorked.add(card);
      emp.totalDays += days;
      emp.totalGrossCalculated += calcRowAmount;
      emp.totalGrossStated += statedRowAmount;
      emp.totalAdvance += advance;
      emp.sheetFinalPayoutStated += statedSheetTotal;

      var entryObj = {
        rowIdx: idx,
        card: card,
        machine: machine,
        days: days,
        rate: rate,
        calculatedAmount: calcRowAmount,
        statedAmount: statedRowAmount,
        advance: advance,
        statedSheetTotal: statedSheetTotal,
        hasRowMathError: hasRowMathError
      };
      emp.entries.push(entryObj);

      if(hasRowMathError){
        emp.mistakes.push("Row Mistake on " + card + ": Days (" + days + ") × Rate (₹" + rate + ") = ₹" + calcRowAmount + ", but sheet entered ₹" + statedRowAmount);
      }
    });

    var employeesList = Object.keys(empMap).map(function(k){
      var e = empMap[k];
      e.machinesCount = e.machinesWorked.size;
      e.cardsCount = e.cardsWorked.size;
      e.isMultiMachine = e.machinesCount > 1 || e.entries.length > 1;

      // Case 3: Accurate Final Payout calculation
      e.calculatedFinalPayout = Math.round((e.totalGrossCalculated - e.totalAdvance) * 100) / 100;
      
      // Case 1: Individual worker total discrepancy
      var payoutDiff = Math.round((e.calculatedFinalPayout - e.sheetFinalPayoutStated) * 100) / 100;
      e.payoutDiff = payoutDiff;

      if(Math.abs(payoutDiff) > 1){
        if(e.isMultiMachine){
          e.mistakes.push("Case 1 & 3: Multi-Machine Payout Mismatch! Calculated Final Payout is " + money(e.calculatedFinalPayout) + " (Gross " + money(e.totalGrossCalculated) + " - Adv " + money(e.totalAdvance) + "), but sheet shows " + money(e.sheetFinalPayoutStated) + " (Diff: " + (payoutDiff > 0 ? "+" : "") + money(payoutDiff) + ")");
        } else {
          e.mistakes.push("Payout Mismatch! Calculated " + money(e.calculatedFinalPayout) + " vs Sheet " + money(e.sheetFinalPayoutStated) + " (Diff: " + (payoutDiff > 0 ? "+" : "") + money(payoutDiff) + ")");
        }
      }

      if(e.totalAdvance > e.totalGrossCalculated){
        e.mistakes.push("Advance Warning: Advance (" + money(e.totalAdvance) + ") exceeds Gross Earnings (" + money(e.totalGrossCalculated) + ")!");
      }

      if(e.mistakes.length > 0){
        mistakeCount += e.mistakes.length;
      }

      totalGross += e.totalGrossCalculated;
      totalAdvance += e.totalAdvance;
      totalFinalPayout += e.calculatedFinalPayout;

      return e;
    });

    var targetGrandTotal = state.sheetGrandTotal != null ? num(state.sheetGrandTotal) : totalFinalPayout;
    var grandTotalDiff = Math.round((totalFinalPayout - targetGrandTotal) * 100) / 100;
    var isMatched = Math.abs(grandTotalDiff) < 1;

    state.employees = employeesList;
    state.cards = Array.from(cardsSet).sort();
    state.summary = {
      totalRows: state.records.length,
      totalEmployees: employeesList.length,
      multiMachineEmployees: employeesList.filter(function(x){ return x.isMultiMachine; }).length,
      totalGross: totalGross,
      totalAdvance: totalAdvance,
      totalFinalPayout: totalFinalPayout,
      sheetGrandTotal: targetGrandTotal,
      grandTotalDiff: grandTotalDiff,
      isGrandTotalMatched: isMatched,
      mistakeCount: mistakeCount
    };
  }

  function parseExcelText(text){
    if(!text || !text.trim()) return [];
    var lines = text.trim().split(/\r?\n/);
    var rows = lines.map(function(l){ return l.split("\t").map(function(c){ return c.trim(); }); });
    if(!rows.length) return [];

    var headers = rows[0];
    var isHeader = headers.some(function(h){
      return /^(code|emp|name|machine|card|dept|day|days|rate|amount|gross|adv|advance|total|net|payout)/i.test(h);
    });

    var dataRows = isHeader ? rows.slice(1) : rows;
    var colMap = { code: 0, name: 1, card: 2, machine: 3, days: 4, rate: 5, amount: 6, advance: 7, sheetTotal: 8 };

    if(isHeader){
      headers.forEach(function(h, idx){
        var low = h.toLowerCase();
        if(/^(code|emp_id|emp_code|token)/i.test(low)) colMap.code = idx;
        else if(/^(name|worker|emp_name)/i.test(low)) colMap.name = idx;
        else if(/^(card|card_no|cardno|dept|section)/i.test(low)) colMap.card = idx;
        else if(/^(machine|machine_no|m\/c)/i.test(low)) colMap.machine = idx;
        else if(/^(days|day|att|attendance|shift|shifts|hours|qty)/i.test(low)) colMap.days = idx;
        else if(/^(rate|day_rate|unit_rate|wage)/i.test(low)) colMap.rate = idx;
        else if(/^(amount|gross|total_gross|earn|earning)/i.test(low)) colMap.amount = idx;
        else if(/^(adv|advance|loan|deduction|kharcha)/i.test(low)) colMap.advance = idx;
        else if(/^(total|net|net_pay|payout|payable|final)/i.test(low)) colMap.sheetTotal = idx;
      });
    }

    var result = [];
    var potentialGrandTotal = null;

    dataRows.forEach(function(r){
      if(!r.some(Boolean)) return;
      var firstCell = String(r[0] || "").toLowerCase();
      if(/^(grand\s*total|total|g\.?\s*total)/i.test(firstCell) || /grand\s*total/i.test(r.join(" "))){
        var nums = r.map(num).filter(function(n){ return n > 0; });
        if(nums.length > 0) potentialGrandTotal = nums[nums.length - 1];
        return;
      }

      var code = r[colMap.code] || "";
      var name = r[colMap.name] || "";
      var card = r[colMap.card] || "CARD NO 01";
      var machine = r[colMap.machine] || card;
      var days = num(r[colMap.days]);
      var rate = num(r[colMap.rate]);
      var amount = num(r[colMap.amount]);
      var advance = num(r[colMap.advance]);
      var sheetTotal = num(r[colMap.sheetTotal]);

      if(!code && !name && amount === 0 && days === 0) return;

      result.push({
        code: code,
        name: name,
        card: card,
        machine: machine,
        days: days,
        rate: rate,
        amount: amount,
        advance: advance,
        sheetTotal: sheetTotal
      });
    });

    if(potentialGrandTotal != null){
      state.sheetGrandTotal = potentialGrandTotal;
    }
    return result;
  }

  function makePage(){
    var page = q("page-attendanceaudit");
    if(!page){
      var content = document.querySelector(".content") || document.querySelector(".main") || document.body;
      page = document.createElement("div");
      page.className = "page";
      page.id = "page-attendanceaudit";
      page.style.display = "none";
      content.appendChild(page);
    }

    page.innerHTML = [
      "<div class=\"atpl-auditor-wrap\" style=\"padding:18px 22px;max-width:1440px;margin:0 auto;color:#0f172a\">",
        "<!-- Header -->",
        "<div style=\"display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;background:linear-gradient(135deg,#064e3b 0%,#047857 50%,#0f766e 100%);padding:18px 22px;border-radius:14px;color:#fff;box-shadow:0 4px 14px rgba(4,120,87,0.2)\">",
          "<div>",
            "<div style=\"display:flex;align-items:center;gap:10px\">",
              "<span style=\"font-size:26px\">📋</span>",
              "<h2 style=\"margin:0;font-size:20px;font-weight:900;letter-spacing:-0.5px\">Attendance &amp; Multi-Machine Auditor</h2>",
              "<span style=\"background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:1px\">CASE 1 · 2 · 3 RECHECK</span>",
            "</div>",
            "<p style=\"margin:5px 0 0;font-size:11px;color:#a7f3d0;max-width:760px\">",
              "Ek banda multiple machine par kaam kare to automatic cross-recheck, Advance cuts handle karke accurate Final Payout, aur saare bando ke total ko Grand Total se live match karein.",
            "</p>",
          "</div>",
          "<div style=\"display:flex;gap:8px;flex-wrap:wrap\">",
            "<button id=\"amaSampleBtn\" style=\"padding:8px 14px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.35);color:#fff;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px\" title=\"Realistic factory multi-machine attendance data load karein\">🧪 Load Sample Data</button>",
            "<button id=\"amaPasteBtn\" style=\"padding:8px 14px;background:#fff;border:0;color:#065f46;border-radius:8px;font-size:11px;font-weight:850;cursor:pointer;display:inline-flex;align-items:center;gap:6px;box-shadow:0 2px 4px rgba(0,0,0,0.1)\">📋 Paste Excel Sheet</button>",
            "<button id=\"amaUploadBtn\" style=\"padding:8px 14px;background:#10b981;border:0;color:#fff;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:6px\">📂 Upload File (.xlsx/.csv)</button>",
            "<input type=\"file\" id=\"amaFileInput\" accept=\".xlsx,.xls,.csv\" style=\"display:none\">",
            "<button id=\"amaExportBtn\" style=\"padding:8px 14px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);color:#fff;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px\">⬇ Export Audit Report</button>",
          "</div>",
        "</div>",

        "<!-- GRAND TOTAL MATCH BANNER (Case 2 Live Reconciliation) -->",
        "<div id=\"amaGrandTotalBanner\" style=\"margin-top:14px\"></div>",

        "<!-- 4 KPI SUMMARY CARDS -->",
        "<div style=\"display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-top:14px\">",
          "<div style=\"background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.03)\">",
            "<div style=\"font-size:10px;text-transform:uppercase;color:#64748b;font-weight:800\">Total Workers &amp; Rows</div>",
            "<div id=\"amaKpiWorkers\" style=\"font-size:22px;font-weight:900;color:#0f172a;margin-top:3px\">0 Workers</div>",
            "<div id=\"amaKpiMulti\" style=\"font-size:10px;color:#059669;font-weight:700;margin-top:2px\">0 Multi-Machine Workers</div>",
          "</div>",
          "<div style=\"background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.03)\">",
            "<div style=\"font-size:10px;text-transform:uppercase;color:#64748b;font-weight:800\">Gross Earnings (All Machines)</div>",
            "<div id=\"amaKpiGross\" style=\"font-size:22px;font-weight:900;color:#1e3a8a;margin-top:3px\">₹0</div>",
            "<div style=\"font-size:10px;color:#64748b;margin-top:2px\">Across all machine cards</div>",
          "</div>",
          "<div style=\"background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.03)\">",
            "<div style=\"font-size:10px;text-transform:uppercase;color:#64748b;font-weight:800\">Advances Deducted (Case 3)</div>",
            "<div id=\"amaKpiAdvance\" style=\"font-size:22px;font-weight:900;color:#b45309;margin-top:3px\">₹0</div>",
            "<div style=\"font-size:10px;color:#92400e;margin-top:2px\">Pre-cut &amp; Kharcha adjustments</div>",
          "</div>",
          "<div id=\"amaKpiFinalCard\" style=\"background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.03)\">",
            "<div style=\"font-size:10px;text-transform:uppercase;color:#64748b;font-weight:800\">Final Net Payout Calculated</div>",
            "<div id=\"amaKpiFinal\" style=\"font-size:22px;font-weight:900;color:#047857;margin-top:3px\">₹0</div>",
            "<div id=\"amaKpiMistakes\" style=\"font-size:10px;color:#64748b;margin-top:2px\">0 Mistakes detected</div>",
          "</div>",
        "</div>",

        "<!-- Card-wise Navigation Tabs -->",
        "<div id=\"amaCardBar\" style=\"display:flex;align-items:center;gap:6px;overflow-x:auto;padding:10px 4px;margin-top:14px;border-bottom:1px solid #e2e8f0\"></div>",

        "<!-- Filters and Search Bar -->",
        "<div style=\"display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px 16px;margin-top:12px\">",
          "<div style=\"display:flex;align-items:center;gap:8px;flex-wrap:wrap\">",
            "<button class=\"ama-flt-btn active\" data-filter=\"all\" style=\"padding:6px 12px;border:1px solid #cbd5e1;background:#0f172a;color:#fff;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer\">All Workers</button>",
            "<button class=\"ama-flt-btn\" data-filter=\"mistakes\" style=\"padding:6px 12px;border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer\">⚠️ Mistakes Only</button>",
            "<button class=\"ama-flt-btn\" data-filter=\"multi\" style=\"padding:6px 12px;border:1px solid #a7f3d0;background:#ecfdf5;color:#047857;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer\">👥 Multi-Machine Workers</button>",
            "<button class=\"ama-flt-btn\" data-filter=\"advance\" style=\"padding:6px 12px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer\">💰 Advance Deductions</button>",
            "<button class=\"ama-flt-btn\" data-filter=\"ok\" style=\"padding:6px 12px;border:1px solid #e2e8f0;background:#f8fafc;color:#475569;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer\">✅ Reconciled OK</button>",
          "</div>",
          "<div style=\"display:flex;align-items:center;gap:10px\">",
            "<input type=\"text\" id=\"amaSearchInput\" placeholder=\"🔍 Search worker name, code, machine...\" style=\"padding:7px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:11px;min-width:240px\">",
            "<div style=\"display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#475569\">",
              "<span>Sheet Grand Total:</span>",
              "<input type=\"number\" id=\"amaSheetGrandTotalInput\" placeholder=\"₹ Enter sheet total\" style=\"width:130px;padding:6px 8px;border:1px solid #94a3b8;border-radius:7px;font-size:11px;font-weight:800;text-align:right\">",
            "</div>",
          "</div>",
        "</div>",

        "<!-- Results Table & Detail Cards -->",
        "<div id=\"amaResultsContainer\" style=\"margin-top:14px\"></div>",
      "</div>",

      "<!-- MODAL: PASTE EXCEL DATA -->",
      "<div id=\"amaPasteModal\" style=\"display:none;position:fixed;inset:0;background:rgba(15,23,42,0.7);z-index:9999;align-items:center;justify-content:center;padding:16px\">",
        "<div style=\"background:#fff;border-radius:16px;max-width:800px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 25px -5px rgba(0,0,0,0.3);overflow:hidden\">",
          "<div style=\"display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e2e8f0;background:#f8fafc\">",
            "<div style=\"display:flex;align-items:center;gap:10px\">",
              "<span style=\"font-size:20px\">📋</span>",
              "<h3 style=\"margin:0;font-size:15px;font-weight:800;color:#0f172a\">Paste Attendance Sheet from Excel</h3>",
            "</div>",
            "<button id=\"amaPasteCloseBtn\" style=\"border:0;background:none;font-size:20px;cursor:pointer;color:#64748b\">✕</button>",
          "</div>",
          "<div style=\"padding:18px 20px;overflow-y:auto;flex:1\">",
            "<p style=\"margin:0 0 10px;font-size:11px;color:#475569\">",
              "Apni Excel attendance sheet se saari rows copy karein (Ctrl+C) aur neeche box mein paste karein (Ctrl+V). Headers hon ya na hon, columns auto-detect ho jaayenge:",
            "</p>",
            "<div style=\"background:#f1f5f9;padding:8px 12px;border-radius:8px;font-size:10px;color:#334155;margin-bottom:12px;font-family:monospace\">",
              "Expected columns: <b>Code</b> | <b>Name</b> | <b>Card/Machine</b> | <b>Days</b> | <b>Rate</b> | <b>Gross Amount</b> | <b>Advance</b> | <b>Net Payout</b>",
            "</div>",
            "<textarea id=\"amaPasteTextarea\" rows=\"10\" placeholder=\"Excel se copy kiya data yahan paste karein...\" style=\"width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:8px;font-family:monospace;font-size:11px;resize:vertical\"></textarea>",
            "<div id=\"amaPasteParsedPreview\" style=\"margin-top:10px;font-size:11px;color:#059669;font-weight:700\"></div>",
          "</div>",
          "<div style=\"display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid #e2e8f0;background:#f8fafc\">",
            "<button id=\"amaPasteCancelBtn\" style=\"padding:8px 16px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;font-size:11px;font-weight:700;color:#64748b;cursor:pointer\">Cancel</button>",
            "<button id=\"amaPasteSubmitBtn\" style=\"padding:8px 20px;border:0;background:#059669;color:#fff;border-radius:8px;font-size:11px;font-weight:850;cursor:pointer\">✅ Audit Process Karein</button>",
          "</div>",
        "</div>",
      "</div>"
    ].join("");

    wireEvents();
    renderAll();
  }

  function wireEvents(){
    var sampleBtn = q("amaSampleBtn");
    if(sampleBtn){
      sampleBtn.onclick = function(){
        state.records = JSON.parse(JSON.stringify(SAMPLE_DATA));
        state.sheetGrandTotal = 296090;
        recalculate();
        renderAll();
        if(window.showToast) window.showToast("✅ Sample Attendance data loaded with multi-machine & advance audit cases!");
      };
    }

    var pasteBtn = q("amaPasteBtn");
    var modal = q("amaPasteModal");
    var closeBtn = q("amaPasteCloseBtn");
    var cancelBtn = q("amaPasteCancelBtn");
    var submitBtn = q("amaPasteSubmitBtn");
    var textarea = q("amaPasteTextarea");
    var preview = q("amaPasteParsedPreview");

    if(pasteBtn && modal){
      pasteBtn.onclick = function(){
        modal.style.display = "flex";
        if(textarea){
          textarea.value = "";
          textarea.focus();
        }
        if(preview) preview.innerHTML = "";
      };
    }

    function closeModal(){ if(modal) modal.style.display = "none"; }
    if(closeBtn) closeBtn.onclick = closeModal;
    if(cancelBtn) cancelBtn.onclick = closeModal;

    if(textarea && preview){
      textarea.oninput = function(){
        var rows = parseExcelText(textarea.value);
        if(rows.length > 0){
          preview.innerHTML = "✅ " + rows.length + " attendance rows detected ready to audit.";
        } else {
          preview.innerHTML = "";
        }
      };
    }

    if(submitBtn && textarea){
      submitBtn.onclick = function(){
        var rows = parseExcelText(textarea.value);
        if(!rows.length){
          alert("⚠️ Koi valid attendance row nahi mili. Please check copied data.");
          return;
        }
        state.records = rows;
        recalculate();
        closeModal();
        renderAll();
        if(window.showToast) window.showToast("✅ " + rows.length + " attendance rows audited successfully!");
      };
    }

    var uploadBtn = q("amaUploadBtn");
    var fileInput = q("amaFileInput");
    if(uploadBtn && fileInput){
      uploadBtn.onclick = function(){ fileInput.click(); };
      fileInput.onchange = function(e){
        var file = e.target.files && e.target.files[0];
        if(!file) return;
        handleFileUpload(file);
      };
    }

    var exportBtn = q("amaExportBtn");
    if(exportBtn){
      exportBtn.onclick = function(){ exportAuditReport(); };
    }

    var filterBtns = document.querySelectorAll(".ama-flt-btn");
    Array.prototype.forEach.call(filterBtns, function(btn){
      btn.onclick = function(){
        Array.prototype.forEach.call(filterBtns, function(b){
          b.classList.remove("active");
          b.style.background = "#f8fafc";
          b.style.color = "#475569";
          b.style.borderColor = "#e2e8f0";
        });
        btn.classList.add("active");
        btn.style.background = "#0f172a";
        btn.style.color = "#fff";
        btn.style.borderColor = "#cbd5e1";
        state.filter = btn.getAttribute("data-filter") || "all";
        renderResults();
      };
    });

    var searchInput = q("amaSearchInput");
    if(searchInput){
      searchInput.oninput = function(){
        state.searchQuery = this.value.trim().toLowerCase();
        renderResults();
      };
    }

    var sheetInput = q("amaSheetGrandTotalInput");
    if(sheetInput){
      sheetInput.onchange = function(){
        var val = num(this.value);
        if(val > 0){
          state.sheetGrandTotal = val;
        } else {
          state.sheetGrandTotal = null;
        }
        recalculate();
        renderBanner();
        renderKpis();
        renderCardBar();
        renderResults();
      };
    }
  }

  function handleFileUpload(file){
    var reader = new FileReader();
    reader.onload = function(e){
      try {
        var data = new Uint8Array(e.target.result);
        if(typeof XLSX === "undefined"){
          alert("Excel reader loading... please try again in a second.");
          return;
        }
        var workbook = XLSX.read(data, { type: "array" });
        var allRows = [];
        workbook.SheetNames.forEach(function(sheetName){
          var worksheet = workbook.Sheets[sheetName];
          var json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          if(json && json.length > 0){
            var text = json.map(function(r){ return (r || []).join("\t"); }).join("\n");
            var parsed = parseExcelText(text);
            parsed.forEach(function(p){
              if(!p.card || p.card === "GENERAL") p.card = sheetName.toUpperCase();
              allRows.push(p);
            });
          }
        });
        if(allRows.length > 0){
          state.records = allRows;
          recalculate();
          renderAll();
          if(window.showToast) window.showToast("✅ Excel workbook audited (" + allRows.length + " rows)!");
        } else {
          alert("⚠️ File me attendance rows nahi mili.");
        }
      } catch(err){
        console.error(err);
        alert("File read error: " + (err.message || err));
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function renderAll(){
    renderBanner();
    renderKpis();
    renderCardBar();
    renderResults();
  }

  function renderBanner(){
    var banner = q("amaGrandTotalBanner");
    if(!banner) return;

    var s = state.summary;
    if(state.records.length === 0){
      banner.innerHTML = [
        "<div style=\"background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:16px 20px;text-align:center;color:#64748b\">",
          "<div style=\"font-size:24px;margin-bottom:6px\">📋</div>",
          "<b style=\"color:#1e293b;font-size:13px\">Koi Attendance Data Load Nahi Hai</b>",
          "<p style=\"margin:4px 0 0;font-size:11px\">\"Load Sample Data\" click karke live multi-machine recheck dekhein ya apni Excel file / sheet paste karein.</p>",
        "</div>"
      ].join("");
      return;
    }

    if(s.isGrandTotalMatched){
      banner.innerHTML = [
        "<div style=\"background:#ecfdf5;border:2px solid #059669;border-radius:12px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap\">",
          "<div style=\"display:flex;align-items:center;gap:12px\">",
            "<div style=\"width:40px;height:40px;border-radius:50%;background:#059669;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0\">✓</div>",
            "<div>",
              "<div style=\"font-size:14px;font-weight:900;color:#065f46\">CASE 2: GRAND TOTAL 100% RECONCILED &amp; MATCHED!</div>",
              "<div style=\"font-size:11px;color:#047857;margin-top:2px\">",
                "Saare bando ka individual total (<b>" + money(s.totalFinalPayout) + "</b>) == Sheet Grand Total (<b>" + money(s.sheetGrandTotal) + "</b>). Zero variance (Difference: ₹0).",
              "</div>",
            "</div>",
          "</div>",
          "<div style=\"background:#059669;color:#fff;padding:6px 14px;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:0.5px\">",
            "MATCHED ✓",
          "</div>",
        "</div>"
      ].join("");
    } else {
      banner.innerHTML = [
        "<div style=\"background:#fef2f2;border:2px solid #dc2626;border-radius:12px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap\">",
          "<div style=\"display:flex;align-items:center;gap:12px\">",
            "<div style=\"width:40px;height:40px;border-radius:50%;background:#dc2626;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0\">✕</div>",
            "<div>",
              "<div style=\"font-size:14px;font-weight:900;color:#991b1b\">CASE 2: GRAND TOTAL MISMATCH DETECTED! ⚠️</div>",
              "<div style=\"font-size:11px;color:#b91c1c;margin-top:2px\">",
                "Saare bando ke calculated totals ka sum hai <b>" + money(s.totalFinalPayout) + "</b>, par Sheet Grand Total <b>" + money(s.sheetGrandTotal) + "</b> hai. ",
                "Difference: <b style=\"background:#fee2e2;padding:2px 6px;border-radius:4px\">" + (s.grandTotalDiff > 0 ? "+" : "") + money(s.grandTotalDiff) + "</b>. Neeche cards filter karke mistake pinpoint karein.",
              "</div>",
            "</div>",
          "</div>",
          "<div style=\"display:flex;align-items:center;gap:8px\">",
            "<button onclick=\"window.amaFilterMistakesOnly()\" style=\"background:#dc2626;color:#fff;border:0;padding:6px 14px;border-radius:8px;font-size:11px;font-weight:900;cursor:pointer\">Mistakes Dekhein (⚠️ " + s.mistakeCount + ")</button>",
          "</div>",
        "</div>"
      ].join("");
    }
  }

  window.amaFilterMistakesOnly = function(){
    var btn = document.querySelector('.ama-flt-btn[data-filter="mistakes"]');
    if(btn) btn.click();
  };

  function renderKpis(){
    var s = state.summary;
    var kw = q("amaKpiWorkers");
    var km = q("amaKpiMulti");
    var kg = q("amaKpiGross");
    var ka = q("amaKpiAdvance");
    var kf = q("amaKpiFinal");
    var kmi = q("amaKpiMistakes");
    var kfc = q("amaKpiFinalCard");
    var sheetInput = q("amaSheetGrandTotalInput");

    if(kw) kw.textContent = s.totalEmployees + " Workers";
    if(km) km.textContent = s.multiMachineEmployees + " Multi-Machine Workers";
    if(kg) kg.textContent = money(s.totalGross);
    if(ka) ka.textContent = money(s.totalAdvance);
    if(kf) kf.textContent = money(s.totalFinalPayout);
    if(kmi){
      if(s.mistakeCount > 0){
        kmi.innerHTML = "<span style=\"color:#dc2626;font-weight:800\">⚠️ " + s.mistakeCount + " Calculation / Payout Mistakes</span>";
      } else {
        kmi.innerHTML = "<span style=\"color:#059669;font-weight:700\">✅ All Worker Totals Match</span>";
      }
    }
    if(kfc){
      kfc.style.borderColor = s.mistakeCount > 0 ? "#fecaca" : "#e2e8f0";
      kfc.style.background = s.mistakeCount > 0 ? "#fffafa" : "#fff";
    }
    if(sheetInput && s.sheetGrandTotal){
      sheetInput.value = s.sheetGrandTotal;
    }
  }

  function renderCardBar(){
    var bar = q("amaCardBar");
    if(!bar) return;

    if(!state.cards.length){
      bar.style.display = "none";
      bar.innerHTML = "";
      return;
    }

    bar.style.display = "flex";
    var allCount = state.employees.length;
    var html = "<button class=\"ama-card-tab " + (state.activeCard === "ALL" ? "active" : "") + "\" data-card=\"ALL\" style=\"padding:6px 14px;border-radius:8px;font-size:11px;font-weight:800;border:1px solid " + (state.activeCard === "ALL" ? "#047857" : "#cbd5e1") + ";background:" + (state.activeCard === "ALL" ? "#047857" : "#fff") + ";color:" + (state.activeCard === "ALL" ? "#fff" : "#334155") + ";cursor:pointer;white-space:nowrap\">ALL CARDS (" + allCount + ")</button>";

    state.cards.forEach(function(cardName){
      var cardWorkers = state.employees.filter(function(e){ return e.cardsWorked.has(cardName); });
      var cardMistakes = cardWorkers.filter(function(e){ return e.mistakes.length > 0; }).length;
      var isActive = state.activeCard === cardName;
      var hasErrors = cardMistakes > 0;

      html += "<button class=\"ama-card-tab " + (isActive ? "active" : "") + "\" data-card=\"" + esc(cardName) + "\" style=\"padding:6px 14px;border-radius:8px;font-size:11px;font-weight:800;border:1px solid " + (isActive ? (hasErrors ? "#dc2626" : "#047857") : (hasErrors ? "#fecaca" : "#cbd5e1")) + ";background:" + (isActive ? (hasErrors ? "#dc2626" : "#047857") : (hasErrors ? "#fef2f2" : "#fff")) + ";color:" + (isActive ? "#fff" : (hasErrors ? "#b91c1c" : "#334155")) + ";cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px\">" + esc(cardName) + " (" + cardWorkers.length + ")" + (hasErrors ? " <span style=\"background:#fee2e2;color:#991b1b;padding:1px 5px;border-radius:999px;font-size:9px\">⚠️ " + cardMistakes + "</span>" : "") + "</button>";
    });

    bar.innerHTML = html;

    var tabs = bar.querySelectorAll(".ama-card-tab");
    Array.prototype.forEach.call(tabs, function(t){
      t.onclick = function(){
        state.activeCard = this.getAttribute("data-card") || "ALL";
        renderCardBar();
        renderResults();
      };
    });
  }

  function renderResults(){
    var container = q("amaResultsContainer");
    if(!container) return;

    if(!state.employees.length){
      container.innerHTML = [
        "<div style=\"background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:40px 20px;text-align:center;color:#64748b\">",
          "<div style=\"font-size:36px;margin-bottom:10px;opacity:0.4\">📑</div>",
          "<b style=\"font-size:14px;color:#1e293b\">Auditor Ready</b>",
          "<p style=\"margin:6px 0 0;font-size:11px\">Upar se \"Load Sample Data\" ya Excel File/Paste karke multi-machine worker check shuru karein.</p>",
        "</div>"
      ].join("");
      return;
    }

    var list = state.employees.filter(function(e){
      if(state.activeCard !== "ALL" && !e.cardsWorked.has(state.activeCard)) return false;

      if(state.filter === "mistakes" && e.mistakes.length === 0) return false;
      if(state.filter === "multi" && !e.isMultiMachine) return false;
      if(state.filter === "advance" && e.totalAdvance === 0) return false;
      if(state.filter === "ok" && e.mistakes.length > 0) return false;

      if(state.searchQuery){
        var haystack = [e.code, e.name, Array.from(e.cardsWorked).join(" "), Array.from(e.machinesWorked).join(" ")].join(" ").toLowerCase();
        if(haystack.indexOf(state.searchQuery) === -1) return false;
      }

      return true;
    });

    if(!list.length){
      container.innerHTML = [
        "<div style=\"background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:30px 20px;text-align:center;color:#64748b\">",
          "<b style=\"font-size:13px;color:#1e293b\">Is filter me koi worker nahi mila</b>",
          "<p style=\"margin:4px 0 0;font-size:11px\">Filter reset karke \"All Workers\" select karein.</p>",
        "</div>"
      ].join("");
      return;
    }

    var html = "<div style=\"display:flex;flex-direction:column;gap:12px\">";

    list.forEach(function(emp){
      var isMistake = emp.mistakes.length > 0;
      var isMulti = emp.isMultiMachine;

      html += "<div style=\"background:#fff;border:1px solid " + (isMistake ? "#fca5a5" : "#e2e8f0") + ";border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.03)\">";

      html += "<div style=\"display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:" + (isMistake ? "#fef2f2" : (isMulti ? "#f0fdf4" : "#f8fafc")) + ";border-bottom:1px solid " + (isMistake ? "#fecaca" : "#e2e8f0") + ";flex-wrap:wrap;gap:10px\">";
        html += "<div style=\"display:flex;align-items:center;gap:12px;flex-wrap:wrap\">";
          html += "<span style=\"background:#1e293b;color:#fff;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:900;letter-spacing:0.5px\">" + esc(emp.code) + "</span>";
          html += "<span style=\"font-size:13px;font-weight:800;color:#0f172a\">" + esc(emp.name) + "</span>";
          if(isMulti){
            html += "<span style=\"background:#059669;color:#fff;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:850\">👥 " + emp.machinesCount + " MACHINES (" + Array.from(emp.cardsWorked).join(" + ") + ")</span>";
          } else {
            html += "<span style=\"background:#e2e8f0;color:#475569;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700\">" + esc(Array.from(emp.cardsWorked)[0] || "CARD") + "</span>";
          }
        html += "</div>";

        html += "<div style=\"display:flex;align-items:center;gap:16px;font-size:11px\">";
          html += "<div>Gross: <b style=\"color:#1e3a8a\">" + money(emp.totalGrossCalculated) + "</b></div>";
          html += "<div>Adv: <b style=\"color:#b45309\">" + money(emp.totalAdvance) + "</b></div>";
          html += "<div>Final Payout: <b style=\"color:#047857;font-size:13px\">" + money(emp.calculatedFinalPayout) + "</b></div>";
          if(isMistake){
            html += "<span style=\"background:#dc2626;color:#fff;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:900\">⚠️ MISTAKE</span>";
          } else {
            html += "<span style=\"background:#059669;color:#fff;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:850\">✅ MATCHED</span>";
          }
        html += "</div>";
      html += "</div>";

      if(isMistake){
        html += "<div style=\"padding:10px 16px;background:#fff5f5;border-bottom:1px solid #fed7d7;color:#991b1b;font-size:11px;font-weight:700\">";
          emp.mistakes.forEach(function(m){
            html += "<div style=\"display:flex;align-items:center;gap:6px;margin:2px 0\"><span>⚠️</span><span>" + esc(m) + "</span></div>";
          });
        html += "</div>";
      }

      html += "<div style=\"overflow-x:auto\">";
        html += "<table style=\"width:100%;border-collapse:collapse;font-size:11px;text-align:left\">";
          html += "<thead><tr style=\"background:#f8fafc;color:#64748b;border-bottom:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:0.5px\">";
            html += "<th style=\"padding:8px 14px\">Card / Section</th>";
            html += "<th style=\"padding:8px 14px\">Machine</th>";
            html += "<th style=\"padding:8px 14px;text-align:right\">Days / Qty</th>";
            html += "<th style=\"padding:8px 14px;text-align:right\">Rate</th>";
            html += "<th style=\"padding:8px 14px;text-align:right\">Gross Calculated</th>";
            html += "<th style=\"padding:8px 14px;text-align:right\">Sheet Gross</th>";
            html += "<th style=\"padding:8px 14px;text-align:right\">Advance Cut</th>";
            html += "<th style=\"padding:8px 14px;text-align:right\">Sheet Stated Net</th>";
          html += "</tr></thead>";
          html += "<tbody>";
          emp.entries.forEach(function(ent){
            html += "<tr style=\"border-bottom:1px solid #f1f5f9;" + (ent.hasRowMathError ? "background:#fff7f7" : "") + "\">";
              html += "<td style=\"padding:8px 14px;font-weight:700;color:#0f172a\">" + esc(ent.card) + "</td>";
              html += "<td style=\"padding:8px 14px;color:#475569\">" + esc(ent.machine) + "</td>";
              html += "<td style=\"padding:8px 14px;text-align:right;font-weight:800\">" + ent.days + "</td>";
              html += "<td style=\"padding:8px 14px;text-align:right\">" + money(ent.rate) + "</td>";
              html += "<td style=\"padding:8px 14px;text-align:right;font-weight:850;color:#1e3a8a\">" + money(ent.calculatedAmount) + "</td>";
              html += "<td style=\"padding:8px 14px;text-align:right;" + (ent.hasRowMathError ? "color:#dc2626;font-weight:900" : "color:#64748b") + "\">" + money(ent.statedAmount) + "</td>";
              html += "<td style=\"padding:8px 14px;text-align:right;color:#b45309;font-weight:700\">" + (ent.advance > 0 ? money(ent.advance) : "—") + "</td>";
              html += "<td style=\"padding:8px 14px;text-align:right;font-weight:700;color:#334155\">" + money(ent.statedSheetTotal) + "</td>";
            html += "</tr>";
          });
          html += "</tbody>";
        html += "</table>";
      html += "</div>";

      html += "</div>";
    });

    html += "</div>";
    container.innerHTML = html;
  }

  function exportAuditReport(){
    if(typeof XLSX === "undefined"){
      alert("Excel export component loading... please try again.");
      return;
    }
    var data = [];
    data.push([
      "Employee Code",
      "Employee Name",
      "Total Machines Worked",
      "Cards / Machines",
      "Total Days",
      "Gross Calculated",
      "Advance Deducted",
      "Calculated Final Payout",
      "Sheet Stated Payout",
      "Discrepancy (Diff)",
      "Audit Status",
      "Mistake Details"
    ]);

    state.employees.forEach(function(e){
      data.push([
        e.code,
        e.name,
        e.machinesCount,
        Array.from(e.cardsWorked).join(", "),
        e.totalDays,
        e.totalGrossCalculated,
        e.totalAdvance,
        e.calculatedFinalPayout,
        e.sheetFinalPayoutStated,
        e.payoutDiff,
        e.mistakes.length ? "MISMATCH / ERROR" : "VERIFIED OK",
        e.mistakes.join(" | ")
      ]);
    });

    data.push([]);
    data.push([
      "GRAND TOTAL",
      "All " + state.summary.totalEmployees + " Workers",
      "",
      "",
      "",
      state.summary.totalGross,
      state.summary.totalAdvance,
      state.summary.totalFinalPayout,
      state.summary.sheetGrandTotal,
      state.summary.grandTotalDiff,
      state.summary.isGrandTotalMatched ? "100% MATCHED" : "MISMATCH",
      state.summary.mistakeCount + " total mistakes"
    ]);

    var ws = XLSX.utils.aoa_to_sheet(data);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance Audit");
    XLSX.writeFile(wb, "ATPL_Attendance_MultiMachine_Audit.xlsx");
  }

  function ensureNav(){
    var sub = q("cat-sal");
    if(!sub) return;
    var item = q("vn-attendanceaudit");
    if(!item){
      item = document.createElement("div");
      item.className = "vitem";
      item.id = "vn-attendanceaudit";
      item.setAttribute("onclick", "goPage(\"attendanceaudit\")");
      item.innerHTML = "<span class=\"vi\">📋</span>Attendance &amp; Multi-Machine Audit <span class=\"vbadge\" style=\"background:#10b981\">NEW</span>";

      var mach = q("vn-machineaudit");
      if(mach && mach.parentNode === sub){
        sub.insertBefore(item, mach.nextSibling);
      } else {
        sub.appendChild(item);
      }
    }
  }

  function patchGoPage(){
    if(typeof g.goPage !== "function" || g.goPage.__amaWrapped) return;
    var orig = g.goPage;
    function wrapped(name){
      var res = orig.apply(this, arguments);
      if(name === "attendanceaudit"){
        var sub = q("cat-sal");
        if(sub) sub.classList.remove("collapsed");
        var arr = q("arr-sal");
        if(arr) arr.style.transform = "rotate(0deg)";
        makePage();
        var page = q("page-attendanceaudit");
        if(page) page.style.display = "block";
      }
      return res;
    }
    wrapped.__amaWrapped = true;
    wrapped.__original = orig;
    g.goPage = wrapped;
  }

  function boot(){
    ensureNav();
    patchGoPage();
    makePage();
  }

  g.ATPLAttendanceAuditor = {
    state: state,
    recalculate: recalculate,
    parseExcelText: parseExcelText,
    renderAll: renderAll
  };

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
  setTimeout(boot, 600);
})(window);
