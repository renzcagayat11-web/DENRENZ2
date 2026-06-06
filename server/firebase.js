const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let initialized = false;

function initFirebase() {
  if (initialized) return admin;
  
  // Load serviceAccountKey.json
  const keyPath = path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(keyPath)) {
    try {
      const serviceAccount = require(keyPath);
      const projectId = serviceAccount.project_id;
      // New Firebase projects use .firebasestorage.app; older ones use .appspot.com
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

  // Try environment variables
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
  console.error('1. Service account key file exists in server folder');
  console.error('2. Firebase project is properly configured');
  console.error('3. Service account has proper permissions');
  return null;
}

module.exports = { initFirebase };
