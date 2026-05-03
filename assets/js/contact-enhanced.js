// Enhanced Contact Section JavaScript
document.addEventListener('DOMContentLoaded', function() {
  // Contact button functions
  window.openMap = function() {
    // Open Google Maps with the office location
    const address = encodeURIComponent('So. Maunawain, Brgy. Duhat, Sta. Cruz, Laguna');
    window.open(`https://www.google.com/maps/search/?api=1&query=${address}`, '_blank');
  };

  window.makeCall = function() {
    // Initiate phone call
    window.location.href = 'tel:+63495368903';
  };

  window.sendEmail = function() {
    // Open Gmail directly with pre-filled email
    const subject = encodeURIComponent('DENR Permit Inquiry');
    const body = encodeURIComponent('Hello DENR-CENRO Sta. Cruz,\n\nI would like to inquire about environmental permits. Please provide me with information regarding:\n\n[Please specify your inquiry here]\n\nThank you.\n\nBest regards,\n[Your Name]\n[Your Contact Information]');
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=cenrostacruz@denr.gov.ph&su=${subject}&body=${body}`;
    window.open(gmailUrl, '_blank');
  };

  // Quick contact form functionality
  const quickForm = document.querySelector('.quick-contact-form');
  if (quickForm) {
    quickForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      const nameInput = quickForm.querySelector('input[type="text"]');
      const emailInput = quickForm.querySelector('input[type="email"]');
      const messageInput = quickForm.querySelector('textarea');
      
      // Basic validation
      if (!nameInput.value.trim()) {
        showNotification('Please enter your name', 'error');
        nameInput.focus();
        return;
      }
      
      if (!emailInput.value.trim() || !isValidEmail(emailInput.value)) {
        showNotification('Please enter a valid email address', 'error');
        emailInput.focus();
        return;
      }
      
      if (!messageInput.value.trim()) {
        showNotification('Please enter your message', 'error');
        messageInput.focus();
        return;
      }
      
      // Simulate form submission
      const submitBtn = quickForm.querySelector('.quick-submit-btn');
      const originalText = submitBtn.innerHTML;
      submitBtn.innerHTML = '<span>⏳</span> Sending...';
      submitBtn.disabled = true;
      
      setTimeout(() => {
        showNotification('Message sent successfully! We will get back to you soon.', 'success');
        quickForm.reset();
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
      }, 2000);
    });
  }

  // Email validation helper
  function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Notification system
  function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existingNotification = document.querySelector('.contact-notification');
    if (existingNotification) {
      existingNotification.remove();
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.className = `contact-notification ${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
        <span class="notification-message">${message}</span>
      </div>
    `;

    // Add styles
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#16a34a' : type === 'error' ? '#dc2626' : '#3b82f6'};
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
      z-index: 10000;
      transform: translateX(400px);
      transition: transform 0.3s ease;
      max-width: 400px;
    `;

    // Add to page
    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
      notification.style.transform = 'translateX(0)';
    }, 100);

    // Remove after 5 seconds
    setTimeout(() => {
      notification.style.transform = 'translateX(400px)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 5000);
  }

  // Add hover effects to contact cards
  const contactCards = document.querySelectorAll('.contact-card-enhanced');
  contactCards.forEach(card => {
    card.addEventListener('mouseenter', function() {
      this.style.transform = 'translateY(-8px) scale(1.02)';
    });
    
    card.addEventListener('mouseleave', function() {
      this.style.transform = 'translateY(0) scale(1)';
    });
  });

  // Add ripple effect to buttons
  const buttons = document.querySelectorAll('.contact-action-btn, .quick-submit-btn');
  buttons.forEach(button => {
    button.addEventListener('click', function(e) {
      const ripple = document.createElement('span');
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;
      
      ripple.style.cssText = `
        position: absolute;
        width: ${size}px;
        height: ${size}px;
        left: ${x}px;
        top: ${y}px;
        background: rgba(255, 255, 255, 0.5);
        border-radius: 50%;
        transform: scale(0);
        animation: ripple 0.6s ease-out;
        pointer-events: none;
      `;
      
      this.style.position = 'relative';
      this.style.overflow = 'hidden';
      this.appendChild(ripple);
      
      setTimeout(() => {
        ripple.remove();
      }, 600);
    });
  });

  // Add CSS for ripple animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ripple {
      to {
        transform: scale(4);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);

  // Dynamic office hours status
  updateOfficeHoursStatus();
  setInterval(updateOfficeHoursStatus, 60000); // Update every minute

  function updateOfficeHoursStatus() {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentTime = hour * 60 + minute;

    let isOpen = false;
    
    // Check weekday hours (8:00 AM - 5:00 PM)
    if (day >= 1 && day <= 5) { // Monday to Friday
      if (currentTime >= 8 * 60 && currentTime <= 17 * 60) {
        isOpen = true;
      }
    }
    // Check Saturday hours (8:00 AM - 12:00 PM)
    else if (day === 6) { // Saturday
      if (currentTime >= 8 * 60 && currentTime <= 12 * 60) {
        isOpen = true;
      }
    }

    // Update visual indicator if needed
    const statusIndicators = document.querySelectorAll('.hours-status');
    statusIndicators.forEach(indicator => {
      if (indicator.textContent.includes('OPEN') && isOpen) {
        indicator.style.background = '#dcfce7';
        indicator.style.color = '#166534';
      } else if (indicator.textContent.includes('CLOSED') && !isOpen) {
        indicator.style.background = '#fee2e2';
        indicator.style.color = '#dc2626';
      }
    });
  }

  // Add smooth scroll behavior for contact section
  const contactLinks = document.querySelectorAll('a[href="#contact"]');
  contactLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const contactSection = document.getElementById('contact');
      if (contactSection) {
        contactSection.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  console.log('Enhanced Contact Section loaded successfully!');
});
