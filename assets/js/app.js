import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, getDocs, doc, getDoc, setDoc, orderBy, limit, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Load website content from Firebase
async function loadWebsiteContent() {
  try {
    // Load welcome message
    const welcomeRef = collection(db, 'websiteContent');
    const welcomeQuery = query(welcomeRef, where('type', '==', 'welcome'));
    const welcomeSnapshot = await getDocs(welcomeQuery);
    
    if (!welcomeSnapshot.empty) {
      const welcome = welcomeSnapshot.docs[0].data();
      const heroTitle = document.querySelector('.hero-content h1');
      const heroDesc = document.querySelector('.hero-content p');
      if (heroTitle && welcome.title) heroTitle.textContent = welcome.title;
      if (heroDesc && welcome.message) heroDesc.textContent = welcome.message;
    }

    // Load contact info
    const contactQuery = query(welcomeRef, where('type', '==', 'contact'));
    const contactSnapshot = await getDocs(contactQuery);
    
    if (!contactSnapshot.empty) {
      const contact = contactSnapshot.docs[0].data();
      const contactAddress = document.getElementById('contactAddress');
      const contactPhone = document.getElementById('contactPhone');
      const contactEmail = document.getElementById('contactEmail');
      if (contactAddress && contact.address) contactAddress.textContent = contact.address;
      if (contactPhone && contact.phone) contactPhone.textContent = contact.phone;
      if (contactEmail && contact.email) contactEmail.textContent = contact.email;
    }

    // Load office hours
    const officeQuery = query(welcomeRef, where('type', '==', 'office'));
    const officeSnapshot = await getDocs(officeQuery);
    
    if (!officeSnapshot.empty) {
      const office = officeSnapshot.docs[0].data();
      const officeWeekday = document.getElementById('officeWeekday');
      const officeSaturday = document.getElementById('officeSaturday');
      const officeSunday = document.getElementById('officeSunday');
      if (officeWeekday && office.weekday) officeWeekday.textContent = office.weekday;
      if (officeSaturday && office.saturday) officeSaturday.textContent = office.saturday;
      if (officeSunday && office.sunday) officeSunday.textContent = office.sunday;
    }

    // Load announcements
    const announcementQuery = query(welcomeRef, where('type', '==', 'announcement'), where('active', '==', true));
    const announcementSnapshot = await getDocs(announcementQuery);
    
    // Get announcements slider elements
    const sliderTrack = document.getElementById('sliderTrack');
    const sliderDots = document.getElementById('sliderDots');
    
    if (!announcementSnapshot.empty && sliderTrack) {
      // Clear existing content
      sliderTrack.innerHTML = '';
      if (sliderDots) sliderDots.innerHTML = '';
      
      // Add dynamic announcements to slider
      announcementSnapshot.forEach((doc, index) => {
        const announcement = doc.data();
        const announcementSlide = document.createElement('div');
        announcementSlide.className = 'update-slide';
        announcementSlide.innerHTML = `
          <div class="announcement-card">
            <div class="announcement-header">
              <h3>${announcement.title}</h3>
              <span class="announcement-badge new-badge">NEW</span>
            </div>
            <div class="announcement-content">
              <div class="announcement-body">
                <p>${announcement.content}</p>
              </div>
            </div>
            <div class="announcement-footer">
              <span class="announcement-date">Posted: ${announcement.createdAt ? new Date(announcement.createdAt.toDate()).toLocaleDateString() : 'Today'}</span>
            </div>
          </div>
        `;
        sliderTrack.appendChild(announcementSlide);
        
        // Add dot indicator
        if (sliderDots) {
          const dot = document.createElement('button');
          dot.className = 'indicator-dot' + (index === 0 ? ' active' : '');
          dot.setAttribute('aria-label', `Go to announcement ${index + 1}`);
          sliderDots.appendChild(dot);
        }
      });
      
      // Initialize slider functionality if announcements exist
      if (typeof initializeSlider === 'function') {
        initializeSlider();
      }
    }

    // Load permit types
    const permitQuery = query(welcomeRef, where('type', '==', 'permit'));
    const permitSnapshot = await getDocs(permitQuery);
    
    const permitTypesGrid = document.getElementById('permitTypesGrid');
    if (permitTypesGrid) {
      if (!permitSnapshot.empty) {
        let permitsHTML = '';
        permitSnapshot.forEach((doc) => {
          const permit = doc.data();
          const requirements = permit.requirements || [];
          const requirementsList = requirements.length > 0 
            ? '<ul style="margin: 12px 0; padding-left: 20px;">' + requirements.map(r => `<li>${r}</li>`).join('') + '</ul>'
            : '';
          permitsHTML += `
            <div class="permit-type-card">
              <h3>${permit.name}</h3>
              <p>${permit.description || ''}</p>
              ${requirementsList}
              <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
                <p style="margin: 4px 0;"><strong>Processing Time:</strong> ${permit.processingTime || 'N/A'}</p>
                <p style="margin: 4px 0;"><strong>Fee:</strong> ${permit.fee || 'N/A'}</p>
              </div>
            </div>
          `;
        });
        permitTypesGrid.innerHTML = permitsHTML;
      } else {
        permitTypesGrid.innerHTML = '<p style="text-align: center; color: #666;">No permit types available</p>';
      }
    }

    // Load FAQs from both websiteContent and dedicated faqs collection
    await loadFAQs();
  } catch (error) {
    console.error('Error loading website content:', error);
  }
}

// Load FAQs from Firebase
async function loadFAQs() {
  try {
    const faqList = document.getElementById('faqList');
    if (!faqList) return;

    // Load FAQs from dedicated faqs collection first (admin-added)
    const faqsRef = collection(db, 'faqs');
    const faqsSnapshot = await getDocs(faqsRef);
    
    // Also load from websiteContent for backward compatibility
    const welcomeRef = collection(db, 'websiteContent');
    const faqQuery = query(welcomeRef, where('type', '==', 'faq'));
    const legacyFaqSnapshot = await getDocs(faqQuery);
    
    let allFAQs = [];
    
    // Process admin-added FAQs
    faqsSnapshot.forEach((doc) => {
      const faq = doc.data();
      if (faq.active !== false) { // Only show active FAQs
        allFAQs.push({
          question: faq.question,
          answer: faq.answer,
          category: faq.category || 'general',
          order: faq.order || 999,
          source: 'admin'
        });
      }
    });
    
    // Process legacy FAQs
    legacyFaqSnapshot.forEach((doc) => {
      const faq = doc.data();
      allFAQs.push({
        question: faq.question,
        answer: faq.answer,
        category: faq.category || 'general',
        order: faq.order || 1000,
        source: 'legacy'
      });
    });
    
    // Sort by order field
    allFAQs.sort((a, b) => a.order - b.order);
    
    if (allFAQs.length > 0) {
      let faqHTML = '';
      allFAQs.forEach((faq, index) => {
        // Map category to existing categories
        let categoryClass = 'application';
        if (faq.category === 'requirements') categoryClass = 'requirements';
        else if (faq.category === 'processing') categoryClass = 'processing';
        else if (faq.category === 'general') categoryClass = 'application';
        
        faqHTML += `
          <div class="faq-item" data-category="${categoryClass}">
            <div class="faq-question">
              <h3>${faq.question}</h3>
              <span class="faq-toggle">+</span>
            </div>
            <div class="faq-answer">
              <p>${faq.answer}</p>
            </div>
          </div>
        `;
      });
      faqList.innerHTML = faqHTML;
    } else {
      // Keep the static FAQs if no dynamic ones exist
      console.log('No FAQs found in database, keeping static FAQs');
    }
    
    // Re-initialize FAQ functionality after loading
    setTimeout(() => {
      initializeFAQ();
    }, 100);
    
  } catch (error) {
    console.error('Error loading FAQs:', error);
  }
}

// Load website content on page load
document.addEventListener('DOMContentLoaded', loadWebsiteContent);

// Field-level Validation System
function showFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  
  // Remove existing error
  clearFieldError(fieldId);
  
  // Add error styling
  field.classList.add('field-error');
  
  // Create error message element
  const errorElement = document.createElement('div');
  errorElement.className = 'field-error-message';
  errorElement.textContent = message;
  
  // Insert error message after field
  field.parentNode.insertBefore(errorElement, field.nextSibling);
  
  // Focus on the field
  field.focus();
  
  // Auto-remove error after user starts typing
  field.addEventListener('input', () => clearFieldError(fieldId), { once: true });
}

function clearFieldError(fieldId) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  
  // Remove error styling
  field.classList.remove('field-error');
  
  // Remove error message
  const errorMessage = field.parentNode.querySelector('.field-error-message');
  if (errorMessage) {
    errorMessage.remove();
  }
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// UI helpers with safe fallbacks (prevents errors when elements are absent)
const _noopEl = { addEventListener: ()=>{}, style: {}, value: '', textContent: '', innerHTML: '', getIdToken: async ()=>'' };
const q = s => document.querySelector(s) || _noopEl;
const qa = s => Array.from(document.querySelectorAll(s) || []);

const authEmail = q('#authEmail');
const authPassword = q('#authPassword');
const authSignupBtn = q('#authSignupBtn');
const authSigninBtn = q('#authSigninBtn');
const authResendBtn = q('#authResendBtn');
const authCloseBtn = q('#authClose');
const authModalEl = q('#authModal');
const authMsg = q('#authMsg');
const authSignupForm = q('#authSignupForm');
const authSigninForm = q('#authSigninForm');
const showSignupLink = q('#showSignup');
const showMapPin = q('#showMapPin');
const signupEmail = q('#signupEmail');
const signupPassword = q('#signupPassword');
const signupConfirm = q('#signupConfirm');
const firstName = q('#firstName');
const surname = q('#surname');
const middleName = q('#middleName');
const suffix = q('#suffix');
const mobile = q('#mobile');
const address = q('#address');
const forgotLink = q('#forgotLink');
const signoutBtn = q('#signoutBtn');
const out = q('#out');
const userInfo = q('#userInfo');

// Nav
qa('.nav-btn').forEach(btn => btn.addEventListener('click', (e) => {
  qa('.nav-btn').forEach(b => b.classList.remove('active'));
  e.currentTarget.classList.add('active');
  const target = e.currentTarget.dataset.target;
  qa('.panel').forEach(p => p.style.display = 'none');
  q('#' + target).style.display = '';
}));

// Auth modal handlers - wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  // Re-select elements after DOM is ready
  const authSigninBtn = document.getElementById('authSigninBtn');
  const authSignupBtn = document.getElementById('authSignupBtn');
  const authResendBtn = document.getElementById('authResendBtn');
  const authCloseBtn = document.getElementById('authClose');
  const authModalEl = document.getElementById('authModal');
  const authMsg = document.getElementById('authMsg');
  const authSignupForm = document.getElementById('authSignupForm');
  const authSigninForm = document.getElementById('authSigninForm');
  const showSignupLink = document.getElementById('showSignup');
  const showMapPin = document.getElementById('showMapPin');
  const signupEmail = document.getElementById('signupEmail');
  const signupPassword = document.getElementById('signupPassword');
  const signupConfirm = document.getElementById('signupConfirm');
  const firstName = document.getElementById('firstName');
  const surname = document.getElementById('surname');
  const middleName = document.getElementById('middleName');
  const suffix = document.getElementById('suffix');
  const mobile = document.getElementById('mobile');
  const address = document.getElementById('address');
  const forgotLink = document.getElementById('forgotLink');
  const authEmail = document.getElementById('authEmail');
  const authPassword = document.getElementById('authPassword');

  if (authSignupBtn) {
    authSignupBtn.addEventListener('click', async () => {
      try {
        const email = (signupEmail.value || authEmail.value || '').trim();
        const pass = signupPassword.value; const confirm = signupConfirm.value;
        if(!email || !pass) return authMsg.textContent = 'Please enter email and password.';
        if(pass !== confirm) return authMsg.textContent = 'Passwords do not match.';
        // create user
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        // store profile fields as customer
        await setDoc(doc(db, 'users', cred.user.uid), {
          email: email,
          role: 'customer',
          firstName: firstName.value || '',
          surname: surname.value || '',
          middleName: middleName.value || '',
          suffix: suffix.value || '',
          mobile: mobile.value || '',
          address: address.value || '',
          latitude: document.getElementById('latitude')?.value || null,
          longitude: document.getElementById('longitude')?.value || null,
          emailVerified: false,
          createdAt: serverTimestamp()
        });
        // send verification email
        await sendEmailVerification(cred.user);
        authMsg.textContent = 'Account created! Please check your email to verify your account before logging in.';
        authResendBtn.style.display = '';
        // switch to signin form
        authSignupForm.style.display = 'none';
        authSigninForm.style.display = '';
        document.getElementById('authModalTitle').textContent = 'Login to Your Account';
        // clear sensitive fields
        signupPassword.value = ''; signupConfirm.value = '';
      } catch (err) { authMsg.textContent = 'Sign up error: ' + err.message }
    });
  }

  if (authSigninBtn) {
    authSigninBtn.addEventListener('click', async () => {
      try {
        console.log('🔍 LOGIN DEBUG: Starting login process');
        const email = authEmail.value.trim(); 
        const pass = authPassword.value;
        console.log('🔍 LOGIN DEBUG: Email:', email);
        
        let isValid = true;
        
        // Clear previous errors
        clearFieldError('authEmail');
        clearFieldError('authPassword');
        
        // Email validation
        if (!email) {
          showFieldError('authEmail', 'Please enter your email address.');
          isValid = false;
        } else if (!validateEmail(email)) {
          showFieldError('authEmail', 'Please enter a valid email address.');
          isValid = false;
        }
        
        // Password validation
        if (!pass) {
          showFieldError('authPassword', 'Please enter your password.');
          isValid = false;
        } else if (pass.length < 6) {
          showFieldError('authPassword', 'Password must be at least 6 characters long.');
          isValid = false;
        }
        
        if (!isValid) return;
        
        console.log('🔍 LOGIN DEBUG: Calling signInWithEmailAndPassword');
        const cred = await signInWithEmailAndPassword(auth, email, pass);
        console.log('🔍 LOGIN DEBUG: Sign in successful, user:', cred.user.email);
        
        // Allow admin and staff to sign in even if email not verified
        try{
          console.log('🔍 LOGIN DEBUG: Getting ID token result');
          const idToken = await cred.user.getIdTokenResult(true);
          console.log('🔍 LOGIN DEBUG: ID token claims:', idToken.claims);
          
          let role = idToken.claims.role;
          console.log('🔍 LOGIN DEBUG: Role from token:', role);
          
          if(!role){
            console.log('🔍 LOGIN DEBUG: No role in token, checking Firestore');
            // fallback to Firestore users doc
            try{
              const udoc = await getDoc(doc(db,'users',cred.user.uid));
              console.log('🔍 LOGIN DEBUG: Firestore user doc exists:', udoc.exists());
              if (udoc.exists()) {
                console.log('🔍 LOGIN DEBUG: Firestore user data:', udoc.data());
              }
              role = (udoc.exists() && udoc.data().role) ? udoc.data().role : 'customer';
              console.log('🔍 LOGIN DEBUG: Final role from Firestore:', role);
            }catch(e){ 
              console.log('🔍 LOGIN DEBUG: Error getting Firestore doc:', e);
              role = 'customer' 
            }
          }
          
          // Customers MUST have email verified
          if(role === 'customer' && !cred.user.emailVerified){
            console.log('🔍 LOGIN DEBUG: Customer email not verified');
            authMsg.textContent = 'Email not verified. Please check your inbox and click the verification link.'; 
            authResendBtn.style.display = '';
            return;
          }
          
          // Admin and staff can sign in without verification
          console.log('🔍 LOGIN DEBUG: Login successful, role:', role);
          authMsg.textContent = 'Signed in: ' + cred.user.email + ' (role: '+role+')'; 
          authResendBtn.style.display = 'none';
          closeAuthModal();

          // Clear the justLoggedOut flag so onAuthStateChanged can redirect properly
          sessionStorage.removeItem('justLoggedOut');
          
          // TEMPORARILY DISABLED REDIRECTS FOR TESTING
          // Set flag to prevent onAuthStateChanged from redirecting again
          sessionStorage.setItem('loginRedirect', 'true');

          // Redirect based on role
          console.log('🔍 LOGIN DEBUG: About to redirect based on role');
          console.log('🔍 LOGIN DEBUG: Role detected:', role, '- User should go to:', role + '-dashboard.html');
          if(role === 'admin'){
            console.log('🔍 LOGIN DEBUG: Redirecting to admin dashboard');
            window.location.href = '/admin-dashboard.html';
          } else if(role === 'staff'){
            console.log('🔍 LOGIN DEBUG: Redirecting to staff dashboard');
            window.location.href = '/staff-dashboard.html';
          } else if(role === 'customer'){
            console.log('🔍 LOGIN DEBUG: Redirecting to customer dashboard');
            window.location.href = '/customer-dashboard.html';
          }
        }catch(e){ 
          console.log('🔍 LOGIN DEBUG: Error in token processing:', e);
          authMsg.textContent = 'Signed in: ' + cred.user.email; 
          closeAuthModal(); 
        }
      } catch (err) { 
        console.log('🔍 LOGIN DEBUG: Sign in error:', err);
        authMsg.textContent = 'Sign in error: ' + err.message 
      }
    });

    // Allow Enter key to trigger login
    const triggerLoginOnEnter = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        authSigninBtn.click();
      }
    };
    if (authEmail) authEmail.addEventListener('keypress', triggerLoginOnEnter);
    if (authPassword) authPassword.addEventListener('keypress', triggerLoginOnEnter);
  }

  if (authResendBtn) {
    authResendBtn.addEventListener('click', async ()=>{
      try{
        const user = auth.currentUser;
        if(!user) return authMsg.textContent = 'Sign in first to resend verification.';
        await sendEmailVerification(user);
        authMsg.textContent = 'Verification email resent.';
      }catch(err){ authMsg.textContent = 'Error: '+err.message }
    });
  }

  if (forgotLink) {
    forgotLink.addEventListener('click', (e)=>{
      e.preventDefault();
      // Close auth modal and show forgot password modal
      closeAuthModal();
      const forgotModal = document.getElementById('forgotPasswordModal');
      if (forgotModal) {
        forgotModal.style.display = 'flex';
        // Pre-fill email if available
        const email = (authEmail.value || signupEmail.value || '').trim();
        const forgotEmailInput = document.getElementById('forgotPasswordEmail');
        if (email && forgotEmailInput) {
          forgotEmailInput.value = email;
        }
      }
    });
  }

  // Forgot password modal handlers
  const forgotPasswordClose = document.getElementById('forgotPasswordClose');
  const forgotPasswordSubmitBtn = document.getElementById('forgotPasswordSubmitBtn');
  const forgotPasswordModal = document.getElementById('forgotPasswordModal');
  const backToLogin = document.getElementById('backToLogin');
  const forgotPasswordEmail = document.getElementById('forgotPasswordEmail');
  const forgotPasswordMsg = document.getElementById('forgotPasswordMsg');

  // Close forgot password modal
  function closeForgotPasswordModal() {
    if (forgotPasswordModal) {
      forgotPasswordModal.style.display = 'none';
    }
  }

  if (forgotPasswordClose) {
    forgotPasswordClose.addEventListener('click', closeForgotPasswordModal);
  }

  if (forgotPasswordModal) {
    forgotPasswordModal.addEventListener('click', (e)=>{ 
      if(e.target===forgotPasswordModal) closeForgotPasswordModal(); 
    });
  }

  // Back to login link
  if (backToLogin) {
    backToLogin.addEventListener('click', (e)=>{ 
      e.preventDefault(); 
      closeForgotPasswordModal();
      openAuthModal('signin');
    });
  }

  // Submit forgot password form
  if (forgotPasswordSubmitBtn) {
    forgotPasswordSubmitBtn.addEventListener('click', async ()=>{
      const email = forgotPasswordEmail.value.trim();
      if(!email) return forgotPasswordMsg.textContent = 'Please enter your email address.';
      
      try{
        await sendPasswordResetEmail(auth, email);
        forgotPasswordMsg.textContent = 'Password reset email sent! Please check your inbox.';
        forgotPasswordEmail.value = '';
        
        // Auto-close modal after 3 seconds
        setTimeout(() => {
          closeForgotPasswordModal();
          openAuthModal('signin');
        }, 3000);
      }catch(err){ 
        forgotPasswordMsg.textContent = 'Error: '+err.message;
      }
    });
  }

  // Allow Enter key to submit forgot password form
  if (forgotPasswordEmail) {
    forgotPasswordEmail.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        forgotPasswordSubmitBtn.click();
      }
    });
  }

  if (signoutBtn) {
    signoutBtn.addEventListener('click', async () => {
      sessionStorage.setItem('justLoggedOut', 'true');
      await signOut(auth);
      out.textContent = 'Signed out';
      sessionStorage.removeItem('justLoggedOut');
    });
  }

  // toggle between signin/signup UI
  if (showSignupLink) {
    showSignupLink.addEventListener('click', (e)=>{ 
      e.preventDefault(); 
      authSignupForm.style.display=''; 
      authSigninForm.style.display='none'; 
      document.getElementById('authModalTitle').textContent='Create Account'; 
    });
  }

  // toggle back to signin from signup
  const showSigninLink = document.getElementById('showSignin');
  if (showSigninLink) {
    showSigninLink.addEventListener('click', (e)=>{ 
      e.preventDefault(); 
      authSignupForm.style.display='none'; 
      authSigninForm.style.display=''; 
      document.getElementById('authModalTitle').textContent='Login to Your Account'; 
    });
  }

  // eye toggle for password fields
  document.querySelectorAll('.eye-btn').forEach(b=> b.addEventListener('click', (e)=>{ 
    const t = e.currentTarget.dataset.target; 
    const inp = document.getElementById(t); 
    if(!inp) return; 
    inp.type = inp.type === 'password' ? 'text' : 'password'; 
  }));

  // show map pin placeholder
  if (showMapPin) {
    showMapPin.addEventListener('click', () => {
      const mapContainer = document.getElementById('mapContainer');
      const latitudeInput = document.getElementById('latitude');
      const longitudeInput = document.getElementById('longitude');
      const addressInput = document.getElementById('address');
      
      mapContainer.style.display = 'block';
      
      if (!window.signupMap) {
        // Initialize map centered on Philippines (Laguna area for DENR)
        window.signupMap = L.map('map').setView([14.0794, 121.3267], 10);
        
        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(window.signupMap);
        
        // Add click handler for pinning location
        window.signupMap.on('click', async function(e) {
          // Remove existing marker if any
          if (window.currentMarker) {
            window.signupMap.removeLayer(window.currentMarker);
          }
          
          // Add new marker
          window.currentMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(window.signupMap);
          
          // Update coordinate fields
          latitudeInput.value = e.latlng.lat.toFixed(6);
          longitudeInput.value = e.latlng.lng.toFixed(6);
          
          // Reverse geocoding - get address from coordinates
          try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${e.latlng.lat}&lon=${e.latlng.lng}`);
            const data = await response.json();
            
            if (data.display_name) {
              // Fill address field with the geocoded address
              addressInput.value = data.display_name;
            }
          } catch (error) {
            console.error('Reverse geocoding error:', error);
          }
        });
      } else {
        window.signupMap.invalidateSize();
      }
    });
  }

  // Search functionality for map
  const mapSearchBtn = document.getElementById('mapSearchBtn');
  const mapSearchInput = document.getElementById('mapSearchInput');

  if (mapSearchBtn && mapSearchInput) {
    mapSearchBtn.addEventListener('click', async () => {
      const searchTerm = mapSearchInput.value.trim();
      if (!searchTerm) return;
      
      try {
        // Forward geocoding - get coordinates from address
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchTerm)}`);
        const data = await response.json();
        
        if (data && data.length > 0) {
          const result = data[0];
          const lat = parseFloat(result.lat);
          const lon = parseFloat(result.lon);
          
          // Move map to the found location
          window.signupMap.setView([lat, lon], 13);
          
          // Remove existing marker if any
          if (window.currentMarker) {
            window.signupMap.removeLayer(window.currentMarker);
          }
          
          // Add marker at found location
          window.currentMarker = L.marker([lat, lon]).addTo(window.signupMap);
          
          // Update coordinate fields
          const latitudeInput = document.getElementById('latitude');
          const longitudeInput = document.getElementById('longitude');
          const addressInput = document.getElementById('address');
          
          latitudeInput.value = lat.toFixed(6);
          longitudeInput.value = lon.toFixed(6);
          addressInput.value = result.display_name || searchTerm;
        } else {
          alert('Address not found. Please try a different search term.');
        }
      } catch (error) {
        console.error('Geocoding error:', error);
        alert('Error searching for address. Please try again.');
      }
    });
    
    // Allow pressing Enter to search
    mapSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        mapSearchBtn.click();
      }
    });
  }

  // Hide map button
  const hideMapPin = document.getElementById('hideMapPin');
  if (hideMapPin) {
    hideMapPin.addEventListener('click', () => {
      const mapContainer = document.getElementById('mapContainer');
      mapContainer.style.display = 'none';
    });
  }

  // Modal close handlers
  if (authCloseBtn) authCloseBtn.addEventListener('click', closeAuthModal);
  if (authModalEl) authModalEl.addEventListener('click', (e)=>{ if(e.target===authModalEl) closeAuthModal(); });
});
q('#writeBtn').addEventListener('click', async () => {
  out.textContent = 'Creating application...';
  const user = auth.currentUser;
  if (!user) return out.textContent = 'Sign in first.';
  try {
    const id = 'app_' + Date.now();
    await setDoc(doc(db, 'applications', id), {
      applicantUid: user.uid,
      applicantEmail: user.email,
      status: 'submitted',
      createdAt: serverTimestamp()
    });
    out.textContent = 'Application created: ' + id;
  } catch (err) { out.textContent = 'Error: ' + err.message }
});

q('#getAppsBtn').addEventListener('click', async () => {
  out.textContent = 'Fetching...';
  const user = auth.currentUser;
  if (!user) return out.textContent = 'Sign in first.';
  try {
    const snap = await getDocs(collection(db, 'applications'));
    const list = snap.docs.filter(d => d.data().applicantUid === user.uid).map(d => ({ id: d.id, ...d.data() }));
    out.textContent = JSON.stringify(list, null, 2);
  } catch (err) { out.textContent = 'Error: ' + err.message }
});

// Staff: list all apps and allow marking inspected
q('#listAllAppsBtn').addEventListener('click', async () => {
  const container = q('#appsList'); container.innerHTML = 'Loading...';
  try {
    const snap = await getDocs(collection(db, 'applications'));
    const apps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    container.innerHTML = '';
    apps.forEach(a => {
      const el = document.createElement('div');
      el.className = 'app-item';
      el.innerHTML = `<strong>${a.id}</strong> — ${a.applicantEmail} — status: <span class="status">${a.status}</span>`;
      const btn = document.createElement('button'); btn.className = 'btn'; btn.textContent = 'Mark inspected';
      btn.addEventListener('click', async () => {
        await setDoc(doc(db, 'applications', a.id), { status: 'inspected', inspectedBy: auth.currentUser.email, inspectedAt: serverTimestamp() }, { merge: true });
        el.querySelector('.status').textContent = 'inspected';
      });
      el.appendChild(btn); container.appendChild(el);
    });
  } catch (err) { container.innerHTML = 'Error: ' + err.message }
});

// Admin: create staff via backend and show analytics
q('#createStaffBtn').addEventListener('click', async () => {
  const email = prompt('Staff email:'); const password = prompt('Staff password:');
  if (!email || !password) return;
  const token = await auth.currentUser.getIdToken();
  try {
    const r = await fetch('http://localhost:3000/admin/createStaff', { method: 'POST', headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+token }, body: JSON.stringify({ email, password }) });
    const j = await r.json(); q('#out').textContent = JSON.stringify(j);
  } catch (err) { q('#out').textContent = 'Error: ' + err.message }
});

q('#refreshAnalytics').addEventListener('click', async () => {
  const token = auth.currentUser && await auth.currentUser.getIdToken();
  try {
    const r = await fetch('http://localhost:3000/admin/analytics', { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json(); q('#analyticsOut').textContent = JSON.stringify(j, null, 2);
  } catch (err) { q('#analyticsOut').textContent = 'Error: ' + err.message }
  try { const snap = await getDocs(collection(db, 'users')); q('#usersOut').textContent = JSON.stringify(snap.docs.map(d=>({id:d.id,...d.data()})), null, 2); } catch(e){ q('#usersOut').textContent = 'Error: '+e.message }
});

// Auth state
onAuthStateChanged(auth, async user => {
  console.log('🔍 AUTH STATE DEBUG: Auth state changed, user:', user?.email);
  
  // Check if login redirect flag is set (means login function already handled redirect)
  if (sessionStorage.getItem('loginRedirect') === 'true') {
    console.log('🔍 AUTH STATE DEBUG: Login redirect flag detected, skipping redirect');
    sessionStorage.removeItem('loginRedirect'); // Clear the flag
    return;
  }
  
  if (user) {
    console.log('🔍 AUTH STATE DEBUG: User is logged in');
    signoutBtn.style.display = '';
    authEmail.value = user.email;
    try {
      console.log('🔍 AUTH STATE DEBUG: Getting ID token result');
      const t = await user.getIdTokenResult(true);
      console.log('🔍 AUTH STATE DEBUG: Token claims:', t.claims);
      
      let role = t.claims.role;
      console.log('🔍 AUTH STATE DEBUG: Role from token:', role);
      
      if(!role){
        console.log('🔍 AUTH STATE DEBUG: No role in token, checking Firestore');
        try{ 
          const udoc = await getDoc(doc(db,'users',user.uid));
          console.log('🔍 AUTH STATE DEBUG: Firestore doc exists:', udoc.exists());
          if (udoc.exists()) {
            console.log('🔍 AUTH STATE DEBUG: Firestore data:', udoc.data());
          }
          role = (udoc.exists() && udoc.data().role) ? udoc.data().role : 'customer';
          console.log('🔍 AUTH STATE DEBUG: Final role from Firestore:', role);
        }catch(e){ 
          console.log('🔍 AUTH STATE DEBUG: Error getting Firestore doc:', e);
          role = 'customer' 
        }
      }
      // For customers require email verification; admin/staff may sign in without verification
      if(role === 'customer'){
        if(!user.emailVerified){
          userInfo.textContent = `${user.email} (unverified)`;
          authMsg.textContent = 'Please verify your email to access customer features.'; authResendBtn.style.display = '';
          q('#customerSection').style.display = 'none';
        } else {
          // Customer is logged in and verified - redirect to customer dashboard only if on login/auth pages
          // (handles browser back button - user shouldn't stay on login page)
          const currentPage = window.location.pathname;
          const isAuthPage = currentPage.includes('index.html') || currentPage === '/' || currentPage.endsWith('/');
          console.log('🔍 AUTH STATE DEBUG: Customer redirect check - currentPage:', currentPage, 'isAuthPage:', isAuthPage, 'justLoggedOut:', sessionStorage.getItem('justLoggedOut'));
          console.log('🔍 AUTH STATE DEBUG: CUSTOMER REDIRECT DISABLED FOR TESTING - Would redirect to customer-dashboard.html');
          // if (!sessionStorage.getItem('justLoggedOut') && isAuthPage) {
          //   console.log('🔍 AUTH STATE DEBUG: Redirecting customer to dashboard');
          //   window.location.href = '/customer-dashboard.html';
          //   return;
          // }
          authResendBtn.style.display = 'none';
          userInfo.textContent = `${user.email} (role: ${role})`;
          q('#customerSection').style.display = '';
        }
      } else if (role === 'admin') {
        // Admin is logged in - redirect to admin dashboard only if on login/auth pages
        const currentPage = window.location.pathname;
        const isAuthPage = currentPage.includes('index.html') || currentPage === '/' || currentPage.endsWith('/');
        console.log('🔍 AUTH STATE DEBUG: Admin redirect check - currentPage:', currentPage, 'isAuthPage:', isAuthPage, 'justLoggedOut:', sessionStorage.getItem('justLoggedOut'));
        console.log('🔍 AUTH STATE DEBUG: ADMIN REDIRECT DISABLED FOR TESTING - Would redirect to admin-dashboard.html');
        // if (!sessionStorage.getItem('justLoggedOut') && isAuthPage) {
        //   console.log('🔍 AUTH STATE DEBUG: Redirecting admin to dashboard');
        //   window.location.href = '/admin-dashboard.html';
        //   return;
        // }
        authResendBtn.style.display = 'none';
        userInfo.textContent = `${user.email} (role: ${role})`;
        q('#customerSection').style.display = '';
      } else if (role === 'staff') {
        // Staff is logged in - redirect to staff dashboard only if on login/auth pages
        const currentPage = window.location.pathname;
        const isAuthPage = currentPage.includes('index.html') || currentPage === '/' || currentPage.endsWith('/');
        console.log('🔍 AUTH STATE DEBUG: Staff redirect check - currentPage:', currentPage, 'isAuthPage:', isAuthPage, 'justLoggedOut:', sessionStorage.getItem('justLoggedOut'));
        console.log('🔍 AUTH STATE DEBUG: STAFF REDIRECT DISABLED FOR TESTING - Would redirect to staff-dashboard.html');
        // if (!sessionStorage.getItem('justLoggedOut') && isAuthPage) {
        //   console.log('🔍 AUTH STATE DEBUG: Redirecting staff to dashboard');
        //   window.location.href = '/staff-dashboard.html';
        //   return;
        // }
        authResendBtn.style.display = 'none';
        userInfo.textContent = `${user.email} (role: ${role})`;
        q('#customerSection').style.display = '';
      }
      q('#staffSection').style.display = (role==='staff' || role==='admin')? '' : 'none';
      q('#adminSection').style.display = (role==='admin')? '' : 'none';
    } catch (err) { userInfo.textContent = user.email }
  } else {
    signoutBtn.style.display = 'none';
    userInfo.textContent = 'Not signed in';
    q('#customerSection').style.display = 'none'; q('#staffSection').style.display = 'none'; q('#adminSection').style.display = 'none';
  }
});

// Simple header button fallbacks and verify helper
// Open auth modal with optional mode 'signin' or 'signup'
window.openAuthModal = function(mode){
  const m = document.getElementById('authModal'); if(!m) return; m.style.display='flex';
  if(mode==='signup'){ document.getElementById('authModalTitle').textContent='Sign Up'; authSignupBtn.style.display=''; authSigninBtn.style.display=''; }
  else { document.getElementById('authModalTitle').textContent='Sign In'; authSignupBtn.style.display=''; authSigninBtn.style.display=''; }
  (document.getElementById('authEmail')||{}).focus();
};

function closeAuthModal(){ const m = document.getElementById('authModal'); if(!m) return; m.style.display='none'; }
if(authCloseBtn) authCloseBtn.addEventListener('click', closeAuthModal);
if(authModalEl) authModalEl.addEventListener('click', (e)=>{ if(e.target===authModalEl) closeAuthModal(); });

// toggle between signin/signup UI
if(showSignupLink) showSignupLink.addEventListener('click', (e)=>{ e.preventDefault(); authSignupForm.style.display=''; authSigninForm.style.display='none'; document.getElementById('authModalTitle').textContent='Create Account'; });

// toggle back to signin from signup
const showSigninLink = document.getElementById('showSignin');
if(showSigninLink) showSigninLink.addEventListener('click', (e)=>{ e.preventDefault(); authSignupForm.style.display='none'; authSigninForm.style.display=''; document.getElementById('authModalTitle').textContent='Login to Your Account'; });

// eye toggle for password fields
qa('.eye-btn').forEach(b=> b.addEventListener('click', (e)=>{ const t = e.currentTarget.dataset.target; const inp = document.getElementById(t); if(!inp) return; inp.type = inp.type === 'password' ? 'text' : 'password'; }));

// show map pin placeholder
if(showMapPin) showMapPin.addEventListener('click', () => {
  const mapContainer = document.getElementById('mapContainer');
  const latitudeInput = document.getElementById('latitude');
  const longitudeInput = document.getElementById('longitude');
  const addressInput = document.getElementById('address');
  
  mapContainer.style.display = 'block';
  
  if (!window.signupMap) {
    // Initialize map centered on Philippines (Laguna area for DENR)
    window.signupMap = L.map('map').setView([14.0794, 121.3267], 10);
    
    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(window.signupMap);
    
    // Add click handler for pinning location
    window.signupMap.on('click', async function(e) {
      // Remove existing marker if any
      if (window.currentMarker) {
        window.signupMap.removeLayer(window.currentMarker);
      }
      
      // Add new marker
      window.currentMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(window.signupMap);
      
      // Update coordinate fields
      latitudeInput.value = e.latlng.lat.toFixed(6);
      longitudeInput.value = e.latlng.lng.toFixed(6);
      
      // Reverse geocoding - get address from coordinates
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${e.latlng.lat}&lon=${e.latlng.lng}`);
        const data = await response.json();
        
        if (data.display_name) {
          // Fill address field with the geocoded address
          addressInput.value = data.display_name;
        }
      } catch (error) {
        console.error('Reverse geocoding error:', error);
      }
    });
  } else {
    window.signupMap.invalidateSize();
  }
});

// Search functionality for map
const mapSearchBtn = document.getElementById('mapSearchBtn');
const mapSearchInput = document.getElementById('mapSearchInput');

if (mapSearchBtn && mapSearchInput) {
  mapSearchBtn.addEventListener('click', async () => {
    const searchTerm = mapSearchInput.value.trim();
    if (!searchTerm) return;
    
    try {
      // Forward geocoding - get coordinates from address
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchTerm)}`);
      const data = await response.json();
      
      if (data && data.length > 0) {
        const result = data[0];
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);
        
        // Move map to the found location
        window.signupMap.setView([lat, lon], 13);
        
        // Remove existing marker if any
        if (window.currentMarker) {
          window.signupMap.removeLayer(window.currentMarker);
        }
        
        // Add marker at found location
        window.currentMarker = L.marker([lat, lon]).addTo(window.signupMap);
        
        // Update coordinate fields
        const latitudeInput = document.getElementById('latitude');
        const longitudeInput = document.getElementById('longitude');
        const addressInput = document.getElementById('address');
        
        latitudeInput.value = lat.toFixed(6);
        longitudeInput.value = lon.toFixed(6);
        addressInput.value = result.display_name || searchTerm;
      } else {
        alert('Address not found. Please try a different search term.');
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      alert('Error searching for address. Please try again.');
    }
  });
  
  // Allow pressing Enter to search
  mapSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      mapSearchBtn.click();
    }
  });
}

// Hide map button
const hideMapPin = document.getElementById('hideMapPin');
if (hideMapPin) {
  hideMapPin.addEventListener('click', () => {
    const mapContainer = document.getElementById('mapContainer');
    mapContainer.style.display = 'none';
  });
}

// Camera functionality
let cameraStream = null;
let currentCameraMode = 'environment'; // 'user' for front camera, 'environment' for back camera
let cameraSource = null; // 'manual' or 'ocr'

window.openCamera = function(mode) {
  cameraSource = mode;
  const cameraModal = document.getElementById('cameraModal');
  cameraModal.style.display = 'flex';
  startCamera();
};

async function startCamera() {
  const video = document.getElementById('cameraVideo');
  const constraints = {
    video: {
      facingMode: currentCameraMode,
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = cameraStream;
    video.play();
  } catch (error) {
    console.error('Error accessing camera:', error);
    alert('Unable to access camera. Please ensure camera permissions are granted.');
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
}

// Capture button
const captureBtn = document.getElementById('captureBtn');
if (captureBtn) {
  captureBtn.addEventListener('click', () => {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('cameraCanvas');
    const capturedImage = document.getElementById('capturedImage');
    const capturedPreview = document.getElementById('capturedPreview');
    const cameraContainer = document.querySelector('.camera-container');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    capturedImage.src = imageData;
    
    cameraContainer.style.display = 'none';
    capturedPreview.style.display = 'block';
    
    stopCamera();
  });
}

// Switch camera button
const switchCameraBtn = document.getElementById('switchCameraBtn');
if (switchCameraBtn) {
  switchCameraBtn.addEventListener('click', () => {
    currentCameraMode = currentCameraMode === 'environment' ? 'user' : 'environment';
    stopCamera();
    startCamera();
  });
}

// Cancel camera button
const cancelCameraBtn = document.getElementById('cancelCameraBtn');
if (cancelCameraBtn) {
  cancelCameraBtn.addEventListener('click', closeCameraModal);
}

// Retake button
const retakeBtn = document.getElementById('retakeBtn');
if (retakeBtn) {
  retakeBtn.addEventListener('click', () => {
    const capturedPreview = document.getElementById('capturedPreview');
    const cameraContainer = document.querySelector('.camera-container');
    
    capturedPreview.style.display = 'none';
    cameraContainer.style.display = 'block';
    startCamera();
  });
}

// Use captured image button
const useCapturedBtn = document.getElementById('useCapturedBtn');
if (useCapturedBtn) {
  useCapturedBtn.addEventListener('click', async () => {
    const capturedImage = document.getElementById('capturedImage');
    const imageData = capturedImage.src;

    // Extract permit ID from captured image using OCR.space
    try {
      // Convert data URL to blob
      const response = await fetch(imageData);
      const blob = await response.blob();
      const file = new File([blob], 'captured-permit.jpg', { type: 'image/jpeg' });

      // Extract text using OCR.space
      const extractedText = await extractTextWithOCRSpace(file);
      const permitId = extractPermitId(extractedText);

      if (permitId) {
        if (cameraSource === 'manual') {
          // Switch to manual tab and fill the input
          document.querySelector('[data-tab="manual"]').click();
          document.getElementById('permit_id').value = permitId;
        } else if (cameraSource === 'ocr') {
          // Fill the extracted permit ID field
          document.getElementById('extractedPermitId').value = permitId;
          document.getElementById('ocrResult').style.display = 'block';
        }
      } else {
        alert('Could not extract permit ID from image. Please enter manually.');
      }
    } catch (error) {
      console.error('OCR Error:', error);
      alert('Error processing image. Please enter permit ID manually.');
    }

    // Display the captured image in preview
    if (cameraSource === 'ocr') {
      const previewImage = document.getElementById('previewImage');
      const uploadPlaceholder = document.getElementById('uploadPlaceholder');
      previewImage.src = imageData;
      previewImage.style.display = 'block';
      uploadPlaceholder.style.display = 'none';
    }

    closeCameraModal();
  });
}

function closeCameraModal() {
  const cameraModal = document.getElementById('cameraModal');
  const capturedPreview = document.getElementById('capturedPreview');
  const cameraContainer = document.querySelector('.camera-container');
  
  stopCamera();
  cameraModal.style.display = 'none';
  capturedPreview.style.display = 'none';
  cameraContainer.style.display = 'block';
}

// Camera modal close button
const cameraClose = document.getElementById('cameraClose');
if (cameraClose) {
  cameraClose.addEventListener('click', closeCameraModal);
}

// Close camera modal when clicking outside
const cameraModal = document.getElementById('cameraModal');
if (cameraModal) {
  cameraModal.addEventListener('click', (e) => {
    if (e.target === cameraModal) {
      closeCameraModal();
    }
  });
}

// Modal-based verify flow
window.openVerifyModal = function(){
  const m = document.getElementById('verifyModal');
  if(!m) return; m.style.display = 'flex';
  const input = document.getElementById('permit_id'); if(input) { input.focus(); input.select(); }
  loadRecentVerifications();
};

function loadRecentVerifications() {
  const recent = JSON.parse(localStorage.getItem('recentPermitVerifications') || '[]');
  const recentDiv = document.getElementById('recentVerifications');
  const recentList = document.getElementById('recentList');
  
  if (recent.length > 0) {
    recentDiv.style.display = 'block';
    recentList.innerHTML = recent.map(perm => `
      <span class="recent-tag" onclick="selectPermitId('${perm.id}')">
        ${perm.id} <span class="recent-tag-remove" onclick="event.stopPropagation(); removeRecentPermit('${perm.id}')">×</span>
      </span>
    `).join('');
  } else {
    recentDiv.style.display = 'none';
  }
}

// Select permit ID from recent list
window.selectPermitId = function(id) {
  document.getElementById('permit_id').value = id;
  verifyForm.dispatchEvent(new Event('submit'));
};

// Remove permit from recent list
window.removeRecentPermit = function(id) {
  let recent = JSON.parse(localStorage.getItem('recentPermitVerifications') || '[]');
  recent = recent.filter(p => p.id !== id);
  localStorage.setItem('recentPermitVerifications', JSON.stringify(recent));
  loadRecentVerifications();
};

// Add to recent verifications
function addToRecentVerifications(permitId, permitType) {
  let recent = JSON.parse(localStorage.getItem('recentPermitVerifications') || '[]');
  
  // Remove if already exists
  recent = recent.filter(p => p.id !== permitId);
  
  // Add to beginning
  recent.unshift({
    id: permitId,
    type: permitType,
    timestamp: Date.now()
  });
  
  // Keep only last 5
  recent = recent.slice(0, 5);
  
  localStorage.setItem('recentPermitVerifications', JSON.stringify(recent));
}

function closeVerifyModal(){
  const m = document.getElementById('verifyModal'); if(!m) return; m.style.display = 'none';
  const res = document.getElementById('verifyResult'); if(res) { res.style.display='none'; res.innerHTML=''; }
}

// close button
const verifyCloseBtn = document.getElementById('verifyClose'); if(verifyCloseBtn) verifyCloseBtn.addEventListener('click', closeVerifyModal);
// click outside to close
const verifyBackdrop = document.getElementById('verifyModal'); if(verifyBackdrop) verifyBackdrop.addEventListener('click', (e)=>{ if(e.target===verifyBackdrop) closeVerifyModal(); });

// QR scanner placeholder (can be replaced with ZXing implementation)
window.startQRScanner = function(){ alert('QR scanning is not enabled in this build. Use manual input or OCR scan.'); };

// Tab switching for verify modal
const tabBtns = document.querySelectorAll('.tab-btn');
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    
    // Update active tab button
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Show corresponding tab content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(tab + 'Tab').classList.add('active');
  });
});

// OCR File Upload
const ocrUploadArea = document.getElementById('ocrUploadArea');
const ocrFileInput = document.getElementById('ocrFileInput');
const previewImage = document.getElementById('previewImage');
const uploadPlaceholder = document.getElementById('uploadPlaceholder');

if (ocrUploadArea && ocrFileInput) {
  ocrUploadArea.addEventListener('click', () => ocrFileInput.click());
  
  ocrUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    ocrUploadArea.style.borderColor = '#10b981';
    ocrUploadArea.style.backgroundColor = '#f0fdf4';
  });
  
  ocrUploadArea.addEventListener('dragleave', () => {
    ocrUploadArea.style.borderColor = '#d1d5db';
    ocrUploadArea.style.backgroundColor = 'white';
  });
  
  ocrUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    ocrUploadArea.style.borderColor = '#d1d5db';
    ocrUploadArea.style.backgroundColor = 'white';
    
    const file = e.dataTransfer.files[0];
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      showOCRFilePreview(file);
    }
  });

  ocrFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      showOCRFilePreview(file);
    }
  });
}

// OCR.space API Integration for Permit ID Extraction
const OCR_SPACE_API_KEY = 'K88896788488957'; // User's API key

async function extractTextWithOCRSpace(imageFile) {
  console.log('Processing image for permit ID:', imageFile.name, 'Size:', imageFile.size, 'Type:', imageFile.type);

  // Use API key directly with minimal parameters
  const formData = new FormData();
  formData.append('apikey', OCR_SPACE_API_KEY);
  formData.append('file', imageFile);
  formData.append('language', 'eng');
  formData.append('isOverlayRequired', 'false');

  console.log('Sending to OCR.space API with API key...');

  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    body: formData
  });

  const data = await response.json();
  console.log('OCR.space response:', data);

  if (!response.ok) {
    console.error('HTTP Error:', response.status, response.statusText);
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  if (data.IsErroredOnProcessing) {
    const errorMsg = data.ErrorMessage || 'OCR processing failed';
    console.error('OCR.space processing error:', errorMsg);
    
    if (errorMsg.includes('API key')) {
      throw new Error('Invalid API key. Please check your OCR.space API key.');
    }
    
    throw new Error(errorMsg);
  }

  const parsedResult = data.ParsedResults?.[0];
  if (!parsedResult) {
    console.log('No ParsedResults found, full response:', data);
    throw new Error('No text detected in image');
  }

  return parsedResult.ParsedText || '';
}

function showOCRFilePreview(file) {
  // Show preview and extract text
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImage.src = e.target.result;
      previewImage.style.display = 'block';
      uploadPlaceholder.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }

  // Extract text and permit ID
  extractTextWithOCRSpace(file).then(extractedText => {
    const permitId = extractPermitId(extractedText);
    if (permitId) {
      document.getElementById('extractedPermitId').value = permitId;
      document.getElementById('ocrResult').style.display = 'block';
    } else {
      alert('Could not extract permit ID from image. Please try again or enter manually.');
    }
    document.getElementById('ocrProgress').style.display = 'none';
  }).catch(error => {
    console.error('OCR Error:', error);
    document.getElementById('ocrProgress').style.display = 'none';
    alert('Error processing image. Please try again.');
  });
}

function extractPermitId(text) {
  // Pattern for DENR permit IDs: DENR-YYYYMMDD-XXXXXX or similar formats
  const patterns = [
    /DENR[-\s]\d{8}[-\s]\d{6}/i,
    /DENR[-\s]\d{4}[-\s]\d{2}[-\s]\d{2}[-\s]\d{6}/i,
    /PERMIT[-\s]\d{4}[-\s]\d{3}/i,
    /DENR\d{14}/i,
    /PERMIT[-\s]\d{3}/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0].toUpperCase().replace(/\s+/g, '-');
    }
  }
  
  // If no pattern matches, try to find any alphanumeric sequence that looks like a permit ID
  const fallbackMatch = text.match(/[A-Z]{2,}-?\d{4,}-?\d+/i);
  if (fallbackMatch) {
    return fallbackMatch[0].toUpperCase().replace(/\s+/g, '-');
  }
  
  return null;
}

// Use extracted permit ID
const useExtractedIdBtn = document.getElementById('useExtractedId');
if (useExtractedIdBtn) {
  useExtractedIdBtn.addEventListener('click', () => {
    const extractedId = document.getElementById('extractedPermitId').value;
    if (extractedId) {
      document.getElementById('permit_id').value = extractedId;
      
      // Switch to manual tab and verify
      tabBtns.forEach(b => b.classList.remove('active'));
      tabBtns[0].classList.add('active');
      document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
      document.getElementById('manualTab').classList.add('active');
      
      // Auto-submit verification
      verifyForm.dispatchEvent(new Event('submit'));
    }
  });
}

// handle form submit
const verifyForm = document.getElementById('verifyForm');
if(verifyForm){
  verifyForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const id = (document.getElementById('permit_id')||{}).value || '';
    const resultEl = document.getElementById('verifyResult');
    if(!id){ if(resultEl) { resultEl.style.display='block'; resultEl.innerHTML='<div class="verify-result error">Please enter a permit ID</div>'; } return; }
    if(resultEl) { resultEl.style.display='block'; resultEl.innerHTML='<div class="verify-result loading">Verifying permit...</div>'; }
    try{
      // first try to find by applicationId or permit_id_number field
      const qSnap = await getDocs(collection(db,'applications'));
      let docFound = qSnap.docs.find(d => {
        const data = d.data();
        const appId = data.applicationId || '';
        const permitId = data.permit_id_number || '';
        return appId.toLowerCase() === id.toLowerCase() || 
               permitId.toLowerCase() === id.toLowerCase() || 
               d.id.toLowerCase() === id.toLowerCase();
      });
      
      if(!docFound){ 
        if(resultEl) resultEl.innerHTML = `
          <div class="verify-result error">
            <div class="result-icon">❌</div>
            <div class="result-title">Permit Not Found</div>
            <div class="result-message">No permit found with ID: <strong>${id}</strong></div>
            <div class="result-suggestion">Please check the permit ID and try again, or <a href="#" onclick="openAuthModal('signup'); return false;">apply for a new permit</a>.</div>
          </div>
        `; 
        return; 
      }
      
      const data = docFound.data();
      const status = data.status || 'N/A';
      const statusClass = status.toLowerCase() === 'approved' ? 'approved' : 
                          status.toLowerCase() === 'rejected' ? 'rejected' : 'pending';
      
      const submitted = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      }) : (data.createdAt || 'N/A');
      
      const issued = data.issued_date && data.issued_date.toDate ? data.issued_date.toDate().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      }) : (data.issued_date || 'N/A');
      
      const expiry = data.expiry_date && data.expiry_date.toDate ? data.expiry_date.toDate().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      }) : (data.expiry_date || 'N/A');
      
      const html = `
        <div class="verify-result success">
          <div class="result-header">
            <div class="result-icon">✅</div>
            <div class="result-title">Permit Verified</div>
          </div>
          <div class="result-details">
            <div class="detail-row">
              <span class="detail-label">Permit ID:</span>
              <span class="detail-value">${data.applicationId || docFound.id}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Permit Type:</span>
              <span class="detail-value">${data.permitType || 'N/A'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Applicant Name:</span>
              <span class="detail-value">${data.applicantName || data.applicant_name || data.applicantEmail || 'N/A'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Status:</span>
              <span class="detail-value status-badge ${statusClass}">${status.toUpperCase()}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Date Submitted:</span>
              <span class="detail-value">${submitted}</span>
            </div>
            ${status.toLowerCase() === 'approved' ? `
            <div class="detail-row">
              <span class="detail-label">Date Issued:</span>
              <span class="detail-value">${issued}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Valid Until:</span>
              <span class="detail-value">${expiry}</span>
            </div>
            ` : ''}
            ${data.rejectionReason ? `
            <div class="detail-row">
              <span class="detail-label">Rejection Reason:</span>
              <span class="detail-value" style="color:#ef4444;">${data.rejectionReason}</span>
            </div>
            ` : ''}
          </div>
          <div class="result-actions">
            <button onclick="window.print()" class="verify-btn">Print Details</button>
          </div>
        </div>
      `;
      if(resultEl) resultEl.innerHTML = html;
      
      // Add to recent verifications
      addToRecentVerifications(data.applicationId || docFound.id, data.permitType || 'N/A');
      loadRecentVerifications();
    }catch(err){ 
      console.error('Verification error:', err);
      if(resultEl) resultEl.innerHTML = `
        <div class="verify-result error">
          <div class="result-icon">⚠️</div>
          <div class="result-title">Verification Error</div>
          <div class="result-message">${err.message}</div>
        </div>
      `; 
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Set up Intersection Observer for scroll animations
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        // Optional: Stop observing once visible
        // observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Observe all sections
  const sections = document.querySelectorAll('.section');
  sections.forEach(section => {
    observer.observe(section);
  });

  // Make hero section visible immediately on load
  const heroSection = document.querySelector('.hero');
  if (heroSection) {
    heroSection.classList.add('visible');
  }

  // Smooth scroll for navigation links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
});

// Sticky Header with Hide/Show on Scroll
let lastScrollTop = 0;
let scrollThreshold = 100; // Minimum scroll before header starts hiding
const header = document.querySelector('.site-header-hero');

function handleHeaderScroll() {
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  
  if (scrollTop > lastScrollTop && scrollTop > scrollThreshold) {
    // Scrolling down and past threshold - hide header
    header.classList.add('hidden');
  } else {
    // Scrolling up or at top - show header
    header.classList.remove('hidden');
  }
  
  lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
}

// Throttle function to improve performance
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

// Add scroll event listener with throttling
window.addEventListener('scroll', throttle(handleHeaderScroll, 100));

// Initialize header state and navigation
document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('.site-header-hero');
  if (header) {
    // Ensure header is visible on page load
    header.classList.remove('hidden');
  }

  // Handle smooth scrolling for navigation links with header offset
  const navLinks = document.querySelectorAll('.top-nav a[href^="#"]');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('href');
      
      if (targetId === '#home') {
        // Scroll to top for home
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      } else {
        // Handle other sections with header offset
        const target = document.querySelector(targetId);
        if (target) {
          const headerHeight = header ? header.offsetHeight : 80;
          const targetPosition = target.offsetTop - headerHeight;
          
          window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
          });
        }
      }
    });
  });

  // FAQ Accordion and Category Functionality
  initializeFAQ();
});

function initializeFAQ() {
  // FAQ Accordion
  const faqItems = document.querySelectorAll('.faq-item');
  
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    
    question.addEventListener('click', () => {
      const isActive = item.classList.contains('active');
      
      // Close all other items
      faqItems.forEach(otherItem => {
        if (otherItem !== item) {
          otherItem.classList.remove('active');
        }
      });
      
      // Toggle current item
      item.classList.toggle('active');
    });
  });

  // FAQ Category Filtering
  const categoryBtns = document.querySelectorAll('.faq-category-btn');
  
  categoryBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const category = btn.dataset.category;
      
      // Update active button
      categoryBtns.forEach(otherBtn => {
        otherBtn.classList.remove('active');
      });
      btn.classList.add('active');
      
      // Filter FAQs
      faqItems.forEach(item => {
        if (category === 'all' || item.dataset.category === category) {
          item.classList.remove('hidden');
        } else {
          item.classList.add('hidden');
        }
      });
    });
  });
}

// Submit user question to Firebase
window.submitUserQuestion = async function() {
  const questionText = document.getElementById('userQuestion').value.trim();
  const userName = document.getElementById('userName').value.trim();
  const userEmail = document.getElementById('userEmail').value.trim();
  const messageDiv = document.getElementById('questionMessage');
  
  // Reset message
  messageDiv.className = 'question-message';
  messageDiv.style.display = 'none';
  
  // Validation
  if (!questionText) {
    showMessage('Please enter your question.', 'error');
    return;
  }
  
  if (!userName) {
    showMessage('Please enter your name.', 'error');
    return;
  }
  
  if (!userEmail) {
    showMessage('Please enter your email address.', 'error');
    return;
  }
  
  if (!isValidEmail(userEmail)) {
    showMessage('Please enter a valid email address.', 'error');
    return;
  }
  
  // Disable submit button
  const submitBtn = document.querySelector('.submit-question-btn');
  const originalText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>⏳</span> Submitting...';
  
  try {
    // Save to Firebase
    const questionId = 'question_' + Date.now();
    await setDoc(doc(db, 'userQuestions', questionId), {
      question: questionText,
      name: userName,
      email: userEmail,
      status: 'pending',
      createdAt: serverTimestamp(),
      source: 'faq_section'
    });
    
    // Clear form
    document.getElementById('userQuestion').value = '';
    document.getElementById('userName').value = '';
    document.getElementById('userEmail').value = '';
    
    // Show success message
    showMessage('Thank you! Your question has been submitted. Our admin team will review it and get back to you soon.', 'success');
    
  } catch (error) {
    console.error('Error submitting question:', error);
    showMessage('Sorry, there was an error submitting your question. Please try again or contact us directly.', 'error');
  } finally {
    // Re-enable submit button
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
};

function showMessage(text, type) {
  const messageDiv = document.getElementById('questionMessage');
  messageDiv.textContent = text;
  messageDiv.className = `question-message ${type}`;
  messageDiv.style.display = 'block';
  
  // Auto-hide after 5 seconds for success messages
  if (type === 'success') {
    setTimeout(() => {
      messageDiv.style.display = 'none';
    }, 5000);
  }
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
