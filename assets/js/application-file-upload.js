// Application File Upload Handler for Large Documents
class ApplicationFileUpload {
  constructor() {
    this.maxFileSize = 50 * 1024 * 1024; // 50MB for documents
    this.uploadManager = new window.FileUploadManager();
    this.uploads = new Map(); // Track ongoing uploads
  }

  // Initialize file upload for application forms
  initializeApplicationUpload(applicationId) {
    this.applicationId = applicationId;
    this.setupEventListeners();
  }

  // Setup event listeners for file inputs
  setupEventListeners() {
    // Profile picture upload (already handled in customer-dashboard.js)
    
    // Application document uploads
    const documentInputs = [
      'validId', 'proofOfOwnership', 'businessPermit', 
      'taxDeclaration', 'locationPlan', 'otherDocuments'
    ];

    documentInputs.forEach(inputId => {
      const input = document.getElementById(inputId);
      if (input) {
        input.addEventListener('change', (e) => this.handleDocumentUpload(e, inputId));
      }
    });

    // Multiple file uploads for requirements
    const requirementsInput = document.getElementById('requirementsFiles');
    if (requirementsInput) {
      requirementsInput.addEventListener('change', (e) => this.handleMultipleDocumentUpload(e));
    }
  }

  // Handle single document upload
  async handleDocumentUpload(e, documentType) {
    const file = e.target.files[0];
    if (!file) return;

    const uploadId = `${this.applicationId}-${documentType}`;
    
    try {
      // Show loading state
      this.showUploadProgress(documentType, 0, 'Uploading...');
      
      // Upload document
      const result = await this.uploadManager.uploadFile(file, {
        folder: `denr-permits/${this.applicationId}/documents`,
        validateOptions: {
          allowImages: false,
          allowDocuments: true,
          maxSize: this.maxFileSize
        },
        onProgress: (progress) => {
          this.showUploadProgress(documentType, progress, 'Uploading...');
        }
      });

      // Store upload result
      this.uploads.set(uploadId, {
        documentType,
        fileName: file.name,
        fileSize: file.size,
        cloudinaryUrl: result.url,
        publicId: result.public_id,
        uploadedAt: new Date().toISOString()
      });

      // Show success
      this.showUploadSuccess(documentType, file.name, result.url);
      
      // Update form data
      this.updateFormData(documentType, result);

    } catch (error) {
      console.error(`Error uploading ${documentType}:`, error);
      this.showUploadError(documentType, error.message);
    }
  }

  // Handle multiple document uploads
  async handleMultipleDocumentUpload(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    try {
      // Show loading state
      this.showMultipleUploadProgress(0, 'Preparing uploads...');

      // Upload all files
      const results = await this.uploadManager.uploadMultipleFiles(files, {
        folder: `denr-permits/${this.applicationId}/requirements`,
        validateOptions: {
          allowImages: true,
          allowDocuments: true,
          maxSize: this.maxFileSize
        },
        onProgress: (progress) => {
          this.showMultipleUploadProgress(progress, `Uploading ${Math.round(progress)}%...`);
        }
      });

      // Process results
      const successfulUploads = results.filter(r => r.success);
      const failedUploads = results.filter(r => !r.success);

      // Store successful uploads
      successfulUploads.forEach(upload => {
        const uploadId = `${this.applicationId}-requirements-${upload.file}`;
        this.uploads.set(uploadId, {
          documentType: 'requirements',
          fileName: upload.file,
          cloudinaryUrl: upload.result.url,
          publicId: upload.result.public_id,
          uploadedAt: new Date().toISOString()
        });
      });

      // Show results
      this.showMultipleUploadResults(successfulUploads, failedUploads);
      
      // Update form data with successful uploads
      this.updateFormDataWithMultiple(successfulUploads);

    } catch (error) {
      console.error('Error uploading multiple documents:', error);
      this.showMultipleUploadError(error.message);
    }

    // Reset file input
    e.target.value = '';
  }

  // Show upload progress for single file
  showUploadProgress(documentType, progress, message) {
    const progressElement = document.getElementById(`${documentType}Progress`);
    const statusElement = document.getElementById(`${documentType}Status`);
    
    if (progressElement) {
      progressElement.style.display = 'block';
      progressElement.querySelector('.progress-bar').style.width = `${progress}%`;
      progressElement.querySelector('.progress-text').textContent = `${Math.round(progress)}%`;
    }
    
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.className = 'upload-status uploading';
    }
  }

  // Show upload success
  showUploadSuccess(documentType, fileName, url) {
    const progressElement = document.getElementById(`${documentType}Progress`);
    const statusElement = document.getElementById(`${documentType}Status`);
    const previewElement = document.getElementById(`${documentType}Preview`);
    
    if (progressElement) {
      progressElement.style.display = 'none';
    }
    
    if (statusElement) {
      statusElement.textContent = `✅ ${fileName} uploaded successfully`;
      statusElement.className = 'upload-status success';
    }
    
    if (previewElement) {
      previewElement.innerHTML = `
        <div class="file-preview">
          <div class="file-icon">${this.uploadManager.getFileIcon(this.getFileType(fileName))}</div>
          <div class="file-info">
            <div class="file-name">${fileName}</div>
            <div class="file-actions">
              <a href="${url}" target="_blank" class="btn-view">View</a>
              <button type="button" class="btn-remove" onclick="applicationFileUpload.removeDocument('${documentType}')">Remove</button>
            </div>
          </div>
        </div>
      `;
    }
  }

  // Show upload error
  showUploadError(documentType, errorMessage) {
    const progressElement = document.getElementById(`${documentType}Progress`);
    const statusElement = document.getElementById(`${documentType}Status`);
    
    if (progressElement) {
      progressElement.style.display = 'none';
    }
    
    if (statusElement) {
      statusElement.textContent = `❌ ${errorMessage}`;
      statusElement.className = 'upload-status error';
    }
  }

  // Show multiple upload progress
  showMultipleUploadProgress(progress, message) {
    const container = document.getElementById('multipleUploadProgress');
    if (container) {
      container.style.display = 'block';
      container.querySelector('.progress-bar').style.width = `${progress}%`;
      container.querySelector('.progress-text').textContent = message;
    }
  }

  // Show multiple upload results
  showMultipleUploadResults(successful, failed) {
    const container = document.getElementById('multipleUploadProgress');
    const resultsContainer = document.getElementById('multipleUploadResults');
    
    if (container) {
      container.style.display = 'none';
    }
    
    if (resultsContainer) {
      let html = '';
      
      if (successful.length > 0) {
        html += '<div class="upload-results success"><h4>✅ Successfully Uploaded:</h4><ul>';
        successful.forEach(upload => {
          html += `<li>${upload.file}</li>`;
        });
        html += '</ul></div>';
      }
      
      if (failed.length > 0) {
        html += '<div class="upload-results error"><h4>❌ Failed Uploads:</h4><ul>';
        failed.forEach(upload => {
          html += `<li>${upload.file}: ${upload.error}</li>`;
        });
        html += '</ul></div>';
      }
      
      resultsContainer.innerHTML = html;
    }
  }

  // Show multiple upload error
  showMultipleUploadError(errorMessage) {
    const container = document.getElementById('multipleUploadProgress');
    const resultsContainer = document.getElementById('multipleUploadResults');
    
    if (container) {
      container.style.display = 'none';
    }
    
    if (resultsContainer) {
      resultsContainer.innerHTML = `
        <div class="upload-results error">
          <h4>❌ Upload Failed</h4>
          <p>${errorMessage}</p>
        </div>
      `;
    }
  }

  // Update form data with uploaded file info
  updateFormData(documentType, result) {
    const hiddenInput = document.getElementById(`${documentType}Data`);
    if (hiddenInput) {
      hiddenInput.value = JSON.stringify({
        url: result.url,
        publicId: result.public_id,
        originalName: result.original_filename,
        size: result.size,
        format: result.format
      });
    }
  }

  // Update form data with multiple uploads
  updateFormDataWithMultiple(successfulUploads) {
    const hiddenInput = document.getElementById('requirementsData');
    if (hiddenInput) {
      const currentData = hiddenInput.value ? JSON.parse(hiddenInput.value) : [];
      const newUploads = successfulUploads.map(upload => ({
        url: upload.result.url,
        publicId: upload.result.public_id,
        originalName: upload.file,
        size: upload.result.size,
        format: upload.result.format
      }));
      
      hiddenInput.value = JSON.stringify([...currentData, ...newUploads]);
    }
  }

  // Remove uploaded document
  removeDocument(documentType) {
    const uploadId = `${this.applicationId}-${documentType}`;
    this.uploads.delete(uploadId);
    
    // Clear UI
    const statusElement = document.getElementById(`${documentType}Status`);
    const previewElement = document.getElementById(`${documentType}Preview`);
    const hiddenInput = document.getElementById(`${documentType}Data`);
    
    if (statusElement) {
      statusElement.textContent = '';
      statusElement.className = 'upload-status';
    }
    
    if (previewElement) {
      previewElement.innerHTML = '';
    }
    
    if (hiddenInput) {
      hiddenInput.value = '';
    }
    
    // Clear file input
    const fileInput = document.getElementById(documentType);
    if (fileInput) {
      fileInput.value = '';
    }
  }

  // Get all uploaded documents for the application
  getUploadedDocuments() {
    const documents = [];
    this.uploads.forEach((upload, key) => {
      if (key.startsWith(this.applicationId)) {
        documents.push(upload);
      }
    });
    return documents;
  }

  // Get file type from filename
  getFileType(filename) {
    const extension = filename.split('.').pop().toLowerCase();
    const typeMap = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    return typeMap[extension] || 'application/octet-stream';
  }
}

// Create global instance
window.applicationFileUpload = new ApplicationFileUpload();
