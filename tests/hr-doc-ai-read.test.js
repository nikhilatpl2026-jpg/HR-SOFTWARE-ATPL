const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('HR Documents AI Auto-Read and User Confirmation Verification', () => {
  // 1. Server has GoogleGenAI import and gemini-3.8-flash endpoint
  assert.ok(serverCode.includes("const { GoogleGenAI } = require('@google/genai');"), 'server.js must require GoogleGenAI');
  assert.ok(serverCode.includes("app.post('/api/hr-docs/analyze'"), 'server.js must expose /api/hr-docs/analyze');
  assert.ok(serverCode.includes("model: 'gemini-3.8-flash'"), 'server.js must use gemini-3.8-flash model');

  // 2. Index HTML has the AI verification card and buttons
  assert.ok(indexHtml.includes('id="hrDocAiVerifyBox"'), 'index.html must include hrDocAiVerifyBox');
  assert.ok(indexHtml.includes('id="hrDocAiVerifySummary"'), 'index.html must include hrDocAiVerifySummary');
  assert.ok(indexHtml.includes('hrDocConfirmAndSave()'), 'index.html must provide hrDocConfirmAndSave handler');
  assert.ok(indexHtml.includes('hrDocEditInForm()'), 'index.html must provide hrDocEditInForm handler');

  // 3. Client calls /api/hr-docs/analyze
  assert.ok(indexHtml.includes("fetch('/api/hr-docs/analyze'"), 'client auto read must invoke /api/hr-docs/analyze');

  // 4. Last renewal date field and schema
  assert.ok(serverCode.includes("last_renewal_date: { type: 'STRING' }"), 'server must support last_renewal_date in schema');
  assert.ok(indexHtml.includes('id="hrDocLastRenewalDate"'), 'index.html must have hrDocLastRenewalDate field');
  assert.ok(indexHtml.includes('last_renewal_date:'), 'index.html must save and display last_renewal_date');
});
