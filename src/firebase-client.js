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

function safeKey(name) {
  return 'sf_' + encodeURIComponent(String(name || '').trim().toLowerCase())
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
}

export async function saveSalaryFile(name, payload, meta) {
  const { db } = initFirebase();
  const key = safeKey(name);
  const docRef = doc(db, 'salary_files', key);
  const data = {
    name: String(name),
    sheets: typeof payload === 'string' ? payload : JSON.stringify(payload),
    sheets_count: Number(meta && meta.sheets_count || (payload && payload.sheets ? payload.sheets.length : 1)),
    rows_count: Number(meta && meta.rows_count || 0),
    uploaded_at: new Date().toISOString(),
    uploaded_by: String(meta && meta.uploaded_by || 'admin'),
    saved_at: String(meta && meta.saved_at || new Date().toISOString())
  };
  await setDoc(docRef, data);

  // Also remove from tombstones if it was previously tombstoned
  try {
    const tombRef = doc(db, 'salary_tombstones', key);
    await deleteDoc(tombRef);
  } catch (_) {}

  return true;
}

export async function deleteSalaryFile(name, deletedBy) {
  const { db } = initFirebase();
  const key = safeKey(name);
  const docRef = doc(db, 'salary_files', key);
  const tombRef = doc(db, 'salary_tombstones', key);

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
    fetchAllSalaryFiles,
    fetchAllTombstones,
    subscribeSalaryFiles,
    subscribeTombstones,
    safeKey
  };
}
