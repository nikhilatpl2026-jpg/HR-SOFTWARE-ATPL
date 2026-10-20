'use strict';
// Isolated Cloud SQL implementation. NEVER auto-enables in production.
const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}
function hashPayload(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function getPool() {
  if (!process.env.PGDATABASE && !process.env.DATABASE_URL) {
    throw new Error('PGDATABASE or DATABASE_URL required for PostgreSQL mode');
  }
  return new Pool({
    ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
      host: process.env.PGHOST || process.env.INSTANCE_UNIX_SOCKET,
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD
    }),
    max: Number(process.env.PG_MAX_CONNECTIONS || 5),
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000
  });
}
function secureEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function documentFromRow(row, includeContent) {
  const doc = Object.assign({}, row.metadata || {}, {
    id: row.id, module: row.module, name: row.name,
    sha256_hash: row.sha256_hash,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString()
  });
  if (includeContent && row.payload) doc.buf = row.payload.toString('base64');
  else delete doc.buf;
  return doc;
}
function tombKeys(mod, id, name, hash) {
  return [id, name, hash].filter(Boolean).map(function(x) {
    return normalize(mod) + ':' + normalize(x);
  });
}
function fail(res, err) {
  if (err && err.code === '23505') return res.status(409).json({ ok:false, error:'Duplicate file identifier or hash' });
  console.error('[PG Sync]', err && err.message);
  return res.status(500).json({ ok:false, error:'DATABASE_OPERATION_FAILED' });
}
async function emitEvent(client, type, data) {
  const result = await client.query(
    'INSERT INTO atpl_events(type,data) VALUES($1,$2::jsonb) RETURNING id',
    [type, JSON.stringify(data || {})]
  );
  return String(result.rows[0].id);
}
async function readVersion(pool) {
  const result = await pool.query('SELECT COALESCE(MAX(id),0)::text AS version FROM atpl_events');
  return Number(result.rows[0].version || 0);
}
async function listFiles(pool, mod, category, includeContent) {
  const result = await pool.query(
    'SELECT * FROM atpl_files WHERE ($1::text IS NULL OR module = $1) ORDER BY created_at DESC',
    [mod && mod !== 'all' ? normalize(mod) : null]
  );
  return result.rows.map(r => documentFromRow(r, includeContent)).filter(f => !category || f.category === category);
}
async function readTombstones(pool) {
  const out = {};
  const rows = (await pool.query('SELECT * FROM atpl_tombstones')).rows;
  rows.forEach(t => {
    const item = { id:t.file_id, name:t.name, module:t.module,
      sha256_hash:t.sha256_hash, deleted_at:new Date(t.deleted_at).toISOString(), deleted_by:t.deleted_by };
    const rawKey = t.key.slice(t.module.length + 1);
    out[rawKey] = item;
  });
  return out;
}
async function saveFile(pool, input, user) {
  const body = input || {};
  const moduleName = normalize(body.module || 'salary');
  const name = String(body.name || body.file_name || '').trim();
  const id = String(body.id || crypto.randomUUID()).trim();
  if (!moduleName || !/^[a-z0-9_-]{1,32}$/.test(moduleName)) return {status:400, body:{ok:false,error:'Invalid module'}};
  if (!name || name.length > 240 || !id || id.length > 240) return {status:400, body:{ok:false,error:'Invalid file name or ID'}};
  const base64 = body.buf || body.original_b64 || body.file_data || '';
  let payload = null;
  if (base64) {
    if (typeof base64 !== 'string') return {status:400,body:{ok:false,error:'File content must be base64'}};
    const raw = base64.includes('base64,') ? base64.split('base64,').pop() : base64;
    if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(raw)) return {status:400,body:{ok:false,error:'Invalid base64'}};
    payload = Buffer.from(raw, 'base64');
    if (payload.length > 20 * 1024 * 1024) return {status:413,body:{ok:false,error:'File exceeds 20MB PostgreSQL staging limit; use private Cloud Storage for large files'}};
  }
  const hash = payload ? hashPayload(payload) : normalize(body.sha256_hash || '');
  if (hash && !/^[0-9a-f]{64}$/.test(hash)) return {status:400,body:{ok:false,error:'Invalid SHA-256 hash'}};
  if (payload && body.sha256_hash && /^[0-9a-f]{64}$/i.test(body.sha256_hash) &&
      normalize(body.sha256_hash) !== hash) {
    return {status:400,body:{ok:false,error:'SHA-256 does not match uploaded bytes'}};
  }
  const metadata = Object.assign({}, body, {
    id, name, module:moduleName, sha256_hash:hash,
    uploaded_by:String(user || 'verified-user')
  });
  delete metadata.buf;
  delete metadata.original_b64;
  delete metadata.file_data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize edits to the same module/name across multiple Cloud Run instances.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [moduleName + ':' + normalize(name)]);
    const keys = tombKeys(moduleName,id,name,hash);
    const tomb = (await client.query('SELECT key FROM atpl_tombstones WHERE key = ANY($1::text[]) LIMIT 1', [keys])).rows[0];
    if (tomb) {
      await client.query('ROLLBACK');
      return {status:409,body:{ok:false,error:'FILE_PERMANENTLY_DELETED',message:'Deleted file cannot be restored from stale browser data'}};
    }
    if (hash) {
      const old = (await client.query('SELECT * FROM atpl_files WHERE module=$1 AND sha256_hash=$2 LIMIT 1',
        [moduleName,hash])).rows[0];
      if (old && old.id !== id) {
        await client.query('COMMIT');
        return {status:200,body:{ok:true,saved:true,duplicate:true,file:documentFromRow(old,false)}};
      }
    }
    await client.query(
      'INSERT INTO atpl_files(id,module,name,sha256_hash,metadata,payload) ' +
      'VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(id) DO UPDATE SET ' +
      'module=EXCLUDED.module,name=EXCLUDED.name,sha256_hash=EXCLUDED.sha256_hash,' +
      'metadata=EXCLUDED.metadata,payload=COALESCE(EXCLUDED.payload,atpl_files.payload),updated_at=now()',
      [id,moduleName,name,hash,JSON.stringify(metadata),payload]
    );
    const evt = await emitEvent(client,'file_saved',{id,module:moduleName,name,sha256_hash:hash});
    const row = (await client.query('SELECT * FROM atpl_files WHERE id=$1',[id])).rows[0];
    await client.query('COMMIT');
    return {status:201,body:{ok:true,saved:true,version:Number(evt),file:documentFromRow(row,false)}};
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
async function deleteFile(pool, idOrName, mod, user) {
  const target = normalize(idOrName);
  const moduleName = normalize(mod || '');
  if (!target) return {status:400,body:{ok:false,error:'Missing file ID or name'}};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A transaction lock prevents concurrent re-adds of the same name.
    const first = (await client.query(
      'SELECT * FROM atpl_files WHERE (lower(id)=$1 OR lower(name)=$1) AND ($2::text = \'\' OR module=$2) FOR UPDATE',
      [target,moduleName]
    )).rows;
    if (!first.length) {
      // Unknown records must still be tombstoned to reject delayed restores.
      if (!moduleName) {
        await client.query('ROLLBACK');
        return {status:404,body:{ok:false,error:'File not found; specify module for missing file tombstone'}};
      }
      await client.query(
        'INSERT INTO atpl_tombstones(key,file_id,module,name,deleted_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(key) DO NOTHING',
        [moduleName + ':' + target, String(idOrName), moduleName, String(idOrName), user]
      );
      const evt = await emitEvent(client,'file_deleted',{id:idOrName,name:idOrName,module:moduleName});
      await client.query('COMMIT');
      return {status:200,body:{ok:true,deleted:true,version:Number(evt),id:idOrName}};
    }
    let lastEvent = 0;
    for (const file of first) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[file.module + ':' + normalize(file.name)]);
      const keys = tombKeys(file.module,file.id,file.name,file.sha256_hash);
      for (const key of keys) {
        await client.query(
          'INSERT INTO atpl_tombstones(key,file_id,module,name,sha256_hash,deleted_by) ' +
          'VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(key) DO NOTHING',
          [key,file.id,file.module,file.name,file.sha256_hash,user]
        );
      }
      await client.query('DELETE FROM atpl_files WHERE id=$1',[file.id]);
      lastEvent = Number(await emitEvent(client,'file_deleted',{id:file.id,name:file.name,module:file.module,deleted_at:new Date().toISOString()}));
    }
    await client.query('COMMIT');
    return {status:200,body:{ok:true,deleted:true,version:lastEvent,id:idOrName,count:first.length}};
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
function createPostgresSyncRouter(pool) {
  const router = express.Router();
  const configuredToken = String(process.env.ATPL_SYNC_BEARER || '');
  router.use((req,res,next) => {
    res.set('Cache-Control','no-store');
    if (req.path === '/health' && req.method === 'GET') return next();
    if (configuredToken.length < 32) return res.status(503).json({ok:false,error:'SERVER_AUTH_NOT_CONFIGURED'});
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
    if (!secureEqual(supplied,configuredToken)) return res.status(401).json({ok:false,error:'UNAUTHORIZED'});
    next();
  });
  router.get('/health',async(req,res) => {
    try {
      await pool.query('SELECT 1');
      return res.json({ok:true,backend:'PostgreSQL Cloud SQL',status:'healthy'});
    } catch(e) { return res.status(503).json({ok:false,status:'database-unavailable'}); }
  });
  router.get('/files',async(req,res) => {
    try {
      const files = await listFiles(pool,req.query.module,req.query.category,req.query.include_buf==='1');
      return res.json({ok:true,files,count:files.length,version:await readVersion(pool),tombstones:await readTombstones(pool)});
    } catch(e) { return fail(res,e); }
  });
  router.post('/files',async(req,res) => {
    try {
      const result = await saveFile(pool,req.body,'verified-user');
      return res.status(result.status).json(result.body);
    } catch(e) { return fail(res,e); }
  });
  router.delete('/files/:id',async(req,res) => {
    try {
      const result = await deleteFile(pool,req.params.id,req.query.module,'verified-user');
      return res.status(result.status).json(result.body);
    } catch(e) { return fail(res,e); }
  });
  router.get('/files/:id/content',async(req,res) => {
    try {
      const key = normalize(req.params.id);
      const result = await pool.query(
        'SELECT * FROM atpl_files WHERE lower(id)=$1 OR lower(name)=$1 LIMIT 1',[key]);
      if (!result.rows.length || !result.rows[0].payload) return res.status(404).json({ok:false,error:'File payload unavailable'});
      const file = result.rows[0];
      const meta = file.metadata || {};
      res.set('Content-Type',meta.mime_type || 'application/octet-stream');
      res.set('Content-Disposition','attachment; filename="' + encodeURIComponent(file.name) + '"');
      return res.send(file.payload);
    } catch(e) { return fail(res,e); }
  });
  router.get('/employee-master',async(req,res) => {
    try {
      const result = await pool.query('SELECT record FROM atpl_employees ORDER BY emp_id');
      return res.json({ok:true,records:result.rows.map(r => r.record)});
    } catch(e) { return fail(res,e); }
  });
  router.post('/employee-master',async(req,res) => {
    const records = Array.isArray(req.body) ? req.body : req.body && req.body.records;
    if (!Array.isArray(records)) return res.status(400).json({ok:false,error:'Records array required'});
    if (records.length > 10000) return res.status(413).json({ok:false,error:'Too many records'});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let saved = 0,blocked = 0;
      for (const rec of records) {
        if (!rec || typeof rec !== 'object') continue;
        const id = String(rec.emp_id || rec.id || '').toUpperCase().trim();
        if (!id || id.length > 128) continue;
        const clean = Object.fromEntries(Object.entries(rec).filter(([k,v]) => v !== null && v !== undefined && (typeof v !== 'string' || v.trim() !== '')));
        clean.emp_id = id;
        const result = await client.query(
          'INSERT INTO atpl_employees(emp_id,record) SELECT $1,$2::jsonb ' +
          'WHERE NOT EXISTS(SELECT 1 FROM atpl_employee_tombstones WHERE emp_id=$1) ' +
          'ON CONFLICT(emp_id) DO UPDATE SET record=atpl_employees.record || EXCLUDED.record,updated_at=now() ' +
          'RETURNING emp_id',[id,JSON.stringify(clean)]);
        if (result.rows.length) saved++; else blocked++;
      }
      if (saved) await emitEvent(client,'employee_master_updated',{count:saved});
      await client.query('COMMIT');
      return res.json({ok:true,saved:true,count:saved,blockedDeletedRecords:blocked});
    } catch(e) {await client.query('ROLLBACK').catch(()=>{}); return fail(res,e);}
    finally {client.release();}
  });
  router.delete('/employee-master/:id',async(req,res) => {
    const id = String(req.params.id || '').toUpperCase().trim();
    if (!id || id.length > 128) return res.status(400).json({ok:false,error:'Invalid employee id'});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO atpl_employee_tombstones(emp_id) VALUES($1) ON CONFLICT(emp_id) DO NOTHING',[id]);
      await client.query('DELETE FROM atpl_employees WHERE emp_id=$1',[id]);
      await emitEvent(client,'employee_master_deleted',{emp_id:id});
      await client.query('COMMIT');
      return res.json({ok:true,deleted:true,emp_id:id});
    } catch(e) {await client.query('ROLLBACK').catch(()=>{});return fail(res,e);}
    finally {client.release();}
  });
  router.get('/files-meta',async(req,res) => {
    try {
      const files = await listFiles(pool,null,null,false);
      return res.json({ok:true,files,count:files.length,version:await readVersion(pool)});
    } catch(e) {return fail(res,e);}
  });
  router.get('/hr-docs',async(req,res) => {
    try {
      const files = await listFiles(pool,'hr_doc',null,false);
      const docs = files.map(f => Object.assign({id:f.id,document_name:f.name},f.meta || {}));
      return res.json({ok:true,docs,count:docs.length,version:await readVersion(pool),tombstones:await readTombstones(pool)});
    } catch(e) {return fail(res,e);}
  });
  router.get('/dol-records',async(req,res) => {
    try {
      const files = await listFiles(pool,null,null,false);
      const records = files.filter(f => f.module === 'pf' || f.module === 'esic');
      return res.json({ok:true,records:req.query.type?records.filter(r=>r.module===normalize(req.query.type)):records});
    } catch(e) {return fail(res,e);}
  });
  router.get('/state',async(req,res) => {
    try {
      const files = await listFiles(pool,null,null,req.query.summary!=='1');
      const salary = files.filter(f=>f.module==='salary');
      const hrDocs = files.filter(f=>f.module==='hr_doc').map(f=>Object.assign({id:f.id},f.meta||{}));
      const dol = files.filter(f=>f.module==='pf'||f.module==='esic');
      const employees = (await pool.query('SELECT record FROM atpl_employees ORDER BY emp_id')).rows.map(r=>r.record);
      const tombstones = await readTombstones(pool);
      return res.json({ok:true,version:await readVersion(pool),
        salary_files:salary,salary_files_count:salary.length,salary_tombstones:tombstones,
        hr_docs:hrDocs,hr_tombstones:tombstones,dol_records:dol,
        files,files_count:files.length,tombstones,employee_master:employees});
    } catch(e) {return fail(res,e);}
  });
  router.get('/events',async(req,res) => {
    // Browser EventSource cannot send Authorization headers; a secure
    // short-lived per-user event-ticket flow must be added BEFORE cutover.
    try {
      const supplied = Number(req.headers['last-event-id'] || 0);
      let cursor = Number.isSafeInteger(supplied) && supplied > 0 ? supplied : await readVersion(pool);
      res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});
      res.flushHeaders();
      res.write('event: connected\ndata: ' + JSON.stringify({status:'connected',version:cursor}) + '\n\n');
      let busy = false;
      const tick = async () => {
        if (busy || res.destroyed) return;
        busy = true;
        try {
          const rows = (await pool.query('SELECT id,type,data FROM atpl_events WHERE id>$1 ORDER BY id LIMIT 100',[cursor])).rows;
          for (const e of rows) {
            cursor = Number(e.id);
            res.write('id: ' + cursor + '\nevent: ' + e.type + '\ndata: ' +
              JSON.stringify({type:e.type,data:e.data,version:cursor,timestamp:Date.now()}) + '\n\n');
          }
        } catch(e) {res.write(': database reconnect pending\n\n');}
        finally {busy = false;}
      };
      const every = setInterval(tick,2000);
      const heartbeat = setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},15000);
      req.on('close',()=>{clearInterval(every);clearInterval(heartbeat);});
    } catch(e) {return fail(res,e);}
  });
  // Never silently fall through to the non-durable legacy handlers when in PG mode.
  router.all('*',(req,res)=>res.status(501).json({ok:false,error:'PG_ROUTE_NOT_MIGRATED',route:req.path}));
  return router;
}
module.exports = {getPool,createPostgresSyncRouter,normalize,hashPayload,tombKeys,secureEqual};
