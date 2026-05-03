// Image Modal Viewer for Announcement Images
document.addEventListener('DOMContentLoaded', function() {
  const imageModal = document.getElementById('imageModal');
  const modalImage = document.getElementById('modalImage');
  const modalCaption = document.getElementById('modalCaption');
  const closeModal = document.getElementById('closeImageModal');
  
  // Initialize modal functionality
  if (imageModal && modalImage && closeModal) {
    initializeImageModal();
  }
  
  function initializeImageModal() {
    // Add click event listeners to all announcement images
    document.addEventListener('click', function(e) {
      const clickedImage = e.target.closest('.announcement-image img');
      if (clickedImage && clickedImage.src && clickedImage.src !== '') {
        e.preventDefault();
        openImageModal(clickedImage);
      }
    });
    
    // Close modal when clicking the close button
    closeModal.addEventListener('click', closeImageModal);
    
    // Close modal when clicking outside the image
    imageModal.addEventListener('click', function(e) {
      if (e.target === imageModal) {
        closeImageModal();
      }
    });
    
    // Close modal with Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && imageModal.classList.contains('show')) {
        closeImageModal();
      }
    });
  }
  
  function openImageModal(imgElement) {
    console.log('🖼️ Opening image modal for:', imgElement.alt);
    
    // Set the image source
    modalImage.src = imgElement.src;
    modalImage.alt = imgElement.alt;
    
    // Set the caption (use announcement title or alt text)
    const announcementCard = imgElement.closest('.announcement-card');
    if (announcementCard) {
      const titleElement = announcementCard.querySelector('h3');
      const title = titleElement ? titleElement.textContent : imgElement.alt;
      modalCaption.textContent = title;
    } else {
      modalCaption.textContent = imgElement.alt || 'Announcement Image';
    }
    
    // Show the modal
    imageModal.classList.add('show');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
    
    console.log('✅ Image modal opened');
  }
  
  function closeImageModal() {
    console.log('🖼️ Closing image modal');
    
    // Hide the modal
    imageModal.classList.remove('show');
    document.body.style.overflow = ''; // Restore scrolling
    
    // Clear the image after a short delay to prevent flicker
    setTimeout(() => {
      modalImage.src = '';
      modalImage.alt = '';
      modalCaption.textContent = '';
    }, 300);
    
    console.log('✅ Image modal closed');
  }
  
  // Add keyboard navigation for modal
  document.addEventListener('keydown', function(e) {
    if (!imageModal.classList.contains('show')) return;
    
    switch(e.key) {
      case 'ArrowLeft':
        // Navigate to previous image (if multiple images in future)
        navigateImage(-1);
        break;
      case 'ArrowRight':
        // Navigate to next image (if multiple images in future)
        navigateImage(1);
        break;
      case 'Escape':
        closeImageModal();
        break;
    }
  });
  
  function navigateImage(direction) {
    // Placeholder for future image navigation
    // This could navigate between multiple images in the same announcement
    console.log('🔄 Image navigation:', direction > 0 ? 'next' : 'previous');
  }
  
  // Add touch/swipe support for mobile
  let touchStartX = 0;
  let touchEndX = 0;
  
  imageModal.addEventListener('touchstart', function(e) {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });
  
  imageModal.addEventListener('touchend', function(e) {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  }, { passive: true });
  
  function handleSwipe() {
    const swipeThreshold = 50;
    const diff = touchStartX - touchEndX;
    
    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        // Swipe left - could navigate to next image
        console.log('👆 Swipe left detected');
      } else {
        // Swipe right - could navigate to previous image
        console.log('👇 Swipe right detected');
      }
    }
  }
  
  console.log('🖼️ Image Modal Viewer initialized');
});
