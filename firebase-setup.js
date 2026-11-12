// Loads Firebase once for both pages. The version is pinned on purpose.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';

export const isConfigured =
  typeof firebaseConfig.apiKey === 'string' &&
  firebaseConfig.apiKey.length > 0 &&
  firebaseConfig.apiKey !== 'PASTE_HERE';

let app = null;
let auth = null;
let db = null;

if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  try {
    // Saves on the phone first, so nothing is lost when there is no signal.
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    db = getFirestore(app);
  }
}

export { app, auth, db };

export {
  signInAnonymously,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

export {
  collection,
  doc,
  writeBatch,
  setDoc,
  serverTimestamp,
  onSnapshot,
  query,
  where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
