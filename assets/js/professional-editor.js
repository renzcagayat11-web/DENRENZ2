// Professional Announcement Editor with Live Preview
document.addEventListener('DOMContentLoaded', function() {
  const announcementTitle = document.getElementById('announcementTitle');
  const announcementContent = document.getElementById('announcementContent');
  const announcementImage = document.getElementById('announcementImage');
  const uploadImageBtn = document.getElementById('uploadImageBtn');
  const imagePreview = document.getElementById('imagePreview');
  const previewImg = document.getElementById('previewImg');
  const removeImageBtn = document.getElementById('removeImageBtn');
  const announcementsForm = document.getElementById('announcementsForm');
  
  // Preview elements
  const previewTitle = document.getElementById('previewTitle');
  const previewContent = document.getElementById('previewContent');
  const previewImageContainer = document.getElementById('previewImageContainer');
  const previewImageDisplay = document.getElementById('previewImageDisplay');
  
  let currentImageData = null;
let currentImagePublicId = null;
  
  // Initialize editor functionality
  if (announcementTitle && announcementContent) {
    initializeRichTextEditor();
    initializeLivePreview();
    initializeImageUpload();
    initializeFormSubmission();
  }
  
  // Initialize rich text editor
  function initializeRichTextEditor() {
    const toolButtons = document.querySelectorAll('.tool-btn');
    
    toolButtons.forEach(button => {
      button.addEventListener('click', function(e) {
        e.preventDefault();
        const command = this.getAttribute('data-command');
        document.execCommand(command, false, null);
        announcementContent.focus();
        updateLivePreview();
      });
    });
    
    // Handle content changes
    announcementContent.addEventListener('input', updateLivePreview);
    announcementContent.addEventListener('paste', handlePaste);
  }
  
  // Handle paste events to clean up formatting
  function handlePaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    updateLivePreview();
  }
  
  // Initialize live preview
  function initializeLivePreview() {
    announcementTitle.addEventListener('input', updateLivePreview);
    announcementContent.addEventListener('input', updateLivePreview);
  }
  
  // Update live preview
  function updateLivePreview() {
    // Update title
    const titleText = announcementTitle.value.trim();
    previewTitle.textContent = titleText || 'Your announcement title will appear here';
    
    // Update content
    const contentText = announcementContent.innerHTML.trim();
    if (contentText) {
      previewContent.innerHTML = contentText;
    } else {
      previewContent.innerHTML = '<p>Your announcement content will appear here as you type...</p>';
    }
  }
  
  // Initialize image upload
  function initializeImageUpload() {
    uploadImageBtn.addEventListener('click', function() {
      announcementImage.click();
    });
    
    announcementImage.addEventListener('change', handleImageSelect);
    removeImageBtn.addEventListener('click', removeImage);
  }
  
  // Handle image selection
  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      showNotification('Please select a valid image file (JPG, PNG, GIF).', 'error');
      e.target.value = '';
      return;
    }
    
    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      showNotification('Image size must be less than 5MB.', 'error');
      e.target.value = '';
      return;
    }
    
    console.log('📸 Processing image for Cloudinary storage...');
    console.log('📊 Original file size:', (file.size / 1024 / 1024).toFixed(2), 'MB');
    
    // Upload to Cloudinary
    uploadToCloudinary(file);
  }
  
  // Upload image to Cloudinary
  async function uploadToCloudinary(file) {
    try {
      console.log('📤 Uploading to Cloudinary...');
      
      // Upload directly to Cloudinary
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'announcements');

      const uploadResponse = await fetch('/upload-file-to-cloudinary', {
        method: 'POST',
        body: formData
      });

      const uploadResult = await uploadResponse.json();
      
      if (uploadResult.success) {
        console.log('✅ Image uploaded to Cloudinary');
        console.log('📊 Cloudinary URL:', uploadResult.url);
        
        currentImageData = uploadResult.url;
        currentImagePublicId = uploadResult.public_id;
        showImagePreview(currentImageData);
        updateLiveImagePreview(currentImageData);
      } else {
        throw new Error(uploadResult.error || 'Upload failed');
      }
    } catch (error) {
      console.error('❌ Cloudinary upload error:', error);
      alert('Failed to upload image. Please try again.');
    }
  }
  
  // Calculate dimensions for image compression
  function calculateDimensions(originalWidth, originalHeight, maxWidth, maxHeight) {
    let { width, height } = { width: originalWidth, height: originalHeight };
    
    // If image is already within limits, return original dimensions
    if (width <= maxWidth && height <= maxHeight) {
      return { width, height };
    }
    
    // Calculate aspect ratio
    const aspectRatio = width / height;
    
    // Resize based on the limiting dimension
    if (width > height) {
      width = maxWidth;
      height = maxWidth / aspectRatio;
    } else {
      height = maxHeight;
      width = maxHeight * aspectRatio;
    }
    
    return { 
      width: Math.round(width), 
      height: Math.round(height) 
    };
  }
  
  // Show image preview in editor
  function showImagePreview(imageSrc) {
    previewImg.src = imageSrc;
    imagePreview.style.display = 'inline-block';
    uploadImageBtn.style.display = 'none';
  }
  
  // Update image preview in live preview
  function updateLiveImagePreview(imageSrc) {
    previewImageDisplay.src = imageSrc;
    previewImageContainer.style.display = 'block';
  }
  
  // Remove image
  function removeImage() {
    currentImageData = null;
    currentImagePublicId = null;
    announcementImage.value = '';
    imagePreview.style.display = 'none';
    uploadImageBtn.style.display = 'flex';
    previewImg.src = '';
    
    // Hide image from live preview
    previewImageContainer.style.display = 'none';
    previewImageDisplay.src = '';
  }
  
  // Initialize form submission
  function initializeFormSubmission() {
    announcementsForm.addEventListener('submit', handleFormSubmit);
    
    // Add debug button functionality
    const debugBtn = document.getElementById('debugImageData');
    if (debugBtn) {
      debugBtn.addEventListener('click', function() {
        console.log('🔍 DEBUGGING IMAGE DATA...');
        console.log('Current Image Data:', currentImageData);
        console.log('Image Data Type:', typeof currentImageData);
        console.log('Image Data Length:', currentImageData ? currentImageData.length : 0);
        console.log('Image Data Preview:', currentImageData ? currentImageData.substring(0, 100) : 'NULL');
        
        // Test form data
        const title = announcementTitle.value.trim();
        const content = announcementContent.innerHTML.trim();
        const active = document.getElementById('announcementActive').checked;
        
        console.log('FORM DATA:');
        console.log('  - Title:', title);
        console.log('  - Content Length:', content.length);
        console.log('  - Active:', active);
        console.log('  - Will Include Image:', !!currentImageData);
        
        showNotification(`Debug: Image data ${currentImageData ? 'present' : 'missing'} (${currentImageData ? currentImageData.length : 0} chars)`, 'info');
      });
    }
  }
  
  // Handle form submission
  function handleFormSubmit(e) {
    e.preventDefault();
    
    const title = announcementTitle.value.trim();
    const content = announcementContent.innerHTML.trim();
    const active = document.getElementById('announcementActive').checked;
    
    if (!title) {
      showNotification('Please enter an announcement title.', 'error');
      announcementTitle.focus();
      return;
    }
    
    if (!content || content === '<br>') {
      showNotification('Please enter announcement content.', 'error');
      announcementContent.focus();
      return;
    }
    
    // Create announcement object
    console.log('🔍 Creating announcement object...');
    console.log('  - Title:', title);
    console.log('  - Content length:', content.length);
    console.log('  - Active:', active);
    console.log('  - Current Image Data:', currentImageData ? 'Present' : 'NULL');
    console.log('  - Image Data Length:', currentImageData ? currentImageData.length : 0);
    console.log('  - Image Data Type:', currentImageData ? currentImageData.substring(0, 50) : 'N/A');
    
    const announcement = {
      title: title,
      content: content,
      active: active,
      image: currentImageData,
      imagePublicId: currentImagePublicId,
      cloudinary: currentImagePublicId ? true : false,
      timestamp: new Date().toISOString()
    };
    
    console.log('📋 Final announcement object:', {
      title: announcement.title,
      hasImage: !!announcement.image,
      imageLength: announcement.image ? announcement.image.length : 0,
      imageType: announcement.image ? announcement.image.substring(0, 30) : 'N/A'
    });
    
    // Save to Firebase
    saveAnnouncementToFirebase(announcement);
  }
  
  // Save announcement to Firebase
  async function saveAnnouncementToFirebase(announcement) {
    console.log('💾 Admin saving announcement:', announcement.title);
    console.log('🖼️ Image data length:', announcement.image ? announcement.image.length : 0);
    console.log('🖼️ Image type:', announcement.image ? announcement.image.substring(0, 30) : 'No image');
    
    try {
      // Show loading state
      const submitBtn = announcementsForm.querySelector('.btn-primary');
      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Saving...';
      submitBtn.disabled = true;
      
      // Import Firebase modules
      const { getFirestore, collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
      
      // Use centralized Firebase config
      const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
      const { auth, db } = await import('./firebase-config.js');
      
      console.log('📡 Connected to Firebase for saving...');
      
      // Prepare announcement data for Firebase
      const announcementData = {
        type: 'announcement',
        title: announcement.title,
        content: announcement.content,
        active: announcement.active,
        image: announcement.image || null,
        imageSize: announcement.image ? announcement.image.length : 0,
        timestamp: serverTimestamp(),
        createdAt: new Date().toISOString()
      };
      
      console.log('📋 Prepared announcement data for Firestore:');
      console.log('  - Title:', announcementData.title);
      console.log('  - Has Image:', !!announcementData.image);
      console.log('  - Image Size:', announcementData.imageSize ? (announcementData.imageSize / 1024 / 1024).toFixed(2) + ' MB' : 'No image');
      console.log('  - Image Type:', announcementData.image ? announcementData.image.substring(0, 30) + '...' : 'N/A');
      console.log('  - Active:', announcementData.active);
      
      // Validate that image data is properly included
      if (announcement.image && !announcementData.image) {
        console.error('❌ ERROR: Image data was lost during preparation!');
        showNotification('Error: Image data was not properly processed. Please try again.', 'error');
        return;
      }
      
      // Save to Firebase
      const docRef = await addDoc(collection(db, 'welcome'), announcementData);
      console.log('✅ Announcement saved with ID:', docRef.id);
      
      // Show success message
      showNotification('Announcement saved successfully! It will appear on the website shortly.', 'success');
      
      // Reset form
      announcementsForm.reset();
      removeImage();
      updateLivePreview();
      
      // Refresh announcements list
      loadAnnouncements();
      
      // Trigger slider refresh on index page (if possible)
      if (window.opener || window.parent !== window) {
        // Try to refresh parent window's slider
        try {
          if (window.opener && window.opener.loadAnnouncementsFromFirebase) {
            window.opener.loadAnnouncementsFromFirebase();
          }
        } catch (e) {
          console.log('Could not refresh parent slider');
        }
      }
      
    } catch (error) {
      console.error('❌ Error saving announcement:', error);
      showNotification('Error saving announcement. Please try again.', 'error');
    } finally {
      // Restore button state
      const submitBtn = announcementsForm.querySelector('.btn-primary');
      submitBtn.textContent = 'Save Announcement';
      submitBtn.disabled = false;
    }
  }
  
  // Load existing announcements
  async function loadAnnouncements() {
    const announcementsList = document.getElementById('announcementsList');
    if (announcementsList) {
      announcementsList.innerHTML = '<p>Loading announcements...</p>';
      
      try {
        // Import Firebase modules
        const { getFirestore, collection, getDocs, query, where, orderBy } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        
        // Use centralized Firebase config
        const { auth, db } = await import('./firebase-config.js');
        
        // Get announcements from Firebase
        const announcementsRef = collection(db, 'welcome');
        const announcementQuery = query(
          announcementsRef, 
          where('type', '==', 'announcement')
        );
        
        const announcementSnapshot = await getDocs(announcementQuery);
        
        // Sort manually by timestamp to avoid composite index requirement
        const announcements = [];
        announcementSnapshot.forEach((doc) => {
          const announcement = doc.data();
          announcements.push({
            id: doc.id,
            title: announcement.title,
            content: announcement.content,
            active: announcement.active,
            image: announcement.image,
            timestamp: announcement.timestamp
          });
        });
        
        // Sort by timestamp (most recent first)
        announcements.sort((a, b) => {
          const timeA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp || 0);
          const timeB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp || 0);
          return timeB - timeA;
        });
        
        // Display announcements
        displayAnnouncementsList(announcements);
        
      } catch (error) {
        console.error('Error loading announcements:', error);
        announcementsList.innerHTML = `
          <div class="existing-announcements">
            <h4>Recent Announcements</h4>
            <p>Error loading announcements. Please try again.</p>
          </div>
        `;
      }
    }
  }
  
  // Format date for display
  function formatDate(timestamp) {
    if (!timestamp) return 'Today';
    
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays <= 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  }
  
  // Display announcements list in admin
  function displayAnnouncementsList(announcements) {
    const announcementsList = document.getElementById('announcementsList');
    
    if (announcements.length === 0) {
      announcementsList.innerHTML = `
        <div class="existing-announcements">
          <h4>Recent Announcements</h4>
          <p>No announcements found. Create your first announcement above.</p>
        </div>
      `;
      return;
    }
    
    let html = '<div class="existing-announcements"><h4>Recent Announcements</h4>';
    
    announcements.forEach((announcement, index) => {
      const statusBadge = announcement.active ? 
        '<span class="status-badge active">Active</span>' : 
        '<span class="status-badge inactive">Inactive</span>';
      
      const imagePreview = announcement.image ? 
        `<img src="${announcement.image}" alt="${announcement.title}" style="width: 60px; height: 40px; object-fit: cover; border-radius: 4px;">` : 
        '<div style="width: 60px; height: 40px; background: #f3f4f6; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 12px;">No Image</div>';
      
      html += `
        <div class="announcement-item" style="display: flex; align-items: center; gap: 12px; padding: 12px; background: white; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 8px;">
          ${imagePreview}
          <div style="flex: 1;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <h5 style="margin: 0; font-size: 14px; font-weight: 600;">${announcement.title}</h5>
              ${statusBadge}
            </div>
            <p style="margin: 0; font-size: 12px; color: #6b7280; line-height: 1.4;">${announcement.content.replace(/<[^>]*>/g, '').substring(0, 100)}...</p>
            <small style="color: #9ca3af;">${formatDate(announcement.timestamp)}</small>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    announcementsList.innerHTML = html;
  }
  
  // Show notification
  function showNotification(message, type) {
    // Remove existing notifications
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notification => notification.remove());
    
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
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    
    if (type === 'success') {
      notification.style.background = '#10b981';
    } else if (type === 'error') {
      notification.style.background = '#ef4444';
    } else if (type === 'info') {
      notification.style.background = '#3b82f6';
    }
    
    document.body.appendChild(notification);
    
    // Remove after 4 seconds
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 4000);
  }
  
  // Add CSS animations
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
    
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(100%);
        opacity: 0;
      }
    }
    
    .existing-announcements {
      margin-top: 20px;
      padding: 16px;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
    }
    
    .existing-announcements h4 {
      margin: 0 0 8px 0;
      color: #1f2937;
      font-size: 16px;
    }
    
    .existing-announcements p {
      margin: 0;
      color: #6b7280;
      font-size: 14px;
    }
  `;
  document.head.appendChild(style);
  
  // Initialize
  updateLivePreview();
  loadAnnouncements();
});
