// Announcement Slider Functionality
document.addEventListener('DOMContentLoaded', function() {
  const sliderTrack = document.getElementById('sliderTrack');
  const slides = document.querySelectorAll('.slide');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const dots = document.querySelectorAll('.dot');
  
  let currentSlide = 0;
  let autoSlideInterval;
  let touchStartX = 0;
  let touchEndX = 0;
  
  // Initialize slider
  function initSlider() {
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
    
    // Dot navigation
    dots.forEach((dot, index) => {
      dot.addEventListener('click', () => {
        goToSlide(index);
        resetAutoSlide();
      });
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
  if (sliderTrack && slides.length > 0) {
    initSlider();
  }
});
