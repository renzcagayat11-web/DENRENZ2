// Firebase Configuration for DENR Permit System
const firebaseConfig = {
  apiKey: "AIzaSyAdn9a98QMOFH4lY_5Xn8FzxHJTt2GZQt0",
  authDomain: "denr-permit.firebaseapp.com",
  projectId: "denr-permit",
  storageBucket: "denr-permit.firebasestorage.app",
  messagingSenderId: "749870906734",
  appId: "1:749870906734:web:003f323c6c0134314bd57f",
  measurementId: "G-GC1141GXM0"
};

// Initialize Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
