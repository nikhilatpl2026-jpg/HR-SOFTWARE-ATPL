const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const modSrc = fs.readFileSync(path.join(ROOT, 'atpl-card-attendance-v1.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const srvSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const guardSrc = fs.readFileSync(path.join(ROOT, 'erp-permission-guard-v1.js'), 'utf8');

function createStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(String(k), String(v)),
    removeItem: (k) => m.delete(k)
  };
}

function createEnv(driveStore) {
  const container = { innerHTML: '' };
  const badge = { textContent: '0', style: {} };
  const mockDoc = {
    readyState: 'complete',
    head: { appendChild: () => {} },
    body: { appendChild: () => {} },
    documentElement: { appendChild: () => {} },
    createElement: (tag) => ({ tagName: tag, style: {}, classList: { add() {}, remove() {} } }),
    getElementById: (id) => (id === 'cardAttendanceContainer' ? container : id === 'cardAttBadge' ? badge : null),
    addEventListener: () => {}
  };
  const win = {
    location: { hostname: 'nikhilatpl2026-jpg.github.io', protocol: 'https:' },
    localStorage: createStorage(),
    document: mockDoc,
    Buffer,
    Blob: class FakeBlob { constructor(p) { this.p = p; } },
    EMP_MASTER_DATA: [
      { emp_id: '25492', name: 'GULAB CHAND', cat1: 'CARD NO 01', cat2: 'CARD NO. 1' },
      { emp_id: '26453', name: 'RAMBABU', cat1: 'CARD NO 01', cat2: 'CARD NO. 1' },
      { emp_id: '26647', name: 'MUNNA KUMAR', cat1: 'CARD NO 05', cat2: 'CARD NO 5' },
      { emp_id: '26166', name: 'KISHAN SINGH', cat1: 'PAKKI WASHING', cat2: 'WASHING' }
    ],
    FILES: [
      { name: 'Nov_Salary.xlsx' },
      { name: 'ATPL_CARD_ATTENDANCE_SYNC_V1.json' }
    ],
    fetch: async (url, opts) => {
      if (String(url).includes('script.google.com')) {
        const body = JSON.parse(opts.body);
        if (body.action === 'uploadFile') {
          driveStore.set(body.fileName, Buffer.from(body.fileBase64, 'base64').toString('utf8'));
          return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
        }
        if (body.action === 'downloadFile') {
          if (!driveStore.has(body.fileName)) return { ok: true, status: 200, text: async () => JSON.stringify({ ok: false, error: 'Not found' }) };
          const b64 = Buffer.from(driveStore.get(body.fileName), 'utf8').toString('base64');
          return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, fileBase64: b64 }) };
        }
      }
      return { ok: false, status: 404, text: async () => '{}' };
    },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, addEventListener: () => {}
  };
  win.window = win;
  win.globalThis = win;
  vm.createContext(win);
  vm.runInContext(modSrc, win);
  return { win, container, badge };
}

test('Card Manpower HTML, permission guard, and server routes are wired', () => {
  assert.ok(htmlSrc.includes('id="vn-cardattendance"'));
  assert.ok(htmlSrc.includes('id="page-cardattendance"'));
  assert.ok(htmlSrc.includes("'cardattendance':'cat-sal'"));
  assert.ok(htmlSrc.includes('atpl-card-attendance-v1.js'));
  assert.ok(guardSrc.includes('cardattendance:1'));
  assert.ok(srvSrc.includes("'/api/sync/card-attendance'"));
  assert.ok(srvSrc.includes("'/api/external-erp/attendance-sync'"));
});

test('Parses MonthlyAttendance Export HTML table and computes exact Card-wise Unique Admi & Duty sums', () => {
  const drive = new Map();
  const { win } = createEnv(drive);
  const daysHeader = Array.from({ length: 30 }, (_, i) => `<th>${i + 1}</th>`).join('');
  const empty28 = Array.from({ length: 28 }, () => '<td>-</td>').join('');
  // Day 1: Gulab Chand works D (1.5) & N (1) on C1C -> 1 unique admi, 2.5 duty; Rambabu works N (1) on C1O -> Card-1 total = 2 unique admi, 3.5 duty!
  // Munna Kumar works D (1) on M05 (resolved via Employee Master CARD NO 05 -> Card-5) -> 1 unique admi, 1 duty!
  const htmlExport = `
    <table>
      <tr><th>#</th><th>Employee Code</th><th>Employee</th><th>Machine Code</th><th>Machine Name</th><th>Shift</th>${daysHeader}</tr>
      <tr><td>1</td><td>25492</td><td>GULAB CHAND</td><td>C1C</td><td>Carding 1</td><td>D</td><td>1.5</td><td>1</td>${empty28}</tr>
      <tr><td>2</td><td>25492</td><td>GULAB CHAND</td><td>C1C</td><td>Carding 1</td><td>N</td><td>1</td><td>-</td>${empty28}</tr>
      <tr><td>3</td><td>26453</td><td>RAMBABU</td><td>C1O</td><td>Opener 1</td><td>N</td><td>1</td><td>1</td>${empty28}</tr>
      <tr><td>4</td><td>26647</td><td>MUNNA KUMAR</td><td>M05</td><td>Machine 5</td><td>D</td><td>1</td><td>-</td>${empty28}</tr>
    </table>`;

  const snap = win.ATPLCardAttendance.parseHtmlTableExport(htmlExport, 'Monthly_Attendance_November_2026.xls', 11, 2026);
  assert.ok(snap);
  assert.equal(snap.monthKey, '2026-11');
  assert.equal(snap.rows.length, 4);

  const metricsDay1 = win.ATPLCardAttendance.computeCardMetrics(snap, 1, 'ALL');
  assert.equal(metricsDay1.totalUniqueAdmi, 3);
  assert.equal(metricsDay1.totalDuty, 4.5);

  const card1 = metricsDay1.cards.find(c => c.name === 'Card-1');
  assert.ok(card1);
  assert.equal(card1.uniqueAdmi, 2, 'Card-1 has 2 unique workers even though Gulab Chand has 2 shifts');
  assert.equal(card1.totalDuty, 3.5, 'Card-1 duty sum is 1.5 + 1 + 1 = 3.5');
  assert.equal(card1.dayAdmi, 1);
  assert.equal(card1.nightAdmi, 2);

  const card5 = metricsDay1.cards.find(c => c.name === 'Card-5');
  assert.ok(card5);
  assert.equal(card5.uniqueAdmi, 1);
  assert.equal(card5.totalDuty, 1);
});

test('Syncs live API records to Google Drive and restores Card counts on another browser', async () => {
  const drive = new Map();
  const envA = createEnv(drive);
  const envB = createEnv(drive);

  assert.deepEqual(envA.win.FILES.map(f => f.name), ['Nov_Salary.xlsx']);

  const snap = envA.win.ATPLCardAttendance.normalizeExternalApiRecords(
    [
      { employee_code: '25492', employee: { first_name: 'GULAB', last_name: 'CHAND' }, machine_code: 'C1C', shift_name: 'D', d24: 1 },
      { employee_code: '26166', employee: { first_name: 'KISHAN', last_name: 'SINGH' }, machine_code: 'W01', shift_name: 'D', d24: 1 }
    ],
    [],
    [],
    11,
    2026
  );

  await envA.win.ATPLCardAttendance.saveMonthSnapshot(snap);
  assert.ok(drive.has('ATPL_CARD_ATTENDANCE_SYNC_V1.json'));

  const syncB = await envB.win.ATPLCardAttendance.syncNow(false);
  assert.equal(syncB.ok, true);
  assert.ok(envB.container.innerHTML.includes('Card-1'));
  assert.ok(envB.container.innerHTML.includes('Washing'));
  assert.equal(envB.badge.textContent, '2');
});
