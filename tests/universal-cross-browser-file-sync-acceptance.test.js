const test = require('node:test');
const assert = require('node:assert/strict');

test('Universal Cross-Browser File Sync & Strict Auto-Delete Acceptance Test', async (t) => {
  const SUPABASE_URL = 'https://gsbyzddibdjxekutpkip.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzYnl6ZGRpYmRqeGVrdXRwa2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNTk1NzcsImV4cCI6MjEwNTYzNTU3N30.Bz5NyhVtuJm1MjljiDsnW4036E3qZWgqyEWll7ZqzcI';

  async function sbRest(endpoint, options = {}) {
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      ...options.headers
    };
    const res = await fetch(SUPABASE_URL + '/rest/v1/' + endpoint, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const txt = await res.text();
    return (txt && txt.trim()) ? JSON.parse(txt) : null;
  }

  const RUN_ID = Date.now();
  const FILE_1 = 'test_acceptance_file_1_' + RUN_ID + '.xlsx';
  const FILE_2 = 'test_acceptance_file_2_' + RUN_ID + '.xlsx';
  const HR_DOC_1 = 'HRD-TEST-' + RUN_ID;

  await t.test('1. Browser A uploads 2 Salary files and 1 HR Doc to Supabase', async () => {
    await sbRest('hr_files', {
      method: 'POST',
      body: {
        filename: FILE_1,
        payload: Buffer.from('FILE 1 CONTENT').toString('base64'),
        doc_type: 'salary',
        size: 100,
        uploaded_at: new Date().toISOString(),
        version: 1
      }
    });

    await sbRest('hr_files', {
      method: 'POST',
      body: {
        filename: FILE_2,
        payload: Buffer.from('FILE 2 CONTENT').toString('base64'),
        doc_type: 'salary',
        size: 100,
        uploaded_at: new Date().toISOString(),
        version: 1
      }
    });

    await sbRest('hr_files', {
      method: 'POST',
      body: {
        filename: HR_DOC_1,
        payload: JSON.stringify({ id: HR_DOC_1, document_name: 'Fire Safety Audit', doc_type: 'Safety' }),
        doc_type: 'hr_doc',
        size: 150,
        uploaded_at: new Date().toISOString(),
        version: 1
      }
    });

    const activeSalary = await sbRest('hr_files?doc_type=eq.salary&filename=in.(' + FILE_1 + ',' + FILE_2 + ')');
    assert.equal(activeSalary.length, 2, 'Both files must exist in Supabase');

    const activeHr = await sbRest('hr_files?doc_type=eq.hr_doc&filename=eq.' + HR_DOC_1);
    assert.equal(activeHr.length, 1, 'HR Doc must exist in Supabase');
  });

  await t.test('2. Browser B opens on phone/other browser: reconciles and discovers exact files', async () => {
    const serverSalary = await sbRest('hr_files?select=filename&doc_type=eq.salary');
    assert.ok(serverSalary.some(f => f.filename === FILE_1));
    assert.ok(serverSalary.some(f => f.filename === FILE_2));

    const serverHr = await sbRest('hr_files?select=filename&doc_type=eq.hr_doc');
    assert.ok(serverHr.some(f => f.filename === HR_DOC_1));
  });

  await t.test('3. Admin deletes FILE_1 and HR_DOC_1: Supabase cleans active and creates tombstones', async () => {
    await sbRest('hr_files?filename=ilike.' + encodeURIComponent(FILE_1) + '&doc_type=eq.salary', { method: 'DELETE' });
    await sbRest('hr_files', {
      method: 'POST',
      body: {
        filename: FILE_1,
        payload: '',
        doc_type: 'salary_tombstone',
        size: 0,
        uploaded_at: new Date().toISOString(),
        version: 1
      }
    });

    await sbRest('hr_files?filename=ilike.' + encodeURIComponent(HR_DOC_1) + '&doc_type=eq.hr_doc', { method: 'DELETE' });
    await sbRest('hr_files', {
      method: 'POST',
      body: {
        filename: HR_DOC_1,
        payload: '',
        doc_type: 'hr_doc_tombstone',
        size: 0,
        uploaded_at: new Date().toISOString(),
        version: 1
      }
    });

    const salaryLeft = await sbRest('hr_files?doc_type=eq.salary&filename=in.(' + FILE_1 + ',' + FILE_2 + ')');
    assert.equal(salaryLeft.length, 1, 'Only FILE_2 should remain in active salary');
    assert.equal(salaryLeft[0].filename, FILE_2);

    const hrLeft = await sbRest('hr_files?doc_type=eq.hr_doc&filename=eq.' + HR_DOC_1);
    assert.equal(hrLeft.length, 0, 'HR_DOC_1 must be gone from active hr_doc');
  });

  await t.test('4. Browser B reconciles: dead files are strictly pruned and never resurrect', async () => {
    const activeSalary = await sbRest('hr_files?select=filename,uploaded_at&doc_type=eq.salary');
    const tombSalary = await sbRest('hr_files?select=filename,uploaded_at&doc_type=eq.salary_tombstone');
    const tombs = {};
    tombSalary.forEach(t => tombs[t.filename.toLowerCase()] = t.uploaded_at);

    const browserBFiles = [FILE_1, FILE_2];
    const prunedFiles = browserBFiles.filter(fn => {
      const fnLower = fn.toLowerCase();
      const inServer = activeSalary.some(s => s.filename.toLowerCase() === fnLower);
      const isTomb = !!tombs[fnLower];
      return inServer && !isTomb;
    });

    assert.equal(prunedFiles.length, 1);
    assert.equal(prunedFiles[0], FILE_2, 'FILE_1 was strictly pruned and FILE_2 is preserved');
  });

  // Cleanup test artifacts
  await sbRest('hr_files?filename=ilike.' + encodeURIComponent(FILE_1), { method: 'DELETE' });
  await sbRest('hr_files?filename=ilike.' + encodeURIComponent(FILE_2), { method: 'DELETE' });
  await sbRest('hr_files?filename=ilike.' + encodeURIComponent(HR_DOC_1), { method: 'DELETE' });
});
