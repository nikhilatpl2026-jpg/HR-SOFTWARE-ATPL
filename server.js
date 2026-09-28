const express = require('express');
const path = require('path');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = 3000;

// CORS Support for multi-browser and external origins
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Body parsing with 50MB limit for scanned PDFs and image attachments
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize GoogleGenAI client (automatically loads process.env.GEMINI_API_KEY)
const ai = new GoogleGenAI();

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY & DISK PERSISTENT REAL-TIME SYNC STORE
// ═══════════════════════════════════════════════════════════════
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}

function readJsonFile(filename, fallback) {
  try {
    const p = path.join(DATA_DIR, filename);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (err) {
    console.warn('[Sync-Store] Read warning for', filename, err.message);
  }
  return fallback;
}

function writeJsonFile(filename, data) {
  try {
    const p = path.join(DATA_DIR, filename);
    fs.writeFileSync(p, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.warn('[Sync-Store] Write warning for', filename, err.message);
  }
}

// Store caches
let syncSalaryFiles = readJsonFile('salary_files.json', {});
let syncSalaryTombstones = readJsonFile('salary_tombstones.json', {});
let syncHrDocs = readJsonFile('hr_docs.json', {});
let syncHrTombstones = readJsonFile('hr_tombstones.json', {});
let syncEmployeeMaster = readJsonFile('employee_master.json', []);

// Active Server-Sent Events (SSE) connections for cross-browser live updates
const sseClients = new Set();

function broadcastEvent(eventType, payload) {
  const data = JSON.stringify({ type: eventType, data: payload, timestamp: Date.now() });
  const msg = `event: ${eventType}\ndata: ${data}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

// ── SSE Endpoint for Real-Time Cross-Browser Updates ──
app.get('/api/sync/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write('event: connected\ndata: {"status":"connected"}\n\n');
  sseClients.add(res);

  // Send heartbeat keepalive every 20 seconds
  const keepAlive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch (_) {
      clearInterval(keepAlive);
      sseClients.delete(res);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// ── Fast Metadata Sync Endpoint (Lightweight, No Lag) ──
app.get('/api/sync/files-meta', (req, res) => {
  const meta = Object.values(syncSalaryFiles).map(f => ({
    name: f.name,
    saved: f.saved,
    size: f.buf ? f.buf.length : 0,
    uploaded_by: f.uploaded_by
  }));
  return res.json({
    ok: true,
    total_files: meta.length,
    salary_files: meta,
    salary_tombstones: syncSalaryTombstones
  });
});

// ── Single Salary File Download Endpoint ──
app.get('/api/sync/salary-file/:name', (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    if (!name) return res.status(400).json({ ok: false, error: 'File name required' });
    const key = name.toLowerCase();
    const item = syncSalaryFiles[key];
    if (!item) return res.status(404).json({ ok: false, error: 'File not found' });
    return res.json({ ok: true, file: item });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Full System Sync State ──
app.get('/api/sync/state', (req, res) => {
  const isSummary = req.query.summary === '1';
  const salaryFiles = isSummary
    ? Object.values(syncSalaryFiles).map(f => ({
        name: f.name,
        saved: f.saved,
        size: f.buf ? f.buf.length : 0,
        uploaded_by: f.uploaded_by
      }))
    : Object.values(syncSalaryFiles);
  return res.json({
    ok: true,
    salary_files: salaryFiles,
    salary_files_count: Object.keys(syncSalaryFiles).length,
    salary_tombstones: syncSalaryTombstones,
    hr_docs: Object.values(syncHrDocs),
    hr_tombstones: syncHrTombstones,
    employee_master: syncEmployeeMaster
  });
});

// ── Salary File Upload / Save ──
app.post('/api/sync/salary-file', (req, res) => {
  try {
    const { name, buf, sheets, saved, uploaded_by } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: 'File name required' });

    const key = String(name).toLowerCase();
    const item = {
      name: String(name),
      buf: buf || null,
      sheets: sheets || null,
      saved: saved || new Date().toISOString(),
      uploaded_by: uploaded_by || 'user'
    };

    syncSalaryFiles[key] = item;
    delete syncSalaryTombstones[key];

    writeJsonFile('salary_files.json', syncSalaryFiles);
    writeJsonFile('salary_tombstones.json', syncSalaryTombstones);

    broadcastEvent('salary_file_saved', {
      name: item.name,
      saved: item.saved,
      uploaded_by: item.uploaded_by
    });
    return res.json({ ok: true, saved: true, name });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Batch Reconcile Salary Files (Cross-Browser Bi-directional Sync) ──
app.post('/api/sync/reconcile-salary-files', (req, res) => {
  try {
    const { files } = req.body || {};
    let newlySaved = 0;
    if (Array.isArray(files) && files.length > 0) {
      for (const f of files) {
        if (!f || !f.name) continue;
        const key = String(f.name).toLowerCase();
        const tomb = syncSalaryTombstones[key];
        const tombTime = tomb && tomb.deleted_at ? Date.parse(tomb.deleted_at) : 0;
        const fTime = f.saved ? Date.parse(f.saved) : 0;

        // If tombstone exists and is newer than file, skip
        if (tombTime && tombTime > fTime) continue;

        // If server already has file with buf and newer timestamp, skip
        const existing = syncSalaryFiles[key];
        if (existing && existing.buf && Date.parse(existing.saved || 0) >= fTime) continue;

        // Update server cache
        const item = {
          name: String(f.name),
          buf: f.buf || null,
          sheets: f.sheets || null,
          saved: f.saved || new Date().toISOString(),
          uploaded_by: f.uploaded_by || 'reconcile'
        };
        syncSalaryFiles[key] = item;
        delete syncSalaryTombstones[key];
        newlySaved++;
        broadcastEvent('salary_file_saved', {
          name: item.name,
          saved: item.saved,
          uploaded_by: item.uploaded_by
        });
      }

      if (newlySaved > 0) {
        writeJsonFile('salary_files.json', syncSalaryFiles);
        writeJsonFile('salary_tombstones.json', syncSalaryTombstones);
        broadcastEvent('sync_state_updated', { salary_files_count: Object.keys(syncSalaryFiles).length });
      }
    }

    return res.json({
      ok: true,
      newly_saved: newlySaved,
      salary_files: Object.values(syncSalaryFiles),
      salary_tombstones: syncSalaryTombstones
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Salary File Delete ──
app.delete('/api/sync/salary-file/:name', (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    if (!name) return res.status(400).json({ ok: false, error: 'Name required' });

    const key = name.toLowerCase();
    delete syncSalaryFiles[key];
    const now = new Date().toISOString();
    syncSalaryTombstones[key] = { name: name, deleted_at: now, deleted_by: req.query.user || 'user' };

    writeJsonFile('salary_files.json', syncSalaryFiles);
    writeJsonFile('salary_tombstones.json', syncSalaryTombstones);

    broadcastEvent('salary_file_deleted', { name: name, deleted_at: now });
    return res.json({ ok: true, deleted: true, name });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Salary Clear All ──
app.post('/api/sync/salary-clear-all', (req, res) => {
  try {
    const now = new Date().toISOString();
    Object.keys(syncSalaryFiles).forEach(k => {
      syncSalaryTombstones[k] = { name: syncSalaryFiles[k].name, deleted_at: now, deleted_by: 'user' };
    });
    syncSalaryFiles = {};

    writeJsonFile('salary_files.json', syncSalaryFiles);
    writeJsonFile('salary_tombstones.json', syncSalaryTombstones);

    broadcastEvent('salary_clear_all', { cleared_at: now });
    return res.json({ ok: true, cleared_at: now });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── HR Doc Save / Upload ──
app.post('/api/sync/hr-doc', (req, res) => {
  try {
    const doc = req.body || {};
    if (!doc || !doc.id) return res.status(400).json({ ok: false, error: 'Document id required' });

    const key = String(doc.id).toLowerCase();
    syncHrDocs[key] = doc;
    delete syncHrTombstones[key];

    writeJsonFile('hr_docs.json', syncHrDocs);
    writeJsonFile('hr_tombstones.json', syncHrTombstones);

    broadcastEvent('hr_doc_saved', doc);
    return res.json({ ok: true, saved: true, id: doc.id });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── HR Doc Delete ──
app.delete('/api/sync/hr-doc/:id', (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'ID required' });

    const key = id.toLowerCase();
    delete syncHrDocs[key];
    const now = new Date().toISOString();
    syncHrTombstones[key] = { id: id, deleted_at: now };

    writeJsonFile('hr_docs.json', syncHrDocs);
    writeJsonFile('hr_tombstones.json', syncHrTombstones);

    broadcastEvent('hr_doc_deleted', { id: id, deleted_at: now });
    return res.json({ ok: true, deleted: true, id });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Employee Master State & Save ──
app.get('/api/sync/employee-master', (req, res) => {
  return res.json({ ok: true, records: syncEmployeeMaster });
});

app.post('/api/sync/employee-master', (req, res) => {
  try {
    const records = req.body && Array.isArray(req.body.records) ? req.body.records : (Array.isArray(req.body) ? req.body : null);
    if (!records) return res.status(400).json({ ok: false, error: 'Records array required' });

    syncEmployeeMaster = records;
    writeJsonFile('employee_master.json', syncEmployeeMaster);

    broadcastEvent('employee_master_updated', { records: syncEmployeeMaster });
    return res.json({ ok: true, saved: true, count: syncEmployeeMaster.length });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// AI HR Document Analysis API endpoint using gemini-3.8-flash
app.post('/api/hr-docs/analyze', async (req, res) => {
  try {
    const { base64, mimeType, fileName } = req.body || {};
    if (!base64) {
      return res.status(400).json({ success: false, error: 'Document file data missing' });
    }

    const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
    let cleanMimeType = mimeType || 'application/pdf';
    if (fileName) {
      const ext = fileName.split('.').pop().toLowerCase();
      if (['jpg', 'jpeg'].includes(ext)) cleanMimeType = 'image/jpeg';
      else if (ext === 'png') cleanMimeType = 'image/png';
      else if (ext === 'webp') cleanMimeType = 'image/webp';
      else if (ext === 'pdf') cleanMimeType = 'application/pdf';
    }

    const prompt = `You are an expert HR, Legal Compliance, and Statutory Document Analyst for Arora Textiles Private Limited (ATPL).
Analyze this uploaded document (PDF or scanned image) with 100% precision.
Extract and identify the following fields:
1. document_name: Exact official title (e.g., 'Fire NOC / Fire Safety Certificate', 'Factory License Renewal', 'First Aid Training Certificate', 'Standing Orders', 'POSH Policy', 'Pollution Control Board Consent', 'Electrical Safety Certificate').
2. doc_type: Must be one of: 'Legal / Compliance', 'Certificate / License', 'Training Record', 'HR Policy', 'Fire NOC', or 'Other'.
3. holder: Company name or individual holder mentioned (e.g. 'Arora Textiles Private Limited', or Employee Name).
4. reference_no: Application, acknowledgment, or file reference number (e.g. 'LSG/BIKANER/FIRENOC/2024-25/34493').
5. certificate_no: Certificate, registration, or license number if distinct.
6. issuing_authority: Department, Council, Municipal Corporation, Inspectorate, or training agency (e.g., 'Municipal Corporation Bikaner / Fire Department', 'Directorate of Factories and Boilers').
7. issue_date: Original date of initial issue or initial certificate creation in YYYY-MM-DD format. If none, return empty string.
8. last_renewal_date: Date when this document/license/certificate was most recently renewed (e.g., 'Last Renewal Date', 'Renewed on', 'Date of Renewal', 'नवीनीकरण दिनांक', 'अंतिम नवीनीकरण'). Return in YYYY-MM-DD format. If this is an original newly issued document with no prior renewal, return empty string.
9. expiry_date: Expiration, valid till, or next renewal due date in YYYY-MM-DD format (e.g., 'Valid Till', 'Valid Upto', 'वैधता दिनांक', 'समाप्ति दिनांक'). If permanent or no expiry, return empty string.
10. retraining_date: Next re-training or periodic renewal / inspection due date in YYYY-MM-DD format.
11. validity_period: Duration mentioned (e.g., '1 Year', '3 Years', '5 Years', 'Permanent', 'Annual').
12. location: Factory / Unit / Site / Department mentioned (e.g. 'Bikaner Unit / Weaving Section').
13. remarks: Concise summary of key details, trainer name, employee ID if applicable, conditions, or renewal endorsement notes.

Return strictly valid JSON matching the schema.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          inlineData: {
            mimeType: cleanMimeType,
            data: cleanBase64
          }
        },
        prompt
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            document_name: { type: 'STRING' },
            doc_type: { type: 'STRING' },
            holder: { type: 'STRING' },
            reference_no: { type: 'STRING' },
            certificate_no: { type: 'STRING' },
            issuing_authority: { type: 'STRING' },
            issue_date: { type: 'STRING' },
            last_renewal_date: { type: 'STRING' },
            expiry_date: { type: 'STRING' },
            retraining_date: { type: 'STRING' },
            validity_period: { type: 'STRING' },
            location: { type: 'STRING' },
            remarks: { type: 'STRING' }
          },
          required: ['document_name', 'doc_type']
        }
      }
    });

    const parsed = JSON.parse(response.text);
    return res.json({ success: true, data: parsed });
  } catch (err) {
    console.error('Gemini HR doc analysis error:', err);
    return res.status(500).json({ success: false, error: err.message || 'AI document analysis failed' });
  }
});

// Serve all static assets from root project directory
app.use(express.static(__dirname, {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (filePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
  }
}));

// Route fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
