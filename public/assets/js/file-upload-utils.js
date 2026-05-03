// File Upload Utilities for Large Files
class FileUploadManager {
  constructor() {
    this.maxFileSize = 50 * 1024 * 1024; // 50MB
    this.allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    this.allowedDocumentTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
  }

  // Validate file before upload
  validateFile(file, options = {}) {
    const { allowImages = true, allowDocuments = true, maxSize = this.maxFileSize } = options;
    
    if (!file) {
      throw new Error('No file selected');
    }

    // Check file size
    if (file.size > maxSize) {
      const sizeMB = Math.round(maxSize / (1024 * 1024));
      throw new Error(`File size must be less than ${sizeMB}MB`);
    }

    // Check file type
    const allowedTypes = [];
    if (allowImages) allowedTypes.push(...this.allowedImageTypes);
    if (allowDocuments) allowedTypes.push(...this.allowedDocumentTypes);

    if (!allowedTypes.includes(file.type)) {
      const typeNames = {
        'image/jpeg': 'JPEG',
        'image/jpg': 'JPG', 
        'image/png': 'PNG',
        'image/gif': 'GIF',
        'image/webp': 'WebP',
        'application/pdf': 'PDF',
        'application/msword': 'Word Document',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word Document',
        'application/vnd.ms-excel': 'Excel Spreadsheet',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel Spreadsheet'
      };
      
      const allowedNames = allowedTypes.map(type => typeNames[type] || type).join(', ');
      throw new Error(`Invalid file type. Allowed types: ${allowedNames}`);
    }

    return true;
  }

  // Compress image before upload
  async compressImage(file) {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) {
        resolve(file); // Not an image, return as-is
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // Calculate new dimensions (max 1920x1080 for web)
          const maxWidth = 1920;
          const maxHeight = 1080;
          let width = img.width;
          let height = img.height;
          
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width *= ratio;
            height *= ratio;
          }
          
          canvas.width = width;
          canvas.height = height;
          
          // Draw and compress
          ctx.drawImage(img, 0, 0, width, height);
          
          canvas.toBlob((blob) => {
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            resolve(compressedFile);
          }, 'image/jpeg', 0.85); // 85% quality for good balance
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Upload file to Cloudinary with progress tracking
  async uploadFile(file, options = {}) {
    const { 
      folder = 'denr-permits',
      onProgress = null,
      validateOptions = {}
    } = options;

    // Validate file first
    this.validateFile(file, validateOptions);

    // Compress images before upload
    const fileToUpload = await this.compressImage(file);

    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', fileToUpload);
      formData.append('folder', folder);

      const xhr = new XMLHttpRequest();

      // Progress tracking
      if (onProgress && xhr.upload) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 100;
            onProgress(percentComplete);
          }
        });
      }

      // Load complete
      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.success) {
              resolve(response);
            } else {
              reject(new Error(response.error || response.details || 'Upload failed'));
            }
          } catch (e) {
            reject(new Error('Invalid server response'));
          }
        } else {
          try {
            const errorResponse = JSON.parse(xhr.responseText);
            if (errorResponse.error === 'Cloudinary not configured') {
              reject(new Error('Cloudinary is not configured. Please contact administrator to set up Cloudinary credentials.'));
            } else {
              reject(new Error(errorResponse.error || errorResponse.details || `Upload failed with status ${xhr.status}`));
            }
          } catch (e) {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      });

      // Error handling
      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload was cancelled'));
      });

      // Set timeout to prevent getting stuck (2 minutes for faster feedback)
      xhr.timeout = 120000;
      
      // Timeout handling
      xhr.addEventListener('timeout', () => {
        reject(new Error('Upload timed out after 2 minutes. Please try a smaller file or check your connection.'));
      });

      // Send request
      xhr.open('POST', '/upload-file-to-cloudinary');
      xhr.send(formData);
    });
  }

  // Upload multiple files
  async uploadMultipleFiles(files, options = {}) {
    const { 
      folder = 'denr-permits',
      onProgress = null,
      maxConcurrent = 3
    } = options;

    if (!files || files.length === 0) {
      throw new Error('No files selected');
    }

    const results = [];
    let completed = 0;

    // Process files in batches
    for (let i = 0; i < files.length; i += maxConcurrent) {
      const batch = files.slice(i, i + maxConcurrent);
      
      const batchPromises = batch.map(async (file, index) => {
        try {
          const result = await this.uploadFile(file, {
            folder,
            onProgress: onProgress ? (progress) => {
              const overallProgress = ((completed + progress / 100) / files.length) * 100;
              onProgress(overallProgress);
            } : null
          });
          completed++;
          return { success: true, file: file.name, result };
        } catch (error) {
          completed++;
          return { success: false, file: file.name, error: error.message };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  // Format file size for display
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Get file icon based on type
  getFileIcon(fileType) {
    if (fileType.startsWith('image/')) return '🖼️';
    if (fileType === 'application/pdf') return '📄';
    if (fileType.includes('word')) return '📝';
    if (fileType.includes('excel') || fileType.includes('spreadsheet')) return '📊';
    return '📁';
  }
}

// Export for use in other files
window.FileUploadManager = FileUploadManager;

// Create global instance
window.fileUploadManager = new FileUploadManager();
