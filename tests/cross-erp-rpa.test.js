const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

test("Cross-ERP Autonomous RPA Bot & Arora Cloud Run Connector verification", (t) => {
  const rpaPath = path.join(__dirname, "../atpl-cross-erp-rpa-v1.js");
  assert.ok(fs.existsSync(rpaPath), "atpl-cross-erp-rpa-v1.js must exist");

  const code = fs.readFileSync(rpaPath, "utf8");
  assert.match(code, /erp-system-ui-515975426507\.asia-south1\.run\.app/, "Must contain user's Arora Cloud ERP endpoint");
  assert.match(code, /erp-arora-cloud/, "Must have erp-arora-cloud profile");
  assert.match(code, /addNewProfileModal/, "Must implement addNewProfileModal");
  assert.match(code, /editProfile/, "Must implement editProfile");
  assert.match(code, /saveProfileModal/, "Must implement saveProfileModal");
  assert.match(code, /General Process Entry/, "Must support General Process Entry");
  assert.match(code, /Purchase Bill/, "Must support Purchase Bill");
  assert.match(code, /Production Weight Entry/, "Must support Production Weight Entry");
  assert.match(code, /Salary Journal/, "Must support Salary Journal");
  assert.match(code, /openTargetErp/, "Must support 1-click launch of target ERP");
  assert.match(code, /simulateRoboticExecution/, "Must have robotic runner");
});

test("AI Commander v10 matches Arora Cloud ERP queries and auto-entry requests", (t) => {
  const cmdPath = path.join(__dirname, "../arora-ai-commander-v10.js");
  assert.ok(fs.existsSync(cmdPath), "arora-ai-commander-v10.js must exist");

  const code = fs.readFileSync(cmdPath, "utf8");
  assert.match(code, /515975426507/, "AI Commander must recognize Cloud Run ID");
  assert.match(code, /erp-system-ui/, "AI Commander must recognize erp-system-ui domain");
  assert.match(code, /general.*?process/i, "AI Commander must recognize general process entries");
});

test("index.html integration: header button, vnav items, and root-level modal", (t) => {
  const htmlPath = path.join(__dirname, "../index.html");
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.match(html, /id="crossErpBtn"/, "Header must include quick Cross-ERP button");
  assert.match(html, /id="vn-cross-erp"/, "Sidebar vnav must include Cross-ERP item");
  assert.match(html, /id="emColModal"/, "emColModal must be present");
  assert.match(html, /atpl-cross-erp-rpa-v1\.js/, "Script must be linked in HTML");
});
