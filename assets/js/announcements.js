// Announcement Tabs Functionality
document.addEventListener('DOMContentLoaded', function() {
  // Tab switching functionality
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', function() {
      const targetTab = this.getAttribute('data-tab');
      
      // Remove active class from all buttons and contents
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // Add active class to clicked button and corresponding content
      this.classList.add('active');
      const targetContent = document.getElementById(targetTab + 'Tab');
      if (targetContent) {
        targetContent.classList.add('active');
      }
      
      // Populate "All Announcements" tab when clicked
      if (targetTab === 'all') {
        populateAllAnnouncements();
      }
    });
  });
  
  // Function to populate all announcements
  function populateAllAnnouncements() {
    const allTab = document.getElementById('allTab');
    const allList = allTab.querySelector('.announcements-list');
    
    if (allList) {
      // Clear existing content
      allList.innerHTML = '';
      
      // Get announcements from new tab
      const newAnnouncements = document.querySelectorAll('#newTab .announcement-card');
      // Get announcements from old tab
      const oldAnnouncements = document.querySelectorAll('#oldTab .announcement-card');
      
      // Clone and append all announcements
      newAnnouncements.forEach(card => {
        const clone = card.cloneNode(true);
        allList.appendChild(clone);
      });
      
      oldAnnouncements.forEach(card => {
        const clone = card.cloneNode(true);
        allList.appendChild(clone);
      });
    }
  }
});
