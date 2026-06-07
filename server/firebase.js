const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let initialized = false;

function initFirebase() {
  if (initialized) return admin;

  // 1. Try FIREBASE_SERVICE_ACCOUNT env var (JSON string) — used on Render/cloud
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      const projectId = serviceAccount.project_id;
      const storageBucket = process.env.FIREBASE_STORAGE_BUCKET
        || `${projectId}.firebasestorage.app`;
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
        databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
        storageBucket
      });
      initialized = true;
      console.log('Firebase initialized using FIREBASE_SERVICE_ACCOUNT env var');
      console.log('Project ID:', projectId, '| Storage bucket:', storageBucket);
      return admin;
    } catch (error) {
      console.error('Error initializing Firebase from FIREBASE_SERVICE_ACCOUNT:', error);
    }
  }

  // 2. Try local serviceAccountKey.json — used in local development
  const keyPath = path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(keyPath)) {
    try {
      const serviceAccount = require(keyPath);
      const projectId = serviceAccount.project_id;
      const storageBucket = process.env.FIREBASE_STORAGE_BUCKET
        || `${projectId}.firebasestorage.app`;
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
        databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
        storageBucket
      });
      initialized = true;
      console.log('Firebase initialized using serviceAccountKey.json');
      console.log('Project ID:', projectId, '| Storage bucket:', storageBucket);
      return admin;
    } catch (error) {
      console.error('Error initializing Firebase:', error);
    }
  }

  // 3. Try GOOGLE_APPLICATION_CREDENTIALS
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      admin.initializeApp();
      initialized = true;
      console.log('Firebase initialized using GOOGLE_APPLICATION_CREDENTIALS');
      return admin;
    } catch (error) {
      console.error('Error initializing Firebase with environment credentials:', error);
    }
  }

  console.error('No valid Firebase credentials found. Please check:');
  console.error('1. Set FIREBASE_SERVICE_ACCOUNT env var (JSON string) on Render');
  console.error('2. Or place serviceAccountKey.json in server/ folder for local dev');
  return null;
}

module.exports = { initFirebase };
