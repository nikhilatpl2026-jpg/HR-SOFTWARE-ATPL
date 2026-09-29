import * as pako from 'pako';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  deleteDoc, 
  onSnapshot 
} from 'firebase/firestore';

const cfg = {
  projectId: "durable-lane-wpqwl",
  appId: "1:351907813401:web:0ffc9e063a5e3d68873288",
  apiKey: "AIzaSyBcNFwmwns5bBU9Ej6ijzInukUzTbsLj38",
  authDomain: "durable-lane-wpqwl.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-atplhrpayrollsof-9b7066b0-5a4f-4039-be33-cca6d365933f",
  storageBucket: "durable-lane-wpqwl.firebasestorage.app",
  messagingSenderId: "351907813401",
  oAuthClientId: "351907813401-mq3636u4acgf14nfg0rrps5tej96nc5f.apps.googleusercontent.com"
};

let app = null;
let db = null;

export function initFirebase() {
  if (!app) {
    app = initializeApp(cfg);
    db = getFirestore(app, cfg.firestoreDatabaseId);
    console.log('[ATPL-Firebase] Initialized with database:', cfg.firestoreDatabaseId);
  }
  return { app, db };
}

export function safeKey(name) {
  return 'sf_' + encodeURIComponent(String(name || '').trim().toLowerCase())
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
}

function uint8ToBase64(u8) {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let bin = '';
  const len = u8.length;
  const step = 0x8000;
  for (let i = 0; i < len; i += step) {
    bin += String.fromCharCode.apply(null, Array.prototype.slice.call(u8, i, Math.min(i + step, len)));
  }
  return btoa(bin);
}

function base64ToUint8(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const len = bin.length;
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    u8[i] = bin.charCodeAt(i);
  }
  return u8;
}

const CHUNK_SIZE = 700000;

export async function saveSalaryFile(name, payload, meta) {
  const { db } = initFirebase();
  const key = safeKey(name);
  const docRef = doc(db, 'salary_files', key);
  const jsonStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const compressedBytes = pako.gzip(jsonStr);
  const b64 = uint8ToBase64(compressedBytes);
  const totalChunks = Math.ceil(b64.length / CHUNK_SIZE);
  if (totalChunks > 1) {
    for (let i = 0; i < totalChunks; i++) {
      const chunkStr = b64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const chunkRef = doc(db, 'salary_files', key, 'chunks', 'c_' + i);
      await setDoc(chunkRef, { index: i, data: chunkStr });
    }
  }
  const metaData = {
    name: String(name),
    is_gzip: true,
    chunks_count: totalChunks,
    b64_size: b64.length,
    sheets_b64: totalChunks === 1 ? b64 : '',
    sheets_count: Number(meta && meta.sheets_count || (payload && payload.sheets ? payload.sheets.length : 1)),
    rows_count: Number(meta && meta.rows_count || 0),
    uploaded_at: new Date().toISOString(),
    uploaded_by: String(meta && meta.uploaded_by || 'admin'),
    saved_at: String(meta && meta.saved_at || new Date().toISOString())
  };
  await setDoc(docRef, metaData);
  try {
    const tombRef = doc(db, 'salary_tombstones', key);
    await deleteDoc(tombRef);
  } catch (_) {}
  return true;
}

export async function decodeDocPayload(docData) {
  if (!docData) return null;
  if (docData.is_gzip && docData.chunks_count === 1 && docData.sheets_b64) {
    const bytes = base64ToUint8(docData.sheets_b64);
    const unzipped = pako.ungzip(bytes);
    const text = new TextDecoder().decode(unzipped);
    return JSON.parse(text);
  }
  if (docData.is_gzip && docData.chunks_count > 1) {
    const { db } = initFirebase();
    const key = safeKey(docData.name);
    let fullB64 = '';
    for (let i = 0; i < docData.chunks_count; i++) {
      const chunkSnap = await getDoc(doc(db, 'salary_files', key, 'chunks', 'c_' + i));
      if (chunkSnap.exists() && chunkSnap.data().data) {
        fullB64 += chunkSnap.data().data;
      }
    }
    const bytes = base64ToUint8(fullB64);
    const unzipped = pako.ungzip(bytes);
    const text = new TextDecoder().decode(unzipped);
    return JSON.parse(text);
  }
  if (docData.sheets) {
    return typeof docData.sheets === 'string' ? JSON.parse(docData.sheets) : docData.sheets;
  }
  return null;
}

export async function deleteSalaryFile(name, deletedBy) {
  const { db } = initFirebase();
  const key = safeKey(name);
  const docRef = doc(db, 'salary_files', key);
  const tombRef = doc(db, 'salary_tombstones', key);
  try {
    const docSnap = await getDoc(docRef);
    if (docSnap.exists() && docSnap.data().chunks_count > 1) {
      for (let i = 0; i < docSnap.data().chunks_count; i++) {
        await deleteDoc(doc(db, 'salary_files', key, 'chunks', 'c_' + i));
      }
    }
  } catch (_) {}
  await deleteDoc(docRef);
  await setDoc(tombRef, {
    name: String(name),
    deleted_at: new Date().toISOString(),
    deleted_by: String(deletedBy || 'admin')
  });
  return true;
}

export async function clearAllSalaryFiles(deletedBy) {
  const { db } = initFirebase();
  const all = await fetchAllSalaryFiles();
  for (const f of all) {
    if (f && f.name) {
      await deleteSalaryFile(f.name, deletedBy);
    }
  }
  try {
    const allTomb = doc(db, 'salary_tombstones', 'ts_all_cleared');
    await setDoc(allTomb, {
      name: '__ALL__',
      cleared_at: new Date().toISOString(),
      deleted_at: new Date().toISOString(),
      deleted_by: String(deletedBy || 'admin')
    });
  } catch (_) {}
  return true;
}

export async function fetchAllSalaryFiles() {
  const { db } = initFirebase();
  const snap = await getDocs(collection(db, 'salary_files'));
  const list = [];
  snap.forEach(d => {
    list.push(d.data());
  });
  return list;
}

export async function fetchAllTombstones() {
  const { db } = initFirebase();
  const snap = await getDocs(collection(db, 'salary_tombstones'));
  const list = [];
  snap.forEach(d => {
    list.push(d.data());
  });
  return list;
}

export function subscribeSalaryFiles(onUpdate, onError) {
  const { db } = initFirebase();
  return onSnapshot(collection(db, 'salary_files'), (snapshot) => {
    const all = [];
    const removedNames = [];
    snapshot.docChanges().forEach(change => {
      if (change.type === 'removed') {
        const d = change.doc.data();
        if (d && d.name) removedNames.push(d.name);
      }
    });
    snapshot.forEach(docSnap => {
      all.push(docSnap.data());
    });
    onUpdate({ all, removedNames, size: snapshot.size });
  }, (err) => {
    console.error('[ATPL-Firebase] Listener error:', err);
    if (onError) onError(err);
  });
}

export function subscribeTombstones(onTombstone, onError) {
  const { db } = initFirebase();
  return onSnapshot(collection(db, 'salary_tombstones'), (snapshot) => {
    const tombstones = [];
    snapshot.forEach(d => {
      tombstones.push(d.data());
    });
    onTombstone(tombstones);
  }, (err) => {
    if (onError) onError(err);
  });
}

// Attach to window for standard script usage
if (typeof window !== 'undefined') {
  window.ATPLFirebase = {
    init: initFirebase,
    saveSalaryFile,
    deleteSalaryFile,
    clearAllSalaryFiles,
    decodeDocPayload,
    fetchAllSalaryFiles,
    fetchAllTombstones,
    subscribeSalaryFiles,
    subscribeTombstones,
    safeKey
  };
}
