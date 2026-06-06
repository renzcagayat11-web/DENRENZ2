const { initFirebase } = require('./firebase');
const multer = require('multer');
const path = require('path');

const admin = initFirebase();

const allowedMimeTypes = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'image/bmp', 'image/tiff', 'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream', // some browsers send this for .doc/.docx
  'application/zip'           // .docx files are zip-based, some browsers use this
];

const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg',
  '.pdf', '.doc', '.docx'];

// Multer memory storage (file goes into req.file.buffer)
const uploadSingleMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype} (${ext}). Allowed: images, PDF, DOC, DOCX`), false);
    }
  }
}).single('file');

/**
 * Upload a buffer directly to Firebase Storage
 * @param {Buffer} buffer - File buffer
 * @param {string} originalName - Original file name
 * @param {string} mimeType - MIME type of the file
 * @param {string} folder - Storage folder/prefix (e.g. 'denr-permits')
 * @returns {Promise<{url, storagePath, size, original_filename, contentType}>}
 */
const MIME_BY_EXT = {
  '.pdf':  'application/pdf',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.bmp':  'image/bmp',
  '.svg':  'image/svg+xml'
};

const uploadBuffer = async (buffer, originalName, mimeType, folder = 'denr-permits') => {
  const bucket = admin.storage().bucket();

  const ext = path.extname(originalName).toLowerCase() || '';
  // If browser sent a generic type, use the extension-based MIME instead
  const resolvedMime = (mimeType === 'application/octet-stream' || mimeType === 'application/zip')
    ? (MIME_BY_EXT[ext] || mimeType)
    : mimeType;
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const storagePath = `${folder}/${timestamp}-${randomStr}${ext}`;

  const file = bucket.file(storagePath);

  await file.save(buffer, {
    metadata: {
      contentType: resolvedMime,
      metadata: {
        originalName: originalName
      }
    }
  });

  // Make the file publicly readable
  await file.makePublic();

  const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

  console.log('✅ Firebase Storage upload successful:', { storagePath, url, size: buffer.length, contentType: resolvedMime });

  return {
    url,
    storagePath,
    size: buffer.length,
    original_filename: originalName,
    contentType: resolvedMime
  };
};

/**
 * Upload from base64 string to Firebase Storage
 * @param {string} base64String - Full data URI (data:<mime>;base64,<data>) or raw base64
 * @param {string} fileName - Original file name
 * @param {string} folder - Storage folder
 */
const uploadFromBase64 = async (base64String, fileName, folder = 'denr-permits') => {
  let mimeType = 'application/octet-stream';
  let base64Data = base64String;

  if (base64String.startsWith('data:')) {
    const matches = base64String.match(/^data:([^;]+);base64,(.+)$/);
    if (matches) {
      mimeType = matches[1];
      base64Data = matches[2];
    }
  }

  const buffer = Buffer.from(base64Data, 'base64');
  return uploadBuffer(buffer, fileName, mimeType, folder);
};

/**
 * Delete a file from Firebase Storage by its storage path
 * @param {string} storagePath - The path returned from upload (e.g. 'denr-permits/...')
 */
const deleteFile = async (storagePath) => {
  try {
    const bucket = admin.storage().bucket();
    await bucket.file(storagePath).delete();
    console.log('✅ Firebase Storage file deleted:', storagePath);
    return { success: true };
  } catch (error) {
    console.error('❌ Firebase Storage delete error:', error);
    throw error;
  }
};

module.exports = {
  uploadSingleMemory,
  uploadFromBase64,
  uploadBuffer,
  deleteFile
};
