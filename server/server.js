const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { initFirebase } = require('./firebase');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const { uploadFromBase64, deleteFile, uploadSingleMemory, uploadBuffer } = require('./firebase-storage');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

const admin = initFirebase();
if (!admin) {
  console.error('Firebase admin not initialized. Provide serviceAccountKey.json or set GOOGLE_APPLICATION_CREDENTIALS.');
  process.exit(1);
}

const app = express();
app.use(cors());

// Optimized payload limits for 5MB file uploads (fast processing)
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

app.use(express.static(path.join(__dirname, '..'))); // Serve static files from parent directory

// Notification delivery helpers
const emailConfig = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
};

const emailEnabled = Boolean(emailConfig.host && emailConfig.auth.user && emailConfig.auth.pass && process.env.EMAIL_FROM);
const mailTransport = emailEnabled ? nodemailer.createTransport(emailConfig) : null;

const smsEnabled = Boolean(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_FROM
);
const smsClient = smsEnabled ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN) : null;

async function sendEmailNotification(notification) {
  if (!mailTransport || !notification.recipientEmail) return { skipped: true };
  try {
    await mailTransport.sendMail({
      from: process.env.EMAIL_FROM,
      to: notification.recipientEmail,
      subject: notification.title,
      text: notification.message,
      html: `<p>${notification.message}</p>`
    });
    return { success: true };
  } catch (err) {
    console.error('Email delivery failed:', err);
    return { success: false, error: err.message };
  }
}

async function sendSmsNotification(notification) {
  if (!smsClient || !notification.recipientPhone) return { skipped: true };
  try {
    await smsClient.messages.create({
      body: `${notification.title}\n${notification.message}`,
      to: notification.recipientPhone,
      from: process.env.TWILIO_FROM
    });
    return { success: true };
  } catch (err) {
    console.error('SMS delivery failed:', err);
    return { success: false, error: err.message };
  }
}

// Serve pages directly
app.get('/pages/:file', (req, res) => {
  const file = req.params.file;
  
  // Handle undefined or empty file parameter
  if (!file || file === 'undefined') {
    console.log('Invalid file parameter:', file);
    return res.status(400).send('Invalid file parameter');
  }
  
  res.sendFile(path.join(__dirname, `../pages/${file}`));
});

// Serve index.html from pages folder as default route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/index.html'));
});

// Redirect old dashboard URLs to new pages folder (only if not already in pages folder)
app.get('/admin-dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/admin-dashboard.html'));
});

app.get('/customer-dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/customer-dashboard.html'));
});

app.get('/staff-dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/staff-dashboard.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/index.html'));
});

app.get('/about.html', (req, res) => {
  if (!req.path.startsWith('/pages/')) {
    res.redirect('/pages/about.html');
  } else {
    res.sendFile(path.join(__dirname, '../pages/about.html'));
  }
});

// Trigger outbound notification deliveries (email/SMS)
app.post('/notifications/deliver', verifyToken, async (req, res) => {
  try {
    const { notificationIds } = req.body || {};
    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return res.status(400).json({ error: 'notificationIds array required' });
    }

    const db = admin.firestore();
    const results = [];

    for (const notificationId of notificationIds) {
      try {
        const docRef = db.collection('notifications').doc(notificationId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
          results.push({ id: notificationId, status: 'missing' });
          continue;
        }

        const data = docSnap.data();
        if (data.createdBy && data.createdBy !== req.user.uid && req.user.role !== 'admin') {
          results.push({ id: notificationId, status: 'forbidden' });
          continue;
        }

        const updates = {};

        if (data.channels?.email && data.emailStatus === 'pending') {
          if (!emailEnabled) {
            updates.emailStatus = 'disabled';
          } else {
            const emailResult = await sendEmailNotification(data);
            updates.emailStatus = emailResult.success ? 'sent' : 'failed';
            if (emailResult.error) {
              updates.emailError = emailResult.error;
            }
          }
        }

        if (data.channels?.sms && data.smsStatus === 'pending') {
          if (!smsEnabled) {
            updates.smsStatus = 'disabled';
          } else {
            const smsResult = await sendSmsNotification(data);
            updates.smsStatus = smsResult.success ? 'sent' : 'failed';
            if (smsResult.error) {
              updates.smsError = smsResult.error;
            }
          }
        }

        if (Object.keys(updates).length > 0) {
          updates.lastDeliveredAt = admin.firestore.FieldValue.serverTimestamp();
          await docRef.update(updates);
        }

        results.push({ id: notificationId, status: 'processed' });
      } catch (err) {
        console.error('Notification delivery error:', err);
        results.push({ id: notificationId, status: 'error', error: err.message });
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error('notifications/deliver error', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/services.html', (req, res) => {
  if (!req.path.startsWith('/pages/')) {
    res.redirect('/pages/services.html');
  } else {
    res.sendFile(path.join(__dirname, '../pages/services.html'));
  }
});

app.get('/faq.html', (req, res) => {
  if (!req.path.startsWith('/pages/')) {
    res.redirect('/pages/faq.html');
  } else {
    res.sendFile(path.join(__dirname, '../pages/faq.html'));
  }
});

app.get('/contact.html', (req, res) => {
  if (!req.path.startsWith('/pages/')) {
    res.redirect('/pages/contact.html');
  } else {
    res.sendFile(path.join(__dirname, '../pages/contact.html'));
  }
});

app.get('/application-form.html', (req, res) => {
  if (!req.path.startsWith('/pages/')) {
    res.redirect('/pages/application-form.html');
  } else {
    res.sendFile(path.join(__dirname, '../pages/application-form.html'));
  }
});

app.get('/permit-types.html', (req, res) => {
  if (!req.path.startsWith('/pages/')) {
    res.redirect('/pages/permit-types.html');
  } else {
    res.sendFile(path.join(__dirname, '../pages/permit-types.html'));
  }
});

// middleware: verify Firebase ID token
async function verifyToken(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing Bearer token' });
  const idToken = auth.split('Bearer ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Token verify error', err);
    res.status(401).json({ error: 'Invalid token' });
  }
}

// RBAC Middleware: Check if user has required role(s)
function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    try {
      // Must be called after verifyToken
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Get role from custom claims or Firestore
      let userRole = req.user.role;
      
      // If role not in token claims, fetch from Firestore
      if (!userRole) {
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        userRole = userDoc.exists ? userDoc.data().role : 'customer';
      }

      // Check if user's role is allowed
      if (!allowedRoles.includes(userRole)) {
        console.warn(`[RBAC] Access denied. User ${req.user.uid} with role '${userRole}' attempted to access resource requiring: ${allowedRoles.join(', ')}`);
        console.warn(`[RBAC] Request: ${req.method} ${req.path}`);
        return res.status(403).json({ 
          error: 'Access denied', 
          message: `This resource requires one of the following roles: ${allowedRoles.join(', ')}`,
          yourRole: userRole
        });
      }

      // Attach role to request for downstream use
      req.userRole = userRole;
      next();
    } catch (err) {
      console.error('[RBAC] Role verification error:', err);
      res.status(500).json({ error: 'Role verification failed' });
    }
  };
}

// RBAC Middleware: Admin only
const requireAdmin = requireRole('admin');

// RBAC Middleware: Staff or Admin
const requireStaff = requireRole('staff', 'admin');

// RBAC Middleware: Customer only
const requireCustomer = requireRole('customer');

// Admin endpoint: create a Staff account (only Admin role allowed)
app.post('/admin/createStaff', verifyToken, requireAdmin, async (req, res) => {
  try {

    const { email, password, displayName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const newUser = await admin.auth().createUser({ email, password, displayName });
    await admin.auth().setCustomUserClaims(newUser.uid, { role: 'staff' });

    const db = admin.firestore();
    await db.collection('users').doc(newUser.uid).set({
      email,
      displayName: displayName || null,
      role: 'staff',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ uid: newUser.uid, email: newUser.email });
  } catch (err) {
    console.error('createStaff error', err);
    res.status(500).json({ error: err.message });
  }
});

// Verify user role endpoint
app.get('/admin/verify-role', verifyToken, async (req, res) => {
  try {
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const role = userDoc.exists ? userDoc.data().role : 'customer';
    res.json({ uid: req.user.uid, email: req.user.email, role });
  } catch (err) {
    console.error('verify-role error', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin analytics: detailed dashboard statistics
app.get('/admin/analytics', verifyToken, requireStaff, async (req, res) => {
  try {
    const db = admin.firestore();
    const appsSnap = await db.collection('applications').get();
    
    let totalApplications = 0;
    let pending = 0;
    let underReview = 0;
    let approved = 0;
    let rejected = 0;
    
    appsSnap.forEach(doc => {
      const data = doc.data();
      totalApplications++;
      const status = (data.status || '').toLowerCase();
      if (status === 'pending') pending++;
      else if (status === 'under review') underReview++;
      else if (status === 'approved') approved++;
      else if (status === 'rejected') rejected++;
    });
    
    const counts = {
      totalApplications,
      pending,
      underReview,
      approved,
      rejected,
      approvalRate: totalApplications > 0 ? ((approved / totalApplications) * 100).toFixed(1) : 0,
      rejectionRate: totalApplications > 0 ? ((rejected / totalApplications) * 100).toFixed(1) : 0
    };
    res.json(counts);
  } catch (err) {
    console.error('analytics error', err);
    res.status(500).json({ error: err.message });
  }
});

// Staff endpoint: update application status
app.post('/staff/updateApplicationStatus', verifyToken, requireStaff, async (req, res) => {
  try {

    const { applicationId, status, rejectionReason, pickupSchedule } = req.body;
    if (!applicationId || !status) {
      return res.status(400).json({ error: 'applicationId and status required' });
    }

    const validStatuses = ['pending', 'under review', 'approved', 'rejected'];
    if (!validStatuses.includes(status.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const db = admin.firestore();
    const appRef = db.collection('applications').doc(applicationId);
    
    console.log('📋 Processing application:', applicationId, 'to status:', status);
    
    // Get current application data for audit log
    const appDoc = await appRef.get();
    if (!appDoc.exists) {
      console.log('❌ Application not found:', applicationId);
      return res.status(404).json({ error: 'Application not found' });
    }
    const beforeData = { status: appDoc.data().status };
    console.log('📝 Before data:', beforeData);
    
    const updateData = {
      status: status.toLowerCase(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: req.user.email,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (status.toLowerCase() === 'rejected' && rejectionReason) {
      updateData.rejectionReason = rejectionReason;
    }

    if (status.toLowerCase() === 'approved') {
      updateData.approvedBy = req.user.email;
      updateData.approvedAt = admin.firestore.FieldValue.serverTimestamp();
      
      // Add pickup schedule if provided
      if (pickupSchedule) {
        updateData.pickupSchedule = {
          date: pickupSchedule.date,
          time: pickupSchedule.time,
          notes: pickupSchedule.notes || '',
          scheduledBy: req.user.email,
          scheduledAt: admin.firestore.FieldValue.serverTimestamp()
        };
      }
    }

    if (status.toLowerCase() === 'rejected') {
      updateData.rejectedBy = req.user.email;
      updateData.rejectedAt = admin.firestore.FieldValue.serverTimestamp();
    }

    await appRef.update(updateData);
    console.log('✅ Application updated in Firestore');

    // TEMPORARY: Skip audit log creation due to authentication issues
    console.log('⚠️ TEMPORARY: Skipping audit log creation due to Firebase auth issues');
    console.log('📋 Would create audit log:', {
      action: status.toLowerCase() === 'approved' ? 'Approved Application' : 'Rejected Application',
      userEmail: req.user.email,
      applicationId: applicationId
    });

    res.json({ success: true, message: `Application ${status} successfully` });
  } catch (err) {
    console.error('❌ updateApplicationStatus error:', err);
    console.error('❌ Error details:', {
      message: err.message,
      stack: err.stack,
      code: err.code
    });
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: get all users
app.get('/admin/users', verifyToken, requireAdmin, async (req, res) => {
  try {

    const { userType } = req.query;
    const db = admin.firestore();
    let query = db.collection('users');

    if (userType && userType !== 'all') {
      query = query.where('role', '==', userType);
    }

    const snapshot = await query.get();
    const users = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(users);
  } catch (err) {
    console.error('getUsers error', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: update user status
app.post('/admin/users/:userId/status', verifyToken, requireAdmin, async (req, res) => {
  try {

    const { userId } = req.params;
    const { status } = req.body;

    const db = admin.firestore();
    const userRef = db.collection('users').doc(userId);

    await userRef.update({
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.email
    });

    res.json({ success: true, message: 'User status updated' });
  } catch (err) {
    console.error('updateUserStatus error', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: log audit action
app.post('/admin/audit-log', verifyToken, async (req, res) => {
  try {
    const { action, details } = req.body;

    const db = admin.firestore();
    await db.collection('auditLogs').add({
      userId: req.user.uid,
      userEmail: req.user.email,
      role: req.user.role,
      action,
      details,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true });
  } catch (err) {
    console.error('auditLog error', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: get audit logs
app.get('/admin/audit-logs', verifyToken, requireAdmin, async (req, res) => {
  try {

    const db = admin.firestore();
    const snapshot = await db.collection('auditLogs')
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();

    const logs = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(logs);
  } catch (err) {
    console.error('getAuditLogs error', err);
    res.status(500).json({ error: err.message });
  }
});


// Fix stuck applications — reset uploadStatus='uploading' with no documents
app.post('/admin/fix-stuck-uploads', verifyToken, requireStaff, async (req, res) => {
  try {
    const db = admin.firestore();
    const snapshot = await db.collection('applications')
      .where('uploadStatus', '==', 'uploading')
      .get();

    const batch = db.batch();
    let fixed = 0;
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const hasNoDocs = !data.documents || data.documents.length === 0;
      const submittedMs = data.createdAt?.toMillis?.() || (data.createdAt?.seconds || 0) * 1000;
      const minutesSince = submittedMs ? (Date.now() - submittedMs) / 60000 : 999;
      if (hasNoDocs && minutesSince > 5) {
        batch.update(docSnap.ref, {
          uploadStatus: 'failed',
          uploadFailedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        fixed++;
      }
    });
    if (fixed > 0) await batch.commit();
    res.json({ success: true, fixed, total: snapshot.size });
  } catch (err) {
    console.error('fix-stuck-uploads error', err);
    res.status(500).json({ error: err.message });
  }
});

// Direct file upload route — Firebase Storage
app.post('/upload-file-to-storage', (req, res, next) => {
  console.log('📥 Upload request incoming, content-type:', req.headers['content-type']);
  // Set a 60-second timeout for uploads
  req.setTimeout(60000, () => {
    console.error('❌ Upload request timed out');
    if (!res.headersSent) res.status(408).json({ success: false, error: 'Upload timed out. Please try again.' });
  });
  uploadSingleMemory(req, res, function(err) {
    if (err instanceof multer.MulterError) {
      console.error('❌ Multer error code:', err.code, 'message:', err.message);
      return res.status(400).json({ success: false, error: 'File upload error', details: err.message });
    } else if (err) {
      console.error('❌ Upload middleware error:', err.message);
      return res.status(400).json({ success: false, error: 'File validation error', details: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    console.log('Upload request received at:', new Date().toISOString());

    if (!req.file) {
      console.error('❌ No file in request. Body keys:', Object.keys(req.body));
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    console.log('✅ File received:', req.file.originalname, 'Size:', req.file.size, 'Type:', req.file.mimetype);

    const { folder = 'denr-permits' } = req.body;
    const result = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype, folder);

    res.json({
      success: true,
      url: result.url,
      storagePath: result.storagePath,
      size: result.size,
      original_filename: result.original_filename,
      contentType: result.contentType
    });
  } catch (error) {
    console.error('Firebase Storage upload error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload file', details: error.message });
  }
});

// Base64 upload route — Firebase Storage
app.post('/upload-to-storage', async (req, res) => {
  try {
    const { base64Data, fileName, folder = 'denr-permits' } = req.body;

    if (!base64Data || !fileName) {
      return res.status(400).json({ error: 'Base64 data and filename are required' });
    }

    const result = await uploadFromBase64(base64Data, fileName, folder);

    res.json({
      success: true,
      url: result.url,
      storagePath: result.storagePath,
      size: result.size,
      original_filename: result.original_filename,
      contentType: result.contentType
    });
  } catch (error) {
    console.error('Firebase Storage base64 upload error:', error);
    res.status(500).json({ error: 'Failed to upload file', details: error.message });
  }
});

// Firebase Storage delete route
app.delete('/delete-from-storage', async (req, res) => {
  try {
    const { storagePath } = req.body;

    if (!storagePath) {
      return res.status(400).json({ error: 'storagePath is required' });
    }

    const result = await deleteFile(storagePath);
    res.json({ success: true, result });
  } catch (error) {
    console.error('Firebase Storage delete error:', error);
    res.status(500).json({ error: 'Failed to delete file', details: error.message });
  }
});

// Firebase Storage signed download URL route
app.get('/download-file', async (req, res) => {
  try {
    const { storagePath, filename } = req.query;

    if (!storagePath) {
      return res.status(400).json({ error: 'storagePath query param is required' });
    }

    const bucket = admin.storage().bucket();

    // Resolve storagePath from various input formats:
    // 1. Plain path (preferred): "denr-permits/file.pdf"
    // 2. Firebase download URL: https://...firebasestorage.app/o/denr-permits%2Ffile.pdf?...
    // 3. Direct public URL: https://storage.googleapis.com/<bucket>/denr-permits/file.pdf
    let resolvedPath = decodeURIComponent(storagePath);
    if (resolvedPath.startsWith('http')) {
      if (resolvedPath.includes('/o/')) {
        resolvedPath = decodeURIComponent(resolvedPath.split('/o/')[1].split('?')[0]);
      } else if (resolvedPath.includes('storage.googleapis.com/')) {
        const afterHost = resolvedPath.split('storage.googleapis.com/')[1] || '';
        const slashIdx = afterHost.indexOf('/');
        resolvedPath = slashIdx >= 0 ? afterHost.slice(slashIdx + 1) : afterHost;
      }
    }
    console.log('📂 Resolved storage path:', resolvedPath);

    const file = bucket.file(resolvedPath);
    const decodedFilename = filename ? decodeURIComponent(filename) : resolvedPath.split('/').pop();

    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'File not found in Firebase Storage' });
    }

    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || 'application/octet-stream';
    const inline = req.query.inline === '1';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(decodedFilename)}"`);
    res.setHeader('Cache-Control', 'no-cache');

    file.createReadStream()
      .on('error', (err) => {
        console.error('File stream error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to stream file', details: err.message });
      })
      .pipe(res);
  } catch (error) {
    console.error('Firebase Storage download error:', error);
    res.status(500).json({ error: 'Failed to download file', details: error.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Debug endpoint: Check current user role
app.get('/debug/my-role', verifyToken, async (req, res) => {
  try {
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const firestoreRole = userDoc.exists ? userDoc.data().role : 'not found';
    const tokenRole = req.user.role || 'no role in token';

    res.json({
      uid: req.user.uid,
      email: req.user.email,
      tokenClaims: req.user,
      tokenRole: tokenRole,
      firestoreRole: firestoreRole,
      message: tokenRole === 'staff' || tokenRole === 'admin'
        ? '✅ Role is correct in token'
        : '❌ Role missing in token. Need to refresh token or set custom claims.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug endpoint: Set staff role for current user (for testing only)
app.post('/debug/set-staff-role', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    // Set custom claim
    await admin.auth().setCustomUserClaims(uid, { role: 'staff' });

    // Update Firestore
    const db = admin.firestore();
    await db.collection('users').doc(uid).set({
      email: req.user.email,
      role: 'staff',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.json({
      success: true,
      message: '✅ Staff role set! Please LOGOUT and LOGIN again to refresh your token.',
      uid: uid,
      email: req.user.email
    });
  } catch (err) {
    console.error('set-staff-role error', err);
    res.status(500).json({ error: err.message });
  }
});

// Debug endpoint: Create test audit log (for testing only)
app.post('/debug/create-audit-log', verifyToken, async (req, res) => {
  try {
    const db = admin.firestore();

    // Create a test audit log
    const auditRef = await db.collection('auditLogs').add({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userId: req.user.uid,
      userEmail: req.user.email,
      role: 'staff',
      action: 'Test Action',
      details: 'Test audit log created manually',
      category: 'data',
      resourceId: 'TEST-' + Date.now(),
      beforeData: null,
      afterData: { test: true },
      status: 'success',
      ip: req.ip || 'Unknown',
      userAgent: req.headers['user-agent'] || 'Unknown',
      module: 'debug'
    });

    res.json({
      success: true,
      message: '✅ Test audit log created!',
      logId: auditRef.id,
      userEmail: req.user.email
    });
  } catch (err) {
    console.error('create-audit-log error', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Azure Document Intelligence OCR Route ───────────────────────────────────
const { DocumentAnalysisClient, AzureKeyCredential } = require('@azure/ai-form-recognizer');
const multerOcr = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/ocr', verifyToken, multerOcr.single('file'), async (req, res) => {
  const endpoint = process.env.AZURE_DI_ENDPOINT;
  const key      = process.env.AZURE_DI_KEY;

  if (!endpoint || !key) {
    return res.status(503).json({ error: 'Azure Document Intelligence is not configured on the server. Please set AZURE_DI_ENDPOINT and AZURE_DI_KEY in server/.env.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
    const poller = await client.beginAnalyzeDocument('prebuilt-read', req.file.buffer);
    const result = await poller.pollUntilDone();

    if (!result || !result.content) {
      return res.status(422).json({ error: 'No readable text found in the document.' });
    }

    const pages = result.pages || [];
    let totalConfidence = 0;
    let wordCount = 0;
    pages.forEach(page => {
      (page.words || []).forEach(word => {
        totalConfidence += word.confidence || 0;
        wordCount++;
      });
    });
    const avgConfidence = wordCount > 0 ? Math.round((totalConfidence / wordCount) * 100) : null;

    const lines = pages.flatMap(p => (p.lines || []).map(l => l.content));

    res.json({
      text: result.content,
      lines,
      confidence: avgConfidence,
      pageCount: pages.length
    });
  } catch (err) {
    console.error('Azure DI OCR error:', err);
    res.status(500).json({ error: err.message || 'OCR processing failed.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// Export middleware and app for testing and external use
module.exports = { app, verifyToken, requireRole, requireAdmin, requireStaff, requireCustomer };
