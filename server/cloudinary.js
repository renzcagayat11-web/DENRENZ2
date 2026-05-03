// Load environment variables first
require('dotenv').config({ path: __dirname + '/.env' });

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary
console.log('Loading Cloudinary configuration...');
console.log('CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME ? 'Found' : 'Missing');
console.log('CLOUDINARY_API_KEY:', process.env.CLOUDINARY_API_KEY ? 'Found' : 'Missing');
console.log('CLOUDINARY_API_SECRET:', process.env.CLOUDINARY_API_SECRET ? 'Found' : 'Missing');

// Validate Cloudinary configuration
if (!process.env.CLOUDINARY_CLOUD_NAME) {
  throw new Error('CLOUDINARY_CLOUD_NAME is required in .env file');
}
if (!process.env.CLOUDINARY_API_KEY) {
  throw new Error('CLOUDINARY_API_KEY is required in .env file');
}
if (!process.env.CLOUDINARY_API_SECRET) {
  throw new Error('CLOUDINARY_API_SECRET is required in .env file');
}
if (process.env.CLOUDINARY_API_SECRET.length < 30) {
  console.warn('⚠️  API Secret is shorter than expected but user confirmed it is correct');
  console.warn('⚠️  Current length:', process.env.CLOUDINARY_API_SECRET.length, 'characters');
  // User confirmed this is the complete API secret, so don't show error
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

console.log('Cloudinary configured with cloud_name:', process.env.CLOUDINARY_CLOUD_NAME);

// Configure storage for multer - ULTRA OPTIMIZED for fastest uploads
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'denr-permits', // Folder name in Cloudinary
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx'],
    // ULTRA FAST: Aggressive image optimization
    quality: 'auto:eco', // More aggressive compression for speed
    fetch_format: 'auto', // Auto-select best format (webp for images)
    // Maximum speed settings
    eager: [], // No eager transformations (fastest)
    eager_async: false,
    // Smaller file sizes for faster uploads
    format: 'auto', // Auto-convert to optimal format
    // Unique filename generation
    public_id: (req, file) => {
      // Generate unique filename - shorter for faster URLs
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 6); // Even shorter random string
      return `${timestamp}-${randomString}`; 
    },
    // Additional speed optimizations
    overwrite: true,
    invalidate: false, // Skip CDN invalidation for speed
    resource_type: 'auto', // Auto-detect resource type
    // Compression settings for documents
    chunk_size: 6000000, // 6MB chunks for faster uploads
    use_filename: false, // Don't use original filename (faster)
    unique_filename: true // Ensure unique names
  }
});

// Create multer upload middleware - OPTIMIZED for fast uploads
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit for fast uploads
  },
  fileFilter: (req, file, cb) => {
    // Allowed file types
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
      'application/pdf', 
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, PDFs, and Word documents are allowed.'), false);
    }
  }
});

// Upload single file
const uploadSingle = upload.single('file');

// Create memory storage for direct upload endpoint
const memoryStorage = multer.memoryStorage();
const uploadToMemory = multer({ 
  storage: memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allowed file types
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/svg+xml',
      'application/pdf', 
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, PDFs, and Word documents are allowed.'), false);
    }
  }
});

// Upload single file to memory
const uploadSingleMemory = uploadToMemory.single('file');

// Upload multiple files
const uploadMultiple = upload.array('files', 10); // Max 10 files

// Helper function to upload from base64 - ULTRA OPTIMIZED
const uploadFromBase64 = async (base64String, fileName, folder = 'denr-permits') => {
  try {
    console.log('📤 Starting Cloudinary upload for:', fileName);
    
    // Validate input
    if (!base64String || !fileName) {
      throw new Error('Base64 data and filename are required');
    }
    
    // Remove file extension from public_id to prevent double extensions
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
    
    // Determine resource type based on file extension
    const fileExtension = fileName.toLowerCase().split('.').pop();
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExtension);
    const resourceType = isImage ? 'image' : 'raw';
    
    console.log('📊 Upload parameters:', {
      fileName,
      fileExtension,
      isImage,
      resourceType,
      folder
    });
    
    let result;
    if (isImage) {
      // Upload images with ULTRA FAST optimizations
      result = await cloudinary.uploader.upload(base64String, {
        folder: folder,
        public_id: `${Date.now()}-${nameWithoutExt.substring(0, 8)}`, // Shorter filename
        resource_type: 'image',
        overwrite: true,
        use_filename: false,
        unique_filename: true
      });
    } else {
      // Upload documents with minimal processing
      result = await cloudinary.uploader.upload(base64String, {
        folder: folder,
        public_id: `${Date.now()}-${nameWithoutExt.substring(0, 8)}`, // Shorter filename
        resource_type: 'raw',
        // Speed optimizations for documents
        format: fileExtension,
        overwrite: true,
        invalidate: false, // Skip CDN invalidation for speed
        // Minimal processing for maximum speed
        use_filename: false,
        unique_filename: true,
        async: false, // Synchronous upload for immediate response
        chunk_size: 6000000, // 6MB chunks for faster uploads
        // Disable all unnecessary processing
        eager: [],
        eager_async: false
      });
    }
    
    console.log('✅ Cloudinary upload successful:', {
      public_id: result.public_id,
      url: result.secure_url,
      size: result.bytes
    });
    
    return {
      url: result.secure_url,
      public_id: result.public_id,
      format: result.format,
      size: result.bytes,
      original_filename: fileName,
      resource_type: resourceType
    };
  } catch (error) {
    console.error('❌ Cloudinary upload error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      http_code: error.http_code,
      code: error.code,
      name: error.name
    });
    
    // Provide more specific error messages
    if (error.http_code === 401) {
      throw new Error('Cloudinary authentication failed. Please check your API credentials.');
    } else if (error.http_code === 400) {
      throw new Error('Invalid Cloudinary request: ' + error.message);
    } else if (error.http_code === 403) {
      throw new Error('Cloudinary access forbidden. Check your account settings.');
    } else if (error.http_code === 404) {
      throw new Error('Cloudinary resource not found.');
    } else if (error.http_code >= 500) {
      throw new Error('Cloudinary server error. Please try again later.');
    } else {
      throw new Error('Cloudinary upload failed: ' + (error.message || 'Unknown error'));
    }
  }
};

// Delete file from Cloudinary
const deleteFile = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw error;
  }
};

module.exports = {
  cloudinary,
  uploadSingle,
  uploadSingleMemory,
  uploadMultiple,
  uploadFromBase64,
  deleteFile
};
