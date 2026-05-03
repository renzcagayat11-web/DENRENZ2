// Dynamic Announcement Slider with Firebase Integration
document.addEventListener('DOMContentLoaded', function() {
  const sliderTrack = document.getElementById('sliderTrack');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const dotsContainer = document.getElementById('sliderDots');
  
  let currentSlide = 0;
  let autoSlideInterval;
  let touchStartX = 0;
  let touchEndX = 0;
  let slides = [];
  let dots = [];
  
  // Initialize slider
  function initSlider() {
    loadAnnouncementsFromFirebase();
  }
  
  // Load announcements from Firebase
  async function loadAnnouncementsFromFirebase() {
    console.log('🔄 Loading announcements from Firebase...');
    
    try {
      // Import Firebase modules
      const { getFirestore, collection, getDocs, query, where, orderBy } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
      const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
      
      // Use centralized Firebase config
      const { auth, db } = await import('./firebase-config.js');
      
      console.log('📡 Connected to Firebase, fetching announcements...');
      
      // Get announcements from Firebase
      const announcementsRef = collection(db, 'welcome');
      const announcementQuery = query(
        announcementsRef, 
        where('type', '==', 'announcement')
      );
      
      const announcementSnapshot = await getDocs(announcementQuery);
      console.log(`📋 Found ${announcementSnapshot.size} announcements in Firebase`);
      
      const firebaseAnnouncements = [];
      
      announcementSnapshot.forEach((doc) => {
        const announcement = doc.data();
        // Only include active announcements
        if (announcement.active !== false) {
          console.log('📢 Loading announcement:', announcement.title);
          console.log('  - Has Image:', !!announcement.image);
          console.log('  - Image Size:', announcement.imageSize ? (announcement.imageSize / 1024 / 1024).toFixed(2) + ' MB' : 'No image');
          console.log('  - Image Type:', announcement.image ? announcement.image.substring(0, 30) + '...' : 'N/A');
          
          firebaseAnnouncements.push({
            id: doc.id,
            title: announcement.title,
            content: announcement.content,
            image: announcement.image,
            timestamp: announcement.timestamp,
            isNew: isRecentAnnouncement(announcement.timestamp)
          });
        }
      });
      
      // Sort manually by timestamp to avoid composite index requirement
      firebaseAnnouncements.sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp || 0);
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp || 0);
        return timeB - timeA;
      });
      
      console.log(`✅ Processed ${firebaseAnnouncements.length} announcements`);
      
      // Combine static and dynamic announcements
      combineAndDisplayAnnouncements(firebaseAnnouncements);
      
    } catch (error) {
      console.error('❌ Error loading announcements from Firebase:', error);
      // If Firebase fails, just use static announcements
      console.log('🔄 Falling back to static announcements');
      initializeStaticSlider();
    }
  }
  
  // Check if announcement is recent (within 7 days)
  function isRecentAnnouncement(timestamp) {
    if (!timestamp) return false;
    const announcementDate = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now - announcementDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 7;
  }
  
  // Combine static and dynamic announcements
  function combineAndDisplayAnnouncements(firebaseAnnouncements) {
    console.log('🎯 Combining and displaying announcements...');
    console.log('📊 Firebase announcements count:', firebaseAnnouncements.length);
    
    // Clear slider track completely
    sliderTrack.innerHTML = '';
    slides = [];
    
    // ONLY show Firebase announcements (admin uploaded content)
    if (firebaseAnnouncements.length > 0) {
      console.log('📸 Displaying admin-uploaded announcements only');
      firebaseAnnouncements.forEach((announcement, index) => {
        console.log(`🎨 Creating slide ${index + 1} for: ${announcement.title}`);
        const slide = createDynamicSlide(announcement, index);
        sliderTrack.appendChild(slide);
        slides.push(slide);
      });
    } else {
      console.log('⚠️ No admin announcements found. Showing empty state.');
      // Show empty state message instead of static slides
      const emptySlide = createEmptyStateSlide();
      sliderTrack.appendChild(emptySlide);
      slides.push(emptySlide);
    }
    
    console.log(`📊 Total slides to display: ${slides.length}`);
    
    // Initialize dots
    createDots();
    
    // Initialize slider functionality
    updateSlider();
    startAutoSlide();
    addEventListeners();
    
    console.log('✅ Slider initialization complete - showing only admin content');
  }
  
  // Create empty state slide when no admin announcements exist
  function createEmptyStateSlide() {
    const slide = document.createElement('div');
    slide.className = 'slide active';
    
    slide.innerHTML = `
      <div class="announcement-card">
        <div class="announcement-header">
          <h3>No Announcements Yet</h3>
          <span class="announcement-badge new-badge">INFO</span>
        </div>
        <div class="announcement-content">
          <div class="announcement-image">
            <div style="font-size: 48px; opacity: 0.3; text-align: center; width: 100%;">📢</div>
          </div>
          <div class="announcement-body">
            <p>Administrators haven't posted any announcements yet. Check back later for updates from DENR-CENRO Sta. Cruz.</p>
          </div>
        </div>
        <div class="announcement-footer">
          <span class="announcement-date">Waiting for content...</span>
        </div>
      </div>
    `;
    
    return slide;
  }
  
  // Create slide from Firebase announcement
  function createDynamicSlide(announcement, index) {
    console.log(`🎨 Creating dynamic slide for: ${announcement.title}`);
    console.log(`🖼️ Image data length: ${announcement.image ? announcement.image.length : 0} characters`);
    console.log(`🖼️ Image starts with: ${announcement.image ? announcement.image.substring(0, 50) : 'No image'}`);
    
    const slide = document.createElement('div');
    slide.className = 'slide';
    if (index === 0) slide.classList.add('active');
    
    const badgeClass = announcement.isNew ? 'new-badge' : 'old-badge';
    const badgeText = announcement.isNew ? 'NEW' : 'PREVIOUS';
    
    const imageHtml = announcement.image ? `
      <div class="announcement-image">
        <img src="${announcement.image}" 
             alt="${announcement.title}" 
             onload="console.log('✅ Image loaded successfully for: ${announcement.title}');"
             onerror="console.log('❌ Image failed to load for: ${announcement.title}'); console.log('Image src length:', this.src.length); this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <div class="fallback-content" style="display: none;">
          <div style="font-size: 48px; opacity: 0.3;">📢</div>
          <div style="color: #16a34a; font-size: 14px; font-weight: 500;">Announcement</div>
        </div>
      </div>
    ` : '';
    
    console.log(`🖼️ Image HTML generated: ${imageHtml ? 'Yes' : 'No'}`);
    
    slide.innerHTML = `
      <div class="announcement-card">
        <div class="announcement-header">
          <h3>${announcement.title}</h3>
          <span class="announcement-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="announcement-content">
          ${imageHtml}
          <div class="announcement-body">
            ${announcement.content}
          </div>
        </div>
        <div class="announcement-footer">
          <span class="announcement-date">Posted: ${formatDate(announcement.timestamp)}</span>
        </div>
      </div>
    `;
    
    console.log(`✅ Slide created successfully for: ${announcement.title}`);
    return slide;
  }
  
  // Format date for display
  function formatDate(timestamp) {
    if (!timestamp) return 'Today';
    
    const date = new Date(timestamp);
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
  
  // Create dots navigation
  function createDots() {
    dotsContainer.innerHTML = '';
    dots = [];
    
    slides.forEach((slide, index) => {
      const dot = document.createElement('button');
      dot.className = 'dot';
      if (index === 0) dot.classList.add('active');
      dot.setAttribute('data-slide', index);
      dot.addEventListener('click', () => {
        goToSlide(index);
        resetAutoSlide();
      });
      dotsContainer.appendChild(dot);
      dots.push(dot);
    });
  }
  
  // Initialize static slider (fallback)
  function initializeStaticSlider() {
    slides = Array.from(sliderTrack.children);
    dots = Array.from(dotsContainer.children);
    
    updateSlider();
    startAutoSlide();
    addEventListeners();
  }
  
  // Update slider position
  function updateSlider() {
    // Update slide positions
    slides.forEach((slide, index) => {
      slide.classList.toggle('active', index === currentSlide);
    });
    
    // Update dots
    dots.forEach((dot, index) => {
      dot.classList.toggle('active', index === currentSlide);
    });
    
    // Update track position
    const offset = -currentSlide * 100;
    sliderTrack.style.transform = `translateX(${offset}%)`;
  }
  
  // Go to specific slide
  function goToSlide(slideIndex) {
    if (slideIndex < 0) {
      currentSlide = slides.length - 1;
    } else if (slideIndex >= slides.length) {
      currentSlide = 0;
    } else {
      currentSlide = slideIndex;
    }
    updateSlider();
    resetAutoSlide();
  }
  
  // Next slide
  function nextSlide() {
    goToSlide(currentSlide + 1);
  }
  
  // Previous slide
  function prevSlide() {
    goToSlide(currentSlide - 1);
  }
  
  // Auto slide functionality
  function startAutoSlide() {
    autoSlideInterval = setInterval(nextSlide, 5000); // Change slide every 5 seconds
  }
  
  function stopAutoSlide() {
    clearInterval(autoSlideInterval);
  }
  
  function resetAutoSlide() {
    stopAutoSlide();
    startAutoSlide();
  }
  
  // Add event listeners
  function addEventListeners() {
    // Navigation buttons
    if (prevBtn) prevBtn.addEventListener('click', () => {
      prevSlide();
      resetAutoSlide();
    });
    
    if (nextBtn) nextBtn.addEventListener('click', () => {
      nextSlide();
      resetAutoSlide();
    });
    
    // Touch/swipe support for mobile
    if (sliderTrack) {
      sliderTrack.addEventListener('touchstart', handleTouchStart, { passive: true });
      sliderTrack.addEventListener('touchend', handleTouchEnd, { passive: true });
    }
    
    // Pause auto-slide on hover
    const sliderContainer = document.querySelector('.announcements-slider-container');
    if (sliderContainer) {
      sliderContainer.addEventListener('mouseenter', stopAutoSlide);
      sliderContainer.addEventListener('mouseleave', startAutoSlide);
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        prevSlide();
        resetAutoSlide();
      } else if (e.key === 'ArrowRight') {
        nextSlide();
        resetAutoSlide();
      }
    });
  }
  
  // Touch event handlers
  function handleTouchStart(e) {
    touchStartX = e.touches[0].clientX;
  }
  
  function handleTouchEnd(e) {
    touchEndX = e.changedTouches[0].clientX;
    handleSwipe();
  }
  
  function handleSwipe() {
    const swipeThreshold = 50; // Minimum swipe distance
    const diff = touchStartX - touchEndX;
    
    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        // Swipe left - next slide
        nextSlide();
      } else {
        // Swipe right - previous slide
        prevSlide();
      }
      resetAutoSlide();
    }
  }
  
  // Initialize the slider
  initSlider();
});
