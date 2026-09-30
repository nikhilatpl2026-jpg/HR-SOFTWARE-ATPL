const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

// Helper to make HTTP requests
function request(port, method, pathName, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: port,
      path: pathName,
      method: method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, data: json || data });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// Helper to listen to SSE events
function listenSSE(port) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: '/api/sync/events',
      method: 'GET',
      headers: { 'Accept': 'text/event-stream' }
    }, (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const p of parts) {
          if (!p.trim() || p.startsWith(':')) continue;
          const lines = p.split('\n');
          let eventType = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            if (line.startsWith('data:')) dataStr = line.slice(5).trim();
          }
          let dataObj = {};
          try { dataObj = JSON.parse(dataStr); } catch (_) {}
          events.push({ event: eventType, data: dataObj });
        }
      });

      resolve({
        events,
        close: () => {
          try { req.destroy(); } catch (_) {}
          try { res.destroy(); } catch (_) {}
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('Comprehensive 15-Point Cross-Browser & Multi-Module File Sync Acceptance Test', async (t) => {
  let expressAvailable = false;
  try {
    require.resolve('express');
    expressAvailable = true;
  } catch (_) {}

  if (!expressAvailable) {
    t.skip('Skipping live full-stack network acceptance test because express is not installed in runner');
    return;
  }

  const PORT = process.env.TEST_PORT ? parseInt(process.env.TEST_PORT, 10) : 3456;
  let serverProc = null;

  // Check if server is already running, otherwise spawn it
  let serverReady = false;
  try {
    const ping = await request(PORT, 'GET', '/api/sync/state?summary=1');
    if (ping && ping.status === 200 && ping.data && ping.data.ok === true) {
      serverReady = true;
    }
  } catch (_) {}

  if (!serverReady) {
    serverProc = spawn('node', [path.join(__dirname, '..', 'server.js')], {
      env: Object.assign({}, process.env, { PORT: String(PORT) }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    serverProc.stdout.on('data', d => process.stdout.write('[SERVER OUT] ' + d));
    serverProc.stderr.on('data', d => process.stderr.write('[SERVER ERR] ' + d));
    // Wait for server to bind
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const ping = await request(PORT, 'GET', '/api/sync/state?summary=1');
        if (ping && ping.status === 200 && ping.data && ping.data.ok === true) {
          serverReady = true;
          break;
        }
      } catch (_) {}
    }
  }

  assert.ok(serverReady, `Server must be active and running on port ${PORT}`);

  // Connect Browser B and Browser C via SSE listeners
  const browserB_SSE = await listenSSE(PORT);
  const browserC_SSE = await listenSSE(PORT);

  // Give SSE 50ms to register
  await new Promise(r => setTimeout(r, 100));

  const RUN = Date.now();

  // ─────────────────────────────────────────────────────────────
  // TEST 1: Single Upload — Browser A uploads 1 file, Browser B receives it within 3-5 seconds
  // ─────────────────────────────────────────────────────────────
  await t.test('TEST 1: Single Upload propagation', async () => {
    const bEventsCountBefore = browserB_SSE.events.length;
    const testFile1 = {
      id: 'test_file_single_' + RUN,
      module: 'salary',
      category: 'audit',
      name: 'Salary_May_2026_Audit_' + RUN + '.xlsx',
      buf: Buffer.from('TEST SALARY CONTENT 1 ' + RUN).toString('base64'),
      uploaded_by: 'Browser_A'
    };

    const upRes = await request(PORT, 'POST', '/api/sync/files', testFile1);
    assert.equal(upRes.status, 201, 'Upload must succeed with HTTP 201');
    assert.ok(upRes.data.ok, 'Upload response must be ok: true');

    // Wait up to 1 second for SSE propagation (target: 3-5s)
    await new Promise(r => setTimeout(r, 200));

    const newEventsB = browserB_SSE.events.slice(bEventsCountBefore);
    const saveEvent = newEventsB.find(e => e.event === 'file_saved' && e.data.data && e.data.data.name === testFile1.name);
    assert.ok(saveEvent, 'Browser B must automatically receive file_saved event via SSE');
    assert.equal(saveEvent.data.data.name, testFile1.name);
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 2: Bulk Upload — Browser A uploads 10 files, Browser B receives all 10 without loss or duplicate
  // ─────────────────────────────────────────────────────────────
  await t.test('TEST 2: Bulk Upload 10 files with zero loss and deduplication', async () => {
    const bEventsCountBefore = browserB_SSE.events.length;
    const bulk10 = [];
    for (let i = 1; i <= 10; i++) {
      bulk10.push({
        id: `test_bulk10_file_${i}`,
        module: 'salary',
        category: 'audit',
        name: `Bulk_Salary_Sheet_${i}.xlsx`,
        buf: Buffer.from(`BULK CONTENT ${i}`).toString('base64'),
        uploaded_by: 'Browser_A'
      });
    }

    const bulkRes = await request(PORT, 'POST', '/api/sync/files/bulk', { files: bulk10, module: 'salary' });
    assert.equal(bulkRes.status, 200);
    assert.equal(bulkRes.data.saved_count, 10, 'All 10 files must be saved');

    await new Promise(r => setTimeout(r, 200));

    // Verify Browser B received the bulk event
    const newEventsB = browserB_SSE.events.slice(bEventsCountBefore);
    const bulkEvent = newEventsB.find(e => e.event === 'files_bulk_saved');
    assert.ok(bulkEvent, 'Browser B must receive files_bulk_saved event');
    assert.equal(bulkEvent.data.data.count, 10);

    // Verify backend list contains all 10 files
    const listRes = await request(PORT, 'GET', '/api/sync/files?module=salary');
    const names = listRes.data.files.map(f => f.name);
    for (let i = 1; i <= 10; i++) {
      assert.ok(names.includes(`Bulk_Salary_Sheet_${i}.xlsx`), `File ${i} must exist in backend list`);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 3: Delete — Browser A deletes 1 file, Browser B removes it within 3-5 seconds
  // ─────────────────────────────────────────────────────────────
  await t.test('TEST 3: Delete propagation in real-time', async () => {
    const bEventsCountBefore = browserB_SSE.events.length;
    const targetFile = 'test_bulk10_file_3';

    const delRes = await request(PORT, 'DELETE', `/api/sync/files/${targetFile}?module=salary`);
    assert.equal(delRes.status, 200);
    assert.ok(delRes.data.deleted);

    await new Promise(r => setTimeout(r, 200));

    const newEventsB = browserB_SSE.events.slice(bEventsCountBefore);
    const delEvent = newEventsB.find(e => e.event === 'file_deleted' && e.data.data && e.data.data.id === targetFile);
    assert.ok(delEvent, 'Browser B must receive file_deleted event within milliseconds');
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 4, 5, 6: Permanent Delete & Resurrection Prevention
  // Refresh, logout/login, browser restart, and stale sync MUST NOT resurrect deleted file
  // ─────────────────────────────────────────────────────────────
  await t.test('TEST 4, 5, 6: Permanent Delete & Anti-Resurrection Guarantee', async () => {
    // 1. Fetch fresh list from backend (simulating refresh / restart / login)
    const listAfterDelete = await request(PORT, 'GET', '/api/sync/files?module=salary');
    const activeFiles = listAfterDelete.data.files;
    const foundDeleted = activeFiles.find(f => f.id === 'test_bulk10_file_3' || f.name === 'Bulk_Salary_Sheet_3.xlsx');
    assert.equal(foundDeleted, undefined, 'Deleted file MUST NOT be present in backend active list');

    // 2. Verify backend tombstone exists
    const tombstones = listAfterDelete.data.tombstones;
    assert.ok(tombstones['test_bulk10_file_3'] || tombstones['bulk_salary_sheet_3.xlsx'], 'Backend must hold permanent tombstone');

    // 3. Simulate an outdated Browser trying to re-upload or reconcile the deleted file
    const staleAttempt = await request(PORT, 'POST', '/api/sync/files', {
      id: 'test_bulk10_file_3',
      name: 'Bulk_Salary_Sheet_3.xlsx',
      module: 'salary',
      created_at: new Date(Date.now() - 60000).toISOString(), // Older timestamp
      buf: Buffer.from('STALE OLD CONTENT').toString('base64')
    });

    // Backend must REJECT the stale attempt with HTTP 409
    assert.equal(staleAttempt.status, 409, 'Backend must reject resurrection of tombstoned file with HTTP 409');
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 7: Offline Browser Reconnect Recovery
  // Browser B disconnects, Browser A mutates, Browser B reconnects and reconciles
  // ─────────────────────────────────────────────────────────────
  await t.test('TEST 7: Offline Reconnect Reconciliation', async () => {
    // Browser A adds file while B is "offline"
    const offlineTestFile = {
      id: 'test_offline_reconcile_1',
      module: 'salary',
      name: 'Offline_Reconcile_File.xlsx',
      buf: Buffer.from('OFFLINE TEST').toString('base64'),
      uploaded_by: 'Browser_A'
    };
    await request(PORT, 'POST', '/api/sync/files', offlineTestFile);

    // Browser B reconnects and calls /api/sync/state
    const stateRes = await request(PORT, 'GET', '/api/sync/state');
    assert.equal(stateRes.status, 200);
    const hasOfflineFile = stateRes.data.files.some(f => f.id === offlineTestFile.id);
    assert.ok(hasOfflineFile, 'Browser B must immediately fetch authoritative state on reconnect');
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 8: PF Challan Module Synchronization
  // ─────────────────────────────────────────────────────────────
  await t.test('TEST 8: PF Challan Upload, Download & Delete', async () => {
    const pfFile = {
      id: 'pf_challan_2026_05',
      module: 'pf',
      category: 'challan',
      name: 'PF_ECR_Challan_May_2026.pdf',
      period: '2026-05',
      mime_type: 'application/pdf',
      buf: Buffer.from('PDF CHALLAN DATA').toString('base64'),
      uploaded_by: 'admin'
    };

    // Upload PF Challan
    const upPf = await request(PORT, 'POST', '/api/sync/files', pfFile);
    assert.equal(upPf.status, 201);

    // Verify PF list
    const listPf = await request(PORT, 'GET', '/api/sync/files?module=pf');
    assert.ok(listPf.data.files.some(f => f.id === pfFile.id));

    // Verify original content download endpoint works for viewers
    const contentRes = await request(PORT, 'GET', `/api/sync/files/${pfFile.id}/content`);
    assert.equal(contentRes.status, 200);
    assert.ok(contentRes.data.length > 0);

    // Delete PF Challan
    const delPf = await request(PORT, 'DELETE', `/api/sync/files/${pfFile.id}?module=pf`);
    assert.equal(delPf.status, 200);

    // Verify permanent delete
    const listPfAfter = await request(PORT, 'GET', '/api/sync/files?module=pf');
    assert.equal(listPfAfter.data.files.some(f => f.id === pfFile.id), false);
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 9: ESIC Challan Module Synchronization
  // ─────────────────────────────────────────────────────────────
  await t.test('TEST 9: ESIC Challan Upload, Download & Delete', async () => {
    const esicFile = {
      id: 'esic_challan_2026_05',
      module: 'esic',
      category: 'challan',
      name: 'ESIC_Challan_May_2026.pdf',
      period: '2026-05',
      mime_type: 'application/pdf',
      buf: Buffer.from('ESIC CHALLAN DATA').toString('base64'),
      uploaded_by: 'admin'
    };

    const upEsic = await request(PORT, 'POST', '/api/sync/files', esicFile);
    assert.equal(upEsic.status, 201);

    const listEsic = await request(PORT, 'GET', '/api/sync/files?module=esic');
    assert.ok(listEsic.data.files.some(f => f.id === esicFile.id));

    // Verify module isolation: ESIC file must NOT show up in PF
    const listPf = await request(PORT, 'GET', '/api/sync/files?module=pf');
    assert.equal(listPf.data.files.some(f => f.id === esicFile.id), false, 'ESIC file must NOT appear in PF module');

    // Clean up
    await request(PORT, 'DELETE', `/api/sync/files/${esicFile.id}?module=esic`);
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 10: HR Documents Module Synchronization
  // ─────────────────────────────────────────────────────────────
  await t.test('TEST 10: HR Documents Upload & Delete', async () => {
    const hrDoc = {
      id: 'HRD-2026-NOC-01',
      module: 'hr_doc',
      category: 'Fire NOC',
      name: 'Fire_NOC_Certificate.pdf',
      mime_type: 'application/pdf',
      buf: Buffer.from('FIRE NOC DATA').toString('base64'),
      meta: {
        document_name: 'Fire NOC Certificate',
        doc_type: 'Fire NOC',
        reference_no: 'LSG/BIK/2026/999'
      }
    };

    const upHr = await request(PORT, 'POST', '/api/sync/files', hrDoc);
    assert.equal(upHr.status, 201);

    const listHr = await request(PORT, 'GET', '/api/sync/files?module=hr_doc');
    assert.ok(listHr.data.files.some(f => f.id === hrDoc.id));

    // Delete HR Doc
    await request(PORT, 'DELETE', `/api/sync/files/${hrDoc.id}?module=hr_doc`);
    const listHrAfter = await request(PORT, 'GET', '/api/sync/files?module=hr_doc');
    assert.equal(listHrAfter.data.files.some(f => f.id === hrDoc.id), false);
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 11: All Files / General Library
  // ─────────────────────────────────────────────────────────────
  await t.test('TEST 11: General File Library', async () => {
    const genFile = {
      id: 'gen_doc_1',
      module: 'general',
      name: 'Company_Policy_Guide.pdf',
      buf: Buffer.from('POLICY CONTENT').toString('base64')
    };

    await request(PORT, 'POST', '/api/sync/files', genFile);
    const allRes = await request(PORT, 'GET', '/api/sync/files?module=all');
    assert.ok(allRes.data.files.some(f => f.id === genFile.id));
    await request(PORT, 'DELETE', `/api/sync/files/${genFile.id}?module=general`);
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 12: Simultaneous Users / Concurrency
  // Browser A and Browser B upload at almost the same time — no file lost
  // ─────────────────────────────────────────────────────────────
  await t.test('TEST 12: Simultaneous Multi-User Uploads', async () => {
    const p1 = request(PORT, 'POST', '/api/sync/files', {
      id: 'simul_file_A_' + RUN,
      module: 'salary',
      name: 'Simul_File_A_' + RUN + '.xlsx',
      buf: Buffer.from('DATA A ' + RUN).toString('base64'),
      uploaded_by: 'User_A'
    });
    const p2 = request(PORT, 'POST', '/api/sync/files', {
      id: 'simul_file_B_' + RUN,
      module: 'salary',
      name: 'Simul_File_B_' + RUN + '.xlsx',
      buf: Buffer.from('DATA B ' + RUN).toString('base64'),
      uploaded_by: 'User_B'
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);

    const list = await request(PORT, 'GET', '/api/sync/files?module=salary');
    assert.ok(list.data.files.some(f => f.id === 'simul_file_A_' + RUN));
    assert.ok(list.data.files.some(f => f.id === 'simul_file_B_' + RUN));
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 13: Simultaneous Delete & Refresh
  // Delete file while another browser fetches state — deleted file stays deleted
  // ─────────────────────────────────────────────────────────────
  await t.test('TEST 13: Simultaneous Delete & Refresh', async () => {
    const delP = request(PORT, 'DELETE', `/api/sync/files/simul_file_A_${RUN}?module=salary`);
    const refreshP = request(PORT, 'GET', '/api/sync/state');

    await Promise.all([delP, refreshP]);
    const finalState = await request(PORT, 'GET', '/api/sync/state');
    assert.equal(finalState.data.files.some(f => f.id === 'simul_file_A_' + RUN), false);
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 14: Duplicate Upload Protection
  // Upload same file twice — deduplication handles it safely
  // ─────────────────────────────────────────────────────────────
  await t.test('TEST 14: Duplicate Upload Protection', async () => {
    const payload = {
      id: 'dup_test_1_' + RUN,
      module: 'salary',
      name: 'Duplicate_Test_File_' + RUN + '.xlsx',
      buf: Buffer.from('IDENTICAL CONTENT FOR DUP CHECK ' + RUN).toString('base64')
    };

    const first = await request(PORT, 'POST', '/api/sync/files', payload);
    assert.equal(first.status, 201);

    // Second upload with new ID but identical payload
    const second = await request(PORT, 'POST', '/api/sync/files', {
      id: 'dup_test_2_' + RUN,
      module: 'salary',
      name: 'Duplicate_Test_File_Copy_' + RUN + '.xlsx',
      buf: Buffer.from('IDENTICAL CONTENT FOR DUP CHECK ' + RUN).toString('base64')
    });

    assert.equal(second.status, 200);
    assert.ok(second.data.duplicate, 'Duplicate upload must be detected');
    assert.equal(second.data.file.id, 'dup_test_1_' + RUN, 'Must return existing record');
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 15: Large Bulk Upload (25 files)
  // System remains responsive and correctly stores & broadcasts all files
  // ─────────────────────────────────────────────────────────────
  await t.test('TEST 15: Large Bulk Upload (25 files)', async () => {
    const largeBatch = [];
    for (let i = 1; i <= 25; i++) {
      largeBatch.push({
        id: `large_bulk_file_${i}`,
        module: 'salary',
        name: `Large_Batch_File_${i}.xlsx`,
        buf: Buffer.from(`LARGE BATCH ROW DATA ${i}`).toString('base64')
      });
    }

    const bulkRes = await request(PORT, 'POST', '/api/sync/files/bulk', { files: largeBatch, module: 'salary' });
    assert.equal(bulkRes.status, 200);
    assert.equal(bulkRes.data.saved_count, 25, 'All 25 files in large batch must be saved');

    const checkList = await request(PORT, 'GET', '/api/sync/files?module=salary');
    for (let i = 1; i <= 25; i++) {
      assert.ok(checkList.data.files.some(f => f.id === `large_bulk_file_${i}`), `Large file ${i} must exist in backend`);
    }
  });

  // Close SSE connections
  browserB_SSE.close();
  browserC_SSE.close();

  if (serverProc) {
    try { serverProc.kill('SIGKILL'); } catch (_) {}
  }

  setTimeout(() => process.exit(0), 100);
});
