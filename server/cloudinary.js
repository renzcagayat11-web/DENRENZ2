const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary
console.log('Loading Cloudinary configuration...');
console.log('CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME ? 'Found' : 'Missing');
console.log('CLOUDINARY_API_KEY:', process.env.CLOUDINARY_API_KEY ? 'Found' : 'Missing');
console.log('CLOUDINARY_API_SECRET:', process.env.CLOUDINARY_API_SECRET ? 'Found' : 'Missing');

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

// Upload multiple files
const uploadMultiple = upload.array('files', 10); // Max 10 files

// Helper function to upload from base64 - ULTRA OPTIMIZED
const uploadFromBase64 = async (base64String, fileName, folder = 'denr-permits') => {
  try {
    // Remove file extension from public_id to prevent double extensions
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
    
    // Determine resource type based on file extension
    const fileExtension = fileName.toLowerCase().split('.').pop();
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExtension);
    const resourceType = isImage ? 'image' : 'raw';
    
    let result;
    if (isImage) {
      // Upload images with ULTRA FAST optimizations
      result = await cloudinary.uploader.upload(base64String, {
        folder: folder,
        public_id: `${Date.now()}-${nameWithoutExt.substring(0, 8)}`, // Shorter filename
        resource_type: 'image',
        // ULTRA FAST: Maximum compression for speed
        quality: 'auto:eco', // Most aggressive compression
        fetch_format: 'auto', // Auto-select best format (webp for images)
        // Maximum speed settings
        eager: [], // No eager transformations
        overwrite: true,
        invalidate: false, // Skip CDN invalidation for speed
        format: 'auto', // Auto-convert to optimal format
        // Additional optimizations
        chunk_size: 6000000, // 6MB chunks
        use_filename: false,
        unique_filename: true,
        async: false // Synchronous for immediate response
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
    
    return {
      url: result.secure_url,
      public_id: result.public_id,
      format: result.format,
      size: result.bytes,
      original_filename: fileName,
      resource_type: resourceType
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw error;
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
  uploadMultiple,
  uploadFromBase64,
  deleteFile
};
