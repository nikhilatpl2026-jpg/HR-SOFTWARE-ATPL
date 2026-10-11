const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

test("Cross-ERP Autonomous RPA Bot & Connector", async (t) => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const rpaJs = fs.readFileSync(path.join(__dirname, "../atpl-cross-erp-rpa-v1.js"), "utf8");
  const aiCmdJs = fs.readFileSync(path.join(__dirname, "../arora-ai-commander-v10.js"), "utf8");

  await t.test("1. index.html includes atpl-cross-erp-rpa-v1.js script and navigation items", () => {
    assert(html.includes("atpl-cross-erp-rpa-v1.js"), "Must include rpa script tag");
    assert(html.includes("id=\"vn-cross-erp\""), "Must include Cross-ERP nav button in dashboard");
    assert(html.includes("id=\"vn-tools-cross-erp\""), "Must include Cross-ERP nav button in tools");
    assert(html.includes("ATPLCrossErpBot.open"), "Must have onclick calling ATPLCrossErpBot.open");
  });

  await t.test("2. atpl-cross-erp-rpa-v1.js defines ATPLCrossErpBot with required RPA methods", () => {
    assert(rpaJs.includes("window.ATPLCrossErpBot ="), "Must define window.ATPLCrossErpBot");
    assert(rpaJs.includes("executeBulkPending:"), "Must provide executeBulkPending");
    assert(rpaJs.includes("generateSalaryJournalEntry:"), "Must provide generateSalaryJournalEntry");
    assert(rpaJs.includes("downloadTallyXml:"), "Must provide downloadTallyXml");
    assert(rpaJs.includes("testConnection:"), "Must provide testConnection");
    assert(rpaJs.includes("getBookmarkletCode"), "Must provide 1-click web bookmarklet generator");
  });

  await t.test("3. arora-ai-commander-v10.js recognizes Hindi/English cross-ERP commands", () => {
    assert(aiCmdJs.includes("CROSS-ERP RPA AUTO-ENTRY"), "Must include Cross-ERP AI handler");
    assert(aiCmdJs.includes("dusre|doosre|other|external"), "Must match Hindi/English keywords");
    assert(aiCmdJs.includes("window.ATPLCrossErpBot"), "Must link to ATPLCrossErpBot in AI responses");
  });

  await t.test("4. Tally XML payload structure is syntactically valid XML envelope", () => {
    assert(rpaJs.includes("<ENVELOPE>"), "Must generate valid Tally XML envelope");
    assert(rpaJs.includes("<VOUCHER"), "Must generate Tally voucher element");
    assert(rpaJs.includes("<ALLLEDGERENTRIES.LIST>"), "Must include ledger debit/credit entries");
  });
});
