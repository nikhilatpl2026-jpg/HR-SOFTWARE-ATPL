const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS Support for multi-browser and external origins (Cloud Run, local dev, GitHub Pages)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-atpl-token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Body parsing with 50MB limit for bulk uploads, scanned PDFs, and Excel attachments
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize GoogleGenAI client (automatically loads process.env.GEMINI_API_KEY)
const ai = new GoogleGenAI();

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY & DISK PERSISTENT REAL-TIME SYNC STORE
// ═══════════════════════════════════════════════════════════════
const DATA_DIR = path.join(__dirname, 'data');
const BLOBS_DIR = path.join(DATA_DIR, 'blobs');

if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}
if (!fs.existsSync(BLOBS_DIR)) {
  try { fs.mkdirSync(BLOBS_DIR, { recursive: true }); } catch (_) {}
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

// Compute SHA-256 hash of buffer or string
function hashData(data) {
  if (!data) return '';
  const hash = crypto.createHash('sha256');
  if (Buffer.isBuffer(data)) {
    hash.update(data);
  } else if (typeof data === 'string') {
    if (data.includes('base64,')) data = data.split('base64,')[1];
    hash.update(data);
  } else {
    hash.update(JSON.stringify(data));
  }
  return hash.digest('hex');
}

// ── Central Files Database ──
// Stores all active files across all modules, plus permanent tombstones
let filesDb = readJsonFile('files_db.json', {
  version: 1,
  files: {},      // id -> file record
  tombstones: {}  // id or hash -> { id, name, module, sha256_hash, deleted_at, deleted_by }
});

if (!filesDb.files) filesDb.files = {};
if (!filesDb.tombstones) filesDb.tombstones = {};
if (typeof filesDb.version !== 'number') filesDb.version = 1;

// Legacy store caches for 100% backwards compatibility with existing regression tests
let syncSalaryFiles = readJsonFile('salary_files.json', {});
let syncSalaryTombstones = readJsonFile('salary_tombstones.json', {});
let syncHrDocs = readJsonFile('hr_docs.json', {});
let syncHrTombstones = readJsonFile('hr_tombstones.json', {});
let syncEmployeeMaster = readJsonFile('employee_master.json', []);
let syncDolRecords = readJsonFile('dol_records.json', {}); // id -> DOL challan

// Migrate any existing legacy salary and hr files into unified filesDb
Object.values(syncSalaryFiles).forEach(f => {
  if (!f || !f.name) return;
  const id = 'sal_' + hashData(f.name).substring(0, 16);
  if (!filesDb.files[id] && !filesDb.tombstones[id] && !filesDb.tombstones[f.name.toLowerCase()]) {
    filesDb.files[id] = {
      id: id,
      module: 'salary',
      category: 'audit',
      name: f.name,
      size: f.buf ? (typeof f.buf === 'string' ? f.buf.length : 0) : 0,
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sha256_hash: f.buf ? hashData(f.buf) : hashData(f.name),
      buf: f.buf || null,
      sheets: f.sheets || null,
      saved: f.saved || new Date().toISOString(),
      uploaded_by: f.uploaded_by || 'admin',
      created_at: f.saved || new Date().toISOString(),
      updated_at: f.saved || new Date().toISOString()
    };
  }
});

Object.values(syncHrDocs).forEach(doc => {
  if (!doc || !doc.id) return;
  const id = doc.id;
  if (!filesDb.files[id] && !filesDb.tombstones[id]) {
    filesDb.files[id] = {
      id: id,
      module: 'hr_doc',
      category: doc.doc_type || 'HR Policy',
      name: doc.file_name || doc.document_name || id,
      size: doc.file_data ? doc.file_data.length : 0,
      mime_type: doc.file_type || 'application/pdf',
      sha256_hash: doc.file_data ? hashData(doc.file_data) : hashData(id),
      meta: doc,
      uploaded_by: 'admin',
      created_at: doc.updated_at || new Date().toISOString(),
      updated_at: doc.updated_at || new Date().toISOString()
    };
  }
});

writeJsonFile('files_db.json', filesDb);

function incrementVersion() {
  filesDb.version = (filesDb.version || 0) + 1;
  return filesDb.version;
}

// ── Server-Side Cloud Proxy for Google Apps Script ──
// Completely bypasses iframe CSP and prevents cross-origin "Script error."
app.all('/api/cloud-proxy', async (req, res) => {
  const params = req.method === 'POST' ? req.body : req.query;
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec';
  try {
    const qs = new URLSearchParams(params).toString();
    const url = APPS_SCRIPT_URL + (qs ? '?' + qs : '');
    const upstreamRes = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'ATPL-Cloud-Broker/1.0' }
    });
    const text = await upstreamRes.text();
    try {
      const json = JSON.parse(text);
      return res.json(json);
    } catch (_) {
      const match = text.match(/^[\w.$]+\s*\(([\s\S]*)\)\s*;?$/);
      if (match) {
        return res.json(JSON.parse(match[1]));
      }
      return res.send(text);
    }
  } catch (err) {
    console.warn('[Cloud Proxy] Upstream notice:', err.message);
    return res.status(502).json({ ok: false, error: 'CLOUD_UNREACHABLE', message: err.message });
  }
});

// Active Server-Sent Events (SSE) connections for cross-browser live updates
const sseClients = new Set();

function broadcastEvent(eventType, payload) {
  const data = JSON.stringify({ type: eventType, data: payload, version: filesDb.version, timestamp: Date.now() });
  const msg = `event: ${eventType}\ndata: ${data}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

// ── SSE Endpoint for Real-Time Cross-Browser Updates (3–5s Guarantee) ──
app.get('/api/sync/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(`event: connected\ndata: {"status":"connected","version":${filesDb.version}}\n\n`);
  sseClients.add(res);

  // Send heartbeat keepalive every 15 seconds to prevent network timeouts
  const keepAlive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch (_) {
      clearInterval(keepAlive);
      sseClients.delete(res);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// ═══════════════════════════════════════════════════════════════
// UNIFIED CENTRAL FILE REPOSITORY ENDPOINTS (ALL MODULES)
// ═══════════════════════════════════════════════════════════════

// ── Query Files by Module / Category ──
app.get('/api/sync/files', (req, res) => {
  try {
    const { module: mod, category, summary } = req.query || {};
    let list = Object.values(filesDb.files);

    if (mod && mod !== 'all') {
      list = list.filter(f => f.module === mod);
    }
    if (category) {
      list = list.filter(f => f.category === category);
    }

    if (summary === '1') {
      list = list.map(f => {
        const copy = Object.assign({}, f);
        delete copy.buf;
        if (copy.meta && copy.meta.file_data) delete copy.meta.file_data;
        if (copy.meta && copy.meta.file_data_list) delete copy.meta.file_data_list;
        return copy;
      });
    }

    return res.json({
      ok: true,
      version: filesDb.version,
      count: list.length,
      files: list,
      tombstones: filesDb.tombstones
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Upload / Save File (Central Authoritative Entry Point) ──
app.post('/api/sync/files', (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'File name required' });

    const mod = String(body.module || 'salary').toLowerCase();
    const id = String(body.id || ('file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)));
    const now = new Date().toISOString();
    const buf = body.buf || null;
    const sha256 = body.sha256_hash || (buf ? hashData(buf) : hashData(name));

    // Check if permanently tombstoned by ID or Hash
    const tomb = filesDb.tombstones[id] || filesDb.tombstones[name.toLowerCase()] || (sha256 ? filesDb.tombstones[sha256] : null);
    if (tomb && tomb.deleted_at) {
      const tombTime = Date.parse(tomb.deleted_at);
      const reqTime = body.created_at ? Date.parse(body.created_at) : Date.now();
      // If client is trying to re-upload an older file that was deleted elsewhere, REJECT IT
      if (tombTime >= reqTime) {
        return res.status(409).json({
          ok: false,
          error: `File "${name}" was permanently deleted from central ERP and cannot be resurrected.`
        });
      }
      // If user uploaded a brand new file with new timestamp, clear the old tombstone
      delete filesDb.tombstones[id];
      delete filesDb.tombstones[name.toLowerCase()];
      if (sha256) delete filesDb.tombstones[sha256];
    }

    // Check for duplicates in the same module
    if (sha256 && !body.allow_duplicate) {
      const existing = Object.values(filesDb.files).find(f => f.module === mod && f.sha256_hash === sha256 && f.id !== id);
      if (existing) {
        return res.json({
          ok: true,
          duplicate: true,
          saved: true,
          file: existing,
          message: 'File already exists in module with identical SHA-256 fingerprint.'
        });
      }
    }

    // Save blob to disk if provided
    let blobPath = null;
    if (buf && typeof buf === 'string') {
      try {
        const cleanBuf = buf.includes(',') ? buf.split(',')[1] : buf;
        const bin = Buffer.from(cleanBuf, 'base64');
        blobPath = path.join(BLOBS_DIR, `${id}.bin`);
        fs.writeFileSync(blobPath, bin);
      } catch (err) {
        console.warn('[Sync-Store] Blob save error:', err.message);
      }
    }

    const fileRecord = {
      id: id,
      module: mod,
      category: body.category || 'general',
      name: name,
      mime_type: body.mime_type || 'application/octet-stream',
      size: Number(body.size || (buf ? buf.length : 0)),
      sha256_hash: sha256,
      period: body.period || '',
      periodSource: body.periodSource || '',
      uploaded_by: body.uploaded_by || 'admin',
      created_at: body.created_at || now,
      updated_at: now,
      meta: body.meta || {},
      buf: buf, // Keep in memory for fast response
      sheets: body.sheets || null,
      blob_saved: !!blobPath
    };

    filesDb.files[id] = fileRecord;
    incrementVersion();

    // Mirror to legacy tables for backwards compatibility
    if (mod === 'salary') {
      const key = name.toLowerCase();
      syncSalaryFiles[key] = {
        name: name,
        buf: buf,
        sheets: body.sheets || null,
        saved: fileRecord.created_at,
        uploaded_by: fileRecord.uploaded_by
      };
      delete syncSalaryTombstones[key];
      writeJsonFile('salary_files.json', syncSalaryFiles);
      writeJsonFile('salary_tombstones.json', syncSalaryTombstones);
      broadcastEvent('salary_file_saved', { name: name, saved: fileRecord.created_at, uploaded_by: fileRecord.uploaded_by });
    } else if (mod === 'hr_doc') {
      const key = String(id).toLowerCase();
      const hrDocItem = Object.assign({ id: id, document_name: name }, body.meta || {});
      syncHrDocs[key] = hrDocItem;
      delete syncHrTombstones[key];
      writeJsonFile('hr_docs.json', syncHrDocs);
      writeJsonFile('hr_tombstones.json', syncHrTombstones);
      broadcastEvent('hr_doc_saved', hrDocItem);
    } else if (mod === 'pf' || mod === 'esic') {
      syncDolRecords[id] = fileRecord;
      writeJsonFile('dol_records.json', syncDolRecords);
      broadcastEvent('dol_record_saved', fileRecord);
    }

    writeJsonFile('files_db.json', filesDb);

    // Broadcast unified event to all connected browsers
    broadcastEvent('file_saved', fileRecord);

    return res.status(201).json({
      ok: true,
      saved: true,
      file: fileRecord,
      version: filesDb.version
    });
  } catch (err) {
    console.error('[Sync-Store] File save error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Bulk Upload Endpoint (Safe Queue & Concurrency Protected) ──
app.post('/api/sync/files/bulk', (req, res) => {
  try {
    const { files: fileList, module: defaultMod } = req.body || {};
    if (!Array.isArray(fileList) || !fileList.length) {
      return res.status(400).json({ ok: false, error: 'Files array required' });
    }

    const savedFiles = [];
    const errors = [];
    const now = new Date().toISOString();

    for (const body of fileList) {
      try {
        const name = String(body.name || '').trim();
        if (!name) continue;

        const mod = String(body.module || defaultMod || 'salary').toLowerCase();
        const id = String(body.id || ('file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)));
        const buf = body.buf || null;
        const sha256 = body.sha256_hash || (buf ? hashData(buf) : hashData(name));

        // Skip tombstoned records
        const tomb = filesDb.tombstones[id] || filesDb.tombstones[name.toLowerCase()];
        if (tomb && tomb.deleted_at && Date.parse(tomb.deleted_at) >= (body.created_at ? Date.parse(body.created_at) : Date.now())) {
          errors.push({ name, error: 'File was permanently deleted.' });
          continue;
        }

        // Deduplication
        if (sha256) {
          const existing = Object.values(filesDb.files).find(f => f.module === mod && f.sha256_hash === sha256);
          if (existing) {
            savedFiles.push(existing);
            continue;
          }
        }

        // Save blob
        let blobPath = null;
        if (buf && typeof buf === 'string') {
          try {
            const cleanBuf = buf.includes(',') ? buf.split(',')[1] : buf;
            const bin = Buffer.from(cleanBuf, 'base64');
            blobPath = path.join(BLOBS_DIR, `${id}.bin`);
            fs.writeFileSync(blobPath, bin);
          } catch (_) {}
        }

        const record = {
          id: id,
          module: mod,
          category: body.category || 'general',
          name: name,
          mime_type: body.mime_type || 'application/octet-stream',
          size: Number(body.size || (buf ? buf.length : 0)),
          sha256_hash: sha256,
          period: body.period || '',
          periodSource: body.periodSource || '',
          uploaded_by: body.uploaded_by || 'admin',
          created_at: body.created_at || now,
          updated_at: now,
          meta: body.meta || {},
          buf: buf,
          sheets: body.sheets || null,
          blob_saved: !!blobPath
        };

        filesDb.files[id] = record;
        savedFiles.push(record);

        // Mirror to legacy tables
        if (mod === 'salary') {
          syncSalaryFiles[name.toLowerCase()] = {
            name: name,
            buf: buf,
            sheets: body.sheets || null,
            saved: record.created_at,
            uploaded_by: record.uploaded_by
          };
          delete syncSalaryTombstones[name.toLowerCase()];
        } else if (mod === 'hr_doc') {
          syncHrDocs[String(id).toLowerCase()] = Object.assign({ id: id, document_name: name }, body.meta || {});
          delete syncHrTombstones[String(id).toLowerCase()];
        } else if (mod === 'pf' || mod === 'esic') {
          syncDolRecords[id] = record;
        }
      } catch (e) {
        errors.push({ name: body.name, error: e.message });
      }
    }

    incrementVersion();
    writeJsonFile('files_db.json', filesDb);
    writeJsonFile('salary_files.json', syncSalaryFiles);
    writeJsonFile('salary_tombstones.json', syncSalaryTombstones);
    writeJsonFile('hr_docs.json', syncHrDocs);
    writeJsonFile('hr_tombstones.json', syncHrTombstones);
    writeJsonFile('dol_records.json', syncDolRecords);

    // Real-time broadcast
    broadcastEvent('files_bulk_saved', {
      count: savedFiles.length,
      files: savedFiles,
      version: filesDb.version
    });

    return res.json({
      ok: true,
      saved: true,
      total: fileList.length,
      saved_count: savedFiles.length,
      files: savedFiles,
      errors: errors,
      version: filesDb.version
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Permanent Delete File (Single Source of Truth, No Resurrection) ──
app.delete('/api/sync/files/:id', (req, res) => {
  try {
    const rawId = decodeURIComponent(req.params.id || '');
    if (!rawId) return res.status(400).json({ ok: false, error: 'File ID or name required' });

    const mod = req.query.module ? String(req.query.module).toLowerCase() : null;
    const now = new Date().toISOString();

    // Look up file by exact ID, or by name match
    let matchId = null;
    let matchFile = filesDb.files[rawId];

    if (matchFile) {
      matchId = rawId;
    } else {
      const targetName = rawId.toLowerCase();
      for (const [fid, f] of Object.entries(filesDb.files)) {
        if (f.name.toLowerCase() === targetName && (!mod || f.module === mod)) {
          matchId = fid;
          matchFile = f;
          break;
        }
      }
    }

    const fileName = matchFile ? matchFile.name : rawId;
    const fileMod = matchFile ? matchFile.module : (mod || 'salary');
    const fileHash = matchFile ? matchFile.sha256_hash : '';

    // Record permanent tombstone in central database
    const tombstoneRecord = {
      id: matchId || rawId,
      name: fileName,
      module: fileMod,
      sha256_hash: fileHash,
      deleted_at: now,
      deleted_by: req.query.user || 'admin'
    };

    filesDb.tombstones[matchId || rawId] = tombstoneRecord;
    filesDb.tombstones[fileName.toLowerCase()] = tombstoneRecord;
    if (fileHash) filesDb.tombstones[fileHash] = tombstoneRecord;

    // Delete record from files list
    if (matchId) {
      delete filesDb.files[matchId];
    } else {
      delete filesDb.files[rawId];
    }

    // Delete disk blob if present
    try {
      const blobPath = path.join(BLOBS_DIR, `${matchId || rawId}.bin`);
      if (fs.existsSync(blobPath)) fs.unlinkSync(blobPath);
    } catch (_) {}

    incrementVersion();
    writeJsonFile('files_db.json', filesDb);

    // Mirror deletion to legacy tables
    const nameKey = fileName.toLowerCase();
    delete syncSalaryFiles[nameKey];
    syncSalaryTombstones[nameKey] = { name: fileName, deleted_at: now, deleted_by: req.query.user || 'admin' };
    writeJsonFile('salary_files.json', syncSalaryFiles);
    writeJsonFile('salary_tombstones.json', syncSalaryTombstones);

    const idKey = (matchId || rawId).toLowerCase();
    delete syncHrDocs[idKey];
    syncHrTombstones[idKey] = { id: matchId || rawId, deleted_at: now };
    writeJsonFile('hr_docs.json', syncHrDocs);
    writeJsonFile('hr_tombstones.json', syncHrTombstones);

    delete syncDolRecords[matchId || rawId];
    writeJsonFile('dol_records.json', syncDolRecords);

    // Broadcast real-time deletion event to all connected browsers
    broadcastEvent('file_deleted', {
      id: matchId || rawId,
      name: fileName,
      module: fileMod,
      sha256_hash: fileHash,
      deleted_at: now,
      version: filesDb.version
    });

    // Also fire legacy SSE events for legacy listeners
    if (fileMod === 'salary') {
      broadcastEvent('salary_file_deleted', { name: fileName, deleted_at: now });
    } else if (fileMod === 'hr_doc') {
      broadcastEvent('hr_doc_deleted', { id: matchId || rawId, deleted_at: now });
    } else if (fileMod === 'pf' || fileMod === 'esic') {
      broadcastEvent('dol_record_deleted', { id: matchId || rawId, deleted_at: now });
    }

    return res.json({
      ok: true,
      deleted: true,
      id: matchId || rawId,
      name: fileName,
      module: fileMod,
      version: filesDb.version
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Download File Content (Blob / Binary) ──
app.get('/api/sync/files/:id/content', (req, res) => {
  try {
    const rawId = decodeURIComponent(req.params.id || '');
    let file = filesDb.files[rawId];
    if (!file) {
      const lower = rawId.toLowerCase();
      file = Object.values(filesDb.files).find(f => f.name.toLowerCase() === lower);
    }

    if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

    // Check disk blob first
    const blobPath = path.join(BLOBS_DIR, `${file.id}.bin`);
    if (fs.existsSync(blobPath)) {
      res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
      return fs.createReadStream(blobPath).pipe(res);
    }

    // Fallback to in-memory Base64
    if (file.buf) {
      const clean = file.buf.includes(',') ? file.buf.split(',')[1] : file.buf;
      const bin = Buffer.from(clean, 'base64');
      res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
      return res.send(bin);
    }

    return res.status(404).json({ ok: false, error: 'File payload unavailable' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Clear All Files in a Module ──
app.post('/api/sync/files/clear-module', (req, res) => {
  try {
    const mod = String(req.body.module || 'salary').toLowerCase();
    const now = new Date().toISOString();

    for (const [fid, f] of Object.entries(filesDb.files)) {
      if (f.module === mod) {
        filesDb.tombstones[fid] = { id: fid, name: f.name, module: mod, deleted_at: now, deleted_by: 'admin' };
        filesDb.tombstones[f.name.toLowerCase()] = { id: fid, name: f.name, module: mod, deleted_at: now, deleted_by: 'admin' };
        delete filesDb.files[fid];
        try {
          const blobPath = path.join(BLOBS_DIR, `${fid}.bin`);
          if (fs.existsSync(blobPath)) fs.unlinkSync(blobPath);
        } catch (_) {}
      }
    }

    if (mod === 'salary') {
      Object.keys(syncSalaryFiles).forEach(k => {
        syncSalaryTombstones[k] = { name: syncSalaryFiles[k].name, deleted_at: now, deleted_by: 'admin' };
      });
      syncSalaryFiles = {};
      writeJsonFile('salary_files.json', syncSalaryFiles);
      writeJsonFile('salary_tombstones.json', syncSalaryTombstones);
      broadcastEvent('salary_clear_all', { cleared_at: now });
    }

    incrementVersion();
    writeJsonFile('files_db.json', filesDb);

    broadcastEvent('module_cleared', { module: mod, cleared_at: now, version: filesDb.version });
    return res.json({ ok: true, cleared: true, module: mod, version: filesDb.version });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// LEGACY COMPATIBILITY ENDPOINTS (KEEP EXISTING REGRESSION TESTS GREEN)
// ═══════════════════════════════════════════════════════════════

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

  const allFiles = Object.values(filesDb.files);
  const formattedFiles = isSummary
    ? allFiles.map(f => {
        const copy = Object.assign({}, f);
        delete copy.buf;
        return copy;
      })
    : allFiles;

  return res.json({
    ok: true,
    version: filesDb.version,
    salary_files: salaryFiles,
    salary_files_count: Object.keys(syncSalaryFiles).length,
    salary_tombstones: syncSalaryTombstones,
    hr_docs: Object.values(syncHrDocs),
    hr_tombstones: syncHrTombstones,
    dol_records: Object.values(syncDolRecords),
    files: formattedFiles,
    files_count: allFiles.length,
    tombstones: filesDb.tombstones,
    employee_master: syncEmployeeMaster
  });
});

// ── Salary File Upload / Save (Legacy Route) ──
app.post('/api/sync/salary-file', (req, res) => {
  try {
    const { name, buf, sheets, saved, uploaded_by } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: 'File name required' });

    const key = String(name).toLowerCase();
    const now = saved || new Date().toISOString();

    // Check tombstone: if deleted and not newer, reject resurrection
    const tomb = syncSalaryTombstones[key] || filesDb.tombstones[key];
    if (tomb && tomb.deleted_at && Date.parse(tomb.deleted_at) >= Date.parse(now)) {
      return res.status(409).json({ ok: false, error: 'File was permanently deleted.' });
    }

    const item = {
      name: String(name),
      buf: buf || null,
      sheets: sheets || null,
      saved: now,
      uploaded_by: uploaded_by || 'user'
    };

    syncSalaryFiles[key] = item;
    delete syncSalaryTombstones[key];
    delete filesDb.tombstones[key];

    // Also register in unified filesDb
    const id = 'sal_' + hashData(name).substring(0, 16);
    filesDb.files[id] = {
      id: id,
      module: 'salary',
      category: 'audit',
      name: name,
      size: buf ? buf.length : 0,
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sha256_hash: buf ? hashData(buf) : hashData(name),
      buf: buf,
      sheets: sheets || null,
      saved: now,
      uploaded_by: uploaded_by || 'user',
      created_at: now,
      updated_at: now
    };

    incrementVersion();
    writeJsonFile('salary_files.json', syncSalaryFiles);
    writeJsonFile('salary_tombstones.json', syncSalaryTombstones);
    writeJsonFile('files_db.json', filesDb);

    broadcastEvent('salary_file_saved', {
      name: item.name,
      saved: item.saved,
      uploaded_by: item.uploaded_by
    });
    broadcastEvent('file_saved', filesDb.files[id]);

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
        const tomb = syncSalaryTombstones[key] || filesDb.tombstones[key];
        const tombTime = tomb && tomb.deleted_at ? Date.parse(tomb.deleted_at) : 0;
        const fTime = f.saved ? Date.parse(f.saved) : 0;

        // CRITICAL ANTI-RESURRECTION: If tombstone exists and is newer or equal, DO NOT RESTORE
        if (tombTime && tombTime >= fTime) continue;

        // If server already has file with buf and newer timestamp, skip
        const existing = syncSalaryFiles[key];
        if (existing && existing.buf && Date.parse(existing.saved || 0) >= fTime) continue;

        const item = {
          name: String(f.name),
          buf: f.buf || null,
          sheets: f.sheets || null,
          saved: f.saved || new Date().toISOString(),
          uploaded_by: f.uploaded_by || 'reconcile'
        };
        syncSalaryFiles[key] = item;
        delete syncSalaryTombstones[key];

        const id = 'sal_' + hashData(f.name).substring(0, 16);
        filesDb.files[id] = {
          id: id,
          module: 'salary',
          category: 'audit',
          name: f.name,
          size: f.buf ? f.buf.length : 0,
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sha256_hash: f.buf ? hashData(f.buf) : hashData(f.name),
          buf: f.buf || null,
          sheets: f.sheets || null,
          saved: item.saved,
          uploaded_by: item.uploaded_by,
          created_at: item.saved,
          updated_at: item.saved
        };

        newlySaved++;
        broadcastEvent('salary_file_saved', {
          name: item.name,
          saved: item.saved,
          uploaded_by: item.uploaded_by
        });
      }

      if (newlySaved > 0) {
        incrementVersion();
        writeJsonFile('salary_files.json', syncSalaryFiles);
        writeJsonFile('salary_tombstones.json', syncSalaryTombstones);
        writeJsonFile('files_db.json', filesDb);
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

// ── Salary File Delete (Legacy Route) ──
app.delete('/api/sync/salary-file/:name', (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    if (!name) return res.status(400).json({ ok: false, error: 'Name required' });

    const key = name.toLowerCase();
    delete syncSalaryFiles[key];
    const now = new Date().toISOString();
    syncSalaryTombstones[key] = { name: name, deleted_at: now, deleted_by: req.query.user || 'user' };

    // Also remove from unified filesDb
    filesDb.tombstones[key] = { id: key, name: name, module: 'salary', deleted_at: now, deleted_by: req.query.user || 'user' };
    for (const [fid, f] of Object.entries(filesDb.files)) {
      if (f.name.toLowerCase() === key && f.module === 'salary') {
        filesDb.tombstones[fid] = { id: fid, name: name, module: 'salary', deleted_at: now, deleted_by: req.query.user || 'user' };
        delete filesDb.files[fid];
      }
    }

    incrementVersion();
    writeJsonFile('salary_files.json', syncSalaryFiles);
    writeJsonFile('salary_tombstones.json', syncSalaryTombstones);
    writeJsonFile('files_db.json', filesDb);

    broadcastEvent('salary_file_deleted', { name: name, deleted_at: now });
    broadcastEvent('file_deleted', { id: key, name: name, module: 'salary', deleted_at: now, version: filesDb.version });
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
      filesDb.tombstones[k] = { id: k, name: syncSalaryFiles[k].name, module: 'salary', deleted_at: now, deleted_by: 'user' };
    });
    syncSalaryFiles = {};

    for (const [fid, f] of Object.entries(filesDb.files)) {
      if (f.module === 'salary') {
        filesDb.tombstones[fid] = { id: fid, name: f.name, module: 'salary', deleted_at: now, deleted_by: 'user' };
        delete filesDb.files[fid];
      }
    }

    incrementVersion();
    writeJsonFile('salary_files.json', syncSalaryFiles);
    writeJsonFile('salary_tombstones.json', syncSalaryTombstones);
    writeJsonFile('files_db.json', filesDb);

    broadcastEvent('salary_clear_all', { cleared_at: now });
    broadcastEvent('module_cleared', { module: 'salary', cleared_at: now, version: filesDb.version });
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
    delete filesDb.tombstones[key];
    delete filesDb.tombstones[doc.id];

    // Mirror to unified filesDb
    filesDb.files[doc.id] = {
      id: doc.id,
      module: 'hr_doc',
      category: doc.doc_type || 'HR Policy',
      name: doc.file_name || doc.document_name || doc.id,
      size: doc.file_data ? doc.file_data.length : 0,
      mime_type: doc.file_type || 'application/pdf',
      sha256_hash: doc.file_data ? hashData(doc.file_data) : hashData(doc.id),
      meta: doc,
      created_at: doc.updated_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    incrementVersion();
    writeJsonFile('hr_docs.json', syncHrDocs);
    writeJsonFile('hr_tombstones.json', syncHrTombstones);
    writeJsonFile('files_db.json', filesDb);

    broadcastEvent('hr_doc_saved', doc);
    broadcastEvent('file_saved', filesDb.files[doc.id]);
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

    // Mirror to unified filesDb
    filesDb.tombstones[id] = { id: id, name: id, module: 'hr_doc', deleted_at: now };
    filesDb.tombstones[key] = { id: id, name: id, module: 'hr_doc', deleted_at: now };
    delete filesDb.files[id];

    incrementVersion();
    writeJsonFile('hr_docs.json', syncHrDocs);
    writeJsonFile('hr_tombstones.json', syncHrTombstones);
    writeJsonFile('files_db.json', filesDb);

    broadcastEvent('hr_doc_deleted', { id: id, deleted_at: now });
    broadcastEvent('file_deleted', { id: id, name: id, module: 'hr_doc', deleted_at: now, version: filesDb.version });
    return res.json({ ok: true, deleted: true, id });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DOL PF/ESIC Dedicated Records ──
app.get('/api/sync/dol-records', (req, res) => {
  const type = String(req.query.type || '').toLowerCase();
  let records = Object.values(syncDolRecords);
  if (type) {
    records = records.filter(r => r.module === type || (r.meta && r.meta.type === type));
  }
  return res.json({ ok: true, records });
});

app.post('/api/sync/dol-record', (req, res) => {
  try {
    const record = req.body || {};
    if (!record || !record.id) return res.status(400).json({ ok: false, error: 'Record ID required' });
    syncDolRecords[record.id] = record;
    writeJsonFile('dol_records.json', syncDolRecords);
    broadcastEvent('dol_record_saved', record);
    return res.json({ ok: true, saved: true, id: record.id });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/sync/dol-record/:id', (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id || '');
    delete syncDolRecords[id];
    writeJsonFile('dol_records.json', syncDolRecords);
    broadcastEvent('dol_record_deleted', { id: id, deleted_at: new Date().toISOString() });
    return res.json({ ok: true, deleted: true, id });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Native DOL API Endpoint (/functions/v1/dol-api) ──
app.all('/functions/v1/dol-api', (req, res) => {
  try {
    const p = Object.assign({}, req.query || {}, req.body || {});
    const action = String(p.action || '').toLowerCase();
    const type = String(p.type || '').toLowerCase();

    if (action === 'list') {
      const records = Object.values(filesDb.files)
        .filter(f => f.module === type || (f.meta && f.meta.type === type))
        .map(f => ({
          id: f.id,
          challan_type: f.module || type,
          file_name: f.name,
          file_size: f.size,
          file_hash: f.sha256_hash,
          period: f.period || (f.meta && f.meta.period) || '',
          period_source: f.periodSource || 'manual',
          uploaded_by: f.uploaded_by || 'admin',
          created_at: f.created_at,
          updated_at: f.updated_at,
          file_path: `/api/sync/files/${f.id}/content`,
          member_ids: (f.meta && f.meta.ids) || (f.meta && f.meta.digitIds) || [],
          contributions: (f.meta && f.meta.contributions) || []
        }));
      return res.json({ ok: true, records });
    }

    if (action === 'check') {
      const hash = String(p.file_hash || '').toLowerCase();
      const existing = Object.values(filesDb.files).find(f => (f.module === type || (f.meta && f.meta.type === type)) && f.sha256_hash === hash);
      const tomb = filesDb.tombstones[hash];
      return res.json({ ok: true, duplicate: !!existing, deleted: !!tomb, record: existing || null });
    }

    if (action === 'upload') {
      const id = 'dol_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      const name = String(p.file_name || p.name || 'Challan.pdf');
      const hash = String(p.file_hash || hashData(name)).toLowerCase();
      const period = String(p.period || '');
      const now = new Date().toISOString();

      let memberIds = [];
      try { memberIds = JSON.parse(p.member_ids || '[]'); } catch (_) {}
      let contribs = [];
      try { contribs = JSON.parse(p.contributions || '[]'); } catch (_) {}

      const fileRecord = {
        id: id,
        module: type,
        category: 'challan',
        name: name,
        mime_type: p.mime_type || 'application/pdf',
        size: Number(p.file_size || 0),
        sha256_hash: hash,
        period: period,
        periodSource: 'manual',
        uploaded_by: p.uploaded_by || 'admin',
        created_at: now,
        updated_at: now,
        meta: {
          type: type,
          ids: memberIds,
          contributions: contribs,
          period: period
        }
      };

      filesDb.files[id] = fileRecord;
      syncDolRecords[id] = fileRecord;
      incrementVersion();
      writeJsonFile('files_db.json', filesDb);
      writeJsonFile('dol_records.json', syncDolRecords);

      broadcastEvent('file_saved', fileRecord);
      broadcastEvent('dol_record_saved', fileRecord);

      return res.json({
        ok: true,
        record: {
          id: id,
          challan_type: type,
          file_name: name,
          file_size: fileRecord.size,
          file_hash: hash,
          period: period,
          file_path: `/api/sync/files/${id}/content`,
          member_ids: memberIds,
          contributions: contribs
        }
      });
    }

    if (action === 'delete') {
      const id = String(p.id || '');
      const match = filesDb.files[id] || Object.values(filesDb.files).find(f => f.id === id || f.name.toLowerCase() === id.toLowerCase());
      const recId = match ? match.id : id;
      const recName = match ? match.name : id;
      const now = new Date().toISOString();

      filesDb.tombstones[recId] = { id: recId, name: recName, module: type, deleted_at: now };
      filesDb.tombstones[recName.toLowerCase()] = { id: recId, name: recName, module: type, deleted_at: now };
      delete filesDb.files[recId];
      delete syncDolRecords[recId];

      incrementVersion();
      writeJsonFile('files_db.json', filesDb);
      writeJsonFile('dol_records.json', syncDolRecords);

      broadcastEvent('file_deleted', { id: recId, name: recName, module: type, deleted_at: now, version: filesDb.version });
      broadcastEvent('dol_record_deleted', { id: recId, deleted_at: now });

      return res.json({ ok: true, deleted: true, id: recId });
    }

    if (action === 'file') {
      const id = String(p.id || '');
      return res.json({ ok: true, url: `/api/sync/files/${encodeURIComponent(id)}/content` });
    }

    if (action === 'updateperiod') {
      const id = String(p.id || '');
      const match = filesDb.files[id];
      if (match) {
        match.period = String(p.period || '');
        if (match.meta) match.meta.period = match.period;
        match.updated_at = new Date().toISOString();
        writeJsonFile('files_db.json', filesDb);
      }
      return res.json({ ok: true, record: match || {} });
    }

    return res.json({ ok: true, message: 'Action processed' });
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
