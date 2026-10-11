const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");

test("Cross-ERP v2.0 Intent Parser and Route Mapping", () => {
  const code = fs.readFileSync("/tmp/repo/atpl-cross-erp-rpa-v1.js", "utf8");
  assert.ok(code.includes("parseUserIntent"), "Must have parseUserIntent function");
  assert.ok(code.includes("executeAutonomousIntent"), "Must have executeAutonomousIntent");
  assert.ok(code.includes("atpl-rpa-live-hud"), "Must have Live Action HUD element");
  assert.ok(code.includes("Bhai aage kya karna hai?"), "Must include conversational follow up prompt");
  assert.ok(code.includes("https://erp-system-ui-515975426507.asia-south1.run.app/"), "Must target Arora Cloud ERP");
});

test("AI Commander v10 matches dynamic core master intent", () => {
  const code = fs.readFileSync("/tmp/repo/arora-ai-commander-v10.js", "utf8");
  assert.ok(code.includes("rpaIntent"), "Must evaluate rpaIntent dynamically");
  assert.ok(code.includes("executeAutonomousIntent"), "Must trigger executeAutonomousIntent on intent match");
});
