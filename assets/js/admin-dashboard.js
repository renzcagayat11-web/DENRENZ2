import { auth, db } from './firebase-config.js';
import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  getIdToken,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  limit,
  where,
  getDoc,
  doc,
  updateDoc,
  serverTimestamp,
  addDoc,
  deleteDoc,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const API_BASE = 'http://127.0.0.1:3000';

let allApplications = [];

// Sidebar Toggle Function
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.querySelector('.main-content');
  
  if (sidebar.classList.contains('collapsed')) {
    sidebar.classList.remove('collapsed');
    mainContent.classList.remove('expanded');
    localStorage.setItem('sidebarCollapsed', 'false');
  } else {
    sidebar.classList.add('collapsed');
    mainContent.classList.add('expanded');
    localStorage.setItem('sidebarCollapsed', 'true');
  }
}

// Restore sidebar state on page load
document.addEventListener('DOMContentLoaded', function() {
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.querySelector('.main-content');
  const sidebarState = localStorage.getItem('sidebarCollapsed');
  
  if (sidebarState === 'true') {
    sidebar.classList.add('collapsed');
    mainContent.classList.add('expanded');
  }
});

// Format file size for display
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Audit Logging Function - Comprehensive
async function logAudit(action, details = '', category = 'user', resourceId = null, beforeData = null, afterData = null, status = 'success') {
  try {
    const user = auth.currentUser;
    if (!user) return;
    
    const auditData = {
      timestamp: serverTimestamp(),
      userId: user.uid,
      user: user.displayName || user.email || 'Unknown',
      email: user.email || 'Unknown',
      action: action,
      details: details,
      category: category,
      resourceId: resourceId,
      beforeData: beforeData,
      afterData: afterData,
      status: status,
      ip: await getClientIP(),
      userAgent: navigator.userAgent,
      module: window.location.pathname
    };
    
    await addDoc(collection(db, 'auditLogs'), auditData);
    console.log('Audit log saved:', auditData);
  } catch (error) {
    console.error('Error saving audit log:', error);
  }
}

// Download document function - Enhanced for auto-download
window.downloadDocument = function(url, filename) {
  try {
    // Handle Cloudinary URLs for proper download
    let downloadUrl = url;
    
    // Check if it's a Cloudinary URL and add download parameter
    if (url.includes('cloudinary.com')) {
      // For Cloudinary URLs, we need to modify them to force download
      if (url.includes('/upload/')) {
        // Replace /upload/ with /upload/fl_attachment/ to force download
        downloadUrl = url.replace('/upload/', '/upload/fl_attachment/');
      }
      // For raw files, ensure proper download handling
      if (url.includes('/raw/upload/')) {
        downloadUrl = url.replace('/raw/upload/', '/raw/upload/fl_attachment/');
      }
      // Add additional parameters for better download handling
      if (!downloadUrl.includes('fl_attachment')) {
        downloadUrl += downloadUrl.includes('?') ? '&fl_attachment=true' : '?fl_attachment=true';
      }
    }
    
    // Create a temporary anchor element for download
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename || 'document';
    link.style.display = 'none';
    link.target = '_blank'; // Ensure it doesn't navigate away
    
    // Set additional attributes for better download behavior
    link.setAttribute('download', filename || 'document');
    link.setAttribute('rel', 'noopener noreferrer');
    
    // Append to body, click, and remove
    document.body.appendChild(link);
    link.click();
    
    // Remove the link after a short delay to ensure download starts
    setTimeout(() => {
      document.body.removeChild(link);
    }, 100);
    
    console.log('📥 Auto-download initiated for:', filename);
    console.log('📥 Original URL:', url);
    console.log('📥 Download URL:', downloadUrl);
    
    // Show success feedback
    showDownloadFeedback(filename, 'success');
    
  } catch (error) {
    console.error('❌ Download failed:', error);
    showDownloadFeedback(filename, 'error');
    
    // Fallback: try opening in new tab if download fails
    window.open(url, '_blank');
  }
};

// Show download feedback
function showDownloadFeedback(filename, status) {
  // Remove any existing feedback
  const existingFeedback = document.querySelector('.download-feedback');
  if (existingFeedback) {
    existingFeedback.remove();
  }
  
  // Create feedback element
  const feedback = document.createElement('div');
  feedback.className = 'download-feedback';
  feedback.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    font-weight: 600;
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
    ${status === 'success' ? 
      'background: #10b981; color: white;' : 
      'background: #ef4444; color: white;'
    }
  `;
  
  feedback.innerHTML = status === 'success' ? 
    `📥 Downloading: ${filename}` : 
    `❌ Download failed: ${filename}`;
  
  // Add animation styles if not already present
  if (!document.querySelector('#download-feedback-styles')) {
    const style = document.createElement('style');
    style.id = 'download-feedback-styles';
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(feedback);
  
  // Remove feedback after 3 seconds
  setTimeout(() => {
    if (feedback.parentNode) {
      feedback.remove();
    }
  }, 3000);
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

// Check authentication and role on page load
onAuthStateChanged(auth, async (user) => {
  if (user) {
    console.log('Admin dashboard: User authenticated, checking role...');
    console.log('🔍 ADMIN DASHBOARD DEBUG: User logged in, TEMPORARILY SKIPPING ROLE VERIFICATION');
    
    // TEMPORARILY SKIP ROLE VERIFICATION FOR TESTING
    try {
      // Get user role from token instead of backend call
      const idTokenResult = await user.getIdTokenResult(true);
      const role = idTokenResult.claims.role || 'admin'; // Default to admin for testing
      console.log('🔍 ADMIN DASHBOARD DEBUG: Role from token:', role);
      
      if (role === 'admin') {
        console.log('🔍 ADMIN DASHBOARD DEBUG: Role verified, loading dashboard');
        // Log successful login
        // await logAudit('User Login', `Admin logged in successfully`, 'user', user.uid, null, null, 'success');
        loadDashboardData();
        updateUserInfo(user, { role });
      } else {
        console.log('🔍 ADMIN DASHBOARD DEBUG: Invalid role, would redirect to index');
        // await logAudit('User Login', `Non-admin user attempted access`, 'user', user.uid, null, null, 'failure');
        // alert('Access denied. Admin role required.');
        // auth.signOut();
        // window.location.href = 'index.html';
      }
    } catch (error) {
      console.error('🔍 ADMIN DASHBOARD DEBUG: Token verification failed:', error);
      console.log('🔍 ADMIN DASHBOARD DEBUG: Would redirect to index, but DISABLED FOR TESTING');
      // alert('Authentication failed. Please try logging in again.');
      // auth.signOut();
      // window.location.href = 'index.html';
    }
  } else {
    console.log('Admin dashboard: No user authenticated, redirecting...');
    window.location.href = 'index.html';
  }
});

// Update user info in header
function updateUserInfo(user, userData) {
  const userName = document.getElementById('userName');
  const userRole = document.getElementById('userRole');
  const welcomeName = document.getElementById('welcomeName');
  
  const displayName = user.displayName || user.email.split('@')[0];
  const roleDisplay = userData.role ? userData.role.charAt(0).toUpperCase() + userData.role.slice(1) : 'Staff';
  
  if (userName) userName.textContent = displayName;
  if (userRole) userRole.textContent = roleDisplay;
  if (welcomeName) welcomeName.textContent = displayName;
}

// Load dashboard data
async function loadDashboardData() {
  try {
    // Fetch statistics from Firestore
    await updateStats();
    
    // Fetch recent applications from Firestore
    try {
      await fetchRecentApplications();
    } catch (err) {
      console.warn('Could not fetch applications from Firestore');
    }
    
    // Update current date
    updateCurrentDate();
    
  } catch (error) {
    console.error('Error loading dashboard data:', error);
  }
}

// Update statistics with real-time updates
async function updateStats() {
  try {
    console.log('🔍 ADMIN STATS DEBUG: Setting up real-time listener for applications...');
    const applicationsRef = collection(db, 'applications');
    const q = query(applicationsRef);
    
    // Set up real-time listener for stats
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      console.log('🔍 ADMIN STATS DEBUG: Received data update, snapshot size:', querySnapshot.size);
      let applications = [];
      querySnapshot.forEach((doc) => {
        const appData = doc.data();
        console.log('🔍 ADMIN STATS DEBUG: Application found:', {
          id: doc.id,
          status: appData.status,
          applicantEmail: appData.applicantEmail,
          createdAt: appData.createdAt
        });
        applications.push({
          id: doc.id,
          ...appData
        });
      });
      
      console.log('🔍 ADMIN STATS DEBUG: Total applications loaded:', applications.length);
      console.log('🔍 ADMIN STATS DEBUG: Application statuses:', applications.map(app => ({ id: app.id, status: app.status })));
      
      const totalApps = document.getElementById('totalApps');
      const summaryTotal = document.getElementById('summaryTotal');
      const summaryPending = document.getElementById('summaryPending');
      const summaryApproved = document.getElementById('summaryApproved');
      const summaryRejected = document.getElementById('summaryRejected');
      
      const total = applications.length;
      const pending = applications.filter(app => app.status === 'pending').length;
      const underReview = applications.filter(app => app.status === 'under review').length;
      const approved = applications.filter(app => app.status === 'approved').length;
      const rejected = applications.filter(app => app.status === 'rejected').length;
      
      console.log('🔍 ADMIN STATS DEBUG: Calculated counts:', {
        total,
        pending,
        underReview,
        approved,
        rejected
      });
      
      if (totalApps) totalApps.textContent = total;
      if (summaryTotal) summaryTotal.textContent = total;
      if (summaryPending) summaryPending.textContent = pending;
      if (summaryApproved) summaryApproved.textContent = approved;
      if (summaryRejected) summaryRejected.textContent = rejected;
      
      console.log('🔍 ADMIN STATS DEBUG: Updated UI elements:', {
        totalApps: totalApps?.textContent,
        summaryTotal: summaryTotal?.textContent,
        summaryPending: summaryPending?.textContent,
        summaryApproved: summaryApproved?.textContent,
        summaryRejected: summaryRejected?.textContent
      });
      
      // Update summary card sub-texts with real-time data
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTimestamp = new Date(today);
      
      const todayApplications = applications.filter(app => {
        const appDate = app.createdAt?.toDate ? app.createdAt.toDate() : new Date(app.createdAt);
        return appDate >= todayTimestamp;
      }).length;
      
      // Update "0 today" text
      const totalSub = document.querySelector('.summary-card.blue .summary-sub');
      if (totalSub) {
        totalSub.textContent = `${todayApplications} today`;
      }
      
      // Update "10 pending, 1 under review" text
      const pendingSub = document.querySelector('.summary-card.yellow .summary-sub');
      if (pendingSub) {
        pendingSub.textContent = `${pending} pending, ${underReview} under review`;
      }
      
      // Calculate and update approval rate
      const approvalRate = total > 0 ? ((approved / total) * 100).toFixed(1) : '0';
      const approvedSub = document.querySelector('.summary-card.green .summary-sub');
      if (approvedSub) {
        approvedSub.textContent = `${approvalRate}% approval rate`;
      }
      
      // Calculate and update rejection rate
      const rejectionRate = total > 0 ? ((rejected / total) * 100).toFixed(1) : '0';
      const rejectedSub = document.querySelector('.summary-card.red .summary-sub');
      if (rejectedSub) {
        rejectedSub.textContent = `${rejectionRate}% rejection rate`;
      }
      
      // Update detailed statistics table
      const pendingCount = document.getElementById('pendingCount');
      const pendingPercent = document.getElementById('pendingPercent');
      const underReviewCount = document.getElementById('underReviewCount');
      const underReviewPercent = document.getElementById('underReviewPercent');
      const approvedCount = document.getElementById('approvedCount');
      const approvedPercent = document.getElementById('approvedPercent');
      const rejectedCount = document.getElementById('rejectedCount');
      const rejectedPercent = document.getElementById('rejectedPercent');
      
      if (pendingCount) pendingCount.textContent = pending;
      if (underReviewCount) underReviewCount.textContent = underReview;
      if (approvedCount) approvedCount.textContent = approved;
      if (rejectedCount) rejectedCount.textContent = rejected;
      
      // Calculate percentages
      const pendingPercentage = total > 0 ? ((pending / total) * 100).toFixed(1) : '0';
      const underReviewPercentage = total > 0 ? ((underReview / total) * 100).toFixed(1) : '0';
      const approvedPercentage = total > 0 ? ((approved / total) * 100).toFixed(1) : '0';
      const rejectedPercentage = total > 0 ? ((rejected / total) * 100).toFixed(1) : '0';
      
      if (pendingPercent) pendingPercent.textContent = pendingPercentage + '%';
      if (underReviewPercent) underReviewPercent.textContent = underReviewPercentage + '%';
      if (approvedPercent) approvedPercent.textContent = approvedPercentage + '%';
      if (rejectedPercent) rejectedPercent.textContent = rejectedPercentage + '%';
      
      // Update other dashboard elements
      loadRecentApplications();
      loadApplicationsTable();
      updatePermitAnalysis(applications);
    });
    
    // Store unsubscribe function for cleanup
    window.adminStatsUnsubscribe = unsubscribe;
    
  } catch (error) {
    console.error('Error setting up admin stats listener:', error);
  }
}

// Update Detailed Permit Type Analysis
function updatePermitAnalysis(applications) {
  const tbody = document.getElementById('permitAnalysis');
  if (!tbody) return;
  
  // Group by permit type
  const permitTypes = {};
  applications.forEach(app => {
    const type = app.permitType || 'Unknown';
    if (!permitTypes[type]) {
      permitTypes[type] = { total: 0, approved: 0, rejected: 0, pending: 0, underReview: 0 };
    }
    permitTypes[type].total++;
    if (app.status === 'approved') permitTypes[type].approved++;
    else if (app.status === 'rejected') permitTypes[type].rejected++;
    else if (app.status === 'pending') permitTypes[type].pending++;
    else if (app.status === 'under review') permitTypes[type].underReview++;
  });
  
  tbody.innerHTML = '';
  
  Object.keys(permitTypes).forEach(type => {
    const data = permitTypes[type];
    const approvalRate = data.total > 0 ? ((data.approved / data.total) * 100).toFixed(1) : '0';
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${type}</td>
      <td>${data.total}</td>
      <td>${data.approved}</td>
      <td>${data.rejected}</td>
      <td>${data.pending}</td>
      <td>${data.underReview}</td>
      <td>${approvalRate}%</td>
    `;
    tbody.appendChild(row);
  });
  
  if (Object.keys(permitTypes).length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:#666;">No permit data available</td></tr>';
  }
}

// Fetch recent applications from Firestore
async function fetchRecentApplications() {
  const tbody = document.getElementById('recentApplications');
  if (!tbody) return;
  
  try {
    const applicationsRef = collection(db, 'applications');
    const q = query(applicationsRef);
    const querySnapshot = await getDocs(q);
    
    tbody.innerHTML = '';
    
    if (querySnapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px; color:#666;">No applications found</td></tr>';
      return;
    }
    
    let applications = [];
    querySnapshot.forEach((doc) => {
      applications.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Sort by createdAt manually and limit to 5 for dashboard summary
    applications.sort((a, b) => {
      const aTime = a.createdAt?.toMillis() || 0;
      const bTime = b.createdAt?.toMillis() || 0;
      return bTime - aTime;
    });
    
    // Show only 5 most recent applications in dashboard
    const recentApplications = applications.slice(0, 5);
    
    recentApplications.forEach((app) => {
      const row = document.createElement('tr');
      
      const statusClass = getStatusClass(app.status);
      const dateFormatted = formatDate(app.createdAt);
      
      row.innerHTML = `
        <td>${app.applicationId || 'N/A'}</td>
        <td>${app.applicantName || 'N/A'}</td>
        <td>${app.permitType || 'N/A'}</td>
        <td>${dateFormatted}</td>
        <td><span class="status-badge ${statusClass}">${app.status || 'PENDING'}</span></td>
      `;
      
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Error fetching applications:', error);
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px; color:#666;">Error loading applications</td></tr>';
  }
}

// Load recent applications for dashboard
function loadRecentApplications() {
  fetchRecentApplications();
}

// Load applications table for dashboard
function loadApplicationsTable() {
  const tbody = document.getElementById('applicationsTable');
  if (!tbody) return;
  
  // Reuse the existing applications data from allApplications array
  if (allApplications.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#666;">No applications found</td></tr>';
    return;
  }
  
  tbody.innerHTML = '';
  
  // Display first 5 applications for dashboard table
  const dashboardApps = allApplications.slice(0, 5);
  
  dashboardApps.forEach((app) => {
    const row = document.createElement('tr');
    
    const statusClass = getStatusClass(app.status);
    const dateFormatted = formatDate(app.createdAt);
    
    row.innerHTML = `
      <td>${app.applicationId || 'N/A'}</td>
      <td>${app.applicantName || 'N/A'}</td>
      <td>${app.permitType || 'N/A'}</td>
      <td>${dateFormatted}</td>
      <td><span class="status-badge ${statusClass}">${app.status || 'PENDING'}</span></td>
      <td>
        <div class="table-actions">
          <button class="btn-action view" onclick="viewApplication('${app.id}')">View</button>
        </div>
      </td>
    `;
    
    tbody.appendChild(row);
  });
}

// Load sample applications for demo mode
function loadSampleApplications(tbody) {
  const sampleApps = [
    { id: 'DENR-20260424-502361', name: 'CAGAYAT LORENCE', type: 'Wildlife Permit', date: 'Apr 24, 2026 12:00 AM', status: 'PENDING' },
    { id: 'DENR-20260424-502362', name: 'SANTOS MARIA', type: 'Tree Cutting Permit', date: 'Apr 24, 2026 11:30 PM', status: 'PENDING' },
    { id: 'DENR-20260424-502363', name: 'REYES JUAN', type: 'Mining Permit', date: 'Apr 24, 2026 10:15 AM', status: 'UNDER REVIEW' },
    { id: 'DENR-20260423-502360', name: 'GARCIA ANA', type: 'Tree Planting Permit', date: 'Apr 23, 2026 3:45 PM', status: 'APPROVED' },
  ];
  
  tbody.innerHTML = '';
  sampleApps.forEach(app => {
    const row = document.createElement('tr');
    const statusClass = getStatusClass(app.status);
    row.innerHTML = `
      <td>${app.id}</td>
      <td>${app.name}</td>
      <td>${app.type}</td>
      <td>${app.date}</td>
      <td><span class="status-badge ${statusClass}">${app.status}</span></td>
    `;
    tbody.appendChild(row);
  });
}

// Get CSS class for status
function getStatusClass(status) {
  const statusMap = {
    'pending': 'pending',
    'under review': 'under-review',
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

// Update current date
function updateCurrentDate() {
  const currentDate = document.getElementById('currentDate');
  if (currentDate) {
    const now = new Date();
    currentDate.textContent = now.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }
}

// Logout functionality
const logoutBtn = document.getElementById('logoutBtn');
const logoutModal = document.getElementById('logoutModal');
const logoutModalCloseBtn = document.getElementById('logoutModalCloseBtn');
const cancelLogout = document.getElementById('cancelLogout');
const confirmLogout = document.getElementById('confirmLogout');

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    logoutModal.style.display = 'flex';
  });
}

if (logoutModalCloseBtn) {
  logoutModalCloseBtn.addEventListener('click', () => {
    logoutModal.style.display = 'none';
  });
}

if (cancelLogout) {
  cancelLogout.addEventListener('click', () => {
    logoutModal.style.display = 'none';
  });
}

if (confirmLogout) {
  confirmLogout.addEventListener('click', async () => {
    try {
      await logAudit('User Logout', 'User logged out manually', 'user', auth.currentUser?.uid, null, null, 'success');
      await signOut(auth);
      logoutModal.style.display = 'none';
      window.location.href = 'index.html';
    } catch (error) {
      console.error('Logout error:', error);
    }
  });
}

// Close modal when clicking overlay
if (logoutModal) {
  logoutModal.querySelector('.modal-overlay')?.addEventListener('click', () => {
    logoutModal.style.display = 'none';
  });
}

// Staff account creation modal
const createStaffModal = document.getElementById('createStaffModal');
const closeStaffModal = document.getElementById('closeStaffModal');
const closeAppModal = document.getElementById('closeAppModal');
const closeViewUserModal = document.getElementById('closeViewUserModal');
const closeDeactivateModal = document.getElementById('closeDeactivateModal');
const createStaffForm = document.getElementById('createStaffForm');
const applicationModal = document.getElementById('applicationModal');
const viewUserModal = document.getElementById('viewUserModal');
const deactivateUserModal = document.getElementById('deactivateUserModal');

// Open staff modal (can be triggered from Manage Users section)
function openCreateStaffModal() {
  if (createStaffModal) {
    createStaffModal.style.display = 'flex';
  }
}

// Close staff modal
if (closeStaffModal) {
  closeStaffModal.addEventListener('click', () => {
    if (createStaffModal) {
      createStaffModal.style.display = 'none';
    }
  });
}

// Close application modal
if (closeAppModal) {
  closeAppModal.addEventListener('click', () => {
    if (applicationModal) {
      applicationModal.style.display = 'none';
    }
  });
}

// Close view user modal
if (closeViewUserModal) {
  closeViewUserModal.addEventListener('click', () => {
    if (viewUserModal) {
      viewUserModal.style.display = 'none';
    }
  });
}

// Close deactivate modal
if (closeDeactivateModal) {
  closeDeactivateModal.addEventListener('click', () => {
    if (deactivateUserModal) {
      deactivateUserModal.style.display = 'none';
    }
  });
}

// Close modal when clicking outside
if (createStaffModal) {
  createStaffModal.addEventListener('click', (e) => {
    if (e.target === createStaffModal) {
      createStaffModal.style.display = 'none';
    }
  });
}

if (applicationModal) {
  applicationModal.addEventListener('click', (e) => {
    if (e.target === applicationModal) {
      applicationModal.style.display = 'none';
    }
  });
}

if (viewUserModal) {
  viewUserModal.addEventListener('click', (e) => {
    if (e.target === viewUserModal) {
      viewUserModal.style.display = 'none';
    }
  });
}

if (deactivateUserModal) {
  deactivateUserModal.addEventListener('click', (e) => {
    if (e.target === deactivateUserModal) {
      deactivateUserModal.style.display = 'none';
    }
  });
}

// Handle staff account creation
if (createStaffForm) {
  createStaffForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('staffEmail').value;
    const password = document.getElementById('staffPassword').value;
    const displayName = document.getElementById('staffName').value;
    
    try {
      const idToken = await getIdToken(auth.currentUser);
      
      const response = await fetch(`${API_BASE}/admin/createStaff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          email,
          password,
          displayName
        })
      });
      
      if (response.ok) {
        await logAudit('Staff Account Created', `Created staff account for: ${email}`, 'user', email, null, { email, displayName }, 'success');
        alert('Staff account created successfully!');
        createStaffForm.reset();
        createStaffModal.style.display = 'none';
      } else {
        const error = await response.json();
        await logAudit('Staff Account Creation Failed', `Failed to create account for: ${email} - ${error.error}`, 'user', email, null, { error: error.error }, 'failure');
        alert('Error creating staff account: ' + error.error);
      }
    } catch (error) {
      console.error('Error creating staff:', error);
      alert('Error creating staff account. Please try again.');
    }
  });
}

// Navigation handling
const navItems = document.querySelectorAll('.nav-item');
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    
    // Remove active class from all items
    navItems.forEach(nav => nav.classList.remove('active'));
    
    // Add active class to clicked item
    item.classList.add('active');
    
    // Get the section to show
    const sectionId = item.getAttribute('data-section');
    if (sectionId) {
      navigateToSection(sectionId);
    }
  });
});

// Page navigation function
window.navigateToSection = function(sectionId) {
  // Hide all sections
  document.querySelectorAll('.page-section').forEach(section => {
    section.classList.remove('active');
  });
  
  // Show target section
  const targetSection = document.getElementById(sectionId);
  if (targetSection) {
    targetSection.classList.add('active');
    
    // Track page access
    trackPageAccess(sectionId);
    
    // Load data for the section
    if (sectionId === 'applicationsSection') {
      loadAllApplications();
    } else if (sectionId === 'usersSection') {
      loadUsers('staff');
    } else if (sectionId === 'reportsSection') {
      loadReports();
    } else if (sectionId === 'contentSection') {
      loadContentManagement();
    } else if (sectionId === 'settingsSection') {
      setupSettingsTabs();
    } else if (sectionId === 'auditSection') {
      loadAuditLogs();
    }
  }
  
  // Update page title
  const pageTitle = document.querySelector('.page-title');
  if (pageTitle) {
    const sectionNames = {
      'dashboardSection': 'Dashboard',
      'applicationsSection': 'Applications',
      'recordsSection': 'Records',
      'usersSection': 'Manage Users',
      'reportsSection': 'Reports',
      'contentSection': 'Content Management',
      'settingsSection': 'Settings',
      'auditSection': 'Audit Logs'
    };
    pageTitle.textContent = sectionNames[sectionId] || 'Dashboard';
  }
};

// Load all applications for Applications section with 5-row scroll limit
async function loadAllApplications() {
  const tbody = document.getElementById('allApplicationsTable');
  const visibleCountEl = document.getElementById('visibleCount');
  const totalCountEl = document.getElementById('totalCount');
  
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px;">Loading applications...</td></tr>';
  
  try {
    const applicationsRef = collection(db, 'applications');
    const q = query(applicationsRef);
    const querySnapshot = await getDocs(q);
    
    tbody.innerHTML = '';
    
    if (querySnapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#666;">No applications found</td></tr>';
      if (visibleCountEl) visibleCountEl.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = '0';
      return;
    }
    
    allApplications = [];
    querySnapshot.forEach((doc) => {
      const app = {
        id: doc.id,
        ...doc.data()
      };
      // Include all applications for the modern table
      allApplications.push(app);
    });
    
    // Sort by createdAt manually (newest first)
    allApplications.sort((a, b) => {
      const aTime = a.createdAt?.toMillis() || 0;
      const bTime = b.createdAt?.toMillis() || 0;
      return bTime - aTime;
    });
    
    // Update table info
    const visibleCount = Math.min(5, allApplications.length);
    if (visibleCountEl) visibleCountEl.textContent = visibleCount;
    if (totalCountEl) totalCountEl.textContent = allApplications.length;
    
    if (allApplications.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#666;">No applications found</td></tr>';
      return;
    }
    
    // Display all applications (table will show 5 with scroll)
    allApplications.forEach((app) => {
      const row = document.createElement('tr');
      
      const statusClass = getStatusClass(app.status);
      const dateFormatted = formatDate(app.createdAt);
      
      row.innerHTML = `
        <td>${app.applicationId || 'N/A'}</td>
        <td>${app.applicantName || 'N/A'}</td>
        <td>${app.permitType || 'N/A'}</td>
        <td>${dateFormatted}</td>
        <td><span class="status-badge ${statusClass}">${app.status || 'PENDING'}</span></td>
        <td>
          <div class="table-actions">
            <button class="btn-action view" onclick="viewApplication('${app.id}')">View</button>
          </div>
        </td>
      `;
      
      tbody.appendChild(row);
    });
    
    // Add scroll indicator if more than 5 applications
    if (allApplications.length > 5) {
      const scrollIndicator = document.createElement('div');
      scrollIndicator.className = 'scroll-indicator';
      scrollIndicator.innerHTML = `
        <div class="scroll-info">
          <span>📜 Scroll down to see ${allApplications.length - 5} more applications</span>
        </div>
      `;
      
      const tableContainer = document.querySelector('.table-scroll-container');
      if (tableContainer && !tableContainer.querySelector('.scroll-indicator')) {
        tableContainer.appendChild(scrollIndicator);
      }
    }
  } catch (error) {
    console.error('Error loading applications:', error);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#ef4444;">Error loading applications</td></tr>';
    if (visibleCountEl) visibleCountEl.textContent = '0';
    if (totalCountEl) totalCountEl.textContent = '0';
  }
}

// Edit application details
window.editApplication = async function(appId) {
  let app = allApplications.find(a => a.id === appId);
  
  // If not found in local array, fetch from Firestore
  if (!app) {
    try {
      const docRef = doc(db, 'applications', appId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        app = {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        alert('Application not found');
        return;
      }
    } catch (error) {
      console.error('Error fetching application:', error);
      alert('Error loading application');
      return;
    }
  }
  
  // Show edit modal or navigate to edit page
  showApplicationEditModal(app);
};

// Show application edit modal
function showApplicationEditModal(app) {
  // Create modal if it doesn't exist
  let modal = document.getElementById('editApplicationModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'editApplicationModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Edit Application</h3>
          <button class="modal-close" onclick="closeEditApplicationModal()">&times;</button>
        </div>
        <div class="modal-body">
          <form id="editApplicationForm">
            <div class="form-group">
              <label>Application ID</label>
              <input type="text" id="editApplicationId" readonly>
            </div>
            <div class="form-group">
              <label>Applicant Name</label>
              <input type="text" id="editApplicantName">
            </div>
            <div class="form-group">
              <label>Permit Type</label>
              <select id="editPermitType">
                <option value="Mining Permit">Mining Permit</option>
                <option value="Tree Cutting Permit">Tree Cutting Permit</option>
                <option value="Tree Planting Permit">Tree Planting Permit</option>
                <option value="Wildlife Permit">Wildlife Permit</option>
                <option value="Rolling">Rolling</option>
              </select>
            </div>
            <div class="form-group">
              <label>Status</label>
              <select id="editStatus">
                <option value="pending">Pending</option>
                <option value="under review">Under Review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div class="form-actions">
              <button type="button" class="btn-secondary" onclick="closeEditApplicationModal()">Cancel</button>
              <button type="button" class="btn-primary" onclick="saveApplicationChanges()">Save Changes</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  
  // Populate form with application data
  document.getElementById('editApplicationId').value = app.applicationId || 'N/A';
  document.getElementById('editApplicantName').value = app.applicantName || '';
  document.getElementById('editPermitType').value = app.permitType || '';
  document.getElementById('editStatus').value = app.status || 'pending';
  
  // Store current application ID for saving
  modal.dataset.applicationId = app.id;
  
  // Show modal
  modal.style.display = 'flex';
}

// Close edit application modal
window.closeEditApplicationModal = function() {
  const modal = document.getElementById('editApplicationModal');
  if (modal) {
    modal.style.display = 'none';
  }
};

// Save application changes
window.saveApplicationChanges = async function() {
  const modal = document.getElementById('editApplicationModal');
  const applicationId = modal.dataset.applicationId;
  
  if (!applicationId) {
    alert('Application ID not found');
    return;
  }
  
  try {
    const docRef = doc(db, 'applications', applicationId);
    
    const updatedData = {
      applicantName: document.getElementById('editApplicantName').value,
      permitType: document.getElementById('editPermitType').value,
      status: document.getElementById('editStatus').value,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.email
    };
    
    await updateDoc(docRef, updatedData);
    
    // Close modal and refresh table
    closeEditApplicationModal();
    loadAllApplications();
    
    // Show success message
    showNotification('Application updated successfully', 'success');
    
  } catch (error) {
    console.error('Error updating application:', error);
    alert('Error updating application: ' + error.message);
  }
};

// Show notification
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 24px;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    font-weight: 500;
    animation: slideIn 0.3s ease;
  `;
  
  document.body.appendChild(notification);
  
  // Auto remove after 3 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 3000);
}

// Add slide-in animation
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
  
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }
  
  .modal-content {
    background: white;
    border-radius: 16px;
    padding: 0;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow: hidden;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  }
  
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    background: linear-gradient(135deg, #1e5631 0%, #2d7a46 100%);
    color: white;
  }
  
  .modal-header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  
  .modal-close {
    background: none;
    border: none;
    color: white;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background 0.2s;
  }
  
  .modal-close:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  
  .modal-body {
    padding: 24px;
  }
  
  .form-group {
    margin-bottom: 20px;
  }
  
  .form-group label {
    display: block;
    margin-bottom: 8px;
    font-weight: 500;
    color: #374151;
  }
  
  .form-group input,
  .form-group select {
    width: 100%;
    padding: 12px 16px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 14px;
    transition: border-color 0.2s;
  }
  
  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: #1e5631;
    box-shadow: 0 0 0 3px rgba(30, 86, 49, 0.1);
  }
  
  .form-group input[readonly] {
    background: #f9fafb;
    color: #6b7280;
  }
  
  .form-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 24px;
  }
  
  .btn-primary,
  .btn-secondary {
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn-primary {
    background: linear-gradient(135deg, #1e5631 0%, #2d7a46 100%);
    color: white;
  }
  
  .btn-primary:hover {
    background: linear-gradient(135deg, #2d7a46 0%, #1e5631 100%);
  }
  
  .btn-secondary {
    background: #f3f4f6;
    color: #374151;
    border: 1px solid #d1d5db;
  }
  
  .btn-secondary:hover {
    background: #e5e7eb;
  }
`;
document.head.appendChild(style);

// View application details - Modern Professional Version
window.viewApplication = async function(appId) {
  let app = allApplications.find(a => a.id === appId);
  
  // If not found in local array, fetch from Firestore
  if (!app) {
    try {
      const docRef = doc(db, 'applications', appId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        app = {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        alert('Application not found');
        return;
      }
    } catch (error) {
      console.error('Error fetching application:', error);
      alert('Error loading application details');
      return;
    }
  }
  
  const modal = document.getElementById('applicationModal');
  const detailsDiv = document.getElementById('applicationDetails');
  
  // Get status icon
  function getStatusIcon(status) {
    switch((status || '').toLowerCase()) {
      case 'pending': return '⏳';
      case 'under review': return '👁️';
      case 'approved': return '✅';
      case 'rejected': return '❌';
      default: return '📋';
    }
  }
  
  // Get clean document name
  function getCleanDocumentName(originalName, fileType, index) {
    if (!originalName || !originalName.match(/Gemini_Generated_|^[a-f0-9]{32,}|[A-Za-z0-9]{20,}/)) {
      return originalName;
    }
    const isImage = fileType && fileType.startsWith('image/');
    const isPDF = fileType && fileType.includes('pdf');
    if (isImage) return `Document Image ${index + 1}`;
    if (isPDF) return `Document PDF ${index + 1}`;
    return `Document ${index + 1}`;
  }
  
  detailsDiv.innerHTML = `
    <!-- Applicant Information Section -->
    <div class="detail-section">
      <div class="section-header">
        <h3 class="section-title">👤 Applicant Information</h3>
      </div>
      <div class="section-content">
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-label">🆔 Application ID</div>
            <div class="detail-value application-id">${app.applicationId || app.id}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">👤 Full Name</div>
            <div class="detail-value highlight">${app.applicantName || 'N/A'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">📧 Email Address</div>
            <div class="detail-value email-address">📧 ${app.applicantEmail || 'N/A'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">📱 Mobile Number</div>
            <div class="detail-value phone-number">📱 ${app.applicantMobile || 'N/A'}</div>
          </div>
          <div class="detail-item" style="grid-column: 1 / -1;">
            <div class="detail-label">📍 Residential Address</div>
            <div class="detail-value address">${app.applicantAddress || 'N/A'}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Application Details Section -->
    <div class="detail-section">
      <div class="section-header">
        <h3 class="section-title">📋 Application Details</h3>
      </div>
      <div class="section-content">
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-label">📄 Permit Type</div>
            <div class="detail-value permit-type">${app.permitType || 'N/A'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">📅 Submission Date</div>
            <div class="detail-value date-submitted">${formatDate(app.createdAt)}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">🏷️ Current Status</div>
            <div class="detail-value">
              <span class="status-badge ${getStatusClass(app.status)}">
                ${getStatusIcon(app.status)} ${app.status}
              </span>
            </div>
          </div>
          ${app.reviewedAt ? `
          <div class="detail-item">
            <div class="detail-label">🕐 Review Date</div>
            <div class="detail-value review-date">${formatDate(app.reviewedAt)}</div>
          </div>
          ` : ''}
        </div>
        ${app.applicationDetails ? `
        <div style="margin-top: 20px;">
          <div class="detail-label">📝 Application Description</div>
          <div class="detail-value application-description" style="margin-top: 8px;">
            ${app.applicationDetails}
          </div>
        </div>
        ` : ''}
      </div>
    </div>

    <!-- Location Section -->
    ${app.latitude && app.longitude ? `
    <div class="detail-section">
      <div class="section-header">
        <h3 class="section-title">🗺️ Location Information</h3>
      </div>
      <div class="section-content">
        <div class="location-card">
          <div class="location-icon">📍</div>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: #1e293b; margin-bottom: 4px;">Application Location</div>
            <a href="https://www.google.com/maps?q=${app.latitude},${app.longitude}" target="_blank" class="location-link">
              View on Google Maps →
            </a>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
              Coordinates: ${app.latitude}, ${app.longitude}
            </div>
          </div>
        </div>
      </div>
    </div>
    ` : ''}

    <!-- Documents Section -->
    ${app.documents && app.documents.length > 0 ? `
    <div class="detail-section">
      <div class="section-header">
        <h3 class="section-title">📁 Uploaded Documents (${app.documents.length})</h3>
      </div>
      <div class="section-content">
        <div class="documents-grid">
          ${app.documents.map((doc, index) => {
            const docName = getCleanDocumentName(doc.name, doc.type, index);
            const docData = doc.url || doc.data || '';
            const docType = doc.type || '';
            const docSize = doc.size || 0;
            const isCloudinary = doc.cloudinary || doc.public_id || doc.publicId;
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
                      <span>${isCloudinary ? 'Cloudinary' : 'Local'}</span>
                    </div>
                  </div>
                </div>
              `;
            }
            
            return `
              <div class="document-card">
                <div class="document-preview" onclick="downloadDocument('${docData}', '${docName}')" style="cursor: pointer;">
                  ${isImage ? 
                    `<img src="${docData}" alt="${docName}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;" />` :
                    `<div style="text-decoration: none; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #64748b;">
                      <div style="font-size: 48px; margin-bottom: 8px;">${isPDF ? '📄' : '📎'}</div>
                      <div style="font-weight: 600;">Click to Download</div>
                    </div>`
                  }
                </div>
                <div class="document-info">
                  <div class="document-name">${docName}</div>
                  <div class="document-meta">
                    <span>${docSize ? (docSize / 1024).toFixed(1) + ' KB' : 'Unknown size'}</span>
                    <span>${isCloudinary ? '☁️ Cloud' : '💾 Local'}</span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
    ` : ''}

    <!-- Pickup Schedule Section -->
    ${app.pickupSchedule ? `
    <div class="detail-section">
      <div class="section-header">
        <h3 class="section-title">📅 Pickup Schedule</h3>
      </div>
      <div class="section-content">
        <div class="schedule-card" style="background: #f0f9ff; border: 2px solid #0ea5e9; border-radius: 12px; padding: 20px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 16px;">
            <div>
              <div style="font-weight: 600; color: #0c4a6e; margin-bottom: 4px;">📆 Pickup Date</div>
              <div style="color: #0369a1; font-size: 16px;">${app.pickupSchedule.date}</div>
            </div>
            <div>
              <div style="font-weight: 600; color: #0c4a6e; margin-bottom: 4px;">🕐 Pickup Time</div>
              <div style="color: #0369a1; font-size: 16px;">${app.pickupSchedule.time}</div>
            </div>
          </div>
          ${app.pickupSchedule.notes ? `
          <div style="margin-bottom: 16px;">
            <div style="font-weight: 600; color: #0c4a6e; margin-bottom: 4px;">📝 Additional Notes</div>
            <div style="color: #0369a1; background: white; padding: 12px; border-radius: 8px; border: 1px solid #bae6fd;">
              ${app.pickupSchedule.notes}
            </div>
          </div>
          ` : ''}
          <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 16px; border-top: 1px solid #bae6fd;">
            <div>
              <div style="font-weight: 600; color: #0c4a6e; margin-bottom: 4px;">👤 Scheduled By</div>
              <div style="color: #0369a1;">${app.pickupSchedule.scheduledBy || 'Unknown'}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 600; color: #0c4a6e; margin-bottom: 4px;">🕐 Scheduled At</div>
              <div style="color: #0369a1;">${app.pickupSchedule.scheduledAt ? formatDate(app.pickupSchedule.scheduledAt) : 'Unknown'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    ` : ''}

    <!-- Status Timeline Section -->
    <div class="detail-section">
      <div class="section-header">
        <h3 class="section-title">📊 Application Timeline</h3>
      </div>
      <div class="section-content">
        <div class="status-timeline">
          <div class="timeline-item">
            <div class="timeline-marker completed">📝</div>
            <div class="timeline-content">
              <div class="timeline-title">Application Submitted</div>
              <div class="timeline-date">${formatDate(app.createdAt)}</div>
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
    </div>
  `;
  
  modal.style.display = 'flex';
};

// Show approved permits
window.showApprovedPermits = async function() {
  // Close other tables first
  hideArchivedRecords();
  hideSystemLogs();
  
  const container = document.getElementById('approvedPermitsContainer');
  const tbody = document.getElementById('approvedPermitsTable');
  
  if (container) container.style.display = 'block';
  
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px;">Loading approved permits...</td></tr>';
    
    try {
      const applicationsRef = collection(db, 'applications');
      const q = query(applicationsRef);
      const querySnapshot = await getDocs(q);
      
      tbody.innerHTML = '';
      
      if (querySnapshot.empty) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:#666;">No approved permits found</td></tr>';
        return;
      }
      
      let approvedApps = [];
      querySnapshot.forEach((doc) => {
        const app = {
          id: doc.id,
          ...doc.data()
        };
        // Filter for approved status
        if (app.status === 'approved') {
          approvedApps.push(app);
        }
      });
      
      if (approvedApps.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:#666;">No approved permits found</td></tr>';
        return;
      }
      
      // Sort by approvedAt (approval date)
      approvedApps.sort((a, b) => {
        const aTime = a.approvedAt?.toMillis ? a.approvedAt.toMillis() : 0;
        const bTime = b.approvedAt?.toMillis ? b.approvedAt.toMillis() : 0;
        return bTime - aTime;
      });
      
      approvedApps.forEach((app) => {
        const row = document.createElement('tr');
        const approvedDate = app.approvedAt ? formatDate(app.approvedAt) : 'N/A';
        const approvedBy = app.approvedBy || 'N/A';
        const docCount = app.documents ? app.documents.length : 0;
        
        row.innerHTML = `
          <td>${app.applicationId || app.id}</td>
          <td>${app.applicantName || 'N/A'}</td>
          <td>${app.permitType || 'N/A'}</td>
          <td>${approvedDate}</td>
          <td>${approvedBy}</td>
          <td>${approvedDate}</td>
          <td>${docCount} document(s)</td>
          <td>
            <div class="table-actions">
              <button class="btn-view" onclick="viewApplication('${app.id}')">View Details</button>
            </div>
          </td>
        `;
        
        tbody.appendChild(row);
      });
    } catch (error) {
      console.error('Error loading approved permits:', error);
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:#ef4444;">Error loading approved permits</td></tr>';
    }
  }
};

// Hide approved permits
window.hideApprovedPermits = function() {
  const container = document.getElementById('approvedPermitsContainer');
  if (container) container.style.display = 'none';
};

// Show archived records (rejected applications)
window.showArchivedRecords = async function() {
  // Close other tables first
  hideApprovedPermits();
  hideSystemLogs();
  
  const container = document.getElementById('archivedRecordsContainer');
  const tbody = document.getElementById('archivedRecordsTable');
  
  if (container) container.style.display = 'block';
  
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px;">Loading archived records...</td></tr>';
    
    try {
      const applicationsRef = collection(db, 'applications');
      const q = query(applicationsRef);
      const querySnapshot = await getDocs(q);
      
      tbody.innerHTML = '';
      
      if (querySnapshot.empty) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:#666;">No archived records found</td></tr>';
        return;
      }
      
      let rejectedApps = [];
      querySnapshot.forEach((doc) => {
        const app = {
          id: doc.id,
          ...doc.data()
        };
        // Filter for rejected status
        if (app.status === 'rejected') {
          rejectedApps.push(app);
        }
      });
      
      if (rejectedApps.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:#666;">No archived records found</td></tr>';
        return;
      }
      
      // Sort by reviewedAt (rejection date)
      rejectedApps.sort((a, b) => {
        const aTime = a.reviewedAt?.toMillis ? a.reviewedAt.toMillis() : 0;
        const bTime = b.reviewedAt?.toMillis ? b.reviewedAt.toMillis() : 0;
        return bTime - aTime;
      });
      
      rejectedApps.forEach((app) => {
        const row = document.createElement('tr');
        const rejectedDate = app.reviewedAt ? formatDate(app.reviewedAt) : 'N/A';
        const rejectedBy = app.reviewedBy || app.updatedBy || 'N/A';
        const rejectionReason = app.rejectionReason || 'No reason provided';
        
        row.innerHTML = `
          <td>${app.applicationId || app.id}</td>
          <td>${app.applicantName || 'N/A'}</td>
          <td>${app.permitType || 'N/A'}</td>
          <td>${rejectedDate}</td>
          <td>${rejectedBy}</td>
          <td style="color: #ef4444;">${rejectionReason}</td>
          <td>
            <div class="table-actions">
              <button class="btn-view" onclick="viewApplication('${app.id}')">View Details</button>
            </div>
          </td>
        `;
        
        tbody.appendChild(row);
      });
    } catch (error) {
      console.error('Error loading archived records:', error);
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:#ef4444;">Error loading archived records</td></tr>';
    }
  }
};

// Hide archived records
window.hideArchivedRecords = function() {
  const container = document.getElementById('archivedRecordsContainer');
  if (container) container.style.display = 'none';
};

// Show system logs
window.showSystemLogs = async function() {
  // Close other tables first
  hideApprovedPermits();
  hideArchivedRecords();
  
  const container = document.getElementById('systemLogsContainer');
  const tbody = document.getElementById('systemLogsTable');
  
  if (container) container.style.display = 'block';
  
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px;">Loading system logs...</td></tr>';
    
    try {
      const applicationsRef = collection(db, 'applications');
      const q = query(applicationsRef);
      const querySnapshot = await getDocs(q);
      
      tbody.innerHTML = '';
      
      if (querySnapshot.empty) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px; color:#666;">No system logs found</td></tr>';
        return;
      }
      
      let logs = [];
      querySnapshot.forEach((doc) => {
        const app = {
          id: doc.id,
          ...doc.data()
        };
        // Only include applications that have been reviewed (have reviewedAt)
        if (app.reviewedAt && app.reviewedBy) {
          let action = 'Unknown';
          if (app.status === 'approved') action = 'Approved';
          else if (app.status === 'rejected') action = 'Rejected';
          else if (app.status === 'under review') action = 'Marked Under Review';
          
          logs.push({
            applicationId: app.applicationId || app.id,
            applicantName: app.applicantName || 'N/A',
            action: action,
            performedBy: app.reviewedBy,
            timestamp: app.reviewedAt
          });
        }
      });
      
      if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px; color:#666;">No system logs found</td></tr>';
        return;
      }
      
      // Sort by timestamp (most recent first)
      logs.sort((a, b) => {
        const aTime = a.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
        const bTime = b.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
        return bTime - aTime;
      });
      
      logs.forEach((log) => {
        const row = document.createElement('tr');
        const timestamp = log.timestamp ? formatDate(log.timestamp) : 'N/A';
        
        // Color code actions
        let actionColor = '#666';
        if (log.action === 'Approved') actionColor = '#22c55e';
        else if (log.action === 'Rejected') actionColor = '#ef4444';
        else if (log.action === 'Marked Under Review') actionColor = '#f59e0b';
        
        row.innerHTML = `
          <td>${timestamp}</td>
          <td>${log.applicationId}</td>
          <td>${log.applicantName}</td>
          <td style="color: ${actionColor}; font-weight: 500;">${log.action}</td>
          <td>${log.performedBy}</td>
        `;
        
        tbody.appendChild(row);
      });
    } catch (error) {
      console.error('Error loading system logs:', error);
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px; color:#ef4444;">Error loading system logs</td></tr>';
    }
  }
};

// Hide system logs
window.hideSystemLogs = function() {
  const container = document.getElementById('systemLogsContainer');
  if (container) container.style.display = 'none';
};

// Load reports data
async function loadReports() {
  try {
    const applicationsRef = collection(db, 'applications');
    const q = query(applicationsRef);
    const querySnapshot = await getDocs(q);
    
    let applications = [];
    querySnapshot.forEach((doc) => {
      applications.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    const total = applications.length;
    
    // Application Trends
    const applicationTrendsDiv = document.getElementById('applicationTrends');
    if (applicationTrendsDiv) {
      const pending = applications.filter(app => app.status === 'pending').length;
      const underReview = applications.filter(app => app.status === 'under review').length;
      const approved = applications.filter(app => app.status === 'approved').length;
      const rejected = applications.filter(app => app.status === 'rejected').length;
      
      applicationTrendsDiv.innerHTML = `
        <div style="padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 12px; margin-bottom: 16px; color: white;">
            <div style="font-size: 14px; opacity: 0.9; margin-bottom: 4px;">Total Applications</div>
            <div style="font-size: 32px; font-weight: bold;">${total}</div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div style="background: #fffbeb; padding: 16px; border-radius: 8px; border-left: 4px solid #f59e0b;">
              <div style="font-size: 12px; color: #92400e; margin-bottom: 4px;">Pending</div>
              <div style="font-size: 24px; font-weight: bold; color: #b45309;">${pending}</div>
              <div style="font-size: 11px; color: #92400e;">${total > 0 ? (pending / total * 100).toFixed(1) : 0}%</div>
            </div>
            <div style="background: #ffedd5; padding: 16px; border-radius: 8px; border-left: 4px solid #f97316;">
              <div style="font-size: 12px; color: #9a3412; margin-bottom: 4px;">Under Review</div>
              <div style="font-size: 24px; font-weight: bold; color: #c2410c;">${underReview}</div>
              <div style="font-size: 11px; color: #9a3412;">${total > 0 ? (underReview / total * 100).toFixed(1) : 0}%</div>
            </div>
            <div style="background: #dcfce7; padding: 16px; border-radius: 8px; border-left: 4px solid #22c55e;">
              <div style="font-size: 12px; color: #166534; margin-bottom: 4px;">Approved</div>
              <div style="font-size: 24px; font-weight: bold; color: #15803d;">${approved}</div>
              <div style="font-size: 11px; color: #166534;">${total > 0 ? (approved / total * 100).toFixed(1) : 0}%</div>
            </div>
            <div style="background: #fee2e2; padding: 16px; border-radius: 8px; border-left: 4px solid #ef4444;">
              <div style="font-size: 12px; color: #991b1b; margin-bottom: 4px;">Rejected</div>
              <div style="font-size: 24px; font-weight: bold; color: #b91c1c;">${rejected}</div>
              <div style="font-size: 11px; color: #991b1b;">${total > 0 ? (rejected / total * 100).toFixed(1) : 0}%</div>
            </div>
          </div>
        </div>
      `;
    }
    
    // Permit Type Distribution
    const permitTypeDiv = document.getElementById('permitTypeDistribution');
    if (permitTypeDiv) {
      const permitTypes = {};
      applications.forEach(app => {
        const type = app.permitType || 'Unknown';
        permitTypes[type] = (permitTypes[type] || 0) + 1;
      });
      
      let html = '<div style="padding: 20px;">';
      if (Object.keys(permitTypes).length === 0) {
        html = '<div style="padding: 20px; color: #666; text-align: center;">No permit type data available</div>';
      } else {
        const sortedTypes = Object.keys(permitTypes).sort((a, b) => permitTypes[b] - permitTypes[a]);
        sortedTypes.forEach((type, index) => {
          const count = permitTypes[type];
          const percentage = total > 0 ? (count / total * 100).toFixed(1) : 0;
          const colors = ['#1f6f3a', '#15803d', '#166534', '#14532d', '#365314'];
          const color = colors[index % colors.length];
          html += `
            <div style="margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 500; color: #374151;">${type}</span>
                <span style="font-weight: bold; color: ${color};">${count} (${percentage}%)</span>
              </div>
              <div style="background: #f3f4f6; height: 12px; border-radius: 6px; overflow: hidden;">
                <div style="background: ${color}; height: 100%; width: ${percentage}%; border-radius: 6px; transition: width 0.3s ease;"></div>
              </div>
            </div>
          `;
        });
      }
      html += '</div>';
      permitTypeDiv.innerHTML = html;
    }
    
    // Staff Performance - Comprehensive Dashboard
    await loadStaffPerformance();
  } catch (error) {
    console.error('Error loading reports:', error);
    const applicationTrendsDiv = document.getElementById('applicationTrends');
    const permitTypeDiv = document.getElementById('permitTypeDistribution');
    const staffPerformanceDiv = document.getElementById('staffPerformance');
    
    if (applicationTrendsDiv) applicationTrendsDiv.innerHTML = '<p style="color: #ef4444; padding: 20px; text-align: center;">Error loading data: ' + error.message + '</p>';
    if (permitTypeDiv) permitTypeDiv.innerHTML = '<p style="color: #ef4444; padding: 20px; text-align: center;">Error loading data: ' + error.message + '</p>';
    if (staffPerformanceDiv) staffPerformanceDiv.innerHTML = '<p style="color: #ef4444; padding: 20px; text-align: center;">Error loading data: ' + error.message + '</p>';
  }
}

// Load comprehensive Staff Performance Dashboard
async function loadStaffPerformance() {
  const staffPerformanceDiv = document.getElementById('staffPerformance');
  const staffPerformanceSummary = document.getElementById('staffPerformanceSummary');
  
  if (!staffPerformanceDiv) return;
  
  try {
    // Get filter values
    const dateRange = document.getElementById('staffDateRange')?.value || 'all';
    const roleFilter = document.getElementById('staffRoleFilter')?.value || 'all';
    const performanceFilter = document.getElementById('staffPerformanceFilter')?.value || 'all';
    
    // Calculate date filter
    let dateFrom = null;
    if (dateRange !== 'all') {
      const days = parseInt(dateRange);
      dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - days);
    }
    
    // Fetch audit logs for staff performance
    const logsRef = collection(db, 'auditLogs');
    const logsQuery = query(logsRef, orderBy('timestamp', 'desc'), limit(2000));
    const logsSnapshot = await getDocs(logsQuery);
    
    // Fetch users collection for role information
    const usersRef = collection(db, 'users');
    const usersSnapshot = await getDocs(usersRef);
    
    const userRoles = {};
    const allStaffUsers = [];
    usersSnapshot.forEach((doc) => {
      const user = doc.data();
      const displayName = user.firstName && user.surname 
        ? `${user.firstName} ${user.surname}` 
        : user.displayName || user.email?.split('@')[0] || 'Unknown';
      userRoles[user.email] = {
        role: user.role,
        displayName: displayName,
        firstName: user.firstName,
        surname: user.surname,
        createdAt: user.createdAt,
        status: user.status || 'active'
      };
      // Track all staff users for total count (exclude admin from performance metrics)
      if (user.role === 'staff') {
        allStaffUsers.push({
          email: user.email,
          role: user.role,
          displayName: displayName,
          status: user.status || 'active'
        });
      }
    });
    
    const staffStats = {};
    const staffActivityHistory = {};
    
    logsSnapshot.forEach((doc) => {
      const log = doc.data();
      const actionLower = log.action?.toLowerCase() || '';
      const logDate = log.timestamp ? log.timestamp.toDate() : new Date();
      
      // Apply date filter
      if (dateFrom && logDate < dateFrom) return;
      
      // Track staff actions
      if (log.email && (actionLower.includes('approved') || actionLower.includes('rejected') || actionLower.includes('under review'))) {
        if (!staffStats[log.email]) {
          staffStats[log.email] = {
            approved: 0,
            rejected: 0,
            underReview: 0,
            total: 0,
            user: log.user,
            email: log.email,
            role: userRoles[log.email]?.role || 'unknown',
            displayName: userRoles[log.email]?.displayName || log.user,
            firstAction: logDate,
            lastAction: logDate,
            dailyActions: {}
          };
          staffActivityHistory[log.email] = [];
        }
        
        staffStats[log.email].total++;
        staffStats[log.email].lastAction = logDate;
        
        if (!staffStats[log.email].firstAction || logDate < staffStats[log.email].firstAction) {
          staffStats[log.email].firstAction = logDate;
        }
        
        if (actionLower.includes('approved')) {
          staffStats[log.email].approved++;
        } else if (actionLower.includes('rejected')) {
          staffStats[log.email].rejected++;
        } else if (actionLower.includes('under review')) {
          staffStats[log.email].underReview++;
        }
        
        // Track daily actions for trend analysis
        const dateKey = logDate.toISOString().split('T')[0];
        staffStats[log.email].dailyActions[dateKey] = (staffStats[log.email].dailyActions[dateKey] || 0) + 1;
        
        // Add to activity history
        staffActivityHistory[log.email].push({
          action: log.action,
          timestamp: logDate,
          details: log.details,
          category: log.category
        });
      }
    });
    
    // Apply role filter
    let filteredStaff = Object.keys(staffStats).filter(email => {
      if (roleFilter === 'all') return true;
      return staffStats[email].role === roleFilter;
    });
    
    // Add staff users who have no audit logs yet (so they show up with 0 actions)
    allStaffUsers.forEach(staffUser => {
      if (!staffStats[staffUser.email]) {
        staffStats[staffUser.email] = {
          approved: 0,
          rejected: 0,
          underReview: 0,
          total: 0,
          user: staffUser.displayName,
          email: staffUser.email,
          role: staffUser.role,
          displayName: staffUser.displayName,
          firstAction: null,
          lastAction: null,
          dailyActions: {},
          approvalRate: 0,
          daysActive: 0,
          actionsPerDay: 0,
          trend: '0',
          trendDirection: 'stable'
        };
        staffActivityHistory[staffUser.email] = [];
      }
      // Apply role filter to newly added staff too
      if (roleFilter === 'all' || staffUser.role === roleFilter) {
        if (!filteredStaff.includes(staffUser.email)) {
          filteredStaff.push(staffUser.email);
        }
      }
    });
    
    // Calculate performance metrics
    filteredStaff.forEach(email => {
      const stats = staffStats[email];
      stats.approvalRate = stats.total > 0 ? (stats.approved / stats.total * 100) : 0;
      
      if (stats.firstAction && stats.lastAction) {
        stats.daysActive = Math.max(1, Math.ceil((stats.lastAction - stats.firstAction) / (1000 * 60 * 60 * 24)));
        stats.actionsPerDay = stats.total / stats.daysActive;
      } else {
        stats.daysActive = 0;
        stats.actionsPerDay = 0;
      }
      
      // Calculate trend (last 7 days vs previous 7 days)
      const today = new Date();
      const last7Days = [];
      const previous7Days = [];
      
      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateKey = date.toISOString().split('T')[0];
        last7Days.push(stats.dailyActions[dateKey] || 0);
      }
      
      for (let i = 7; i < 14; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateKey = date.toISOString().split('T')[0];
        previous7Days.push(stats.dailyActions[dateKey] || 0);
      }
      
      const last7Sum = last7Days.reduce((a, b) => a + b, 0);
      const previous7Sum = previous7Days.reduce((a, b) => a + b, 0);
      
      if (previous7Sum > 0) {
        stats.trend = ((last7Sum - previous7Sum) / previous7Sum * 100).toFixed(1);
        stats.trendDirection = last7Sum > previous7Sum ? 'up' : last7Sum < previous7Sum ? 'down' : 'stable';
      } else {
        stats.trend = last7Sum > 0 ? '100' : '0';
        stats.trendDirection = last7Sum > 0 ? 'up' : 'stable';
      }
    });
    
    // Apply performance filter
    if (performanceFilter !== 'all') {
      filteredStaff = filteredStaff.filter(email => {
        const rate = staffStats[email].approvalRate;
        if (performanceFilter === 'high') return rate >= 80;
        if (performanceFilter === 'average') return rate >= 50 && rate < 80;
        if (performanceFilter === 'low') return rate < 50;
        return true;
      });
    }
    
    // Sort by total actions
    filteredStaff.sort((a, b) => staffStats[b].total - staffStats[a].total);
    
    // Calculate summary stats
    const totalStaff = allStaffUsers.length;
    const activeStaff = filteredStaff.length;
    const averageApprovalRate = activeStaff > 0 
      ? (filteredStaff.reduce((sum, email) => sum + staffStats[email].approvalRate, 0) / activeStaff).toFixed(1) 
      : 0;
    const topPerformers = filteredStaff.filter(email => staffStats[email].approvalRate >= 80).slice(0, 5);
    const underperformingStaff = filteredStaff.filter(email => staffStats[email].approvalRate < 50 && staffStats[email].total > 0);
    
    // Render summary stats
    if (staffPerformanceSummary) {
      staffPerformanceSummary.innerHTML = `
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 12px; color: white;">
          <div style="font-size: 14px; opacity: 0.9; margin-bottom: 4px;">Total Staff</div>
          <div style="font-size: 28px; font-weight: bold;">${totalStaff}</div>
          <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">${activeStaff} with activity</div>
        </div>
        <div style="background: #dcfce7; padding: 20px; border-radius: 12px; border-left: 4px solid #22c55e;">
          <div style="font-size: 14px; color: #166534; margin-bottom: 4px;">Avg Approval Rate</div>
          <div style="font-size: 28px; font-weight: bold; color: #15803d;">${averageApprovalRate}%</div>
          <div style="font-size: 12px; color: #166534; margin-top: 4px;">across active staff</div>
        </div>
        <div style="background: #dbeafe; padding: 20px; border-radius: 12px; border-left: 4px solid #3b82f6;">
          <div style="font-size: 14px; color: #1e40af; margin-bottom: 4px;">Top Performers</div>
          <div style="font-size: 28px; font-weight: bold; color: #1d4ed8;">${topPerformers.length}</div>
          <div style="font-size: 12px; color: #1e40af; margin-top: 4px;">80%+ approval rate</div>
        </div>
        <div style="background: #fee2e2; padding: 20px; border-radius: 12px; border-left: 4px solid #ef4444;">
          <div style="font-size: 14px; color: #991b1b; margin-bottom: 4px;">Needs Attention</div>
          <div style="font-size: 28px; font-weight: bold; color: #b91c1c;">${underperformingStaff.length}</div>
          <div style="font-size: 12px; color: #991b1b; margin-top: 4px;">below 50% approval</div>
        </div>
      `;
    }
    
    // Render staff list
    let html = '<div style="padding: 20px;">';
    
    if (filteredStaff.length === 0) {
      html = '<div style="padding: 20px; color: #666; text-align: center;">No staff performance data available matching your filters.</div>';
    } else {
      filteredStaff.forEach((staffEmail, index) => {
        const stats = staffStats[staffEmail];
        const approvalRate = stats.approvalRate.toFixed(1);
        const rateColor = approvalRate >= 80 ? '#22c55e' : approvalRate >= 50 ? '#f59e0b' : '#ef4444';
        const trendIcon = stats.trendDirection === 'up' ? '📈' : stats.trendDirection === 'down' ? '📉' : '➡️';
        const trendColor = stats.trendDirection === 'up' ? '#22c55e' : stats.trendDirection === 'down' ? '#ef4444' : '#6b7280';
        
        // Alert flags
        let alerts = [];
        if (stats.approvalRate < 50) alerts.push('Low Approval Rate');
        if (stats.trendDirection === 'down' && parseFloat(stats.trend) > 20) alerts.push('Declining Performance');
        if (stats.approvalRate >= 90) alerts.push('Top Performer');
        
        html += `
          <div style="margin-bottom: 20px; padding: 20px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer;" onclick="viewStaffPerformanceDetails('${staffEmail}')">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
              <div style="flex: 1;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                  <div style="font-weight: 700; color: #1f2937; font-size: 18px;">${stats.displayName || 'Unknown'}</div>
                  <span style="background: ${stats.role === 'admin' ? '#8b5cf6' : '#3b82f6'}; color: white; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 500; text-transform: capitalize;">${stats.role}</span>
                </div>
                <div style="font-size: 13px; color: #6b7280;">${staffEmail}</div>
              </div>
              <div style="text-align: right;">
                <div style="background: ${rateColor}; color: white; padding: 8px 16px; border-radius: 20px; font-size: 16px; font-weight: 700;">
                  ${approvalRate}% Approval
                </div>
                <div style="margin-top: 4px; font-size: 12px; color: ${trendColor}; font-weight: 500;">
                  ${trendIcon} ${stats.trend}% trend
                </div>
              </div>
            </div>
            
            ${alerts.length > 0 ? `
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
              ${alerts.map(alert => `
                <span style="background: ${alert === 'Top Performer' ? '#dcfce7' : '#fee2e2'}; color: ${alert === 'Top Performer' ? '#166534' : '#991b1b'}; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 500;">
                  ${alert === 'Top Performer' ? '⭐' : '⚠️'} ${alert}
                </span>
              `).join('')}
            </div>
            ` : ''}
            
            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; text-align: center;">
              <div style="background: #f9fafb; padding: 16px; border-radius: 8px;">
                <div style="font-size: 24px; font-weight: bold; color: #1f2937;">${stats.total}</div>
                <div style="font-size: 12px; color: #6b7280;">Total Actions</div>
              </div>
              <div style="background: #dcfce7; padding: 16px; border-radius: 8px;">
                <div style="font-size: 24px; font-weight: bold; color: #166534;">${stats.approved}</div>
                <div style="font-size: 12px; color: #166534;">Approved</div>
              </div>
              <div style="background: #ffedd5; padding: 16px; border-radius: 8px;">
                <div style="font-size: 24px; font-weight: bold; color: #c2410c;">${stats.underReview}</div>
                <div style="font-size: 12px; color: #9a3412;">Under Review</div>
              </div>
              <div style="background: #fee2e2; padding: 16px; border-radius: 8px;">
                <div style="font-size: 24px; font-weight: bold; color: #991b1b;">${stats.rejected}</div>
                <div style="font-size: 12px; color: #991b1b;">Rejected</div>
              </div>
              <div style="background: #e0f2fe; padding: 16px; border-radius: 8px;">
                <div style="font-size: 24px; font-weight: bold; color: #0369a1;">${stats.actionsPerDay.toFixed(1)}</div>
                <div style="font-size: 12px; color: #075985;">Actions/Day</div>
              </div>
            </div>
            
            <!-- Progress Bar -->
            <div style="margin-top: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 12px; color: #6b7280;">Performance Score</span>
                <span style="font-size: 12px; font-weight: 600; color: ${rateColor};">${approvalRate}%</span>
              </div>
              <div style="background: #f3f4f6; height: 8px; border-radius: 4px; overflow: hidden;">
                <div style="background: ${rateColor}; height: 100%; width: ${approvalRate}%; border-radius: 4px; transition: width 0.3s ease;"></div>
              </div>
            </div>
            
            <div style="margin-top: 12px; text-align: center; font-size: 12px; color: #6b7280;">
              Click to view detailed performance history →
            </div>
          </div>
        `;
      });
    }
    html += '</div>';
    staffPerformanceDiv.innerHTML = html;
    
    // Store staff data for detailed view
    window.staffPerformanceData = { staffStats, staffActivityHistory };
    
  } catch (error) {
    console.error('Error loading staff performance:', error);
    staffPerformanceDiv.innerHTML = '<p style="color: #ef4444; padding: 20px; text-align: center;">Error loading data: ' + error.message + '</p>';
  }
}

// Apply staff performance filters
window.applyStaffFilters = function() {
  loadStaffPerformance();
};

// View detailed staff performance
window.viewStaffPerformanceDetails = function(staffEmail) {
  if (!window.staffPerformanceData) return;
  
  const { staffStats, staffActivityHistory } = window.staffPerformanceData;
  const stats = staffStats[staffEmail];
  const history = staffActivityHistory[staffEmail] || [];
  
  if (!stats) return;
  
  const approvalRate = stats.approvalRate.toFixed(1);
  const rateColor = approvalRate >= 80 ? '#22c55e' : approvalRate >= 50 ? '#f59e0b' : '#ef4444';
  
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); justify-content: center; align-items: center; z-index: 10000;';
  
  modal.innerHTML = `
    <div class="modal-content" style="background: white; padding: 32px; border-radius: 12px; max-width: 800px; max-height: 90vh; overflow-y: auto; width: 95%;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <h2 style="margin: 0; font-size: 24px;">Staff Performance Details</h2>
        <button onclick="this.closest('.modal').remove()" style="background: none; border: none; font-size: 28px; cursor: pointer;">&times;</button>
      </div>
      
      <!-- Staff Info -->
      <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 24px;">
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
          <div style="font-size: 48px;">👤</div>
          <div>
            <div style="font-weight: 700; color: #1f2937; font-size: 20px;">${stats.displayName || 'Unknown'}</div>
            <div style="color: #6b7280; font-size: 14px;">${staffEmail}</div>
            <div style="margin-top: 4px;">
              <span style="background: ${stats.role === 'admin' ? '#8b5cf6' : '#3b82f6'}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 500; text-transform: capitalize;">${stats.role}</span>
            </div>
          </div>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
          <div style="text-align: center; padding: 12px; background: white; border-radius: 8px;">
            <div style="font-size: 24px; font-weight: bold; color: ${rateColor};">${approvalRate}%</div>
            <div style="font-size: 11px; color: #6b7280;">Approval Rate</div>
          </div>
          <div style="text-align: center; padding: 12px; background: white; border-radius: 8px;">
            <div style="font-size: 24px; font-weight: bold; color: #1f2937;">${stats.total}</div>
            <div style="font-size: 11px; color: #6b7280;">Total Actions</div>
          </div>
          <div style="text-align: center; padding: 12px; background: white; border-radius: 8px;">
            <div style="font-size: 24px; font-weight: bold; color: #166534;">${stats.approved}</div>
            <div style="font-size: 11px; color: #6b7280;">Approved</div>
          </div>
          <div style="text-align: center; padding: 12px; background: white; border-radius: 8px;">
            <div style="font-size: 24px; font-weight: bold; color: #991b1b;">${stats.rejected}</div>
            <div style="font-size: 11px; color: #6b7280;">Rejected</div>
          </div>
        </div>
      </div>
      
      <!-- Activity History -->
      <h3 style="margin-bottom: 16px;">Activity History</h3>
      <div style="max-height: 400px; overflow-y: auto;">
        ${history.length === 0 ? '<p style="color: #666; text-align: center; padding: 20px;">No activity history available</p>' : ''}
        ${history.map(activity => `
          <div style="padding: 12px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 500; color: #1f2937;">${activity.action}</div>
              <div style="font-size: 12px; color: #6b7280;">${activity.details || 'No details'}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 12px; color: #6b7280;">${activity.timestamp.toLocaleString()}</div>
              <div style="font-size: 11px; color: #9ca3af;">${activity.category}</div>
            </div>
          </div>
        `).join('')}
      </div>
      
      <!-- Admin Actions -->
      <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
        <h3 style="margin-bottom: 12px;">Admin Actions</h3>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn-secondary" onclick="alert('Add feedback feature coming soon')">Add Feedback</button>
          <button class="btn-secondary" onclick="alert('Assign task feature coming soon')">Assign Task</button>
          <button class="btn-secondary" onclick="alert('Export feature coming soon')">Export Report</button>
        </div>
      </div>
    </div>
  `;
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  document.body.appendChild(modal);
};

// Export staff performance
window.exportStaffPerformance = function() {
  alert('Export feature coming soon. This will export staff performance data to Excel/PDF.');
};

// Load content management
async function loadContentManagement() {
  loadAnnouncements();
  loadWelcomeMessage();
  loadContactInfo();
  loadOfficeHours();
  loadPermitTypes();
  loadFAQs();
  setupContentTabs();
}

// Setup content tabs
function setupContentTabs() {
  const tabs = document.querySelectorAll('.content-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs
      tabs.forEach(t => t.classList.remove('active'));
      // Add active class to clicked tab
      tab.classList.add('active');
      
      // Hide all editors
      document.querySelectorAll('.content-editor').forEach(editor => {
        editor.classList.remove('active');
      });
      
      // Show selected editor
      const contentType = tab.dataset.contentType;
      const editorId = contentType + 'Editor';
      const editor = document.getElementById(editorId);
      if (editor) {
        editor.classList.add('active');
      }
    });
  });
}

// Setup settings tabs
function setupSettingsTabs() {
  const tabs = document.querySelectorAll('#settingsSection .content-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs
      tabs.forEach(t => t.classList.remove('active'));
      // Add active class to clicked tab
      tab.classList.add('active');
      
      // Hide all editors
      document.querySelectorAll('#settingsSection .content-editor').forEach(editor => {
        editor.classList.remove('active');
      });
      
      // Show selected editor
      const settingsType = tab.dataset.settingsType;
      const editorId = settingsType + 'Editor';
      const editor = document.getElementById(editorId);
      if (editor) {
        editor.classList.add('active');
      }
    });
  });
}

// Load announcements
async function loadAnnouncements() {
  const listDiv = document.getElementById('announcementsList');
  if (!listDiv) return;
  
  try {
    const announcementsRef = collection(db, 'websiteContent');
    const q = query(announcementsRef, where('type', '==', 'announcement'));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      listDiv.innerHTML = '<p style="color: #666; padding: 16px;">No announcements found</p>';
      return;
    }
    
    let html = '<h4 style="margin-bottom: 12px;">Existing Announcements</h4>';
    querySnapshot.forEach((doc) => {
      const announcement = doc.data();
      html += `
        <div style="padding: 12px; background: #f9fafb; border-radius: 8px; margin-bottom: 8px; border: 1px solid #e5e7eb;">
          <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
              <div style="font-weight: 600; color: #1f2937;">${announcement.title}</div>
              <div style="font-size: 12px; color: #666; margin-top: 4px;">${announcement.content.substring(0, 100)}...</div>
              <div style="font-size: 11px; color: ${announcement.active ? '#22c55e' : '#ef4444'}; margin-top: 4px;">
                ${announcement.active ? 'Active' : 'Inactive'}
              </div>
            </div>
            <button onclick="deleteAnnouncement('${doc.id}')" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">Delete</button>
          </div>
        </div>
      `;
    });
    listDiv.innerHTML = html;
  } catch (error) {
    console.error('Error loading announcements:', error);
    listDiv.innerHTML = '<p style="color: #ef4444; padding: 16px;">Error loading announcements</p>';
  }
}

// Save announcement
const announcementsForm = document.getElementById('announcementsForm');
if (announcementsForm) {
  announcementsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const title = document.getElementById('announcementTitle').value.trim();
    const content = document.getElementById('announcementContent').value.trim();
    const active = document.getElementById('announcementActive').checked;
    
    // Validation
    if (!title) {
      alert('Please enter announcement title');
      return;
    }
    if (!content) {
      alert('Please enter announcement content');
      return;
    }
    if (title.length < 5) {
      alert('Announcement title must be at least 5 characters');
      return;
    }
    if (content.length < 10) {
      alert('Announcement content must be at least 10 characters');
      return;
    }
    
    try {
      await addDoc(collection(db, 'websiteContent'), {
        type: 'announcement',
        title,
        content,
        active,
        createdAt: serverTimestamp()
      });
      
      alert('Announcement saved successfully');
      announcementsForm.reset();
      loadAnnouncements();
    } catch (error) {
      console.error('Error saving announcement:', error);
      alert('Error saving announcement');
    }
  });
}

// Delete announcement
window.deleteAnnouncement = async function(id) {
  if (confirm('Are you sure you want to delete this announcement?')) {
    try {
      await deleteDoc(doc(db, 'websiteContent', id));
      loadAnnouncements();
    } catch (error) {
      console.error('Error deleting announcement:', error);
      alert('Error deleting announcement');
    }
  }
};

// Load welcome message
async function loadWelcomeMessage() {
  try {
    const welcomeRef = collection(db, 'websiteContent');
    const q = query(welcomeRef, where('type', '==', 'welcome'));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      const welcome = doc.data();
      document.getElementById('welcomeTitle').value = welcome.title || '';
      document.getElementById('welcomeMessage').value = welcome.message || '';
    }
  } catch (error) {
    console.error('Error loading welcome message:', error);
  }
}

// Save welcome message
const welcomeForm = document.getElementById('welcomeForm');
if (welcomeForm) {
  welcomeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const title = document.getElementById('welcomeTitle').value.trim();
    const message = document.getElementById('welcomeMessage').value.trim();
    
    // Validation
    if (!title) {
      alert('Please enter welcome title');
      return;
    }
    if (!message) {
      alert('Please enter welcome message');
      return;
    }
    if (title.length < 5) {
      alert('Welcome title must be at least 5 characters');
      return;
    }
    if (message.length < 10) {
      alert('Welcome message must be at least 10 characters');
      return;
    }
    
    try {
      // Check if welcome message exists
      const welcomeRef = collection(db, 'websiteContent');
      const q = query(welcomeRef, where('type', '==', 'welcome'));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        // Update existing
        const docId = querySnapshot.docs[0].id;
        await updateDoc(doc(db, 'websiteContent', docId), {
          title,
          message,
          updatedAt: serverTimestamp()
        });
      } else {
        // Create new
        await addDoc(collection(db, 'websiteContent'), {
          type: 'welcome',
          title,
          message,
          createdAt: serverTimestamp()
        });
      }
      
      alert('Welcome message saved successfully');
    } catch (error) {
      console.error('Error saving welcome message:', error);
      alert('Error saving welcome message');
    }
  });
}

// Load contact info
async function loadContactInfo() {
  try {
    const contactRef = collection(db, 'websiteContent');
    const q = query(contactRef, where('type', '==', 'contact'));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      const contact = doc.data();
      document.getElementById('contactAddress').value = contact.address || '';
      document.getElementById('contactPhone').value = contact.phone || '';
      document.getElementById('contactEmail').value = contact.email || '';
    }
  } catch (error) {
    console.error('Error loading contact info:', error);
  }
}

// Save contact info
const contactForm = document.getElementById('contactForm');
if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const address = document.getElementById('contactAddress').value.trim();
    const phone = document.getElementById('contactPhone').value.trim();
    const email = document.getElementById('contactEmail').value.trim();
    
    // Validation
    if (!address) {
      alert('Please enter office address');
      return;
    }
    if (!phone) {
      alert('Please enter phone number');
      return;
    }
    if (!email) {
      alert('Please enter email');
      return;
    }
    if (address.length < 10) {
      alert('Office address must be at least 10 characters');
      return;
    }
    if (phone.length < 7) {
      alert('Phone number must be at least 7 characters');
      return;
    }
    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      alert('Please enter a valid email address');
      return;
    }
    
    try {
      const contactRef = collection(db, 'websiteContent');
      const q = query(contactRef, where('type', '==', 'contact'));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const docId = querySnapshot.docs[0].id;
        await updateDoc(doc(db, 'websiteContent', docId), {
          address,
          phone,
          email,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'websiteContent'), {
          type: 'contact',
          address,
          phone,
          email,
          createdAt: serverTimestamp()
        });
      }
      
      alert('Contact info saved successfully');
    } catch (error) {
      console.error('Error saving contact info:', error);
      alert('Error saving contact info');
    }
  });
}

// Load office hours
async function loadOfficeHours() {
  try {
    const officeRef = collection(db, 'websiteContent');
    const q = query(officeRef, where('type', '==', 'office'));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      const office = doc.data();
      document.getElementById('officeWeekday').value = office.weekday || '';
      document.getElementById('officeSaturday').value = office.saturday || '';
      document.getElementById('officeSunday').value = office.sunday || '';
    }
  } catch (error) {
    console.error('Error loading office hours:', error);
  }
}

// Save office hours
const officeForm = document.getElementById('officeForm');
if (officeForm) {
  officeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const weekday = document.getElementById('officeWeekday').value.trim();
    const saturday = document.getElementById('officeSaturday').value.trim();
    const sunday = document.getElementById('officeSunday').value.trim();
    
    // Validation
    if (!weekday) {
      alert('Please enter weekday hours');
      return;
    }
    if (!saturday) {
      alert('Please enter Saturday hours');
      return;
    }
    if (!sunday) {
      alert('Please enter Sunday hours');
      return;
    }
    if (weekday.length < 5) {
      alert('Weekday hours must be at least 5 characters');
      return;
    }
    if (saturday.length < 5) {
      alert('Saturday hours must be at least 5 characters');
      return;
    }
    if (sunday.length < 3) {
      alert('Sunday hours must be at least 3 characters');
      return;
    }
    
    try {
      const officeRef = collection(db, 'websiteContent');
      const q = query(officeRef, where('type', '==', 'office'));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const docId = querySnapshot.docs[0].id;
        await updateDoc(doc(db, 'websiteContent', docId), {
          weekday,
          saturday,
          sunday,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'websiteContent'), {
          type: 'office',
          weekday,
          saturday,
          sunday,
          createdAt: serverTimestamp()
        });
      }
      
      alert('Office hours saved successfully');
    } catch (error) {
      console.error('Error saving office hours:', error);
      alert('Error saving office hours');
    }
  });
}

// Load permit types
async function loadPermitTypes() {
  const listDiv = document.getElementById('permitsList');
  if (!listDiv) return;
  
  try {
    const permitsRef = collection(db, 'websiteContent');
    const q = query(permitsRef, where('type', '==', 'permit'));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      listDiv.innerHTML = '<p style="color: #666; padding: 16px;">No permit types found</p>';
      return;
    }
    
    let html = '<h4 style="margin-bottom: 12px;">Existing Permit Types</h4>';
    querySnapshot.forEach((doc) => {
      const permit = doc.data();
      html += `
        <div style="padding: 12px; background: #f9fafb; border-radius: 8px; margin-bottom: 8px; border: 1px solid #e5e7eb;">
          <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
              <div style="font-weight: 600; color: #1f2937;">${permit.name}</div>
              <div style="font-size: 12px; color: #666; margin-top: 4px;">${permit.description?.substring(0, 80)}...</div>
              <div style="font-size: 11px; color: #666; margin-top: 4px;">Fee: ${permit.fee || 'N/A'}</div>
            </div>
            <button onclick="deletePermitType('${doc.id}')" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">Delete</button>
          </div>
        </div>
      `;
    });
    listDiv.innerHTML = html;
  } catch (error) {
    console.error('Error loading permit types:', error);
    listDiv.innerHTML = '<p style="color: #ef4444; padding: 16px;">Error loading permit types</p>';
  }
}

// Save permit type
const permitForm = document.getElementById('permitForm');
if (permitForm) {
  permitForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('permitTypeName').value.trim();
    const description = document.getElementById('permitDescription').value.trim();
    const requirements = document.getElementById('permitRequirements').value.trim();
    const processingTime = document.getElementById('permitProcessingTime').value.trim();
    const fee = document.getElementById('permitFee').value.trim();
    
    // Validation
    if (!name) {
      alert('Please enter permit type name');
      return;
    }
    if (!description) {
      alert('Please enter permit description');
      return;
    }
    if (!requirements) {
      alert('Please enter permit requirements');
      return;
    }
    if (!processingTime) {
      alert('Please enter processing time');
      return;
    }
    if (!fee) {
      alert('Please enter fee');
      return;
    }
    if (name.length < 3) {
      alert('Permit type name must be at least 3 characters');
      return;
    }
    if (description.length < 10) {
      alert('Permit description must be at least 10 characters');
      return;
    }
    if (requirements.length < 5) {
      alert('Permit requirements must be at least 5 characters');
      return;
    }
    if (processingTime.length < 3) {
      alert('Processing time must be at least 3 characters');
      return;
    }
    if (fee.length < 2) {
      alert('Fee must be at least 2 characters');
      return;
    }
    
    try {
      await addDoc(collection(db, 'websiteContent'), {
        type: 'permit',
        name,
        description,
        requirements: requirements.split('\n').filter(r => r.trim()),
        processingTime,
        fee,
        createdAt: serverTimestamp()
      });
      
      alert('Permit type saved successfully');
      permitForm.reset();
      loadPermitTypes();
    } catch (error) {
      console.error('Error saving permit type:', error);
      alert('Error saving permit type');
    }
  });
}

// Delete permit type
window.deletePermitType = async function(id) {
  if (confirm('Are you sure you want to delete this permit type?')) {
    try {
      await deleteDoc(doc(db, 'websiteContent', id));
      loadPermitTypes();
    } catch (error) {
      console.error('Error deleting permit type:', error);
      alert('Error deleting permit type');
    }
  }
};

// Load FAQs
async function loadFAQs() {
  const listDiv = document.getElementById('faqList');
  if (!listDiv) return;
  
  try {
    const faqRef = collection(db, 'websiteContent');
    const q = query(faqRef, where('type', '==', 'faq'));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      listDiv.innerHTML = '<p style="color: #666; padding: 16px;">No FAQs found</p>';
      return;
    }
    
    let html = '<h4 style="margin-bottom: 12px;">Existing FAQs</h4>';
    querySnapshot.forEach((doc) => {
      const faq = doc.data();
      html += `
        <div style="padding: 12px; background: #f9fafb; border-radius: 8px; margin-bottom: 8px; border: 1px solid #e5e7eb;">
          <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
              <div style="font-weight: 600; color: #1f2937;">${faq.question}</div>
              <div style="font-size: 12px; color: #666; margin-top: 4px;">${faq.answer?.substring(0, 80)}...</div>
            </div>
            <button onclick="deleteFAQ('${doc.id}')" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">Delete</button>
          </div>
        </div>
      `;
    });
    listDiv.innerHTML = html;
  } catch (error) {
    console.error('Error loading FAQs:', error);
    listDiv.innerHTML = '<p style="color: #ef4444; padding: 16px;">Error loading FAQs</p>';
  }
}

// Save FAQ
const faqForm = document.getElementById('faqForm');
if (faqForm) {
  faqForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const question = document.getElementById('faqQuestion').value.trim();
    const answer = document.getElementById('faqAnswer').value.trim();
    
    // Validation
    if (!question) {
      alert('Please enter question');
      return;
    }
    if (!answer) {
      alert('Please enter answer');
      return;
    }
    if (question.length < 5) {
      alert('Question must be at least 5 characters');
      return;
    }
    if (answer.length < 10) {
      alert('Answer must be at least 10 characters');
      return;
    }
    
    try {
      await addDoc(collection(db, 'websiteContent'), {
        type: 'faq',
        question,
        answer,
        createdAt: serverTimestamp()
      });
      
      alert('FAQ saved successfully');
      faqForm.reset();
      loadFAQs();
    } catch (error) {
      console.error('Error saving FAQ:', error);
      alert('Error saving FAQ');
    }
  });
}

// Delete FAQ
window.deleteFAQ = async function(id) {
  if (confirm('Are you sure you want to delete this FAQ?')) {
    try {
      await deleteDoc(doc(db, 'websiteContent', id));
      loadFAQs();
    } catch (error) {
      console.error('Error deleting FAQ:', error);
      alert('Error deleting FAQ');
    }
  }
};

// Save maintenance settings
window.saveMaintenanceSettings = async function() {
  const maintenanceMode = document.getElementById('maintenanceMode').checked;
  const maintenanceMessage = document.getElementById('maintenanceMessage').value.trim();
  
  try {
    const settingsRef = collection(db, 'systemSettings');
    const q = query(settingsRef, where('type', '==', 'maintenance'));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const docId = querySnapshot.docs[0].id;
      await updateDoc(doc(db, 'systemSettings', docId), {
        enabled: maintenanceMode,
        message: maintenanceMessage || 'System is under maintenance. Please check back later.',
        updatedAt: serverTimestamp()
      });
    } else {
      await addDoc(collection(db, 'systemSettings'), {
        type: 'maintenance',
        enabled: maintenanceMode,
        message: maintenanceMessage || 'System is under maintenance. Please check back later.',
        createdAt: serverTimestamp()
      });
    }
    
    alert('Maintenance settings saved successfully');
  } catch (error) {
    console.error('Error saving maintenance settings:', error);
    alert('Error saving maintenance settings');
  }
};

// Save security settings
window.saveSecuritySettings = async function() {
  const sessionTimeout = document.getElementById('sessionTimeout').value;
  
  if (!sessionTimeout || sessionTimeout < 15 || sessionTimeout > 480) {
    alert('Session timeout must be between 15 and 480 minutes');
    return;
  }
  
  try {
    const settingsRef = collection(db, 'systemSettings');
    const q = query(settingsRef, where('type', '==', 'security'));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const docId = querySnapshot.docs[0].id;
      await updateDoc(doc(db, 'systemSettings', docId), {
        sessionTimeout: parseInt(sessionTimeout),
        updatedAt: serverTimestamp()
      });
    } else {
      await addDoc(collection(db, 'systemSettings'), {
        type: 'security',
        sessionTimeout: parseInt(sessionTimeout),
        createdAt: serverTimestamp()
      });
    }
    
    alert('Security settings saved successfully');
  } catch (error) {
    console.error('Error saving security settings:', error);
    alert('Error saving security settings');
  }
};

// Save notification settings
window.saveNotificationSettings = async function() {
  const inputs = document.querySelectorAll('#notificationsEditor input[type="checkbox"]');
  const newAppNotifications = inputs[0].checked;
  const approvalNotifications = inputs[1].checked;
  const rejectionNotifications = inputs[2].checked;
  const dailyReports = inputs[3].checked;
  
  try {
    const settingsRef = collection(db, 'systemSettings');
    const q = query(settingsRef, where('type', '==', 'notifications'));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const docId = querySnapshot.docs[0].id;
      await updateDoc(doc(db, 'systemSettings', docId), {
        newApplications: newAppNotifications,
        approvals: approvalNotifications,
        rejections: rejectionNotifications,
        dailyReports: dailyReports,
        updatedAt: serverTimestamp()
      });
    } else {
      await addDoc(collection(db, 'systemSettings'), {
        type: 'notifications',
        newApplications: newAppNotifications,
        approvals: approvalNotifications,
        rejections: rejectionNotifications,
        dailyReports: dailyReports,
        createdAt: serverTimestamp()
      });
    }
    
    alert('Notification settings saved successfully');
  } catch (error) {
    console.error('Error saving notification settings:', error);
    alert('Error saving notification settings');
  }
};

// Enhanced password validation function
function validatePasswordStrength(password) {
  const validation = {
    isValid: true,
    errors: [],
    strength: 'weak',
    requirements: {
      length: false,
      uppercase: false,
      lowercase: false,
      number: false,
      special: false
    }
  };

  // Check minimum length (8 characters)
  if (password.length >= 8) {
    validation.requirements.length = true;
  } else {
    validation.errors.push('Password must be at least 8 characters long');
    validation.isValid = false;
  }

  // Check for uppercase letters
  if (/[A-Z]/.test(password)) {
    validation.requirements.uppercase = true;
  } else {
    validation.errors.push('Password must contain at least one uppercase letter');
    validation.isValid = false;
  }

  // Check for lowercase letters
  if (/[a-z]/.test(password)) {
    validation.requirements.lowercase = true;
  } else {
    validation.errors.push('Password must contain at least one lowercase letter');
    validation.isValid = false;
  }

  // Check for numbers
  if (/\d/.test(password)) {
    validation.requirements.number = true;
  } else {
    validation.errors.push('Password must contain at least one number');
    validation.isValid = false;
  }

  // Check for special characters
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    validation.requirements.special = true;
  } else {
    validation.errors.push('Password must contain at least one special character');
    validation.isValid = false;
  }

  // Calculate strength
  const metRequirements = Object.values(validation.requirements).filter(Boolean).length;
  if (metRequirements === 5) {
    validation.strength = 'strong';
  } else if (metRequirements >= 3) {
    validation.strength = 'medium';
  } else {
    validation.strength = 'weak';
  }

  return validation;
}

// Real-time password validation feedback
function updatePasswordFeedback(password, confirmPassword = null) {
  const validation = validatePasswordStrength(password);
  const strengthIndicator = document.getElementById('passwordStrengthIndicator');
  const strengthBar = document.getElementById('passwordStrengthBar');
  const requirementsList = document.getElementById('passwordRequirements');
  const matchIndicator = document.getElementById('passwordMatchIndicator');

  if (strengthIndicator && strengthBar) {
    strengthIndicator.style.display = 'block';
    strengthBar.className = `password-strength-bar ${validation.strength}`;
    
    // Update strength text
    const strengthText = document.getElementById('passwordStrengthText');
    if (strengthText) {
      strengthText.textContent = `Password strength: ${validation.strength}`;
      strengthText.className = `strength-text ${validation.strength}`;
    }
  }

  // Update requirements checklist
  if (requirementsList) {
    requirementsList.innerHTML = `
      <div class="requirement-item ${validation.requirements.length ? 'valid' : 'invalid'}">
        <span class="requirement-icon">${validation.requirements.length ? '✓' : '○'}</span>
        At least 8 characters
      </div>
      <div class="requirement-item ${validation.requirements.uppercase ? 'valid' : 'invalid'}">
        <span class="requirement-icon">${validation.requirements.uppercase ? '✓' : '○'}</span>
        One uppercase letter
      </div>
      <div class="requirement-item ${validation.requirements.lowercase ? 'valid' : 'invalid'}">
        <span class="requirement-icon">${validation.requirements.lowercase ? '✓' : '○'}</span>
        One lowercase letter
      </div>
      <div class="requirement-item ${validation.requirements.number ? 'valid' : 'invalid'}">
        <span class="requirement-icon">${validation.requirements.number ? '✓' : '○'}</span>
        One number
      </div>
      <div class="requirement-item ${validation.requirements.special ? 'valid' : 'invalid'}">
        <span class="requirement-icon">${validation.requirements.special ? '✓' : '○'}</span>
        One special character
      </div>
    `;
  }

  // Update password match indicator
  if (confirmPassword && matchIndicator) {
    const isMatching = password === confirmPassword;
    matchIndicator.style.display = 'block';
    matchIndicator.className = `password-match ${isMatching ? 'match' : 'no-match'}`;
    matchIndicator.innerHTML = `
      <span class="match-icon">${isMatching ? '✓' : '✗'}</span>
      <span class="match-text">${isMatching ? 'Passwords match' : 'Passwords do not match'}</span>
    `;
  }

  return validation;
}

// Enhanced change password function
window.changePassword = async function() {
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  
  // Enhanced validation
  if (!currentPassword) {
    showValidationMessage('Please enter current password', 'error');
    return;
  }
  if (!newPassword) {
    showValidationMessage('Please enter new password', 'error');
    return;
  }
  if (!confirmPassword) {
    showValidationMessage('Please confirm new password', 'error');
    return;
  }
  
  // Validate password strength
  const passwordValidation = validatePasswordStrength(newPassword);
  if (!passwordValidation.isValid) {
    showValidationMessage('Password does not meet security requirements', 'error');
    return;
  }
  
  if (newPassword !== confirmPassword) {
    showValidationMessage('New password and confirm password do not match', 'error');
    return;
  }
  if (currentPassword === newPassword) {
    showValidationMessage('New password must be different from current password', 'error');
    return;
  }
  
  const user = auth.currentUser;
  if (!user) {
    showValidationMessage('No user logged in', 'error');
    return;
  }
  
  try {
    // Show loading state
    const changeBtn = document.querySelector('#changePasswordForm button[type="button"]');
    const originalText = changeBtn.innerHTML;
    changeBtn.innerHTML = '<span class="btn-icon">⏳</span> Changing...';
    changeBtn.disabled = true;
    
    // Reauthenticate user
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    
    // Update password
    await updatePassword(user, newPassword);
    
    // Log successful password change
    await logAudit('Password Changed', 'User successfully changed their password', 'user', auth.currentUser?.uid, null, null, 'success');
    
    showValidationMessage('Password changed successfully', 'success');
    document.getElementById('changePasswordForm').reset();
    
    // Reset password feedback
    resetPasswordFeedback();
    
    // Reset button
    changeBtn.innerHTML = originalText;
    changeBtn.disabled = false;
  } catch (error) {
    console.error('Error changing password:', error);
    if (error.code === 'auth/wrong-password') {
      await logAudit('Password Change Failed', 'Incorrect current password entered', 'security', auth.currentUser?.uid, null, null, 'failure');
      showValidationMessage('Current password is incorrect', 'error');
    } else if (error.code === 'auth/too-many-requests') {
      await logAudit('Password Change Failed', 'Too many password change attempts', 'security', auth.currentUser?.uid, null, null, 'failure');
      showValidationMessage('Too many attempts. Please try again later', 'error');
    } else {
      await logAudit('Password Change Failed', `Error: ${error.message}`, 'security', auth.currentUser?.uid, null, null, 'failure');
      showValidationMessage('Error changing password: ' + error.message, 'error');
    }
    
    // Reset button
    const changeBtn = document.querySelector('#changePasswordForm button[type="button"]');
    changeBtn.innerHTML = originalText;
    changeBtn.disabled = false;
  }
};

// Validation message function
function showValidationMessage(message, type = 'info') {
  const messageContainer = document.getElementById('validationMessage');
  if (!messageContainer) {
    // Create message container if it doesn't exist
    const container = document.createElement('div');
    container.id = 'validationMessage';
    container.className = `validation-message ${type}`;
    container.innerHTML = `
      <div class="message-content">
        <span class="message-icon">${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
        <span class="message-text">${message}</span>
      </div>
    `;
    
    // Insert after the form
    const form = document.getElementById('changePasswordForm');
    if (form) {
      form.parentNode.insertBefore(container, form.nextSibling);
    }
  } else {
    messageContainer.className = `validation-message ${type}`;
    messageContainer.innerHTML = `
      <div class="message-content">
        <span class="message-icon">${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
        <span class="message-text">${message}</span>
      </div>
    `;
  }
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    const container = document.getElementById('validationMessage');
    if (container) {
      container.style.opacity = '0';
      setTimeout(() => container.remove(), 300);
    }
  }, 5000);
}

// Reset password feedback
function resetPasswordFeedback() {
  const strengthIndicator = document.getElementById('passwordStrengthIndicator');
  const requirementsList = document.getElementById('passwordRequirements');
  const matchIndicator = document.getElementById('passwordMatchIndicator');
  
  if (strengthIndicator) {
    strengthIndicator.style.display = 'none';
  }
  if (requirementsList) {
    requirementsList.innerHTML = '';
  }
  if (matchIndicator) {
    matchIndicator.style.display = 'none';
  }
}

// Add real-time password validation event listeners
document.addEventListener('DOMContentLoaded', function() {
  const newPasswordInput = document.getElementById('newPassword');
  const confirmPasswordInput = document.getElementById('confirmPassword');
  const sessionTimeoutInput = document.getElementById('sessionTimeout');
  
  if (newPasswordInput) {
    newPasswordInput.addEventListener('input', function() {
      const password = this.value;
      const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';
      updatePasswordFeedback(password, confirmPassword);
    });
  }
  
  if (confirmPasswordInput) {
    confirmPasswordInput.addEventListener('input', function() {
      const newPassword = newPasswordInput ? newPasswordInput.value : '';
      const confirmPassword = this.value;
      updatePasswordFeedback(newPassword, confirmPassword);
    });
  }
  
  // Enhanced session timeout UI feedback
  if (sessionTimeoutInput) {
    sessionTimeoutInput.addEventListener('input', function() {
      const value = parseInt(this.value);
      let feedbackElement = document.getElementById('sessionTimeoutFeedback');
      
      if (!feedbackElement) {
        // Create feedback element if it doesn't exist
        const feedback = document.createElement('div');
        feedback.id = 'sessionTimeoutFeedback';
        feedback.className = 'session-timeout-feedback';
        this.parentNode.appendChild(feedback);
        feedbackElement = feedback;
      }
      
      if (value < 15) {
        feedbackElement.className = 'session-timeout-feedback error';
        feedbackElement.innerHTML = `
          <span class="feedback-icon">⚠️</span>
          <span class="feedback-text">Minimum 15 minutes required for security</span>
        `;
      } else if (value > 480) {
        feedbackElement.className = 'session-timeout-feedback error';
        feedbackElement.innerHTML = `
          <span class="feedback-icon">⚠️</span>
          <span class="feedback-text">Maximum 480 minutes (8 hours) allowed</span>
        `;
      } else if (value >= 15 && value <= 60) {
        feedbackElement.className = 'session-timeout-feedback warning';
        feedbackElement.innerHTML = `
          <span class="feedback-icon">ℹ️</span>
          <span class="feedback-text">Short session timeout - users will be logged out quickly</span>
        `;
      } else if (value > 240) {
        feedbackElement.className = 'session-timeout-feedback warning';
        feedbackElement.innerHTML = `
          <span class="feedback-icon">ℹ️</span>
          <span class="feedback-text">Long session timeout - consider security implications</span>
        `;
      } else {
        feedbackElement.className = 'session-timeout-feedback success';
        feedbackElement.innerHTML = `
          <span class="feedback-icon">✓</span>
          <span class="feedback-text">Good session timeout balance</span>
        `;
      }
    });
    
    // Trigger initial feedback
    sessionTimeoutInput.dispatchEvent(new Event('input'));
  }
});

// View user details
window.viewUser = async function(userId) {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (userDoc.exists()) {
      const user = userDoc.data();
      const userDetailsDiv = document.getElementById('userDetails');
      
      const displayName = user.firstName && user.surname 
        ? `${user.firstName} ${user.surname}` 
        : 'N/A';
      const createdDate = user.createdAt ? formatDate(user.createdAt) : 'N/A';
      const userStatus = user.status || 'active';
      const statusClass = userStatus === 'active' ? 'approved' : 'rejected';
      
      userDetailsDiv.innerHTML = `
        <div class="detail-row">
          <div class="detail-label">Name:</div>
          <div class="detail-value">${displayName}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Email:</div>
          <div class="detail-value">${user.email}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Role:</div>
          <div class="detail-value">
            <span class="status-badge ${user.role === 'admin' ? 'approved' : user.role === 'staff' ? 'pending' : 'under-review'}">${user.role}</span>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Status:</div>
          <div class="detail-value">
            <span class="status-badge ${statusClass}">${userStatus}</span>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Created:</div>
          <div class="detail-value">${createdDate}</div>
        </div>
        ${user.firstName ? `
        <div class="detail-row">
          <div class="detail-label">First Name:</div>
          <div class="detail-value">${user.firstName}</div>
        </div>
        ` : ''}
        ${user.surname ? `
        <div class="detail-row">
          <div class="detail-label">Surname:</div>
          <div class="detail-value">${user.surname}</div>
        </div>
        ` : ''}
      `;
      
      if (viewUserModal) {
        viewUserModal.style.display = 'flex';
      }
    }
  } catch (error) {
    console.error('Error loading user data:', error);
    alert('Error loading user data');
  }
};

// Deactivate user
let userToDeactivate = null;
window.deactivateUser = function(userId) {
  userToDeactivate = userId;
  
  // Get user info for display
  getDoc(doc(db, 'users', userId)).then((userDoc) => {
    if (userDoc.exists()) {
      const user = userDoc.data();
      const userInfo = document.getElementById('deactivateUserInfo');
      if (userInfo) {
        userInfo.textContent = `User: ${user.email}`;
      }
    }
  });
  
  if (deactivateUserModal) {
    deactivateUserModal.style.display = 'flex';
  }
};

// Cancel deactivate
const cancelDeactivate = document.getElementById('cancelDeactivate');
if (cancelDeactivate) {
  cancelDeactivate.addEventListener('click', () => {
    if (deactivateUserModal) {
      deactivateUserModal.style.display = 'none';
    }
    userToDeactivate = null;
  });
}

// Confirm deactivate
const confirmDeactivate = document.getElementById('confirmDeactivate');
if (confirmDeactivate) {
  confirmDeactivate.addEventListener('click', async () => {
    if (userToDeactivate) {
      try {
        const userRef = doc(db, 'users', userToDeactivate);
        await updateDoc(userRef, {
          status: 'inactive',
          updatedAt: serverTimestamp()
        });
        
        alert('User deactivated successfully');
        if (deactivateUserModal) {
          deactivateUserModal.style.display = 'none';
        }
        userToDeactivate = null;
        
        // Reload users
        const activeTab = document.querySelector('.user-tab.active');
        if (activeTab) {
          loadUsers(activeTab.dataset.userType);
        }
      } catch (error) {
        console.error('Error deactivating user:', error);
        alert('Error deactivating user');
      }
    }
  });
}

// Load users for Manage Users section
async function loadUsers(userType) {
  const tbody = document.getElementById('usersTable');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px;">Loading users...</td></tr>';
  
  try {
    const usersRef = collection(db, 'users');
    let q;
    
    if (userType === 'staff') {
      q = query(usersRef, where('role', '==', 'staff'));
    } else if (userType === 'customer') {
      q = query(usersRef, where('role', '==', 'customer'));
    } else {
      q = query(usersRef);
    }
    
    const querySnapshot = await getDocs(q);
    
    tbody.innerHTML = '';
    
    if (querySnapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#666;">No users found</td></tr>';
      return;
    }
    
    querySnapshot.forEach((doc) => {
      const user = doc.data();
      const row = document.createElement('tr');
      
      const displayName = user.firstName && user.surname 
        ? `${user.firstName} ${user.surname}` 
        : user.email.split('@')[0];
      
      const createdDate = user.createdAt ? formatDate(user.createdAt) : 'N/A';
      const userStatus = user.status || 'active';
      const statusClass = userStatus === 'active' ? 'approved' : 'rejected';
      
      row.innerHTML = `
        <td>${displayName}</td>
        <td>${user.email}</td>
        <td><span class="status-badge ${user.role === 'admin' ? 'approved' : user.role === 'staff' ? 'pending' : 'under-review'}">${user.role}</span></td>
        <td><span class="status-badge ${statusClass}">${userStatus}</span></td>
        <td>${createdDate}</td>
        <td>
          <div class="table-actions">
            <button class="btn-view" onclick="viewUser('${doc.id}')">View</button>
            <button class="btn-deactivate" onclick="deactivateUser('${doc.id}')">Deactivate</button>
          </div>
        </td>
      `;
      
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Error loading users:', error);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#ef4444;">Error loading users</td></tr>';
  }
}

// User management functions
window.viewUserDetails = function(userId) {
  alert('View user details for: ' + userId);
};

window.editUser = function(userId) {
  alert('Edit user: ' + userId);
};

window.deactivateUser = function(userId) {
  if (confirm('Are you sure you want to deactivate this user?')) {
    alert('User deactivated: ' + userId);
  }
};

async function loadAuditLogs() {
  const tbody = document.getElementById('auditLogsTable');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px;">Loading audit logs...</td></tr>';
  
  try {
    const auditLogsRef = collection(db, 'auditLogs');
    const q = query(auditLogsRef, orderBy('timestamp', 'desc'), limit(500));
    const querySnapshot = await getDocs(q);
    
    tbody.innerHTML = '';
    
    // Get filter values
    const searchValue = document.getElementById('auditSearchInput')?.value?.toLowerCase() || '';
    const categoryFilter = document.getElementById('auditCategoryFilter')?.value || 'all';
    const actionFilter = document.getElementById('auditActionFilter')?.value || 'all';
    const dateFrom = document.getElementById('auditDateFrom')?.value;
    const dateTo = document.getElementById('auditDateTo')?.value;
    
    // Count logs by type
    let totalLogs = 0;
    let approvalLogs = 0;
    let rejectionLogs = 0;
    let accountLogs = 0;
    let userActivityLogs = 0;
    let systemChangeLogs = 0;
    let dataChangeLogs = 0;
    let securityEventLogs = 0;
    
    let filteredLogs = [];
    
    querySnapshot.forEach(doc => {
      const log = doc.data();
      
      // Apply filters
      if (searchValue) {
        const searchableText = `${log.user} ${log.action} ${log.details} ${log.category}`.toLowerCase();
        if (!searchableText.includes(searchValue)) return;
      }
      
      if (categoryFilter !== 'all' && log.category !== categoryFilter) return;
      
      if (actionFilter !== 'all') {
        const actionLower = log.action.toLowerCase();
        if (actionFilter === 'login' && !actionLower.includes('login')) return;
        if (actionFilter === 'logout' && !actionLower.includes('logout')) return;
        if (actionFilter === 'password' && !actionLower.includes('password')) return;
        if (actionFilter === 'create' && !actionLower.includes('create')) return;
        if (actionFilter === 'update' && !actionLower.includes('update')) return;
        if (actionFilter === 'delete' && !actionLower.includes('delete')) return;
        if (actionFilter === 'approve' && !actionLower.includes('approve')) return;
        if (actionFilter === 'reject' && !actionLower.includes('reject')) return;
      }
      
      if (dateFrom) {
        const logDate = log.timestamp ? log.timestamp.toDate() : new Date();
        const fromDate = new Date(dateFrom);
        if (logDate < fromDate) return;
      }
      
      if (dateTo) {
        const logDate = log.timestamp ? log.timestamp.toDate() : new Date();
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59);
        if (logDate > toDate) return;
      }
      
      filteredLogs.push({ id: doc.id, ...log });
      
      // Count by category
      if (log.category === 'user') userActivityLogs++;
      if (log.category === 'system') systemChangeLogs++;
      if (log.category === 'data') dataChangeLogs++;
      if (log.category === 'security') securityEventLogs++;
      
      // Count by action
      if (log.action.toLowerCase().includes('approved')) approvalLogs++;
      if (log.action.toLowerCase().includes('rejected')) rejectionLogs++;
      if (log.action.toLowerCase().includes('account') || log.action.toLowerCase().includes('password')) accountLogs++;
    });
    
    totalLogs = filteredLogs.length;
    
    // Display filtered logs
    filteredLogs.forEach(log => {
      const row = document.createElement('tr');
      const date = log.timestamp ? log.timestamp.toDate() : new Date();
      const formattedDate = date.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      
      let actionClass = 'info';
      if (log.action.toLowerCase().includes('approved')) actionClass = 'success';
      if (log.action.toLowerCase().includes('rejected')) actionClass = 'danger';
      if (log.action.toLowerCase().includes('deleted') || log.action.toLowerCase().includes('removed')) actionClass = 'danger';
      if (log.action.toLowerCase().includes('updated') || log.action.toLowerCase().includes('edited')) actionClass = 'warning';
      if (log.action.toLowerCase().includes('created')) actionClass = 'success';
      if (log.status === 'failure') actionClass = 'danger';
      
      // Category badge
      const categoryColors = {
        'user': 'blue',
        'system': 'purple',
        'data': 'green',
        'access': 'cyan',
        'security': 'red',
        'system_events': 'orange'
      };
      const categoryColor = categoryColors[log.category] || 'gray';
      
      row.innerHTML = `
        <td>${formattedDate}</td>
        <td>${log.user || 'Unknown'}</td>
        <td><span class="audit-action-${actionClass}">${log.action}</span></td>
        <td>${log.details || '-'}</td>
        <td><span class="audit-ip">${log.ip || 'N/A'}</span></td>
        <td>
          <button class="btn-view" onclick="viewAuditLogDetails('${log.id}')" style="padding: 6px 12px; font-size: 12px; cursor: pointer; background: #3b82f6; color: white; border: none; border-radius: 4px;">
            👁️ View
          </button>
        </td>
      `;
      tbody.appendChild(row);
    });
    
    // Update summary counts
    const totalLogsCount = document.getElementById('totalLogsCount');
    const approvalLogsCount = document.getElementById('approvalLogsCount');
    const rejectionLogsCount = document.getElementById('rejectionLogsCount');
    const accountLogsCount = document.getElementById('accountLogsCount');
    
    if (totalLogsCount) totalLogsCount.textContent = totalLogs;
    if (approvalLogsCount) approvalLogsCount.textContent = approvalLogs;
    if (rejectionLogsCount) rejectionLogsCount.textContent = rejectionLogs;
    if (accountLogsCount) accountLogsCount.textContent = accountLogs;
    
    if (totalLogs === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px;">No audit logs found matching your filters</td></tr>';
    }
  } catch (error) {
    console.error('Error loading audit logs:', error);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#ef4444;">Error loading audit logs</td></tr>';
  }
}

// Create audit log entry
async function createAuditLog(action, details) {
  try {
    if (!auth.currentUser) return;
    
    const auditLog = {
      timestamp: serverTimestamp(),
      user: auth.currentUser.email || 'Unknown',
      action: action,
      details: details,
      ip: 'N/A' // Can be enhanced to capture real IP if needed
    };
    
    await addDoc(collection(db, 'auditLogs'), auditLog);
    console.log('Audit log created:', action);
  } catch (error) {
    console.error('Error creating audit log:', error);
  }
}

// Apply audit log filters
window.applyAuditFilters = function() {
  loadAuditLogs();
};

// Track page access
async function trackPageAccess(section) {
  try {
    const user = auth.currentUser;
    if (!user) return;
    
    await logAudit(
      'Page Access',
      `User accessed ${section} section`,
      'access',
      section,
      null,
      { section, timestamp: new Date().toISOString() },
      'success'
    );
  } catch (error) {
    console.error('Error tracking page access:', error);
  }
}

// Clear audit log filters
window.clearAuditFilters = function() {
  const searchInput = document.getElementById('auditSearchInput');
  const categoryFilter = document.getElementById('auditCategoryFilter');
  const actionFilter = document.getElementById('auditActionFilter');
  const dateFrom = document.getElementById('auditDateFrom');
  const dateTo = document.getElementById('auditDateTo');
  
  if (searchInput) searchInput.value = '';
  if (categoryFilter) categoryFilter.value = 'all';
  if (actionFilter) actionFilter.value = 'all';
  if (dateFrom) dateFrom.value = '';
  if (dateTo) dateTo.value = '';
  
  loadAuditLogs();
};

// View audit log details
window.viewAuditLogDetails = async function(logId) {
  try {
    const docRef = doc(db, 'auditLogs', logId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      alert('Audit log not found');
      return;
    }
    
    const log = docSnap.data();
    const timestamp = log.timestamp ? log.timestamp.toDate() : new Date();
    const formattedTimestamp = timestamp.toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); justify-content: center; align-items: center; z-index: 10000;';
    
    modal.innerHTML = `
      <div class="modal-content" style="background: white; padding: 32px; border-radius: 12px; max-width: 600px; max-height: 80vh; overflow-y: auto; width: 90%;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <h2 style="margin: 0; font-size: 24px;">Audit Log Details</h2>
          <button onclick="this.closest('.modal').remove()" style="background: none; border: none; font-size: 24px; cursor: pointer;">&times;</button>
        </div>
        
        <div style="display: grid; gap: 16px;">
          <div>
            <label style="font-weight: 600; color: #666;">Timestamp</label>
            <div style="padding: 8px; background: #f3f4f6; border-radius: 4px;">${formattedTimestamp}</div>
          </div>
          
          <div>
            <label style="font-weight: 600; color: #666;">User</label>
            <div style="padding: 8px; background: #f3f4f6; border-radius: 4px;">${log.user || 'Unknown'}</div>
          </div>
          
          <div>
            <label style="font-weight: 600; color: #666;">Email</label>
            <div style="padding: 8px; background: #f3f4f6; border-radius: 4px;">${log.email || 'N/A'}</div>
          </div>
          
          <div>
            <label style="font-weight: 600; color: #666;">Category</label>
            <div style="padding: 8px; background: #f3f4f6; border-radius: 4px;">${log.category || 'user'}</div>
          </div>
          
          <div>
            <label style="font-weight: 600; color: #666;">Action</label>
            <div style="padding: 8px; background: #f3f4f6; border-radius: 4px;">${log.action || 'Unknown'}</div>
          </div>
          
          <div>
            <label style="font-weight: 600; color: #666;">Details</label>
            <div style="padding: 8px; background: #f3f4f6; border-radius: 4px; white-space: pre-wrap;">${log.details || '-'}</div>
          </div>
          
          <div>
            <label style="font-weight: 600; color: #666;">Status</label>
            <div style="padding: 8px; background: ${log.status === 'success' ? '#dcfce7' : '#fee2e2'}; border-radius: 4px; color: ${log.status === 'success' ? '#166534' : '#991b1b'};">${log.status || 'success'}</div>
          </div>
          
          <div>
            <label style="font-weight: 600; color: #666;">Resource ID</label>
            <div style="padding: 8px; background: #f3f4f6; border-radius: 4px;">${log.resourceId || 'N/A'}</div>
          </div>
          
          <div>
            <label style="font-weight: 600; color: #666;">IP Address</label>
            <div style="padding: 8px; background: #f3f4f6; border-radius: 4px;">${log.ip || 'N/A'}</div>
          </div>
          
          <div>
            <label style="font-weight: 600; color: #666;">Module</label>
            <div style="padding: 8px; background: #f3f4f6; border-radius: 4px;">${log.module || 'N/A'}</div>
          </div>
          
          ${log.beforeData ? `
          <div>
            <label style="font-weight: 600; color: #666;">Before Data</label>
            <div style="padding: 8px; background: #fef3c7; border-radius: 4px; white-space: pre-wrap; font-size: 12px;">${JSON.stringify(log.beforeData, null, 2)}</div>
          </div>
          ` : ''}
          
          ${log.afterData ? `
          <div>
            <label style="font-weight: 600; color: #666;">After Data</label>
            <div style="padding: 8px; background: #dcfce7; border-radius: 4px; white-space: pre-wrap; font-size: 12px;">${JSON.stringify(log.afterData, null, 2)}</div>
          </div>
          ` : ''}
        </div>
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
    
    document.body.appendChild(modal);
  } catch (error) {
    console.error('Error viewing audit log details:', error);
    alert('Error loading audit log details');
  }
};

// Load audit logs to Excel with professional formatting using SheetJS
window.exportAuditLogsToExcel = async function() {
  try {
    const auditLogsRef = collection(db, 'auditLogs');
    const q = query(auditLogsRef, orderBy('timestamp', 'desc'), limit(1000));
    const querySnapshot = await getDocs(q);
    
    const logs = [];
    querySnapshot.forEach(doc => {
      const log = doc.data();
      logs.push({
        timestamp: log.timestamp ? log.timestamp.toDate() : new Date(),
        user: log.user || 'Unknown',
        action: log.action || 'Unknown',
        details: log.details || '-',
        ip: log.ip || 'N/A'
      });
    });
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // Prepare data for Excel
    const header = ['Timestamp', 'User', 'Action', 'Details', 'IP Address'];
    const data = logs.map(log => {
      const formattedDate = log.timestamp.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      return [formattedDate, log.user, log.action, log.details, log.ip];
    });

    // Add title and metadata rows
    const worksheetData = [
      ['DENR CENRO Sta. Cruz'],
      ['Audit Logs Report'],
      [],
      [`Generated: ${new Date().toLocaleString('en-US')}`],
      [`Total Records: ${logs.length}`],
      [],
      header,
      ...data
    ];
  
  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(worksheetData);
  
  // Set column widths
  ws['!cols'] = [
    { wch: 25 }, // Timestamp
    { wch: 30 }, // User
    { wch: 25 }, // Action
    { wch: 50 }  // Details
  ];
  
  // Add styling to cells
  const range = XLSX.utils.decode_range(ws['!ref']);
  
  // Style title row (row 0)
  ws['A1'].s = {
    font: { bold: true, sz: 16, color: { rgb: '1E5631' } },
    alignment: { horizontal: 'center' }
  };
  
  // Style subtitle row (row 1)
  ws['A2'].s = {
    font: { bold: true, sz: 12, color: { rgb: '666666' } },
    alignment: { horizontal: 'center' }
  };
  
  // Style metadata rows
  ws['A4'].s = { font: { sz: 10, color: { rgb: '666666' } } };
  ws['A5'].s = { font: { sz: 10, color: { rgb: '666666' } } };
  
  // Style header row (row 6)
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const cellAddress = XLSX.utils.encode_cell({ r: 6, c: C });
    if (ws[cellAddress]) {
      ws[cellAddress].s = {
        font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '1E5631' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: {
          top: { style: 'thin', color: { rgb: '000000' } },
          bottom: { style: 'thin', color: { rgb: '000000' } },
          left: { style: 'thin', color: { rgb: '000000' } },
          right: { style: 'thin', color: { rgb: '000000' } }
        }
      };
    }
  }
  
  // Style data rows with alternating colors
  for (let R = 7; R <= range.e.r; ++R) {
    const isEven = (R - 7) % 2 === 0;
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws[cellAddress]) {
        ws[cellAddress].s = {
          font: { sz: 10 },
          fill: { fgColor: { rgb: isEven ? 'F9FAFB' : 'FFFFFF' } },
          alignment: { vertical: 'center', wrapText: true },
          border: {
            top: { style: 'thin', color: { rgb: 'E5E7EB' } },
            bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
            left: { style: 'thin', color: { rgb: 'E5E7EB' } },
            right: { style: 'thin', color: { rgb: 'E5E7EB' } }
          }
        };
      }
    }
  }
  
  // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Audit Logs');

    // Generate and download file
    const timestamp = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `DENR_Audit_Logs_${timestamp}.xlsx`);

    alert('Audit logs exported successfully');
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    alert('Error exporting audit logs. Please try again.');
  }
};

// User tabs functionality
const userTabs = document.querySelectorAll('.user-tab');
userTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    userTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    const userType = tab.getAttribute('data-user-type');
    loadUsers(userType);
  });
});

// Create staff button
const createStaffBtn = document.getElementById('createStaffBtn');
if (createStaffBtn) {
  createStaffBtn.addEventListener('click', openCreateStaffModal);
}

// Application filters
const appStatusFilter = document.getElementById('appStatusFilter');
const appTypeFilter = document.getElementById('appTypeFilter');
const appSearchInput = document.getElementById('appSearchInput');

if (appStatusFilter) {
  appStatusFilter.addEventListener('change', filterApplications);
}
if (appTypeFilter) {
  appTypeFilter.addEventListener('change', filterApplications);
}
if (appSearchInput) {
  appSearchInput.addEventListener('input', filterApplications);
}

function filterApplications() {
  const tbody = document.getElementById('allApplicationsTable');
  const visibleCountEl = document.getElementById('visibleCount');
  const totalCountEl = document.getElementById('totalCount');
  
  if (!tbody || !allApplications || allApplications.length === 0) return;
  
  // Get filter values
  const statusFilter = document.getElementById('appStatusFilter')?.value || 'all';
  const typeFilter = document.getElementById('appTypeFilter')?.value || 'all';
  const searchValue = document.getElementById('appSearchInput')?.value?.toLowerCase() || '';
  
  // Filter applications
  let filteredApplications = allApplications.filter(app => {
    // Status filter
    if (statusFilter !== 'all' && app.status !== statusFilter) {
      return false;
    }
    
    // Type filter
    if (typeFilter !== 'all' && app.permitType !== typeFilter) {
      return false;
    }
    
    // Search filter
    if (searchValue) {
      const searchText = `${app.applicationId || ''} ${app.applicantName || ''}`.toLowerCase();
      if (!searchText.includes(searchValue)) {
        return false;
      }
    }
    
    return true;
  });
  
  // Clear existing content
  tbody.innerHTML = '';
  
  // Update counts
  if (totalCountEl) totalCountEl.textContent = allApplications.length;
  if (visibleCountEl) visibleCountEl.textContent = filteredApplications.length;
  
  // Display filtered applications (limit to 5 for display)
  const displayApps = filteredApplications.slice(0, 5);
  
  if (displayApps.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#666;">No applications found matching your filters</td></tr>';
    return;
  }
  
  displayApps.forEach((app) => {
    const row = document.createElement('tr');
    
    const statusClass = getStatusClass(app.status);
    const dateFormatted = formatDate(app.createdAt);
    
    row.innerHTML = `
      <td>${app.applicationId || 'N/A'}</td>
      <td>${app.applicantName || 'N/A'}</td>
      <td>${app.permitType || 'N/A'}</td>
      <td>${dateFormatted}</td>
      <td><span class="status-badge ${statusClass}">${app.status || 'PENDING'}</span></td>
      <td>
        <div class="table-actions">
          <button class="btn-action view" onclick="viewApplication('${app.id}')">View</button>
        </div>
      </td>
    `;
    
    tbody.appendChild(row);
  });
  
  console.log(`Filtered ${filteredApplications.length} applications from ${allApplications.length} total`);
}
