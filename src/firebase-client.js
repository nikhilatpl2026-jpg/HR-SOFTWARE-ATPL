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
  projectId: "gen-lang-client-0566788648",
  appId: "1:822862717290:web:3d3e3c2f71b17252e88513",
  apiKey: "AIzaSyCrsWUALc5vQUB157c4YIe9ikQ1xN6E6bU",
  authDomain: "gen-lang-client-0566788648.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-atplhrpayrollsof-bfdaada6-82cb-4b08-a9ad-1b189322946b",
  storageBucket: "gen-lang-client-0566788648.firebasestorage.app",
  messagingSenderId: "822862717290",
  oAuthClientId: "822862717290-4mg3asvv0po4vcbg3tcg4l6gnuu2s2gr.apps.googleusercontent.com"
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

  // Remove tombstone if it was previously tombstoned
  try {
    const tombRef = doc(db, 'salary_tombstones', key);
    await deleteDoc(tombRef);
  } catch (_) {}

  return true;
}

export async function decodeDocPayload(docData) {
  if (!docData) return null;
  // Case 1: single document compressed gzip
  if (docData.is_gzip && docData.chunks_count === 1 && docData.sheets_b64) {
    const bytes = base64ToUint8(docData.sheets_b64);
    const unzipped = pako.ungzip(bytes);
    const text = new TextDecoder().decode(unzipped);
    return JSON.parse(text);
  }
  // Case 2: multiple chunks in subcollection
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
  // Case 3: legacy uncompressed string/json
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

  // 1. Delete from active files
  await deleteDoc(docRef);

  // 2. Add to tombstones for immediate cross-device propagation
  await setDoc(tombRef, {
    name: String(name),
    deleted_at: new Date().toISOString(),
    deleted_by: String(deletedBy || 'admin')
  });

  return true;
}

export async function clearAllSalaryFiles(deletedBy) {
  const all = await fetchAllSalaryFiles();
  for (const f of all) {
    if (f && f.name) {
      await deleteSalaryFile(f.name, deletedBy);
    }
  }
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
