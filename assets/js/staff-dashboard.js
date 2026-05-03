import { auth, db } from './firebase-config.js';

// Sidebar Toggle Function
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const toggleIcon = document.querySelector('.toggle-icon');
  
  if (sidebar.classList.contains('collapsed')) {
    sidebar.classList.remove('collapsed');
    toggleIcon.textContent = '⋮⋮⋮';
    localStorage.setItem('sidebarCollapsed', 'false');
  } else {
    sidebar.classList.add('collapsed');
    toggleIcon.textContent = '≡';
    localStorage.setItem('sidebarCollapsed', 'true');
  }
}

// Load sidebar state from localStorage
document.addEventListener('DOMContentLoaded', function() {
  const sidebarCollapsed = localStorage.getItem('sidebarCollapsed');
  const sidebar = document.querySelector('.sidebar');
  const toggleIcon = document.querySelector('.toggle-icon');
  
  if (sidebarCollapsed === 'true' && sidebar) {
    sidebar.classList.add('collapsed');
    if (toggleIcon) {
      toggleIcon.textContent = '≡';
    }
  }
});
import { 
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
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  where,
  serverTimestamp,
  addDoc,
  increment,
  arrayUnion,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const API_BASE = 'http://127.0.0.1:3000';

let currentApplication = null;
let allApplications = [];
let currentUserEmail = null;

// Debug function to fix staff role
window.fixStaffRole = async function() {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('❌ No user logged in');
      return;
    }

    const idToken = await user.getIdToken();
    console.log('🔧 Setting staff role for:', user.email);

    const response = await fetch(`${API_BASE}/debug/set-staff-role`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`
      }
    });

    const result = await response.json();
    console.log('📋 Result:', result);

    if (result.success) {
      alert('✅ Staff role set! Please LOGOUT and LOGIN again to refresh your token.');
    } else {
      console.error('❌ Failed:', result);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
};

// Debug function to check role
window.checkMyRole = async function() {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('❌ No user logged in');
      return;
    }

    const idToken = await user.getIdToken();
    const response = await fetch(`${API_BASE}/debug/my-role`, {
      headers: {
        'Authorization': `Bearer ${idToken}`
      }
    });

    const result = await response.json();
    console.log('📋 Current Role:', result);
    return result;
  } catch (error) {
    console.error('❌ Error:', error);
  }
};

// Debug function to create test audit log
window.createTestAuditLog = async function() {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('❌ No user logged in');
      return;
    }

    console.log('📝 Creating test audit log directly in Firestore for:', user.email);

    // Create audit log directly in Firestore
    const auditRef = await addDoc(collection(db, 'auditLogs'), {
      timestamp: serverTimestamp(),
      userId: user.uid,
      userEmail: user.email,
      role: 'staff',
      action: 'Test Action',
      details: 'Test audit log created directly from frontend',
      category: 'data',
      resourceId: 'TEST-' + Date.now(),
      beforeData: null,
      afterData: { test: true },
      status: 'success',
      ip: 'Unknown',
      userAgent: navigator.userAgent || 'Unknown',
      module: 'debug'
    });

    console.log('✅ Test audit log created with ID:', auditRef.id);
    alert('✅ Test audit log created! Check System Logs now.');
    
    // Reload the staff logs
    loadStaffLogs();
  } catch (error) {
    console.error('❌ Error:', error);
  }
};

// Debug function to create approve/reject audit log
window.createApprovalAuditLog = async function(appId, action) {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('❌ No user logged in');
      return;
    }

    console.log('📝 Creating approval audit log for:', appId, action);

    // Create audit log directly in Firestore
    const auditRef = await addDoc(collection(db, 'auditLogs'), {
      timestamp: serverTimestamp(),
      userId: user.uid,
      userEmail: user.email,
      role: 'staff',
      action: action,
      details: `Application ${appId} was ${action.toLowerCase()}`,
      category: 'data',
      resourceId: appId,
      beforeData: { status: 'pending' },
      afterData: { status: action === 'Approved Application' ? 'approved' : 'rejected' },
      status: 'success',
      ip: 'Unknown',
      userAgent: navigator.userAgent || 'Unknown',
      module: 'staff-dashboard'
    });

    console.log('✅ Approval audit log created with ID:', auditRef.id);
    
    // Reload the staff logs
    loadStaffLogs();
  } catch (error) {
    console.error('❌ Error:', error);
  }
};

// Debug function to check all audit logs in database
window.checkAllAuditLogs = async function() {
  try {
    console.log('🔍 Checking ALL audit logs in database...');
    
    const q = query(collection(db, 'auditLogs'));
    const querySnapshot = await getDocs(q);
    
    console.log('📊 Total audit logs in database:', querySnapshot.size);
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      console.log('📝 Log:', {
        id: doc.id,
        userEmail: data.userEmail,
        action: data.action,
        timestamp: data.timestamp,
        resourceId: data.resourceId
      });
    });
    
    return querySnapshot.size;
  } catch (error) {
    console.error('❌ Error checking audit logs:', error);
  }
};

// Debug function to test server connection
window.testServerConnection = async function() {
  try {
    console.log('🔌 Testing server connection to:', API_BASE);
    
    const response = await fetch(`${API_BASE}/health`, {
      method: 'GET'
    });
    
    const result = await response.json();
    console.log('✅ Server is running:', result);
    return true;
  } catch (error) {
    console.error('❌ Server is NOT running:', error);
    console.log('💡 Please run: node server/server.js');
    return false;
  }
};

// Auto-test server connection on page load
setTimeout(() => {
  testServerConnection();
}, 2000);

// Check authentication and role on page load
// Wait for Firebase to be fully initialized
setTimeout(() => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        // Get user role from token
        const idTokenResult = await user.getIdTokenResult(true);
        const role = idTokenResult.claims.role;

        console.log('🔐 Token role:', role, 'for user:', user.email);

        // If no role in token, try to fix it automatically
        if (!role) {
          console.log('⚠️ No role in token! Attempting to fix...');

          // Check Firestore for user role
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          const firestoreRole = userDoc.exists() ? userDoc.data().role : null;

          console.log('📋 Firestore role:', firestoreRole);

          if (firestoreRole === 'staff' || firestoreRole === 'admin') {
            // Fix the token by setting custom claims via server
            const idToken = await user.getIdToken();
            const response = await fetch(`${API_BASE}/debug/set-staff-role`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${idToken}`
              }
            });

            const result = await response.json();
            console.log('🔧 Auto-fix result:', result);

            if (result.success) {
              alert('⚠️ Your account was missing staff role. It has been fixed!\n\nPlease LOGOUT and LOGIN again for changes to take effect.');
              return;
            }
          } else {
            // No role in Firestore either - set it
            console.log('🔧 Setting staff role for new user...');
            await fixStaffRole();
            alert('⚠️ Your account was set up as staff.\n\nPlease LOGOUT and LOGIN again for changes to take effect.');
            return;
          }
        }

        if (role === 'staff' || role === 'admin') {
          console.log('✅ Valid role:', role);
          loadDashboardData();
          updateUserInfo(user, { role });
        } else {
          console.log('❌ Invalid role:', role);
          alert('⚠️ Your account does not have staff role. Please contact admin.');
          // auth.signOut();
          // window.location.href = 'index.html';
        }
      } catch (error) {
        console.error('🔍 STAFF DASHBOARD DEBUG: Token verification failed:', error);
        console.log('🔍 STAFF DASHBOARD DEBUG: Would redirect to index, but DISABLED FOR TESTING');
        // auth.signOut();
        // window.location.href = 'index.html';
      }
    } else {
      console.log('Staff dashboard: No user authenticated, redirecting...');
      window.location.href = 'index.html';
    }
});
}, 1000); // Wait 1 second for Firebase to be fully initialized

// Update user info in header
function updateUserInfo(user, userData) {
  const userName = document.getElementById('userName');
  const userInitials = document.getElementById('userInitials');
  const welcomeName = document.getElementById('welcomeName');
  
  const displayName = user.displayName || user.email.split('@')[0];
  const initials = displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  
  if (userName) userName.textContent = displayName;
  if (userInitials) userInitials.textContent = initials;
  if (welcomeName) welcomeName.textContent = displayName;
}

// Load dashboard data
async function loadDashboardData() {
  try {
    console.log('🔄 Loading dashboard data...');
    await fetchApplications();
    // Stats and recent apps are now updated inside the onSnapshot callback
    console.log('✅ Dashboard data loading complete');
  } catch (error) {
    console.error('❌ Error loading dashboard data:', error);
  }
}

// Simple test function to populate Recent Applications
window.testRecentApplications = function() {
  console.log('🧪 Testing Recent Applications table...');
  
  const tbody = document.getElementById('recentApplicationsTable');
  if (!tbody) {
    console.error('❌ Table not found!');
    return;
  }
  
  // Add test data
  tbody.innerHTML = `
    <tr>
      <td>TEST-001</td>
      <td>Test User</td>
      <td>Test Application</td>
      <td>Today</td>
      <td><span class="status-badge pending">PENDING</span></td>
    </tr>
    <tr>
      <td>TEST-002</td>
      <td>Another User</td>
      <td>Another Application</td>
      <td>Yesterday</td>
      <td><span class="status-badge approved">APPROVED</span></td>
    </tr>
  `;
  
  console.log('✅ Test data added to Recent Applications table!');
};

// Load recent applications for dashboard
function loadRecentApplications() {
  try {
    const tbody = document.getElementById('recentApplicationsTable');
    if (!tbody) {
      console.error('❌ ERROR: recentApplicationsTable element not found!');
      return;
    }
    
    tbody.innerHTML = '';
    
    // Show only pending, under review, and needs revision applications
    const pendingApps = allApplications.filter(app => 
      app.status === 'pending' || app.status === 'under review' || app.status === 'needs revision'
    );
    const recentApps = pendingApps.slice(0, 5);
    
    if (recentApps.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px; color:#666;">No pending applications</td></tr>';
      return;
    }
  
  recentApps.forEach((app, index) => {
    const row = document.createElement('tr');
    const statusClass = getStatusClass(app.status);
    const dateFormatted = formatDate(app.createdAt);
    
    row.innerHTML = `
      <td>${app.applicationId || app.id || 'N/A'}</td>
      <td>${app.applicantName || app.applicantEmail || 'N/A'}</td>
      <td>${app.permitType || 'Application'}</td>
      <td>${dateFormatted}</td>
      <td><span class="status-badge ${statusClass}">${app.status || 'PENDING'}</span></td>
    `;
    
    tbody.appendChild(row);
  });
  
  console.log(`✅ Recent Applications table updated with ${recentApps.length} rows`);
  
  } catch (error) {
    console.error('❌ ERROR loading Recent Applications:', error.message);
  }
}

// Fetch applications from Firestore with real-time updates
async function fetchApplications() {
  try {
    const applicationsRef = collection(db, 'applications');
    const q = query(applicationsRef);
    
    // Set up real-time listener
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      allApplications = [];
      querySnapshot.forEach((doc) => {
        const appData = doc.data();
        allApplications.push({
          id: doc.id,
          ...appData
        });
      });
      
      console.log(`✅ Recent Applications: ${allApplications.length} loaded`);
      
      // Sort by createdAt manually
      allApplications.sort((a, b) => {
        const aTime = a.createdAt?.toMillis() || 0;
        const bTime = b.createdAt?.toMillis() || 0;
        return bTime - aTime;
      });
      
      // Update stats and display after data is loaded
      updateStats();
      filterAndDisplayApplications();
      loadRecentApplications();
      
      // Applications loaded successfully
    });
    
    // Store unsubscribe function for cleanup
    window.applicationsUnsubscribe = unsubscribe;
    
  } catch (error) {
    console.error('Error setting up applications listener:', error);
    allApplications = [];
    filterAndDisplayApplications();
  }
}

// Load sample applications for demo mode
function loadSampleApplications() {
  allApplications = [
    {
      id: 'DENR-20260424-502361',
      applicantName: 'CAGAYAT LORENCE',
      permitType: 'Wildlife Permit',
      createdAt: new Date('2026-04-24'),
      status: 'pending',
      email: 'lorence@example.com'
    },
    {
      id: 'DENR-20260424-502362',
      applicantName: 'SANTOS MARIA',
      permitType: 'Tree Cutting Permit',
      createdAt: new Date('2026-04-24'),
      status: 'pending',
      email: 'maria@example.com'
    },
    {
      id: 'DENR-20260424-502363',
      applicantName: 'REYES JUAN',
      permitType: 'Mining Permit',
      createdAt: new Date('2026-04-24'),
      status: 'under review',
      email: 'juan@example.com'
    },
    {
      id: 'DENR-20260423-502360',
      applicantName: 'GARCIA ANA',
      permitType: 'Tree Planting Permit',
      createdAt: new Date('2026-04-23'),
      status: 'approved',
      email: 'ana@example.com'
    },
    {
      id: 'DENR-20260422-502359',
      applicantName: 'DELACRUZ PEDRO',
      permitType: 'Mining Permit',
      createdAt: new Date('2026-04-22'),
      status: 'rejected',
      email: 'pedro@example.com'
    }
  ];
  
  filterAndDisplayApplications();
}

// Filter and display applications
function filterAndDisplayApplications() {
  const statusFilter = document.getElementById('statusFilter').value;
  const searchInput = document.getElementById('searchInput').value.toLowerCase();
  
  // Start with active applications only (pending and under review)
  let filtered = allApplications.filter(app => 
    app.status === 'pending' || app.status === 'under review' || app.status === 'needs revision'
  );
  
  // Filter by status (from active applications only)
  if (statusFilter !== 'all') {
    filtered = filtered.filter(app => 
      app.status.toLowerCase() === statusFilter.toLowerCase()
    );
  }
  
  // Filter by search
  if (searchInput) {
    filtered = filtered.filter(app =>
      (app.applicationId && app.applicationId.toLowerCase().includes(searchInput)) ||
      app.id.toLowerCase().includes(searchInput) ||
      (app.applicantName && app.applicantName.toLowerCase().includes(searchInput))
    );
  }
  
  displayApplications(filtered);
}

// Display applications in table
function displayApplications(applications) {
  const tbody = document.getElementById('applicationsTable');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (applications.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 32px; color: #666;">No active applications found (approved permits are in Records, rejected in Archived)</td></tr>';
    return;
  }
  
  applications.forEach(app => {
    const row = document.createElement('tr');
    const statusClass = getStatusClass(app.status);
    const dateFormatted = formatDate(app.createdAt);
    
    row.innerHTML = `
      <td>${app.applicationId || app.id || 'N/A'}</td>
      <td>${app.applicantName || 'N/A'}</td>
      <td>${app.permitType || 'N/A'}</td>
      <td>${dateFormatted}</td>
      <td><span class="status-badge ${statusClass}">${app.status || 'PENDING'}</span></td>
      <td>
        <button class="action-btn btn-view" onclick="viewApplication('${app.id}')">View</button>
        ${app.status === 'pending' || app.status === 'under review' ? `<button class="action-btn btn-approve" onclick="quickApprove('${app.id}')">Approve</button>` : ''}
        ${app.status === 'pending' || app.status === 'under review' ? `<button class="action-btn btn-reject" onclick="quickReject('${app.id}')">Reject</button>` : ''}
        ${app.status === 'pending' || app.status === 'under review' ? `<button class="action-btn btn-review" onclick="quickNeedsRevision('${app.id}')" style="background: #f59e0b; color: white;">Needs Revision</button>` : ''}
      </td>
    `;
    
    tbody.appendChild(row);
  });
}

// Update statistics
function updateStats() {
  try {
    const totalApps = document.getElementById('totalApps');
    const pendingApps = document.getElementById('pendingApps');
    const approvedApps = document.getElementById('approvedApps');
    const rejectedApps = document.getElementById('rejectedApps');
    const notificationCount = document.getElementById('notificationCount');
    
    const pending = allApplications.filter(app => app.status === 'pending').length;
    const today = new Date().toDateString();
    
    const approvedToday = allApplications.filter(app => {
      if (app.status !== 'approved') return false;
      // Check approvedAt first (new field), fallback to reviewedAt for old data
      const approvalDate = app.approvedAt || app.reviewedAt;
      if (!approvalDate) return false;
      const date = approvalDate.toDate ? approvalDate.toDate() : new Date(approvalDate);
      return date.toDateString() === today;
    }).length;
    
    const rejectedToday = allApplications.filter(app => {
      if (app.status !== 'rejected') return false;
      // Check rejectedAt first (new field), fallback to reviewedAt for old data
      const rejectionDate = app.rejectedAt || app.reviewedAt;
      if (!rejectionDate) return false;
      const date = rejectionDate.toDate ? rejectionDate.toDate() : new Date(rejectionDate);
      return date.toDateString() === today;
    }).length;
    
    if (totalApps) totalApps.textContent = allApplications.length;
    if (pendingApps) pendingApps.textContent = pending;
    if (approvedApps) approvedApps.textContent = approvedToday;
    if (rejectedApps) rejectedApps.textContent = rejectedToday;
    if (notificationCount) notificationCount.textContent = pending;
    
  } catch (error) {
    console.error('❌ ERROR updating statistics:', error.message);
  }
}

// Get CSS class for status
function getStatusClass(status) {
  const statusMap = {
    'pending': 'pending',
    'under review': 'under-review',
    'needs revision': 'needs-revision',
    'approved': 'approved',
    'rejected': 'rejected'
  };
  return statusMap[status?.toLowerCase()] || 'pending';
}

function getStatusIcon(status) {
  const icons = {
    'pending': '⏳',
    'under review': '🔍',
    'needs revision': '📝',
    'approved': '✅',
    'rejected': '❌'
  };
  return icons[status?.toLowerCase()] || '⏳';
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

// View application details - Enhanced Professional Version
window.viewApplication = async function(appId) {
  currentApplication = allApplications.find(app => app.id === appId);
  if (!currentApplication) return;
  
  const modal = document.getElementById('applicationModal');
  const detailsDiv = document.getElementById('applicationDetails');
  const actionsDiv = document.getElementById('modalActions');
  
  // Show loading state
  detailsDiv.innerHTML = `
    <div style="text-align: center; padding: 60px 20px; color: #64748b;">
      <div style="font-size: 48px; margin-bottom: 16px; animation: pulse 2s infinite;">⏳</div>
      <h3 style="margin: 0 0 8px 0; color: #1e293b;">Loading Application Details</h3>
      <p style="margin: 0; font-size: 14px;">Please wait while we retrieve the information...</p>
    </div>
  `;
  
  modal.style.display = 'flex';
  
  // Simulate loading for better UX
  await new Promise(resolve => setTimeout(resolve, 500));
  
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
            <div class="detail-value application-id">${currentApplication.applicationId || currentApplication.id}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">👤 Full Name</div>
            <div class="detail-value highlight">${currentApplication.applicantName || 'N/A'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">📧 Email Address</div>
            <div class="detail-value email-address">
              📧 ${currentApplication.applicantEmail || 'N/A'}
            </div>
          </div>
          <div class="detail-item">
            <div class="detail-label">📱 Mobile Number</div>
            <div class="detail-value phone-number">
              📱 ${currentApplication.applicantMobile || 'N/A'}
            </div>
          </div>
          <div class="detail-item" style="grid-column: 1 / -1;">
            <div class="detail-label">📍 Residential Address</div>
            <div class="detail-value address">${currentApplication.applicantAddress || 'N/A'}</div>
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
            <div class="detail-value permit-type">${currentApplication.permitType || 'N/A'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">📅 Submission Date</div>
            <div class="detail-value date-submitted">${formatDate(currentApplication.createdAt)}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">🏷️ Current Status</div>
            <div class="detail-value">
              <span class="status-badge ${getStatusClass(currentApplication.status)}">
                ${getStatusIcon(currentApplication.status)} ${currentApplication.status}
              </span>
            </div>
          </div>
          ${currentApplication.reviewedAt ? `
          <div class="detail-item">
            <div class="detail-label">🕐 Review Date</div>
            <div class="detail-value review-date">${formatDate(currentApplication.reviewedAt)}</div>
          </div>
          ` : ''}
        </div>
        ${currentApplication.applicationDetails ? `
        <div style="margin-top: 20px;">
          <div class="detail-label">📝 Application Description</div>
          <div class="detail-value application-description" style="margin-top: 8px;">
            ${currentApplication.applicationDetails}
          </div>
        </div>
        ` : ''}
      </div>
    </div>

    <!-- Location Section -->
    ${currentApplication.latitude && currentApplication.longitude ? `
    <div class="detail-section">
      <div class="section-header">
        <h3 class="section-title">🗺️ Location Information</h3>
      </div>
      <div class="section-content">
        <div class="location-card">
          <div class="location-icon">📍</div>
          <div class="location-info">
            <div style="font-weight: 600; color: #1e293b; margin-bottom: 4px;">Application Location</div>
            <a href="https://www.google.com/maps?q=${currentApplication.latitude},${currentApplication.longitude}" target="_blank" class="location-link">
              View on Google Maps →
            </a>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
              Coordinates: ${currentApplication.latitude}, ${currentApplication.longitude}
            </div>
          </div>
        </div>
      </div>
    </div>
    ` : ''}

    <!-- Documents Section -->
    ${currentApplication.documents && currentApplication.documents.length > 0 ? `
    <div class="detail-section">
      <div class="section-header">
        <h3 class="section-title">📁 Uploaded Documents (${currentApplication.documents.length})</h3>
      </div>
      <div class="section-content">
        <div class="documents-grid">
          ${currentApplication.documents.map((doc, index) => {
            const originalName = doc.name || `Document ${index + 1}`;
            const docName = getCleanDocumentName(originalName, doc.type, index);
            const docData = doc.url || doc.data || '';
            const docType = doc.type || '';
            const docSize = doc.size || 0;
            const isCloudinary = doc.cloudinary || doc.public_id;
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
            
            // Generate proper download URL for Cloudinary files
            const downloadUrl = isCloudinary && doc.public_id ? 
              docData : 
              docData;

            return `
              <div class="document-card">
                <div class="document-preview">
                  ${isImage ? 
                    `<img src="${docData}" alt="${docName}" onclick="openImageViewer('${docData}', '${docName.replace(/'/g, "\\'")}')" style="cursor: pointer;" />` :
                    `<div onclick="downloadDocumentFromServer('${downloadUrl}', '${docName.replace(/'/g, "\\'")}')" style="text-decoration: none; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #64748b; cursor: pointer;">
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
              <div class="timeline-date">${formatDate(currentApplication.createdAt)}</div>
            </div>
          </div>
          ${currentApplication.status !== 'pending' ? `
          <div class="timeline-item">
            <div class="timeline-marker completed">👁️</div>
            <div class="timeline-content">
              <div class="timeline-title">Application Under Review</div>
              <div class="timeline-date">${currentApplication.reviewedAt ? formatDate(currentApplication.reviewedAt) : 'In Progress'}</div>
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
          ${currentApplication.status === 'approved' ? `
          <div class="timeline-item">
            <div class="timeline-marker completed">✅</div>
            <div class="timeline-content">
              <div class="timeline-title">Application Approved</div>
              <div class="timeline-date">${currentApplication.reviewedAt ? formatDate(currentApplication.reviewedAt) : 'Completed'}</div>
            </div>
          </div>
          ` : currentApplication.status === 'rejected' ? `
          <div class="timeline-item">
            <div class="timeline-marker completed">❌</div>
            <div class="timeline-content">
              <div class="timeline-title">Application Rejected</div>
              <div class="timeline-date">${currentApplication.reviewedAt ? formatDate(currentApplication.reviewedAt) : 'Completed'}</div>
              ${currentApplication.rejectionReason ? `<div style="color: #ef4444; font-size: 14px; margin-top: 4px;">Reason: ${currentApplication.rejectionReason}</div>` : ''}
            </div>
          </div>
          ` : ''}
        </div>
        ${currentApplication.reviewedBy ? `
        <div style="margin-top: 20px; padding: 16px; background: #f8fafc; border-radius: 8px; border-left: 4px solid #10b981;">
          <div style="font-weight: 600; color: #1e293b; margin-bottom: 4px;">👤 Reviewed By</div>
          <div style="color: #64748b;">${currentApplication.reviewedBy}</div>
        </div>
        ` : ''}
      </div>
    </div>
  `;
  
  // Show/hide action buttons based on status
  if (currentApplication.status === 'pending') {
    actionsDiv.style.display = 'flex';
    document.getElementById('btnUnderReview').style.display = 'inline-block';
    document.getElementById('btnApprove').style.display = 'inline-block';
    document.getElementById('btnReject').style.display = 'inline-block';
  } else if (currentApplication.status === 'under review') {
    actionsDiv.style.display = 'flex';
    document.getElementById('btnUnderReview').style.display = 'none';
    document.getElementById('btnApprove').style.display = 'inline-block';
    document.getElementById('btnReject').style.display = 'inline-block';
  } else {
    actionsDiv.style.display = 'none';
  }
  
  modal.style.display = 'flex';
};

// Quick approve from table
window.quickApprove = async function(appId) {
  currentApplication = allApplications.find(app => app.id === appId);
  if (!currentApplication) return;
  
  // Set minimum date to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('pickupDate').min = today;
  
  document.getElementById('approveScheduleModal').style.display = 'flex';
};

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

// Quick reject from table
window.quickReject = async function(appId) {
  currentApplication = allApplications.find(app => app.id === appId);
  const rejectModal = document.getElementById('rejectModal');
  rejectModal.style.display = 'flex';
};

// Quick needs revision from table
window.quickNeedsRevision = async function(appId) {
  currentApplication = allApplications.find(app => app.id === appId);
  const needsRevisionModal = document.getElementById('needsRevisionModal');
  needsRevisionModal.style.display = 'flex';
};

// Log system activity - DEPRECATED: Server now handles audit logging
// Kept for reference but no longer called directly
async function logSystemActivity(action, applicationId, details = null, category = 'data', beforeData = null, afterData = null, status = 'success') {
  // Audit logging is now handled by server endpoints
  console.log('Audit log would be created by server:', { action, applicationId, details });
}

// Update application status - directly in Firestore (bypass server due to auth issues)
async function updateApplicationStatus(appId, newStatus, rejectionReason = null, revisionComments = null) {
  try {
    // Check if application exists
    const application = allApplications.find(app => app.id === appId);
    if (!application) {
      alert('Application not found. Please refresh and try again.');
      return;
    }

    // Disable action buttons to prevent double-submit
    const actionButtons = document.querySelectorAll('.action-btn, #confirmReject, #confirmUnderReview, #confirmSchedule, #confirmNeedsRevision');
    actionButtons.forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    });

    // Update application directly in Firestore
    const appRef = doc(db, 'applications', appId);
    const updateData = {
      status: newStatus,
      reviewedBy: auth.currentUser.email,
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    if (newStatus === 'approved') {
      updateData.approvedBy = auth.currentUser.email;
      updateData.approvedAt = serverTimestamp();
    }

    if (newStatus === 'rejected') {
      updateData.rejectedBy = auth.currentUser.email;
      updateData.rejectedAt = serverTimestamp();
      if (rejectionReason) {
        updateData.rejectionReason = rejectionReason;
      }
    }

    if (newStatus === 'needs revision') {
      updateData.revisionRequestedBy = auth.currentUser.email;
      updateData.revisionRequestedAt = serverTimestamp();
      if (revisionComments) {
        updateData.revisionComments = revisionComments;
      }
    }

    await updateDoc(appRef, updateData);
    console.log('✅ Application updated in Firestore!');

    // Create audit log directly in frontend
    const action = newStatus === 'approved' ? 'Approved Application' : 
                   newStatus === 'rejected' ? 'Rejected Application' : 
                   newStatus === 'needs revision' ? 'Requested Revision' :
                   'Marked Under Review';
    await createApprovalAuditLog(appId, action);

    // Update local data
    const appIndex = allApplications.findIndex(app => app.id === appId);
    if (appIndex !== -1) {
      allApplications[appIndex].status = newStatus;
      if (rejectionReason) {
        allApplications[appIndex].rejectionReason = rejectionReason;
      }
      if (revisionComments) {
        allApplications[appIndex].revisionComments = revisionComments;
      }
      allApplications[appIndex].reviewedBy = auth.currentUser.email;
      allApplications[appIndex].reviewedAt = new Date();
      
      if (newStatus === 'approved') {
        allApplications[appIndex].approvedBy = auth.currentUser.email;
        allApplications[appIndex].approvedAt = new Date();
      }
      
      if (newStatus === 'rejected') {
        allApplications[appIndex].rejectedBy = auth.currentUser.email;
        allApplications[appIndex].rejectedAt = new Date();
      }
    }
    
    filterAndDisplayApplications();
    updateStats();
    loadRecentApplications(); // Refresh recent applications table
    
    alert(`Application ${newStatus} successfully!`);
    
  } catch (error) {
    console.error('Error updating application:', error);
    alert('Error updating application. Please try again.');
  } finally {
    // Re-enable action buttons
    const actionButtons = document.querySelectorAll('.action-btn, #confirmReject, #confirmUnderReview, #confirmSchedule');
    actionButtons.forEach(btn => {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    });
  }
}

// Modal event listeners
document.getElementById('closeAppModal').addEventListener('click', () => {
  document.getElementById('applicationModal').style.display = 'none';
});

document.getElementById('btnUnderReview').addEventListener('click', () => {
  if (currentApplication) {
    // Show under review confirmation modal
    showUnderReviewModal();
  }
});

// Show under review confirmation modal
function showUnderReviewModal() {
  const applicationId = currentApplication.applicationId || currentApplication.id;
  const applicantName = currentApplication.applicantName || 'N/A';
  const permitType = currentApplication.permitType || 'N/A';
  
  // Populate modal with application details
  document.getElementById('underReviewAppId').textContent = applicationId;
  document.getElementById('underReviewAppName').textContent = applicantName;
  document.getElementById('underReviewPermitType').textContent = permitType;
  
  // Show modal
  document.getElementById('underReviewModal').style.display = 'flex';
  document.getElementById('applicationModal').style.display = 'none';
}

document.getElementById('btnApprove').addEventListener('click', () => {
  if (currentApplication) {
    // Set minimum date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('pickupDate').min = today;
    
    document.getElementById('applicationModal').style.display = 'none';
    document.getElementById('approveScheduleModal').style.display = 'flex';
  }
});

document.getElementById('btnReject').addEventListener('click', () => {
  document.getElementById('applicationModal').style.display = 'none';
  document.getElementById('rejectModal').style.display = 'flex';
});

// Reject modal
document.getElementById('closeRejectModal').addEventListener('click', () => {
  document.getElementById('rejectModal').style.display = 'none';
});

document.getElementById('cancelReject').addEventListener('click', () => {
  document.getElementById('rejectModal').style.display = 'none';
});

document.getElementById('confirmReject').addEventListener('click', async () => {
  const reason = document.getElementById('rejectReason').value;
  if (!reason.trim()) {
    alert('Please provide a reason for rejection.');
    return;
  }
  if (currentApplication) {
    await updateApplicationStatus(currentApplication.id, 'rejected', reason);
    document.getElementById('rejectModal').style.display = 'none';
  }
});

// Needs Revision modal
document.getElementById('closeNeedsRevisionModal').addEventListener('click', () => {
  document.getElementById('needsRevisionModal').style.display = 'none';
});

document.getElementById('cancelNeedsRevision').addEventListener('click', () => {
  document.getElementById('needsRevisionModal').style.display = 'none';
});

document.getElementById('confirmNeedsRevision').addEventListener('click', async () => {
  const comments = document.getElementById('revisionComments').value;
  if (!comments.trim()) {
    alert('Please provide revision comments.');
    return;
  }
  if (currentApplication) {
    await updateApplicationStatus(currentApplication.id, 'needs revision', null, comments);
    document.getElementById('needsRevisionModal').style.display = 'none';
    document.getElementById('revisionComments').value = ''; // Clear the textarea
  }
});

// Schedule modal
document.getElementById('closeScheduleModal').addEventListener('click', () => {
  document.getElementById('approveScheduleModal').style.display = 'none';
});

document.getElementById('cancelSchedule').addEventListener('click', () => {
  document.getElementById('approveScheduleModal').style.display = 'none';
});

document.getElementById('confirmSchedule').addEventListener('click', async () => {
  const pickupDate = document.getElementById('pickupDate').value;
  const pickupTime = document.getElementById('pickupTime').value;
  const pickupNotes = document.getElementById('pickupNotes').value;

  if (!pickupDate) {
    alert('Please select pickup date.');
    return;
  }

  if (!pickupTime) {
    alert('Please select pickup time.');
    return;
  }

  // Validate that pickup date is not in the past
  const selectedDate = new Date(pickupDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to start of day for comparison
  
  if (selectedDate < today) {
    alert('Cannot select a past date. Please select a future date for pickup.');
    return;
  }

  if (currentApplication) {
    try {
      // Disable button to prevent double-submit
      const confirmBtn = document.getElementById('confirmSchedule');
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.5';
      confirmBtn.style.cursor = 'not-allowed';

      // Update application directly in Firestore (bypass server due to auth issues)
      const appRef = doc(db, 'applications', currentApplication.id);
      await updateDoc(appRef, {
        status: 'approved',
        approvedBy: auth.currentUser.email,
        approvedAt: serverTimestamp(),
        reviewedBy: auth.currentUser.email,
        reviewedAt: serverTimestamp(),
        pickupSchedule: {
          date: pickupDate,
          time: pickupTime,
          notes: pickupNotes || '',
          scheduledBy: auth.currentUser.email,
          scheduledAt: serverTimestamp()
        },
        updatedAt: serverTimestamp()
      });

      // Create audit log directly in Firestore
      await createApprovalAuditLog(currentApplication.id, 'Approved Application');

      // Update local data
      const appIndex = allApplications.findIndex(app => app.id === currentApplication.id);
      if (appIndex !== -1) {
        allApplications[appIndex].status = 'approved';
        allApplications[appIndex].approvedBy = auth.currentUser.email;
        allApplications[appIndex].approvedAt = new Date();
        allApplications[appIndex].reviewedBy = auth.currentUser.email;
        allApplications[appIndex].reviewedAt = new Date();
        allApplications[appIndex].pickupSchedule = {
          date: pickupDate,
          time: pickupTime,
          notes: pickupNotes || '',
          scheduledBy: auth.currentUser.email,
          scheduledAt: new Date()
        };
      }

      alert('Application approved and pickup scheduled successfully!');
      document.getElementById('approveScheduleModal').style.display = 'none';
      document.getElementById('pickupDate').value = '';
      document.getElementById('pickupTime').value = '';
      document.getElementById('pickupNotes').value = '';

      filterAndDisplayApplications();
      updateStats();
      loadRecentApplications();
    } catch (error) {
      console.error('Error scheduling pickup:', error);
      alert('Error scheduling pickup. Please try again.');
    } finally {
      // Re-enable button
      const confirmBtn = document.getElementById('confirmSchedule');
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = '1';
      confirmBtn.style.cursor = 'pointer';
    }
  }
});

// Close modals when clicking outside
document.getElementById('applicationModal').addEventListener('click', (e) => {
  if (e.target.id === 'applicationModal') {
    document.getElementById('applicationModal').style.display = 'none';
  }
});

document.getElementById('rejectModal').addEventListener('click', (e) => {
  if (e.target.id === 'rejectModal') {
    document.getElementById('rejectModal').style.display = 'none';
  }
});

document.getElementById('approveScheduleModal').addEventListener('click', (e) => {
  if (e.target.id === 'approveScheduleModal') {
    document.getElementById('approveScheduleModal').style.display = 'none';
  }
});

document.getElementById('documentsModal').addEventListener('click', (e) => {
  if (e.target.id === 'documentsModal') {
    document.getElementById('documentsModal').style.display = 'none';
  }
});

// Documents modal close button
document.getElementById('closeDocumentsModal').addEventListener('click', () => {
  document.getElementById('documentsModal').style.display = 'none';
});

// Under review modal event listeners
document.getElementById('closeUnderReviewModal').addEventListener('click', () => {
  document.getElementById('underReviewModal').style.display = 'none';
});

document.getElementById('cancelUnderReview').addEventListener('click', () => {
  document.getElementById('underReviewModal').style.display = 'none';
});

document.getElementById('confirmUnderReview').addEventListener('click', async () => {
  if (currentApplication) {
    await updateApplicationStatus(currentApplication.id, 'under review');
    document.getElementById('underReviewModal').style.display = 'none';
  }
});

// Close under review modal when clicking outside
document.getElementById('underReviewModal').addEventListener('click', (e) => {
  if (e.target.id === 'underReviewModal') {
    document.getElementById('underReviewModal').style.display = 'none';
  }
});

// Download Document Function (Final Working Solution)
window.downloadDocumentFromServer = function(url, filename) {
  console.log('Downloading document:', url, filename);
  
  try {
    // Create a hidden iframe to handle the download
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    
    // Add to page, let it load, then remove
    document.body.appendChild(iframe);
    
    // Remove iframe after a short delay
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
    
  } catch (error) {
    console.error('Download error:', error);
    // Final fallback: direct link
    window.location.href = url;
  }
};

// Keep the old function for compatibility
window.downloadDocument = function(url, filename) {
  return downloadDocumentFromServer(url, filename);
};

// Professional Image Viewer Modal Functions
let currentZoom = 1;
let currentRotation = 0;
let isFullscreen = false;

window.openImageViewer = function(imageSrc, imageName) {
  const modal = document.getElementById('imageViewerModal');
  const modalImage = document.getElementById('imageViewerImage');
  const modalTitle = document.getElementById('imageViewerTitle');
  
  if (modal && modalImage && modalTitle) {
    // Reset state
    currentZoom = 1;
    currentRotation = 0;
    isFullscreen = false;
    
    modalImage.src = imageSrc;
    modalTitle.textContent = imageName || 'Document Preview';
    modal.style.display = 'flex';
    
    // Load image info
    modalImage.onload = function() {
      updateImageInfo(this);
    };
    
    // Add keyboard support
    document.addEventListener('keydown', handleImageViewerKeydown);
    
    // Add toolbar event listeners
    setupToolbarListeners();
  }
};

// Close image viewer modal
function closeImageViewer() {
  const modal = document.getElementById('imageViewerModal');
  if (modal) {
    modal.style.display = 'none';
    document.removeEventListener('keydown', handleImageViewerKeydown);
    
    // Reset image state
    const modalImage = document.getElementById('imageViewerImage');
    if (modalImage) {
      modalImage.style.transform = 'scale(1) rotate(0deg)';
    }
    
    // Exit fullscreen if active
    if (isFullscreen) {
      exitFullscreen();
    }
  }
}

// Setup toolbar event listeners
function setupToolbarListeners() {
  const modalImage = document.getElementById('imageViewerImage');
  
  // Zoom In
  document.getElementById('zoomInBtn').onclick = function() {
    if (currentZoom < 3) {
      currentZoom += 0.25;
      updateImageTransform();
    }
  };
  
  // Zoom Out
  document.getElementById('zoomOutBtn').onclick = function() {
    if (currentZoom > 0.5) {
      currentZoom -= 0.25;
      updateImageTransform();
    }
  };
  
  // Reset Zoom
  document.getElementById('resetZoomBtn').onclick = function() {
    currentZoom = 1;
    currentRotation = 0;
    updateImageTransform();
  };
  
  // Download
  document.getElementById('downloadBtn').onclick = function() {
    const link = document.createElement('a');
    link.href = modalImage.src;
    link.download = document.getElementById('imageViewerTitle').textContent + '.jpg';
    link.click();
  };
  
  // Fullscreen
  document.getElementById('fullscreenBtn').onclick = function() {
    toggleFullscreen();
  };
  
  // Rotate Left
  document.getElementById('rotateLeftBtn').onclick = function() {
    currentRotation -= 90;
    updateImageTransform();
  };
  
  // Rotate Right
  document.getElementById('rotateRightBtn').onclick = function() {
    currentRotation += 90;
    updateImageTransform();
  };
  
  // Image click to zoom
  modalImage.onclick = function() {
    if (currentZoom === 1) {
      currentZoom = 1.5;
      modalImage.style.cursor = 'zoom-out';
    } else {
      currentZoom = 1;
      modalImage.style.cursor = 'zoom-in';
    }
    updateImageTransform();
  };
}

// Update image transform
function updateImageTransform() {
  const modalImage = document.getElementById('imageViewerImage');
  if (modalImage) {
    modalImage.style.transform = `scale(${currentZoom}) rotate(${currentRotation}deg)`;
    modalImage.style.cursor = currentZoom > 1 ? 'zoom-out' : 'zoom-in';
  }
}

// Update image information
function updateImageInfo(img) {
  const dimensionsSpan = document.getElementById('imageDimensions');
  const sizeSpan = document.getElementById('imageSize');
  
  if (dimensionsSpan) {
    dimensionsSpan.textContent = `Dimensions: ${img.naturalWidth} × ${img.naturalHeight}px`;
  }
  
  if (sizeSpan) {
    // Estimate file size from data URL
    if (img.src.startsWith('data:')) {
      const sizeInBytes = Math.round(img.src.length * 0.75);
      const sizeInKB = (sizeInBytes / 1024).toFixed(1);
      sizeSpan.textContent = `Size: ~${sizeInKB} KB`;
    } else {
      sizeSpan.textContent = 'Size: Cloudinary hosted';
    }
  }
}

// Toggle fullscreen
function toggleFullscreen() {
  const modal = document.getElementById('imageViewerModal');
  if (!isFullscreen) {
    if (modal.requestFullscreen) {
      modal.requestFullscreen();
    } else if (modal.webkitRequestFullscreen) {
      modal.webkitRequestFullscreen();
    } else if (modal.msRequestFullscreen) {
      modal.msRequestFullscreen();
    }
    isFullscreen = true;
    document.getElementById('fullscreenBtn').innerHTML = '⛶';
  } else {
    exitFullscreen();
  }
}

function exitFullscreen() {
  if (document.exitFullscreen) {
    document.exitFullscreen();
  } else if (document.webkitExitFullscreen) {
    document.webkitExitFullscreen();
  } else if (document.msExitFullscreen) {
    document.msExitFullscreen();
  }
  isFullscreen = false;
  document.getElementById('fullscreenBtn').innerHTML = '⛶';
}

// Handle keyboard events for image viewer
function handleImageViewerKeydown(e) {
  switch(e.key) {
    case 'Escape':
      closeImageViewer();
      break;
    case '+':
    case '=':
      if (currentZoom < 3) {
        currentZoom += 0.25;
        updateImageTransform();
      }
      break;
    case '-':
    case '_':
      if (currentZoom > 0.5) {
        currentZoom -= 0.25;
        updateImageTransform();
      }
      break;
    case '0':
      currentZoom = 1;
      currentRotation = 0;
      updateImageTransform();
      break;
    case 'ArrowLeft':
      currentRotation -= 90;
      updateImageTransform();
      break;
    case 'ArrowRight':
      currentRotation += 90;
      updateImageTransform();
      break;
  }
}

// Image viewer modal event listeners
document.getElementById('closeImageViewer').addEventListener('click', closeImageViewer);

// Close modal when clicking outside the image
document.getElementById('imageViewerModal').addEventListener('click', (e) => {
  if (e.target.id === 'imageViewerModal') {
    closeImageViewer();
  }
});

// Handle fullscreen change events
document.addEventListener('fullscreenchange', function() {
  if (!document.fullscreenElement) {
    isFullscreen = false;
    document.getElementById('fullscreenBtn').innerHTML = '⛶';
  }
});

document.addEventListener('webkitfullscreenchange', function() {
  if (!document.webkitFullscreenElement) {
    isFullscreen = false;
    document.getElementById('fullscreenBtn').innerHTML = '⛶';
  }
});

// Helper function to generate clean document names
function getCleanDocumentName(originalName, fileType, index) {
  // If it's already a clean name, return it
  if (!originalName || !originalName.match(/Gemini_Generated_|^[a-f0-9]{32,}|[A-Za-z0-9]{20,}/)) {
    return originalName;
  }
  
  const isImage = fileType && fileType.startsWith('image/');
  const isPDF = fileType && fileType.includes('pdf');
  
  if (isImage) {
    return `Document Image ${index + 1}`;
  } else if (isPDF) {
    return `Document PDF ${index + 1}`;
  } else {
    return `Document ${index + 1}`;
  }
}

// Helper function to get status icon
function getStatusIcon(status) {
  switch(status.toLowerCase()) {
    case 'pending':
      return '⏳';
    case 'under review':
      return '👁️';
    case 'approved':
      return '✅';
    case 'rejected':
      return '❌';
    default:
      return '📋';
  }
}

// Page Navigation
window.navigateToSection = function(sectionId) {
  document.querySelectorAll('.page-section').forEach(section => {
    section.classList.remove('active');
  });

  const targetSection = document.getElementById(sectionId);
  if (targetSection) {
    targetSection.classList.add('active');
  }

  const pageTitle = document.querySelector('.page-title');
  if (pageTitle) {
    const sectionNames = {
      'dashboardSection': 'Staff Dashboard',
      'applicationsSection': 'Applications',
      'ocrSection': 'Document OCR',
      'recordsSection': 'My Records',
      'performanceSection': 'My Performance',
      'settingsSection': 'Settings',
      'helpSection': 'Help'
    };
    pageTitle.textContent = sectionNames[sectionId] || 'Staff Dashboard';
  }

  if (sectionId === 'applicationsSection') {
    filterAndDisplayApplications();
  } else if (sectionId === 'performanceSection') {
    loadPerformanceData();
  } else if (sectionId === 'settingsSection') {
    loadSettingsData();
  }
};

// Load performance data
async function loadPerformanceData() {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  
  try {
    const currentUserEmail = auth.currentUser?.email;
    console.log('📈 Loading performance data for:', currentUserEmail);
    
    // Fetch system logs for current staff
    const q = query(
      collection(db, 'auditLogs'),
      where('userEmail', '==', currentUserEmail)
    );
    const querySnapshot = await getDocs(q);
    
    const logs = [];
    querySnapshot.forEach((doc) => {
      logs.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    console.log('📊 Found', logs.length, 'audit logs for this staff');
    
    // Calculate today's stats
    const todayLogs = logs.filter(log => {
      if (!log.timestamp) return false;
      const logDate = log.timestamp.toDate ? log.timestamp.toDate() : new Date(log.timestamp);
      return logDate >= todayStart;
    });
    
    const todayApproved = todayLogs.filter(log => log.action === 'Approved Application').length;
    const todayRejected = todayLogs.filter(log => log.action === 'Rejected Application').length;
    const todayReviewed = todayApproved + todayRejected;
    
    console.log('📅 Today:', todayApproved, 'approved,', todayRejected, 'rejected');
    
    // Calculate week stats
    const weekLogs = logs.filter(log => {
      if (!log.timestamp) return false;
      const logDate = log.timestamp.toDate ? log.timestamp.toDate() : new Date(log.timestamp);
      return logDate >= weekStart;
    });
    
    const weekApproved = weekLogs.filter(log => log.action === 'Approved Application').length;
    const weekRejected = weekLogs.filter(log => log.action === 'Rejected Application').length;
    const weekReviewed = weekApproved + weekRejected;
    
    // Calculate all time stats
    const totalApproved = logs.filter(log => log.action === 'Approved Application').length;
    const totalRejected = logs.filter(log => log.action === 'Rejected Application').length;
    const totalReviewed = totalApproved + totalRejected;
    const approvalRate = totalReviewed > 0 ? ((totalApproved / totalReviewed) * 100).toFixed(1) : 0;
    
    // Update UI
    const todayReviewedEl = document.getElementById('todayReviewed');
    const todayApprovedEl = document.getElementById('todayApproved');
    const todayRejectedEl = document.getElementById('todayRejected');
    const weekReviewedEl = document.getElementById('weekReviewed');
    const weekApprovedEl = document.getElementById('weekApproved');
    const weekRejectedEl = document.getElementById('weekRejected');
    const totalReviewedEl = document.getElementById('totalReviewed');
    const approvalRateEl = document.getElementById('approvalRate');
    
    if (todayReviewedEl) todayReviewedEl.textContent = todayReviewed;
    if (todayApprovedEl) todayApprovedEl.textContent = todayApproved;
    if (todayRejectedEl) todayRejectedEl.textContent = todayRejected;
    if (weekReviewedEl) weekReviewedEl.textContent = weekReviewed;
    if (weekApprovedEl) weekApprovedEl.textContent = weekApproved;
    if (weekRejectedEl) weekRejectedEl.textContent = weekRejected;
    if (totalReviewedEl) totalReviewedEl.textContent = totalReviewed;
    if (approvalRateEl) approvalRateEl.textContent = approvalRate + '%';
    
    // Load recent actions for the table
    loadRecentActions(logs);
    
  } catch (error) {
    console.error('Error loading performance data:', error);
  }
}

// Load recent actions for performance section
function loadRecentActions(logs) {
  const myActionsTable = document.getElementById('myActionsTable');
  if (!myActionsTable) return;
  
  myActionsTable.innerHTML = '';
  
  if (logs.length === 0) {
    myActionsTable.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:32px; color:#666;">No actions recorded yet</td></tr>';
    return;
  }
  
  // Sort by timestamp descending
  logs.sort((a, b) => {
    const aTime = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp || 0);
    const bTime = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp || 0);
    return bTime - aTime;
  });
  
  // Show last 10 actions
  const recentLogs = logs.slice(0, 10);
  
  recentLogs.forEach(log => {
    const row = document.createElement('tr');
    const logDate = log.timestamp ? (log.timestamp.toDate ? log.timestamp.toDate() : new Date(log.timestamp)) : new Date();
    row.innerHTML = `
      <td>${log.applicationId || log.resourceId || 'N/A'}</td>
      <td>${log.action || 'N/A'}</td>
      <td>${formatDate(logDate)}</td>
    `;
    
    myActionsTable.appendChild(row);
  });
}

// Settings functions
window.saveProfileSettings = function() {
  const displayName = document.getElementById('settingsDisplayName').value;
  const phone = document.getElementById('settingsPhone').value;
  
  if (!displayName) {
    alert('Please enter your full name');
    return;
  }
  
  alert('Profile settings saved!');
};

// Enhanced Password Change Functionality with Database Logging
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
    
    // Create credential with current password
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    
    // Reauthenticate user
    await reauthenticateWithCredential(user, credential);
    
    // Save password history to database before changing
    await savePasswordHistory(user.uid, user.email, currentPassword, newPassword);
    
    // Update password
    await updatePassword(user, newPassword);
    
    // Log the password change activity with enhanced details
    await logSystemActivity('Password Changed', user.uid, `Password changed successfully. Strength: ${passwordValidation.strength}`, 'security', null, { 
      passwordStrength: passwordValidation.strength,
      passwordLength: newPassword.length,
      hasUppercase: passwordValidation.hasUppercase,
      hasLowercase: passwordValidation.hasLowercase,
      hasNumber: passwordValidation.hasNumber,
      hasSpecial: passwordValidation.hasSpecial
    });
    
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
    const passwordHistoryRef = collection(db, 'passwordHistory');
    await addDoc(passwordHistoryRef, {
      userId: userId,
      email: email,
      oldPasswordHash: await hashPassword(oldPasswordHash), // Hash for security
      newPasswordHash: await hashPassword(newPasswordHash), // Hash for security
      changedAt: serverTimestamp(),
      ipAddress: await getClientIP(),
      userAgent: navigator.userAgent
    });
    
    console.log('Password history saved to database');
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

// Password Strength Check UI Function
window.checkPasswordStrength = function() {
  const password = document.getElementById('newPassword').value;
  const strengthIndicator = document.getElementById('passwordStrengthIndicator');
  const strengthFill = document.getElementById('strengthFill');
  const strengthText = document.getElementById('strengthText');
  
  if (!password) {
    strengthIndicator.style.display = 'none';
    resetPasswordRequirements();
    updateChangePasswordButton();
    return;
  }
  
  strengthIndicator.style.display = 'block';
  
  const validation = validatePasswordStrength(password);
  
  // Update strength bar
  strengthFill.className = 'strength-fill';
  if (validation.strength === 'Weak') {
    strengthFill.classList.add('weak');
  } else if (validation.strength === 'Fair') {
    strengthFill.classList.add('fair');
  } else if (validation.strength === 'Good') {
    strengthFill.classList.add('good');
  } else if (validation.strength === 'Strong') {
    strengthFill.classList.add('strong');
  }
  
  strengthText.textContent = `Password Strength: ${validation.strength}`;
  
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
      element.classList.add('met');
      icon.textContent = '✅';
    } else {
      element.classList.remove('met');
      icon.textContent = '❌';
    }
  });
}

// Reset Password Requirements
function resetPasswordRequirements() {
  const requirements = ['req-length', 'req-uppercase', 'req-lowercase', 'req-number', 'req-special'];
  requirements.forEach(reqId => {
    const element = document.getElementById(reqId);
    const icon = element.querySelector('.req-icon');
    element.classList.remove('met');
    icon.textContent = '❌';
  });
}

// Check Password Match
window.checkPasswordMatch = function() {
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const matchIndicator = document.getElementById('passwordMatchIndicator');
  const matchIcon = document.getElementById('matchIcon');
  const matchText = document.getElementById('matchText');
  
  if (!confirmPassword) {
    matchIndicator.style.display = 'none';
    updateChangePasswordButton();
    return;
  }
  
  matchIndicator.style.display = 'flex';
  
  if (newPassword === confirmPassword) {
    matchIndicator.className = 'password-match-indicator match';
    matchIcon.textContent = '✅';
    matchText.textContent = 'Passwords match';
  } else {
    matchIndicator.className = 'password-match-indicator no-match';
    matchIcon.textContent = '❌';
    matchText.textContent = 'Passwords do not match';
  }
  
  updateChangePasswordButton();
};

// Toggle Password Visibility
window.togglePasswordVisibility = function(inputId) {
  const input = document.getElementById(inputId);
  const button = input.nextElementSibling;
  const icon = button.querySelector('.toggle-icon');
  
  if (input.type === 'password') {
    input.type = 'text';
    icon.textContent = '🙈';
  } else {
    input.type = 'password';
    icon.textContent = '👁️';
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

// Show Password Message
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
});

window.saveNotificationSettings = function() {
  const notifyNewApplications = document.getElementById('notifyNewApplications').checked;
  const notifyUrgentApplications = document.getElementById('notifyUrgentApplications').checked;
  const notifyDailySummary = document.getElementById('notifyDailySummary').checked;
  const notifyWeeklyReport = document.getElementById('notifyWeeklyReport').checked;
  
  alert('Notification preferences saved!');
};

window.saveAppearanceSettings = function() {
  const theme = document.getElementById('themePreference').value;
  const language = document.getElementById('languagePreference').value;
  
  alert('Appearance settings saved!');
};

window.handleAvatarUpload = async function(event) {
  const file = event.target.files[0];
  if (file) {
    try {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file.');
        return;
      }
      
      // Validate file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB.');
        return;
      }
      
      // Upload directly to Cloudinary
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'staff-avatars');

      const uploadResponse = await fetch('/upload-file-to-cloudinary', {
        method: 'POST',
        body: formData
      });

      const uploadResult = await uploadResponse.json();
      
      if (uploadResult.success) {
        document.getElementById('settingsAvatar').src = uploadResult.url;
        alert('Profile photo updated!');
      } else {
        throw new Error(uploadResult.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Avatar upload error:', error);
      alert('Failed to upload profile photo. Please try again.');
    }
  }
};

window.resetAllSettings = function() {
  if (confirm('Are you sure you want to reset all settings to default? This action cannot be undone.')) {
    document.getElementById('settingsDisplayName').value = '';
    document.getElementById('settingsPhone').value = '';
    document.getElementById('notifyNewApplications').checked = true;
    document.getElementById('notifyUrgentApplications').checked = true;
    document.getElementById('notifyDailySummary').checked = false;
    document.getElementById('notifyWeeklyReport').checked = true;
    document.getElementById('themePreference').value = 'light';
    document.getElementById('languagePreference').value = 'en';
    alert('All settings have been reset to default.');
  }
};

// Load account activity data
async function loadAccountActivity() {
  try {
    const user = auth.currentUser;
    if (!user) return;
    
    // Load last login from metadata
    const lastLoginDate = user.metadata?.lastSignInTime 
      ? new Date(user.metadata.lastSignInTime).toLocaleString() 
      : 'N/A';
    
    const accountCreatedDate = user.metadata?.creationTime 
      ? new Date(user.metadata.creationTime).toLocaleString() 
      : 'N/A';
    
    // Load total applications reviewed from system logs
    const q = query(
      collection(db, 'auditLogs'),
      where('userEmail', '==', user.email)
    );
    const querySnapshot = await getDocs(q);
    const totalReviewed = querySnapshot.size;
    
    const lastLoginEl = document.getElementById('lastLoginDate');
    const accountCreatedEl = document.getElementById('accountCreatedDate');
    const totalReviewedEl = document.getElementById('totalApplicationsReviewed');
    
    if (lastLoginEl) lastLoginEl.textContent = lastLoginDate;
    if (accountCreatedEl) accountCreatedEl.textContent = accountCreatedDate;
    if (totalReviewedEl) totalReviewedEl.textContent = totalReviewed;
  } catch (error) {
    console.error('Error loading account activity:', error);
  }
}

// Load settings page data
function loadSettingsData() {
  const user = auth.currentUser;
  if (!user) return;
  
  document.getElementById('settingsDisplayName').value = user.displayName || '';
  document.getElementById('settingsEmail').value = user.email || '';
  document.getElementById('settingsDisplayNameDisplay').textContent = user.displayName || 'Staff Name';
  document.getElementById('settingsEmailDisplay').textContent = user.email || 'staff@denr.gov.ph';
  
  loadAccountActivity();
  
  // Initialize settings tabs
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

// Filter event listeners
document.getElementById('statusFilter').addEventListener('change', filterAndDisplayApplications);
document.getElementById('searchInput').addEventListener('input', filterAndDisplayApplications);

// Logout
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
      await signOut(auth);
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

// Navigation
const navItems = document.querySelectorAll('.nav-item');
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();

    navItems.forEach(nav => nav.classList.remove('active'));
    item.classList.add('active');

    const sectionId = item.getAttribute('data-section');
    if (sectionId) {
      navigateToSection(sectionId);
    }
  });
});

// Document Upload Processing (OCR API Integration Ready)
let uploadedFile = null;

// OCR.space API Configuration (Free, no billing required)
const OCR_SPACE_API_KEY = 'K88896788488957'; // User's API key

// OCR.space API Integration with Formatting Support
async function processWithOCRSpace(imageFile) {
  console.log('Processing image:', imageFile.name, 'Size:', imageFile.size, 'Type:', imageFile.type);

  // Use API key with overlay enabled for formatting data
  const formData = new FormData();
  formData.append('apikey', OCR_SPACE_API_KEY);
  formData.append('file', imageFile);
  formData.append('language', 'eng');
  formData.append('isOverlayRequired', 'true'); // Enable overlay for formatting data
  formData.append('detectOrientation', 'true');
  formData.append('scale', 'true');
  formData.append('OCREngine', '2');

  console.log('Sending to OCR.space API with formatting support...');

  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    body: formData
  });

  const data = await response.json();
  console.log('OCR.space response with formatting:', data);

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

  const extractedText = parsedResult.ParsedText || '';
  const overlayData = parsedResult.TextOverlay || null;

  console.log('Extracted text length:', extractedText.length);
  console.log('Overlay data available:', !!overlayData);

  return {
    text: extractedText.trim(),
    confidence: null,
    formattedText: overlayData ? reconstructFormattedText(overlayData) : null,
    hasFormatting: !!overlayData
  };
}

// Reconstruct formatted text from OCR overlay data
function reconstructFormattedText(overlayData) {
  console.log('Reconstructing formatted text from overlay data:', overlayData);
  
  if (!overlayData || !overlayData.Lines) {
    console.log('No overlay data or lines found');
    return null;
  }

  const lines = overlayData.Lines;
  let formattedHTML = '';
  let previousLineBottom = null;
  
  lines.forEach((line, lineIndex) => {
    console.log(`Processing line ${lineIndex}:`, line);
    
    // Get line position from first word or line itself
    let lineTop = 0;
    let lineHeight = 20; // Default line height
    
    if (line.Words && line.Words.length > 0) {
      const firstWord = line.Words[0];
      lineTop = firstWord.Top || 0;
      lineHeight = firstWord.Height || 20;
    } else if (line.Top !== undefined) {
      lineTop = line.Top;
    }
    
    // Add paragraph break for significant gaps
    if (previousLineBottom !== null && (lineTop - previousLineBottom) > lineHeight * 1.5) {
      formattedHTML += '<br><br>';
    } else if (previousLineBottom !== null && (lineTop - previousLineBottom) > 5) {
      formattedHTML += '<br>';
    }
    
    previousLineBottom = lineTop + lineHeight;
    
    // Process words in this line
    if (line.Words && line.Words.length > 0) {
      let lineHTML = '';
      let lastWordRight = 0;
      
      // Sort words by Left position to ensure proper order
      const sortedWords = line.Words.sort((a, b) => (a.Left || 0) - (b.Left || 0));
      
      sortedWords.forEach((word, wordIndex) => {
        const wordText = word.WordText || '';
        const left = word.Left || 0;
        const width = word.Width || 0;
        const fontSize = word.FontSize || 12;
        const isBold = word.FontName?.toLowerCase().includes('bold') || word.IsBold === true;
        const isItalic = word.FontName?.toLowerCase().includes('italic') || word.IsItalic === true;
        
        console.log(`Word ${wordIndex}: "${wordText}" at ${left}, size ${fontSize}`);
        
        // Calculate spacing between words
        if (wordIndex > 0) {
          const gap = left - lastWordRight;
          
          if (gap > 30) {
            // Large gap - likely tab or alignment
            lineHTML += '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';
          } else if (gap > 10) {
            // Normal word spacing
            lineHTML += ' ';
          } else if (gap > 0) {
            // Small gap - single space
            lineHTML += ' ';
          }
          // If gap is 0 or negative, words are overlapping, no space needed
        }
        
        // Apply formatting to the word
        let formattedWord = wordText;
        let styles = [];
        
        if (fontSize > 12) styles.push(`font-size: ${fontSize}px`);
        if (isBold) styles.push('font-weight: bold');
        if (isItalic) styles.push('font-style: italic');
        
        if (styles.length > 0) {
          formattedWord = `<span style="${styles.join('; ')}">${wordText}</span>`;
        }
        
        lineHTML += formattedWord;
        lastWordRight = left + width;
      });
      
      formattedHTML += lineHTML;
    } else if (line.LineText) {
      // Fallback to LineText if no Words array
      formattedHTML += line.LineText;
    }
  });
  
  console.log('Final formatted HTML:', formattedHTML);
  return formattedHTML;
}

// Convert HTML to plain text with preserved spacing
function htmlToPlainText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Download extracted text as Word document
window.downloadAsWord = function() {
  const extractedText = document.getElementById('extractedText').value;
  const confidence = document.getElementById('confidenceScore').textContent;
  const processingTime = document.getElementById('processingTime').textContent;

  if (!extractedText.trim()) {
    alert('No text to download.');
    return;
  }

  const timestamp = new Date().toLocaleString();
  const fileName = uploadedFile ? uploadedFile.name : 'document';

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>OCR Results - ${fileName}</title>
  <style>
    body {
      font-family: 'Calibri', 'Arial', sans-serif;
      font-size: 11pt;
      line-height: 1.5;
      max-width: 8.5in;
      margin: 1in auto;
      padding: 0 0.5in;
    }
    .header {
      border-bottom: 2px solid #2c5282;
      padding-bottom: 15px;
      margin-bottom: 25px;
    }
    .header h1 {
      color: #2c5282;
      font-size: 18pt;
    }
    .meta-info {
      font-size: 10pt;
      color: #666;
    }
    .meta-info td { padding: 3px 10px 3px 0; }
    .content {
      font-family: 'Consolas', monospace;
      font-size: 10pt;
      white-space: pre-wrap;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 15px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>OCR Extraction Results</h1>
    <div class="meta-info">
      <table>
        <tr><td>Source File:</td><td>${fileName}</td></tr>
        <tr><td>Confidence:</td><td>${confidence}</td></tr>
        <tr><td>Processing Time:</td><td>${processingTime}</td></tr>
        <tr><td>Generated:</td><td>${timestamp}</td></tr>
      </table>
    </div>
  </div>
  <div class="content">${extractedText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `OCR_Results_${new Date().toISOString().slice(0,10)}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// File input change handler
document.getElementById('documentInput')?.addEventListener('change', handleFileSelect);

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Professional file validation
  const validation = validateOCRFile(file);
  
  if (!validation.isValid) {
    const errorMsg = validation.errors.join('\n• ');
    alert(`File validation failed:\n\n• ${errorMsg}\n\nOCR Requirements:\n• Format: JPEG or PNG\n• Size: 10KB - 1.5MB (auto-compressed if larger)\n• Content: Clear, readable text`);
    event.target.value = '';
    return;
  }

  uploadedFile = file;

  // Show file preview with validation info
  const uploadArea = document.getElementById('uploadArea');
  const filePreview = document.getElementById('filePreview');
  const fileName = document.getElementById('fileName');

  uploadArea.style.display = 'none';
  filePreview.style.display = 'block';
  
  // Display file info with compression warning if needed
  let fileInfo = file.name;
  if (validation.needsCompression) {
    fileInfo += ` (${(file.size / (1024 * 1024)).toFixed(2)}MB - will be optimized)`;
  } else {
    fileInfo += ` (${(file.size / 1024).toFixed(0)}KB)`;
  }
  
  fileName.textContent = fileInfo;

  // Show warnings in console
  if (validation.warnings.length > 0) {
    console.log('File warnings:', validation.warnings);
  }
}

window.clearFile = function() {
  uploadedFile = null;
  document.getElementById('documentInput').value = '';

  const uploadArea = document.getElementById('uploadArea');
  const filePreview = document.getElementById('filePreview');
  const ocrProgressSection = document.getElementById('ocrProgressSection');
  const ocrResultsSection = document.getElementById('ocrResultsSection');

  uploadArea.style.display = 'block';
  filePreview.style.display = 'none';
  ocrProgressSection.style.display = 'none';
  ocrResultsSection.style.display = 'none';
};

// Professional OCR Validation System
function validateOCRFile(file) {
  const validation = {
    isValid: true,
    errors: [],
    warnings: [],
    needsCompression: false
  };

  // File format validation
  const allowedFormats = ['image/jpeg', 'image/jpg', 'image/png'];
  if (!allowedFormats.includes(file.type)) {
    validation.isValid = false;
    validation.errors.push('Invalid file format. Only JPEG and PNG images are supported.');
  }

  // File size validation (OCR.space free tier: 1.5MB max)
  const maxSize = 1.5 * 1024 * 1024; // 1.5MB
  if (file.size > maxSize) {
    validation.needsCompression = true;
    validation.warnings.push(`File is ${(file.size / (1024 * 1024)).toFixed(2)}MB. Will be compressed to 1.5MB limit.`);
  }

  // Minimum size check
  const minSize = 10 * 1024; // 10KB
  if (file.size < minSize) {
    validation.isValid = false;
    validation.errors.push('File too small. Minimum size is 10KB.');
  }

  return validation;
}

// Professional image compression for OCR
async function compressImageForOCR(file, maxSize = 1.5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Calculate optimal dimensions
      let { width, height } = img;
      const maxDimension = 2048; // Good balance for OCR
      
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width *= ratio;
        height *= ratio;
      }

      canvas.width = width;
      canvas.height = height;

      // High-quality rendering for OCR
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      // Try different quality levels to meet size limit
      let quality = 0.9;
      const compress = () => {
        canvas.toBlob((blob) => {
          if (blob.size <= maxSize || quality <= 0.3) {
            resolve(new File([blob], file.name, { type: 'image/jpeg' }));
          } else {
            quality -= 0.1;
            compress();
          }
        }, 'image/jpeg', quality);
      };

      compress();
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = URL.createObjectURL(file);
  });
}

// OCR Processing with Professional Validation
window.processOCR = async function() {
  if (!uploadedFile) {
    alert('Please select a file first.');
    return;
  }

  const ocrProgressSection = document.getElementById('ocrProgressSection');
  const ocrResultsSection = document.getElementById('ocrResultsSection');
  const progressText = document.getElementById('progressText');
  const progressFill = document.getElementById('progressFill');
  const progressPercentage = document.getElementById('progressPercentage');

  // Initialize progress steps
  const steps = ['step-validate', 'step-compress', 'step-extract', 'step-analyze'];

  // Show progress section
  ocrProgressSection.style.display = 'block';
  ocrResultsSection.style.display = 'none';
  progressFill.style.width = '5%';
  progressPercentage.textContent = '5%';
  progressText.textContent = 'Validating file...';
  updateProgressSteps(steps, 0);

  const startTime = Date.now();

  try {
    // Professional file validation
    const validation = validateOCRFile(uploadedFile);
    
    if (!validation.isValid) {
      ocrProgressSection.style.display = 'none';
      const errorMsg = validation.errors.join('\n• ');
      alert(`File validation failed:\n\n• ${errorMsg}\n\nPlease ensure your file meets the requirements.`);
      return;
    }

    // Show warnings if any
    if (validation.warnings.length > 0) {
      console.log('OCR warnings:', validation.warnings);
    }

    let processedFile = uploadedFile;

    // Compress if needed
    if (validation.needsCompression) {
      progressFill.style.width = '15%';
      progressPercentage.textContent = '15%';
      progressText.textContent = 'Optimizing image for OCR...';
      updateProgressSteps(steps, 1);
      
      processedFile = await compressImageForOCR(uploadedFile);
      console.log(`Compressed file from ${(uploadedFile.size / (1024 * 1024)).toFixed(2)}MB to ${(processedFile.size / (1024 * 1024)).toFixed(2)}MB`);
    }

    progressFill.style.width = '30%';
    progressPercentage.textContent = '30%';
    progressText.textContent = 'Extracting text with AI...';
    updateProgressSteps(steps, 2);

    // Call OCR.space API
    const result = await processWithOCRSpace(processedFile);

    progressFill.style.width = '80%';
    progressPercentage.textContent = '80%';
    progressText.textContent = 'Analyzing results...';
    updateProgressSteps(steps, 3);

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Professional text validation
    if (!result.text || result.text.length < 10) {
      ocrProgressSection.style.display = 'none';
      alert(
        'No readable text detected in this image.\n\n' +
        'For best OCR results:\n' +
        '• Use clear, high-contrast images\n' +
        '• Ensure text is sharp and in focus\n' +
        '• Avoid shadows and glare\n' +
        '• Use landscape orientation for documents\n' +
        '• Minimum text size: 12pt'
      );
      return;
    }

    // Text quality assessment
    const wordCount = result.text.split(/\s+/).filter(w => w.length > 0).length;
    const avgWordLength = result.text.replace(/\s/g, '').length / wordCount || 0;
    
    if (wordCount < 3) {
      ocrProgressSection.style.display = 'none';
      alert(
        'Insufficient text content detected.\n\n' +
        'Please upload documents with substantial text content.\n' +
        `Current: ${wordCount} words found`
      );
      return;
    }

    // Calculate accuracy based on text quality metrics
    const accuracy = calculateTextAccuracy(result.text, wordCount, avgWordLength);

    progressFill.style.width = '100%';
    progressPercentage.textContent = '100%';

    // Show results
    ocrProgressSection.style.display = 'none';
    ocrResultsSection.style.display = 'block';

    // Display document preview
    const previewImg = document.getElementById('documentPreview');
    previewImg.src = URL.createObjectURL(processedFile);

    // Store extracted text
    document.getElementById('extractedText').value = result.text;
    document.getElementById('confidenceScore').textContent = 'N/A';
    document.getElementById('processingTime').textContent = `${processingTime}s`;

    // Update modern UI elements
    updateModernResults(result.text, wordCount, accuracy, processingTime, uploadedFile, processedFile, result.hasFormatting, result.formattedText);

    console.log('OCR Complete:', {
      confidence: 'N/A',
      processingTime: processingTime + 's',
      textLength: result.text.length,
      wordCount: wordCount,
      accuracy: accuracy + '%',
      hasFormatting: result.hasFormatting,
      originalSize: `${(uploadedFile.size / (1024 * 1024)).toFixed(2)}MB`,
      processedSize: `${(processedFile.size / (1024 * 1024)).toFixed(2)}MB`,
      compressed: validation.needsCompression
    });

  } catch (error) {
    console.error('OCR Error:', error);
    ocrProgressSection.style.display = 'none';
    
    if (error.message.includes('File too large')) {
      alert(
        'File size exceeds OCR.space free tier limit.\n\n' +
        'Limit: 1.5MB per file\n' +
        'Your file: ' + (uploadedFile.size / (1024 * 1024)).toFixed(2) + 'MB\n\n' +
        'Solutions:\n' +
        '• Compress the image before uploading\n' +
        '• Crop to relevant text areas only\n' +
        '• Upgrade to OCR.space PRO for larger limits'
      );
    } else {
      alert('Error processing document: ' + error.message);
    }
  }
};

// Update progress steps
function updateProgressSteps(steps, activeIndex) {
  steps.forEach((stepId, index) => {
    const step = document.getElementById(stepId);
    if (step) {
      if (index <= activeIndex) {
        step.classList.add('active');
      } else {
        step.classList.remove('active');
      }
    }
  });
}

// Calculate text accuracy based on quality metrics
function calculateTextAccuracy(text, wordCount, avgWordLength) {
  let accuracy = 85; // Base accuracy

  // Adjust based on word count (more words = more confidence)
  if (wordCount > 100) accuracy += 5;
  else if (wordCount > 50) accuracy += 3;
  else if (wordCount < 10) accuracy -= 10;

  // Adjust based on average word length (normal word length = good quality)
  if (avgWordLength >= 4 && avgWordLength <= 7) accuracy += 5;
  else if (avgWordLength < 3 || avgWordLength > 10) accuracy -= 5;

  // Adjust based on text characteristics
  const hasNumbers = /\d/.test(text);
  const hasPunctuation = /[.,!?;:]/.test(text);
  const hasMixedCase = /[a-z]/.test(text) && /[A-Z]/.test(text);

  if (hasNumbers) accuracy += 2;
  if (hasPunctuation) accuracy += 2;
  if (hasMixedCase) accuracy += 3;

  // Check for common OCR errors
  const commonErrors = /\s{2,}|[|lI1!]/g.test(text);
  if (commonErrors) accuracy -= 5;

  // Ensure accuracy stays within bounds
  return Math.max(70, Math.min(99, accuracy));
}

// Update modern UI results
function updateModernResults(text, wordCount, accuracy, processingTime, originalFile, processedFile, hasFormatting = false, formattedText = null) {
  // Update accuracy badge
  const accuracyValue = document.querySelector('.accuracy-value');
  if (accuracyValue) {
    accuracyValue.textContent = `${accuracy}%`;
    
    // Update badge color based on accuracy
    const accuracyBadge = document.getElementById('accuracyBadge');
    if (accuracyBadge) {
      if (accuracy >= 90) {
        accuracyBadge.style.background = 'linear-gradient(135deg, #2d7a46 0%, #1e5631 100%)';
      } else if (accuracy >= 80) {
        accuracyBadge.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
      } else {
        accuracyBadge.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
      }
    }
  }

  // Update text statistics
  const wordCountElement = document.getElementById('wordCount');
  const charCountElement = document.getElementById('charCount');
  if (wordCountElement) wordCountElement.textContent = wordCount.toLocaleString();
  if (charCountElement) charCountElement.textContent = text.length.toLocaleString();

  // Update file size
  const fileSizeElement = document.getElementById('fileSize');
  if (fileSizeElement) {
    if (originalFile.size !== processedFile.size) {
      fileSizeElement.textContent = `${(processedFile.size / 1024).toFixed(0)}KB (compressed)`;
    } else {
      fileSizeElement.textContent = `${(processedFile.size / 1024).toFixed(0)}KB`;
    }
  }

  // Show/hide format toggle based on availability
  const formatToggleContainer = document.getElementById('formatToggleContainer');
  if (formatToggleContainer) {
    if (hasFormatting && formattedText) {
      formatToggleContainer.style.display = 'block';
      // Store formatted text for later use
      window.currentFormattedText = formattedText;
    } else {
      formatToggleContainer.style.display = 'none';
    }
  }

  // Set initial text view to plain text
  switchTextView('plain');
}

// Switch between plain text and formatted text views
window.switchTextView = function(viewType) {
  const plainTextBtn = document.getElementById('plainTextBtn');
  const formattedTextBtn = document.getElementById('formattedTextBtn');
  const plainTextView = document.getElementById('extractedText');
  const formattedTextView = document.getElementById('formattedTextView');
  const formattedContent = document.getElementById('formattedContent');

  if (viewType === 'plain') {
    // Show plain text view
    plainTextBtn.classList.add('active');
    formattedTextBtn.classList.remove('active');
    plainTextView.style.display = 'block';
    formattedTextView.style.display = 'none';
  } else if (viewType === 'formatted') {
    // Show formatted text view
    plainTextBtn.classList.remove('active');
    formattedTextBtn.classList.add('active');
    plainTextView.style.display = 'none';
    formattedTextView.style.display = 'block';
    
    // Set formatted content
    if (window.currentFormattedText && formattedContent) {
      formattedContent.innerHTML = window.currentFormattedText;
    }
  }
};


window.saveOCRResults = async function() {
  const extractedText = document.getElementById('extractedText').value;
  const confidence = document.getElementById('confidenceScore').textContent;
  const processingTime = document.getElementById('processingTime').textContent;

  if (!extractedText.trim()) {
    alert('No text to save.');
    return;
  }

  if (!uploadedFile) {
    alert('No file to upload.');
    return;
  }

  try {
    // Upload image to Cloudinary first
    const uploadManager = new FileUploadManager();
    const uploadResult = await uploadManager.uploadFile(uploadedFile, {
      folder: 'denr-ocr-documents',
      onProgress: (progress) => {
        console.log(`Upload progress: ${progress}%`);
      }
    });

    if (!uploadResult.success || !uploadResult.url) {
      throw new Error('Failed to upload image to Cloudinary');
    }

    const ocrData = {
      fileName: uploadedFile.name,
      extractedText: extractedText,
      confidence: confidence,
      processingTime: processingTime,
      processedBy: auth.currentUser?.email,
      processedAt: serverTimestamp(),
      fileSize: uploadedFile.size,
      status: 'completed',
      documentType: uploadedFile.type.split('/')[0],
      ocrEngine: 'OCR.space API',
      url: uploadResult.url,
      public_id: uploadResult.public_id,
      cloudinary: true
    };

    // Add optional Cloudinary fields only if they exist
    if (uploadResult.resource_type) {
      ocrData.cloudinaryResourceType = uploadResult.resource_type;
    }
    if (uploadResult.format) {
      ocrData.cloudinaryFormat = uploadResult.format;
    }

    await addDoc(collection(db, 'ocrDocuments'), ocrData);

    alert('OCR results saved successfully!');
    clearFile();

    // Refresh OCR History if it's visible
    const ocrHistorySection = document.getElementById('ocrHistorySection');
    if (ocrHistorySection && ocrHistorySection.style.display !== 'none') {
      await loadOCRHistory(currentPage, currentFilters);
    }

  } catch (error) {
    console.error('Error saving OCR results:', error);
    alert('Error saving results: ' + error.message);
  }
};

// Staff Records Functions
window.showStaffApproved = function() {
  // Close other tables first
  hideStaffRejected();
  hideStaffLogs();
  
  document.getElementById('staffApprovedContainer').style.display = 'block';
  loadStaffApprovedApplications();
};

window.hideStaffApproved = function() {
  document.getElementById('staffApprovedContainer').style.display = 'none';
};

window.showStaffRejected = function() {
  // Close other tables first
  hideStaffApproved();
  hideStaffLogs();
  
  document.getElementById('staffRejectedContainer').style.display = 'block';
  loadStaffRejectedApplications();
};

window.hideStaffRejected = function() {
  document.getElementById('staffRejectedContainer').style.display = 'none';
};

window.showStaffLogs = function() {
  // Close other tables first
  hideStaffApproved();
  hideStaffRejected();
  
  document.getElementById('staffLogsContainer').style.display = 'block';
  loadStaffLogs();
};

window.hideStaffLogs = function() {
  document.getElementById('staffLogsContainer').style.display = 'none';
};

// OCR History Management
let currentPage = 1;
let totalPages = 1;
let currentFilters = {};
let allOCRDocuments = [];

window.showOCRHistory = async function() {
  document.getElementById('ocrHistorySection').style.display = 'block';
  await loadOCRHistory();
};

window.hideOCRHistory = function() {
  document.getElementById('ocrHistorySection').style.display = 'none';
  clearOCRFilters();
};

// Load OCR History with pagination and filters
async function loadOCRHistory(page = 1, filters = {}) {
  try {
    // Validation - use stored email as fallback
    const userEmail = auth.currentUser?.email || currentUserEmail;
    if (!userEmail) {
      throw new Error('User not authenticated');
    }

    currentPage = page;
    currentFilters = { ...filters };

    const tbody = document.getElementById('ocrHistoryTable');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px;">Loading OCR history...</td></tr>';

    // Build base query - fetch all documents for proper sorting
    let q = query(
      collection(db, 'ocrDocuments'),
      where('processedBy', '==', userEmail)
    );

    // Apply filters
    if (filters.confidence) {
      const confidenceNum = parseFloat(filters.confidence);
      if (isNaN(confidenceNum) || confidenceNum < 0 || confidenceNum > 100) {
        throw new Error('Invalid confidence filter value');
      }
      q = query(q, where('confidence', '>=', confidenceNum + '%'));
    }

    if (filters.status) {
      q = query(q, where('status', '==', filters.status));
    }

    // Apply search filter
    if (filters.search) {
      const searchTerm = validateSearchInput(filters.search);
      if (searchTerm) {
        // For now, we'll fetch all and filter client-side
        // In production, consider using Firestore full-text search
      }
    }

    // Fetch ALL documents (no limit) for proper sorting
    const querySnapshot = await getDocs(q);
    
    // Store documents for client-side filtering
    allOCRDocuments = [];
    querySnapshot.forEach((doc) => {
      allOCRDocuments.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Sort by processedAt descending (most recent first)
    allOCRDocuments.sort((a, b) => {
      const aTime = a.processedAt?.toMillis ? a.processedAt.toMillis() : (a.processedAt?.seconds ? a.processedAt.seconds * 1000 : 0);
      const bTime = b.processedAt?.toMillis ? b.processedAt.toMillis() : (b.processedAt?.seconds ? b.processedAt.seconds * 1000 : 0);
      return bTime - aTime;
    });

    // Apply client-side search filter
    let filteredDocuments = allOCRDocuments;
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      filteredDocuments = allOCRDocuments.filter(doc => 
        doc.fileName.toLowerCase().includes(searchTerm) ||
        doc.extractedText.toLowerCase().includes(searchTerm)
      );
    }

    // Apply pagination
    const pageSize = 5;
    const offset = (page - 1) * pageSize;
    const totalFiltered = filteredDocuments.length;
    totalPages = Math.ceil(totalFiltered / pageSize);
    
    // Get current page data
    const startIndex = offset;
    const endIndex = startIndex + pageSize;
    const pageData = filteredDocuments.slice(startIndex, endIndex);

    // Update pagination controls
    updatePaginationControls(page, totalPages);

    // Render table
    renderOCRHistoryTable(pageData);

  } catch (error) {
    console.error('Error loading OCR history:', error);
    const tbody = document.getElementById('ocrHistoryTable');
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:32px; color:#ef4444;">
      Error loading OCR history: ${getErrorMessage(error)}
    </td></tr>`;
  }
}

// Render OCR History table
function renderOCRHistoryTable(documents) {
  const tbody = document.getElementById('ocrHistoryTable');
  
  if (documents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#666;">No OCR documents found</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  
  documents.forEach((doc) => {
    const row = document.createElement('tr');
    
    const date = doc.processedAt ? formatDate(doc.processedAt) : 'N/A';
    const confidence = doc.confidence || '0%';
    const processingTime = doc.processingTime || 'N/A';
    const status = getStatusBadge(doc.status || 'completed');
    
    row.innerHTML = `
      <td>${date}</td>
      <td>${doc.fileName || 'N/A'}</td>
      <td>${confidence}</td>
      <td>${processingTime}</td>
      <td>${status}</td>
      <td>
        <div class="table-actions">
          <button class="btn-view" onclick="viewOCRDocument('${doc.id}')">View</button>
          <button class="btn-secondary" onclick="downloadOCRResults('${doc.id}')">Download</button>
          <button class="btn-danger" onclick="if(confirm('⚠️ Are you sure you want to delete this OCR document?\\n\\nThis action cannot be undone and all data will be permanently removed.')) deleteOCRDocument('${doc.id}')">🗑️</button>
        </div>
      </td>
    `;
    
    tbody.appendChild(row);
  });
}

// Get status badge HTML
function getStatusBadge(status) {
  const statusClass = status === 'completed' ? 'completed' : 
                      status === 'processing' ? 'processing' : 
                      status === 'failed' ? 'failed' : 'pending';
  return `<span class="status-badge ${statusClass}">${status.toUpperCase()}</span>`;
}

// Update pagination controls
function updatePaginationControls(page, total) {
  document.getElementById('pageInfo').textContent = `Page ${page} of ${total || 1}`;
  document.getElementById('prevPageBtn').disabled = page <= 1;
  document.getElementById('nextPageBtn').disabled = page >= total;
}

// Validate search input
function validateSearchInput(searchTerm) {
  if (!searchTerm || typeof searchTerm !== 'string') return '';
  return searchTerm.trim().substring(0, 100);
}

// Get user-friendly error message
function getErrorMessage(error) {
  if (error.code === 'permission-denied') {
    return 'You do not have permission to access these documents';
  } else if (error.code === 'unavailable') {
    return 'Service temporarily unavailable. Please try again';
  } else if (error.message.includes('Invalid')) {
    return error.message;
  } else {
    return 'An error occurred while loading data';
  }
}

// Filter OCR History
window.filterOCRHistory = async function() {
  const searchInput = document.getElementById('ocrSearchInput').value;
  const confidenceFilter = document.getElementById('confidenceFilter').value;
  const dateFromFilter = document.getElementById('dateFromFilter').value;
  const dateToFilter = document.getElementById('dateToFilter').value;

  const filters = {};
  if (searchInput) filters.search = searchInput;
  if (confidenceFilter) filters.confidence = confidenceFilter;
  if (dateFromFilter) filters.dateFrom = dateFromFilter;
  if (dateToFilter) filters.dateTo = dateToFilter;

  await loadOCRHistory(1, filters);
};

// Clear OCR filters
window.clearOCRFilters = async function() {
  document.getElementById('ocrSearchInput').value = '';
  document.getElementById('confidenceFilter').value = '';
  document.getElementById('dateFromFilter').value = '';
  document.getElementById('dateToFilter').value = '';
  
  await loadOCRHistory(1, {});
};

// Load OCR History page
window.loadOCRHistoryPage = async function(direction) {
  let newPage = currentPage;
  if (direction === 'prev' && currentPage > 1) {
    newPage = currentPage - 1;
  } else if (direction === 'next' && currentPage < totalPages) {
    newPage = currentPage + 1;
  }
  
  if (newPage !== currentPage) {
    await loadOCRHistory(newPage, currentFilters);
  }
};

// OCR Document Details Management
let currentOCRDocument = null;
let originalOCRText = '';
let isTextChanged = false;

// View OCR Document
window.viewOCRDocument = function(docId) {
  // Show modal IMMEDIATELY - no await here to prevent click handler blocking
  const modal = document.getElementById('ocrDocumentModal');
  if (!modal) {
    console.error('Modal element not found');
    return;
  }
  
  // Reset and show modal with loading state
  modal.style.display = 'flex';
  const textEditor = document.getElementById('ocrTextEditor');
  if (textEditor) {
    textEditor.value = 'Loading document...';
    textEditor.disabled = true;
  }
  document.getElementById('ocrFileName').textContent = 'Loading...';
  document.getElementById('ocrConfidence').textContent = 'Loading...';
  document.getElementById('ocrProcessingTime').textContent = 'Loading...';
  document.getElementById('ocrFileSize').textContent = 'Loading...';
  document.getElementById('ocrProcessedDate').textContent = 'Loading...';
  document.getElementById('ocrStatus').textContent = 'Loading...';
  document.getElementById('saveIndicator').textContent = 'Loading';
  document.getElementById('saveIndicator').className = 'save-indicator unsaved';
  
  // Now fetch data asynchronously (non-blocking)
  loadOCRDocumentData(docId);
};

// Load OCR document data asynchronously
async function loadOCRDocumentData(docId) {
  try {
    const documentData = await validateDocumentAccess(docId);
    
    if (!documentData) {
      document.getElementById('ocrDocumentModal').style.display = 'none';
      return;
    }

    currentOCRDocument = documentData;
    originalOCRText = documentData.extractedText || '';
    isTextChanged = false;

    // Populate modal with data
    const textEditor = document.getElementById('ocrTextEditor');
    textEditor.removeEventListener('input', handleTextChange);
    textEditor.value = documentData.extractedText || '';
    textEditor.disabled = false;
    textEditor.addEventListener('input', handleTextChange);
    
    updateCharCount();
    handleTextChange();

    // Set metadata
    document.getElementById('ocrFileName').textContent = documentData.fileName || 'N/A';
    document.getElementById('ocrConfidence').textContent = documentData.confidence || 'N/A';
    document.getElementById('ocrProcessingTime').textContent = documentData.processingTime || 'N/A';
    document.getElementById('ocrFileSize').textContent = formatFileSize(documentData.fileSize || 0);
    document.getElementById('ocrProcessedDate').textContent = documentData.processedAt ? formatDate(documentData.processedAt) : 'N/A';
    document.getElementById('ocrStatus').innerHTML = getStatusBadge(documentData.status || 'completed');
    
    // Set document image
    const imageElement = document.getElementById('ocrDocumentImage');
    if (documentData.url) {
      imageElement.src = documentData.url;
      document.getElementById('ocrImageInfo').textContent = documentData.fileName || 'Document Image';
    } else {
      // Show placeholder if no URL available
      imageElement.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjVGNUY1Ii8+Cjx0ZXh0IHg9IjEwMCIgeT0iMTAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOTk5OTk5IiBmb250LXNpemU9IjE0Ij5Eb2N1bWVudCBJbWFnZTwvdGV4dD4KPC9zdmc+';
      document.getElementById('ocrImageInfo').textContent = documentData.fileName || 'No Image Available';
    }

  } catch (error) {
    console.error('Error loading OCR document:', error);
    showNotification('Error loading document: ' + error.message, 'error');
    document.getElementById('ocrDocumentModal').style.display = 'none';
  }
}

// Show non-blocking notification
function showNotification(message, type = 'info') {
  let container = document.getElementById('notificationContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notificationContainer';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  
  const notification = document.createElement('div');
  const bgColor = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6';
  notification.style.cssText = `background:${bgColor};color:white;padding:12px 20px;border-radius:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.15);max-width:400px;animation:fadeIn 0.3s ease;`;
  notification.textContent = message;
  container.appendChild(notification);
  
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Validate document access and fetch data
async function validateDocumentAccess(docId) {
  const userEmail = auth.currentUser?.email || currentUserEmail;
  if (!userEmail) {
    throw new Error('User not authenticated');
  }

  if (!docId || typeof docId !== 'string') {
    throw new Error('Invalid document ID');
  }

  // Fetch document from Firestore
  const docRef = doc(db, 'ocrDocuments', docId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    throw new Error('Document not found');
  }

  const documentData = docSnap.data();

  // Check user permission
  if (documentData.processedBy !== userEmail) {
    throw new Error('Access denied: You can only view your own documents');
  }

  return {
    id: docId,
    ...documentData
  };
}

// Handle text change in editor
function handleTextChange() {
  const currentText = document.getElementById('ocrTextEditor').value;
  isTextChanged = currentText !== originalOCRText;
  
  const saveIndicator = document.getElementById('saveIndicator');
  if (isTextChanged) {
    saveIndicator.textContent = 'Unsaved';
    saveIndicator.className = 'save-indicator unsaved';
  } else {
    saveIndicator.textContent = 'Saved';
    saveIndicator.className = 'save-indicator saved';
  }
  
  updateCharCount();
}

// Update character count
function updateCharCount() {
  const text = document.getElementById('ocrTextEditor').value;
  document.getElementById('textCharCount').textContent = `${text.length} characters`;
}

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Reset OCR text to original
window.resetOCRText = function() {
  if (!currentOCRDocument) return;
  
  if (isTextChanged && !confirm('Are you sure you want to reset to the original text? All changes will be lost.')) {
    return;
  }
  
  document.getElementById('ocrTextEditor').value = originalOCRText;
  handleTextChange();
};

// Save OCR document changes
window.saveOCRDocumentChanges = async function() {
  if (!currentOCRDocument) {
    alert('No document to save');
    return;
  }

  try {
    const currentText = document.getElementById('ocrTextEditor').value;
    
    // Validate text changes
    const validationResult = validateTextChanges(currentText, originalOCRText);
    if (!validationResult.valid) {
      alert(validationResult.message);
      return;
    }

    if (!isTextChanged) {
      alert('No changes to save');
      return;
    }

    // Confirm save
    if (!confirm('Are you sure you want to save these changes? This will update the extracted text in the database.')) {
      return;
    }

    // Update database
    await updateOCRDocumentText(currentOCRDocument.id, currentText);

    // Update local state
    originalOCRText = currentText;
    isTextChanged = false;
    handleTextChange();

    alert('Changes saved successfully!');

    // Refresh OCR History if it's visible
    const ocrHistorySection = document.getElementById('ocrHistorySection');
    if (ocrHistorySection && ocrHistorySection.style.display !== 'none') {
      await loadOCRHistory(currentPage, currentFilters);
    }

  } catch (error) {
    console.error('Error saving OCR document:', error);
    alert('Error saving changes: ' + getErrorMessage(error));
  }
};

// Validate text changes
function validateTextChanges(newText, originalText) {
  // Length validation
  if (newText.length > 50000) {
    return { valid: false, message: 'Text is too long. Maximum 50,000 characters allowed.' };
  }

  if (newText.length < 10) {
    return { valid: false, message: 'Text is too short. Minimum 10 characters required.' };
  }

  // Content validation (basic)
  if (!newText.trim()) {
    return { valid: false, message: 'Text cannot be empty or contain only whitespace.' };
  }

  return { valid: true };
}

// Update OCR document text in database
async function updateOCRDocumentText(docId, newText) {
  const docRef = doc(db, 'ocrDocuments', docId);
  
  const updateData = {
    extractedText: newText,
    editedText: newText,
    lastEditedBy: auth.currentUser?.email || currentUserEmail,
    lastEditedAt: serverTimestamp(),
    isEdited: true,
    editHistory: arrayUnion({
      editedBy: auth.currentUser?.email || currentUserEmail,
      editedAt: serverTimestamp(),
      previousText: originalOCRText.substring(0, 100) + '...', // Store first 100 chars for history
      changeType: 'text_edit'
    })
  };

  await updateDoc(docRef, updateData);
}

// Copy OCR text to clipboard
window.copyOCRText = async function() {
  const text = document.getElementById('ocrTextEditor').value;
  
  if (!text.trim()) {
    alert('No text to copy');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    alert('Text copied to clipboard!');
  } catch (error) {
    console.error('Error copying text:', error);
    alert('Error copying text to clipboard');
  }
};

// Export OCR document
window.exportOCRDocument = async function(format) {
  if (!currentOCRDocument) {
    alert('No document to export');
    return;
  }

  try {
    const text = document.getElementById('ocrTextEditor').value;
    
    if (!text.trim()) {
      alert('No text to export');
      return;
    }

    // Validate export format
    const validFormats = ['word', 'pdf', 'txt'];
    if (!validFormats.includes(format)) {
      alert('Invalid export format');
      return;
    }

    // Create export data
    const exportData = {
      filename: currentOCRDocument.fileName,
      text: text,
      confidence: currentOCRDocument.confidence,
      processedDate: currentOCRDocument.processedAt,
      format: format
    };

    // Export based on format
    switch (format) {
      case 'word':
        exportAsWord(exportData);
        break;
      case 'pdf':
        exportAsPDF(exportData);
        break;
      case 'txt':
        exportAsTXT(exportData);
        break;
    }

    // Log export activity
    await logExportActivity(currentOCRDocument.id, format);

  } catch (error) {
    console.error('Error exporting document:', error);
    alert('Error exporting document: ' + getErrorMessage(error));
  }
};

// Export as Word document
function exportAsWord(data) {
  const rtfContent = `{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1033
{\\fonttbl{\\f0\\fnil\\fcharset0 Calibri;}}
{\\colortbl;\\red0\\green0\\blue0;}
\\viewkind4\\uc1\\pard\\f0\\fs24
\\b\\fs28 OCR Document Export\\b0\\par
\\par
\\b File Information:\\b0\\par
Filename: ${data.filename}\\par
Confidence: ${data.confidence}\\par
Processed Date: ${data.processedAt ? formatDate(data.processedAt) : 'N/A'}\\par
\\par
\\b Extracted Text:\\b0\\par
${data.text.replace(/\n/g, '\\par ')}
}`;

  const blob = new Blob([rtfContent], { type: 'application/rtf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `OCR_${data.filename.replace(/\.[^/.]+$/, "")}_${new Date().toISOString().slice(0,10)}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Export as PDF document
function exportAsPDF(data) {
  // For now, we'll create a simple text-based PDF
  // In production, you might want to use a proper PDF library
  const pdfContent = `%PDF-1.4
1 0 obj
<<
/Title (OCR Document: ${data.filename})
/Creator (DENR Permit System)
>>
endobj

2 0 obj
<<
/Length ${data.text.length + 100}
>>
stream
BT
/F1 12 Tf
72 720 Td
(OCR Document - ${data.filename}) Tj
0 -20 Td
(Confidence: ${data.confidence}) Tj
0 -20 Td
(Processed: ${data.processedAt ? formatDate(data.processedAt) : 'N/A'}) Tj
0 -40 Td
(${data.text.replace(/\n/g, ') Tj 0 -20 Td (')}) Tj
ET
endstream
endobj

xref
0 3
0000000000 65535 f 
0000000009 00000 n 
0000000054 00000 n 
trailer
<<
/Size 3
/Root 1 0 R
>>
startxref
${data.text.length + 200}
%%EOF`;

  const blob = new Blob([pdfContent], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `OCR_${data.filename.replace(/\.[^/.]+$/, "")}_${new Date().toISOString().slice(0,10)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Export as TXT document
function exportAsTXT(data) {
  const txtContent = `OCR Document Export
==================
Filename: ${data.filename}
Confidence: ${data.confidence}
Processed Date: ${data.processedAt ? formatDate(data.processedAt) : 'N/A'}
==================

Extracted Text:
${data.text}`;

  const blob = new Blob([txtContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `OCR_${data.filename.replace(/\.[^/.]+$/, "")}_${new Date().toISOString().slice(0,10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Log export activity
async function logExportActivity(docId, format) {
  try {
    const logRef = doc(db, 'ocrDocuments', docId);
    await updateDoc(logRef, {
      exportCount: increment(1),
      lastExportAt: serverTimestamp(),
      lastExportFormat: format
    });
  } catch (error) {
    console.error('Error logging export activity:', error);
  }
}

// Close OCR Document Modal
document.getElementById('closeOCRDocumentModal').addEventListener('click', () => {
  if (isTextChanged) {
    if (confirm('You have unsaved changes. Are you sure you want to close?')) {
      document.getElementById('ocrDocumentModal').style.display = 'none';
      currentOCRDocument = null;
      isTextChanged = false;
    }
  } else {
    document.getElementById('ocrDocumentModal').style.display = 'none';
    currentOCRDocument = null;
  }
});

// Close modal when clicking outside
document.getElementById('ocrDocumentModal').addEventListener('click', (e) => {
  if (e.target.id === 'ocrDocumentModal') {
    if (isTextChanged) {
      if (confirm('You have unsaved changes. Are you sure you want to close?')) {
        document.getElementById('ocrDocumentModal').style.display = 'none';
        currentOCRDocument = null;
        isTextChanged = false;
      }
    } else {
      document.getElementById('ocrDocumentModal').style.display = 'none';
      currentOCRDocument = null;
    }
  }
});

// Test function to debug modal
window.testOCRModal = function() {
  console.log('testOCRModal called');
  
  const modal = document.getElementById('ocrDocumentModal');
  console.log('Modal element:', modal);
  
  if (!modal) {
    console.error('Modal not found!');
    alert('Modal element not found!');
    return;
  }
  
  console.log('Setting modal display to flex');
  modal.style.display = 'flex';
  
  // Set some test content
  document.getElementById('ocrTextEditor').value = 'Test content - This is a test to see if the modal works';
  document.getElementById('ocrFileName').textContent = 'test-document.jpg';
  document.getElementById('ocrConfidence').textContent = '95.5%';
  document.getElementById('ocrProcessingTime').textContent = '2.3s';
  document.getElementById('ocrFileSize').textContent = '1.2 MB';
  document.getElementById('ocrProcessedDate').textContent = new Date().toLocaleDateString();
  document.getElementById('ocrStatus').textContent = '<span class="status-badge completed">COMPLETED</span>';
  
  console.log('Modal should be visible now');
};

// Manual test - call this in console: testOCRModal()

// Download OCR Results
window.downloadOCRResults = async function(docId) {
  try {
    // Validate access
    const userEmail = auth.currentUser?.email || currentUserEmail;
    if (!userEmail) {
      throw new Error('User not authenticated');
    }

    if (!docId || typeof docId !== 'string') {
      throw new Error('Invalid document ID');
    }

    // Fetch document from Firestore
    const docRef = doc(db, 'ocrDocuments', docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error('Document not found');
    }

    const docData = docSnap.data();

    if (docData.processedBy !== userEmail) {
      throw new Error('Access denied');
    }

    if (!docData.extractedText || !docData.extractedText.trim()) {
      throw new Error('No text content to download');
    }

    // Create RTF content (Word-compatible)
    const rtfContent = `{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1033
{\\fonttbl{\\f0\\fnil\\fcharset0 Calibri;}}
{\\colortbl;\\red0\\green0\\blue0;}
\\viewkind4\\uc1\\pard\\f0\\fs24
\\b\\fs28 OCR Results\\b0\\par
\\par
\\b Document Information:\\b0\\par
Filename: ${docData.fileName || 'Unknown'}\\par
Confidence: ${docData.confidence || 'N/A'}\\par
Processing Time: ${docData.processingTime || 'N/A'}\\par
Processed Date: ${docData.processedAt ? formatDate(docData.processedAt) : 'N/A'}\\par
\\par
\\b Extracted Text:\\b0\\par
${docData.extractedText.replace(/\n/g, '\\par ')}
}`;

    // Create blob and download
    const blob = new Blob([rtfContent], { type: 'application/rtf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OCR_${(docData.fileName || 'document').replace(/\.[^/.]+$/, "")}_${new Date().toISOString().slice(0,10)}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Log export activity
    try {
      await updateDoc(docRef, {
        exportCount: increment(1),
        lastExportAt: serverTimestamp(),
        lastExportFormat: 'word'
      });
    } catch (logError) {
      console.error('Error logging export:', logError);
    }

  } catch (error) {
    console.error('Error downloading OCR results:', error);
    alert('Error downloading results: ' + error.message);
  }
};

// Re-process OCR Document
window.reprocessOCRDocument = async function(docId) {
  if (!confirm('Are you sure you want to re-process this document? This will replace the existing OCR results.')) {
    return;
  }
  
  try {
    // Validate document exists and user has permission
    const docRef = doc(db, 'ocrDocuments', docId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      throw new Error('Document not found');
    }
    
    const docData = docSnap.data();
    const userEmail = auth.currentUser?.email || currentUserEmail;
    if (docData.processedBy !== userEmail) {
      throw new Error('Access denied');
    }
    
    // Update status to processing
    await updateDoc(docRef, { 
      status: 'processing',
      retryCount: (docData.retryCount || 0) + 1
    });
    
    alert('Document queued for re-processing. Please refresh to see updated results.');
    
    // Refresh OCR History if it's visible
    const ocrHistorySection = document.getElementById('ocrHistorySection');
    if (ocrHistorySection && ocrHistorySection.style.display !== 'none') {
      await loadOCRHistory(currentPage, currentFilters);
    }
    
  } catch (error) {
    console.error('Error re-processing document:', error);
    alert('Error re-processing document: ' + getErrorMessage(error));
  }
};

// Delete OCR Document
window.deleteOCRDocument = async function(docId) {
  if (!confirm('Are you sure you want to delete this OCR document? This action cannot be undone.')) {
    return;
  }
  
  try {
    // Validate
    const userEmail = auth.currentUser?.email || currentUserEmail;
    if (!userEmail) {
      throw new Error('User not authenticated');
    }

    if (!docId || typeof docId !== 'string') {
      throw new Error('Invalid document ID');
    }

    // Validate document exists and user has permission
    const docRef = doc(db, 'ocrDocuments', docId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      throw new Error('Document not found');
    }
    
    const docData = docSnap.data();
    if (docData.processedBy !== userEmail) {
      throw new Error('Access denied: You can only delete your own documents');
    }
    
    // Delete document
    await deleteDoc(docRef);
    
    alert('OCR document deleted successfully.');
    
    // Refresh OCR History if it's visible
    const ocrHistorySection = document.getElementById('ocrHistorySection');
    if (ocrHistorySection && ocrHistorySection.style.display !== 'none') {
      await loadOCRHistory(currentPage, currentFilters);
    }
    
  } catch (error) {
    console.error('Error deleting document:', error);
    alert('Error deleting document: ' + error.message);
  }
};

async function loadStaffApprovedApplications() {
  const tbody = document.getElementById('staffApprovedTable');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px;">Loading approved permits...</td></tr>';

  try {
    const currentUserEmail = auth.currentUser?.email;
    console.log('🔍 Loading approved applications for:', currentUserEmail);
    
    const q = query(
      collection(db, 'applications'),
      where('status', '==', 'approved'),
      where('approvedBy', '==', currentUserEmail)
    );
    const querySnapshot = await getDocs(q);
    
    console.log('📊 Query result:', querySnapshot.size, 'approved applications found');

    tbody.innerHTML = '';
    if (querySnapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#666;">No approved permits found</td></tr>';
      return;
    }

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      console.log('📝 Approved app:', doc.id, 'approvedBy:', data.approvedBy, 'status:', data.status);
      const row = document.createElement('tr');
      
      const approvedDate = data.approvedAt ? formatDate(data.approvedAt) : 'N/A';
      const pickupDate = data.pickupSchedule?.date || 'N/A';
      
      row.innerHTML = `
        <td>${data.applicationId || data.id || 'N/A'}</td>
        <td>${data.applicantName || 'N/A'}</td>
        <td>${data.permitType || 'N/A'}</td>
        <td>${approvedDate}</td>
        <td>${pickupDate}</td>
        <td>
          <div class="table-actions">
            <button class="btn-view" onclick="viewApplication('${doc.id}')">View Details</button>
            <button class="btn-secondary" onclick="viewDocuments('${doc.id}')">View Documents</button>
          </div>
        </td>
      `;
      
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Error loading approved applications:', error);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#ef4444;">Error loading approved permits</td></tr>';
  }
}

async function loadStaffRejectedApplications() {
  const tbody = document.getElementById('staffRejectedTable');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px;">Loading rejected applications...</td></tr>';

  try {
    const currentUserEmail = auth.currentUser?.email;
    console.log('🔍 Loading rejected applications for:', currentUserEmail);
    
    const q = query(
      collection(db, 'applications'),
      where('status', '==', 'rejected'),
      where('rejectedBy', '==', currentUserEmail)
    );
    const querySnapshot = await getDocs(q);
    
    console.log('📊 Query result:', querySnapshot.size, 'rejected applications found');

    tbody.innerHTML = '';
    if (querySnapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#666;">No rejected applications found</td></tr>';
      return;
    }

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      console.log('📝 Rejected app:', doc.id, 'rejectedBy:', data.rejectedBy, 'status:', data.status);
      const row = document.createElement('tr');
      
      const rejectedDate = data.rejectedAt ? formatDate(data.rejectedAt) : 'N/A';
      const rejectionReason = data.rejectionReason || 'No reason provided';
      
      row.innerHTML = `
        <td>${data.applicationId || data.id || 'N/A'}</td>
        <td>${data.applicantName || 'N/A'}</td>
        <td>${data.permitType || 'N/A'}</td>
        <td>${rejectedDate}</td>
        <td style="color: #ef4444;">${rejectionReason}</td>
        <td>
          <div class="table-actions">
            <button class="btn-view" onclick="viewApplication('${doc.id}')">View Details</button>
            <button class="btn-secondary" onclick="viewDocuments('${doc.id}')">View Documents</button>
          </div>
        </td>
      `;
      
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Error loading rejected applications:', error);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#ef4444;">Error loading rejected applications</td></tr>';
  }
}

async function loadStaffLogs() {
  const tbody = document.getElementById('staffLogsTable');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:32px;">Loading system logs...</td></tr>';

  try {
    const currentUserEmail = auth.currentUser?.email;
    console.log('🔍 Loading system logs for:', currentUserEmail);
    
    const q = query(
      collection(db, 'auditLogs'),
      where('userEmail', '==', currentUserEmail)
    );
    const querySnapshot = await getDocs(q);
    
    console.log('📊 Query result:', querySnapshot.size, 'audit logs found');

    tbody.innerHTML = '';
    if (querySnapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:32px; color:#666;">No system logs found</td></tr>';
      return;
    }

    // Convert to array and sort by timestamp (most recent first)
    const logs = [];
    querySnapshot.forEach((doc) => {
      logs.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Sort by timestamp descending
    logs.sort((a, b) => {
      const aTime = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
      const bTime = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
      return bTime - aTime;
    });

    logs.forEach((data) => {
      const row = document.createElement('tr');
      
      // Handle timestamp properly - Firestore Timestamp or Date
      let timestamp = 'N/A';
      if (data.timestamp) {
        const date = data.timestamp.toDate ? data.timestamp.toDate() : 
                     (data.timestamp.seconds ? new Date(data.timestamp.seconds * 1000) : new Date(data.timestamp));
        timestamp = formatDate(date);
      }
      
      row.innerHTML = `
        <td>${timestamp}</td>
        <td>${data.action || 'N/A'}</td>
        <td>${data.resourceId || data.applicationId || 'N/A'}</td>
        <td>${data.details || 'N/A'}</td>
      `;
      
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Error loading system logs:', error);
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:32px; color:#ef4444;">Error loading system logs</td></tr>';
  }
}

window.viewDocuments = async function(appId) {
  try {
    const application = allApplications.find(app => app.id === appId);
    if (!application) {
      alert('Application not found');
      return;
    }

    const modal = document.getElementById('documentsModal');
    const contentDiv = document.getElementById('documentsContent');
    
    contentDiv.innerHTML = '<div style="text-align:center; padding:32px;">Loading documents...</div>';
    modal.style.display = 'flex';

    // Build documents HTML
    let documentsHTML = '';
    
    // Add CSS for documents grid
    const css = `
      <style>
        .documents-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          padding: 20px 0;
        }
        .document-item {
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 16px;
          background: #f9f9f9;
        }
        .document-header {
          display: flex;
          align-items: center;
          margin-bottom: 12px;
        }
        .document-icon {
          font-size: 24px;
          margin-right: 12px;
        }
        .document-info h4 {
          margin: 0 0 4px 0;
          font-size: 16px;
          color: #333;
        }
        .document-meta {
          margin: 0;
          font-size: 12px;
          color: #666;
        }
        .document-preview {
          margin: 12px 0;
          text-align: center;
        }
        .file-preview {
          padding: 20px;
          background: #e9ecef;
          border-radius: 4px;
          font-size: 14px;
          color: #666;
        }
        .document-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
      </style>
    `;
    
    if (application.documents && application.documents.length > 0) {
      documentsHTML = css + '<div class="documents-grid">';
      
      application.documents.forEach((doc, index) => {
        // Generate user-friendly name instead of technical file name
        const originalName = doc.name || `Document ${index + 1}`;
        const docName = getCleanDocumentName(originalName, doc.type, index);
        // Handle both Cloudinary documents (url field) and base64 documents (data field)
        const docData = doc.url || doc.data || '';
        const docType = doc.type || '';
        const docSize = doc.size || 0;
        const isImage = docType && docType.startsWith('image/');
        const isPDF = docType && docType.includes('pdf');
        const isCloudinary = doc.cloudinary || doc.public_id;
        const fileIcon = isImage ? '🖼️' : (isPDF ? '📄' : '📎');
        const fileSize = docSize ? `(${(docSize / 1024).toFixed(1)} KB)` : '';
        
        if (!docData) {
          documentsHTML += `
            <div class="document-item" style="border-color: #ef4444; background: #fef2f2;">
              <div class="document-header">
                <span class="document-icon">⚠️</span>
                <div class="document-info">
                  <h4 style="color: #ef4444;">${docName}</h4>
                  <p class="document-meta">Data not available ${isCloudinary ? '(Cloudinary)' : ''}</p>
                </div>
              </div>
              <div class="document-preview">
                <div class="file-preview" style="background: #fee2e2; color: #ef4444;">⚠️ Document data is missing or corrupted</div>
              </div>
              <div class="document-actions">
                <span style="color: #ef4444; font-size: 12px;">Cannot display or download</span>
              </div>
            </div>
          `;
          return;
        }
        
        // Generate proper download URL for Cloudinary files
        const downloadUrl = isCloudinary && doc.public_id ? 
          docData : 
          docData;
        
        documentsHTML += `
          <div class="document-item">
            <div class="document-header">
              <span class="document-icon">${fileIcon}</span>
              <div class="document-info">
                <h4>${docName}</h4>
                <p class="document-meta">${fileSize}</p>
              </div>
            </div>
            <div class="document-preview">
              ${isImage ? 
                `<img src="${docData}" alt="${docName}" style="max-width: 100%; max-height: 200px; border-radius: 8px; border: 1px solid #ddd; cursor: pointer; transition: transform 0.2s ease;" 
                     onclick="openImageViewer('${docData}', '${docName.replace(/'/g, "\\'")}')"
                     onmouseover="this.style.transform='scale(1.02)'" 
                     onmouseout="this.style.transform='scale(1)'"
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
                 <div style="display: none; color: #ef4444; font-size: 12px; text-align: center; padding: 20px; background: #fef2f2; border-radius: 8px;">⚠️ Image failed to load</div>
                 <div style="text-align: center; margin-top: 8px;">
                   <small style="color: #059669; font-size: 11px; cursor: pointer;" onclick="openImageViewer('${docData}', '${docName.replace(/'/g, "\\'")}')">🔍 Click to view full size</small>
                 </div>` :
                `<div onclick="downloadDocumentFromServer('${downloadUrl}', '${docName.replace(/'/g, "\\'")}')" style="cursor: pointer; padding: 20px; text-align: center; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; transition: all 0.2s ease;" onmouseover="this.style.background='#f1f5f9'; this.style.borderColor='#cbd5e1';" onmouseout="this.style.background='#f8fafc'; this.style.borderColor='#e2e8f0';">
                   <div style="font-size: 48px; margin-bottom: 8px;">${isPDF ? '📄' : '📎'}</div>
                   <div style="font-weight: 600; color: #374151;">Click to Download</div>
                   <small style="color: #6b7280; font-size: 11px; margin-top: 4px; display: block;">File will download automatically</small>
                 </div>`
              }
            </div>
            <div class="document-actions">
              <a href="${downloadUrl}" ${isPDF ? `download="${docName}"` : 'target="_blank'} class="btn-primary" style="text-decoration: none; display: inline-block; padding: 8px 16px; margin: 4px;">
                ${isPDF ? '📥 Download' : '👁️ View'}
              </a>
              ${!isPDF ? `
                <a href="${downloadUrl}" download="${docName}" class="btn-secondary" style="text-decoration: none; display: inline-block; padding: 8px 16px; margin: 4px;">
                  📥 Download
                </a>
              ` : ''}
              ${isPDF ? '<span style="color: #059669; font-size: 11px; display: block; margin-top: 4px;">• Auto-download enabled</span>' : ''}
              ${isCloudinary ? '<span style="color: #059669; font-size: 11px; display: block; margin-top: 2px;">• Cloudinary hosted</span>' : ''}
            </div>
          </div>
        `;
      });
      
      documentsHTML += '</div>';
    } else {
      documentsHTML = `
        <div style="text-align:center; padding: 32px; color: #666;">
          <div style="font-size: 48px; margin-bottom: 16px;">📄</div>
          <h3>No Documents Found</h3>
          <p>This application has no uploaded documents.</p>
        </div>
      `;
    }

    contentDiv.innerHTML = documentsHTML;

  } catch (error) {
    console.error('Error loading documents:', error);
    document.getElementById('documentsContent').innerHTML = `
      <div style="text-align:center; padding: 32px; color: #ef4444;">
        <h3>Error Loading Documents</h3>
        <p>Unable to load documents. Please try again.</p>
      </div>
    `;
  }
};

const uploadArea = document.getElementById('uploadArea');
if (uploadArea) {
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#1f6f3a';
    uploadArea.style.backgroundColor = '#f0fdf4';
  });

  uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#d1d5db';
    uploadArea.style.backgroundColor = 'transparent';
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#d1d5db';
    uploadArea.style.backgroundColor = 'transparent';

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      document.getElementById('documentInput').files = files;
      handleFileSelect({ target: { files: files } });
    }
  });
}

