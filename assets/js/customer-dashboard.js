import { auth, db } from './firebase-config.js';
import { 
  signOut, 
  getIdToken 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { protectRoute, logout as authGuardLogout } from './auth-guard.js';
import { 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  limit,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  setDoc,
  deleteDoc,
  where,
  serverTimestamp,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// File upload settings - MAX 5MB per file for fast uploads
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB in bytes
const MAX_FILE_SIZE_MB = 5;

// Helper function to upload file to Cloudinary with error handling
async function uploadToCloudinary(file, folder = 'denr-permits') {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);
    
    console.log(`Uploading ${file.name} to Cloudinary...`);
    
    const uploadResponse = await fetch('/upload-file-to-cloudinary', {
      method: 'POST',
      body: formData
    });
    
    // Check if response is ok
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('Cloudinary upload failed:', errorText);
      throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
    }
    
    const uploadResult = await uploadResponse.json();
    
    if (!uploadResult.success) {
      throw new Error(uploadResult.error || 'Upload failed');
    }
    
    console.log('Cloudinary upload successful:', uploadResult.url);
    return uploadResult;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw error;
  }
}

// IndexedDB for persistent file storage (edit mode)
const EDIT_DB_NAME = 'DENREditFileStorage';
const EDIT_DB_VERSION = 1;
let editDb = null;

// Initialize IndexedDB for edit mode file storage
function initEditIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(EDIT_DB_NAME, EDIT_DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      editDb = request.result;
      resolve(editDb);
    };
    
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains('editPendingFiles')) {
        const store = database.createObjectStore('editPendingFiles', { keyPath: 'fileId' });
        store.createIndex('appId', 'appId', { unique: false });
      }
    };
  });
}

// Store file in IndexedDB for edit mode
async function storeEditFileInIndexedDB(fileId, file, requirement, appId) {
  if (!editDb) await initEditIndexedDB();
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const transaction = editDb.transaction(['editPendingFiles'], 'readwrite');
      const store = transaction.objectStore('editPendingFiles');
      
      const fileData = {
        fileId,
        appId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        requirement,
        blob: reader.result,
        timestamp: new Date().toISOString()
      };
      
      const request = store.put(fileData);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    };
    reader.readAsDataURL(file);
  });
}

// Get pending files for an application
async function getPendingEditFiles(appId) {
  if (!editDb) await initEditIndexedDB();
  
  return new Promise((resolve, reject) => {
    const transaction = editDb.transaction(['editPendingFiles'], 'readonly');
    const store = transaction.objectStore('editPendingFiles');
    const index = store.index('appId');
    const request = index.getAll(appId);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Remove file from IndexedDB
async function removeEditFileFromIndexedDB(fileId) {
  if (!editDb) return;
  
  return new Promise((resolve, reject) => {
    const transaction = editDb.transaction(['editPendingFiles'], 'readwrite');
    const store = transaction.objectStore('editPendingFiles');
    const request = store.delete(fileId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Clear all pending files for an application
async function clearEditFilesForApp(appId) {
  if (!editDb) return;
  
  const pendingFiles = await getPendingEditFiles(appId);
  await Promise.all(pendingFiles.map(f => removeEditFileFromIndexedDB(f.fileId)));
}

// Check network status
function isOnline() {
  return navigator.onLine;
}

let currentUserData = null;
let userApplications = [];

// Enhanced Modal System
function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('show');
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
    
    // Add ESC key listener
    document.addEventListener('keydown', handleModalEscape);
  }
}

function hideModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('show');
    // Restore body scroll
    document.body.style.overflow = '';
    // Unsubscribe from Firestore real-time listener if any
    if (modalId === 'applicationModal' && window._appModalUnsubscribe) {
      window._appModalUnsubscribe();
      window._appModalUnsubscribe = null;
      console.log('Unsubscribed from Firestore real-time listener');
    }
    
    // Remove ESC key listener
    document.removeEventListener('keydown', handleModalEscape);
  }
}

function handleModalEscape(e) {
  if (e.key === 'Escape') {
    const visibleModal = document.querySelector('.custom-modal[style*="display: flex"], .modal-backdrop[style*="display: flex"]');
    if (visibleModal) {
      hideModal(visibleModal.id);
    }
  }
}

// Field-level Validation System
function showFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  
  // Remove existing error
  clearFieldError(fieldId);
  
  // Add error styling with animation
  field.classList.add('field-error');
  
  // Create error message element with icon
  const errorElement = document.createElement('div');
  errorElement.className = 'field-error-message';
  
  // Add error icon SVG
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '16');
  iconSvg.setAttribute('height', '16');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', 'currentColor');
  iconSvg.setAttribute('stroke-width', '2');
  iconSvg.setAttribute('stroke-linecap', 'round');
  iconSvg.setAttribute('stroke-linejoin', 'round');
  iconSvg.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
  
  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  
  errorElement.appendChild(iconSvg);
  errorElement.appendChild(textSpan);
  
  // Insert error message after field
  field.parentNode.insertBefore(errorElement, field.nextSibling);
  
  // Add shake animation to field
  field.style.animation = 'fieldErrorShake 0.4s ease-in-out';
  setTimeout(() => {
    field.style.animation = '';
  }, 400);
  
  // Auto-remove error after user starts typing
  field.addEventListener('input', () => clearFieldError(fieldId), { once: true });
  field.addEventListener('change', () => clearFieldError(fieldId), { once: true });
}

function clearFieldError(fieldId) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  
  // Remove error styling with fade out
  field.classList.remove('field-error');
  
  // Remove error message with animation
  const errorElement = field.parentNode.querySelector('.field-error-message');
  if (errorElement) {
    errorElement.style.animation = 'fieldErrorFadeOut 0.2s ease-out';
    setTimeout(() => {
      errorElement.remove();
    }, 200);
  }
}

function clearAllFieldErrors(containerSelector = '.form-step.active') {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  
  // Remove all error styles
  container.querySelectorAll('.field-error').forEach(field => {
    field.classList.remove('field-error');
    field.style.animation = '';
  });
  
  // Remove all error messages with animation
  container.querySelectorAll('.field-error-message').forEach(msg => {
    msg.style.animation = 'fieldErrorFadeOut 0.2s ease-out';
    setTimeout(() => {
      msg.remove();
    }, 200);
  });
}

// Scroll to first error field smoothly
function scrollToFirstError() {
  const firstError = document.querySelector('.field-error');
  if (firstError) {
    firstError.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'center',
      inline: 'nearest'
    });
    // Focus after scroll completes
    setTimeout(() => {
      firstError.focus();
    }, 500);
  }
}

// Show validation modal (centered, professional)
function showValidationToast(message, type = 'error') {
  // Remove existing modal if any
  const existingModal = document.querySelector('.validation-modal-overlay');
  if (existingModal) {
    existingModal.remove();
  }
  
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'validation-modal-overlay';
  
  // Icon and colors based on type
  let iconSvg, iconClass, title;
  if (type === 'error' || type === 'warning') {
    iconSvg = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    iconClass = 'validation-modal-icon-error';
    title = type === 'error' ? 'Validation Error' : 'Warning';
  } else {
    iconSvg = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    iconClass = 'validation-modal-icon-success';
    title = 'Success';
  }
  
  overlay.innerHTML = `
    <div class="validation-modal">
      <div class="validation-modal-icon ${iconClass}">
        ${iconSvg}
      </div>
      <div class="validation-modal-content">
        <h3 class="validation-modal-title">${title}</h3>
        <p class="validation-modal-message">${message}</p>
      </div>
      <div class="validation-modal-actions">
        <button class="validation-modal-btn validation-modal-btn-primary" onclick="this.closest('.validation-modal-overlay').remove()">
          OK
        </button>
      </div>
    </div>
  `;
  
  // Add to body
  document.body.appendChild(overlay);
  
  // Trigger animation
  setTimeout(() => {
    overlay.classList.add('validation-modal-show');
  }, 10);
  
  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeValidationModal(overlay);
    }
  });
  
  // Close on ESC key
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeValidationModal(overlay);
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function closeValidationModal(overlay) {
  overlay.classList.remove('validation-modal-show');
  setTimeout(() => {
    overlay.remove();
  }, 300);
}

// Barangay Data for District 4 Laguna Municipalities
const lagunaBarangays = {
  "Cavinti": ["Anglas", "Bangco", "Bukal", "Bulajo", "Bungkol", "Inao-awan", "Kanluran Talaongan", "Layug", "Lumot", "Paowin", "Poblacion", "Sumucab", "Tibatib", "Udia"],
  "Famy": ["Asana", "Baan", "Bagong Pag-asa", "Balitoc", "Kapatalan", "Lungos", "Minayutan", "Poblacion"],
  "Kalayaan": ["Bangyas", "Longos", "San Antonio", "San Juan", "San Pablo", "Santa Lucia", "Sucol"],
  "Luisiana": ["Atlis", "Dita", "Lalo", "Nagsinamo", "Poblacion", "San Antonio", "San Isidro", "San Jose", "San Rafael", "San Roque", "San Salvador", "San Vicente", "San Buenaventura", "San Diego", "Santo Tomas"],
  "Lumban": ["Bagong Silang", "Balimbing", "Balubad", "Caliraya", "Concepcion", "Lewin", "Maracta", "Maytalang I", "Maytalang II", "Primera Parang", "Primera Pulo", "Salac", "Santo Niño", "Segunda Parang", "Segunda Pulo"],
  "Mabitac": ["Amuyong", "Lambac", "Lucong", "Matalatala", "Nanguma", "Numero", "Poblacion", "Siniloan"],
  "Magdalena": ["Alipit", "Bucal", "Buenavista", "Bungkol", "Ibabang Atingay", "Ibabang Butnong", "Ibabang Lapu-lapu", "Ibabang Sungi", "Ilayang Atingay", "Ilayang Butnong", "Ilayang Lapu-lapu", "Ilayang Sungi", "Malinao", "Poblacion"],
  "Majayjay": ["Amonoy", "Bakia", "Balanac", "Bukal", "Bunot", "Gagalot", "Ibabang Banga", "Ibabang Bayucain", "Ilayang Banga", "Ilayang Bayucain", "Isabang", "Malinao", "May-It", "Olla", "Pangil", "Piit", "San Francisco", "San Isidro", "San Miguel", "San Roque", "Santa Catalina", "Talaongan"],
  "Paete": ["Alimayin", "Bangkusay", "Buboy", "Calumpang Santo Cristo", "Maytoong", "Poblacion", "Quinale", "San Antonio", "San Isidro", "San Juan", "Santa Cruz", "Santa Maria"],
  "Pagsanjan": ["Anibong", "Biñan", "Buboy", "Cabral", "Dingin", "Lambac", "Layugan", "Magdapio", "Maulawin", "Pinagsanjan", "Poblacion", "Sabang", "San Isidro", "Sampaloc", "San Sebastian"],
  "Pakil": ["Baño", "Banilan", "Burgos", "Casa Real", "Dorado", "Gonzales", "Matikiw", "Rizal", "Saray", "Taft", "Tavera", "Wawa"],
  "Pangil": ["Balian", "Isala", "Natividad", "Pag-asa", "San Jose", "Sulib", "Tabon"],
  "Pila": ["Aplaya", "Balian", "Bulilan Norte", "Bulilan Sur", "Concepcion", "Linga", "Masico", "Pansol", "Pinagbayanan", "Poblacion", "San Antonio", "San Miguel", "Santa Clara Norte", "Santa Clara Sur"],
  "Santa Cruz": ["Alipit", "Bagumbayan", "Bubukal", "Calios", "Gatid", "J. P. Rizal", "Linga", "Malinao", "Oogong", "Pagsawitan", "Palasan", "Patimbao", "Poblacion I", "Poblacion II", "Poblacion III", "Poblacion IV", "San Jose", "San Juan", "San Pablo Norte", "San Pablo Sur", "Santisimo Rosario", "Santo Angel Central", "Santo Angel Norte", "Santo Angel Sur"],
  "Santa Maria": ["Adia", "Bagong Pook", "Bagumbayan", "Coralan", "Cueva", "Inayapan", "Jose P. Rizal", "Macasipac", "Masinao", "Parang Ng Buho", "Poblacion", "Talangka", "Tungko"]
};

// Dynamic Barangay Selection
function setupBarangaySelection() {
  const municipalSelect = document.getElementById('municipal');
  const barangaySelect = document.getElementById('barangay');

  if (!municipalSelect || !barangaySelect) return;

  function updateBarangays() {
    const selectedMunicipal = municipalSelect.value;

    // Clear current barangay options
    barangaySelect.innerHTML = '<option value="">Select Barangay</option>';

    if (selectedMunicipal && lagunaBarangays[selectedMunicipal]) {
      // Add barangay options for selected municipal
      lagunaBarangays[selectedMunicipal].forEach(barangay => {
        const option = document.createElement('option');
        option.value = barangay;
        option.textContent = barangay;
        barangaySelect.appendChild(option);
      });
    }
  }

  municipalSelect.addEventListener('change', updateBarangays);

  // Initialize
  updateBarangays();
}

// Profile Barangay Selection
function setupProfileBarangaySelection() {
  const municipalSelect = document.getElementById('profileMunicipal');
  const barangaySelect = document.getElementById('profileBarangay');

  if (!municipalSelect || !barangaySelect) return;

  function updateBarangays() {
    const selectedMunicipal = municipalSelect.value;

    // Save current barangay value
    const currentBarangay = barangaySelect.value;

    // Clear current barangay options
    barangaySelect.innerHTML = '<option value="">Select Barangay</option>';

    if (selectedMunicipal && lagunaBarangays[selectedMunicipal]) {
      // Add barangay options for selected municipal
      lagunaBarangays[selectedMunicipal].forEach(barangay => {
        const option = document.createElement('option');
        option.value = barangay;
        option.textContent = barangay;
        barangaySelect.appendChild(option);
      });

      // Restore barangay if it exists in new list
      if (currentBarangay && lagunaBarangays[selectedMunicipal].includes(currentBarangay)) {
        barangaySelect.value = currentBarangay;
      }
    }
  }

  municipalSelect.addEventListener('change', updateBarangays);

  // Initialize
  updateBarangays();
}

// Applicant Type Toggle Functionality
function setupApplicantTypeToggle() {
  const personalType = document.getElementById('personalType');
  const companyType = document.getElementById('companyType');
  const personalFields = document.getElementById('personalFields');
  const companyFields = document.getElementById('companyFields');

  if (!personalType || !companyType || !personalFields || !companyFields) return;

  function toggleApplicantType() {
    if (personalType.checked) {
      personalFields.style.display = 'block';
      companyFields.style.display = 'none';
    } else {
      personalFields.style.display = 'none';
      companyFields.style.display = 'block';
    }
    
    // Clear errors when switching types
    clearAllFieldErrors();
  }

  personalType.addEventListener('change', toggleApplicantType);
  companyType.addEventListener('change', toggleApplicantType);
  
  // Initialize with personal type selected
  toggleApplicantType();
}

// Simple Alert Function (modal removed)
function showAlert(message, type = 'warning', options = {}) {
  // Use native browser alert since modal is removed
  // Only use for critical errors where field validation isn't enough
  console.log(`[${type.toUpperCase()}] ${message}`);
  
  // For critical errors only, show native alert
  if (type === 'error' && options.critical) {
    alert(message);
  }
  
  // Call callback if provided
  if (options.onClose) {
    options.onClose();
  }
}

// Update date and time display
function updateDateTime() {
  const now = new Date();
  
  // Format date: Monday, January 15, 2026
  const dateOptions = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  };
  const formattedDate = now.toLocaleDateString('en-US', dateOptions);
  
  // Format time: 2:30:45 PM
  const timeOptions = { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: true 
  };
  const formattedTime = now.toLocaleTimeString('en-US', timeOptions);
  
  const dateElement = document.getElementById('currentDate');
  const timeElement = document.getElementById('currentTime');
  const profileDateElement = document.getElementById('profileCurrentDate');
  const profileTimeElement = document.getElementById('profileCurrentTime');
  const settingsDateElement = document.getElementById('settingsCurrentDate');
  const settingsTimeElement = document.getElementById('settingsCurrentTime');
  
  if (dateElement) dateElement.textContent = formattedDate;
  if (timeElement) timeElement.textContent = formattedTime;
  if (profileDateElement) profileDateElement.textContent = formattedDate;
  if (profileTimeElement) profileTimeElement.textContent = formattedTime;
  if (settingsDateElement) settingsDateElement.textContent = formattedDate;
  if (settingsTimeElement) settingsTimeElement.textContent = formattedTime;
  
  // Update date and time for apply permit section
  const appDateElement = document.getElementById('appCurrentDate');
  const appTimeElement = document.getElementById('appCurrentTime');
  const myAppsDateElement = document.getElementById('myAppsDate');
  const myAppsTimeElement = document.getElementById('myAppsTime');
  const verifyDateElement = document.getElementById('verifyDate');
  const verifyTimeElement = document.getElementById('verifyTime');
  
  if (appDateElement) appDateElement.textContent = formattedDate;
  if (appTimeElement) appTimeElement.textContent = formattedTime;
  if (myAppsDateElement) myAppsDateElement.textContent = formattedDate;
  if (myAppsTimeElement) myAppsTimeElement.textContent = formattedTime;
  if (verifyDateElement) verifyDateElement.textContent = formattedDate;
  if (verifyTimeElement) verifyTimeElement.textContent = formattedTime;
  
  // Update time-based greeting
  updateTimeBasedGreeting(now);
}

// Update time-based greeting (uses inline Lucide SVGs to match the dashboard icon system)
function updateTimeBasedGreeting(now) {
  const hour = now.getHours();
  const greetingElement = document.getElementById('timeGreeting');
  const greetingIcon = document.getElementById('greetingIcon');

  if (!greetingElement || !greetingIcon) return;

  const SVG_ATTRS = 'xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const SVG = {
    sunrise: `<svg ${SVG_ATTRS}><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="8 6 12 2 16 6"/></svg>`,
    sun: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    sunset: `<svg ${SVG_ATTRS}><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="16 5 12 9 8 5"/></svg>`,
    moon: `<svg ${SVG_ATTRS}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  };

  let greeting = '';
  let iconSvg = '';

  if (hour >= 5 && hour < 12) {
    greeting = 'Good morning!';
    iconSvg = SVG.sunrise;
  } else if (hour >= 12 && hour < 17) {
    greeting = 'Good afternoon!';
    iconSvg = SVG.sun;
  } else if (hour >= 17 && hour < 21) {
    greeting = 'Good evening!';
    iconSvg = SVG.sunset;
  } else {
    greeting = 'Good night!';
    iconSvg = SVG.moon;
  }

  greetingElement.textContent = greeting;
  greetingIcon.innerHTML = iconSvg;
}

// Wait for DOM to be ready before updating date/time
document.addEventListener('DOMContentLoaded', function() {
  // Initial call
  updateDateTime();
  
  // Update date and time every second
  setInterval(updateDateTime, 1000);
});

// Check authentication on page load
// Using auth-guard for proper Firebase Auth state handling
protectRoute({
  allowedRoles: ['customer'], // Only customers allowed
  loginRedirect: '/pages/index.html',
  onAuthenticated: async (state) => {
    console.log('Customer dashboard: User authenticated, role:', state.role);
    
    // Check email verification
    if (!state.user.emailVerified) {
      showAlert('Please verify your email before accessing the dashboard. Check your inbox for the verification link.', 'warning');
      window.location.href = '/pages/index.html';
      return;
    }
    
    // Handle role-based redirects if needed
    if (state.role === 'admin') {
      window.location.href = '/pages/admin-dashboard.html';
      return;
    } else if (state.role === 'staff') {
      window.location.href = '/pages/staff-dashboard.html';
      return;
    }
    
    // Sync user data with Firestore
    try {
      const userDoc = await getDoc(doc(db, 'users', state.user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        currentUserData = { ...userData, uid: state.user.uid };
        
        // Sync emailVerified if different
        if (userData.emailVerified !== state.user.emailVerified) {
          await updateDoc(doc(db, 'users', state.user.uid), {
            emailVerified: state.user.emailVerified,
            updatedAt: serverTimestamp()
          });
          currentUserData.emailVerified = state.user.emailVerified;
        }
      } else {
        // Create user document if missing
        currentUserData = {
          uid: state.user.uid,
          firstName: state.user.displayName?.split(' ')[0] || '',
          surname: state.user.displayName?.split(' ')[1] || '',
          email: state.user.email,
          role: 'customer',
          emailVerified: state.user.emailVerified,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        await setDoc(doc(db, 'users', state.user.uid), currentUserData);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
      // Use basic data as fallback
      currentUserData = {
        uid: state.user.uid,
        firstName: state.user.displayName?.split(' ')[0] || '',
        surname: state.user.displayName?.split(' ')[1] || '',
        email: state.user.email,
        role: 'customer',
        emailVerified: state.user.emailVerified
      };
    }
    
    loadDashboardData();
    updateUserInfo(state.user, currentUserData);
  },
  onUnauthenticated: () => {
    console.log('Customer dashboard: Not authenticated or access denied');
  }
});

// Prevent browser back button from logging out the user
// Replace current history state so back button doesn't navigate to index.html
history.replaceState(null, '', location.href);
history.pushState(null, '', location.href);

window.addEventListener('popstate', function(event) {
  // If user presses back button, push them forward again (stay on dashboard)
  history.pushState(null, '', location.href);
  // Navigate to dashboard section instead of going back
  navigateToSection('dashboardSection');
});

// Update user info in header
function updateUserInfo(user, userData) {
  const userName = document.getElementById('userName');
  const userInitials = document.getElementById('userInitials');
  const welcomeName = document.getElementById('welcomeName');
  const settingsDisplayName = document.getElementById('settingsDisplayName');
  const settingsEmail = document.getElementById('settingsEmail');
  
  const firstName = userData.firstName || '';
  const surname = userData.surname || '';
  const displayName = firstName && surname ? `${firstName} ${surname}` : (user.email.split('@')[0]);
  const initials = (firstName[0] + (surname ? surname[0] : '')).toUpperCase();
  
  if (userName) userName.textContent = displayName;
  if (userInitials) userInitials.textContent = initials;
  if (welcomeName) welcomeName.textContent = displayName;
  if (settingsDisplayName) settingsDisplayName.value = displayName;
  if (settingsEmail) settingsEmail.value = user.email;
  
  // Populate profile form
  document.getElementById('profileFirstName').value = firstName || '';
  document.getElementById('profileSurname').value = surname || '';
  document.getElementById('profileMiddleName').value = userData.middleName || '';
  document.getElementById('profileSuffix').value = userData.suffix || 'None';
  document.getElementById('profileMobile').value = userData.mobile || '';
  
  // Populate address fields
  document.getElementById('profileDistrict').value = userData.district || '';
  document.getElementById('profileMunicipal').value = userData.municipal || '';
  // Trigger municipal change to populate barangay options
  document.getElementById('profileMunicipal')?.dispatchEvent(new Event('change'));
  setTimeout(() => {
    document.getElementById('profileBarangay').value = userData.barangay || '';
  }, 100);
  document.getElementById('profileStreetAddress').value = userData.streetAddress || '';
  
  // Update profile display
  document.getElementById('profileName').textContent = displayName;
  document.getElementById('profileEmail').textContent = user.email;
  
  // Update profile avatar with picture if available
  const profileAvatar = document.getElementById('profileAvatar');
  if (userData.profilePicture) {
    profileAvatar.style.backgroundImage = `url(${userData.profilePicture})`;
    profileAvatar.style.backgroundSize = 'cover';
    profileAvatar.style.backgroundPosition = 'center';
    profileAvatar.textContent = '';
  } else {
    profileAvatar.style.backgroundImage = '';
    profileAvatar.textContent = initials;
  }
  
  // Update header avatar with profile picture
  if (userInitials) {
    if (userData.profilePicture) {
      userInitials.style.backgroundImage = `url(${userData.profilePicture})`;
      userInitials.style.backgroundSize = 'cover';
      userInitials.style.backgroundPosition = 'center';
      userInitials.textContent = '';
    } else {
      userInitials.style.backgroundImage = '';
      userInitials.textContent = initials;
    }
  }
  
  // Load notification preferences
  if (userData.notificationPreferences) {
    const notifyNewApp = document.getElementById('notifyNewApp');
    const notifyStatusChange = document.getElementById('notifyStatusChange');
    const notifyWeekly = document.getElementById('notifyWeekly');
    
    if (notifyNewApp) notifyNewApp.checked = userData.notificationPreferences.newApplication !== false;
    if (notifyStatusChange) notifyStatusChange.checked = userData.notificationPreferences.statusChange !== false;
    if (notifyWeekly) notifyWeekly.checked = userData.notificationPreferences.weeklySummary || false;
  }
  
  // Calculate and update profile completion
  updateProfileCompletion(userData);
}

// Calculate profile completion based on actual user data
function updateProfileCompletion(userData) {
  let completed = 0;
  const total = 4;
  
  // Check Basic Information (firstName, surname)
  const hasBasicInfo = userData.firstName && userData.surname;
  if (hasBasicInfo) completed++;
  
  // Check Contact Details (mobile)
  const hasContactDetails = userData.mobile && userData.mobile.length > 0;
  if (hasContactDetails) completed++;
  
  // Check Profile Picture
  const hasProfilePicture = userData.profilePicture && userData.profilePicture.length > 0;
  if (hasProfilePicture) completed++;
  
  // Check Address Verification (all address fields required)
  const hasAddress = userData.district && userData.municipal && userData.barangay && userData.streetAddress;
  if (hasAddress) completed++;
  
  const percentage = Math.round((completed / total) * 100);
  
  // Update percentage display
  const percentElement = document.getElementById('completionPercent');
  const progressElement = document.getElementById('completionProgress');
  
  if (percentElement) percentElement.textContent = percentage;
  if (progressElement) progressElement.style.width = percentage + '%';
  
  // Update completion items
  const completionItems = document.querySelectorAll('.completion-item');
  if (completionItems.length >= 4) {
    // Basic Information
    completionItems[0].classList.toggle('completed', hasBasicInfo);
    completionItems[0].querySelector('.completion-icon').textContent = hasBasicInfo ? '✓' : '○';
    
    // Contact Details
    completionItems[1].classList.toggle('completed', hasContactDetails);
    completionItems[1].querySelector('.completion-icon').textContent = hasContactDetails ? '✓' : '○';
    
    // Profile Picture
    completionItems[2].classList.toggle('completed', hasProfilePicture);
    completionItems[2].querySelector('.completion-icon').textContent = hasProfilePicture ? '✓' : '○';
    
    // Address Verification
    completionItems[3].classList.toggle('completed', hasAddress);
    completionItems[3].querySelector('.completion-icon').textContent = hasAddress ? '✓' : '○';
  }
}

// Settings functions
window.saveSettings = async function() {
  try {
    const displayName = document.getElementById('settingsDisplayName').value.trim();
    
    if (!displayName) {
      showAlert('Display name cannot be empty', 'warning');
      return;
    }
    
    // Update display name in Firebase
    const userRef = doc(db, 'users', auth.currentUser.uid);
    await updateDoc(userRef, {
      firstName: displayName.split(' ')[0] || displayName,
      surname: displayName.split(' ').slice(1).join(' ') || '',
      updatedAt: serverTimestamp()
    });
    
    // Update local data
    currentUserData.firstName = displayName.split(' ')[0] || displayName;
    currentUserData.surname = displayName.split(' ').slice(1).join('') || '';
    
    // Update UI
    updateUserInfo(auth.currentUser, currentUserData);
    
    showAlert('Settings saved successfully!', 'success');
  } catch (error) {
    console.error('Error saving settings:', error);
    showAlert('Error saving settings. Please try again.', 'error');
  }
};

// Note: saveNotificationSettings is defined later in the file (line 3031) with more complete implementation

// Enhanced Password Change Functionality for Customer Dashboard
window.changePassword = async function() {
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  
  // Enhanced validation
  if (!currentPassword || !newPassword || !confirmPassword) {
    showPasswordMessage('Please fill in all password fields', 'error');
    return;
  }
  
  if (newPassword !== confirmPassword) {
    showPasswordMessage('New passwords do not match', 'error');
    return;
  }
  
  // Enhanced password strength validation
  const passwordValidation = validatePasswordStrength(newPassword);
  if (!passwordValidation.isValid) {
    showPasswordMessage('Password does not meet requirements', 'error');
    return;
  }
  
  // Check if new password is same as current
  if (currentPassword === newPassword) {
    showPasswordMessage('New password must be different from current password', 'error');
    return;
  }
  
  try {
    const user = auth.currentUser;
    if (!user) {
      showPasswordMessage('No user is currently logged in', 'error');
      return;
    }
    
    // Show loading state
    const changeBtn = document.getElementById('changePasswordBtn');
    const originalText = changeBtn.textContent;
    changeBtn.textContent = 'Changing...';
    changeBtn.disabled = true;
    
    // Import required Firebase Auth functions
    const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    
    // Create credential with current password
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    
    // Reauthenticate user
    await reauthenticateWithCredential(user, credential);
    
    // Save password history to database before changing
    await savePasswordHistory(user.uid, user.email, currentPassword, newPassword);
    
    // Update password
    await updatePassword(user, newPassword);
    
    // Log the password change activity
    await logCustomerActivity('Password Changed', `Password changed successfully. Strength: ${passwordValidation.strength}`);
    
    // Success message and cleanup
    showPasswordMessage('Password updated successfully!', 'success');
    document.getElementById('changePasswordForm').reset();
    resetPasswordValidation();
    
    // Reset button
    changeBtn.textContent = originalText;
    changeBtn.disabled = false;
    
  } catch (error) {
    console.error('Error changing password:', error);
    let errorMessage = 'Failed to update password';
    
    switch (error.code) {
      case 'auth/wrong-password':
        errorMessage = 'Current password is incorrect';
        break;
      case 'auth/weak-password':
        errorMessage = 'New password is too weak';
        break;
      case 'auth/too-many-requests':
        errorMessage = 'Too many attempts. Please try again later';
        break;
      case 'auth/network-request-failed':
        errorMessage = 'Network error. Please check your connection';
        break;
      default:
        errorMessage = error.message || 'An error occurred while changing password';
    }
    
    showPasswordMessage(errorMessage, 'error');
    
    // Reset button
    const changeBtn = document.getElementById('changePasswordBtn');
    changeBtn.textContent = 'Change Password';
    changeBtn.disabled = false;
  }
};

// Password Strength Validation Function
function validatePasswordStrength(password) {
  const requirements = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(password)
  };
  
  const metRequirements = Object.values(requirements).filter(Boolean).length;
  
  let strength = 'Weak';
  if (metRequirements >= 5) strength = 'Strong';
  else if (metRequirements >= 4) strength = 'Good';
  else if (metRequirements >= 3) strength = 'Fair';
  
  return {
    isValid: metRequirements >= 3, // Minimum 3 requirements
    strength: strength,
    score: metRequirements,
    ...requirements
  };
}

// Save Password History to Database
async function savePasswordHistory(userId, email, oldPasswordHash, newPasswordHash) {
  try {
    // Import Firestore functions
    const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    
    const passwordHistoryRef = collection(db, 'passwordHistory');
    await addDoc(passwordHistoryRef, {
      userId: userId,
      email: email,
      oldPasswordHash: await hashPassword(oldPasswordHash), // Hash for security
      newPasswordHash: await hashPassword(newPasswordHash), // Hash for security
      changedAt: serverTimestamp(),
      userType: 'customer',
      ipAddress: await getClientIP(),
      userAgent: navigator.userAgent
    });
    
    console.log('Customer password history saved to database');
  } catch (error) {
    console.error('Error saving password history:', error);
    // Don't throw error - password change should still succeed
  }
}

// Simple password hashing function (for demonstration - use bcrypt in production)
async function hashPassword(password) {
  // In production, use a proper hashing library like bcrypt
  // This is a simple hash for demonstration
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString();
}

// Get client IP address
async function getClientIP() {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip;
  } catch (error) {
    console.error('Error getting IP:', error);
    return 'Unknown';
  }
}

// Log customer activity
async function logCustomerActivity(action, details) {
  try {
    // Import Firestore functions
    const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    
    const activityRef = collection(db, 'customerActivity');
    await addDoc(activityRef, {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      action: action,
      details: details,
      timestamp: serverTimestamp(),
      ipAddress: await getClientIP(),
      userAgent: navigator.userAgent
    });
  } catch (error) {
    console.error('Error logging customer activity:', error);
  }
}

// Password Strength Check UI Function
window.checkPasswordStrength = function() {
  const password = document.getElementById('newPassword').value;
  const strengthIndicator = document.getElementById('passwordStrengthIndicator');
  const strengthFill = document.getElementById('strengthFill');
  const strengthText = document.getElementById('strengthText');
  const counter = document.getElementById('newPasswordCounter');
  
  // Update character counter
  if (counter) {
    counter.textContent = password.length;
  }
  
  if (!password) {
    strengthIndicator.style.display = 'none';
    resetPasswordRequirements();
    updateChangePasswordButton();
    return;
  }
  
  strengthIndicator.style.display = 'block';
  
  const validation = validatePasswordStrength(password);
  
  // Update strength bar with colors
  let bgColor = '#ef4444'; // red for weak
  let textColor = '#dc2626';
  
  if (validation.strength === 'Fair') {
    bgColor = '#f59e0b'; // amber
    textColor = '#d97706';
  } else if (validation.strength === 'Good') {
    bgColor = '#3b82f6'; // blue
    textColor = '#2563eb';
  } else if (validation.strength === 'Strong') {
    bgColor = '#22c55e'; // green
    textColor = '#16a34a';
  }
  
  strengthFill.style.width = `${(validation.score / 5) * 100}%`;
  strengthFill.style.backgroundColor = bgColor;
  strengthText.textContent = validation.strength;
  strengthText.style.color = textColor;
  
  // Update requirements
  updatePasswordRequirements(validation);
  updateChangePasswordButton();
};

// Update Password Requirements UI
function updatePasswordRequirements(validation) {
  const requirements = [
    { id: 'req-length', met: validation.length },
    { id: 'req-uppercase', met: validation.uppercase },
    { id: 'req-lowercase', met: validation.lowercase },
    { id: 'req-number', met: validation.number },
    { id: 'req-special', met: validation.special }
  ];
  
  requirements.forEach(req => {
    const element = document.getElementById(req.id);
    const icon = element.querySelector('.req-icon');
    
    if (req.met) {
      icon.textContent = '✅';
      element.style.color = '#22c55e';
    } else {
      icon.textContent = '❌';
      element.style.color = '#64748b';
    }
  });
}

// Reset Password Requirements
function resetPasswordRequirements() {
  const requirements = ['req-length', 'req-uppercase', 'req-lowercase', 'req-number', 'req-special'];
  requirements.forEach(reqId => {
    const element = document.getElementById(reqId);
    const icon = element.querySelector('.req-icon');
    icon.textContent = '❌';
    element.style.color = '#64748b';
  });
}

// Check Password Match
window.checkPasswordMatch = function() {
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const matchIndicator = document.getElementById('passwordMatchIndicator');
  const matchIcon = document.getElementById('matchIcon');
  const matchText = document.getElementById('matchText');
  
  // Only show match indicator if both fields have content
  if (!newPassword || !confirmPassword) {
    matchIndicator.style.display = 'none';
    updateChangePasswordButton();
    return;
  }
  
  matchIndicator.style.display = 'flex';
  
  if (newPassword === confirmPassword) {
    matchIndicator.className = 'password-match-indicator match';
    matchIcon.textContent = '✅';
    matchText.textContent = 'Passwords match';
    // Update indicator styling for success
    matchIndicator.style.background = '#dcfce7';
    matchIndicator.style.borderColor = '#22c55e';
    matchText.style.color = '#166534';
  } else {
    matchIndicator.className = 'password-match-indicator no-match';
    matchIcon.textContent = '❌';
    matchText.textContent = 'Passwords do not match';
    // Update indicator styling for error
    matchIndicator.style.background = '#fef3c7';
    matchIndicator.style.borderColor = '#fcd34d';
    matchText.style.color = '#92400e';
  }
  
  updateChangePasswordButton();
};

// Toggle Password Visibility
window.togglePasswordVisibility = function(inputId) {
  const input = document.getElementById(inputId);
  const button = input.nextElementSibling;
  const svg = button.querySelector('svg');
  
  if (input.type === 'password') {
    input.type = 'text';
    // Change to eye-off icon
    svg.innerHTML = `
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    `;
  } else {
    input.type = 'password';
    // Change to eye icon
    svg.innerHTML = `
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    `;
  }
};

// Update Change Password Button State
function updateChangePasswordButton() {
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const changeBtn = document.getElementById('changePasswordBtn');
  
  const validation = validatePasswordStrength(newPassword);
  const isFormValid = currentPassword && 
                     newPassword && 
                     confirmPassword && 
                     newPassword === confirmPassword && 
                     validation.isValid &&
                     currentPassword !== newPassword;
  
  changeBtn.disabled = !isFormValid;
}

// Show Password Message (Toast Notification)
function showPasswordMessage(message, type) {
  // Create a toast notification instead of alert
  const toast = document.createElement('div');
  toast.className = `password-toast ${type}`;
  toast.textContent = message;
  
  // Style the toast
  Object.assign(toast.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    padding: '12px 20px',
    borderRadius: '6px',
    color: 'white',
    fontWeight: '500',
    zIndex: '10000',
    opacity: '0',
    transform: 'translateY(-20px)',
    transition: 'opacity 0.3s, transform 0.3s'
  });
  
  if (type === 'success') {
    toast.style.background = '#28a745';
  } else if (type === 'error') {
    toast.style.background = '#dc3545';
  } else {
    toast.style.background = '#6c757d';
  }
  
  document.body.appendChild(toast);
  
  // Show toast
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }, 100);
  
  // Remove toast after 3 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 300);
  }, 3000);
}

// Reset Password Validation
function resetPasswordValidation() {
  document.getElementById('passwordStrengthIndicator').style.display = 'none';
  document.getElementById('passwordMatchIndicator').style.display = 'none';
  resetPasswordRequirements();
  updateChangePasswordButton();
}

// Two-Factor Authentication Functions
window.toggle2FASetup = function() {
  const checkbox = document.getElementById('enable2FA');
  const setupSection = document.getElementById('twoFASetupSection');
  
  if (checkbox.checked) {
    setupSection.style.display = 'block';
    load2FAStatus();
  } else {
    setupSection.style.display = 'none';
  }
};

window.sendEmail2FA = async function() {
  const email = document.getElementById('email2FA').value;
  const sendBtn = document.getElementById('sendEmailBtn');
  
  if (!email) {
    show2FAMessage('Please enter your email address', 'error');
    return;
  }
  
  try {
    sendBtn.textContent = 'Sending...';
    sendBtn.disabled = true;
    
    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store code in database (in production, use proper email service)
    await store2FACode(auth.currentUser.uid, 'email', email, code);
    
    // Show verification input
    document.getElementById('emailVerification').style.display = 'flex';
    show2FAMessage(`Verification code sent to ${email}`, 'success');
    
  } catch (error) {
    console.error('Error sending email 2FA:', error);
    show2FAMessage('Failed to send verification code', 'error');
  } finally {
    sendBtn.textContent = 'Send Code';
    sendBtn.disabled = false;
  }
};

window.sendSMS2FA = async function() {
  const phone = document.getElementById('phone2FA').value;
  const sendBtn = document.getElementById('sendSMSBtn');
  
  if (!phone) {
    show2FAMessage('Please enter your phone number', 'error');
    return;
  }
  
  try {
    sendBtn.textContent = 'Sending...';
    sendBtn.disabled = true;
    
    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store code in database (in production, use proper SMS service)
    await store2FACode(auth.currentUser.uid, 'phone', phone, code);
    
    // Show verification input
    document.getElementById('phoneVerification').style.display = 'flex';
    show2FAMessage(`Verification code sent to ${phone}`, 'success');
    
  } catch (error) {
    console.error('Error sending SMS 2FA:', error);
    show2FAMessage('Failed to send verification code', 'error');
  } finally {
    sendBtn.textContent = 'Send Code';
    sendBtn.disabled = false;
  }
};

window.verifyEmailCode = async function() {
  const code = document.getElementById('emailCode').value;
  
  if (!code || code.length !== 6) {
    show2FAMessage('Please enter a valid 6-digit code', 'error');
    return;
  }
  
  try {
    // Verify code against database
    const isValid = await verify2FACode(auth.currentUser.uid, 'email', code);
    
    if (isValid) {
      await enable2FA(auth.currentUser.uid, 'email');
      document.getElementById('email2FAStatus').textContent = 'Enabled';
      document.getElementById('email2FAStatus').className = 'status-value enabled';
      show2FAMessage('Email 2FA enabled successfully!', 'success');
      document.getElementById('emailVerification').style.display = 'none';
    } else {
      show2FAMessage('Invalid verification code', 'error');
    }
  } catch (error) {
    console.error('Error verifying email code:', error);
    show2FAMessage('Failed to verify code', 'error');
  }
};

window.verifyPhoneCode = async function() {
  const code = document.getElementById('phoneCode').value;
  
  if (!code || code.length !== 6) {
    show2FAMessage('Please enter a valid 6-digit code', 'error');
    return;
  }
  
  try {
    // Verify code against database
    const isValid = await verify2FACode(auth.currentUser.uid, 'phone', code);
    
    if (isValid) {
      await enable2FA(auth.currentUser.uid, 'phone');
      document.getElementById('phone2FAStatus').textContent = 'Enabled';
      document.getElementById('phone2FAStatus').className = 'status-value enabled';
      show2FAMessage('Phone 2FA enabled successfully!', 'success');
      document.getElementById('phoneVerification').style.display = 'none';
    } else {
      show2FAMessage('Invalid verification code', 'error');
    }
  } catch (error) {
    console.error('Error verifying phone code:', error);
    show2FAMessage('Failed to verify code', 'error');
  }
};

// Store 2FA code in database
async function store2FACode(userId, type, contact, code) {
  const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
  
  const codesRef = collection(db, 'twoFactorCodes');
  await addDoc(codesRef, {
    userId: userId,
    type: type,
    contact: contact,
    code: code,
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
  });
}

// Verify 2FA code
async function verify2FACode(userId, type, code) {
  const { collection, query, where, getDocs, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
  
  const codesRef = collection(db, 'twoFactorCodes');
  const q = query(codesRef, 
    where('userId', '==', userId),
    where('type', '==', type),
    where('code', '==', code),
    where('expiresAt', '>', new Date())
  );
  
  const querySnapshot = await getDocs(q);
  
  if (!querySnapshot.empty) {
    // Delete used code
    querySnapshot.forEach(async (doc) => {
      await deleteDoc(doc.ref);
    });
    return true;
  }
  
  return false;
}

// Enable 2FA for user
async function enable2FA(userId, type) {
  const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
  
  const twoFARef = collection(db, 'userTwoFactor');
  await addDoc(twoFARef, {
    userId: userId,
    type: type,
    enabled: true,
    enabledAt: serverTimestamp()
  });
}

// Load 2FA status
async function load2FAStatus() {
  try {
    const { collection, query, where, getDocs } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    
    const twoFARef = collection(db, 'userTwoFactor');
    const q = query(twoFARef, where('userId', '==', auth.currentUser.uid));
    
    const querySnapshot = await getDocs(q);
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.type === 'email') {
        document.getElementById('email2FAStatus').textContent = 'Enabled';
        document.getElementById('email2FAStatus').className = 'status-value enabled';
      } else if (data.type === 'phone') {
        document.getElementById('phone2FAStatus').textContent = 'Enabled';
        document.getElementById('phone2FAStatus').className = 'status-value enabled';
      }
    });
  } catch (error) {
    console.error('Error loading 2FA status:', error);
  }
}

// Show 2FA message
function show2FAMessage(message, type) {
  const toast = document.createElement('div');
  toast.className = `twofa-toast ${type}`;
  toast.textContent = message;
  
  Object.assign(toast.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    padding: '12px 20px',
    borderRadius: '6px',
    color: 'white',
    fontWeight: '500',
    zIndex: '10000',
    opacity: '0',
    transform: 'translateY(-20px)',
    transition: 'opacity 0.3s, transform 0.3s'
  });
  
  if (type === 'success') {
    toast.style.background = '#28a745';
  } else if (type === 'error') {
    toast.style.background = '#dc3545';
  }
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }, 100);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 300);
  }, 3000);
}

// Active Sessions Management
window.viewActiveSessions = async function() {
  try {
    const sessions = await getUserSessions(auth.currentUser.uid);
    showSessionsModal(sessions);
  } catch (error) {
    console.error('Error loading sessions:', error);
    show2FAMessage('Failed to load active sessions', 'error');
  }
};

// Get user sessions from database
async function getUserSessions(userId) {
  const { collection, query, where, getDocs } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
  
  const sessionsRef = collection(db, 'userSessions');
  const q = query(sessionsRef, 
    where('userId', '==', userId),
    where('isActive', '==', true)
  );
  
  const querySnapshot = await getDocs(q);
  const sessions = [];
  
  querySnapshot.forEach((doc) => {
    const sessionData = doc.data();
    sessions.push({
      id: doc.id,
      ...sessionData,
      createdAt: sessionData.createdAt?.toDate(),
      lastActivity: sessionData.lastActivity?.toDate()
    });
  });
  
  return sessions;
}

// Show sessions modal
function showSessionsModal(sessions) {
  // Create modal if it doesn't exist
  let modal = document.getElementById('sessionsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sessionsModal';
    modal.className = 'modal-backdrop';
    modal.style.display = 'none'; // Hide initially
    
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-dialog';
    
    modalContent.innerHTML = `
      <div class="modal-header">
        <h3>Active Sessions</h3>
        <button class="modal-close" onclick="closeSessionsModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="sessions-list" id="sessionsList">
          ${sessions.length === 0 ? '<p class="no-sessions">No active sessions found</p>' : ''}
        </div>
      </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
  }
  
  // Populate sessions
  const sessionsList = document.getElementById('sessionsList');
  if (sessionsList) {
    sessionsList.innerHTML = sessions.map(session => `
      <div class="session-item" data-session-id="${session.id}">
        <div class="session-info">
          <div class="session-device">
            <strong>${session.deviceType || 'Unknown Device'}</strong>
            <span class="session-browser">${session.browser || 'Unknown Browser'}</span>
          </div>
          <div class="session-details">
            <div class="session-location">
              <span class="location-icon">📍</span>
              ${session.location || 'Unknown Location'}
            </div>
            <div class="session-time">
              <span class="time-icon">🕐</span>
              Last active: ${formatSessionTime(session.lastActivity)}
            </div>
            <div class="session-ip">
              <span class="ip-icon">🌐</span>
              IP: ${session.ipAddress || 'Unknown'}
            </div>
          </div>
        </div>
        <div class="session-actions">
          <button class="btn-danger btn-sm" onclick="terminateSession('${session.id}')">
            Terminate
          </button>
          ${session.isCurrent ? '<span class="current-session-badge">Current Session</span>' : ''}
        </div>
      </div>
    `).join('');
  }
  
  // Show modal with animation
  setTimeout(() => {
    modal.style.display = 'flex';
  }, 100);
}

// Close sessions modal
window.closeSessionsModal = function() {
  const modal = document.getElementById('sessionsModal');
  if (modal) {
    modal.style.display = 'none';
  }
};

// Terminate specific session
window.terminateSession = async function(sessionId) {
  if (!confirm('Are you sure you want to terminate this session?')) {
    return;
  }
  
  try {
    await terminateUserSession(auth.currentUser.uid, sessionId);
    show2FAMessage('Session terminated successfully', 'success');
    
    // Refresh sessions list
    await viewActiveSessions();
  } catch (error) {
    console.error('Error terminating session:', error);
    show2FAMessage('Failed to terminate session', 'error');
  }
};

// Terminate session in database
async function terminateUserSession(userId, sessionId) {
  const { doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
  
  const sessionRef = doc(db, 'userSessions', sessionId);
  await updateDoc(sessionRef, {
    isActive: false,
    terminatedAt: serverTimestamp(),
    terminatedBy: 'user'
  });
}

// Format session time
function formatSessionTime(timestamp) {
  if (!timestamp) return 'Unknown';
  
  const now = new Date();
  const sessionTime = new Date(timestamp);
  const diffMs = now - sessionTime;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins} minutes ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hours ago`;
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return sessionTime.toLocaleDateString();
  }
}

// Log current session
async function logCurrentSession() {
  try {
    const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    
    const sessionsRef = collection(db, 'userSessions');
    
    // Get device info
    const deviceInfo = getDeviceInfo();
    
    await addDoc(sessionsRef, {
      userId: auth.currentUser.uid,
      deviceType: deviceInfo.deviceType,
      browser: deviceInfo.browser,
      operatingSystem: deviceInfo.os,
      ipAddress: await getClientIP(),
      location: deviceInfo.location,
      isActive: true,
      isCurrent: true,
      createdAt: serverTimestamp(),
      lastActivity: serverTimestamp(),
      userAgent: navigator.userAgent
    });
  } catch (error) {
    console.error('Error logging session:', error);
  }
}

// Get device information
function getDeviceInfo() {
  const ua = navigator.userAgent;
  let deviceType = 'Desktop';
  let browser = 'Unknown';
  let os = 'Unknown';
  
  // Detect device type
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) {
    deviceType = 'Mobile';
  } else if (/Tablet/i.test(ua)) {
    deviceType = 'Tablet';
  }
  
  // Detect browser
  if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Edge')) browser = 'Edge';
  
  // Detect OS
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iOS')) os = 'iOS';
  
  return {
    deviceType,
    browser,
    os,
    location: 'Philippines' // Default location
  };
}

// Toggle Password Change Form
window.togglePasswordChange = function() {
  const form = document.getElementById('passwordChangeForm');
  const isVisible = form.style.display !== 'none';
  
  if (isVisible) {
    form.style.display = 'none';
    // Reset form
    document.getElementById('changePasswordForm').reset();
    resetPasswordValidation();
  } else {
    form.style.display = 'block';
  }
};

// Add event listeners for real-time validation
document.addEventListener('DOMContentLoaded', function() {
  const currentPasswordInput = document.getElementById('currentPassword');
  const newPasswordInput = document.getElementById('newPassword');
  const confirmPasswordInput = document.getElementById('confirmPassword');
  
  if (currentPasswordInput) {
    currentPasswordInput.addEventListener('input', updateChangePasswordButton);
  }
  
  if (newPasswordInput) {
    newPasswordInput.addEventListener('input', checkPasswordStrength);
  }
  
  if (confirmPasswordInput) {
    confirmPasswordInput.addEventListener('input', checkPasswordMatch);
  }
  
  // Log current session on load
  if (auth.currentUser) {
    logCurrentSession();
  }
});

// Load dashboard data
async function loadDashboardData() {
  try {
    await fetchUserApplications();
    updateStats();
    loadActivityFeed();
    await loadReminders();
    await loadTimeline();
  } catch (error) {
    console.error('Error loading dashboard data:', error);
  }
}

// Load activity feed
function loadActivityFeed() {
  const activityList = document.getElementById('activityList');
  if (!activityList) return;
  
  activityList.innerHTML = '';
  
  if (userApplications.length === 0) {
    activityList.innerHTML = '<p style="color: #666; padding: 16px;">No recent activity</p>';
    return;
  }
  
  const recentApps = userApplications.slice(0, 5);
  
  recentApps.forEach(app => {
    const activityItem = document.createElement('div');
    activityItem.className = 'activity-item';
    
    let icon = '📋';
    let title = `Application ${app.status || 'Pending'}`;
    
    if (app.status === 'approved') {
      icon = '✅';
      title = 'Application Approved';
    } else if (app.status === 'rejected') {
      icon = '❌';
      title = 'Application Rejected';
    } else if (app.status === 'under review') {
      icon = '👀';
      title = 'Application Under Review';
    }
    
    const dateFormatted = formatDate(app.createdAt);
    
    activityItem.innerHTML = `
      <div class="activity-icon">${icon}</div>
      <div class="activity-content">
        <div class="activity-title">${title} - ${app.permitType}</div>
        <div class="activity-time">${dateFormatted}</div>
      </div>
    `;
    
    activityList.appendChild(activityItem);
  });
}

// Load reminders dynamically from database
async function loadReminders() {
  const remindersList = document.getElementById('remindersList');
  if (!remindersList) return;
  
  remindersList.innerHTML = '<p style="color: #666; padding: 16px;">Loading reminders...</p>';
  
  try {
    const reminders = [];
    
    // Load reminders from database collection
    const remindersRef = collection(db, 'reminders');
    const q = query(
      remindersRef,
      where('applicantUid', '==', auth.currentUser.uid)
    );
    const querySnapshot = await getDocs(q);
    
    querySnapshot.forEach((doc) => {
      reminders.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Also derive reminders from approved applications (pickup schedules)
    userApplications.forEach(app => {
      if (app.status === 'approved' && app.pickupSchedule) {
        const schedule = app.pickupSchedule;
        const scheduleDate = new Date(schedule.date + 'T' + schedule.time);
        const now = new Date();
        const daysDiff = Math.ceil((scheduleDate - now) / (1000 * 60 * 60 * 24));
        
        if (daysDiff >= 0 && daysDiff <= 30) {
          reminders.push({
            type: 'pickup',
            title: 'Pickup Schedule',
            date: schedule.date + ' - ' + schedule.time,
            description: `${app.permitType} #${app.applicationId || app.id}`,
            badge: daysDiff <= 3 ? 'Urgent' : 'Scheduled',
            badgeClass: daysDiff <= 3 ? 'urgent' : '',
            icon: '📅'
          });
        }
      }
    });
    
    // Sort reminders by date
    reminders.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateA - dateB;
    });
    
    remindersList.innerHTML = '';
    
    if (reminders.length === 0) {
      remindersList.innerHTML = '<p style="color: #666; padding: 16px;">No upcoming reminders</p>';
      return;
    }
    
    reminders.forEach(reminder => {
      const reminderItem = document.createElement('div');
      reminderItem.className = `reminder-item ${reminder.badgeClass || ''}`;
      
      reminderItem.innerHTML = `
        <div class="reminder-icon">${reminder.icon || '📅'}</div>
        <div class="reminder-content">
          <div class="reminder-title">${reminder.title}</div>
          <div class="reminder-date">${reminder.date}</div>
          <div class="reminder-desc">${reminder.description}</div>
        </div>
        ${reminder.badge ? `<div class="reminder-badge ${reminder.badgeClass === 'urgent' ? '' : 'warning'}">${reminder.badge}</div>` : ''}
      `;
      
      remindersList.appendChild(reminderItem);
    });
  } catch (error) {
    console.error('Error loading reminders:', error);
    remindersList.innerHTML = '<p style="color: #666; padding: 16px;">Error loading reminders</p>';
  }
}

// Load timeline dynamically from application status history
async function loadTimeline() {
  const timelineContainer = document.getElementById('timelineContainer');
  if (!timelineContainer) return;
  
  timelineContainer.innerHTML = '<p style="color: #666; padding: 16px;">Loading timeline...</p>';
  
  try {
    // Get the most recent application
    if (userApplications.length === 0) {
      timelineContainer.innerHTML = '<p style="color: #666; padding: 16px;">No applications to show timeline</p>';
      return;
    }
    
    const latestApp = userApplications[0];
    const timelineEvents = [];
    
    // Load status history from database if available
    const statusHistoryRef = collection(db, 'statusHistory');
    const q = query(
      statusHistoryRef,
      where('applicationId', '==', latestApp.id)
    );
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      querySnapshot.forEach((doc) => {
        timelineEvents.push(doc.data());
      });
      
      // Sort by timestamp
      timelineEvents.sort((a, b) => {
        const timeA = a.timestamp?.toMillis() || 0;
        const timeB = b.timestamp?.toMillis() || 0;
        return timeA - timeB;
      });
    } else {
      // Derive timeline from application data
      timelineEvents.push({
        status: 'Application Submitted',
        timestamp: latestApp.createdAt,
        description: `${latestApp.permitType} application submitted successfully`,
        markerClass: 'completed'
      });
      
      if (latestApp.status === 'under review' || latestApp.status === 'approved' || latestApp.status === 'rejected') {
        timelineEvents.push({
          status: 'Under Review',
          timestamp: latestApp.reviewedAt || latestApp.createdAt,
          description: 'Application is being reviewed by DENR staff',
          markerClass: 'completed'
        });
      }
      
      if (latestApp.status === 'approved') {
        timelineEvents.push({
          status: 'Approved',
          timestamp: latestApp.reviewedAt || latestApp.createdAt,
          description: 'Application approved successfully',
          markerClass: 'active'
        });
        
        if (latestApp.pickupSchedule) {
          const schedule = latestApp.pickupSchedule;
          const timeDisplay = schedule.time || 'To be scheduled';
          const timestamp = schedule.time ? 
            new Date(schedule.date + 'T' + schedule.time) : 
            new Date(schedule.date + 'T09:00'); // Default to 9 AM if no time
          
          timelineEvents.push({
            status: 'Pickup Scheduled',
            timestamp: timestamp,
            description: `Pickup scheduled for ${schedule.date} at ${timeDisplay}`,
            markerClass: 'pending'
          });
        }
      } else if (latestApp.status === 'rejected') {
        timelineEvents.push({
          status: 'Rejected',
          timestamp: latestApp.reviewedAt || latestApp.createdAt,
          description: latestApp.rejectionReason || 'Application was rejected',
          markerClass: 'active'
        });
      } else {
        timelineEvents.push({
          status: 'Pending Review',
          timestamp: latestApp.createdAt,
          description: 'Awaiting review by DENR staff',
          markerClass: 'active'
        });
      }
    }
    
    timelineContainer.innerHTML = '';
    
    timelineEvents.forEach((event, index) => {
      const timelineItem = document.createElement('div');
      timelineItem.className = 'timeline-item';
      
      let markerClass = 'pending';
      if (index < timelineEvents.length - 1) {
        markerClass = 'completed';
      } else if (index === timelineEvents.length - 1) {
        markerClass = 'active';
      }
      
      const dateFormatted = event.timestamp ? formatDate(event.timestamp) : 'Pending';
      
      timelineItem.innerHTML = `
        <div class="timeline-marker ${markerClass}"></div>
        <div class="timeline-content">
          <div class="timeline-title">${event.status}</div>
          <div class="timeline-date">${dateFormatted}</div>
          <div class="timeline-desc">${event.description}</div>
        </div>
      `;
      
      timelineContainer.appendChild(timelineItem);
    });
  } catch (error) {
    console.error('Error loading timeline:', error);
    timelineContainer.innerHTML = '<p style="color: #666; padding: 16px;">Error loading timeline</p>';
  }
}

// Fetch user's applications - wrapped in window for global access
window.fetchUserApplications = async function() {
  try {
    if (!auth.currentUser) {
      console.error('Customer dashboard: No authenticated user found');
      return;
    }
    
    console.log('Customer dashboard: Setting up real-time listener for user:', auth.currentUser.uid);
    
    const applicationsRef = collection(db, 'applications');
    const q = query(
      applicationsRef, 
      where('applicantUid', '==', auth.currentUser.uid)
    );
    
    // Set up real-time listener for immediate status updates
    if (window.userApplicationsUnsubscribe) {
      window.userApplicationsUnsubscribe();
    }
    
    window.userApplicationsUnsubscribe = onSnapshot(q, (querySnapshot) => {
      console.log('Customer dashboard: Real-time update received, count:', querySnapshot.size);
      
      userApplications = [];
      querySnapshot.forEach((doc) => {
        const appData = {
          id: doc.id,
          ...doc.data()
        };
        console.log('Customer dashboard: App:', appData.applicationId, 'Status:', appData.status, 'Resubmit count:', appData.revisionCount);
        userApplications.push(appData);
      });
      
      // Sort by createdAt manually
      userApplications.sort((a, b) => {
        const aTime = a.createdAt?.toMillis() || 0;
        const bTime = b.createdAt?.toMillis() || 0;
        return bTime - aTime;
      });
      
      console.log('Customer dashboard: Calling displayApplications with', userApplications.length, 'applications');
      displayApplications();
      updateStats(); // Update stats when data arrives
      loadActivityFeed(); // Update activity feed too
    }, (error) => {
      console.error('Customer dashboard: Real-time listener error:', error);
    });
    
  } catch (error) {
    console.error('Error fetching applications:', error);
    userApplications = [];
    displayApplications();
    updateStats(); // Clear stats on error
  }
};

// ----- Applications table pagination -----
const APPLICATIONS_PAGE_SIZE = 10;
let applicationsCurrentPage = 1;
// Tracks the active dataset (filtered or full) so pagination controls operate on the correct list
let applicationsActiveDataset = null;

function buildApplicationRowHtml(app) {
  const statusClass = getStatusClass(app.status);
  const dateFormatted = formatDate(app.createdAt);
  const needsResubmit = app.status === 'needs revision' || app.status === 'needs resubmit';
  const canEdit = needsResubmit;
  const canDelete = app.status === 'pending' || app.status === 'under review' || app.status === 'rejected' || needsResubmit;

  return `
      <td>${app.applicationId || app.id}</td>
      <td>${app.permitType || 'N/A'}</td>
      <td>${dateFormatted}</td>
      <td>
        <span class="status-badge ${statusClass}">${app.status || 'PENDING'}</span>
      </td>
      <td>
        <div class="table-actions">
          <button class="action-btn btn-view" onclick="viewApplication('${app.id}')">View</button>
          ${canEdit ? `
          <button class="action-btn btn-edit" onclick="editApplication('${app.id}')">Resubmit</button>
          ` : ''}
          ${canDelete ? `
          <button class="action-btn btn-delete" onclick="deleteApplication('${app.id}')">🗑️</button>
          ` : ''}
        </div>
      </td>
    `;
}

function renderApplicationsPagination(total) {
  const nav = document.getElementById('applicationsPagination');
  const info = document.getElementById('applicationsPaginationInfo');
  const pages = document.getElementById('applicationsPaginationPages');
  const prevBtn = document.getElementById('applicationsPaginationPrev');
  const nextBtn = document.getElementById('applicationsPaginationNext');
  if (!nav || !info || !pages || !prevBtn || !nextBtn) return;

  // Hide pagination entirely when there are 10 or fewer entries
  if (total <= APPLICATIONS_PAGE_SIZE) {
    nav.hidden = true;
    pages.innerHTML = '';
    return;
  }
  nav.hidden = false;

  const totalPages = Math.ceil(total / APPLICATIONS_PAGE_SIZE);
  if (applicationsCurrentPage > totalPages) applicationsCurrentPage = totalPages;
  if (applicationsCurrentPage < 1) applicationsCurrentPage = 1;

  const startIdx = (applicationsCurrentPage - 1) * APPLICATIONS_PAGE_SIZE + 1;
  const endIdx = Math.min(applicationsCurrentPage * APPLICATIONS_PAGE_SIZE, total);
  info.textContent = `Showing ${startIdx}\u2013${endIdx} of ${total}`;

  prevBtn.disabled = applicationsCurrentPage === 1;
  nextBtn.disabled = applicationsCurrentPage === totalPages;

  // Render numbered page buttons (compact: first, last, current ±1, with ellipsis)
  const pageNumbers = [];
  const pushNum = (n) => pageNumbers.push(n);
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pushNum(i);
  } else {
    pushNum(1);
    if (applicationsCurrentPage > 3) pushNum('…');
    const from = Math.max(2, applicationsCurrentPage - 1);
    const to = Math.min(totalPages - 1, applicationsCurrentPage + 1);
    for (let i = from; i <= to; i++) pushNum(i);
    if (applicationsCurrentPage < totalPages - 2) pushNum('…');
    pushNum(totalPages);
  }

  pages.innerHTML = pageNumbers.map((p) => {
    if (p === '…') return '<span class="apps-pagination__ellipsis" aria-hidden="true">\u2026</span>';
    const isActive = p === applicationsCurrentPage;
    return `<button type="button" class="apps-pagination__page${isActive ? ' is-active' : ''}" data-page="${p}"${isActive ? ' aria-current="page"' : ''}>${p}</button>`;
  }).join('');
}

function renderApplicationsTable(applications, emptyMessage) {
  const tbody = document.getElementById('applicationsTable');
  if (!tbody) {
    console.error('Customer dashboard: applicationsTable tbody not found!');
    return;
  }

  applicationsActiveDataset = applications;
  const total = applications.length;
  tbody.innerHTML = '';

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 32px; color: #666;">${emptyMessage}</td></tr>`;
    renderApplicationsPagination(0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / APPLICATIONS_PAGE_SIZE));
  if (applicationsCurrentPage > totalPages) applicationsCurrentPage = totalPages;
  if (applicationsCurrentPage < 1) applicationsCurrentPage = 1;

  const startIdx = (applicationsCurrentPage - 1) * APPLICATIONS_PAGE_SIZE;
  const pageItems = applications.slice(startIdx, startIdx + APPLICATIONS_PAGE_SIZE);

  pageItems.forEach((app) => {
    const row = document.createElement('tr');
    row.innerHTML = buildApplicationRowHtml(app);
    tbody.appendChild(row);
  });

  renderApplicationsPagination(total);
}

// Display applications in table (full list, no filter)
function displayApplications() {
  applicationsCurrentPage = 1; // reset to first page when reloading the full list
  renderApplicationsTable(userApplications, 'No applications yet. Click "New Application" to get started.');
}

// View application details - Similar to staff dashboard
window.viewApplication = async function(appId) {
  // Unsubscribe from any previous real-time listener
  if (window._appModalUnsubscribe) {
    window._appModalUnsubscribe();
    window._appModalUnsubscribe = null;
  }
  
  // Fetch fresh data from Firestore to ensure documents are up-to-date
  let application = null;
  try {
    const appRef = doc(db, 'applications', appId);
    const appSnap = await getDoc(appRef);
    if (appSnap.exists()) {
      application = { id: appSnap.id, ...appSnap.data() };
      console.log('Fetched fresh app data from Firestore for view:', application);
      
      // Update the cached list with fresh data
      const cachedIndex = userApplications.findIndex(a => a.id === appId);
      if (cachedIndex !== -1) {
        userApplications[cachedIndex] = application;
      }
    }
  } catch (error) {
    console.error('Error fetching fresh application data:', error);
    application = userApplications.find(app => app.id === appId);
  }
  
  if (!application) {
    application = userApplications.find(app => app.id === appId);
  }
  
  if (!application) return;
  
  // Debug: Log application data
  console.log('Customer View Application:', application);
  console.log('Pickup Schedule:', application.pickupSchedule);
  
  // Set current application ID for global access
  currentApplicationId = appId;
  
  const modal = document.getElementById('applicationModal');
  const detailsDiv = document.getElementById('applicationDetails');
  
  // Show loading state
  detailsDiv.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <div style="font-size: 48px; margin-bottom: 16px;">⏳</div>
      <div style="font-size: 18px; color: #666;">Loading application details...</div>
    </div>
  `;
  
  modal.style.display = 'flex';
  
  // Simulate loading for better UX
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Generate application details HTML (similar to staff dashboard but customer-focused)
  const detailsHTML = generateApplicationDetailsHTML(application);
  detailsDiv.innerHTML = detailsHTML;
  
  // Update modal actions for customer
  const modalActions = document.getElementById('modalActions');
  modalActions.innerHTML = `
    <button class="btn-secondary" onclick="printApplication()">🖨️ Print</button>
    <button class="btn-primary" onclick="downloadAllDocuments()">📥 Download All Documents</button>
    <button class="btn-secondary" onclick="hideModal('applicationModal')">Close</button>
  `;
  
  modal.style.display = 'flex';
  
  // Set up real-time listener for auto-updating documents when uploads complete
  try {
    const appRef = doc(db, 'applications', appId);
    window._appModalUnsubscribe = onSnapshot(appRef, (docSnap) => {
      if (docSnap.exists()) {
        const updatedApp = { id: docSnap.id, ...docSnap.data() };
        console.log('Real-time update received - documents:', updatedApp.documents?.length || 0, 'uploadStatus:', updatedApp.uploadStatus);
        
        // Update cache
        const cachedIndex = userApplications.findIndex(a => a.id === appId);
        if (cachedIndex !== -1) {
          userApplications[cachedIndex] = updatedApp;
        }
        
        // Re-render modal content if modal is still open
        if (modal.style.display === 'flex') {
          const newHTML = generateApplicationDetailsHTML(updatedApp);
          detailsDiv.innerHTML = newHTML;
        }
      }
    });
    console.log('Firestore real-time listener set up for application:', appId);
  } catch (error) {
    console.error('Error setting up real-time listener:', error);
  }
};

// Generate application details HTML for customer view
function generateApplicationDetailsHTML(app) {
  const statusClass = getStatusClass(app.status);
  const dateSubmitted = formatDate(app.createdAt);
  const lastUpdated = formatDate(app.updatedAt || app.createdAt);
  
  // Documents section
  let documentsHTML = '';
  const isUploading = app.uploadStatus === 'uploading';
  if (app.documents && app.documents.length > 0) {
    documentsHTML = `
      <div class="detail-section">
        <h4 class="section-title">📁 Uploaded Documents (${app.documents.length})${isUploading ? ' <span style="color: #f59e0b; font-size: 12px;">⏳ Some files still uploading...</span>' : ''}</h4>
        <div class="documents-grid">
          ${app.documents.map((doc, index) => {
            const docName = doc.name || `Document ${index + 1}`;
            const docData = doc.url || doc.data || '';
            const docType = doc.type || '';
            const isImage = docType && docType.startsWith('image/');
            const isPDF = docType && docType.includes('pdf');
            
            if (!docData) {
              return `
                <div class="document-card" style="border-color: #ef4444; opacity: 0.7;">
                  <div class="document-preview">
                    <div style="text-align: center; color: #ef4444;">
                      <div style="font-size: 48px; margin-bottom: 8px;">⚠️</div>
                      <div style="font-weight: 600;">Data Not Available</div>
                    </div>
                  </div>
                  <div class="document-info">
                    <div class="document-name">${docName}</div>
                    <div class="document-meta">
                      <span>❌ Error</span>
                    </div>
                  </div>
                </div>
              `;
            }
            
            return `
              <div class="document-card">
                <div class="document-preview">
                  ${isImage ? 
                    `<img src="${docData}" alt="${docName}" onclick="openImageViewer('${docData}', '${docName.replace(/'/g, "\\'")}')" style="cursor: pointer;" />` :
                    `<a href="${docData}" ${isPDF ? `download="${docName}"` : 'target="_blank'} style="text-decoration: none; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #64748b; cursor: pointer;">
                      <div style="font-size: 48px; margin-bottom: 8px;">${isPDF ? '📄' : '📎'}</div>
                      <div style="font-weight: 600;">${isPDF ? 'Click to Download' : 'Click to View'}</div>
                    </a>`
                  }
                </div>
                <div class="document-info">
                  <div class="document-name">${docName}</div>
                  <div class="document-meta">
                    <span>${doc.size ? (doc.size / 1024).toFixed(1) + ' KB' : 'Unknown size'}</span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }
  
  // Show uploading status if documents are still being processed
  if (isUploading && (!app.documents || app.documents.length === 0)) {
    documentsHTML = `
      <div class="detail-section">
        <h4 class="section-title">📁 Uploaded Documents</h4>
        <div style="text-align: center; padding: 24px; background: #fef3c7; border-radius: 8px; border: 1px solid #fbbf24;">
          <div style="font-size: 32px; margin-bottom: 8px;">⏳</div>
          <div style="font-weight: 600; color: #92400e; margin-bottom: 4px;">Documents are being uploaded...</div>
          <div style="font-size: 13px; color: #a16207;">Please wait or refresh the page in a moment to see your uploaded files.</div>
        </div>
      </div>
    `;
  }
  
  // Pickup schedule if approved
  let pickupHTML = '';
  if (app.status && app.status.toLowerCase() === 'approved') {
    const schedule = app.pickupSchedule || {};
    console.log('Customer approved app - status:', app.status);
    console.log('Customer approved app - schedule:', schedule);
    if (schedule.date) {
      pickupHTML = `
        <div class="detail-section">
          <h4 class="section-title">📅 Pickup Schedule</h4>
          <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; border-left: 4px solid #10b981;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
              <div>
                <strong>Date:</strong><br>
                <span style="font-size: 16px;">${schedule.date}</span>
              </div>
              <div>
                <strong>Time:</strong><br>
                <span style="font-size: 16px; ${schedule.time ? '' : 'color: #64748b;'}">${schedule.time || 'To be scheduled'}</span>
              </div>
              ${schedule.notes ? `
                <div style="grid-column: 1 / -1;">
                  <strong>Notes:</strong><br>
                  <span style="font-size: 14px;">${schedule.notes}</span>
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    } else {
      pickupHTML = `
        <div class="detail-section">
          <h4 class="section-title">📅 Pickup Schedule</h4>
          <div style="background: #fef3c7; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <div style="text-align: center; color: #92400e;">
              <div style="font-size: 24px; margin-bottom: 8px;">📅</div>
              <div style="font-weight: 600; margin-bottom: 4px;">Pickup Schedule Pending</div>
              <div style="font-size: 14px;">Your permit has been approved. Please wait for the pickup schedule to be assigned.</div>
            </div>
          </div>
        </div>
      `;
    }
  }
  
  return `
    <div class="application-overview">
      <div class="overview-header">
        <div class="application-id">
          <strong>Application ID:</strong> ${app.applicationId || app.id}
        </div>
        <div class="application-status">
          <span class="status-badge ${statusClass}">${(app.status || 'PENDING').toUpperCase()}</span>
        </div>
      </div>
      
      <div class="overview-details">
        <div class="detail-grid">
          <div class="detail-item">
            <label>Permit Type:</label>
            <span>${app.permitType || 'N/A'}</span>
          </div>
          <div class="detail-item">
            <label>Date Submitted:</label>
            <span>${dateSubmitted}</span>
          </div>
          <div class="detail-item">
            <label>Last Updated:</label>
            <span>${lastUpdated}</span>
          </div>
        </div>
      </div>
    </div>
    
    <div class="detail-section">
      <h4 class="section-title">👤 Applicant Information</h4>
      <div class="detail-grid">
        <div class="detail-item">
          <label>Full Name:</label>
          <span>${app.firstName || ''} ${app.middleName || ''} ${app.surname || ''} ${app.suffix || ''}</span>
        </div>
        <div class="detail-item">
          <label>Email:</label>
          <span>${app.email || 'N/A'}</span>
        </div>
        <div class="detail-item">
          <label>Mobile:</label>
          <span>${app.mobile || 'N/A'}</span>
        </div>
        <div class="detail-item">
          <label>Address:</label>
          <span>${app.address || 'N/A'}</span>
        </div>
      </div>
    </div>
    
    ${app.projectTitle ? `
      <div class="detail-section">
        <h4 class="section-title">📋 Project Details</h4>
        <div class="detail-grid">
          <div class="detail-item">
            <label>Project Title:</label>
            <span>${app.projectTitle || 'N/A'}</span>
          </div>
          <div class="detail-item">
            <label>Project Location:</label>
            <span>${app.projectLocation || 'N/A'}</span>
          </div>
          ${app.projectCost ? `
            <div class="detail-item">
              <label>Estimated Cost:</label>
              <span>₱${parseFloat(app.projectCost).toLocaleString()}</span>
            </div>
          ` : ''}
        </div>
        ${app.projectDescription ? `
          <div style="margin-top: 16px;">
            <label style="font-weight: 600; color: #374151;">Project Description:</label>
            <div style="margin-top: 8px; padding: 12px; background: #f9fafb; border-radius: 6px; line-height: 1.6;">
              ${app.projectDescription}
            </div>
          </div>
        ` : ''}
      </div>
    ` : ''}
    
    <!-- Resubmit Comments Section - Show when status is "needs resubmit" -->
    ${(app.status === 'needs revision' || app.status === 'needs resubmit') && app.revisionComments ? `
      <div class="detail-section">
        <h4 class="section-title" style="color: #f59e0b;">📝 Resubmission Required</h4>
        <div style="background: #fffbeb; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px;">
          <div style="font-weight: 600; color: #92400e; margin-bottom: 8px;">
            Please address the following:
          </div>
          <div style="color: #78350f; line-height: 1.6; white-space: pre-wrap;">
            ${app.revisionComments}
          </div>
          ${app.revisionRequestedAt ? `
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #fbbf24; font-size: 13px; color: #a16207;">
              <strong>Requested by:</strong> ${app.revisionRequestedBy || 'Staff'}<br>
              <strong>Date:</strong> ${formatDate(app.revisionRequestedAt)}
            </div>
          ` : ''}
        </div>
      </div>
    ` : ''}
    
    ${documentsHTML}
    ${pickupHTML}
    
    <!-- Always show pickup schedule section for approved apps -->
    ${app.status && app.status.toLowerCase() === 'approved' ? `
      <div class="detail-section">
        <h4 class="section-title">📅 Pickup Schedule</h4>
        ${app.pickupSchedule && app.pickupSchedule.date ? `
          <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; border-left: 4px solid #10b981;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
              <div>
                <strong>Date:</strong><br>
                <span style="font-size: 16px;">${app.pickupSchedule.date}</span>
              </div>
              <div>
                <strong>Time:</strong><br>
                <span style="font-size: 16px; ${app.pickupSchedule.time ? '' : 'color: #64748b;'}">${app.pickupSchedule.time || 'To be scheduled'}</span>
              </div>
              ${app.pickupSchedule.notes ? `
                <div style="grid-column: 1 / -1;">
                  <strong>Notes:</strong><br>
                  <span style="font-size: 14px;">${app.pickupSchedule.notes}</span>
                </div>
              ` : ''}
            </div>
          </div>
        ` : `
          <div style="background: #fef3c7; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <div style="text-align: center; color: #92400e;">
              <div style="font-size: 24px; margin-bottom: 8px;">📅</div>
              <div style="font-weight: 600; margin-bottom: 4px;">Pickup Schedule Pending</div>
              <div style="font-size: 14px;">Your permit has been approved. Please wait for the pickup schedule to be assigned.</div>
            </div>
          </div>
        `}
      </div>
    ` : ''}
    
    <!-- Application Timeline Section -->
    <div class="detail-section">
      <h4 class="section-title">📊 Application Timeline</h4>
      <div class="status-timeline">
        <div class="timeline-item">
          <div class="timeline-marker completed">📝</div>
          <div class="timeline-content">
            <div class="timeline-title">Application Submitted</div>
            <div class="timeline-date">${dateSubmitted}</div>
          </div>
        </div>
        ${app.status !== 'pending' ? `
        <div class="timeline-item">
          <div class="timeline-marker completed">👁️</div>
          <div class="timeline-content">
            <div class="timeline-title">Application Under Review</div>
            <div class="timeline-date">${app.reviewedAt ? formatDate(app.reviewedAt) : 'In Progress'}</div>
          </div>
        </div>
        ` : `
        <div class="timeline-item">
          <div class="timeline-marker pending">👁️</div>
          <div class="timeline-content">
            <div class="timeline-title">Application Under Review</div>
            <div class="timeline-date">Pending</div>
          </div>
        </div>
        `}
        
        <!-- Resubmit Timeline Events -->
        ${app.revisionRequestedAt ? `
        <div class="timeline-item">
          <div class="timeline-marker completed" style="background: #f59e0b;">📝</div>
          <div class="timeline-content">
            <div class="timeline-title">Resubmission Requested</div>
            <div class="timeline-date">${formatDate(app.revisionRequestedAt)}</div>
            <div style="color: #92400e; font-size: 12px; margin-top: 2px;">By: ${app.revisionRequestedBy || 'Staff'}</div>
          </div>
        </div>
        ` : ''}
        
        ${app.revisionSubmittedAt ? `
        <div class="timeline-item">
          <div class="timeline-marker completed" style="background: #10b981;">✅</div>
          <div class="timeline-content">
            <div class="timeline-title">Resubmission Submitted</div>
            <div class="timeline-date">${formatDate(app.revisionSubmittedAt)}</div>
            <div style="color: #059669; font-size: 12px; margin-top: 2px;">Resubmit #${app.revisionCount || 1}</div>
          </div>
        </div>
        ` : ''}
        
        ${app.status === 'approved' ? `
        <div class="timeline-item">
          <div class="timeline-marker completed">✅</div>
          <div class="timeline-content">
            <div class="timeline-title">Application Approved</div>
            <div class="timeline-date">${app.reviewedAt ? formatDate(app.reviewedAt) : 'Completed'}</div>
          </div>
        </div>
        ` : app.status === 'rejected' ? `
        <div class="timeline-item">
          <div class="timeline-marker completed">❌</div>
          <div class="timeline-content">
            <div class="timeline-title">Application Rejected</div>
            <div class="timeline-date">${app.reviewedAt ? formatDate(app.reviewedAt) : 'Completed'}</div>
            ${app.rejectionReason ? `<div style="color: #ef4444; font-size: 14px; margin-top: 4px;">Reason: ${app.rejectionReason}</div>` : ''}
          </div>
        </div>
        ` : ''}
      </div>
      ${app.reviewedBy ? `
      <div style="margin-top: 20px; padding: 16px; background: #f8fafc; border-radius: 8px; border-left: 4px solid #10b981;">
        <div style="font-weight: 600; color: #1e293b; margin-bottom: 4px;">👤 Reviewed By</div>
        <div style="color: #64748b;">${app.reviewedBy}</div>
      </div>
      ` : ''}
    </div>
    
    ${app.notes ? `
      <div class="detail-section">
        <h4 class="section-title">📝 Notes</h4>
        <div style="padding: 12px; background: #fef3c7; border-radius: 6px; border-left: 4px solid #f59e0b;">
          ${app.notes}
        </div>
      </div>
    ` : ''}
  `;
}

// Print application
window.printApplication = function() {
  const detailsContent = document.getElementById('applicationDetails').innerHTML;
  const printWindow = window.open('', '_blank');
  
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Application Details</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        .detail-section { margin-bottom: 24px; }
        .section-title { color: #1f2937; border-bottom: 2px solid #10b981; padding-bottom: 8px; margin-bottom: 16px; }
        .detail-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
        .detail-item { display: flex; justify-content: space-between; }
        .detail-item label { font-weight: 600; color: #374151; }
        .status-badge { padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
        .status-pending { background: #fef3c7; color: #92400e; }
        .status-approved { background: #f0fdf4; color: #166534; }
        .status-rejected { background: #fef2f2; color: #dc2626; }
        .documents-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
        .document-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center; }
        @media print { body { padding: 10px; } }
      </style>
    </head>
    <body>
      <h1>Application Details</h1>
      ${detailsContent}
    </body>
    </html>
  `);
  
  printWindow.document.close();
  printWindow.print();
};

// Download all documents
window.downloadAllDocuments = function() {
  const application = userApplications.find(app => app.id === currentApplicationId);
  if (!application || !application.documents) return;
  
  application.documents.forEach((doc, index) => {
    setTimeout(() => {
      const link = document.createElement('a');
      link.href = doc.url || doc.data;
      link.download = doc.name || `Document_${index + 1}`;
      link.click();
    }, index * 500); // Stagger downloads
  });
};

// Add modal event listeners
document.addEventListener('DOMContentLoaded', function() {
  // Application modal close button
  const closeAppModalBtn = document.getElementById('closeAppModal');
  if (closeAppModalBtn) {
    closeAppModalBtn.addEventListener('click', () => {
      hideModal('applicationModal');
    });
  }
  
  // Close modal when clicking outside
  const applicationModal = document.getElementById('applicationModal');
  if (applicationModal) {
    applicationModal.addEventListener('click', (e) => {
      if (e.target.id === 'applicationModal') {
        hideModal('applicationModal');
      }
    });
  }
  
  // Image viewer modal close button
  const closeImageViewerBtn = document.getElementById('closeImageViewer');
  if (closeImageViewerBtn) {
    closeImageViewerBtn.addEventListener('click', () => {
      hideModal('imageViewerModal');
    });
  }
  
  // Close image viewer when clicking outside
  const imageViewerModal = document.getElementById('imageViewerModal');
  if (imageViewerModal) {
    imageViewerModal.addEventListener('click', (e) => {
      if (e.target.id === 'imageViewerModal') {
        hideModal('imageViewerModal');
      }
    });
  }
});

// Global variable to track current application
let currentApplicationId = null;

// Profile functionality
document.getElementById('editAvatarBtn')?.addEventListener('click', () => {
  document.getElementById('profilePicture').click();
});
document.getElementById('profilePicture')?.addEventListener('change', handleProfilePictureUpload);
document.getElementById('cancelProfileBtn')?.addEventListener('click', () => {
  // Disable edit mode and reload original data
  enableProfileEditMode(false);
});

// Hide error messages when user starts typing
document.getElementById('profileFirstName')?.addEventListener('input', () => {
  clearFieldError('profileFirstName');
});

document.getElementById('profileSurname')?.addEventListener('input', () => {
  clearFieldError('profileSurname');
});

document.getElementById('profileMiddleName')?.addEventListener('input', () => {
  clearFieldError('profileMiddleName');
});

// Mobile number input validation - only allow numbers, max 13 digits
document.getElementById('profileMobile')?.addEventListener('input', (e) => {
  // Remove any non-numeric characters
  let value = e.target.value.replace(/[^0-9]/g, '');
  // Limit to 13 digits maximum
  if (value.length > 13) {
    value = value.slice(0, 13);
  }
  e.target.value = value;
  clearFieldError('profileMobile');
});

// Mobile number prefix validation
document.getElementById('profileMobile')?.addEventListener('blur', (e) => {
  const value = e.target.value;
  if (value && value.length >= 2) {
    const prefix = value.substring(0, 2);
    if (prefix !== '09' && prefix !== '63') {
      showFieldError('profileMobile', 'Mobile number must start with 09 or 63.');
    }
  }
});

let originalProfileData = {};
let currentUser = null;

// Enable profile edit mode
function enableProfileEditMode(enable) {
  const form = document.getElementById('profileForm');
  const inputs = form.querySelectorAll('input, select, textarea');
  
  if (enable) {
    // Enable all inputs except email field
    inputs.forEach(input => {
      if (input.type !== 'file' && input.id !== 'profileEmail') {
        input.removeAttribute('readonly');
        input.style.background = '#ffffff';
        input.style.borderColor = '#e5e7eb';
      }
    });
    
    // Change button text to "Update Profile"
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.textContent = 'Update Profile';
      submitBtn.style.background = 'linear-gradient(135deg, #0b5f2c 0%, #0a7a3c 100%)';
    }
  } else {
    // Disable all inputs except file upload
    inputs.forEach(input => {
      if (input.type !== 'file') {
        input.setAttribute('readonly', true);
        input.style.background = '#f9fafb';
        input.style.borderColor = '#d1d5db';
      }
    });
    
    // Change button text to "Edit Profile"
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.textContent = 'Edit Profile';
      submitBtn.style.background = '#6b7280';
      submitBtn.disabled = false; // Re-enable button
    }
  }
}

function loadProfileData() {
  // Use currentUserData from auth state handler
  if (!currentUserData) {
    console.log('No user data available yet');
    return;
  }
  
  const userData = currentUserData;
  
  // Start in view mode (disabled inputs)
  enableProfileEditMode(false);
  
  // Store original data for cancel functionality
  originalProfileData = { ...userData };
  
  // Update UI with user data
  document.getElementById('profileFirstName').value = userData.firstName || '';
  document.getElementById('profileSurname').value = userData.surname || '';
  document.getElementById('profileMiddleName').value = userData.middleName || '';
  document.getElementById('profileSuffix').value = userData.suffix || '';
  document.getElementById('profileMobile').value = userData.mobile || '';
  
  // Load address fields
  document.getElementById('profileDistrict').value = userData.district || '';
  document.getElementById('profileMunicipal').value = userData.municipal || '';
  // Trigger change to populate barangays
  document.getElementById('profileMunicipal')?.dispatchEvent(new Event('change'));
  setTimeout(() => {
    document.getElementById('profileBarangay').value = userData.barangay || '';
  }, 100);
  document.getElementById('profileStreetAddress').value = userData.streetAddress || '';
  
  // Debug email loading
  console.log('Email loading debug:', {
    authEmail: auth.currentUser?.email,
    userDataEmail: userData.email,
    finalEmail: auth.currentUser?.email || userData.email || ''
  });
  
  document.getElementById('profileEmail').value = auth.currentUser?.email || userData.email || '';
  
  // Update profile header
  const fullName = `${userData.firstName || ''} ${userData.middleName ? userData.middleName + ' ' : ''}${userData.surname || ''} ${userData.suffix || ''}`.trim();
  document.getElementById('profileName').textContent = fullName || 'Customer Name';
  document.getElementById('profileEmailDisplay').textContent = auth.currentUser?.email || userData.email || 'customer@example.com';
  
  // Update avatar initials
  const initials = getInitials(userData.firstName, userData.surname);
  
  // Add null checks for elements that may not exist on current page
  const profileAvatarInitials = document.getElementById('profileAvatarInitials');
  if (profileAvatarInitials) profileAvatarInitials.textContent = initials;
  
  const userInitials = document.getElementById('userInitials');
  if (userInitials) userInitials.textContent = initials;
  
  // Update dropdown avatar with profile picture
  const dropdownInitials = document.getElementById('dropdownInitials');
  if (dropdownInitials) {
    if (userData.profilePicture) {
      dropdownInitials.style.backgroundImage = `url(${userData.profilePicture})`;
      dropdownInitials.style.backgroundSize = 'cover';
      dropdownInitials.style.backgroundPosition = 'center';
      dropdownInitials.textContent = '';
    } else {
      dropdownInitials.style.backgroundImage = '';
      dropdownInitials.textContent = initials;
    }
  }
  
  const dropdownName = document.getElementById('dropdownName');
  if (dropdownName) dropdownName.textContent = fullName || 'Customer Name';
  
  const dropdownEmail = document.getElementById('dropdownEmail');
  if (dropdownEmail) dropdownEmail.textContent = userData.email || '';
  
  // Update account information
  const profileCreated = document.getElementById('profileCreated');
  if (profileCreated) profileCreated.value = formatDate(userData.createdAt) || 'N/A';
  
  const profileLastLogin = document.getElementById('profileLastLogin');
  if (profileLastLogin) profileLastLogin.value = formatDate(userData.lastLogin) || 'N/A';
  
  // Load profile picture if exists
  if (userData.profilePicture) {
    const profileAvatar = document.getElementById('profileAvatar');
    if (profileAvatar) {
      profileAvatar.style.backgroundImage = `url(${userData.profilePicture})`;
      profileAvatar.style.backgroundSize = 'cover';
      profileAvatar.style.backgroundPosition = 'center';
      const profileAvatarInitials = document.getElementById('profileAvatarInitials');
      if (profileAvatarInitials) profileAvatarInitials.style.display = 'none';
    }
    
    // Also update header avatar with profile picture
    const userInitials = document.getElementById('userInitials');
    if (userInitials) {
      userInitials.style.backgroundImage = `url(${userData.profilePicture})`;
      userInitials.style.backgroundSize = 'cover';
      userInitials.style.backgroundPosition = 'center';
      userInitials.textContent = '';
    }
    
    // Update dropdown avatar too
    const dropdownInitials = document.getElementById('dropdownInitials');
    if (dropdownInitials) {
      dropdownInitials.style.backgroundImage = `url(${userData.profilePicture})`;
      dropdownInitials.style.backgroundSize = 'cover';
      dropdownInitials.style.backgroundPosition = 'center';
      dropdownInitials.textContent = '';
    }
  }
}

function saveProfile(e) {
  e.preventDefault();
  
  if (!currentUserData) {
    showAlert('You must be logged in to update your profile', 'warning');
    return;
  }
  
  const district = document.getElementById('profileDistrict').value;
  const municipal = document.getElementById('profileMunicipal').value;
  const barangay = document.getElementById('profileBarangay').value;
  const streetAddress = document.getElementById('profileStreetAddress').value;
  
  const profileData = {
    firstName: document.getElementById('profileFirstName').value,
    surname: document.getElementById('profileSurname').value,
    middleName: document.getElementById('profileMiddleName').value,
    suffix: document.getElementById('profileSuffix').value,
    mobile: document.getElementById('profileMobile').value,
    district,
    municipal,
    barangay,
    streetAddress,
    address: `${streetAddress}, ${barangay}, ${municipal}, ${district}`,
    lastUpdated: new Date().toISOString()
  };
  
  const userRef = doc(db, 'users', currentUserData.uid);
  
  updateDoc(userRef, profileData).then(() => {
    showAlert('Profile updated successfully!', 'success');
    currentUserData = { ...currentUserData, ...profileData };
    loadProfileData();
    updateProfileCompletion(currentUserData);
  }).catch((error) => {
    console.error('Error updating profile:', error);
    showAlert('Error updating profile. Please try again.', 'error');
  });
}

async function handleProfilePictureUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  if (!currentUserData) {
    showAlert('You must be logged in to upload a profile picture', 'warning');
    return;
  }
  
  try {
    // Show upload progress
    showAlert('Uploading profile picture...', 'info');
    
    let uploadResult;
    
    // Check if fileUploadManager is available
    if (window.fileUploadManager && window.fileUploadManager.uploadFile) {
      // Use the file upload manager for better large file handling
      uploadResult = await window.fileUploadManager.uploadFile(file, {
        folder: 'profile-pictures',
        validateOptions: {
          allowImages: true,
          allowDocuments: false,
          maxSize: 10 * 1024 * 1024 // 10MB for profile pictures
        },
        onProgress: (progress) => {
          console.log(`Upload progress: ${Math.round(progress)}%`);
        }
      });
    } else {
      // Fallback: upload directly to Cloudinary server endpoint
      console.log('FileUploadManager not available, using fallback upload');
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'profile-pictures');
      
      const uploadResponse = await fetch('/upload-file-to-cloudinary', {
        method: 'POST',
        body: formData
      });
      
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
      }
      
      const result = await uploadResponse.json();
      if (!result.success) {
        throw new Error(result.error || 'Upload failed');
      }
      
      uploadResult = {
        url: result.url,
        public_id: result.public_id
      };
    }
    
    // Update user profile with Cloudinary URL
    const userUid = currentUserData.uid || auth.currentUser.uid;
    if (!userUid) {
      throw new Error('User ID not found. Please log in again.');
    }
    
    const userRef = doc(db, 'users', userUid);
    await updateDoc(userRef, {
      profilePicture: uploadResult.url,
      profilePicturePublicId: uploadResult.public_id,
      lastUpdated: new Date().toISOString()
    });
    
    showAlert('Profile picture updated successfully!', 'success');
    currentUserData.profilePicture = uploadResult.url;
    currentUserData.profilePicturePublicId = uploadResult.public_id;
    loadProfileData();
    updateProfileCompletion(currentUserData);
    
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    showAlert(error.message || 'Error uploading profile picture. Please try again.', 'error');
  }
  
  // Reset file input
  e.target.value = '';
}

function getInitials(firstName, surname) {
  const first = firstName ? firstName.charAt(0).toUpperCase() : '';
  const last = surname ? surname.charAt(0).toUpperCase() : '';
  return first + last || 'CU';
}

// Format file size for display
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Get file icon based on type or extension
function getFileIcon(fileTypeOrName) {
  const type = fileTypeOrName.toLowerCase();
  
  if (type.includes('pdf')) return '📄';
  if (type.includes('doc') || type.includes('word')) return '📝';
  if (type.includes('xls') || type.includes('excel') || type.includes('spreadsheet')) return '📊';
  if (type.includes('ppt') || type.includes('powerpoint')) return '📽️';
  if (type.includes('jpg') || type.includes('jpeg') || type.includes('png') || type.includes('gif')) return '🖼️';
  if (type.includes('zip') || type.includes('rar') || type.includes('7z')) return '🗜️';
  if (type.includes('txt')) return '📃';
  
  return '📁'; // Default icon
}

// Clean Cloudinary URL to fix double extensions
function cleanCloudinaryUrl(url) {
  if (!url.includes('cloudinary')) return url;
  
  // Remove query parameters first
  const baseUrl = url.split('?')[0];
  
  // Fix double extensions (e.g., .pdf.pdf -> .pdf)
  let cleanUrl = baseUrl.replace(/(\.[^.]+)\1+$/, '$1');
  
  return cleanUrl;
}

// Download file function
window.downloadFile = function(url, filename) {
  try {
    // Validate URL
    if (!url || url.trim() === '') {
      throw new Error('No file URL available');
    }
    
    // Create a temporary anchor element
    const link = document.createElement('a');
    let downloadUrl = url.trim();
    
    // For Cloudinary URLs, handle different resource types
    if (url.includes('cloudinary')) {
      // Clean the URL to fix double extensions
      const cleanBaseUrl = cleanCloudinaryUrl(url);
      
      // For raw documents (PDFs, etc.), use different download approach
      if (url.includes('/raw/upload/')) {
        downloadUrl = cleanBaseUrl; // Raw files download directly
      } else if (url.includes('/image/upload/')) {
        downloadUrl = `${cleanBaseUrl}?fl_attachment=true`; // Images need attachment flag
      }
      
      // Set download attribute to help with filename
      link.download = filename || 'download';
    } else {
      link.download = filename || 'download';
    }
    
    link.href = downloadUrl;
    link.target = '_blank';
    
    // Trigger the download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showAlert('Download started successfully!', 'success');
  } catch (error) {
    console.error('Download error:', error);
    showAlert(`Failed to download file: ${error.message}`, 'error');
  }
};

// Call loadProfileData when navigating to profile section
const profileSection = document.getElementById('profileSection');
if (profileSection) {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.target.classList.contains('active')) {
        loadProfileData();
      }
    });
  });
  observer.observe(profileSection, { attributes: true, attributeFilter: ['class'] });
}

// Settings functionality
document.getElementById('saveNotificationBtn')?.addEventListener('click', saveNotificationSettings);
document.getElementById('changePasswordBtn')?.addEventListener('click', changePassword);
document.getElementById('requestDataBtn')?.addEventListener('click', requestData);
document.getElementById('deleteAccountBtn')?.addEventListener('click', deleteAccount);

// Tab switching functionality
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;
    switchTab(tabId);
  });
});

function switchTab(tabId) {
  // Remove active class from all tabs and buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });
  
  // Add active class to selected tab and button
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

function loadSettingsData() {
  if (!currentUserData) return;

  const userData = currentUserData;
  
  // Load profile card data for settings
  const firstName = userData.firstName || '';
  const surname = userData.surname || '';
  const fullName = firstName && surname ? `${firstName} ${surname}` : (userData.email?.split('@')[0] || 'Customer');
  const initials = (firstName[0] + (surname ? surname[0] : '')).toUpperCase() || 'CU';
  
  // Settings Profile Card
  const settingsProfileName = document.getElementById('settingsProfileName');
  const settingsProfileEmailDisplay = document.getElementById('settingsProfileEmailDisplay');
  const settingsProfileStatus = document.getElementById('settingsProfileStatus');
  const settingsProfileAvatar = document.getElementById('settingsProfileAvatar');
  const settingsProfileAvatarInitials = document.getElementById('settingsProfileAvatarInitials');
  
  if (settingsProfileName) settingsProfileName.textContent = fullName;
  if (settingsProfileEmailDisplay) settingsProfileEmailDisplay.textContent = userData.email || '';
  if (settingsProfileStatus) settingsProfileStatus.textContent = userData.verified ? 'Verified' : 'Unverified';
  
  // Settings Profile Avatar with picture
  if (settingsProfileAvatar) {
    if (userData.profilePicture) {
      settingsProfileAvatar.style.backgroundImage = `url(${userData.profilePicture})`;
      settingsProfileAvatar.style.backgroundSize = 'cover';
      settingsProfileAvatar.style.backgroundPosition = 'center';
      if (settingsProfileAvatarInitials) settingsProfileAvatarInitials.style.display = 'none';
    } else {
      settingsProfileAvatar.style.backgroundImage = '';
      if (settingsProfileAvatarInitials) {
        settingsProfileAvatarInitials.textContent = initials;
        settingsProfileAvatarInitials.style.display = '';
      }
    }
  }
  
  // Account Info
  const settingsEmail = document.getElementById('settingsEmail');
  const settingsPhone = document.getElementById('settingsPhone');
  const settingsAddress = document.getElementById('settingsAddress');
  
  if (settingsEmail) settingsEmail.textContent = userData.email || 'Not set';
  if (settingsPhone) settingsPhone.textContent = userData.mobile || 'Not set';
  if (settingsAddress) {
    const address = userData.address || (userData.streetAddress ? `${userData.streetAddress}, ${userData.barangay}, ${userData.municipal}, ${userData.district}` : 'Not set');
    settingsAddress.textContent = address;
  }
  
  // Load notification preferences
  const notifyStatusChange = document.getElementById('notifyStatusChange');
  const notifyApproved = document.getElementById('notifyApproved');
  const notifyRejected = document.getElementById('notifyRejected');
  const notifyWeekly = document.getElementById('notifyWeekly');
  const allowDataCollection = document.getElementById('allowDataCollection');
  
  if (notifyStatusChange) notifyStatusChange.checked = userData.notifyStatusChange !== false;
  if (notifyApproved) notifyApproved.checked = userData.notifyApproved !== false;
  if (notifyRejected) notifyRejected.checked = userData.notifyRejected === true;
  if (notifyWeekly) notifyWeekly.checked = userData.notifyWeekly === true;
  if (allowDataCollection) allowDataCollection.checked = userData.allowDataCollection !== false;
}

function saveNotificationSettings() {
  if (!currentUserData) {
    showAlert('You must be logged in to save settings', 'warning');
    return;
  }

  const settings = {
    notifyStatusChange: document.getElementById('notifyStatusChange').checked,
    notifyApproved: document.getElementById('notifyApproved').checked,
    notifyRejected: document.getElementById('notifyRejected').checked,
    notifyWeekly: document.getElementById('notifyWeekly').checked,
    allowDataCollection: document.getElementById('allowDataCollection').checked,
    lastUpdated: new Date().toISOString()
  };

  const userRef = doc(db, 'users', currentUserData.uid);
  
  updateDoc(userRef, settings).then(() => {
    showAlert('Notification settings saved successfully!', 'success');
    // Update currentUserData with new settings
    currentUserData = { ...currentUserData, ...settings };
  }).catch((error) => {
    console.error('Error saving settings:', error);
    showAlert('Error saving settings. Please try again.', 'error');
  });
}

function changePassword() {
  const email = currentUserData?.email;
  if (!email) {
    showAlert('No email associated with your account', 'warning');
    return;
  }

  sendPasswordResetEmail(auth, email).then(() => {
    showAlert('Password reset email sent! Check your inbox for instructions.', 'success');
  }).catch((error) => {
    console.error('Error sending password reset email:', error);
    showAlert('Error sending password reset email. Please try again.', 'error');
  });
}

function requestData() {
  if (!currentUserData) {
    showAlert('You must be logged in to request your data', 'warning');
    return;
  }

  const userRef = doc(db, 'users', currentUserData.uid);
  
  getDoc(userRef).then((doc) => {
    if (doc.exists()) {
      const userData = doc.data();
      const dataStr = JSON.stringify(userData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `my_data_${currentUserData.uid}_${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showAlert('Your data has been downloaded!', 'success');
    }
  }).catch((error) => {
    console.error('Error retrieving data:', error);
    showAlert('Error retrieving your data. Please try again.', 'error');
  });
}

function deleteAccount() {
  if (!confirm('Are you sure you want to delete your account? This action cannot be undone and all your data will be permanently deleted.')) {
    return;
  }

  if (!confirm('This is your last chance! All your applications, personal data, and account information will be permanently deleted. Type "DELETE" to confirm.')) {
    return;
  }

  if (!currentUserData) {
    showAlert('You must be logged in to delete your account', 'warning');
    return;
  }

  // Delete user document from Firestore
  const userRef = doc(db, 'users', currentUserData.uid);
  
  deleteDoc(userRef).then(() => {
    // Delete user from Firebase Auth
    const user = auth.currentUser;
    if (user) {
      return user.delete();
    }
  }).then(() => {
    showAlert('Account deleted successfully. You will be redirected to the home page.', 'success');
    window.location.href = 'index.html';
  }).catch((error) => {
    console.error('Error deleting account:', error);
    if (error.code === 'auth/requires-recent-login') {
      showAlert('For security reasons, you need to re-login before deleting your account. Please logout and login again, then try deleting your account.', 'warning');
    } else {
      showAlert('Error deleting account. Please try again or contact support.', 'error');
    }
  });
}

// Call loadSettingsData when navigating to settings section
const settingsSection = document.getElementById('settingsSection');
if (settingsSection) {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.target.classList.contains('active')) {
        loadSettingsData();
      }
    });
  });
  observer.observe(settingsSection, { attributes: true, attributeFilter: ['class'] });
}

// User dropdown functionality
const userAvatarBtn = document.getElementById('userAvatarBtn');
const userDropdown = document.getElementById('userDropdown');
const dropdownLogoutBtn = document.getElementById('dropdownLogoutBtn');

userAvatarBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  userDropdown.style.display = userDropdown.style.display === 'none' ? 'block' : 'none';
});

// Logout Modal Elements
const logoutModal = document.getElementById('logoutModal');
const logoutModalCloseBtn = document.getElementById('logoutModalCloseBtn');
const cancelLogout = document.getElementById('cancelLogout');
const confirmLogout = document.getElementById('confirmLogout');

// Show logout modal function
function showLogoutModal() {
  if (logoutModal) {
    logoutModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // Trigger animation
    setTimeout(() => {
      logoutModal.classList.add('validation-modal-show');
    }, 10);
  }
}

// Hide logout modal function
function hideLogoutModal() {
  if (logoutModal) {
    logoutModal.classList.remove('validation-modal-show');
    setTimeout(() => {
      logoutModal.style.display = 'none';
      document.body.style.overflow = '';
    }, 300);
  }
}

// Dropdown logout button click
dropdownLogoutBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  userDropdown.style.display = 'none';
  showLogoutModal();
});

// Close modal when clicking X
logoutModalCloseBtn?.addEventListener('click', hideLogoutModal);

// Cancel logout
cancelLogout?.addEventListener('click', hideLogoutModal);

// Confirm logout
confirmLogout?.addEventListener('click', async () => {
  try {
    hideLogoutModal();
    await logout();
  } catch (error) {
    console.error('Logout error:', error);
    showAlert('Error logging out. Please try again.', 'error');
  }
});

// Close modal when clicking overlay
logoutModal?.addEventListener('click', (e) => {
  if (e.target === logoutModal) {
    hideLogoutModal();
  }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && logoutModal?.style.display === 'flex') {
    hideLogoutModal();
  }
});

// Close dropdown when clicking on menu items
document.querySelectorAll('.dropdown-item').forEach(item => {
  item.addEventListener('click', (e) => {
    userDropdown.style.display = 'none';
  });
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (userDropdown && !userAvatarBtn.contains(e.target)) {
    userDropdown.style.display = 'none';
  }
});

// Update dropdown user info when user data is loaded
function updateDropdownUserInfo() {
  const dropdownName = document.getElementById('dropdownName');
  const dropdownEmail = document.getElementById('dropdownEmail');
  const dropdownInitials = document.getElementById('dropdownInitials');
  
  if (currentUser) {
    const name = currentUser.displayName || currentUser.name || 'User';
    const email = currentUser.email || '';
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    
    if (dropdownName) dropdownName.textContent = name;
    if (dropdownEmail) dropdownEmail.textContent = email;
    
    // Use profile picture if available
    if (dropdownInitials) {
      if (currentUserData && currentUserData.profilePicture) {
        dropdownInitials.style.backgroundImage = `url(${currentUserData.profilePicture})`;
        dropdownInitials.style.backgroundSize = 'cover';
        dropdownInitials.style.backgroundPosition = 'center';
        dropdownInitials.textContent = '';
      } else {
        dropdownInitials.style.backgroundImage = '';
        dropdownInitials.textContent = initials;
      }
    }
  }
}

// Logout function
async function logout() {
  try {
    // Clear current section so on login it goes to dashboard
    localStorage.removeItem('currentSection');
    await authGuardLogout('/pages/index.html');
  } catch (error) {
    console.error('Logout error:', error);
    showAlert('Error logging out. Please try again.', 'error');
  }
}

document.getElementById('applyFilterBtn')?.addEventListener('click', applyFilters);
document.getElementById('clearFilterBtn')?.addEventListener('click', clearFilters);

function applyFilters() {
  const statusFilter = document.getElementById('filterStatus').value;
  const documentTypeFilter = document.getElementById('filterDocumentType').value;
  const dateFromFilter = document.getElementById('filterDateFrom').value;
  const dateToFilter = document.getElementById('filterDateTo').value;
  const searchFilter = document.getElementById('searchApplication').value.toLowerCase();

  const filteredApplications = userApplications.filter(app => {
    let match = true;

    if (statusFilter && app.status !== statusFilter) {
      match = false;
    }

    if (documentTypeFilter && app.documentType !== documentTypeFilter) {
      match = false;
    }

    if (dateFromFilter && app.createdAt) {
      const appDate = app.createdAt.toDate ? app.createdAt.toDate() : new Date(app.createdAt);
      if (appDate < new Date(dateFromFilter)) {
        match = false;
      }
    }

    if (dateToFilter && app.createdAt) {
      const appDate = app.createdAt.toDate ? app.createdAt.toDate() : new Date(app.createdAt);
      if (appDate > new Date(dateToFilter)) {
        match = false;
      }
    }

    if (searchFilter) {
      const searchStr = `${app.applicationId} ${app.permitType}`.toLowerCase();
      if (!searchStr.includes(searchFilter)) {
        match = false;
      }
    }

    return match;
  });

  displayApplicationsWithFilter(filteredApplications);
}

function clearFilters() {
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterDocumentType').value = '';
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
  document.getElementById('searchApplication').value = '';
  displayApplications();
}

function displayApplicationsWithFilter(applications) {
  applicationsCurrentPage = 1; // reset to first page whenever filters change
  renderApplicationsTable(applications, 'No applications found matching your filters.');
}

// Wire up pagination click handlers (delegated, runs once on DOM ready)
document.addEventListener('DOMContentLoaded', () => {
  const prevBtn = document.getElementById('applicationsPaginationPrev');
  const nextBtn = document.getElementById('applicationsPaginationNext');
  const pages = document.getElementById('applicationsPaginationPages');

  const goToPage = (page) => {
    if (!applicationsActiveDataset) return;
    const total = applicationsActiveDataset.length;
    const totalPages = Math.max(1, Math.ceil(total / APPLICATIONS_PAGE_SIZE));
    const target = Math.min(Math.max(1, page), totalPages);
    if (target === applicationsCurrentPage) return;
    applicationsCurrentPage = target;
    renderApplicationsTable(applicationsActiveDataset, 'No applications found matching your filters.');
    // Scroll the table into view so the user sees the new page
    document.querySelector('.table-container-applications')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  prevBtn?.addEventListener('click', () => goToPage(applicationsCurrentPage - 1));
  nextBtn?.addEventListener('click', () => goToPage(applicationsCurrentPage + 1));
  pages?.addEventListener('click', (e) => {
    const btn = e.target.closest('.apps-pagination__page');
    if (!btn) return;
    const page = parseInt(btn.dataset.page, 10);
    if (!Number.isNaN(page)) goToPage(page);
  });
});

// Update statistics
function updateStats() {
  const totalApps = document.getElementById('totalApps');
  const pendingApps = document.getElementById('pendingApps');
  const approvedApps = document.getElementById('approvedApps');
  const rejectedApps = document.getElementById('rejectedApps');
  
  const pending = userApplications.filter(app => app.status === 'pending' || app.status === 'under review').length;
  const approved = userApplications.filter(app => app.status === 'approved').length;
  const rejected = userApplications.filter(app => app.status === 'rejected').length;
  
  if (totalApps) totalApps.textContent = userApplications.length;
  if (pendingApps) pendingApps.textContent = pending;
  if (approvedApps) approvedApps.textContent = approved;
  if (rejectedApps) rejectedApps.textContent = rejected;
}

// Get CSS class for status
function getStatusClass(status) {
  const statusMap = {
    'pending': 'pending',
    'under review': 'under-review',
    'needs revision': 'needs-resubmit',
    'needs resubmit': 'needs-resubmit',
    'approved': 'approved',
    'rejected': 'rejected'
  };
  return statusMap[status?.toLowerCase()] || 'pending';
}

// Format date
function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// View application details
async function viewApplication(appId) {
  console.log('viewApplication called with appId:', appId);
  
  // Fetch fresh data from Firestore to ensure documents are up-to-date
  let app = null;
  try {
    const appRef = doc(db, 'applications', appId);
    const appSnap = await getDoc(appRef);
    if (appSnap.exists()) {
      app = { id: appSnap.id, ...appSnap.data() };
      console.log('Fetched fresh app data from Firestore:', app);
      
      // Update the cached list with fresh data
      const cachedIndex = userApplications.findIndex(a => a.id === appId);
      if (cachedIndex !== -1) {
        userApplications[cachedIndex] = app;
      }
    }
  } catch (error) {
    console.error('Error fetching fresh application data:', error);
    // Fallback to cached data
    app = userApplications.find(a => a.id === appId);
  }
  
  if (!app) {
    // Final fallback to cache
    app = userApplications.find(a => a.id === appId);
  }
  
  console.log('Found app:', app);
  
  if (!app) {
    console.log('Application not found');
    return;
  }
  
  const modal = document.getElementById('applicationModal');
  const detailsDiv = document.getElementById('applicationDetails');
  
  console.log('Modal element:', modal);
  console.log('Details element:', detailsDiv);
  
  detailsDiv.innerHTML = `
    <div class="detail-row">
      <div class="detail-label">Application ID:</div>
      <div class="detail-value">${app.applicationId || app.id}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Permit Type:</div>
      <div class="detail-value">${app.permitType || 'N/A'}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Applicant Name:</div>
      <div class="detail-value">${app.applicantName || 'N/A'}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Address:</div>
      <div class="detail-value">${app.applicantAddress || 'N/A'}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Mobile Number:</div>
      <div class="detail-value">${app.applicantMobile || 'N/A'}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Date Submitted:</div>
      <div class="detail-value">${formatDate(app.createdAt)}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Current Status:</div>
      <div class="detail-value">
        <span class="status-badge ${getStatusClass(app.status)}">${app.status}</span>
      </div>
    </div>
    ${app.applicationDetails ? `
    <div class="detail-row">
      <div class="detail-label">Application Details:</div>
      <div class="detail-value">${app.applicationDetails}</div>
    </div>
    ` : ''}
    ${app.rejectionReason ? `
    <div class="detail-row">
      <div class="detail-label">Rejection Reason:</div>
      <div class="detail-value" style="color: #ef4444;">${app.rejectionReason}</div>
    </div>
    ` : ''}
    ${app.revisionComments ? `
    <div class="detail-row">
      <div class="detail-label">📝 Revision Required:</div>
      <div class="detail-value" style="color: #f59e0b; background: #fffbeb; padding: 12px; border-radius: 6px; border-left: 4px solid #f59e0b;">
        <strong>Please revise the following:</strong><br>
        ${app.revisionComments}
      </div>
    </div>
    ` : ''}
    ${app.reviewedBy ? `
    <div class="detail-row">
      <div class="detail-label">Reviewed By:</div>
      <div class="detail-value">${app.reviewedBy}</div>
    </div>
    ` : ''}
    ${app.reviewedAt ? `
    <div class="detail-row">
      <div class="detail-label">Review Date:</div>
      <div class="detail-value">${formatDate(app.reviewedAt)}</div>
    </div>
    ` : ''}
    ${app.documents && app.documents.length > 0 ? `
    <div class="detail-row">
      <div class="detail-label">Uploaded Documents:</div>
      <div class="detail-value">
        ${app.documents.map((doc, index) => {
          // Debug: Log document structure
          console.log(`Document ${index}:`, doc);
          
          // Handle different document URL field names
          const docUrl = doc.url || doc.data || doc.downloadUrl || doc.cloudinaryUrl || '';
          const docName = doc.name || doc.fileName || doc.originalName || `Document ${index + 1}`;
          const docType = doc.type || doc.mimeType || doc.contentType || '';
          const docSize = doc.size || doc.fileSize || 0;
          const docPublicId = doc.public_id || doc.publicId || doc.cloudinaryPublicId || '';
          
          // Generate Cloudinary optimized URLs if available
          const isCloudinary = docPublicId || (docUrl && docUrl.includes('cloudinary'));
          const isImage = docType && docType.startsWith('image/');
          
          let thumbnailUrl = docUrl;
          let highQualityUrl = docUrl;
          
          // Only apply transformations for images uploaded to image/upload
          if (isCloudinary && docPublicId && isImage && docUrl.includes('/image/upload/')) {
            const urlParts = docUrl.split('/image/upload/');
            if (urlParts.length === 2) {
              const baseUrl = urlParts[0] + '/image/upload/';
              const imageId = urlParts[1];
              
              thumbnailUrl = `${baseUrl}q_auto:good,f_auto,w_200,h_150,c_fill,q_80/${imageId}`;
              highQualityUrl = `${baseUrl}q_auto:best,f_auto,w_800,h_600,c_limit,q_90/${imageId}`;
            }
          }
          
          // Check if URL exists before proceeding
          if (!docUrl) {
            return `<div class="document-card" style="margin-top: 12px; padding: 12px; border: 1px solid #ef4444; border-radius: 8px; background: #fef2f2;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="font-size: 24px;">❌</div>
                <div style="flex: 1;">
                  <div style="font-weight: 500; color: #dc2626; margin-bottom: 4px;">${docName}</div>
                  <div style="font-size: 12px; color: #7f1d1d;">
                    File URL not available - Document may be corrupted
                  </div>
                </div>
              </div>
            </div>`;
          }
          
          if (docType && docType.startsWith('image/')) {
            return `<div class="document-card" style="margin-top: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="font-weight: 500; color: #374151; flex: 1;">${docName}</div>
                <div style="font-size: 11px; color: #6b7280;">
                  ${docSize ? formatFileSize(docSize) : ''}
                  ${isCloudinary ? ' • Optimized' : ''}
                </div>
              </div>
              <div style="position: relative; margin-bottom: 8px;">
                <img src="${thumbnailUrl}" alt="${docName}" 
                     style="width: 100%; max-height: 150px; object-fit: cover; border-radius: 6px; border: 1px solid #d1d5db; cursor: pointer;" 
                     onclick="window.open('${highQualityUrl}', '_blank')"
                     onmouseover="this.src='${highQualityUrl}'" 
                     onmouseout="this.src='${thumbnailUrl}'" />
                <div style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.7); color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px;">
                  🔍 Click to enlarge
                </div>
              </div>
            </div>`;
          } else {
            // Handle documents (PDF, Word, etc.)
            const fileIcon = getFileIcon(docType || docName);
            return `<div class="document-card" style="margin-top: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="font-size: 24px;">${fileIcon}</div>
                <div style="flex: 1;">
                  <div style="font-weight: 500; color: #374151; margin-bottom: 4px;">${docName}</div>
                  <div style="font-size: 12px; color: #6b7280;">
                    ${docSize ? formatFileSize(docSize) : ''}
                    ${isCloudinary ? ' • Cloudinary Hosted' : ''}
                  </div>
                </div>
              </div>
              <div style="display: flex; gap: 8px; margin-top: 8px;">
                <button onclick="downloadFile('${docUrl}', '${docName}')" style="
                  background: #10b981;
                  color: white;
                  border: none;
                  padding: 6px 12px;
                  border-radius: 4px;
                  font-size: 12px;
                  cursor: pointer;
                  width: 100%;
                ">Download</button>
              </div>
            </div>`;
          }
        }).join('')}
      </div>
    </div>
    ` : ''}
  `;
  
  // Add pickup schedule for approved applications
  if (app.status && app.status.toLowerCase() === 'approved') {
    console.log('Adding pickup schedule for approved app');
    detailsDiv.innerHTML += `
      <div class="detail-row" style="margin-top: 20px;">
        <div class="detail-label" style="vertical-align: top;">📅 Pickup Schedule:</div>
        <div class="detail-value">
          ${app.pickupSchedule && app.pickupSchedule.date ? `
            <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; border-left: 4px solid #10b981; margin-top: 8px;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div>
                  <strong>Date:</strong><br>
                  <span style="font-size: 14px;">${app.pickupSchedule.date}</span>
                </div>
                <div>
                  <strong>Time:</strong><br>
                  <span style="font-size: 14px; ${app.pickupSchedule.time ? '' : 'color: #64748b;'}">${app.pickupSchedule.time || 'To be scheduled'}</span>
                </div>
                ${app.pickupSchedule.notes ? `
                  <div style="grid-column: 1 / -1; margin-top: 8px;">
                    <strong>Notes:</strong><br>
                    <span style="font-size: 13px;">${app.pickupSchedule.notes}</span>
                  </div>
                ` : ''}
              </div>
            </div>
          ` : `
            <div style="background: #fef3c7; padding: 16px; border-radius: 8px; border-left: 4px solid #f59e0b; margin-top: 8px;">
              <div style="text-align: center; color: #92400e;">
                <div style="font-size: 20px; margin-bottom: 6px;">📅</div>
                <div style="font-weight: 600; margin-bottom: 4px;">Pickup Schedule Pending</div>
                <div style="font-size: 13px;">Your permit has been approved. Please wait for the pickup schedule to be assigned.</div>
              </div>
            </div>
          `}
        </div>
      </div>
    `;
  }
  
  console.log('Setting modal display to flex');
  modal.style.display = 'flex';
  console.log('Modal display after setting:', modal.style.display);
};

// Delete application
window.deleteApplication = async function(appId) {
  if (!confirm('Are you sure you want to delete this application? This action cannot be undone.')) {
    return;
  }
  
  try {
    await deleteDoc(doc(db, 'applications', appId));
    showAlert('Application deleted successfully!', 'success');
    await fetchUserApplications();
    updateStats();
    loadActivityFeed();
  } catch (error) {
    console.error('Error deleting application:', error);
    showAlert('Error deleting application. Please try again.', 'error');
  }
};

// Edit application
window.editApplication = function(appId) {
  const app = userApplications.find(a => a.id === appId);
  if (!app) {
    console.error('Application not found:', appId);
    return;
  }
  
  // Store the application ID and existing documents for update BEFORE navigation
  window.editingAppId = appId;
  window.existingDocuments = app.documents || [];
  window.editingApplicationData = app; // Store full app data for reference
  console.log('Stored existing documents for editing:', window.existingDocuments);
  
  // Clear localStorage to prevent conflicts with edit mode
  localStorage.removeItem('newApplicationForm_data');
  localStorage.removeItem('currentFormStep');
  console.log('Cleared localStorage for edit mode');
  
  // Navigate to new application section first to ensure form is loaded
  navigateToSection('newApplicationSection');
  
  // IMPORTANT: Reset form to step 1 so form elements are visible
  resetFormSteps();
  goToStep(1);
  console.log('Reset form to step 1 for editing');
  
  // Wait for the section and form steps to load properly, then populate the form
  setTimeout(() => {
    try {
      console.log('Starting form population for edit mode...');
      
      // Check if form elements exist before trying to set values
      const documentTypeEl = document.getElementById('documentType');
      const permitTypeEl = document.getElementById('permitType');
      const firstNameEl = document.getElementById('firstName');
      const lastNameEl = document.getElementById('lastName');
      const applicantNameEl = document.getElementById('applicantName');
      
      if (!documentTypeEl || !permitTypeEl) {
        console.error('❌ Form elements not found even after reset. Retrying with longer delay...');
        // Retry after a longer delay
        setTimeout(() => {
          resetFormSteps();
          goToStep(1);
          setTimeout(() => populateEditForm(app), 300);
        }, 800);
        return;
      }
      
      console.log('✅ Form elements found:', {
        documentType: !!documentTypeEl,
        permitType: !!permitTypeEl,
        firstName: !!firstNameEl,
        lastName: !!lastNameEl,
        applicantName: !!applicantNameEl
      });
      console.log('✅ Proceeding with form population...');
      // Call the population function
      populateEditForm(app);
    } catch (error) {
      console.error('❌ Error populating edit form:', error);
    }
  }, 600);
};

// Function to populate edit form with existing application data
function populateEditForm(app) {
  console.log('Populating edit form with data:', app);
  
  try {
    // Step 1: Document Type and Permit Type
    const documentTypeEl = document.getElementById('documentType');
    const permitTypeEl = document.getElementById('permitType');
    
    if (documentTypeEl && app.documentType) {
      const knownDocTypes = Object.keys(documentTypeOptions || {});
      if (!knownDocTypes.includes(app.documentType)) {
        const legacyOpt = document.createElement('option');
        legacyOpt.value = app.documentType;
        legacyOpt.textContent = `${app.documentType} (legacy record)`;
        documentTypeEl.appendChild(legacyOpt);
      }
      documentTypeEl.value = app.documentType;
      documentTypeEl.dispatchEvent(new Event('change'));
      console.log('Set document type:', app.documentType);
    }
    
    if (permitTypeEl && app.permitType) {
      setTimeout(() => {
        const hasOption = Array.from(permitTypeEl.options).some((o) => o.value === app.permitType);
        if (!hasOption) {
          const opt = document.createElement('option');
          opt.value = app.permitType;
          opt.textContent = `${app.permitType} (legacy record)`;
          permitTypeEl.appendChild(opt);
        }
        permitTypeEl.value = app.permitType;
        permitTypeEl.dispatchEvent(new Event('change'));
        console.log('Set permit type:', app.permitType);
      }, 100);
    }
    
    // Step 2: Applicant Information
    setTimeout(() => {
      // Personal Information fields
      const firstNameEl = document.getElementById('firstName');
      const lastNameEl = document.getElementById('lastName');
      const middleNameEl = document.getElementById('middleName');
      const suffixEl = document.getElementById('suffix');
      
      // Company/Business fields
      const applicantNameEl = document.getElementById('applicantName');
      const applicantAddressEl = document.getElementById('applicantAddress');
      const applicantMobileIndividualEl = document.getElementById('applicantMobileIndividual');
      const applicantMobileCompanyEl = document.getElementById('applicantMobileCompany');
      const applicationDetailsEl = document.getElementById('applicationDetailsInput');
      
      // Set personal information (from database fields: firstName, middleName, surname)
      if (firstNameEl && app.firstName) {
        firstNameEl.value = app.firstName;
      }
      if (lastNameEl && app.surname) {
        lastNameEl.value = app.surname;
      }
      if (middleNameEl && app.middleName) {
        middleNameEl.value = app.middleName;
      }
      if (suffixEl && app.suffix) {
        suffixEl.value = app.suffix;
      }
      
      // Set company/business information
      if (applicantNameEl && app.applicantName) {
        applicantNameEl.value = app.applicantName;
      }
      if (applicantAddressEl && app.applicantAddress) {
        applicantAddressEl.value = app.applicantAddress;
      }
      if (applicantMobileIndividualEl && app.applicantMobile) {
        applicantMobileIndividualEl.value = app.applicantMobile;
      }
      if (applicantMobileCompanyEl && app.applicantMobile) {
        applicantMobileCompanyEl.value = app.applicantMobile;
      }
      if (applicationDetailsEl && app.applicationDetails) {
        applicationDetailsEl.value = app.applicationDetails;
      }
      
      console.log('Populated applicant information:', {
        firstName: app.firstName,
        surname: app.surname,
        middleName: app.middleName,
        applicantName: app.applicantName,
        applicantAddress: app.applicantAddress
      });
    }, 200);
    
    // Step 3: Project Details
    setTimeout(() => {
      const projectTitleEl = document.getElementById('projectTitle');
      const projectLocationEl = document.getElementById('projectLocation');
      const projectDescriptionEl = document.getElementById('projectDescription');
      const projectCostEl = document.getElementById('projectCost');
      
      if (projectTitleEl && app.projectTitle) {
        projectTitleEl.value = app.projectTitle;
      }
      if (projectLocationEl && app.projectLocation) {
        projectLocationEl.value = app.projectLocation;
      }
      if (projectDescriptionEl && app.projectDescription) {
        projectDescriptionEl.value = app.projectDescription;
      }
      if (projectCostEl && app.projectCost) {
        projectCostEl.value = app.projectCost;
      }
      
      console.log('Populated project details');
    }, 300);
    
    // Step 4: Location coordinates
    setTimeout(() => {
      const appLatitudeEl = document.getElementById('appLatitude');
      const appLongitudeEl = document.getElementById('appLongitude');
      
      if (appLatitudeEl && app.latitude) {
        appLatitudeEl.value = app.latitude;
      }
      if (appLongitudeEl && app.longitude) {
        appLongitudeEl.value = app.longitude;
      }
      
      console.log('Populated location coordinates');
    }, 400);
    
    // Step 5: Display existing documents
    setTimeout(() => {
      if (app.documents && app.documents.length > 0) {
        displayExistingDocuments(app.documents);
      }
      console.log('Displayed existing documents:', app.documents?.length || 0);
    }, 500);
    
    // Step 6: Update submit button text
    setTimeout(() => {
      const submitBtn = document.getElementById('submitStep5') || document.querySelector('#newApplicationForm button[type="submit"]');
      if (submitBtn) {
        submitBtn.textContent = 'Update Application';
        console.log('Updated submit button text');
      }
    }, 600);
    
    console.log('✅ Edit form population complete!');
    
  } catch (error) {
    console.error('❌ Error in populateEditForm:', error);
  }
}

// Function to display existing documents
function displayExistingDocuments(documents) {
  console.log('Displaying existing documents:', documents);
  
  if (!documents || documents.length === 0) {
    console.log('No existing documents to display');
    return;
  }
  
  const permitType = document.getElementById('permitType')?.value;
  console.log('Current permit type:', permitType);
  
  const requirements = PERMIT_REQUIREMENTS[permitType] || [];
  console.log('Requirements for permit type:', requirements);
  
  // Try to match documents to requirements by index first, then by name
  documents.forEach((doc, docIndex) => {
    console.log(`Processing document ${docIndex}:`, doc);
    
    // Try to find matching requirement by various methods
    let requirementIndex = -1;
    
    // Method 1: Try by index first (most reliable)
    if (docIndex < requirements.length) {
      requirementIndex = docIndex;
    }
    
    // Method 2: If index doesn't work, try by name matching
    if (requirementIndex === -1) {
      requirementIndex = requirements.findIndex(req => {
        const docName = (doc.name || '').toLowerCase();
        const reqName = req.toLowerCase();
        return docName.includes(reqName.split(' ')[0]) || 
               reqName.includes(docName.split('.')[0]) ||
               docName.includes(reqName.replace(/\s+/g, '_')) ||
               reqName.includes(docName.replace(/\s+/g, '_'));
      });
    }
    
    // Method 3: If still not found, use first available slot
    if (requirementIndex === -1 && docIndex < requirements.length) {
      requirementIndex = docIndex;
    }
    
    console.log(`Document ${doc.name} matched to requirement index ${requirementIndex}`);
    
    if (requirementIndex !== -1 && requirementIndex < requirements.length) {
      const uploadArea = document.getElementById(`docUpload_${requirementIndex}_preview`);
      const dropzone = document.getElementById(`dropzone_${requirementIndex}`);
      
      console.log(`Upload area found:`, !!uploadArea);
      console.log(`Dropzone found:`, !!dropzone);
      
      if (uploadArea && dropzone) {
        // Make the preview area visible first
        uploadArea.style.display = 'block';
        
        // Create existing document preview
        const isImage = doc.type && doc.type.startsWith('image/');
        const docUrl = doc.url || doc.data || doc.cloudinaryUrl;
        
        console.log(`Document is image: ${isImage}, URL: ${docUrl}`);
        
        if (isImage && docUrl) {
          uploadArea.innerHTML = `
            <div style="position: relative; margin-bottom: 8px;">
              <img src="${docUrl}" alt="${doc.name}" 
                   style="width: 100%; max-height: 150px; object-fit: cover; border-radius: 6px; border: 1px solid #d1d5db;" />
              <div style="position: absolute; top: 8px; right: 8px; background: rgba(34, 197, 94, 0.9); color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px;">
                ✓ Existing
              </div>
            </div>
            <div style="font-size: 12px; color: #059669; margin-bottom: 8px;">
              ${doc.name} (${formatFileSize(doc.size || 0)})
            </div>
          `;
        } else {
          const fileIcon = getFileIcon(doc.type || doc.name);
          uploadArea.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <div style="font-size: 24px;">${fileIcon}</div>
              <div style="flex: 1;">
                <div style="font-size: 12px; font-weight: 500; color: #374151;">${doc.name}</div>
                <div style="font-size: 11px; color: #059669;">✓ Existing document</div>
              </div>
            </div>
          `;
        }
        
        // Update dropzone appearance
        dropzone.style.borderColor = '#10b981';
        dropzone.style.background = '#f0fdf4';
        dropzone.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #10b981;">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <p style="margin: 8px 0 4px 0; color: #10b981; font-weight: 500;">Document already uploaded</p>
          <p style="margin: 0; color: #6b7280; font-size: 12px;">Click to replace or keep existing</p>
        `;
        
        console.log(`Successfully displayed document ${doc.name} in slot ${requirementIndex}`);
      } else {
        console.error(`Upload area or dropzone not found for index ${requirementIndex}`);
      }
    } else {
      console.error(`Could not find matching requirement for document ${doc.name}`);
    }
  });
}

// Close modal
document.getElementById('closeAppModal').addEventListener('click', () => {
  hideModal('applicationModal');
});

// Close modal when clicking outside
document.getElementById('applicationModal').addEventListener('click', (e) => {
  if (e.target.id === 'applicationModal') {
    hideModal('applicationModal');
  }
});

// Image Viewer Modal Functions
window.openImageViewer = function(imageSrc, imageName) {
  const modal = document.getElementById('imageViewerModal');
  const image = document.getElementById('imageViewerImage');
  const title = document.getElementById('imageViewerTitle');
  
  image.src = imageSrc;
  title.textContent = imageName || 'Document Preview';
  showModal('imageViewerModal');
};

document.getElementById('closeImageViewer').addEventListener('click', () => {
  hideModal('imageViewerModal');
});

document.getElementById('imageViewerModal').addEventListener('click', (e) => {
  if (e.target.id === 'imageViewerModal') {
    hideModal('imageViewerModal');
  }
});

// New Application button
document.getElementById('newAppBtn').addEventListener('click', () => {
  navigateToSection('newApplicationSection');
});

// Create Application button (dashboard)
const createAppBtn = document.getElementById('createAppBtn');
if (createAppBtn) {
  createAppBtn.addEventListener('click', () => {
    console.log('Create Application button clicked');
    navigateToSection('newApplicationSection');
  });
} else {
  console.log('Create Application button not found');
}

// Cancel buttons in form steps
['cancelNewAppForm', 'cancelNewAppForm2', 'cancelNewAppForm3', 'cancelNewAppForm4', 'cancelNewAppForm5'].forEach(id => {
  const btn = document.getElementById(id);
  if (btn) {
    btn.addEventListener('click', async () => {
      if (btn.id === 'cancelNewAppForm') {
        // Clear form and go back to dashboard
        const confirmed = confirm('Are you sure you want to cancel this application? All entered data will be lost.');
        if (!confirmed) return;
      }
      
      document.getElementById('newApplicationForm').reset();
      clearFormData('newApplicationForm');
      hideCategoryAwarenessBanner();
      hidePermitAwarenessBanner();
      hideRequirementsSection();
      window.editingAppId = null;
      window.existingDocuments = [];
      const submitBtn = document.getElementById('submitStep5') || document.querySelector('#newApplicationForm button[type="submit"]');
      if (submitBtn) {
        submitBtn.textContent = 'Submit Application';
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
      }
      resetFormSteps();
      navigateToSection('myApplicationsSection');
    });
  }
});

// Step Wizard Navigation
let currentStep = 1;
let totalSteps = 5; // Default to 5 steps

// Function to get current total steps based on document selection
function getCurrentTotalSteps() {
  const documentType = document.getElementById('documentType')?.value || '';
  const permitType = document.getElementById('permitType')?.value || '';
  const stepProcedure = getStepProcedure(documentType, permitType);
  return stepProcedure.length;
}

// Permit type descriptions
const permitDescriptions = {
  'Mining Permit': 'Required for extraction of minerals and quarry materials. Processing time: 15-30 business days.',
  'Tree Cutting Permit': 'Required for cutting trees on private land. Processing time: 7-14 business days.',
  'Tree Planting Permit': 'Required for large-scale tree planting projects. Processing time: 5-10 business days.',
  'Wildlife Permit': 'Required for collecting, trading, or transporting wildlife. Processing time: 10-20 business days.',
  'Rolling Permit': 'Required for transportation of forest products. Processing time: 7-14 business days.'
};

// Permit fees
const permitFees = {
  'Mining Permit': '₱5,000 - ₱50,000 (depending on scale)',
  'Tree Cutting Permit': '₱500 - ₱5,000 (depending on number of trees)',
  'Tree Planting Permit': '₱1,000 - ₱10,000 (depending on area)',
  'Wildlife Permit': '₱2,000 - ₱20,000 (depending on species)',
  'Rolling Permit': '₱1,000 - ₱10,000 (depending on quantity)'
};

// Document type details (Classification, Fees, Minimum Processing Time)
const documentTypeDetails = {
  // PERMITS
  'Community-Based Forest Management Agreement (CBFMA)': {
    classification: 'Highly Technical (Multi-Stage)',
    fees: 'None',
    minimumProcessingTime: '40 Days'
  },
  'Permit to Import Chainsaw': {
    classification: 'Highly Technical',
    fees: 'Php 500.00 (Application Fee)',
    minimumProcessingTime: '20 Days'
  },
  'Permit to Purchase Chainsaw': {
    classification: 'Highly Technical',
    fees: 'Php 500.00 (Application Fee)',
    minimumProcessingTime: '20 Days'
  },
  'Local Transport Permit (Wildlife)': {
    classification: 'Simple to Complex',
    fees: 'Php 100.00 (Permit Fee)',
    minimumProcessingTime: '4 Days, 8 Hours, 15 Minutes'
  },
  'Wildlife Farm Permit - Medium to Large Scale Farming': {
    classification: 'Highly Technical (Multi-Stage)',
    fees: 'Php 5,600.00',
    minimumProcessingTime: '38 Days, 18 Hours'
  },
  'Wildlife Farm Permit - Small Scale Farming': {
    classification: 'Highly Technical (Multi-Stage)',
    fees: 'Php 3,100.00',
    minimumProcessingTime: '38 Days, 18 Hours'
  },
  // CERTIFICATES
  'Certificate of Registration as Lumber Dealer': {
    classification: 'Highly Technical',
    fees: 'Php 600.00 (Application Fee) + Php 480.00 (Registration Fee) + Php 36.00 (Oath Fee) + Php 1,000.00 (CB/FB)',
    minimumProcessingTime: '20 Days'
  },
  'Certificate of Registration as Importer of Lumber and Wood Materials': {
    classification: 'Highly Technical',
    fees: 'Php 3,000.00 (Application/Registration Fee) + Php 12,000.00 (CB/FB/SB)',
    minimumProcessingTime: '20 Days'
  },
  'Certificate of Wildlife Registration (CWR)': {
    classification: 'Highly Technical',
    fees: 'Inspection: Php 100.00 + Permit: 1–50 heads: Php 50, 51–100 heads: Php 500, 101–200 heads: Php 750, 201+ heads: Php 1,000',
    minimumProcessingTime: '16 Days, 11 Hours, 20 Minutes'
  },
  // CERTIFICATION
  'Certification for the Transport of Non-Timber Forest Product Except Rattan': {
    classification: 'Simple to Complex',
    fees: 'Certification: Php 50.00 + Oath: Php 36.00 + Inspection: Php 360.00 (Total: Php 446.00)',
    minimumProcessingTime: '7 Days'
  },
  // CLEARANCE
  'Special Local Transport Permit (SLTP) (Wildlife)': {
    classification: 'Simple to Complex',
    fees: 'Application: Php 300.00 + Inspection: Php 500.00 + Permit: 1 week: Php 200, 2 weeks: Php 250, 3 weeks: Php 300, 1 month: Php 500, 2 months: Php 750, 3 months: Php 1,000',
    minimumProcessingTime: '4 Days, 8 Hours, 15 Minutes'
  }
};

// Step 1: Document Selection
document.getElementById('nextStep1')?.addEventListener('click', () => {
  goToStep(2);
});

// Step 2: DENR Application Forms
document.getElementById('nextStep2')?.addEventListener('click', () => {
  // Check if custom form is loaded and validate
  const permitType = document.getElementById('permitType')?.value || '';
  const formTemplate = DENR_FORM_TEMPLATES[permitType];
  
  if (formTemplate && customFormContainer && customFormContainer.style.display !== 'none') {
    // Validate the custom form
    if (!validateForm()) {
      showValidationToast('Please complete all required fields in the DENR application form.');
      // Scroll to validation message
      const validationMsg = document.getElementById('formValidationMessage');
      if (validationMsg && validationMsg.style.display !== 'none') {
        validationMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    
    // Check if form has been downloaded
    if (formDownloadAwareness && formDownloadAwareness.style.display !== 'none') {
      showValidationToast('Please download the completed form before proceeding to the next step.', 'error');
      formDownloadAwareness.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add pulse animation to awareness box
      formDownloadAwareness.style.animation = 'fieldErrorShake 0.4s ease-in-out';
      setTimeout(() => {
        formDownloadAwareness.style.animation = '';
      }, 400);
      return;
    }
  }
  
  goToStep(3);
});
document.getElementById('prevStep2')?.addEventListener('click', () => {
  goToStep(1);
});

// Step 3: Location Details
document.getElementById('nextStep3')?.addEventListener('click', () => {
  goToStep(4);
});
document.getElementById('prevStep3')?.addEventListener('click', () => {
  goToStep(2);
});

// Step 4: Application Details
document.getElementById('nextStep4')?.addEventListener('click', () => {
  goToStep(5);
});
document.getElementById('prevStep4')?.addEventListener('click', () => {
  goToStep(3);
});

// Function to update permit info in Application Details step
async function updatePermitInfo() {
  const documentType = document.getElementById('documentType')?.value || '';
  const permitType = document.getElementById('permitType')?.value || '';
  const permitInfoBox = document.getElementById('permitInfoBox');
  const classificationEl = document.getElementById('documentClassification');
  const feesEl = document.getElementById('documentFees');
  const processingTimeEl = document.getElementById('documentProcessingTime');

  if (permitType) {
    permitInfoBox.style.display = 'block';
    
    // Use the documentTypeDetails data structure
    const details = documentTypeDetails[permitType];
    if (details) {
      classificationEl.textContent = details.classification || 'N/A';
      feesEl.textContent = details.fees || 'Contact office for details';
      processingTimeEl.textContent = details.minimumProcessingTime || 'Contact office for details';
    } else {
      // Fallback if not found
      classificationEl.textContent = 'N/A';
      feesEl.textContent = 'Contact office for details';
      processingTimeEl.textContent = 'Contact office for details';
    }
  } else {
    permitInfoBox.style.display = 'none';
  }
}

// Update permit info when permit type changes
document.getElementById('permitType')?.addEventListener('change', updatePermitInfo);

// Update permit info when navigating to step 4
const originalGoToStep = goToStep;
goToStep = function(step) {
  if (step === 4) {
    updatePermitInfo();
  }
  if (step === 5) {
    const documentType = document.getElementById('documentType')?.value || '';
    const permitType = document.getElementById('permitType')?.value || '';
    updateDocumentUploadFields(documentType, permitType);
    updateRequirementsList5(documentType, permitType);
  }
  return originalGoToStep(step);
};

// Function to update requirements list for step 5
function updateRequirementsList5(documentType, permitType) {
  const requirementsList5 = document.getElementById('requirementsList5');
  if (!requirementsList5) return;
  
  const requirements = PERMIT_REQUIREMENTS[permitType] || [];
  
  if (requirements.length === 0) {
    requirementsList5.innerHTML = '<li style="padding: 8px 0; color: #374151;">No specific requirements</li>';
    return;
  }
  
  requirementsList5.innerHTML = requirements.map(req => `
    <li style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #374151;">${req}</li>
  `).join('');
}

// Step 5: Documents & Review
document.getElementById('prevStep5')?.addEventListener('click', () => {
  goToStep(4);
});
document.getElementById('submitStep5')?.addEventListener('click', async (e) => {
  e.preventDefault();
  
  // Spam protection - disable button during submission
  const submitBtn = e.target;
  if (submitBtn.disabled) {
    return;
  }
  
  // INSTANT FEEDBACK: Show processing state immediately
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span style="display: inline-flex; align-items: center; gap: 8px;"><svg style="width: 16px; height: 16px; animation: spin 1s linear infinite;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Processing...</span>';
  submitBtn.classList.add('loading');
  
  // OPTIMIZED: Quick validation with early success feedback
  const validationPromises = [];
  for (let step = 1; step <= 4; step++) {
    validationPromises.push(Promise.resolve(validateStep(step)));
  }
  
  try {
    const validationResults = await Promise.all(validationPromises);
    const firstInvalidStep = validationResults.findIndex(({ isValid }) => !isValid);
    
    if (firstInvalidStep !== -1) {
      // Reset button and go to invalid step
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Submit Application';
      submitBtn.classList.remove('loading');
      goToStep(firstInvalidStep + 1);
      return;
    }
  } catch (error) {
    console.error('Validation error:', error);
    // Reset button on validation error
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Submit Application';
    submitBtn.classList.remove('loading');
    showAlert('Validation error. Please try again.', 'error');
    return;
  }
  
  // OPTIMIZED: Fast document validation
  const documentType = document.getElementById('documentType')?.value || '';
  const permitType = document.getElementById('permitType')?.value || '';
  const requirements = PERMIT_REQUIREMENTS[permitType] || [];
  
  // Quick parallel document check
  const documentChecks = requirements.map(async (requirement, index) => {
    const uploadField = document.getElementById(`docUpload_${index}`);
    return {
      requirement,
      hasFile: uploadField && uploadField.files && uploadField.files.length > 0
    };
  });
  
  const documentResults = await Promise.all(documentChecks);
  const missingDocuments = documentResults.filter(({ hasFile }) => !hasFile).map(({ requirement }) => requirement);
  
  // Check default upload field if no dynamic requirements
  if (requirements.length === 0) {
    const defaultUploadField = document.getElementById('documentUpload');
    if (!defaultUploadField || !defaultUploadField.files || defaultUploadField.files.length === 0) {
      missingDocuments.push('At least one document');
    }
  }
  
  if (missingDocuments.length > 0) {
    // Reset button and show error
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Submit Application';
    submitBtn.classList.remove('loading');
    
    // Show field-level error
    const uploadContainer = document.getElementById('dynamicDocumentUploads');
    if (uploadContainer) {
      uploadContainer.classList.add('field-error');
    }
    
    // Show specific missing documents
    const missingList = missingDocuments.join(', ');
    showAlert(`Please upload the following required documents: ${missingList}`, 'warning');
    return;
  }
  
  // UPDATE: Show submitting state
  submitBtn.innerHTML = '<span style="display: inline-flex; align-items: center; gap: 8px;"><svg style="width: 16px; height: 16px; animation: spin 1s linear infinite;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Submitting...</span>';
  
  const form = document.getElementById('newApplicationForm');
  if (!form) {
    console.error('Form not found: newApplicationForm');
    showAlert('Application form not found. Please refresh the page.', 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Application';
    submitBtn.classList.remove('loading');
    return;
  }
  
  try {
    // OPTIMISTIC: Show immediate success feedback
    submitBtn.innerHTML = '<span style="display: inline-flex; align-items: center; gap: 8px;"><svg style="width: 16px; height: 16px;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>Application Submitted!</span>';
    
    // OPTIMISTIC: Show success message immediately
    if (typeof showAlert === 'function') {
      showAlert('Application submitted successfully! You will be redirected shortly...', 'success');
    }
    
    // OPTIMISTIC: Start redirect animation
    const dashboardSection = document.getElementById('myApplicationsSection');
    if (dashboardSection) {
      // Pre-activate the target section for smooth transition
      document.querySelectorAll('.page-section').forEach(section => {
        section.classList.remove('active');
      });
      dashboardSection.classList.add('active');
      
      // Update navigation
      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
      });
      const targetNav = document.querySelector('a[href="#my-applications"]');
      if (targetNav) {
        targetNav.classList.add('active');
      }
    }
    
    // Submit the form with minimal delay
    setTimeout(() => {
      // Use requestSubmit() for proper form submission that triggers all event listeners
      if (form.requestSubmit) {
        form.requestSubmit();
      } else {
        // Fallback for older browsers - create a proper submit event
        const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
        form.dispatchEvent(submitEvent);
      }
    }, 100);
  } catch (error) {
    console.error('Submission error:', error);
    showAlert('An error occurred while submitting. Please try again.', 'error');
    // Re-enable button on error
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Submit Application';
    submitBtn.classList.remove('loading');
  }
});

// Dynamic next/previous step handlers (for document type-specific steps)
function setupDynamicNavigation() {
  // Additional dynamic steps will be handled here if needed
  console.log('Dynamic navigation setup complete');
}

// Initialize dynamic navigation on page load
document.addEventListener('DOMContentLoaded', () => {
  setupDynamicNavigation();
  initializeDefaultSteps();
  setupApplicantTypeToggle();
  setupBarangaySelection();
  setupProfileBarangaySelection();
  
  // Restore form step on page load
  restoreFormStep();
  
  // Initialize IndexedDB for edit mode file persistence
  initEditIndexedDB().then(() => {
    console.log('IndexedDB initialized for edit mode file persistence');
    
    // Check for pending uploads on page load
    if (window.editingAppId) {
      retryPendingEditUploads(window.editingAppId);
    }
  }).catch(err => console.error('Failed to initialize IndexedDB:', err));
  
  // Listen for network status changes
  window.addEventListener('online', () => {
    console.log('Connection restored - checking for pending uploads');
    if (typeof showAlert === 'function') {
      showAlert('Connection restored. Retrying pending file uploads...', 'info');
    }
    
    // Retry uploads for the current editing app if any
    if (window.editingAppId) {
      retryPendingEditUploads(window.editingAppId);
    }
  });
  
  window.addEventListener('offline', () => {
    console.log('Connection lost - files will be stored for retry');
    if (typeof showAlert === 'function') {
      showAlert('You are offline. Files will be uploaded when connection returns.', 'warning');
    }
  });
  
  // Also set up event delegation as backup (but don't interfere with submit buttons)
  document.getElementById('newApplicationForm').addEventListener('click', (e) => {
    // Don't interfere with submit buttons
    if (e.target.id && e.target.id.startsWith('submitStep')) {
      return; // Let the form submit normally
    }
    
    if (e.target.id && e.target.id.startsWith('nextStep')) {
      e.preventDefault();
      const fromStep = parseInt(e.target.id.replace('nextStep', ''));
      const toStep = fromStep + 1;
      const totalSteps = getCurrentTotalSteps();
      
      console.log('Event delegation - Next clicked from step', fromStep, 'to step', toStep, 'total steps:', totalSteps);
      
      if (validateStep(fromStep)) {
        if (toStep <= totalSteps) {
          goToStep(toStep);
        } else {
          console.log('Cannot go to step', toStep, 'exceeds total steps', totalSteps);
        }
      }
    }
    
    if (e.target.id && e.target.id.startsWith('prevStep')) {
      e.preventDefault();
      const fromStep = parseInt(e.target.id.replace('prevStep', ''));
      const toStep = fromStep - 1;
      
      console.log('Event delegation - Prev clicked from step', fromStep, 'to step', toStep);
      
      if (toStep >= 1) {
        goToStep(toStep);
      }
    }
  });
});

// Initialize default step indicators on page load
function initializeDefaultSteps() {
  // Show default 4-step procedure
  updateStepIndicators('', '');
  
  // Hide all form steps first
  document.querySelectorAll('.form-step').forEach(step => {
    step.style.display = 'none';
  });
  
  // Only show step 1 by default
  const step1 = document.querySelector('.form-step[data-step="1"]');
  if (step1) {
    step1.style.display = 'block';
  }
  
  // Set step 4 buttons for 5-step process
  const nextButton4 = document.getElementById('nextStep4');
  const submitButton4 = document.getElementById('submitStep4');
  
  if (nextButton4) nextButton4.style.display = 'inline-block';
  if (submitButton4) {
    submitButton4.style.display = 'none';
    submitButton4.type = 'button';
  }
}

// Validate current step
function validateStep(step) {
  console.log('======== Validating step:', step, '========');
  let isValid = true;

  const documentType = document.getElementById('documentType')?.value || '';
  const permitType = document.getElementById('permitType')?.value || '';
  const stepProcedure = getStepProcedure(documentType, permitType);
  const currentStepInfo = stepProcedure[step - 1];

  console.log('Document type:', documentType, 'Permit type:', permitType);
  console.log('Step procedure:', stepProcedure);
  console.log('Current step info:', currentStepInfo);

  if (!currentStepInfo) {
    console.log('Step info not found, allowing navigation');
    return { isValid: true };
  }

  const title = currentStepInfo.title.toLowerCase();

  // Step 1: Document Selection (always required)
  if (title.includes('document selection') || title.includes('document information')) {
    const docType = document.getElementById('documentType').value;
    const docCategory = document.getElementById('permitType').value;
    
    console.log('Document selection validation - docType:', docType, 'docCategory:', docCategory);
    
    // Clear previous errors
    clearFieldError('documentType');
    clearFieldError('permitType');
    
    if (!docType) {
      showFieldError('documentType', 'Category type is required to proceed.');
      isValid = false;
    } else if (!docCategory) {
      showFieldError('permitType', 'Permit type is required to proceed.');
      isValid = false;
    }
    
    if (!isValid) {
      scrollToFirstError();
    }
  }

  // Step: Applicant Information
  if (title.includes('applicant') && !title.includes('owner')) {
    const applicantType = document.querySelector('input[name="applicantType"]:checked')?.value || 'personal';
    const applicantMobile = applicantType === 'personal' 
      ? document.getElementById('applicantMobileIndividual')?.value || ''
      : document.getElementById('applicantMobileCompany')?.value || '';
    
    console.log('Applicant info validation - type:', applicantType, 'mobile:', applicantMobile);
    
    // Clear previous errors
    clearFieldError('applicantMobileIndividual');
    clearFieldError('applicantMobileCompany');
    
    if (applicantType === 'personal') {
      // Personal validation
      const firstName = document.getElementById('firstName')?.value || '';
      const lastName = document.getElementById('lastName')?.value || '';
      const middleName = document.getElementById('middleName')?.value || '';
      const suffix = document.getElementById('suffix')?.value || '';
      
      clearFieldError('firstName');
      clearFieldError('lastName');
      clearFieldError('middleName');
      
      // Name validation with character limits and format
      if (!firstName) {
        showFieldError('firstName', 'First name is required.');
        isValid = false;
      } else if (!/^[a-zA-Z\s\-\.']+$/.test(firstName)) {
        showFieldError('firstName', 'Only letters, spaces, hyphens, periods, and apostrophes allowed.');
        isValid = false;
      } else if (firstName.length < 2 || firstName.length > 50) {
        showFieldError('firstName', 'Must be between 2 and 50 characters.');
        isValid = false;
      }
      
      if (!lastName) {
        showFieldError('lastName', 'Last name is required.');
        isValid = false;
      } else if (!/^[a-zA-Z\s\-\.']+$/.test(lastName)) {
        showFieldError('lastName', 'Only letters, spaces, hyphens, periods, and apostrophes allowed.');
        isValid = false;
      } else if (lastName.length < 2 || lastName.length > 50) {
        showFieldError('lastName', 'Must be between 2 and 50 characters.');
        isValid = false;
      }
      
      if (middleName && !/^[a-zA-Z\s\-\.']+$/.test(middleName)) {
        showFieldError('middleName', 'Only letters, spaces, hyphens, periods, and apostrophes allowed.');
        isValid = false;
      } else if (middleName && (middleName.length < 2 || middleName.length > 50)) {
        showFieldError('middleName', 'Must be between 2 and 50 characters.');
        isValid = false;
      }
    } else {
      // Company validation
      const companyName = document.getElementById('companyName')?.value || '';
      const representativeName = document.getElementById('representativeName')?.value || '';
      
      clearFieldError('companyName');
      clearFieldError('representativeName');
      
      if (!companyName) {
        showFieldError('companyName', 'Company name is required.');
        isValid = false;
      } else if (!representativeName) {
        showFieldError('representativeName', 'Authorized representative name is required.');
        isValid = false;
      }
    }
    
    // Mobile validation (common for both types)
    const mobileFieldId = applicantType === 'personal' ? 'applicantMobileIndividual' : 'applicantMobileCompany';
    if (!applicantMobile) {
      showFieldError(mobileFieldId, 'Mobile number is required.');
      isValid = false;
    } else if (applicantMobile.startsWith('09')) {
      // 09 prefix must be exactly 11 digits
      if (applicantMobile.length !== 11) {
        showFieldError(mobileFieldId, 'Must be exactly 11 digits (e.g., 09123456789).');
        isValid = false;
      }
    } else if (applicantMobile.startsWith('63')) {
      // 63 prefix must be exactly 13 digits
      if (applicantMobile.length !== 13) {
        showFieldError(mobileFieldId, 'Must be exactly 13 digits (e.g., 639123456789).');
        isValid = false;
      }
    } else {
      showFieldError(mobileFieldId, 'Must start with 09 or 63.');
      isValid = false;
    }
    
    if (!isValid) {
      scrollToFirstError();
    }
  }

  // Step: Location/Property Details
  if (title.includes('location') || title.includes('property') || step === 3) {
    const district = document.getElementById('district')?.value || '';
    const municipal = document.getElementById('municipal')?.value || '';
    const barangay = document.getElementById('barangay')?.value || '';
    const streetAddress = document.getElementById('streetAddress')?.value || '';
    
    console.log('Location step validation - step:', step, 'title:', title, 'district:', district, 'municipal:', municipal, 'barangay:', barangay, 'street:', streetAddress);
    
    // Clear previous errors
    clearFieldError('district');
    clearFieldError('municipal');
    clearFieldError('barangay');
    clearFieldError('streetAddress');
    
    if (!district) {
      showFieldError('district', 'District is required.');
      isValid = false;
    }
    
    if (!municipal) {
      showFieldError('municipal', 'Municipality is required.');
      isValid = false;
    }
    
    if (!barangay) {
      showFieldError('barangay', 'Barangay is required.');
      isValid = false;
    }
    
    if (!streetAddress || streetAddress.length < 5) {
      showFieldError('streetAddress', 'Street address is required (minimum 5 characters).');
      isValid = false;
      console.log('Street address validation failed - empty or too short');
    } else {
      console.log('Location validation passed');
    }
    
    if (!isValid) {
      scrollToFirstError();
    }
  }

  // Step: Business/Organization Details (applicationDetails is optional)
  if (title.includes('business') || title.includes('organization') && !title.includes('applicant')) {
    console.log('Business details validation - applicationDetails is optional');
    // applicationDetails is now optional, no validation needed
  }

  // Step: Specific Details (Chainsaw, Transport, Facility, Survey, Environmental) - applicationDetails is optional
  if (title.includes('chainsaw') || title.includes('transport') || title.includes('facility') ||
      title.includes('survey') || title.includes('environment') || title.includes('project')) {
    console.log('Specific details validation - applicationDetails is optional');
    // applicationDetails is now optional, no validation needed
  }

  // Step: Document Upload validation
  // Validate uploads only if we're on step 5 (Document Upload & Review step)
  if (step < 5) {
    console.log('Step', step, 'is not upload step, skipping upload validation');
    return { isValid };
  }

  const requirements = PERMIT_REQUIREMENTS[permitType] || [];
  console.log('Document upload validation - requirements:', requirements.length);

  // Check if all required documents are uploaded
  const isEditing = window.editingAppId && window.existingDocuments;
  let allUploaded = true;
  let missingDocs = [];

  if (!isEditing) {
    // New application - check if all documents are uploaded
    requirements.forEach((req, index) => {
      const uploadField = document.getElementById(`docUpload_${index}`);
      if (uploadField) {
        if (!uploadField.files || uploadField.files.length === 0) {
          allUploaded = false;
          missingDocs.push(req);
        }
      }
    });
  } else {
    // Edit mode - check if we have existing documents or new uploads
    console.log('Edit mode detected - checking existing and new documents');
    const existingDocs = window.existingDocuments || [];
    
    requirements.forEach((req, index) => {
      const uploadField = document.getElementById(`docUpload_${index}`);
      const hasNewUpload = uploadField && uploadField.files && uploadField.files.length > 0;
      const hasExistingDoc = existingDocs.some(doc => 
        doc.name && doc.name.toLowerCase().includes(req.toLowerCase().split(' ')[0])
      );
      
      if (!hasNewUpload && !hasExistingDoc) {
        allUploaded = false;
        missingDocs.push(req);
      }
    });
    
    console.log('Edit mode validation - existing docs:', existingDocs.length, 'Missing:', missingDocs.length);
  }

  console.log('All uploaded:', allUploaded, 'Missing:', missingDocs, 'Is editing:', isEditing);

  if (!allUploaded) {
    isValid = false;
    if (missingDocs.length > 0) {
      console.log('Missing required documents:', missingDocs);
      // Show a more helpful error message for edit mode
      if (isEditing) {
        showAlert(`Please upload the following required documents: ${missingDocs.join(', ')}`, 'warning');
      }
    }
  }

  // Final step: Review & Submit
  if (title.includes('review') && step === stepProcedure.length) {
    const requirements = PERMIT_REQUIREMENTS[permitType] || [];
    
    // Ensure all documents are uploaded before review
    let allUploaded = true;

    requirements.forEach((req, index) => {
      const uploadField = document.getElementById(`docUpload_${index}`);
      if (uploadField) {
        if (!uploadField.files || uploadField.files.length === 0) {
          allUploaded = false;
        }
      }
    });

    if (!allUploaded) {
      isValid = false;
    }
  }

  return { isValid };
}

// Go to specific step
function goToStep(step) {
  console.log('goToStep called with step:', step);
  const totalSteps = getCurrentTotalSteps();
  console.log('Total steps:', totalSteps);

  // Clear field errors when navigating
  clearAllFieldErrors('.form-step.active');

  // If moving forward, validate current step first
  if (step > currentStep) {
    const { isValid } = validateStep(currentStep);
    if (!isValid) {
      // Show validation toast notification
      showValidationToast('Please complete all required fields before proceeding to the next step.');
      // Show field-level errors and scroll to first error
      scrollToFirstError();
      return;
    }
  }
  
  // Validate step is within bounds
  if (step < 1 || step > totalSteps) {
    console.warn(`Step ${step} is out of bounds. Total steps: ${totalSteps}`);
    return;
  }

  // Hide all form steps using style.display
  document.querySelectorAll('.form-step').forEach(formStep => {
    formStep.style.display = 'none';
    formStep.classList.remove('active');
  });

  // Show target step if it exists, otherwise show the closest available step
  let targetStep = document.querySelector(`.form-step[data-step="${step}"]`);
  console.log('Target step element:', targetStep);
  
  if (!targetStep) {
    console.log('Target step not found, searching for available step');
    // If the specific step doesn't exist, try to find a step with a higher number
    for (let i = step; i <= totalSteps; i++) {
      targetStep = document.querySelector(`.form-step[data-step="${i}"]`);
      if (targetStep) {
        step = i;
        console.log('Found step:', i);
        break;
      }
    }
    
    // If still not found, try lower numbers
    if (!targetStep) {
      for (let i = step; i >= 1; i--) {
        targetStep = document.querySelector(`.form-step[data-step="${i}"]`);
        if (targetStep) {
          step = i;
          console.log('Found step:', i);
          break;
        }
      }
    }
  }
  
  if (targetStep) {
    targetStep.style.display = 'block';
    targetStep.classList.add('active');
    console.log('Showing step:', step);
  } else {
    console.error('No step found to display!');
  }

  // Update step indicators
  document.querySelectorAll('.step-item').forEach(stepItem => {
    const stepNum = parseInt(stepItem.dataset.step);
    stepItem.classList.remove('active', 'completed');
    
    if (stepNum === step) {
      stepItem.classList.add('active');
    } else if (stepNum < step) {
      stepItem.classList.add('completed');
    }
  });

  currentStep = step;
  localStorage.setItem('currentFormStep', step);
  console.log('Current step set to:', currentStep);
  
  // If moving to step 5 (Documents & Review), generate upload fields
  if (step === 5) {
    const documentType = document.getElementById('documentType')?.value || '';
    const permitType = document.getElementById('permitType')?.value || '';
    console.log('Moving to step 5, generating upload fields for:', documentType, permitType);
    if (documentType && permitType) {
      updateDocumentUploadFields(documentType, permitType);
    }
    
    // Ensure submit button is visible
    const submitBtn = document.getElementById('submitStep5');
    if (submitBtn) {
      submitBtn.style.display = 'inline-block';
      submitBtn.style.visibility = 'visible';
      console.log('Submit button made visible');
    }
  }
}

// Restore form step from localStorage on page load
function restoreFormStep() {
  const savedStep = localStorage.getItem('currentFormStep');
  if (savedStep) {
    const step = parseInt(savedStep);
    const totalSteps = getCurrentTotalSteps();
    
    if (step > 1 && step <= totalSteps) {
      currentStep = step;
      goToStep(step);
      
      // If restoring to step 5, ensure submit button is visible
      if (step === 5) {
        const submitBtn = document.getElementById('submitStep5');
        if (submitBtn) {
          submitBtn.style.display = 'inline-block';
          submitBtn.style.visibility = 'visible';
          console.log('Submit button made visible on restore');
        }
      }
    } else {
      // If saved step is invalid, reset to step 1
      currentStep = 1;
      goToStep(1);
    }
  }
}

// Call restoreFormStep when new application section is shown
const newApplicationSection = document.getElementById('newApplicationSection');
if (newApplicationSection) {
  // Restore step on initial page load if section is already active
  if (newApplicationSection.classList.contains('active')) {
    restoreFormStep();
  }
  
  // Also restore when section becomes active via navigation
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.target.classList.contains('active')) {
        restoreFormStep();
      }
    });
  });
  observer.observe(newApplicationSection, { attributes: true, attributeFilter: ['class'] });
}

// Reset form steps
function resetFormSteps() {
  currentStep = 1;
  localStorage.removeItem('currentFormStep');

  // Clear saved file data from localStorage
  for (let i = 0; i < 20; i++) {
    localStorage.removeItem(`docUpload_${i}`);
  }

  // Clear saved document type and permit type
  localStorage.removeItem('selectedDocumentType');
  localStorage.removeItem('selectedPermitType');
  
  // Clear editing state
  window.editingAppId = null;
  window.existingDocuments = [];
  window.editingApplicationData = null;
  
  // Clear form data
  clearFormData('newApplicationForm');
  
  console.log('Form steps and editing state reset');

  // Reset to default step indicators (4 steps)
  updateStepIndicators('', '');
  
  // Hide all form steps first
  document.querySelectorAll('.form-step').forEach(step => {
    step.style.display = 'none';
  });
  
  // Only show step 1
  const step1 = document.querySelector('.form-step[data-step="1"]');
  if (step1) {
    step1.style.display = 'block';
  }
  
  // Reset dynamic document uploads to default
  const uploadContainer = document.getElementById('dynamicDocumentUploads');
  if (uploadContainer) {
    uploadContainer.innerHTML = `
      <div class="form-group" id="documentUploadGroup4">
        <label for="documentUpload">Upload Documents (PDF, JPG, PNG) *</label>
        <input type="file" id="documentUpload" accept=".pdf,.jpg,.jpeg,.png" multiple style="width: 100%; padding: 12px 16px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 15px; font-family: inherit; transition: all 0.3s ease; box-sizing: border-box;" />
        <small style="display: block; margin-top: 6px; color: #718096; font-size: 12px;">Maximum file size: 5MB per file</small>
      </div>
    `;
  }
  
  // Reset requirements list to default
  const requirementsList4 = document.getElementById('requirementsList4');
  if (requirementsList4) {
    requirementsList4.innerHTML = `
      <li>Valid ID (Government-issued)</li>
      <li>Certificate of Land Ownership or Tax Declaration</li>
      <li>Barangay Clearance</li>
      <li>Sketch Plan/Location Map</li>
      <li>Project Description (if applicable)</li>
    `;
  }
  
  // Reset step titles and descriptions to defaults
  for (let i = 1; i <= 4; i++) {
    const titleElement = document.getElementById(`step${i}Title`);
    const descriptionElement = document.getElementById(`step${i}Description`);
    
    if (titleElement) {
      const defaultTitles = {
        1: 'Document Information',
        2: 'Location Details',
        3: 'Application Details',
        4: 'Documents & Review'
      };
      titleElement.textContent = defaultTitles[i] || `Step ${i}`;
    }
    
    if (descriptionElement) {
      const defaultDescriptions = {
        1: 'Select category type and permit type',
        2: 'Provide location and contact information',
        3: 'Describe purpose and environmental impact',
        4: 'Upload documents and submit application'
      };
      descriptionElement.textContent = defaultDescriptions[i] || '';
    }
  }
  
  // Reset submit button visibility (step 4 should have submit button)
  for (let i = 1; i <= 7; i++) {
    const nextButton = document.getElementById(`nextStep${i}`);
    const submitButton = document.getElementById(`submitStep${i}`);
    
    if (nextButton) {
      if (i === 4) {
        nextButton.style.display = 'none';
      } else {
        nextButton.style.display = 'inline-block';
      }
    }
    
    if (submitButton) {
      if (i === 4) {
        submitButton.style.display = 'inline-block';
        submitButton.type = 'submit';
      } else {
        submitButton.style.display = 'none';
        submitButton.type = 'button';
      }
    }
  }
  
  // Reset step indicators
  document.querySelectorAll('.step-item').forEach(stepItem => {
    stepItem.classList.remove('completed');
  });
  
  // Set step 1 as active
  const step1Item = document.querySelector('.step-item[data-step="1"]');
  if (step1Item) {
    step1Item.classList.add('active');
  }

  if (typeof initializeStep1DocumentControls === 'function') {
    initializeStep1DocumentControls();
  }
}

// Category types (Document Information step 1)
const CATEGORY_TYPES = ['Biodiversity', 'Lands', 'Forestry'];

const categoryTypePermitOptions = {
  Biodiversity: [
    'R4A-B-01 – Issuance of Wildlife Farm Permit – Small Scale Farming',
    'R4A-B-02 – Issuance of Wildlife Farm Permit – Medium to Large Scale Farming',
    'R4A-B-03 – Issuance of Certificate of Wildlife Registration (CWR)',
    'R4A-B-04 – Issuance of Local Transport Permit (Wildlife)',
    'R4A-B-05 – Issuance of Special Local Transport Permit (SLTP) (Wildlife)',
    'R4A-B-06 – Issuance of Wildlife Import Clearance (Non-CITES)',
    'R4A-B-07 – Issuance of NIPAS Certification'
  ],
  Lands: [
    'RO-L-01 – Issuance of Certification of Land Classification Status',
    'RO-L-02 – Issuance of Survey Authority',
    'RO-L-03 – Application for Free Patent (Agricultural)',
    'RO-L-04 – Application for Free Patent (Residential)'
  ],
  Forestry: [
    'RO-F-01 – Issuance of Private Tree Plantation Registration (PTPR)',
    'RO-F-03a – Issuance of Certificate of Verification (COV) for transport of planted trees/non-timber products',
    'RO-F-03b – Issuance of Certificate of Timber/Lumber Origin (CTO/CLO)',
    'RO-F-04 – Application for Chainsaw Registration',
    'RO-F-05 – Issuance of Special/Tree Cutting and/or Earth Balling Permit',
    'RO-F-06 – Issuance of Tree Cutting Permit for Public Safety',
    'RO-F-07 – Issuance of Private Land Timber Permit (PLTP/SPLTP)',
    'R4A-F-08 – Issuance of Permit to Import Chainsaw'
  ]
};

// Legacy document type keys (edit mode / older saved applications)
const LEGACY_DOCUMENT_TYPE_OPTIONS = {
  Permit: [
    'Community-Based Forest Management Agreement (CBFMA)',
    'Permit to Import Chainsaw',
    'Permit to Purchase Chainsaw',
    'Local Transport Permit (Wildlife)',
    'Wildlife Farm Permit - Medium to Large Scale Farming',
    'Wildlife Farm Permit - Small Scale Farming'
  ],
  Certificate: [
    'Certificate of Registration as Lumber Dealer',
    'Certificate of Registration as Importer of Lumber and Wood Materials',
    'Certificate of Wildlife Registration (CWR)'
  ],
  Certification: [
    'Certification for the Transport of Non-Timber Forest Product Except Rattan'
  ],
  Clearance: [
    'Special Local Transport Permit (SLTP) (Wildlife)'
  ]
};

const documentTypeOptions = { ...categoryTypePermitOptions, ...LEGACY_DOCUMENT_TYPE_OPTIONS };

// Document type descriptions (legacy categories only)
const documentTypeDescriptions = {
  Permit: 'Official authorization para gawin ang isang activity. Focus: Future action.',
  Certificate: 'Official proof/document na may existing status, qualification, or registration ka. Focus: Current status.',
  Certification: 'Process or document na nagpapatunay na compliant ka sa certain standards. Focus: Validation.',
  Clearance: 'Official approval na wala kang violation or issue, kaya pwede kang mag-proceed. Focus: Risk check.'
};

const CATEGORY_AWARENESS_COPY = {
  Biodiversity: {
    title: '🌿 Biodiversity Awareness – Protect Wildlife and Nature',
    body: 'All wildlife species are protected under Philippine environmental laws. Possessing, transporting, trading, or importing wildlife without proper DENR permits may result in fines, confiscation, and imprisonment under Republic Act No. 9147.'
  },
  Lands: {
    title: '🌏 Land Awareness – Land Use Compliance',
    body: 'All land classification, ownership, and development are regulated under the Public Land Act (CA No. 141) and the Property Registration Decree (PD No. 1529). Non-compliance with land requirements may result in application denial or legal penalties.'
  },
  Forestry: {
    title: '🌳 Forestry Awareness – Protect Forest Resources',
    body: 'All forestry activities such as tree cutting, chainsaw use, transport, and timber harvesting are regulated under Presidential Decree No. 705 (Revised Forestry Code of the Philippines) and related DENR regulations. Unauthorized activities may result in fines, confiscation, and imprisonment.'
  }
};

/** Permit requirements data (keys must match option values in categoryTypePermitOptions). */
const PERMIT_REQUIREMENTS = {
  'R4A-B-01 – Issuance of Wildlife Farm Permit – Small Scale Farming': [
    'Duly accomplished application form',
    'Two (2) recent 2x2 ID pictures',
    'Valid government-issued ID',
    'DTI/SEC/CDA Registration (if business/entity)',
    'Proof of scientific expertise / veterinarian certification',
    'Financial plan or proof of financial capability',
    'Proposed facility design/layout',
    'List of wildlife species to be farmed',
    'Proof of legal source of wildlife stocks'
  ],
  'R4A-B-02 – Issuance of Wildlife Farm Permit – Medium to Large Scale Farming': [
    'Duly accomplished application form',
    'Business registration documents (SEC/DTI/CDA)',
    'Feasibility study or business plan',
    'Environmental management plan',
    'Proof of technical/scientific expertise',
    'Veterinary health certification',
    'Site development/facility plan',
    'Proof of financial capability',
    'Proof of legal source of wildlife'
  ],
  'R4A-B-03 – Issuance of Certificate of Wildlife Registration (CWR)': [
    'Accomplished application form',
    'Valid ID of owner/applicant',
    'Photos of wildlife species',
    'Proof of legal acquisition/source',
    'Inventory list of wildlife',
    'Supporting permits/documents (if applicable)'
  ],
  'R4A-B-04 – Issuance of Local Transport Permit (Wildlife)': [
    'Application/request letter',
    'Copy of Wildlife Farm Permit or CWR',
    'Inventory of wildlife for transport',
    'Veterinary/health certificate',
    'Transport details (origin, destination, route)',
    'Proof of legal source'
  ],
  'R4A-B-05 – Issuance of Special Local Transport Permit (SLTP) (Wildlife)': [
    'Duly accomplished application form',
    'Justification/request for special transport',
    'Copy of existing wildlife permits',
    'Veterinary clearance/certificate',
    'Transport schedule and route',
    'Proof of legal possession/source'
  ],
  'R4A-B-06 – Issuance of Wildlife Import Clearance (Non-CITES)': [
    'Letter request/application',
    'Importation details/specifications',
    'Proof of legal source/export permit',
    'Veterinary/Quarantine Certificate',
    'Packing list and invoice',
    'Import permits from concerned agencies',
    'Valid identification/business registration'
  ],
  'R4A-B-07 – Issuance of NIPAS Certification': [
    'Letter request/application',
    'Project description/proposal',
    'Vicinity map/location plan',
    'Proof of land/project ownership or authority',
    'Environmental compliance documents',
    'Endorsement from concerned LGU/barangay (if applicable)'
  ],
  'RO-L-01 – Issuance of Certification of Land Classification Status': [
    'Duly accomplished application form/request letter',
    'Valid government-issued ID',
    'Tax Declaration or proof of land claim/ownership',
    'Lot/Survey Plan or Sketch Plan',
    'Vicinity Map',
    'Official Receipt of payment of fees',
    'Authorization letter/Special Power of Attorney (if representative)'
  ],
  'RO-L-02 – Issuance of Survey Authority': [
    'Letter request/application',
    'Proof of land claim, rights, or authority',
    'Approved sketch plan/vicinity map',
    'Valid ID of applicant',
    'Endorsement/clearance (if applicable)',
    'Technical description of property',
    'Payment of applicable fees'
  ],
  'RO-L-03 – Application for Free Patent (Agricultural)': [
    'Duly accomplished Free Patent application form',
    'Alienable and Disposable (A&D) land certification',
    'Tax Declaration',
    'Certification from DENR/CENRO',
    'Affidavit of continuous occupation/cultivation',
    'Barangay Certification',
    'Valid government-issued ID',
    'Approved survey plan or cadastral map',
    'Latest real property tax receipt (if applicable)'
  ],
  'RO-L-04 – Application for Free Patent (Residential)': [
    'Accomplished application form',
    'Certification that land is alienable and disposable',
    'Tax Declaration',
    'Barangay Certification of actual occupancy',
    'Valid government-issued ID',
    'Approved survey/cadastral plan',
    'Affidavit of ownership/occupancy',
    'Latest tax payment receipt (if applicable)'
  ],
  'RO-F-01 – Issuance of Private Tree Plantation Registration (PTPR)': [
    'Duly accomplished application form',
    'Proof of land ownership (TCT, Tax Declaration, CLOA, etc.)',
    'Sketch map/location map',
    'List or inventory of planted trees',
    'Valid ID'
  ],
  'RO-F-03a – Issuance of Certificate of Verification (COV) for transport of planted trees/non-timber products': [
    'Application form',
    'PTPR/CTPO or proof of legal source',
    'Inventory of forest/non-timber products',
    'Delivery receipt or sales invoice',
    'Valid ID'
  ],
  'RO-F-03b – Issuance of Certificate of Timber/Lumber Origin (CTO/CLO)': [
    'Application form',
    'Proof of legal source of timber/lumber',
    'Sales invoice/delivery receipt',
    'Lumber inventory report',
    'Valid ID'
  ],
  'RO-F-04 – Application for Chainsaw Registration': [
    'Official Receipt of chainsaw purchase',
    'Stencil Serial Number of chainsaw',
    'Duly accomplished application form',
    'Detailed specification of chainsaw',
    'SPA if representative only',
    'Notarized Deed of Sale (if transferred ownership)',
    'Actual chainsaw for inspection'
  ],
  'RO-F-05 – Issuance of Special/Tree Cutting and/or Earth Balling Permit': [
    'Letter request/application',
    'Proof of land/project ownership',
    'Vicinity or sketch map',
    'Tree inventory',
    'Photographs of trees',
    'Barangay certification/clearance',
    'Valid ID'
  ],
  'RO-F-06 – Issuance of Tree Cutting Permit for Public Safety': [
    'Request letter',
    'Certification that tree is hazardous',
    'Photos of affected tree',
    'Barangay certification',
    'Sketch map/location map',
    'Valid ID'
  ],
  'RO-F-07 – Issuance of Private Land Timber Permit (PLTP/SPLTP)': [
    'Duly accomplished application form',
    'Proof of land ownership',
    'Tree inventory report',
    'Sketch/vicinity map',
    'Barangay certification',
    'Valid ID'
  ],
  'R4A-F-08 – Issuance of Permit to Import Chainsaw': [
    'Application form',
    'Importation documents/proforma invoice',
    'DTI/SEC registration',
    'Proof of financial capability',
    'Valid identification/business registration'
  ]
};

/** Per–permit-type awareness (keys must match option values in categoryTypePermitOptions). */
const PERMIT_AWARENESS_COPY = {
  'R4A-B-01 – Issuance of Wildlife Farm Permit – Small Scale Farming': {
    title: '🌿 Wildlife Farm Permit (Small Scale)',
    body: 'Wildlife farming, even on a small scale, requires a valid DENR permit. Unauthorized possession or breeding of wildlife may lead to confiscation, fines, and imprisonment under RA 9147.'
  },
  'R4A-B-02 – Issuance of Wildlife Farm Permit – Medium to Large Scale Farming': {
    title: '🌿 Wildlife Farm Permit (Medium to Large Scale)',
    body: 'Medium to large-scale wildlife farming requires proper DENR authorization. Operating without a permit or beyond approved limits may result in confiscation, fines, and imprisonment under RA 9147.'
  },
  'R4A-B-03 – Issuance of Certificate of Wildlife Registration (CWR)': {
    title: '🌿 Certificate of Wildlife Registration (CWR)',
    body: 'All captive wildlife must be properly registered with DENR. Possession of unregistered wildlife may lead to confiscation, fines, and imprisonment under RA 9147.'
  },
  'R4A-B-04 – Issuance of Local Transport Permit (Wildlife)': {
    title: '🌿 Local Transport Permit (Wildlife)',
    body: 'Transporting wildlife requires a valid DENR Local Transport Permit. Unauthorized transport may result in seizure of wildlife, fines, and imprisonment under RA 9147.'
  },
  'R4A-B-05 – Issuance of Special Local Transport Permit (SLTP) (Wildlife)': {
    title: '🌿 Special Local Transport Permit (SLTP)',
    body: 'Transporting wildlife under special or restricted conditions requires a Special Local Transport Permit. Violations may lead to confiscation, fines, and imprisonment under RA 9147.'
  },
  'R4A-B-06 – Issuance of Wildlife Import Clearance (Non-CITES)': {
    title: '🌿 Wildlife Import Clearance (Non-CITES)',
    body: 'Importation of wildlife requires prior DENR clearance. Unauthorized importation may result in confiscation, fines, and imprisonment under RA 9147.'
  },
  'R4A-B-07 – Issuance of NIPAS Certification': {
    title: '🌿 NIPAS Certification',
    body: 'Activities involving wildlife within protected areas require NIPAS Certification. Unauthorized activities may result in heavy fines, imprisonment, and closure of operations under applicable environmental laws.'
  },
  'RO-L-01 – Issuance of Certification of Land Classification Status': {
    title: '🌱 Land Awareness – Certification of Land Classification Status (RO-L-01)',
    body: 'Determining the classification of land requires official DENR certification. Using or claiming land without proper classification may result in denial of applications, penalties, and legal disputes.'
  },
  'RO-L-02 – Issuance of Survey Authority': {
    title: '🌱 Land Awareness – Survey Authority (RO-L-02)',
    body: 'Conducting land surveys requires a valid authority from DENR. Unauthorized surveying may lead to suspension of survey results, penalties, and invalidation of documents.'
  },
  'RO-L-03 – Application for Free Patent (Agricultural)': {
    title: '🌱 Land Awareness – Free Patent (Agricultural) (RO-L-03)',
    body: 'Acquisition of agricultural land through free patent requires compliance with DENR and legal requirements. Fraudulent or unauthorized claims may result in cancellation, fines, and legal action.'
  },
  'RO-L-04 – Application for Free Patent (Residential)': {
    title: '🌱 Land Awareness – Free Patent (Residential) (RO-L-04)',
    body: 'Residential land patents must be properly applied for and approved by DENR. Unauthorized occupation or falsified applications may lead to rejection, cancellation, and penalties under land laws.'
  },
  'RO-F-01 – Issuance of Private Tree Plantation Registration (PTPR)': {
    title: '🌲 Forestry Awareness – Private Tree Plantation Registration (PTPR)',
    body: 'Registration of private tree plantations is required under DENR regulations. Unregistered plantations may be subject to penalties and disqualification from harvesting privileges under PD 705.'
  },
  'RO-F-03a – Issuance of Certificate of Verification (COV) for transport of planted trees/non-timber products': {
    title: '🌲 Forestry Awareness – Certificate of Verification (COV)',
    body: 'Transport of planted trees and non-timber forest products requires a valid Certificate of Verification (COV). Unauthorized transport may lead to seizure, penalties, and confiscation of forest products.'
  },
  'RO-F-03b – Issuance of Certificate of Timber/Lumber Origin (CTO/CLO)': {
    title: '🌲 Forestry Awareness – Certificate of Timber/Lumber Origin (CTO/CLO)',
    body: 'Timber and lumber products must be supported by a valid Certificate of Timber/Lumber Origin. Possession or transport of undocumented forest products may result in confiscation, fines, and imprisonment.'
  },
  'RO-F-04 – Application for Chainsaw Registration': {
    title: '🌲 Forestry Awareness – Chainsaw Registration',
    body: 'All chainsaws used for legitimate purposes must be registered with DENR. Possession or use of an unregistered chainsaw may result in confiscation, fines, and penalties under the Chainsaw Act of 2002 (RA 9175).'
  },
  'RO-F-05 – Issuance of Special/Tree Cutting and/or Earth Balling Permit': {
    title: '🌲 Forestry Awareness – Special/Tree Cutting and/or Earth Balling Permit',
    body: 'Cutting, earth balling, or removal of trees requires prior DENR approval. Unauthorized tree cutting or earth balling may result in confiscation, fines, imprisonment, and restoration liabilities.'
  },
  'RO-F-06 – Issuance of Tree Cutting Permit for Public Safety': {
    title: '🌲 Forestry Awareness – Tree Cutting Permit for Public Safety',
    body: 'Tree cutting for public safety purposes requires DENR authorization and proper assessment. Unauthorized cutting may result in penalties and legal action under forestry regulations.'
  },
  'RO-F-07 – Issuance of Private Land Timber Permit (PLTP/SPLTP)': {
    title: '🌲 Forestry Awareness – Private Land Timber Permit (PLTP/SPLTP)',
    body: 'Harvesting and transport of timber from private lands require a valid DENR timber permit. Unauthorized cutting or transport may result in seizure, fines, and imprisonment.'
  },
  'R4A-F-08 – Issuance of Permit to Import Chainsaw': {
    title: '🌲 Forestry Awareness – Permit to Import Chainsaw',
    body: 'Importation of chainsaws requires a valid DENR permit. Unauthorized importation or possession of undocumented chainsaws may result in confiscation, fines, and legal penalties under RA 9175.'
  },
  'RO-F-03a – Issuance of Certificate of Verification (COV) for transport of planted trees/non-timber products': {
    title: '🌲 Forestry Awareness – Certificate of Verification (COV)',
    body: 'Transport of planted trees and non-timber forest products requires a valid Certificate of Verification (COV). Unauthorized transport may lead to seizure, penalties, and confiscation of forest products.'
  },
  'RO-F-03b – Issuance of Certificate of Timber/Lumber Origin (CTO/CLO)': {
    title: '🌲 Forestry Awareness – Certificate of Timber/Lumber Origin (CTO/CLO)',
    body: 'Timber and lumber products must be supported by a valid Certificate of Timber/Lumber Origin. Possession or transport of undocumented forest products may result in confiscation, fines, and imprisonment.'
  }
};

// DENR Form Templates
const DENR_FORM_TEMPLATES = {
  // BIODIVERSITY FORMS
  'R4A-B-01 – Issuance of Wildlife Farm Permit – Small Scale Farming': {
    title: 'Issuance of Wildlife Farm Permit – Small Scale Farming',
    subtitle: '(Project Cost is P1.5Million and Below)',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. R4A-B-01</div>
          <div class="denr-cc-service-title">Issuance of Wildlife Farm Permit – Small Scale Farming</div>
          <div class="denr-cc-service-sub">(Project Cost is P1.5Million and Below)</div>
          <p class="denr-cc-infobox-note">*This permit issue to develop, operate and maintain a wildlife breeding farm for conservation, trade, and/or scientific purposes.*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-subheading">Basic:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Duly accomplished application form with two recent 2&quot; x 2&quot; photos of applicant</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Copy of Certificate of Registration</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Proof of scientific expertise (list and qualifications of manpower)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Financial capability to go into breeding/ Income Tax Return</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Proposed facility design</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> In case of indigenous threatened species, letter of commitment to simultaneously undertake conservation breeding and propose measures on rehabilitation and/or protection of habitat, where appropriate, as may be determined by the RWMC</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Prior clearance from the affected communities i.e. concerned LGUs, recognized head of the indigenous people in accordance with RA 8371, or Protected Area Management Board</label>
          </div>
          <div class="denr-form-subheading">Additional Requirements:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certificate of Non-Coverage (CNC) /Environmental Compliance Certificate (ECC)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Wildlife Facility Registration</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Government <em>(Specify the Name of the Agency and its Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Highly Technical (Multi-Stage)</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">Implementing PENRO (IP): ₱100.00 (Inspection Fee)</div>
          <div class="denr-cc-fee-line">Regional Office: ₱3,100.00 (Application Fee: ₱500.00; Permit Fee: ₱2,500.00)</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> IP: 6 working days, 5 hours / Total TAT: 38 working days, 18 hours</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b01_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b01_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Wildlife Farm Permit – Small Scale Farming</strong></div>
            <div class="denr-cc-receipt-service-sub"><strong>(Project Cost is P1.5Million and Below)</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b01_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b01_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'R4A-B-02 – Issuance of Wildlife Farm Permit – Medium to Large Scale Farming': {
    title: 'Issuance of Wildlife Farm Permit – Medium to Large Scale Farming',
    subtitle: '(with capital P1.5Million and Above)',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. R4A-B-02</div>
          <div class="denr-cc-service-title">Issuance of Wildlife Farm Permit – Medium to Large Scale Farming</div>
          <div class="denr-cc-service-sub">(with capital P1.5Million and Above)</div>
          <p class="denr-cc-infobox-note">*This permit issue to develop, operate and maintain a wildlife breeding farm for conservation, trade, and/or scientific purposes.*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-subheading">Basic:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Duly accomplished application form with two recent 2&quot; x 2&quot; photo of applicant</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Management and Breeding Plan</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Proof of scientific expertise (list and qualifications of manpower)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> In case of indigenous threatened species, letter of commitment to simultaneously undertake conservation breeding and propose measures on rehabilitation and/or protection of habitat, where appropriate, as may be determined by the RWMC</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certified copy of Land Title or Lease Contract for the facility</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Financial capability to go into breeding/ Income Tax Return</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Photocopy of Articles of Incorporation, in case of corporation</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Prior clearance from the affected communities i.e. concerned LGUs, recognized head of the indigenous people in accordance with RA 8371, or Protected Area Management Board</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Copy of BIR registration as exporter, if applicant will engage in export</label>
          </div>
          <div class="denr-form-subheading">Additional Requirements:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certificate of Non-Coverage (CNC) /Environmental Compliance Certificate (ECC)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Wildlife Facility Registration</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Government <em>(Specify the Name of the Agency and its Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Highly Technical (Multi-Stage)</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">Implementing PENRO (IP): ₱100.00 (Inspection Fee)</div>
          <div class="denr-cc-fee-line">Regional Office: ₱5,500.00 (Application Fee: ₱500.00; Permit Fee: ₱5,000.00)</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> IP: 6 working days and 5 hours / Total TAT: 38 working days, 18 hours</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b02_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b02_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Wildlife Farm Permit – Medium to Large Scale Farming</strong></div>
            <div class="denr-cc-receipt-service-sub"><strong>(with capital P1.5Million and Above)</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b02_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b02_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'R4A-B-03 – Issuance of Certificate of Wildlife Registration (CWR)': {
    title: 'Issuance of Certificate of Wildlife Registration (CWR)',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. R4A-B-03</div>
          <div class="denr-cc-service-title">Issuance of Certificate of Wildlife Registration (CWR)</div>
          <p class="denr-cc-infobox-note">*This service is for the registration of wildlife in captivity to ensure legal possession and proper documentation.*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Duly accomplished application form with two recent 2&quot; x 2&quot; photos of applicant</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Documentary Stamp (to be affixed on CWR)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Proof of acquisition (Sales Invoice, Acquisition Receipt or Deed of Donation, LTP, Inventory of Source of wildlife)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> If corporation (Secretary's Certificate, SEC Registration)</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Government <em>(Specify the Name of the Agency and its Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Highly Technical (Multi-Stage Processing)</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">Implementing PENRO: Inspection Fee: ₱100.00</div>
          <div class="denr-cc-fee-line">Permit Fee: *1-50 heads – ₱50 / *51-100 heads – ₱500 / *101-200 heads – ₱750 / *201 heads and above – ₱1,000</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> IP: 7 working days and 7 hours / Total TAT: 16 working days, 11 hours and 20 minutes</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b03_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b03_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Certificate of Wildlife Registration (CWR)</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b03_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b03_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'R4A-B-04 – Issuance of Local Transport Permit (Wildlife)': {
    title: 'Issuance of Local Transport Permit (Wildlife)',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. R4A-B-04</div>
          <div class="denr-cc-service-title">Issuance of Local Transport Permit (Wildlife)</div>
          <p class="denr-cc-infobox-note">*This permit is required for the transport of wildlife within the country to ensure legal movement and proper documentation.*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Duly accomplished application form</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Documents supporting the legal possession or acquisition of wildlife</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Phytosanitary Certificate (for plants) or Veterinary Quarantine Certificate (for animals) from the concerned DA Office</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Government <em>(Specify the Name of the Agency and its Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Simple to Complex</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">Permit Fee: ₱100.00</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> 4 working days, 8 hours, 15 minutes</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b04_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b04_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Local Transport Permit (Wildlife)</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b04_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b04_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'R4A-B-05 – Issuance of Special Local Transport Permit (SLTP) (Wildlife)': {
    title: 'Issuance of Special Local Transport Permit (SLTP) (Wildlife)',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. R4A-B-05</div>
          <div class="denr-cc-service-title">Issuance of Special Local Transport Permit (SLTP) (Wildlife)</div>
          <p class="denr-cc-infobox-note">*This permit is required for special transport of wildlife for shows, exhibitions, or educational events.*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Duly accomplished application form</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certified true copy of the WSUP and other documents supporting the legal possession/acquisition of the wildlife species/specimen for WSUP</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Copy of an invitation or engagement letter, contract or written agreement indicating the date and venue of the show, exhibition or educational event</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Government <em>(Specify the Name of the Agency and its Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Simple to Complex</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">Application and Processing Fee: ₱300.00</div>
          <div class="denr-cc-fee-line">Inspection Fee: ₱500.00</div>
          <div class="denr-cc-fee-line">Permit Fee: 1 week or less – ₱200 / 2 weeks – ₱250 / 3 weeks – ₱300 / 1 month – ₱500 / 2 months – ₱750 / 3 months – ₱1,000</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> 4 working days, 8 hours, 15 minutes</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b05_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b05_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Special Local Transport Permit (SLTP) (Wildlife)</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b05_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b05_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'R4A-B-06 – Issuance of Wildlife Import Clearance (Non-CITES)': {
    title: 'Issuance of Wildlife Import Clearance (Non-CITES)',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. R4A-B-06</div>
          <div class="denr-cc-service-title">Issuance of Wildlife Import Clearance (Non-CITES)</div>
          <p class="denr-cc-infobox-note">*This clearance is required for the importation of non-CITES listed wildlife into the Philippines.*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Duly accomplished application form with two (2) recent 2&quot; x 2&quot; photos of applicant</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Export permit/Certification of Origin from exporting country</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> For live specimens, veterinary/phytosanitary certificate issued by the authorized government agency of the country of origin</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Government <em>(Specify the Name of the Agency and its Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Highly Technical</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">PENRO: Inspection Fee: ₱100.00</div>
          <div class="denr-cc-fee-line">Regional Office: Permit Fee: ₱350.00</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> IP: 7 working days, 5 hours, 30 minutes / Total TAT: 13 working days, 10 hours</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b06_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b06_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Wildlife Import Clearance (Non-CITES)</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b06_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b06_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'R4A-B-07 – Issuance of NIPAS Certification': {
    title: 'Issuance of NIPAS Certification',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. R4A-B-07</div>
          <div class="denr-cc-service-title">Issuance of NIPAS Certification</div>
          <p class="denr-cc-infobox-note">*This certification is issued to determine if a land area falls within or outside the National Integrated Protected Areas System (NIPAS).*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Letter request of the applicant (with contact no.)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Inspection Report of the Field Office</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Either one (1) of the following:</label>
          </div>
          <div class="denr-form-checklist denr-form-nested">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certified Copy of Title</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certified Copy of Approved Plan</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certified Copy of Lot Data Computation</label>
          </div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Authorization letter from the Land Owner / Special Power of Attorney (if necessary)</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Government <em>(Specify the Name of the Agency and its Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Highly Technical</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">Regional Office: Certification Fee: ₱50/lot</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> IP: 13 working days / Total TAT: 16 working days</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b07_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="r4a_b07_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of NIPAS Certification</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b07_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="r4a_b07_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  // LAND FORMS
  'RO-L-01 – Issuance of Certification of Land Classification Status': {
    title: 'Issuance of Certification of Land Classification Status',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. RO-L-01</div>
          <div class="denr-cc-service-title">Issuance of Certification of Land Classification Status</div>
          <p class="denr-cc-infobox-note">*This certification is being issued based from the land records/status and projection in the land classification map for alienability or disposability of the land being applied for. This Certification does not construe ownership and is for reference only.*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Request Form (1 original, 1 duplicate copy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Any document showing the identity of the lot</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Sketch Plan with Complete Technical Description (1 original)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Others: ________________________________</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Government <em>(Specify the Name of the Agency and its Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Highly Technical</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">Certification Fee: ₱25.00</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> 4 working days, 3 hours, and 25 minutes</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="ro_l01_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="ro_l01_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Certification of Land Classification Status</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_l01_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_l01_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'RO-L-02 – Issuance of Survey Authority': {
    title: 'Issuance of Survey Authority',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. RO-L-02</div>
          <div class="denr-cc-service-title">Issuance of Survey Authority</div>
          <p class="denr-cc-infobox-note">*This document is an authority given to private Geodetic Engineers (GEs) for the survey of public lands for land titling.*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Duly accomplished Letter-Request Form from the land owner requesting for survey authority and authorizing certain private GE to conduct the survey (1 original) <strong>OR</strong> Duly accomplished Letter-Request Form from the GE on behalf of his/her client (1 original)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Any proof of claim or acquisition of the property</label>
          </div>
          <div class="denr-form-checklist denr-form-nested">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Latest, Updated Tax declaration for the last year (1 certified copy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Deed of Sale (1 photocopy with accompanying Original Copy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Extra Judicial Settlement (1 original)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Waiver of Rights (1 original)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Other documents: ________________________________</label>
          </div>
          <p class="denr-cc-infobox-note" style="margin:4px 0 8px 28px;">(Note: DENR may request for additional documents or combination of documents mentioned above depending on the situation of the application / request)</p>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Survey Authority form duly signed by the applicant and private Geodetic Engineer (1 original, 1 duplicate copy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certification of Land Classification Status</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Scheme of subdivision from GE (1 photocopy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certification from the Regional Trial Court concerned that there is no pending land registration case involving the parcel being applied for (1 original)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certification from barangay that there is no record of claims and conflict (1 original, 1 duplicate copy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Copy of Approved Survey Plan with Technical Description (if with previously approved surveys) (1 blueprint copy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certification of Lot Status (whether titled or not) and Status from LRA (if the municipality is under cadastral proceedings or if there is an old survey) (Private Survey) (1 original, 1 duplicate copy)</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Highly Technical</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">&gt; ₱200.00 Field Inspection Deposit</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> 7 working days, 6 hours and 55 minutes</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="ro_l02_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="ro_l02_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Survey Authority</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_l02_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_l02_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'RO-L-03 – Application for Free Patent (Agricultural)': {
    title: 'Application for Free Patent (Agricultural)',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. RO-L-03</div>
          <div class="denr-cc-service-title">Application for Free Patent (Agricultural)</div>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Duly accomplished Free Patent Application and prescribed forms (1 original)</label>
          </div>
          <div class="denr-form-checklist denr-form-nested">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Notarized Special Power of Attorney (SPA) (in case the application is filed by a representative or by the heirs of the original applicant)</label>
          </div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Tax declaration in the name of the applicant. If the tax declaration is in the name of the applicant's predecessor-in-interest, any of the following documents shall be presented:</label>
          </div>
          <div class="denr-form-checklist denr-form-nested">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Deed of Sale</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Extra Judicial Settlement</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Waiver of Rights</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Deed of Donation or other form of monuments of ownership</label>
          </div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certification of status of land from LRA, if the municipality is under cadastral proceedings or if there is an old survey (Private and Original Survey) (1 photocopy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Documentary Stamp (to be attached in the application form)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Others: ________________________________</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Highly Technical (Multi-Stage Processing)</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">Application Fee: ₱150.00</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> 130 calendar days (120 Calendar days for processing + 10 calendar days Review / Approval / Disapproval and Transmittal)</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="ro_l03_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="ro_l03_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Agricultural Free Patent</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_l03_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_l03_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'RO-L-04 – Application for Free Patent (Residential)': {
    title: 'Application for Free Patent (Residential)',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. RO-L-04</div>
          <div class="denr-cc-service-title">Application for Free Patent (Residential)</div>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-subheading">Basic:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Duly accomplished Free Patent Application and prescribed forms (1 original)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Any of the following document showing identity of land and claims of ownership:</label>
          </div>
          <div class="denr-form-checklist denr-form-nested">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Tax Declaration, if applicable (1 certified copy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Deed of Sale / Deed of Donation / Deed of Transfer (1 photocopy, present original copy) *if applicable</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Extra Judicial Settlement (1 photocopy) *if applicable</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Waiver of Rights, Barangay Certification (1 photocopy) *if applicable</label>
          </div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Affidavit of at least two (2) disinterested person residing in the area</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certification from the Municipal Circuit/Regional Trial Court (MCTC/RTC) concerned that there is no pending land registration case involving the parcel being applied for (1 original, 1 photocopy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Approved Survey Plan with Technical Description/Form V37 (if covered with isolated survey) (1 certified copy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certification of status of land from LRA, if the municipality is under cadastral proceedings or if there is an old survey (Private and Original Survey) (1 photocopy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certification that the land applied for is alienable and disposable (1 original, 1 photocopy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Documentary Stamp (4 pieces) (2-Affidavits, 1-Application Form, 1-Notice of Posting)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certification from LGU that the area applied for is zoned as Residential (1 original), or approved CLUP, if applicable (1 photocopy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Latest photograph of land and house (preferably geo-tagged)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Others: ________________________________</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Highly Technical (Multi-Stage Processing)</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">Application Fee: ₱50.00</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> 130 calendar days (120 calendar days for processing + 10 working days for Review / Approval / Disapproval and Transmittal to ROD)</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="ro_l04_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="ro_l04_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Residential Free Patent</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_l04_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_l04_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  // FORESTRY FORMS
  'RO-F-01 – Issuance of Private Tree Plantation Registration (PTPR)': {
    title: 'Issuance of Private Tree Plantation Registration (PTPR)',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. RO-F-01</div>
          <div class="denr-cc-service-title">Issuance of Private Tree Plantation Registration (PTPR)</div>
          <p class="denr-cc-infobox-note">*This Certificate shows the ownership of plantations or planted trees within private, titled lands or tax declared alienable and disposable lands. The issuance of PTPR requires inventory and ocular inspection in the area. Tree inventory for permits (e.g. TCP or PLTP) is a process conducted separately from the inspection for PTPR per existing DENR policies, rules and regulations.*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-subheading">Basic:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Letter of Application (1 original, 1 photocopy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> OCT, TCT, Judicial Title, CLOA, Tax Declared Alienable and Disposable Lands (1 certified true copy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Data on the number of seedlings planted, species and area planted</label>
          </div>
          <div class="denr-form-subheading">Additional Requirement, if the applicant is a representative:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Special Power of Attorney (SPA) (1 original)</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Highly Technical</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">✓ None</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> 16 working days, 3 hours, 50 minutes</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f01_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f01_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Private Tree Plantation Registration (PTPR)</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f01_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f01_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'RO-F-03a – Issuance of Certificate of Verification (COV) for transport of planted trees/non-timber products': {
    title: 'Issuance of Certificate of Verification (COV)',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. RO-F-03a</div>
          <div class="denr-cc-service-title">Issuance of Certificate of Verification (COV) for the transport of planted trees within private land, non-timber forest products except Rattan and Bamboo</div>
          <p class="denr-cc-infobox-note">*COV is a document to be presented when transporting planted trees within private lands not registered under the Private Tree Plantation Registration and/or non-premium trees, non-timber forest products (except rattan and bamboo).*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-subheading">Basic:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Request letter indicating the following: (1 original, 1 photocopy)</label>
          </div>
          <div class="denr-form-checklist denr-form-nested">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Type of forest product</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Species</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Estimated volume/quantity</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Type of conveyance and plate number</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Name and address of the consignee/destination</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Date of transport</label>
          </div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certification that the forest products are harvested within the area of the owner (for non-timber) (1 original)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Approved Tree Cutting Permit for timber (1 photocopy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> OR/CR of conveyance and Driver's License (1 photocopy)</label>
          </div>
          <div class="denr-form-subheading">Additional requirement, if the owner of the forest product is not the owner of the conveyance:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certificate of Transport Agreement (1 original)</label>
          </div>
          <div class="denr-form-subheading">Additional requirement, if applicant is not the land owner:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Special Power of Attorney (SPA) (1 original)</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Government <em>(Specify the Name of the Agency and its Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Complex</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">✓ ₱446.00+ <em>(Certification Fee: ₱50.00/ truck load; Oath Fee: ₱36.00 per application; Inspection Fee: ₱360.00) Fees and charges are based on DAO 2004-16</em></div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> 5 working days, 5 hours, and 45 minutes</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f03a_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f03a_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Certificate of Verification (COV) for the transport of planted trees within private land, non-timber forest products except Rattan and Bamboo</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f03a_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f03a_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'RO-F-03b – Issuance of Certificate of Timber/Lumber Origin (CTO/CLO)': {
    title: 'Issuance of Certificate of Timber/Lumber Origin (CTO/CLO)',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. RO-F-03b</div>
          <div class="denr-cc-service-title">Issuance of Certificate of Timber/Lumber Origin (CTO/CLO) for Processed Logs/Lumber</div>
          <p class="denr-cc-infobox-note">*CTO/CLO is a document to secure/present when transporting processed logs or lumber from WPP to another WPP or desired destination*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-subheading">Basic:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Request letter indicating the following: (1 original, 1 photocopy)</label>
          </div>
          <div class="denr-form-checklist denr-form-nested">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Species, Dimension (Lumber), Number of pieces/poles and volume</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Name and Place of loading/Lumber Origin</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Type of conveyance and plate number</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Date of transport</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Name and address of the consignee/destination</label>
          </div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Source of Forest Product (Permit/Agreement/Imported Product)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Approved WPP Permit or Certificate of Registration as Lumber/Timber Dealer (1 photocopy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Approved Log/Lumber Supply Contract or Invoice Receipt (1 photocopy)</label>
          </div>
          <div class="denr-form-subheading">Additional requirement, if applicant is not the WPP owner:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Special Power of Attorney (SPA) (1 original)</label>
          </div>
          <div class="denr-form-subheading">Additional requirement, if the owner of the forest product is not the owner of the conveyance:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certificate of Transport Agreement (1 original, 1 photocopy)</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Complex</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">✓ ₱446.00+ <em>(Certification Fee: ₱50.00/ truck load; Oath Fee: ₱36.00 per application; Scaling Fee: ₱360.00) Fees and charges are based on DAO 2004-16</em></div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> 5 working days, 5 hours, 45 minutes</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f03b_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f03b_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Certificate of Timber/Lumber Origin (CTO/CLO) for Processed Logs/Lumber</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f03b_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f03b_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'RO-F-04 – Application for Chainsaw Registration': {
    title: 'Application for Chainsaw Registration',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. RO-F-04</div>
          <div class="denr-cc-service-title">Application for Chainsaw Registration</div>
          <p class="denr-cc-infobox-note">*This Registration serves as a legal proof of ownership, use and possession of chainsaw in the Philippines. The DENR shall issue different permits or certifications for the purchase or import, manufacture, selling, re-selling, disposal, distribution, transfer of ownership, lease, rental or lending of chainsaws.*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-subheading">Basic:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Duly Accomplished Application Form</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Official Receipt of Chainsaw Purchase (1 certified copy and 1 original for verification) or Affidavit of Ownership in case the original copy is lost.</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> SPA if the applicant is not the owner of the chainsaw</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Detailed Specification of Chainsaw (brand, model, engine capacity, serial number)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Notarized Deed of Absolute Sale, if transfer of ownership (1 original)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Chainsaw to be registered</label>
          </div>
          <div class="denr-form-subheading">Additional if Tenurial Instrument Holder:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certified True Copy of Forest Tenure Agreement</label>
          </div>
          <div class="denr-form-subheading">Additional if Business Owner:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Business Permit (1 photocopy)</label>
          </div>
          <div class="denr-form-subheading">Additional if Registered as Private Tree Plantation Owner:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certificate of Registration</label>
          </div>
          <div class="denr-form-subheading">Additional if the applicant shows satisfactory proof that the possession and/or use of a chainsaw is for a legal purpose:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Business Permit from LGU or affidavit that the chainsaw is needed in applicants/profession/work and will be used for legal purpose (1 photocopy)</label>
          </div>
          <div class="denr-form-subheading">Additional if licensed Wood Processor:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Wood processing plant permit (1 photocopy)</label>
          </div>
          <div class="denr-form-subheading">Additional if government, and GOCC:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certification from the Head of Office or his/her authorized representative that chainsaws are possessed by the office and use for legal purposes (specify)</label>
          </div>
          <div class="denr-form-subheading">Additional if it is for renewal of registration:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Latest Certificate of Chainsaw Registration (1 photocopy)</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Government <em>(Specify the Name of the Agency and its Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Simple</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">✓ Registration Fee: ₱500.00</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> 2 working days, 4 hours and 30 minutes</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f04_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f04_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Application for Chainsaw Registration</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f04_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f04_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'RO-F-05 – Issuance of Special/Tree Cutting and/or Earth Balling Permit': {
    title: 'Issuance of Special/Tree Cutting and/or Earth Balling Permit',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. RO-F-05</div>
          <div class="denr-cc-service-title">Issuance of Special/Tree Cutting and/or Earth Balling Permit for Trees affected by projects of National Government Agencies (DPWH, DOTR, DEPED, DA, DOH, CHED, DOE, and NIA)</div>
          <p class="denr-cc-infobox-note">*This Permit serves as proof of authorization for the removal/cutting and/or relocation of trees affected by projects of the National Government Agencies (DPWH, DOTr, DepEd, DA, DOH, CHED, DOE and NIA).*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Letter of Application (1 original)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> LGU Endorsement/Certification of No Objection (1 original)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Approved Site Development Plan/Infrastructure Plan with tree charting indicating the geotagged location of individual trees affected by the project, to be numbered sequentially, as basis of validation by the DENR during actual cutting operations (1 Certified true Copy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Environmental Compliance Certificate (ECC)/Certificate of Non-Coverage (CNC), whichever is applicable (1 certified true copy)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> NCIP Clearance (FPIC/CP/CNO, whichever is applicable)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Waiver/Consent of owner/s, if titled property, if applicable (1 original)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> PAMB Clearance/Resolution, if within Protected Area (1 original)</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Government <em>(Specify the Name of the Agency and its Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Simple</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">✓ ₱86.00 <em>(Certification Fee: ₱50.00; Oath Fee: ₱36.00 per application)</em></div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> 2 working days, 7 hours, 50 minutes</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f05_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f05_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Special/Tree Cutting and/or Earth Balling Permit for Trees affected by projects of National Government Agencies (DPWH, DOTR, DEPED, DA, DOH, CHED, DOE, and NIA)</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f05_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f05_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'RO-F-06 – Issuance of Tree Cutting Permit for Public Safety': {
    title: 'Issuance of Tree Cutting Permit for Public Safety',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. RO-F-06</div>
          <div class="denr-cc-service-title">Issuance of Tree Cutting Permit for planted trees and naturally growing trees found within public places (Plaza, Public Parks, School Premises or Political Subdivisions) for purposes of public safety</div>
          <p class="denr-cc-infobox-note">*This Permit serves as proof of authorization for the removal/cutting of trees in public places (Plaza, Public Parks, School Premises or Political Subdivisions for purposes of public safety).*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-subheading">Basic:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Application Letter (1 original)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> LGU Endorsement/Certification of No Objection/Resolution (1 original)</label>
          </div>
          <div class="denr-form-subheading">Additional if within Subdivisions:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Homeowners Resolution (1 original / 1 certified true copy)</label>
          </div>
          <div class="denr-form-subheading">Additional if School/Organization:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> PTA Resolution or Resolution from any organize group of No Objection and Reason for Cutting (1 original)</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Government <em>(Specify the Name of the Agency and its Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Highly Technical</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">✓ Certification Fee: ₱50.00; Oath Fee: ₱36.00 per application; Inventory Fee: ₱1,200.00 (for 1ha. and above)</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> 16 days and 6 hours</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f06_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f06_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Tree Cutting Permit for planted trees and naturally growing trees found within public places (Plaza, Public Parks, School Premises or Political Subdivisions) for purposes of public safety</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f06_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f06_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'RO-F-07 – Issuance of Private Land Timber Permit (PLTP/SPLTP)': {
    title: 'Issuance of Private Land Timber Permit (PLTP/SPLTP)',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. RO-F-07</div>
          <div class="denr-cc-service-title">Issuance of Private Land Timber Permit (PLTP) for Non-Premium Species, or Special PLTP (SPLTP) for Premium Naturally-Grown Trees within private/ titled lands</div>
          <p class="denr-cc-infobox-note">*PLTP or SPLTP serves as the official authority to cut, gather and utilize naturally grown trees within private or titled lands. This shall not cover the trimming, pruning, cutting and removal of trees within power line corridors which no longer requires to secure prior clearance or permit from, but with due notice to, the DENR Field Offices, pursuant to RA No. 11361, S. 2019. Further, the transport of logs derived therefrom shall require a transport permit consistent with existing rules and regulations.*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-subheading">Basic:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Application Letter (1 original)</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Endorsement/Certification from concerned LGU interposing no objection to the cutting of trees under the following conditions (1 original):</label>
          </div>
          <div class="denr-form-checklist denr-form-nested">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> If the trees to be cut falls within one barangay, an endorsement from the Barangay Captain shall be secured</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> If the trees to be cut falls within more than one barangay, endorsement shall be secured either from the Municipal/City Mayor or all the Barangay Captains concerned</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> If the trees to be cut fall within more than one municipality/city, endorsement shall be secured either from the Provincial Governor or all the Municipal/City Mayors concerned</label>
          </div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Authenticated copy of Land Title/CLOA issued by LRA or Registry of Deeds, whichever is applicable</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Environmental Compliance Certificate (ECC)/Certificate of Non-Coverage (CNC), whichever is applicable. (1 certified copy)</label>
          </div>
          <div class="denr-form-subheading">Additional, if application covers ten (10) hectares or larger:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Utilization Plan with at least 50% of the area covered with forest trees (1 original)</label>
          </div>
          <div class="denr-form-subheading">Additional, if covered by CLOA:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Endorsement by local agrarian reform officer interposing No Objection (1 original)</label>
          </div>
          <div class="denr-form-subheading">Additional, if School/Organization:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> PTA Resolution or Resolution from any organized group of No Objection and Reason for Cutting for (1 original)</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Highly Technical (multi-stage processing)</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">✓ Certification Fee: ₱50.00; Oath Fee: ₱36.00 per application; Inventory Fee: ₱1,200.00 (for 1ha. and above)</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> Implementing PENRO: 27D, 1H and 20M; TOTAL: 36D, 50M</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f07_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f07_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Private Land Timber Permit (PLTP) For Non-Premium Species, or Special PLTP (SPLTP) For Premium Naturally-Grown Trees Within Private/ Titled Lands</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f07_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f07_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },

  'R4A-F-08 – Issuance of Permit to Import Chainsaw': {
    title: 'Issuance of Permit to Import Chainsaw',
    subtitle: '',
    template: `
      <div class="denr-form">
        <div class="denr-cc-letterhead">
          <img src="/assets/images/logo.png" alt="DENR Logo" class="denr-cc-lh-logo" width="72" height="72" />
          <div class="denr-cc-lh-text">
            <div>Republic of the Philippines</div>
            <div class="denr-cc-lh-strong">Department of Environment and Natural Resources</div>
            <div>Community Environment and Natural Resources Office (CENRO) – STA. CRUZ</div>
            <div>Brgy. Duhat, Sta. Cruz, Laguna</div>
            <div class="denr-cc-lh-contact"><span class="denr-cc-lh-email">cenrostacruz@denr.gov.ph</span> | (049) 536 8903</div>
          </div>
        </div>

        <div class="denr-cc-banner">CHECKLIST OF REQUIREMENTS</div>

        <div class="denr-cc-infobox">
          <div class="denr-cc-charter-no">CITIZEN'S CHARTER NO. R4A-F-08</div>
          <div class="denr-cc-service-title">Issuance of Permit to Import Chainsaw</div>
          <p class="denr-cc-infobox-note">*The permit is necessary in order to regulate the import, ownership, possession, and/or use of chainsaws to prevent them from being used in illegal logging or unauthorized clearing of forests.*</p>
        </div>

        <div class="denr-cc-applicant-block">
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Name of Applicant:</span>
            <input type="text" class="denr-cc-line-input" id="applicantName" />
          </div>
          <div class="denr-cc-field-row denr-cc-field-row-multiline">
            <span class="denr-cc-field-label">Address:</span>
            <textarea class="denr-cc-line-input denr-cc-line-textarea" id="applicantAddress" rows="2"></textarea>
          </div>
          <div class="denr-cc-field-row">
            <span class="denr-cc-field-label">Contact Details:</span>
            <input type="text" class="denr-cc-line-input" id="applicantContact" />
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">A. Requirements to be submitted upon filing of application</div>
          <div class="denr-form-subheading">Basic:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Duly accomplished Application Form</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Payment of Permit Fee</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Copy of Purchase Order</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Endorsement of the concerned PENR Officer</label>
          </div>
          <div class="denr-form-subheading">Additional if individual:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Affidavit that he/she will use the chainsaw for legal purpose</label>
          </div>
          <div class="denr-form-subheading">Additional if business / private corporation:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Certificate of Registration of Business Name from DTI or SEC</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Business License / Mayor's Permit</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Authorization / Secretary's Certificate (if applies)</label>
          </div>
          <div class="denr-form-subheading">Additional if within Subdivisions:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Homeowner's Resolution (1 original / 1 certified true copy)</label>
          </div>
          <div class="denr-form-subheading">Additional if School/Organization:</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> PTA Resolution or Resolution from any organize group of No Objection and Reason for Cutting (1 original)</label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">B. Type of Transaction</div>
          <div class="denr-form-checklist">
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Citizen</label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Business <em>(Specify the Name of Company and Owner / Authorized Representative)</em></label>
            <label class="denr-form-checklabel"><input type="checkbox" class="denr-form-checkbox"> Government to Government <em>(Specify the Name of the Agency and its Authorized Representative)</em></label>
          </div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">C. Classification</div>
          <div class="denr-cc-classification-line">✓ Highly Technical</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">D. Fees to be Paid</div>
          <div class="denr-cc-fee-line">✓ Certification Fee: ₱50.00; Oath Fee: ₱36.00 per application; Inventory Fee: ₱1,200.00 (for 1ha. and above)</div>
        </div>

        <div class="denr-form-section denr-cc-section">
          <div class="denr-cc-section-title-main">E. Processing Time</div>
          <div class="denr-cc-processing-line"><span class="denr-cc-bullet">•</span> 16 days and 8 hours</div>
        </div>

        <div class="denr-cc-received-row">
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Received by:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f08_receivedBy" />
          </div>
          <div class="denr-cc-received-item">
            <span class="denr-cc-received-label">Date Received:</span>
            <input type="text" class="denr-cc-received-input" id="ro_f08_dateReceived" />
          </div>
        </div>

        <div class="denr-cc-stub-separator"></div>

        <div class="denr-cc-receipt-official">
          <img src="/assets/images/logo.png" alt="" class="denr-cc-receipt-logo" width="56" height="56" />
          <div class="denr-cc-receipt-body">
            <div class="denr-cc-receipt-heading">ACKNOWLEDGEMENT RECEIPT</div>
            <div class="denr-cc-receipt-service">Name of Service: <strong>Issuance of Permit to Import Chainsaw</strong></div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Name of Applicant:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f08_ackApplicant" />
            </div>
            <div class="denr-cc-receipt-field">
              <span class="denr-cc-receipt-label">Date Received:</span>
              <input type="text" class="denr-cc-receipt-input" id="ro_f08_ackDateReceived" />
            </div>
          </div>
        </div>

        <p class="denr-cc-followup-note">*To follow-up your application, please present this stub or you may contact us at cenrostacruz@denr.gov.ph / (049) 536 – 8903*</p>
      </div>
    `
  },
};

// Dynamic step procedures - generated based on document requirements and type characteristics
function generateStepProcedure(documentType, permitType) {
  const requirements = PERMIT_REQUIREMENTS[permitType] || [];
  const steps = [];
  let stepNum = 1;
  
  // Step 1: Always Document Selection
  steps.push({
    step: stepNum++,
    title: 'Document Selection',
    description: 'Select category type and permit type',
    icon: 'document'
  });
  
  // Step 2: Applicant/Owner Information (always required)
  steps.push({
    step: stepNum++,
    title: documentType === 'Lands' ? 'Property Owner Information' : 'Applicant Information',
    description: documentType === 'Lands' ? 'Provide property owner and contact details' : 'Provide personal and contact information',
    icon: 'user'
  });
  
  // Step 3: Location/Property Details (for Lands, Forestry, and location-based permits)
  if (documentType === 'Lands' ||
      documentType === 'Forestry' ||
      documentType === 'Land Services' ||
      permitType.includes('CBFMA') ||
      permitType.includes('Farm') ||
      permitType.includes('Mining') ||
      permitType.includes('Tree Cutting') ||
      permitType.includes('Tree Planting')) {
    steps.push({
      step: stepNum++,
      title: documentType === 'Lands' || documentType === 'Land Services' ? 'Property Location Details' : 'Location Details',
      description: documentType === 'Lands' || documentType === 'Land Services' ? 'Specify property location and boundaries' : 'Provide location and site details',
      icon: 'location'
    });
  }
  
  // Step 4: Business/Organization Details (if required)
  if (requirements.some(req => 
    req.toLowerCase().includes('business') ||
    req.toLowerCase().includes('sec') ||
    req.toLowerCase().includes('cda') ||
    req.toLowerCase().includes('dole') ||
    req.toLowerCase().includes('registration'))) {
    steps.push({
      step: stepNum++,
      title: 'Business/Organization Details',
      description: 'Provide business registration and organization information',
      icon: 'business'
    });
  }
  
  // Step 5: Specific Details based on document type
  if (permitType.includes('Chainsaw')) {
    steps.push({
      step: stepNum++,
      title: 'Chainsaw Information',
      description: 'Specify chainsaw details and justification',
      icon: 'chainsaw'
    });
  } else if (permitType.includes('Wildlife') || permitType.includes('Transport')) {
    steps.push({
      step: stepNum++,
      title: 'Transport Information',
      description: 'Provide transport route and wildlife details',
      icon: 'transport'
    });
  } else if (permitType.includes('Farm')) {
    steps.push({
      step: stepNum++,
      title: 'Facility Details',
      description: 'Provide farm layout and facility information',
      icon: 'facility'
    });
  } else if (documentType === 'Lands' || documentType === 'Land Services') {
    steps.push({
      step: stepNum++,
      title: 'Survey Plan Information',
      description: 'Provide survey plan and technical details',
      icon: 'survey'
    });
  } else if (permitType.includes('Environmental') || permitType.includes('ECC')) {
    steps.push({
      step: stepNum++,
      title: 'Environmental Compliance',
      description: 'Provide environmental impact and compliance details',
      icon: 'environment'
    });
  }
  
  // Step: Project/Proposal Details (if required)
  if (requirements.some(req => 
    req.toLowerCase().includes('project') ||
    req.toLowerCase().includes('proposal') ||
    req.toLowerCase().includes('management plan'))) {
    steps.push({
      step: stepNum++,
      title: 'Project Details',
      description: 'Provide project proposal and management plan',
      icon: 'project'
    });
  }
  
  // Step: Document Upload (always required)
  steps.push({
    step: stepNum++,
    title: 'Document Upload',
    description: `Upload required documents (${requirements.length} documents needed)`,
    icon: 'upload'
  });
  
  // Final Step: Review & Submit
  steps.push({
    step: stepNum,
    title: 'Review & Submit',
    description: 'Review your application and submit',
    icon: 'review'
  });
  
  return steps;
}

// Default step procedure (used when no specific procedure is defined)
const defaultStepProcedure = [
  { step: 1, title: 'Document Selection', description: 'Select category type and permit type', icon: 'document' },
  { step: 2, title: 'Applicant Information', description: 'Provide personal and contact details', icon: 'user' },
  { step: 3, title: 'Location Details', description: 'Provide location and map pin', icon: 'location' },
  { step: 4, title: 'Application Details', description: 'Describe purpose and environmental impact', icon: 'document' },
  { step: 5, title: 'Documents & Review', description: 'Upload documents and submit application', icon: 'upload' }
];


Object.values(categoryTypePermitOptions)
  .flat()
  .forEach((label) => {
    if (!documentTypeDetails[label]) {
      documentTypeDetails[label] = {
        classification: "See DENR Regional Office / Citizen's Charter",
        fees: 'Contact the office for applicable fees',
        minimumProcessingTime: 'Processing time varies by application type'
      };
    }
  });

// Custom Form Elements
const formSelectionNotice = document.getElementById('formSelectionNotice');
const customFormContainer = document.getElementById('customFormContainer');
const formContentArea = document.getElementById('formContentArea');
const formTitle = document.getElementById('formTitle');
const formSubtitle = document.getElementById('formSubtitle');
const clearFormBtn = document.getElementById('clearFormBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const formDownloadAwareness = document.getElementById('formDownloadAwareness');
const dismissAwareness = document.getElementById('dismissAwareness');
const downloadFormBtn = document.getElementById('downloadFormBtn');
const proceedWithoutDownloadBtn = document.getElementById('proceedWithoutDownloadBtn');
const downloadChecklistDocxBtn = document.getElementById('downloadChecklistDocxBtn');

/** Official Citizen's Charter checklist DOCX (same files as Application Form page). */
const CHECKLIST_DOCX_FILES = {
  Lands: 'Checklist_CC 2024 Lands edited.docx',
  Forestry: 'Checklist_CC 2024 Forestry edited.docx',
  Biodiversity: 'Checklist_CC 2024 Biodiversity edited.docx'
};

// Document type change handler
const documentTypeSelect = document.getElementById('documentType');
const permitTypeSelect = document.getElementById('permitType');
const permitTypeInfo = document.getElementById('permitTypeInfo');
const permitTypeDescription = document.getElementById('permitTypeDescription');
const categoryAwarenessBanner = document.getElementById('categoryAwarenessBanner');
const categoryAwarenessBannerBody = document.getElementById('categoryAwarenessBannerBody');
const categoryAwarenessBannerDismiss = document.getElementById('categoryAwarenessBannerDismiss');

const permitAwarenessBanner = document.getElementById('permitAwarenessBanner');
const permitAwarenessBannerBody = document.getElementById('permitAwarenessBannerBody');
const permitAwarenessBannerDismiss = document.getElementById('permitAwarenessBannerDismiss');

const requirementsSection = document.getElementById('requirementsSection');
const requirementsList = document.getElementById('requirementsList');

function hideCategoryAwarenessBanner() {
  if (categoryAwarenessBanner) {
    categoryAwarenessBanner.style.display = 'none';
  }
}

function hidePermitAwarenessBanner() {
  if (permitAwarenessBanner) {
    permitAwarenessBanner.style.display = 'none';
  }
}

function hideRequirementsSection() {
  if (requirementsSection) {
    requirementsSection.style.display = 'none';
  }
}

function updateRequirementsSection() {
  if (!requirementsSection || !requirementsList) return;
  const permit = document.getElementById('permitType')?.value || '';

  const requirements = PERMIT_REQUIREMENTS[permit];

  if (requirements && requirements.length > 0) {
    requirementsList.innerHTML = requirements.map((req, index) => `
      <div class="requirement-item">
        <div class="requirement-number">${index + 1}</div>
        <div class="requirement-text">${req}</div>
      </div>
    `).join('');
    requirementsSection.style.display = 'block';
  } else {
    hideRequirementsSection();
  }
}

function updateCategoryAwarenessBanner() {
  if (!categoryAwarenessBanner || !categoryAwarenessBannerBody) return;
  const docType = document.getElementById('documentType')?.value || '';

  const copy = CATEGORY_AWARENESS_COPY[docType];

  if (copy) {
    categoryAwarenessBannerBody.innerHTML = `<p><strong>${copy.title}</strong></p><p>${copy.body}</p>`;
    categoryAwarenessBanner.style.display = 'block';
  } else {
    hideCategoryAwarenessBanner();
  }
}

function updatePermitAwarenessBanner() {
  if (!permitAwarenessBanner || !permitAwarenessBannerBody) return;
  const permit = document.getElementById('permitType')?.value || '';

  const copy = PERMIT_AWARENESS_COPY[permit];

  if (copy) {
    permitAwarenessBannerBody.innerHTML = `<p><strong>${copy.title}</strong></p><p>${copy.body}</p>`;
    permitAwarenessBanner.style.display = 'block';
  } else {
    hidePermitAwarenessBanner();
  }
}

function updateStep1AwarenessBanner() {
  updateCategoryAwarenessBanner();
  updatePermitAwarenessBanner();
  updateRequirementsSection();
  updateCustomFormDisplay();
}

// Custom Form Functions
function updateCustomFormDisplay() {
  if (!formSelectionNotice || !customFormContainer) return;
  
  const documentType = document.getElementById('documentType')?.value || '';
  const permitType = document.getElementById('permitType')?.value || '';
  
  if (!documentType || !permitType) {
    // Show selection notice, hide form container
    formSelectionNotice.style.display = 'flex';
    customFormContainer.style.display = 'none';
    formDownloadAwareness.style.display = 'none';
    return;
  }
  
  // Check if we have a form template for this permit type
  const formTemplate = DENR_FORM_TEMPLATES[permitType];
  
  if (formTemplate) {
    // Load the form
    loadCustomForm(permitType, formTemplate);
    formSelectionNotice.style.display = 'none';
    customFormContainer.style.display = 'block';
  } else {
    // Show selection notice for forms not yet implemented
    formSelectionNotice.style.display = 'flex';
    customFormContainer.style.display = 'none';
    
    // Update notice content
    const noticeContent = formSelectionNotice.querySelector('.notice-content');
    if (noticeContent) {
      noticeContent.innerHTML = `
        <h5>Form Coming Soon</h5>
        <p>The form for "${permitType}" is being prepared. Please check back later or contact the DENR office for assistance.</p>
      `;
    }
  }
}

function loadCustomForm(permitType, formTemplate) {
  if (!formContentArea || !formTitle || !formSubtitle) return;
  
  // Update form title and subtitle
  formTitle.textContent = formTemplate.title;
  const sub = formTemplate.subtitle != null ? String(formTemplate.subtitle).trim() : '';
  formSubtitle.textContent = sub;
  formSubtitle.style.display = sub ? '' : 'none';
  
  // Load form content
  formContentArea.innerHTML = formTemplate.template;

  const titleSection = document.querySelector('#customFormContainer .form-title-section');
  if (titleSection) {
    titleSection.style.display = formContentArea.querySelector('.denr-checklist-official') ? 'none' : '';
  }
  
  // Auto-populate form fields from Step 1 data
  autoPopulateFormFields();
  
  // Add input validation and limits
  setupInputValidation();
  
  // Add event listeners for form validation
  setupFormValidation();
}

function autoPopulateFormFields() {
  // Get user data from localStorage or form fields
  const userData = {
    name: localStorage.getItem('userName') || '',
    email: localStorage.getItem('userEmail') || '',
    mobile: localStorage.getItem('userMobile') || '',
    address: localStorage.getItem('userAddress') || ''
  };
  
  // Auto-populate common fields
  const nameFields = formContentArea.querySelectorAll('#applicantName, #ownerName, #importerName');
  const emailFields = formContentArea.querySelectorAll('#applicantEmail, #ownerEmail, #importerEmail');
  const mobileFields = formContentArea.querySelectorAll('#applicantContact, #ownerContact, #contactNumber');
  const addressFields = formContentArea.querySelectorAll('#applicantAddress, #ownerAddress, #importerAddress');
  
  nameFields.forEach(field => {
    if (field && userData.name) field.value = userData.name;
  });
  
  emailFields.forEach(field => {
    if (field && userData.email) field.value = userData.email;
  });
  
  mobileFields.forEach(field => {
    if (field && userData.mobile) field.value = userData.mobile;
  });
  
  addressFields.forEach(field => {
    if (field && userData.address) field.value = userData.address;
  });
  
  // Set current date for date fields
  const today = new Date().toISOString().split('T')[0];
  const dateFields = formContentArea.querySelectorAll('input[type="date"]');
  dateFields.forEach(field => {
    if (field && !field.value) field.value = today;
  });
}

function setupInputValidation() {
  if (!formContentArea) return;
  
  // Get all input fields
  const textInputs = formContentArea.querySelectorAll('input[type="text"], input:not([type]), textarea');
  const numberInputs = formContentArea.querySelectorAll('input[type="number"]');
  const mobileInputs = formContentArea.querySelectorAll('#applicantContact, #ownerContact, #contactNumber, input[name*="mobile"], input[name*="contact"], input[placeholder*="mobile" i], input[placeholder*="contact" i]');
  
  // Text input validation - max 100 characters
  textInputs.forEach(input => {
    // Skip mobile/contact fields as they have special validation
    if (input.id && (input.id.toLowerCase().includes('contact') || input.id.toLowerCase().includes('mobile'))) {
      return;
    }
    if (input.placeholder && (input.placeholder.toLowerCase().includes('contact') || input.placeholder.toLowerCase().includes('mobile'))) {
      return;
    }
    
    // Set maxlength if not already set
    if (!input.hasAttribute('maxlength')) {
      if (input.tagName.toLowerCase() === 'textarea') {
        input.setAttribute('maxlength', '500');
      } else {
        input.setAttribute('maxlength', '100');
      }
    }
    
    // Add character counter for long fields
    if (input.tagName.toLowerCase() === 'textarea') {
      addCharacterCounter(input);
    }
  });
  
  // Number input validation - only allow numbers
  numberInputs.forEach(input => {
    input.addEventListener('input', (e) => {
      // Remove non-numeric characters
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
    
    input.addEventListener('keypress', (e) => {
      // Only allow numbers
      if (!/[0-9]/.test(e.key) && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'Tab' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
        e.preventDefault();
      }
    });
  });
  
  // Mobile number validation - 11 digits only, must start with 09
  mobileInputs.forEach(input => {
    // Set type to tel for better mobile keyboard
    input.setAttribute('type', 'tel');
    input.setAttribute('maxlength', '11');
    input.setAttribute('pattern', '09[0-9]{9}');
    input.setAttribute('placeholder', '09XXXXXXXXX');
    
    input.addEventListener('input', (e) => {
      // Remove non-numeric characters
      let value = e.target.value.replace(/[^0-9]/g, '');
      
      // Auto-add "09" if user starts typing
      if (value.length > 0 && !value.startsWith('09')) {
        // If first digit is 0, add 9
        if (value.startsWith('0') && value.length === 1) {
          value = '09';
        }
        // If first digit is 9, prepend 0
        else if (value.startsWith('9')) {
          value = '0' + value;
        }
        // Otherwise, prepend 09
        else {
          value = '09' + value;
        }
      }
      
      // Limit to 11 digits
      if (value.length > 11) {
        value = value.slice(0, 11);
      }
      
      e.target.value = value;
      
      // Visual feedback
      if (value.length > 0 && value.length < 11) {
        e.target.style.borderColor = '#fbbf24';
      } else if (value.length === 11 && value.startsWith('09')) {
        e.target.style.borderColor = '#10b981';
      } else if (value.length > 0 && !value.startsWith('09')) {
        e.target.style.borderColor = '#dc2626';
      } else {
        e.target.style.borderColor = '';
      }
    });
    
    input.addEventListener('keypress', (e) => {
      // Only allow numbers
      if (!/[0-9]/.test(e.key) && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'Tab' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
        e.preventDefault();
      }
    });
    
    input.addEventListener('blur', (e) => {
      const value = e.target.value;
      if (value.length > 0 && (value.length !== 11 || !value.startsWith('09'))) {
        // Show error
        e.target.style.borderColor = '#dc2626';
        showMobileError(e.target, 'Must start with 09');
      } else {
        e.target.style.borderColor = '';
        removeMobileError(e.target);
      }
    });
  });
}

function addCharacterCounter(textarea) {
  const maxLength = textarea.getAttribute('maxlength') || 500;
  const counter = document.createElement('div');
  counter.className = 'character-counter';
  counter.style.cssText = 'font-size: 12px; color: #6b7280; text-align: right; margin-top: 4px;';
  
  const updateCounter = () => {
    const remaining = maxLength - textarea.value.length;
    counter.textContent = `${textarea.value.length}/${maxLength} characters`;
    
    if (remaining < 50) {
      counter.style.color = '#dc2626';
    } else if (remaining < 100) {
      counter.style.color = '#f59e0b';
    } else {
      counter.style.color = '#6b7280';
    }
  };
  
  textarea.addEventListener('input', updateCounter);
  textarea.parentNode.insertBefore(counter, textarea.nextSibling);
  updateCounter();
}

function showMobileError(input, customMessage = null) {
  removeMobileError(input);
  
  const message = customMessage || 'Mobile number must be exactly 11 digits and start with 09';
  
  const errorMsg = document.createElement('div');
  errorMsg.className = 'mobile-error-message';
  errorMsg.style.cssText = 'color: #dc2626; font-size: 12px; margin-top: 4px; display: flex; align-items: center; gap: 6px;';
  errorMsg.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <span>${message}</span>
  `;
  
  input.parentNode.insertBefore(errorMsg, input.nextSibling);
}

function removeMobileError(input) {
  const errorMsg = input.parentNode.querySelector('.mobile-error-message');
  if (errorMsg) {
    errorMsg.remove();
  }
}

function setupFormValidation() {
  const requiredFields = formContentArea.querySelectorAll('[required]');
  const checkboxes = formContentArea.querySelectorAll('input[type="checkbox"][required]');
  
  requiredFields.forEach(field => {
    field.addEventListener('input', validateForm);
    field.addEventListener('change', validateForm);
  });
  
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', validateForm);
  });
}

function validateForm() {
  if (!formContentArea) return true;
  
  const requiredFields = formContentArea.querySelectorAll('[required]');
  const requiredCheckboxes = formContentArea.querySelectorAll('input[type="checkbox"][required]');
  
  let isValid = true;
  let emptyFieldCount = 0;
  let uncheckedBoxCount = 0;
  
  // Check text/select/textarea fields
  requiredFields.forEach(field => {
    if (!field.value.trim()) {
      isValid = false;
      emptyFieldCount++;
      // Add visual feedback
      field.style.borderColor = '#fca5a5';
      field.addEventListener('input', function() {
        this.style.borderColor = '';
      }, { once: true });
    }
  });
  
  // Check required checkboxes
  requiredCheckboxes.forEach(checkbox => {
    if (!checkbox.checked) {
      isValid = false;
      uncheckedBoxCount++;
    }
  });
  
  // Show/hide validation message with detailed feedback
  const validationMessage = document.getElementById('formValidationMessage');
  if (validationMessage) {
    if (!isValid) {
      const validationText = validationMessage.querySelector('.validation-text');
      if (validationText) {
        let message = 'Please complete all required fields before proceeding.';
        if (emptyFieldCount > 0 && uncheckedBoxCount > 0) {
          message = `Please fill ${emptyFieldCount} required field${emptyFieldCount > 1 ? 's' : ''} and check ${uncheckedBoxCount} required checkbox${uncheckedBoxCount > 1 ? 'es' : ''}.`;
        } else if (emptyFieldCount > 0) {
          message = `Please fill ${emptyFieldCount} required field${emptyFieldCount > 1 ? 's' : ''}.`;
        } else if (uncheckedBoxCount > 0) {
          message = `Please check ${uncheckedBoxCount} required checkbox${uncheckedBoxCount > 1 ? 'es' : ''}.`;
        }
        validationText.textContent = message;
      }
      validationMessage.style.display = 'flex';
      validationMessage.style.animation = 'fieldErrorSlideIn 0.3s ease-out';
    } else {
      validationMessage.style.display = 'none';
    }
  }
  
  return isValid;
}

function clearCustomForm() {
  if (!formContentArea) return;
  
  const inputs = formContentArea.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    if (input.type === 'checkbox') {
      input.checked = false;
    } else {
      input.value = '';
    }
  });
  
  // Re-auto-populate basic fields
  autoPopulateFormFields();
  
  // Hide validation message
  const validationMessage = document.getElementById('formValidationMessage');
  if (validationMessage) {
    validationMessage.style.display = 'none';
  }
}

/** Active DENR form in Step 2 (official checklist shell or generic denr-form). */
function getDenrFilledFormRoot() {
  if (!formContentArea) return null;
  return (
    formContentArea.querySelector('.denr-checklist-official') ||
    formContentArea.querySelector('.denr-form')
  );
}

async function generateFormPDF() {
  if (!validateForm()) {
    showAlert('Please complete all required fields before downloading the form.', 'warning');
    return;
  }

  const denrForm = getDenrFilledFormRoot();
  if (!denrForm) {
    showAlert('No form to export.', 'warning');
    return;
  }

  const permitType = document.getElementById('permitType')?.value || 'application';
  const filename = `${permitType.replace(/[^a-zA-Z0-9]/g, '_')}_form_${Date.now()}.pdf`;

  try {
    const { jsPDF } = window.jspdf;

    if (typeof html2canvas === 'function') {
      const imgs = denrForm.querySelectorAll('img');
      await Promise.all(
        Array.from(imgs).map(
          (img) =>
            img.complete
              ? Promise.resolve()
              : new Promise((resolve) => {
                  img.onload = resolve;
                  img.onerror = resolve;
                })
        )
      );

      denrForm.classList.add('denr-form--pdf-snapshot');
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch (_) {
          /* ignore */
        }
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      let canvas;
      try {
        canvas = await html2canvas(denrForm, {
          scale: 4,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0,
          imageTimeout: 15000
        });
      } catch (e) {
        console.warn('html2canvas at scale 4 failed, retrying at 3:', e);
        canvas = await html2canvas(denrForm, {
          scale: 3,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0,
          imageTimeout: 15000
        });
      } finally {
        denrForm.classList.remove('denr-form--pdf-snapshot');
      }

      const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      // Document title used in the formal page footer
      const docTitle = (formTitle?.textContent || permitType || 'DENR Application Form').trim();
      doc.setProperties({
        title: docTitle,
        subject: 'DENR Citizen\u2019s Charter Checklist of Requirements',
        creator: 'DENR CENRO Sta. Cruz - Online Application System'
      });
      addDenrFormCanvasToPdf(doc, canvas, { documentTitle: docTitle });
      doc.save(filename);
      showFormDownloadAwareness();
      showAlert(
        'PDF downloaded \u2014 fits on a single A4 page with formal margins and footer. For the blank Word checklist, use \u201cOfficial checklist (Word)\u201d.',
        'success'
      );
      return;
    }

    const doc = new jsPDF();
    const title = formTitle.textContent || 'DENR Application Form';
    doc.setFontSize(20);
    doc.text(title, 105, 22, { align: 'center' });
    doc.setFontSize(14);
    const subtitle = formSubtitle.textContent || '';
    if (subtitle) doc.text(subtitle, 105, 32, { align: 'center' });
    doc.setFontSize(11);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 48);

    const formData = extractFormData();
    let yPosition = 62;
    doc.setFontSize(12);
    Object.entries(formData).forEach(([key, value]) => {
      if (yPosition > 270) {
        doc.addPage();
        yPosition = 20;
      }
      const fieldName = key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
      doc.text(`${fieldName}:`, 20, yPosition);
      doc.text(String(value || ''), 60, yPosition);
      yPosition += 10;
    });
    if (yPosition > 240) {
      doc.addPage();
      yPosition = 20;
    }
    doc.text('Signature:', 20, yPosition);
    doc.line(20, yPosition + 5, 80, yPosition + 5);
    doc.text('Date:', 120, yPosition);
    doc.line(120, yPosition + 5, 180, yPosition + 5);
    doc.save(filename);
    showFormDownloadAwareness();
    showAlert('Form downloaded successfully! Please sign the form and upload it in the document upload step.', 'success');
  } catch (error) {
    console.error('Error generating PDF:', error);
    showAlert('Error generating PDF. Please try again.', 'error');
  }
}

/**
 * Renders the captured DENR form onto a single formal A4 page.
 * - 10 mm side / 10 mm top margins; 12 mm reserved at bottom for the footer.
 * - The form is scaled proportionally to the largest size that fully fits the
 *   printable area (width OR height bound), then centered horizontally.
 * - A thin footer with the document name and generated date appears at the
 *   bottom of the page for a formal, print-ready look.
 */
function addDenrFormCanvasToPdf(pdf, canvas, options = {}) {
  const {
    documentTitle = 'DENR Application Form',
    generatedAt = new Date(),
  } = options;

  const pageWidth = pdf.internal.pageSize.getWidth();   // 210 mm
  const pageHeight = pdf.internal.pageSize.getHeight(); // 297 mm
  const marginX = 10;
  const marginTop = 10;
  const footerReserved = 12; // bottom space reserved for the footer
  const printableW = pageWidth - 2 * marginX;
  const printableH = pageHeight - marginTop - footerReserved;

  const cw = canvas.width;
  const ch = canvas.height;
  const aspect = cw / ch;

  // Fit-to-page: pick the larger drawing size that still fits both bounds.
  let drawW = printableW;
  let drawH = drawW / aspect;
  if (drawH > printableH) {
    drawH = printableH;
    drawW = drawH * aspect;
  }

  const x = marginX + (printableW - drawW) / 2;
  const y = marginTop;

  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, drawW, drawH);

  // Formal footer: thin separator + document title + date
  const dateStr = generatedAt.toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const footerY = pageHeight - 6;
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.2);
  pdf.line(marginX, footerY - 4, pageWidth - marginX, footerY - 4);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(110, 110, 110);
  pdf.text(documentTitle, marginX, footerY);
  pdf.text(`Generated ${dateStr}`, pageWidth - marginX, footerY, { align: 'right' });
  pdf.setTextColor(0, 0, 0);
}

function downloadOfficialChecklistDocx() {
  const docType = document.getElementById('documentType')?.value || '';
  const fileName = CHECKLIST_DOCX_FILES[docType];
  if (!fileName) {
    showAlert('Select Lands, Forestry, or Biodiversity in Step 1 to download the matching official checklist (Word).', 'warning');
    return;
  }
  const link = document.createElement('a');
  link.href = `/assets/form/${encodeURIComponent(fileName)}`;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showAlert(`Downloaded ${fileName} — same layout as the Citizens Charter checklist.`, 'success');
}

function extractFormData() {
  const formData = {};
  
  if (!formContentArea) return formData;
  
  // Get all input fields
  const inputs = formContentArea.querySelectorAll('input, textarea, select');
  
  inputs.forEach(input => {
    const id = input.id;
    const label = formContentArea.querySelector(`label[for="${id}"]`)?.textContent || id;
    
    if (input.type === 'checkbox') {
      formData[label] = input.checked ? 'Yes' : 'No';
    } else if (input.type === 'radio') {
      if (input.checked) {
        formData[label] = input.value;
      }
    } else {
      formData[label] = input.value;
    }
  });
  
  return formData;
}

function showFormDownloadAwareness() {
  if (formDownloadAwareness) {
    formDownloadAwareness.style.display = 'block';
  }
}

function hideFormDownloadAwareness() {
  if (formDownloadAwareness) {
    formDownloadAwareness.style.display = 'none';
  }
}

if (categoryAwarenessBannerDismiss) {
  categoryAwarenessBannerDismiss.addEventListener('click', () => {
    hideCategoryAwarenessBanner();
  });
}

if (permitAwarenessBannerDismiss) {
  permitAwarenessBannerDismiss.addEventListener('click', () => {
    hidePermitAwarenessBanner();
  });
}

// Custom Form Event Listeners
if (clearFormBtn) {
  clearFormBtn.addEventListener('click', clearCustomForm);
}

if (downloadPdfBtn) {
  downloadPdfBtn.addEventListener('click', () => {
    generateFormPDF();
  });
}

if (downloadChecklistDocxBtn) {
  downloadChecklistDocxBtn.addEventListener('click', downloadOfficialChecklistDocx);
}

if (dismissAwareness) {
  dismissAwareness.addEventListener('click', hideFormDownloadAwareness);
}

if (downloadFormBtn) {
  downloadFormBtn.addEventListener('click', () => {
    generateFormPDF();
  });
}

if (proceedWithoutDownloadBtn) {
  proceedWithoutDownloadBtn.addEventListener('click', () => {
    hideFormDownloadAwareness();
    showAlert('You can proceed without downloading, but remember to complete the form later.', 'info');
  });
}

function resetPermitSelectForCategory(selectedType) {
  const pts = document.getElementById('permitType');
  if (!pts) return;
  pts.innerHTML = '';
  
  if (selectedType && documentTypeOptions[selectedType]) {
    // Add disabled placeholder option
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = 'Select permit type';
    pts.appendChild(placeholder);
    
    // Add actual options
    documentTypeOptions[selectedType].forEach((option) => {
      const opt = document.createElement('option');
      opt.value = option;
      opt.textContent = option;
      pts.appendChild(opt);
    });
    pts.disabled = false;
  } else {
    // Add disabled placeholder option for no category state
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = 'Select category type first';
    pts.appendChild(placeholder);
    pts.disabled = true;
  }
  
  // Reset permit info
  if (permitTypeInfo) {
    permitTypeInfo.style.display = 'none';
  }
}

const catSelect = document.getElementById('documentType');
const cat = catSelect ? catSelect.value : '';
if (permitTypeInfo) {
  permitTypeInfo.style.display = 'none';
}
resetPermitSelectForCategory(cat);

function initializeStep1DocumentControls() {
  const catSelect = document.getElementById('documentType');
  const cat = catSelect ? catSelect.value : '';
  if (permitTypeInfo) {
    permitTypeInfo.style.display = 'none';
  }
  resetPermitSelectForCategory(cat);
  updateStep1AwarenessBanner();
}

if (documentTypeSelect) {
  documentTypeSelect.addEventListener('change', (e) => {
    const selectedType = e.target.value;

    localStorage.setItem('selectedDocumentType', selectedType);
    localStorage.removeItem('selectedPermitType');

    resetPermitSelectForCategory(selectedType);

    if (selectedType && documentTypeDescriptions[selectedType] && permitTypeInfo && permitTypeDescription) {
      permitTypeInfo.style.display = 'block';
      permitTypeDescription.textContent = documentTypeDescriptions[selectedType];
    } else if (permitTypeInfo) {
      permitTypeInfo.style.display = 'none';
    }

    updateStep1AwarenessBanner();
  });
}

// Function to get the appropriate step procedure based on document type and category
function getStepProcedure(documentType, permitType) {
  if (documentType && permitType) {
    return generateStepProcedure(documentType, permitType);
  }
  return defaultStepProcedure;
}

// Function to dynamically update step indicators
function updateStepIndicators(documentType, permitType) {
  const stepProcedure = getStepProcedure(documentType, permitType);
  const stepsContainer = document.querySelector('.steps-container');
  const progressSubtitle = document.querySelector('.progress-subtitle');
  
  if (!stepsContainer) return;
  
  // Update progress subtitle
  if (progressSubtitle) {
    progressSubtitle.textContent = `Complete all ${stepProcedure.length} steps to submit your application`;
  }
  
  // Clear existing steps
  stepsContainer.innerHTML = '';
  
  // Step icons mapping
  const stepIcons = {
    document: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
    organization: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
    location: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`,
    project: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`,
    upload: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`,
    review: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>`,
    user: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
    business: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`,
    tool: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`,
    purpose: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
    wildlife: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`,
    transport: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`,
    health: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>`,
    layout: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>`,
    environment: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>`,
    tax: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>`,
    import: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>`,
    facility: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"></path><path d="M5 21V7l8-4 8 4v14"></path><path d="M17 21v-8.5a1.5 1.5 0 0 0-1.5-1.5h-7a1.5 1.5 0 0 0-1.5 1.5V21"></path></svg>`,
    product: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`,
    clearance: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
    residency: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
    property: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`,
    survey: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
    amendment: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
    technical: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,
    cancellation: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>`,
    details: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`
  };
  
  // Generate step items
  stepProcedure.forEach((step, index) => {
    const stepItem = document.createElement('div');
    stepItem.className = 'step-item';
    stepItem.dataset.step = step.step;
    
    const iconSvg = stepIcons[step.icon] || stepIcons.document;
    
    stepItem.innerHTML = `
      <div class="step-icon-wrapper">
        <div class="step-number">${step.step}</div>
        <div class="step-icon">
          ${iconSvg}
        </div>
      </div>
      <div class="step-label">${step.title}</div>
      <div class="step-description">${step.description}</div>
    `;
    
    stepsContainer.appendChild(stepItem);
  });
  
  // Update current step display
  const currentStep = document.querySelector('.step-item.active');
  if (currentStep) {
    const stepNum = parseInt(currentStep.dataset.step);
    if (stepNum > stepProcedure.length) {
      // If current step is beyond new step count, reset to step 1
      goToStep(1);
    }
  }
}

// Permit type change handler - show document requirements and update steps
if (permitTypeSelect) {
  permitTypeSelect.addEventListener('change', (e) => {
    const selectedPermitType = e.target.value;
    const selectedDocumentType = documentTypeSelect ? documentTypeSelect.value : '';

    // Save to localStorage for persistence across reload
    localStorage.setItem('selectedPermitType', selectedPermitType);

    updateStep1AwarenessBanner();
    
    // Update step indicators and form steps based on document type and category
    if (selectedDocumentType && selectedPermitType) {
      updateStepIndicators(selectedDocumentType, selectedPermitType);
      updateFormSteps(selectedDocumentType, selectedPermitType);
      updateDocumentUploadFields(selectedDocumentType, selectedPermitType);
    }
  });
}

// Function to dynamically generate document upload fields based on required documents
function updateDocumentUploadFields(documentType, permitType) {
  const requirements = PERMIT_REQUIREMENTS[permitType] || [];
  const uploadContainer = document.getElementById('dynamicDocumentUploads');
  const requirementsList4 = document.getElementById('requirementsList4');

  if (!uploadContainer) return;

  // Clear existing upload fields
  uploadContainer.innerHTML = '';

  // If we're editing and have existing documents, display them after creating upload fields
  const isEditing = window.editingAppId && window.existingDocuments;
  if (isEditing) {
    console.log('Editing mode detected, will display existing documents after creating upload fields');
  }

  // Set grid layout for container
  uploadContainer.style.display = 'grid';
  uploadContainer.style.gridTemplateColumns = 'repeat(2, 1fr)';
  uploadContainer.style.gap = '16px';

  // Generate upload fields for each required document
  requirements.forEach((req, index) => {
    const safeName = req.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const uploadGroup = document.createElement('div');
    uploadGroup.className = 'form-group';
    uploadGroup.style.marginBottom = '0';
    uploadGroup.innerHTML = `
      <label for="docUpload_${index}" style="display: block; margin-bottom: 6px; font-weight: 600; color: #1f2937; font-size: 13px;">${req} *</label>
      <div id="dropzone_${index}" style="border: 4px solid #10b981; border-radius: 12px; padding: 30px 20px; text-align: center; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); background: #ffffff; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);">
        <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 15px; transition: all 0.3s ease;">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <p style="color: #1f2937; font-size: 15px; margin: 0 0 6px 0; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Drop your document here</p>
        <p style="color: #6b7280; font-size: 13px; margin: 0; font-weight: 500;">or click to select file</p>
        <input type="file" id="docUpload_${index}" name="${safeName}" accept=".pdf,.jpg,.jpeg,.png" style="display: none;" />
        <div id="docUpload_${index}_preview" style="margin-top: 12px; display: none;">
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px; background: #f0fdf4; padding: 8px 14px; border-radius: 8px; border: 1px solid #bbf7d0; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span id="docUpload_${index}_filename" style="color: #16a34a; font-size: 12px; font-weight: 600;"></span>
            <button type="button" onclick="removeFile(event, ${index})" style="background: #fee2e2; border: none; cursor: pointer; padding: 4px; color: #dc2626; border-radius: 4px; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center;">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      </div>
      <small style="display: block; margin-top: 6px; color: #9ca3af; font-size: 11px;">Accepted: PDF, JPG, PNG (up to 50MB)</small>
    `;
    uploadContainer.appendChild(uploadGroup);

    // Add dropzone functionality
    const dropzone = document.getElementById(`dropzone_${index}`);
    const fileInput = document.getElementById(`docUpload_${index}`);
    const preview = document.getElementById(`docUpload_${index}_preview`);
    const filenameSpan = document.getElementById(`docUpload_${index}_filename`);

    // Click to browse
    dropzone.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
        fileInput.click();
      }
    });

    // Drag and drop events
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '#059669';
      dropzone.style.background = '#ffffff';
      dropzone.style.boxShadow = '0 8px 20px rgba(16, 185, 129, 0.3)';
      dropzone.style.transform = 'scale(1.02)';
      const svg = dropzone.querySelector('svg');
      if (svg) {
        svg.style.stroke = '#059669';
      }
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '#10b981';
      dropzone.style.background = '#ffffff';
      dropzone.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.2)';
      dropzone.style.transform = 'scale(1)';
      const svg = dropzone.querySelector('svg');
      if (svg) {
        svg.style.stroke = '#10b981';
      }
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '#10b981';
      dropzone.style.background = '#ffffff';
      dropzone.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.2)';
      dropzone.style.transform = 'scale(1)';
      const svg = dropzone.querySelector('svg');
      if (svg) {
        svg.style.stroke = '#10b981';
      }
      
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        fileInput.files = files;
        handleFileSelect(index, files[0]);
      }
    });

    // File input change event
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFileSelect(index, e.target.files[0]);
      }
    });
  });

  // If we're editing, display existing documents after creating upload fields
  if (isEditing) {
    setTimeout(() => {
      console.log('Displaying existing documents after creating upload fields...');
      
      // First, let's check if all upload areas exist
      const requirements = PERMIT_REQUIREMENTS[permitType] || [];
      console.log('Checking upload areas for', requirements.length, 'requirements');
      
      requirements.forEach((req, index) => {
        const uploadArea = document.getElementById(`docUpload_${index}_preview`);
        const dropzone = document.getElementById(`dropzone_${index}`);
        console.log(`Index ${index} - Upload area: ${!!uploadArea}, Dropzone: ${!!dropzone}`);
      });
      
      displayExistingDocuments(window.existingDocuments || []);
    }, 300);
  }
}

// Helper function to handle file selection
function handleFileSelect(index, file) {
  const preview = document.getElementById(`docUpload_${index}_preview`);
  const filenameSpan = document.getElementById(`docUpload_${index}_filename`);
  const dropzone = document.getElementById(`dropzone_${index}`);
  
  if (preview && filenameSpan) {
    preview.style.display = 'block';
    filenameSpan.textContent = file.name;
    
    // Update dropzone appearance
    dropzone.style.borderColor = '#16a34a';
    dropzone.style.background = '#f0fdf4';
    dropzone.style.boxShadow = '0 1px 3px rgba(22, 163, 74, 0.1)';
    const svg = dropzone.querySelector('svg');
    if (svg) {
      svg.style.stroke = '#16a34a';
    }
  }
  
  // Simple approach: Use sessionStorage for immediate testing
  const reader = new FileReader();
  reader.onload = function(e) {
    const fileData = {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      base64: e.target.result,
      timestamp: Date.now()
    };
    
    try {
      // Save to sessionStorage only (localStorage has 5-10MB limit)
      // Don't save large file data to localStorage to prevent quota exceeded error
      if (fileData.data && fileData.data.length > 1000000) { // If larger than ~1MB
        console.log(`File ${file.name} too large for storage (${(fileData.data.length / 1024 / 1024).toFixed(2)} MB), keeping in memory only`);
        // Store only metadata, not the full data
        const metadataOnly = {
          ...fileData,
          data: null, // Don't store large data
          storedInMemory: true
        };
        sessionStorage.setItem(`docUpload_${index}`, JSON.stringify(metadataOnly));
      } else {
        sessionStorage.setItem(`docUpload_${index}`, JSON.stringify(fileData));
      }
      console.log(`File ${file.name} saved to sessionStorage as docUpload_${index}`);
      
      // Update UI to show saved status
      if (filenameSpan) {
        filenameSpan.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB) - Ready`;
        filenameSpan.style.color = '#059669';
      }
      
    } catch (error) {
      console.error('Error saving file to storage:', error);
      // Don't show error to user, just log it - file is still in memory
      if (filenameSpan) {
        filenameSpan.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB) - Ready`;
        filenameSpan.style.color = '#059669';
      }
    }
  };
  
  reader.onerror = function() {
    console.error('Error reading file:', reader.error);
    if (filenameSpan) {
      filenameSpan.textContent = `${file.name} - Read failed`;
      filenameSpan.style.color = '#dc2626';
    }
  };
  
  reader.readAsDataURL(file);
}

// IndexedDB helper functions for robust file storage
function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('DENRFileStorage', 1);
    
    request.onerror = function() {
      console.error('IndexedDB failed to open');
      reject(request.error);
    };
    
    request.onsuccess = function() {
      console.log('IndexedDB opened successfully');
      resolve(request.result);
    };
    
    request.onupgradeneeded = function(e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('files')) {
        const objectStore = db.createObjectStore('files', { keyPath: 'id' });
        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

function saveFileToIndexedDB(file, index, callback) {
  initIndexedDB().then(db => {
    const transaction = db.transaction(['files'], 'readwrite');
    const objectStore = transaction.objectStore('files');
    
    const reader = new FileReader();
    reader.onload = function(e) {
      const fileData = {
        id: `docUpload_${index}`,
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        data: e.target.result, // Store as base64
        timestamp: Date.now()
      };
      
      const request = objectStore.put(fileData);
      
      request.onsuccess = function() {
        callback(true);
      };
      
      request.onerror = function() {
        console.error('Error saving file to IndexedDB:', request.error);
        callback(false);
      };
    };
    
    reader.onerror = function() {
      console.error('Error reading file:', reader.error);
      callback(false);
    };
    
    reader.readAsDataURL(file);
  }).catch(error => {
    console.error('IndexedDB initialization failed:', error);
    callback(false);
  });
}

function getFileFromIndexedDB(index, callback) {
  initIndexedDB().then(db => {
    const transaction = db.transaction(['files'], 'readonly');
    const objectStore = transaction.objectStore('files');
    
    const request = objectStore.get(`docUpload_${index}`);
    
    request.onsuccess = function() {
      callback(request.result);
    };
    
    request.onerror = function() {
      console.error('Error getting file from IndexedDB:', request.error);
      callback(null);
    };
  }).catch(error => {
    console.error('IndexedDB initialization failed:', error);
    callback(null);
  });
}

function removeFileFromIndexedDB(index, callback) {
  initIndexedDB().then(db => {
    const transaction = db.transaction(['files'], 'readwrite');
    const objectStore = transaction.objectStore('files');
    
    const request = objectStore.delete(`docUpload_${index}`);
    
    request.onsuccess = function() {
      callback(true);
    };
    
    request.onerror = function() {
      console.error('Error removing file from IndexedDB:', request.error);
      callback(false);
    };
  }).catch(error => {
    console.error('IndexedDB initialization failed:', error);
    callback(false);
  });
}

// Fallback localStorage function
function saveFileToLocalStorage(file, index) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const fileData = {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      base64: e.target.result
    };
    
    try {
      localStorage.setItem(`docUpload_${index}`, JSON.stringify(fileData));
      console.log(`File ${file.name} saved to localStorage as fallback`);
    } catch (error) {
      console.error('Error saving to localStorage fallback:', error);
    }
  };
  
  reader.readAsDataURL(file);
}

// Helper function to remove file
window.removeFile = function(event, index) {
  event.stopPropagation();
  const fileInput = document.getElementById(`docUpload_${index}`);
  const preview = document.getElementById(`docUpload_${index}_preview`);
  const dropzone = document.getElementById(`dropzone_${index}`);
  
  if (fileInput) {
    fileInput.value = '';
  }
  
  if (preview) {
    preview.style.display = 'none';
  }
  
  if (dropzone) {
    dropzone.style.borderColor = '#d1d5db';
    dropzone.style.background = '#f9fafb';
    dropzone.style.boxShadow = 'none';
    const svg = dropzone.querySelector('svg');
    if (svg) {
      svg.style.stroke = '#9ca3af';
    }
  }
  
  // Remove from all storage locations
  sessionStorage.removeItem(`docUpload_${index}`);
  localStorage.removeItem(`docUpload_${index}`);
  localStorage.removeItem(`docUpload_${index}_backup`);
  localStorage.removeItem(`docUpload_${index}_meta`);
  console.log(`File removed from all storage: docUpload_${index}`);
};

// Helper functions for file restoration
function restoreFileFromFileData(fileData, preview, filenameSpan, fileInput, dropzone, source) {
  try {
    // Convert base64 back to File object
    const base64Data = fileData.data.split(',')[1];
    const byteCharacters = atob(base64Data);
    const byteArrays = [];
    const sliceSize = 512;

    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    const blob = new Blob(byteArrays, { type: fileData.type });
    const file = new File([blob], fileData.name, { type: fileData.type });

    // Use DataTransfer to set the file in the input
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    // Update UI to show restored file
    if (preview && filenameSpan) {
      preview.style.display = 'block';
      filenameSpan.textContent = `${fileData.name} (${(fileData.size / 1024).toFixed(1)} KB) - Restored from ${source}`;
      filenameSpan.style.color = '#059669';
    }

    // Update dropzone appearance
    if (dropzone) {
      dropzone.style.borderColor = '#16a34a';
      dropzone.style.background = '#f0fdf4';
      dropzone.style.boxShadow = '0 1px 3px rgba(22, 163, 74, 0.1)';
      const svg = dropzone.querySelector('svg');
      if (svg) {
        svg.style.stroke = '#16a34a';
      }
    }

    console.log(`File ${fileData.name} restored from ${source}`);
  } catch (error) {
    console.error('Error restoring file:', error);
    showFileErrorMessage(preview, filenameSpan, dropzone);
  }
}

function showFileRemovedMessage(fileName, preview, filenameSpan, dropzone) {
  if (preview && filenameSpan) {
    preview.style.display = 'block';
    filenameSpan.textContent = `${fileName} - File removed after reload (please re-upload)`;
    filenameSpan.style.color = '#dc2626';
  }
  
  if (dropzone) {
    dropzone.style.borderColor = '#fbbf24';
    dropzone.style.background = '#fef3c7';
    const svg = dropzone.querySelector('svg');
    if (svg) {
      svg.style.stroke = '#f59e0b';
    }
  }
}

function showFileErrorMessage(preview, filenameSpan, dropzone) {
  if (preview && filenameSpan) {
    preview.style.display = 'block';
    filenameSpan.textContent = `⚠ Could not restore file. Please re-upload.`;
    filenameSpan.style.color = '#dc2626';
  }
  
  if (dropzone) {
    dropzone.style.borderColor = '#ef4444';
    dropzone.style.background = '#fef2f2';
    const svg = dropzone.querySelector('svg');
    if (svg) {
      svg.style.stroke = '#dc2626';
    }
  }
}

// Function to dynamically update form steps based on document selection
function updateFormSteps(documentType, permitType) {
  const stepProcedure = getStepProcedure(documentType, permitType);
  const totalSteps = stepProcedure.length;
  
  console.log('updateFormSteps called - totalSteps:', totalSteps);
  
  // Update step titles and descriptions for all steps (without hiding them yet)
  for (let i = 1; i <= totalSteps; i++) {
    const stepElement = document.querySelector(`.form-step[data-step="${i}"]`);
    if (stepElement) {
      // Update step title and description
      const stepInfo = stepProcedure[i - 1];
      const titleElement = document.getElementById(`step${i}Title`);
      const descriptionElement = document.getElementById(`step${i}Description`);
      
      if (titleElement) titleElement.textContent = stepInfo.title;
      if (descriptionElement) descriptionElement.textContent = stepInfo.description;
    }
  }
  
  // Handle submit button visibility and type
  const finalStep = totalSteps;
  for (let i = 1; i <= 7; i++) {
    const nextButton = document.getElementById(`nextStep${i}`);
    const submitButton = document.getElementById(`submitStep${i}`);
    
    console.log(`Step ${i} - nextButton:`, nextButton, 'submitButton:', submitButton);
    
    if (nextButton) {
      if (i === finalStep) {
        nextButton.style.display = 'none';
      } else {
        nextButton.style.display = 'inline-block';
      }
    }
    
    if (submitButton) {
      if (i === finalStep) {
        submitButton.style.display = 'inline-block';
        submitButton.type = 'submit';
        submitButton.setAttribute('type', 'submit');
        console.log(`Set submitStep${i} to type="submit" and visible`);
      } else {
        submitButton.style.display = 'none';
        submitButton.type = 'button';
        submitButton.setAttribute('type', 'button');
      }
    }
  }
  
  // Reset to step 1 if we're currently on a step beyond the new total
  if (currentStep > totalSteps) {
    currentStep = 1;
  }
  
  // Show only the current step
  goToStep(currentStep);
}

// Application form map functionality
const showAppMapPin = document.getElementById('showAppMapPin');
if (showAppMapPin) {
  showAppMapPin.addEventListener('click', () => {
    const mapContainer = document.getElementById('appMapContainer');
    const addressInput = document.getElementById('applicantAddress');
    
    if (mapContainer.style.display === 'block') {
      // Hide map
      mapContainer.style.display = 'none';
      showAppMapPin.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
        Show Map to Pin Location
      `;
      return;
    }
    
    console.log('Show map button clicked');
    mapContainer.style.display = 'block';
    showAppMapPin.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
        <circle cx="12" cy="10" r="3"></circle>
      </svg>
      Hide Map
    `;
    console.log('Map container display set to block');
    
    // Small delay to ensure container is visible before initializing map
    setTimeout(() => {
      console.log('Initializing map...');
      if (!window.appMap) {
        // Initialize map centered on Philippines (Laguna area for DENR)
        try {
          window.appMap = L.map('appMap', {
            zoomControl: true
          }).setView([14.0794, 121.3267], 10);
          console.log('Map initialized');
          
          // Fix marker icon issue by setting default icon URLs
          const defaultIcon = L.icon({
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
          });
          L.Marker.prototype.options.icon = defaultIcon;
          
          // Add OpenStreetMap tiles
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
          }).addTo(window.appMap);
          console.log('Tiles added');
          
          // Add click handler for pinning location
          window.appMap.on('click', async function(e) {
            // Remove existing marker if any
            if (window.appCurrentMarker) {
              window.appMap.removeLayer(window.appCurrentMarker);
            }
            
            // Add new marker
            window.appCurrentMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(window.appMap);
            
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
        } catch (error) {
          console.error('Error initializing map:', error);
          showAlert('Error initializing map. Please try again.', 'error');
        }
      } else {
        // Map already exists, just resize it
        if (window.appMap && typeof window.appMap.invalidateSize === 'function') {
          window.appMap.invalidateSize();
          console.log('Map invalidated size');
        } else {
          console.error('Map exists but invalidateSize is not available, re-initializing...');
          // Re-initialize map if invalidateSize is not available
          window.appMap = L.map('appMap', {
            zoomControl: true
          }).setView([14.0794, 121.3267], 10);
          
          // Fix marker icon issue
          const defaultIcon = L.icon({
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
          });
          L.Marker.prototype.options.icon = defaultIcon;
          
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
          }).addTo(window.appMap);
          
          window.appMap.on('click', async function(e) {
            if (window.appCurrentMarker) {
              window.appMap.removeLayer(window.appCurrentMarker);
            }
            
            window.appCurrentMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(window.appMap);
            
            try {
              const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${e.latlng.lat}&lon=${e.latlng.lng}`);
              const data = await response.json();
              
              if (data.display_name) {
                addressInput.value = data.display_name;
              }
            } catch (error) {
              console.error('Reverse geocoding error:', error);
            }
          });
        }
      }
    }, 300);
  });
}

// Mobile number input validation - only allow numbers
const applicantMobileIndividualInput = document.getElementById('applicantMobileIndividual');
const applicantMobileCompanyInput = document.getElementById('applicantMobileCompany');

function setupMobileValidation(inputElement) {
  if (inputElement) {
    inputElement.addEventListener('input', (e) => {
      // Remove any non-numeric characters
      let value = e.target.value.replace(/[^0-9]/g, '');
      // Limit to 13 digits maximum
      if (value.length > 13) {
        value = value.slice(0, 13);
      }
      e.target.value = value;
    });

    inputElement.addEventListener('blur', (e) => {
      const value = e.target.value;
      if (value && value.length >= 2) {
        const prefix = value.substring(0, 2);
        if (prefix !== '09' && prefix !== '63') {
          showFieldError(e.target.id, 'Mobile number must start with 09 or 63.');
        } else if (prefix === '09' && value.length !== 11) {
          showFieldError(e.target.id, 'Mobile number starting with 09 must be exactly 11 digits.');
        } else if (prefix === '63' && value.length !== 13) {
          showFieldError(e.target.id, 'Mobile number starting with 63 must be exactly 13 digits.');
        }
      }
    });
  }
}

setupMobileValidation(applicantMobileIndividualInput);
setupMobileValidation(applicantMobileCompanyInput);

// Address validation
const applicantAddress = document.getElementById('applicantAddress');
if (applicantAddress) {
  applicantAddress.addEventListener('blur', (e) => {
    const value = e.target.value.trim();
    if (value && value.length < 15) {
      showAlert('Please provide a more detailed address (at least 15 characters) including street, barangay, city/municipality, and province.', 'warning');
      e.target.value = '';
    }
  });
  
  applicantAddress.addEventListener('input', (e) => {
    // Enforce maximum character limit of 100
    if (e.target.value.length > 100) {
      e.target.value = e.target.value.substring(0, 100);
    }
  });
}

// Search functionality for application map
const appMapSearchBtn = document.getElementById('appMapSearchBtn');
const appMapSearchInput = document.getElementById('appMapSearchInput');

if (appMapSearchBtn && appMapSearchInput) {
  appMapSearchBtn.addEventListener('click', async () => {
    const searchTerm = appMapSearchInput.value.trim();
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
        window.appMap.setView([lat, lon], 13);
        
        // Remove existing marker if any
        if (window.appCurrentMarker) {
          window.appMap.removeLayer(window.appCurrentMarker);
        }
        
        // Add marker at found location
        window.appCurrentMarker = L.marker([lat, lon]).addTo(window.appMap);
        
        // Auto-fill address field
        const addressInput = document.getElementById('applicantAddress');
        addressInput.value = result.display_name || searchTerm;
      } else {
        showAlert('Address not found. Please try a different search term.', 'warning');
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      showAlert('Error searching for address. Please try again.', 'error');
    }
  });
  
  // Allow pressing Enter to search
  appMapSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      appMapSearchBtn.click();
    }
  });
}

// Submit new application - ULTRA FAST: Submit first, upload in background
document.getElementById('newApplicationForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const documentType = document.getElementById('documentType')?.value || '';
  const permitType = document.getElementById('permitType')?.value || '';
  const applicantType = document.querySelector('input[name="applicantType"]:checked')?.value || 'personal';
  const district = document.getElementById('district')?.value || '';
  const municipal = document.getElementById('municipal')?.value || '';
  const barangay = document.getElementById('barangay')?.value || '';
  const streetAddress = document.getElementById('streetAddress')?.value || '';
  const applicantMobile = applicantType === 'personal'
    ? document.getElementById('applicantMobileIndividual')?.value || ''
    : document.getElementById('applicantMobileCompany')?.value || '';
  const applicationDetails = document.getElementById('applicationDetailsInput')?.value || '';
  
  // Construct complete address
  const applicantAddress = `${streetAddress}, ${barangay}, ${municipal}, ${district}`;
  
  // Get applicant name based on type
  let applicantName = '';
  if (applicantType === 'personal') {
    const firstName = document.getElementById('firstName')?.value || '';
    const middleName = document.getElementById('middleName')?.value || '';
    const lastName = document.getElementById('lastName')?.value || '';
    const suffix = document.getElementById('suffix')?.value || '';
    
    let fullName = `${firstName} ${middleName ? middleName + ' ' : ''}${lastName}`.trim();
    if (suffix) {
      fullName += ` ${suffix}`;
    }
    applicantName = fullName;
  } else {
    const companyName = document.getElementById('companyName')?.value || '';
    applicantName = companyName;
  }
  
  // Quick validation
  if (!documentType || !permitType || !applicantName || !applicantAddress || !applicantMobile) {
    showAlert('Please complete all required fields marked with *.', 'warning');
    return;
  }
  
  // Collect files for background upload
  const requirements = PERMIT_REQUIREMENTS[permitType] || [];
  const filesToUpload = [];
  
  // Initialize IndexedDB
  await initEditIndexedDB();
  
  for (let index = 0; index < requirements.length; index++) {
    let file = null;
    
    // Try to get file from sessionStorage first (where it's stored after selection)
    try {
      const storedFileData = sessionStorage.getItem(`docUpload_${index}`);
      if (storedFileData) {
        const fileData = JSON.parse(storedFileData);
        
        // Convert base64 back to File object
        const base64Data = fileData.base64.split(',')[1]; // Remove data URL prefix
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        const blob = new Blob([bytes], { type: fileData.type });
        file = new File([blob], fileData.name, { type: fileData.type, lastModified: fileData.lastModified });
        
        console.log(`Retrieved file ${fileData.name} from sessionStorage for upload`);
      }
    } catch (error) {
      console.error('Error retrieving file from sessionStorage:', error);
    }
    
    // Fallback: Try to get file from input element directly
    if (!file) {
      const uploadField = document.getElementById(`docUpload_${index}`);
      if (uploadField && uploadField.files && uploadField.files[0]) {
        file = uploadField.files[0];
        console.log(`Retrieved file ${file.name} from input element for upload`);
      }
    }
    
    // If we have a file, process it for upload
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        if (typeof showAlert === 'function') {
          showAlert(`File "${file.name}" exceeds ${MAX_FILE_SIZE_MB}MB limit.`, 'warning');
          return;
        }
      }
      
      const fileId = `edit_${Date.now()}_${index}`;
      const appId = window.editingAppId || 'new';
      
      // Store file in IndexedDB for persistence
      try {
        await storeEditFileInIndexedDB(fileId, file, requirements[index], appId);
        filesToUpload.push({ fileId, file, requirement: requirements[index], index });
        console.log(`File ${file.name} prepared for background upload`);
      } catch (dbError) {
        console.error('Failed to store file in IndexedDB:', dbError);
        // Still try to upload directly
        filesToUpload.push({ fileId, file, requirement: requirements[index], index });
      }
    } else {
      console.warn(`No file found for requirement index ${index}: ${requirements[index]}`);
    }
  }
  
  // INSTANT SUBMISSION: Create application immediately
  try {
    const isEditing = window.editingAppId;
    const applicationId = isEditing ? window.editingAppId : `DENR-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${Math.floor(Math.random() * 1000000)}`;
    
    // Preserve existing documents when editing
    let existingDocuments = [];
    if (isEditing && window.existingDocuments) {
      existingDocuments = window.existingDocuments;
      console.log('Preserving existing documents for edit:', existingDocuments);
    }
    
    const applicationData = {
      applicationId,
      applicantUid: auth.currentUser.uid,
      applicantEmail: auth.currentUser.email,
      documentType,
      permitType,
      applicantName,
      applicantAddress,
      applicantMobile,
      applicationDetails,
      documents: existingDocuments, // Start with existing documents, will add new ones in background
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      uploadStatus: filesToUpload.length > 0 ? 'uploading' : 'complete'
    };
    
    // INSTANT: Save to Firestore immediately
    let appRef;
    if (isEditing) {
      appRef = doc(db, 'applications', isEditing);
      console.log('Updating application with ID:', isEditing);
      console.log('Current revision count:', window.editingApplicationData?.revisionCount || 0);
      
      // Explicitly set status to pending when revising
      const currentCount = window.editingApplicationData?.revisionCount || 0;
      const updateData = { 
        ...applicationData, 
        status: 'pending',  // Force status to pending for revised applications
        revisionSubmittedAt: serverTimestamp(),  // Track when revision was submitted
        revisionSubmittedBy: auth.currentUser?.email || 'customer',  // Track who submitted revision
        revisionCount: currentCount + 1,  // Increment revision count when customer submits
        updatedAt: serverTimestamp() 
      };
      
      console.log('Update data being sent:', updateData);
      
      try {
        await updateDoc(appRef, updateData);
        console.log('✅ Application updated successfully with status: pending');
        
        // Verify the update was successful
        const verifyDoc = await getDoc(appRef);
        const verifyData = verifyDoc.data();
        console.log('✅ Verification - Status after update:', verifyData.status);
        console.log('✅ Verification - Revision count:', verifyData.revisionCount);
        
        if (verifyData.status !== 'pending') {
          console.error('❌ Status update failed! Expected: pending, Got:', verifyData.status);
          showAlert('Error: Status update may not have completed. Please refresh and check your application status.', 'error');
        }
      } catch (updateError) {
        console.error('❌ Error updating application:', updateError);
        showAlert('Error updating application: ' + updateError.message, 'error');
        throw updateError;
      }
    } else {
      appRef = await addDoc(collection(db, 'applications'), applicationData);
    }
    
    // INSTANT: Show success and redirect
    if (isEditing) {
      showAlert('Application updated successfully! Status is now pending for review. New documents are being uploaded in background...', 'success');
      // Immediately refresh applications to show updated status
      setTimeout(() => {
        fetchUserApplications();
      }, 1000);
    } else {
      showAlert('Application submitted successfully! Uploading documents in background...', 'success');
    }
    navigateToSection('myApplicationsSection');
    document.getElementById('newApplicationForm').reset();
    clearFormData('newApplicationForm');
    hideCategoryAwarenessBanner();
    hidePermitAwarenessBanner();
    hideRequirementsSection();
    resetFormSteps();
    
    // Clear editing state
    window.editingAppId = null;
    window.existingDocuments = [];
    
    // Reset ALL submit buttons to prevent stuck loading state
    const submitBtns = [
      document.getElementById('submitStep5'),
      document.querySelector('#newApplicationForm button[type="submit"]'),
      document.querySelector('button.submit-btn')
    ];
    
    submitBtns.forEach(btn => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Submit Application';
        btn.classList.remove('loading');
        console.log('Reset submit button:', btn.id || btn.className);
      }
    });
    
    // BACKGROUND: Upload files after redirect with progress indicator
    console.log(`Preparing to upload ${filesToUpload.length} files in background...`);
    if (filesToUpload.length > 0) {
      // Log file details for debugging
      filesToUpload.forEach(({ file, requirement, index }) => {
        console.log(`File ${index + 1}: ${file.name} (${file.size} bytes) - Requirement: ${requirement}`);
      });
      
      // Show upload progress notification
      showUploadProgressNotification(filesToUpload.length);
      backgroundUploadFiles(appRef.id || window.editingAppId, filesToUpload);
    } else {
      console.log('No files to upload - application submitted without files');
    }
    
    // Refresh applications list
    fetchUserApplications();
    
  } catch (error) {
    console.error('Error submitting application:', error);
    showAlert('Error submitting application. Please try again.', 'error');
    // Reset ALL submit buttons on error
    const submitBtns = [
      document.getElementById('submitStep5'),
      document.querySelector('#newApplicationForm button[type="submit"]'),
      document.querySelector('button.submit-btn')
    ];
    
    submitBtns.forEach(btn => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Submit Application';
        btn.classList.remove('loading');
        console.log('Reset submit button on error:', btn.id || btn.className);
      }
    });
  }
});

// Upload progress notification function
function showUploadProgressNotification(fileCount) {
  // Create progress notification element
  const notification = document.createElement('div');
  notification.id = 'uploadProgressNotification';
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 16px 20px;
    border-radius: 12px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    z-index: 10000;
    max-width: 350px;
    animation: slideInRight 0.3s ease-out;
  `;
  
  notification.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <div style="width: 40px; height: 40px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
        <svg style="width: 20px; height: 20px; animation: spin 1s linear infinite;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
      <div style="flex: 1;">
        <div style="font-weight: 600; margin-bottom: 4px;">Uploading Documents</div>
        <div style="font-size: 14px; opacity: 0.9;">${fileCount} file${fileCount > 1 ? 's' : ''} being uploaded in background...</div>
        <div style="margin-top: 8px; background: rgba(255,255,255,0.2); border-radius: 6px; height: 4px; overflow: hidden;">
          <div id="uploadProgressBar" style="height: 100%; background: white; border-radius: 6px; width: 0%; transition: width 0.3s ease;"></div>
        </div>
      </div>
    </div>
  `;
  
  // Add CSS animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInRight {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(notification);
  
  // Auto-remove after 30 seconds (fallback)
  setTimeout(() => {
    const existingNotification = document.getElementById('uploadProgressNotification');
    if (existingNotification) {
      existingNotification.remove();
    }
  }, 30000);
}

// Update upload progress
function updateUploadProgress(percentage, message) {
  const notification = document.getElementById('uploadProgressNotification');
  const progressBar = document.getElementById('uploadProgressBar');
  
  if (notification && progressBar) {
    progressBar.style.width = `${Math.min(percentage, 100)}%`;
    
    // Update message if provided
    if (message) {
      const messageElement = notification.querySelector('div[style*="font-size: 14px"]');
      if (messageElement) {
        messageElement.textContent = message;
      }
    }
    
    // Complete notification
    if (percentage >= 100) {
      setTimeout(() => {
        notification.innerHTML = `
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 40px; height: 40px; background: rgba(34, 197, 94, 0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
              <svg style="width: 20px; height: 20px;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            <div style="flex: 1;">
              <div style="font-weight: 600;">Upload Complete!</div>
              <div style="font-size: 14px; opacity: 0.9;">All documents uploaded successfully</div>
            </div>
          </div>
        `;
        
        // Remove after 3 seconds
        setTimeout(() => notification.remove(), 3000);
      }, 500);
    }
  }
}

// Background file upload function with IndexedDB persistence
async function backgroundUploadFiles(appId, filesToUpload) {
  console.log(`Starting background upload for ${filesToUpload.length} files...`);
  
  // Initialize IndexedDB
  await initEditIndexedDB();
  
  const uploadedDocs = [];
  const failedUploads = [];
  
  // Upload all files in parallel with retry logic and progress tracking
  let completedUploads = 0;
  const totalFiles = filesToUpload.length;
  
  const uploadPromises = filesToUpload.map(async ({ fileId, file, requirement, index }) => {
    try {
      // Update progress
      completedUploads++;
      const progress = (completedUploads / totalFiles) * 100;
      updateUploadProgress(progress, `Uploading ${file.name}...`);
      
      console.log(`Starting upload for ${file.name} (${file.size} bytes)`);
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'denr-permits');
      
      console.log(`Sending upload request for ${file.name}...`);
      const uploadResponse = await fetch('/upload-file-to-cloudinary', {
        method: 'POST',
        body: formData
      });
      
      console.log(`Upload response status for ${file.name}: ${uploadResponse.status}`);
      const uploadResult = await uploadResponse.json();
      console.log(`Upload result for ${file.name}:`, uploadResult);
      
      if (uploadResult.success) {
        // Remove from IndexedDB on success
        await removeEditFileFromIndexedDB(fileId);
        
        return {
          name: file.name,
          type: file.type,
          size: file.size,
          url: uploadResult.url,
          public_id: uploadResult.public_id,
          format: uploadResult.format || file.name.split('.').pop() || 'unknown',
          resource_type: uploadResult.resource_type || 'auto',
          cloudinary: true,
          requirement: requirement
        };
      } else {
        throw new Error(uploadResult.error || 'Upload failed');
      }
    } catch (error) {
      console.error(`Failed to upload ${file.name}:`, error);
      failedUploads.push({ fileId, file, requirement, error: error.message });
      return null;
    }
  });
  
  // Wait for all uploads
  const results = await Promise.all(uploadPromises);
  const successfulUploads = results.filter(doc => doc !== null);
  
  // Final progress update
  if (successfulUploads.length > 0) {
    updateUploadProgress(100, `Successfully uploaded ${successfulUploads.length} of ${totalFiles} files`);
  } else {
    updateUploadProgress(0, 'Upload failed. Files will retry when connection returns.');
  }
  
  // If some uploads failed due to network, they remain in IndexedDB for retry
  if (failedUploads.length > 0) {
    console.log(`${failedUploads.length} files failed to upload. They are stored in IndexedDB for retry.`);
    
    // Show notification to user about pending uploads
    if (typeof showAlert === 'function') {
      showAlert(`${failedUploads.length} file(s) couldn't upload due to connection issues. They will retry automatically when connection returns.`, 'warning');
    }
  }
  
  // Update application with uploaded documents
  if (successfulUploads.length > 0) {
    try {
      const appRef = doc(db, 'applications', appId);
      
      // Get current application to merge documents
      const currentApp = await getDoc(appRef);
      const existingDocs = currentApp.exists() ? (currentApp.data().documents || []) : [];
      
      // Merge existing documents with new uploads
      const allDocuments = [...existingDocs];
      
      // Add new documents, avoiding duplicates by checking file names
      successfulUploads.forEach(newDoc => {
        const isDuplicate = existingDocs.some(existingDoc => 
          existingDoc.name === newDoc.name || 
          (existingDoc.public_id && existingDoc.public_id === newDoc.public_id)
        );
        
        if (!isDuplicate) {
          allDocuments.push(newDoc);
        } else {
          console.log(`Skipping duplicate document: ${newDoc.name}`);
        }
      });
      
      // Determine upload status based on failed uploads
      const uploadStatus = failedUploads.length > 0 ? 'uploading' : 'complete';
      
      await updateDoc(appRef, {
        documents: allDocuments,
        uploadStatus: uploadStatus,
        updatedAt: serverTimestamp()
      });
      console.log(`Background upload: ${successfulUploads.length} new files uploaded, ${failedUploads.length} pending, total: ${allDocuments.length} documents`);
      
      // Refresh applications list so the UI shows the updated documents
      if (typeof fetchUserApplications === 'function') {
        fetchUserApplications();
      }
    } catch (error) {
      console.error('Error updating application with documents:', error);
    }
  }
}

// Retry pending uploads from IndexedDB (called when connection returns)
async function retryPendingEditUploads(appId) {
  if (!isOnline()) return;
  
  console.log(`Checking for pending uploads for app ${appId}...`);
  
  try {
    await initEditIndexedDB();
    const pendingFiles = await getPendingEditFiles(appId);
    
    if (pendingFiles.length === 0) {
      console.log('No pending uploads found');
      return;
    }
    
    console.log(`Found ${pendingFiles.length} pending uploads, retrying...`);
    
    // Convert stored files back to File objects and retry
    const filesToUpload = [];
    
    for (const fileData of pendingFiles) {
      try {
        // Convert data URL back to Blob then File
        const response = await fetch(fileData.blob);
        const blob = await response.blob();
        const file = new File([blob], fileData.fileName, { type: fileData.fileType });
        
        filesToUpload.push({
          fileId: fileData.fileId,
          file,
          requirement: fileData.requirement,
          index: 0
        });
      } catch (error) {
        console.error(`Failed to reconstruct file ${fileData.fileName}:`, error);
        await removeEditFileFromIndexedDB(fileData.fileId);
      }
    }
    
    if (filesToUpload.length > 0) {
      if (typeof showAlert === 'function') {
        showAlert(`Retrying ${filesToUpload.length} pending file upload(s)...`, 'info');
      }
      await backgroundUploadFiles(appId, filesToUpload);
    }
  } catch (error) {
    console.error('Error retrying pending uploads:', error);
  }
}

// Form Data Persistence - Save form values to localStorage
function saveFormData(formId) {
  // Don't save form data if we're in edit mode
  if (window.editingAppId) {
    console.log('Edit mode detected - skipping form data persistence');
    return;
  }
  
  const form = document.getElementById(formId);
  if (!form) return;

  const formData = {};
  const inputs = form.querySelectorAll('input, select, textarea');
  inputs.forEach(input => {
    // Skip file inputs as they are handled separately
    if (input.id && input.type !== 'file') {
      formData[input.id] = input.value;
    }
  });

  localStorage.setItem(formId + '_data', JSON.stringify(formData));
  console.log('Form data saved (excluding files)');
}

// Restore form data from localStorage
function restoreFormData(formId) {
  const savedData = localStorage.getItem(formId + '_data');
  if (!savedData) return;

  try {
    const formData = JSON.parse(savedData);
    const form = document.getElementById(formId);
    if (!form) return;

    Object.keys(formData).forEach(fieldId => {
      const input = document.getElementById(fieldId);
      if (input) {
        // Skip file inputs - browsers don't allow setting their value programmatically
        if (input.type === 'file') return;
        input.value = formData[fieldId];
      }
    });
  } catch (error) {
    console.error('Error restoring form data:', error);
  }
}

// Clear form data from localStorage
function clearFormData(formId) {
  localStorage.removeItem(formId + '_data');
}

// Setup form data persistence for newApplicationForm
const newApplicationForm = document.getElementById('newApplicationForm');
if (newApplicationForm) {
  // Save on input change
  newApplicationForm.addEventListener('input', () => saveFormData('newApplicationForm'));
  newApplicationForm.addEventListener('change', () => saveFormData('newApplicationForm'));

  // Restore on page load
  restoreFormData('newApplicationForm');
}

// Setup form data persistence for verify form
const permitIdInput = document.getElementById('permitIdInput');
if (permitIdInput) {
  permitIdInput.addEventListener('input', () => {
    localStorage.setItem('permitIdInput', permitIdInput.value);
  });

  // Restore on page load
  const savedPermitId = localStorage.getItem('permitIdInput');
  if (savedPermitId) {
    permitIdInput.value = savedPermitId;
  }
}

// Update profile
document.getElementById('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  try {
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (!submitBtn) {
      console.error('Submit button not found');
      return;
    }
    
    const isEditMode = submitBtn.textContent === 'Update Profile';
    
    if (!isEditMode) {
      // Switch to edit mode
      enableProfileEditMode(true);
      return;
    }
    
    // Disable button to prevent multiple clicks
    submitBtn.disabled = true;
    submitBtn.textContent = 'Updating...';
    
    // Save data when in edit mode
    const firstName = document.getElementById('profileFirstName')?.value?.trim() || '';
    const surname = document.getElementById('profileSurname')?.value?.trim() || '';
    const middleName = document.getElementById('profileMiddleName')?.value?.trim() || '';
    const suffix = document.getElementById('profileSuffix')?.value || '';
    const mobile = document.getElementById('profileMobile')?.value?.trim() || '';
    const district = document.getElementById('profileDistrict')?.value || '';
    const municipal = document.getElementById('profileMunicipal')?.value || '';
    const barangay = document.getElementById('profileBarangay')?.value || '';
    const streetAddress = document.getElementById('profileStreetAddress')?.value?.trim() || '';
    const profilePictureInput = document.getElementById('profilePicture');
  
  // Validation
    console.log('Validation check:', { firstName, surname, mobile, district, municipal, barangay, streetAddress });
    
        
    // Clear all error messages first
    clearFieldError('profileFirstName');
    clearFieldError('profileSurname');
    clearFieldError('profileMiddleName');
    clearFieldError('profileMobile');
    clearFieldError('profileDistrict');
    clearFieldError('profileMunicipal');
    clearFieldError('profileBarangay');
    clearFieldError('profileStreetAddress');
    
    let hasErrors = false;
    
    if (!firstName || firstName.trim() === '') {
      console.log('First name validation failed:', firstName);
      showFieldError('profileFirstName', 'Please enter your first name.');
      hasErrors = true;
    }
    
    if (!surname || surname.trim() === '') {
      console.log('Surname validation failed:', surname);
      showFieldError('profileSurname', 'Please enter your surname.');
      hasErrors = true;
    }
    
    if (!middleName || middleName.trim() === '') {
      console.log('Middle name validation failed:', middleName);
      showFieldError('profileMiddleName', 'Please enter your middle name.');
      hasErrors = true;
    }
    
    if (!mobile || mobile.trim() === '') {
      showFieldError('profileMobile', 'Please enter a mobile number.');
      hasErrors = true;
    } else if (mobile.startsWith('09')) {
      if (mobile.length !== 11) {
        showFieldError('profileMobile', 'Mobile number starting with 09 must be 11 digits only.');
        hasErrors = true;
      }
    } else if (mobile.startsWith('63')) {
      if (mobile.length !== 13) {
        showFieldError('profileMobile', 'Mobile number starting with 63 must be 13 digits only.');
        hasErrors = true;
      }
    } else {
      showFieldError('profileMobile', 'Mobile number must start with 09 or 63.');
      hasErrors = true;
    }
    
    // Address validation
    if (!district) {
      showFieldError('profileDistrict', 'Please select a district.');
      hasErrors = true;
    }
    
    if (!municipal) {
      showFieldError('profileMunicipal', 'Please select a municipal.');
      hasErrors = true;
    }
    
    if (!barangay) {
      showFieldError('profileBarangay', 'Please select a barangay.');
      hasErrors = true;
    }
    
    if (!streetAddress) {
      showFieldError('profileStreetAddress', 'Please enter your street address.');
      hasErrors = true;
    }
    
    if (hasErrors) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Update Profile';
      submitBtn.style.background = 'linear-gradient(135deg, #0b5f2c 0%, #0a7a3c 100%)';
      return;
    }
  
  try {
    const updateData = {
      firstName,
      surname,
      middleName,
      suffix,
      mobile,
      district,
      municipal,
      barangay,
      streetAddress,
      address: `${streetAddress}, ${barangay}, ${municipal}, ${district}`,
      updatedAt: serverTimestamp()
    };
    
    console.log('Saving profile data:', updateData);
    console.log('User UID:', auth.currentUser?.uid);
    
    // Handle profile picture upload
    if (profilePictureInput.files && profilePictureInput.files[0]) {
      const file = profilePictureInput.files[0];
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        showAlert('Profile picture must be less than 5MB', 'warning');
        return;
      }
      
      // Upload directly to Cloudinary
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', 'profile-pictures');

        const uploadResponse = await fetch('/upload-file-to-cloudinary', {
          method: 'POST',
          body: formData
        });

        const uploadResult = await uploadResponse.json();
        
        if (uploadResult.success) {
          updateData.profilePicture = uploadResult.url;
          updateData.profilePicturePublicId = uploadResult.public_id;
          await saveProfileData(updateData);
        } else {
          throw new Error(uploadResult.error || 'Upload failed');
        }
      } catch (uploadError) {
        console.error('Profile picture upload error:', uploadError);
        showAlert('Failed to upload profile picture. Please try again.', 'error');
      }
    } else {
      await saveProfileData(updateData);
    }
    
  } catch (error) {
    console.error('Error updating profile:', error);
    showAlert('Error updating profile. Please try again.', 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Update Profile';
  }
  } catch (error) {
    console.error('Form submission error:', error);
    showAlert('An error occurred. Please try again.', 'error');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Update Profile';
    }
  }
});

async function saveProfileData(updateData) {
  try {
    console.log('saveProfileData called with:', updateData);
    const userRef = doc(db, 'users', auth.currentUser.uid);
    console.log('Database reference:', userRef.path);
    
    await updateDoc(userRef, updateData);
    console.log('Database update successful');
    
    // Update local data
    currentUserData = { ...currentUserData, ...updateData };
    console.log('Local data updated:', currentUserData);
    
    updateUserInfo(auth.currentUser, currentUserData);
    showAlert('[SUCCESS] Profile updated successfully!', 'success');
    
    // Return to view mode after successful update
    enableProfileEditMode(false);
    
  } catch (error) {
    console.error('Error in saveProfileData:', error);
    console.error('Error details:', error.code, error.message);
    showAlert('Failed to save profile. Please try again.', 'error');
    
    // Re-enable button on error
    const submitBtn = document.querySelector('#profileForm button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Update Profile';
      submitBtn.style.background = 'linear-gradient(135deg, #0b5f2c 0%, #0a7a3c 100%)';
    }
  }
}

// Page Navigation with Loading Effect
window.navigateToSection = function(sectionId) {
  const pageLoader = document.getElementById('pageLoader');
  const currentSection = document.querySelector('.page-section.active');
  const targetSection = document.getElementById(sectionId);
  
  // Show page loader
  if (pageLoader) {
    pageLoader.classList.add('active');
  }
  
  // Add loading state to nav item
  const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
  if (navItem) {
    navItem.classList.add('loading');
  }
  
  // Exit animation for current section
  if (currentSection) {
    currentSection.classList.add('section-exit');
    currentSection.classList.remove('active');
  }
  
  // Wait for exit animation, then switch sections
  setTimeout(() => {
    // Remove exit class from current section
    if (currentSection) {
      currentSection.classList.remove('section-exit');
    }
    
    // Add enter class to target section
    if (targetSection) {
      targetSection.classList.add('section-enter', 'active');
      
      // Remove enter class after animation
      setTimeout(() => {
        targetSection.classList.remove('section-enter');
      }, 400);
    }
    
    // Hide page loader
    if (pageLoader) {
      pageLoader.classList.remove('active');
    }
    
    // Remove loading state from nav item
    if (navItem) {
      navItem.classList.remove('loading');
    }
    
    // Save current section to localStorage
    localStorage.setItem('currentSection', sectionId);
    
    // Restore form data when navigating to sections with forms
    if (sectionId === 'newApplicationSection') {
      restoreFormData('newApplicationForm');
      const documentTypeField = document.getElementById('documentType');
      const permitTypeField = document.getElementById('permitType');
      const savedPermitFromForm = permitTypeField ? permitTypeField.value : '';
      if (documentTypeField && documentTypeField.value) {
        documentTypeField.dispatchEvent(new Event('change'));
        if (permitTypeField && savedPermitFromForm) {
          permitTypeField.value = savedPermitFromForm;
          permitTypeField.dispatchEvent(new Event('change'));
        }
      } else if (typeof initializeStep1DocumentControls === 'function') {
        initializeStep1DocumentControls();
      }
    }
    
    // Invalidate map size if navigating to new application section
    if (sectionId === 'newApplicationSection' && window.appMap) {
      setTimeout(() => {
        if (typeof window.appMap.invalidateSize === 'function') {
          window.appMap.invalidateSize();
        }
      }, 100);
    }
    
    const pageTitle = document.querySelector('.page-title');
    if (pageTitle) {
      const sectionNames = {
        'dashboardSection': 'Customer Dashboard',
        'myApplicationsSection': 'My Applications',
        'newApplicationSection': 'New Application',
        'profileSection': 'My Profile',
        'settingsSection': 'Settings',
        'helpSection': 'Help & Support'
      };
      pageTitle.textContent = sectionNames[sectionId] || 'Customer Dashboard';
    }
    
    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
      if (item.dataset.section === sectionId) {
        item.classList.add('active');
      }
    });
  }, 300);
};

// Button Loading Helper Functions
window.setButtonLoading = function(button, isLoading) {
  if (!button) return;
  
  if (isLoading) {
    button.classList.add('loading');
    button.disabled = true;
    // Store original text
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
  } else {
    button.classList.remove('loading');
    button.disabled = false;
    // Restore original text
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
    }
  }
};

window.setButtonLoadingWithText = function(button, isLoading, loadingText = 'Loading...') {
  if (!button) return;
  
  if (isLoading) {
    button.classList.add('loading');
    button.disabled = true;
    // Store original text
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
    // Change text temporarily (will be hidden by spinner)
    button.textContent = loadingText;
  } else {
    button.classList.remove('loading');
    button.disabled = false;
    // Restore original text
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
    }
  }
};

// Settings Tab Switching
document.addEventListener('DOMContentLoaded', function() {
  const tabBtns = document.querySelectorAll('.settings-tab-btn');
  const tabPanes = document.querySelectorAll('.settings-tab-pane');
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const tabId = this.getAttribute('data-tab');
      
      // Remove active class from all buttons
      tabBtns.forEach(b => b.classList.remove('active'));
      
      // Add active class to clicked button
      this.classList.add('active');
      
      // Hide all tab panes
      tabPanes.forEach(pane => pane.classList.remove('active'));
      
      // Show target tab pane
      const targetPane = document.getElementById(tabId);
      if (targetPane) {
        targetPane.classList.add('active');
      }
    });
  });
});

// Navigation - wrapped in DOMContentLoaded to ensure DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  // Section to hash mapping (reverse of hashSectionMap)
  const sectionHashMap = {
    'dashboardSection': 'dashboard',
    'newApplicationSection': 'new-application',
    'myApplicationsSection': 'my-applications',
    'profileSection': 'profile',
    'settingsSection': 'settings'
  };
  
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(nav => {
    nav.addEventListener('click', (e) => {
      e.preventDefault();

      navItems.forEach(nav => nav.classList.remove('active'));
      nav.classList.add('active');

      const sectionId = nav.getAttribute('data-section');
      if (sectionId) {
        navigateToSection(sectionId);
        
        // Update URL hash to match section (for back/forward button support)
        const hash = sectionHashMap[sectionId];
        if (hash) {
          window.history.pushState(null, null, '#' + hash);
        }
      }
    });
  });

  // Logo click handler - navigate to dashboard
  const logoLink = document.querySelector('.logo-link');
  if (logoLink) {
    logoLink.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToSection('dashboardSection');
      window.history.pushState(null, null, '#dashboard');
    });
  }
});

// Restore saved section and form data on page load (for refresh/reload behavior)
window.addEventListener('load', function() {
  // Clear existing upload backups from localStorage on page load to free up space
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('docUpload_')) {
        sessionStorage.removeItem(key);
      }
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('docUpload_')) {
        localStorage.removeItem(key);
      }
    }
    console.log('Cleared old document uploads from storage');
  } catch (e) {
    console.log('Error clearing old uploads:', e);
  }
  
  // Hash to section mapping for URL-based navigation
  const hashSectionMap = {
    'dashboard': 'dashboardSection',
    'new-application': 'newApplicationSection',
    'my-applications': 'myApplicationsSection',
    'profile': 'profileSection',
    'settings': 'settingsSection'
  };
  
  // Check URL hash first, then fall back to localStorage
  const hash = window.location.hash.replace('#', '');
  const sectionFromHash = hashSectionMap[hash];
  
  if (sectionFromHash) {
    // URL has a valid section hash - navigate there
    navigateToSection(sectionFromHash);
  } else {
    // No hash or invalid hash - use saved section or default
    const savedSection = localStorage.getItem('currentSection');
    if (savedSection) {
      navigateToSection(savedSection);
    } else {
      navigateToSection('dashboardSection');
    }
  }
  
  // Handle hash changes (when user clicks nav links or uses back/forward buttons)
  window.addEventListener('hashchange', function() {
    const newHash = window.location.hash.replace('#', '');
    const newSection = hashSectionMap[newHash];
    if (newSection) {
      navigateToSection(newSection);
    }
  });

  // Restore selected document type and permit type
  const savedDocumentType = localStorage.getItem('selectedDocumentType');
  const savedPermitType = localStorage.getItem('selectedPermitType');

  if (savedDocumentType && documentTypeSelect) {
    documentTypeSelect.value = savedDocumentType;
    // Trigger change event to populate permit type options
    documentTypeSelect.dispatchEvent(new Event('change'));

    // After options are populated, restore permit type
    setTimeout(() => {
      if (savedPermitType && permitTypeSelect) {
        permitTypeSelect.value = savedPermitType;
        permitTypeSelect.dispatchEvent(new Event('change'));
      }

      // Restore uploaded files status and actual files
      setTimeout(() => {
        const requirements = PERMIT_REQUIREMENTS[savedPermitType] || [];
        requirements.forEach((req, index) => {
          // Try to restore from sessionStorage first, then localStorage backup
          const preview = document.getElementById(`docUpload_${index}_preview`);
          const filenameSpan = document.getElementById(`docUpload_${index}_filename`);
          const fileInput = document.getElementById(`docUpload_${index}`);
          const dropzone = document.getElementById(`dropzone_${index}`);

          // Try sessionStorage first
          const sessionStorageData = sessionStorage.getItem(`docUpload_${index}`);
          if (sessionStorageData) {
            try {
              const fileData = JSON.parse(sessionStorageData);
              if (fileData.base64) {
                // File found in sessionStorage - restore it
                const fileDataForRestore = {
                  name: fileData.name,
                  size: fileData.size,
                  type: fileData.type,
                  data: fileData.base64
                };
                restoreFileFromFileData(fileDataForRestore, preview, filenameSpan, fileInput, dropzone, 'sessionStorage');
                console.log(`File ${fileData.name} restored from sessionStorage`);
                return; // Success, exit early
              }
            } catch (error) {
              console.error('Error restoring from sessionStorage:', error);
            }
          }

          // Try localStorage backup
          const localStorageData = localStorage.getItem(`docUpload_${index}_backup`);
          if (localStorageData) {
            try {
              const fileData = JSON.parse(localStorageData);
              if (fileData.base64) {
                // File found in localStorage - restore it
                const fileDataForRestore = {
                  name: fileData.name,
                  size: fileData.size,
                  type: fileData.type,
                  data: fileData.base64
                };
                restoreFileFromFileData(fileDataForRestore, preview, filenameSpan, fileInput, dropzone, 'localStorage backup');
                console.log(`File ${fileData.name} restored from localStorage backup`);
                return; // Success, exit early
              }
            } catch (error) {
              console.error('Error restoring from localStorage backup:', error);
            }
          }

          // Try old localStorage format
          const oldLocalStorageData = localStorage.getItem(`docUpload_${index}`);
          if (oldLocalStorageData) {
            try {
              const fileData = JSON.parse(oldLocalStorageData);
              if (fileData.base64) {
                // File found in old localStorage - restore it
                const fileDataForRestore = {
                  name: fileData.name,
                  size: fileData.size,
                  type: fileData.type,
                  data: fileData.base64
                };
                restoreFileFromFileData(fileDataForRestore, preview, filenameSpan, fileInput, dropzone, 'localStorage');
                console.log(`File ${fileData.name} restored from old localStorage`);
                return; // Success, exit early
              } else {
                // Old format - only metadata
                showFileRemovedMessage(fileData.name, preview, filenameSpan, dropzone);
              }
            } catch (error) {
              console.error('Error restoring from old localStorage:', error);
            }
          }

          // No file found in any storage
          console.log(`No file found for docUpload_${index} in any storage`);
          showFileErrorMessage(preview, filenameSpan, dropzone);
        });
      }, 200);
    }, 100);
  }
});
