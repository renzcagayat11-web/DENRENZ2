// Admin Image Upload Functionality for Announcements with Cloudinary High-Quality Support
document.addEventListener('DOMContentLoaded', function() {
  const uploadImageBtn = document.getElementById('uploadImageBtn');
  const announcementImage = document.getElementById('announcementImage');
  const imagePreview = document.getElementById('imagePreview');
  const previewImg = document.getElementById('previewImg');
  const removeImageBtn = document.getElementById('removeImageBtn');
  const announcementsForm = document.getElementById('announcementsForm');
  
  let currentImageData = null;
  let currentImagePublicId = null;
  let currentImageMetadata = null;
  
  // Initialize image upload functionality
  if (uploadImageBtn && announcementImage) {
    uploadImageBtn.addEventListener('click', function() {
      announcementImage.click();
    });
    
    announcementImage.addEventListener('change', handleImageSelect);
    removeImageBtn.addEventListener('click', removeImage);
    
    if (announcementsForm) {
      announcementsForm.addEventListener('submit', handleFormSubmit);
    }
  }
  
  // Handle image selection with Cloudinary high-quality upload
  async function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      showNotification('Please select a valid image file (JPG, PNG, GIF, WebP).', 'error');
      e.target.value = '';
      return;
    }
    
    // Validate file size (20MB max for admin uploads)
    if (file.size > 20 * 1024 * 1024) {
      showNotification('Image size must be less than 20MB for high-quality uploads.', 'error');
      e.target.value = '';
      return;
    }
    
    try {
      // Show upload progress
      showNotification('Uploading high-quality image...', 'info');
      
      // Upload to Cloudinary with quality optimizations
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'admin-announcements');

      const uploadResponse = await fetch('/upload-file-to-cloudinary', {
        method: 'POST',
        body: formData
      });

      const uploadResult = await uploadResponse.json();
      
      if (uploadResult.success) {
        // Store all image data including metadata
        currentImageData = uploadResult.url;
        currentImagePublicId = uploadResult.public_id;
        currentImageMetadata = {
          originalName: uploadResult.original_filename,
          format: uploadResult.format,
          size: uploadResult.size,
          uploadedAt: new Date().toISOString()
        };
        
        // Generate high-quality Cloudinary URLs
        const highQualityUrl = generateHighQualityUrl(uploadResult.url, uploadResult.public_id);
        const thumbnailUrl = generateThumbnailUrl(uploadResult.url, uploadResult.public_id);
        
        showImagePreview(highQualityUrl, thumbnailUrl, uploadResult);
        showNotification('Image uploaded successfully with high-quality optimization!', 'success');
      } else {
        throw new Error(uploadResult.error || uploadResult.details || 'Upload failed');
      }
    } catch (error) {
      console.error('Image upload error:', error);
      showNotification(`Failed to upload image: ${error.message}`, 'error');
      e.target.value = '';
    }
  }
  
  // Generate high-quality Cloudinary URL with transformations
  function generateHighQualityUrl(originalUrl, publicId) {
    if (!publicId) return originalUrl;
    
    // Extract base URL and add quality transformations
    const baseUrl = originalUrl.split('/upload/')[0] + '/upload/';
    const transformations = 'q_auto:best,f_auto,w_1200,h_800,c_limit,q_90';
    const imageId = originalUrl.split('/upload/')[1];
    
    return `${baseUrl}${transformations}/${imageId}`;
  }
  
  // Generate thumbnail URL for previews
  function generateThumbnailUrl(originalUrl, publicId) {
    if (!publicId) return originalUrl;
    
    const baseUrl = originalUrl.split('/upload/')[0] + '/upload/';
    const transformations = 'q_auto:good,f_auto,w_300,h_200,c_fill,q_80';
    const imageId = originalUrl.split('/upload/')[1];
    
    return `${baseUrl}${transformations}/${imageId}`;
  }
  
  // Show enhanced image preview with quality options
  function showImagePreview(highQualityUrl, thumbnailUrl, uploadResult) {
    // Create enhanced preview container
    const previewContainer = document.getElementById('enhancedPreview');
    if (!previewContainer) {
      const container = document.createElement('div');
      container.id = 'enhancedPreview';
      container.style.cssText = `
        margin-top: 15px;
        padding: 15px;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        background: #f9fafb;
      `;
      
      container.innerHTML = `
        <div style="display: flex; gap: 15px; align-items: start;">
          <div>
            <h4 style="margin: 0 0 8px 0; font-size: 14px; color: #374151;">High Quality Preview</h4>
            <img id="previewImg" src="${highQualityUrl}" alt="Preview" style="
              max-width: 400px;
              max-height: 300px;
              border-radius: 6px;
              border: 1px solid #d1d5db;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            " />
          </div>
          <div style="flex: 1;">
            <h4 style="margin: 0 0 8px 0; font-size: 14px; color: #374151;">Image Information</h4>
            <div style="font-size: 12px; color: #6b7280; line-height: 1.5;">
              <div><strong>File:</strong> ${uploadResult.original_filename}</div>
              <div><strong>Format:</strong> ${uploadResult.format.toUpperCase()}</div>
              <div><strong>Size:</strong> ${formatFileSize(uploadResult.size)}</div>
              <div><strong>Quality:</strong> Optimized (q_auto:best)</div>
              <div style="margin-top: 8px;">
                <button onclick="window.open('${highQualityUrl}', '_blank')" style="
                  background: #3b82f6;
                  color: white;
                  border: none;
                  padding: 6px 12px;
                  border-radius: 4px;
                  font-size: 12px;
                  cursor: pointer;
                  margin-right: 8px;
                ">View Full Size</button>
                <button onclick="adminImageUpload.removeImage()" style="
                  background: #ef4444;
                  color: white;
                  border: none;
                  padding: 6px 12px;
                  border-radius: 4px;
                  font-size: 12px;
                  cursor: pointer;
                ">Remove</button>
              </div>
            </div>
          </div>
        </div>
      `;
      
      imagePreview.appendChild(container);
    } else {
      document.getElementById('previewImg').src = highQualityUrl;
    }
    
    imagePreview.style.display = 'block';
    uploadImageBtn.style.display = 'none';
  }
  
  // Format file size for display
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  // Remove image
  function removeImage() {
    currentImageData = null;
    currentImagePublicId = null;
    currentImageMetadata = null;
    announcementImage.value = '';
    imagePreview.style.display = 'none';
    uploadImageBtn.style.display = 'flex';
    
    // Remove enhanced preview if it exists
    const enhancedPreview = document.getElementById('enhancedPreview');
    if (enhancedPreview) {
      enhancedPreview.remove();
    }
  }
  
  // Handle form submission
  function handleFormSubmit(e) {
    e.preventDefault();
    
    const title = document.getElementById('announcementTitle').value;
    const content = document.getElementById('announcementContent').value;
    const active = document.getElementById('announcementActive').checked;
    
    if (!title || !content) {
      alert('Please fill in both title and content fields.');
      return;
    }
    
    // Create announcement object with high-quality image data
    const announcement = {
      title: title,
      content: content,
      active: active,
      image: currentImageData,
      imagePublicId: currentImagePublicId,
      highQualityUrl: currentImageData ? generateHighQualityUrl(currentImageData, currentImagePublicId) : null,
      thumbnailUrl: currentImageData ? generateThumbnailUrl(currentImageData, currentImagePublicId) : null,
      imageMetadata: currentImageMetadata,
      cloudinary: currentImagePublicId ? true : false,
      timestamp: new Date().toISOString()
    };
    
    // Save to Firebase (you'll need to implement this)
    saveAnnouncementToFirebase(announcement);
  }
  
  // Save announcement to Firebase
  async function saveAnnouncementToFirebase(announcement) {
    try {
      // This is a placeholder - you'll need to implement the actual Firebase save logic
      console.log('Saving announcement:', announcement);
      
      // Show success message
      showNotification('Announcement saved successfully!', 'success');
      
      // Reset form
      announcementsForm.reset();
      removeImage();
      
      // Refresh announcements list
      loadAnnouncements();
      
    } catch (error) {
      console.error('Error saving announcement:', error);
      showNotification('Error saving announcement. Please try again.', 'error');
    }
  }
  
  // Load existing announcements
  function loadAnnouncements() {
    // This is a placeholder - you'll need to implement the actual Firebase load logic
    const announcementsList = document.getElementById('announcementsList');
    if (announcementsList) {
      announcementsList.innerHTML = '<p>Loading announcements...</p>';
    }
  }
  
  // Show notification
  function showNotification(message, type) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 6px;
      color: white;
      font-weight: 500;
      z-index: 1000;
      animation: slideIn 0.3s ease;
    `;
    
    if (type === 'success') {
      notification.style.background = '#10b981';
    } else if (type === 'error') {
      notification.style.background = '#ef4444';
    }
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }
  
  // Add CSS animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);
  
  // Load announcements on page load
  loadAnnouncements();
});

// Create global reference for admin image upload
window.adminImageUpload = {
  removeImage: function() {
    const event = new CustomEvent('removeAdminImage');
    document.dispatchEvent(event);
  },
  generateHighQualityUrl: function(url, publicId) {
    if (!publicId) return url;
    const baseUrl = url.split('/upload/')[0] + '/upload/';
    const transformations = 'q_auto:best,f_auto,w_1200,h_800,c_limit,q_90';
    const imageId = url.split('/upload/')[1];
    return `${baseUrl}${transformations}/${imageId}`;
  },
  generateThumbnailUrl: function(url, publicId) {
    if (!publicId) return url;
    const baseUrl = url.split('/upload/')[0] + '/upload/';
    const transformations = 'q_auto:good,f_auto,w_300,h_200,c_fill,q_80';
    const imageId = url.split('/upload/')[1];
    return `${baseUrl}${transformations}/${imageId}`;
  }
};
