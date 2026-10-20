'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  normalize, hashPayload, tombKeys, secureEqual, createPostgresSyncRouter
} = require('../backend/gcp-postgres/postgres-sync-router');

test('SHA-256 uses binary bytes and is repeatable', () => {
  assert.equal(hashPayload(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('file deletion markers are normalized and module-scoped', () => {
  assert.deepEqual(tombKeys('salary','XYZ','September.XLSX','abcd'),[
    'salary:xyz','salary:september.xlsx','salary:abcd'
  ]);
  assert.equal(normalize(' PF '),'pf');
});
test('server bearer token comparison requires an exact match', () => {
  assert.equal(secureEqual('a'.repeat(32),'a'.repeat(32)),true);
  assert.equal(secureEqual('a'.repeat(32),'a'.repeat(31)+'b'),false);
  assert.equal(secureEqual('abc',''),false);
});
test('preview health check works, private routes reject unauthenticated users, unknown writes fail closed', async () => {
  process.env.ATPL_SYNC_BEARER='this-is-a-test-only-secret-with-32-chars';
  const mockPool = {
    query: async (sql) => {
      if (sql==='SELECT 1') return {rows:[{one:1}]};
      if (sql.includes('MAX(id)')) return {rows:[{version:'0'}]};
      if (sql.includes('FROM atpl_tombstones')) return {rows:[]};
      if (sql.includes('FROM atpl_files')) return {rows:[]};
      if (sql.includes('FROM atpl_employees')) return {rows:[]};
      throw new Error('Unexpected SQL query: '+sql);
    }
  };
  const app=express();
  app.use(express.json());
  app.use('/api/sync',createPostgresSyncRouter(mockPool));
  const server=app.listen(0,'127.0.0.1');
  try {
    await new Promise(resolve=>server.once('listening',resolve));
    const url='http://127.0.0.1:'+server.address().port;
    const unauth=await fetch(url+'/api/sync/files');
    assert.equal(unauth.status,401);
    const headers={Authorization:'Bearer '+process.env.ATPL_SYNC_BEARER};
    const healthy=await (await fetch(url+'/api/sync/health')).json();
    assert.equal(healthy.backend,'PostgreSQL Cloud SQL');
    const listed=await (await fetch(url+'/api/sync/files',{headers})).json();
    assert.equal(listed.count,0);
    const unknown=await fetch(url+'/api/sync/reconcile-salary-files',{method:'POST',headers});
    assert.equal(unknown.status,501);
    const blank=await fetch(url+'/api/sync/files',{
      method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({name:''})
    });
    assert.equal(blank.status,400);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    delete process.env.ATPL_SYNC_BEARER;
  }
});
