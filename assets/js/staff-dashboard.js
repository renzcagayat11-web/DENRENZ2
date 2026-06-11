import { auth, db } from './firebase-config.js';
import { 
  signOut, 
  getIdToken,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { protectRoute, logout as authGuardLogout } from './auth-guard.js';
import { createNotifications } from './notification-service.js';
import { createNotificationCenter } from './notification-center.js';
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

// Sidebar Toggle Function
window.toggleSidebar = function() {
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

  initDashboardSidebar();
});

const API_BASE = window.API_BASE || (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://127.0.0.1:3000' : '');

let currentApplication = null;
let allApplications = [];
let currentUserEmail = null;
let staffNotificationCenter = null;
function getStaffNotificationCenter() {
  if (!staffNotificationCenter) {
    staffNotificationCenter = createNotificationCenter({
      buttonSelector: '#notificationBtn',
      badgeSelector: '.notification-badge',
      panelId: 'staffNotificationPanel',
      emptyState: 'No alerts right now',
      title: 'Team Notifications'
    });
  }
  return staffNotificationCenter;
}

function getStaffActorInfo() {
  const user = auth.currentUser;
  if (!user) {
    return { id: null, name: 'Staff' };
  }
  return {
    id: user.uid,
    name: user.displayName || user.email || 'Staff'
  };
}

function buildCustomerNotificationCopy(eventType, application, options = {}) {
  const permitLabel = application?.permitType || application?.documentType || 'permit';
  switch (eventType) {
    case 'application-approved':
      return {
        title: 'Application Approved',
        message: `Your ${permitLabel} application has been approved.`
      };
    case 'application-rejected':
      return {
        title: 'Application Rejected',
        message: options.rejectionReason
          ? `Your ${permitLabel} application was rejected. Reason: ${options.rejectionReason}`
          : `Your ${permitLabel} application was rejected.`
      };
    case 'application-resubmit-requested':
      return {
        title: 'Resubmission Requested',
        message: options.revisionComments
          ? `Updates are needed for your ${permitLabel} application: ${options.revisionComments}`
          : `Updates are needed for your ${permitLabel} application.`
      };
    case 'application-pickup-scheduled':
      return {
        title: 'Permit Pickup Scheduled',
        message: options.pickupSchedule
          ? `Pickup scheduled on ${options.pickupSchedule.date} at ${options.pickupSchedule.time}.`
          : 'Your permit pickup has been scheduled.'
      };
    case 'application-status-change':
    default:
      return {
        title: 'Application Update',
        message: `Your ${permitLabel} application status is now "${application.status || options.newStatus || 'updated'}".`
      };
  }
}

async function notifyCustomerAndAdmin(eventType, application, options = {}) {
  try {
    if (!createNotifications || !application) return;

    const { title, message } = buildCustomerNotificationCopy(eventType, application, options);
    const actor = getStaffActorInfo();

    const recipients = [];
    if (application.applicantUid) {
      recipients.push({ userId: application.applicantUid });
    }
    recipients.push({ role: 'admin' });

    if (recipients.length === 0) return;

    const payload = {
      applicationId: application.applicationId || application.id || null,
      permitType: application.permitType || null,
      documentType: application.documentType || null,
      applicantName: application.applicantName || null,
      applicantUid: application.applicantUid || null,
      status: application.status || options.newStatus || null,
    };
    if (options.revisionComments) payload.revisionComments = options.revisionComments;
    if (options.rejectionReason) payload.rejectionReason = options.rejectionReason;
    if (options.pickupSchedule) payload.pickupSchedule = options.pickupSchedule;

    await createNotifications({
      eventType,
      title,
      message,
      payload,
      actor,
      recipients
    });
  } catch (error) {
    console.error('Failed to notify customer/admin:', error);
  }
}

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
// Using auth-guard for proper Firebase Auth state handling
protectRoute({
  allowedRoles: ['staff', 'admin'],
  loginRedirect: '/pages/index.html',
  onAuthenticated: async (state) => {
    console.log('Staff dashboard: User authenticated, role:', state.role);
    
    // Check for role issues and auto-fix if needed
    const idTokenResult = await state.user.getIdTokenResult(true);
    const tokenRole = idTokenResult.claims.role;
    
    if (!tokenRole) {
      console.log('⚠️ No role in token! Attempting to fix...');
      
      // Check Firestore for user role
      const userDoc = await getDoc(doc(db, 'users', state.user.uid));
      const firestoreRole = userDoc.exists() ? userDoc.data().role : null;
      
      if (firestoreRole === 'staff' || firestoreRole === 'admin') {
        const idToken = await state.user.getIdToken();
        const response = await fetch(`${API_BASE}/debug/set-staff-role`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${idToken}` }
        });
        const result = await response.json();
        if (result.success) {
          alert('⚠️ Your account was missing staff role. It has been fixed!\n\nPlease LOGOUT and LOGIN again for changes to take effect.');
          return;
        }
      }
    }
    
    loadDashboardData();
    updateUserInfo(state.user, { role: state.role });
    getStaffNotificationCenter().start(state.user.uid);
  },
  onUnauthenticated: () => {
    console.log('Staff dashboard: Not authenticated or access denied');
    getStaffNotificationCenter().stop();
  }
});

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

  const welcomeSection = document.querySelector('.welcome-section');
  if (welcomeSection) {
    const welcomeKey = 'staff_welcome_shown_' + (user.uid || user.email);
    if (!sessionStorage.getItem(welcomeKey)) {
      sessionStorage.setItem(welcomeKey, '1');
      welcomeSection.style.display = '';
      welcomeSection.style.transition = 'opacity 0.8s ease';
      welcomeSection.style.opacity = '1';
      setTimeout(() => {
        welcomeSection.style.opacity = '0';
        setTimeout(() => { welcomeSection.style.display = 'none'; }, 850);
      }, 4000);
    } else {
      welcomeSection.style.display = 'none';
    }
  }
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
    
    // Show only pending, under review, and needs resubmit applications
    const pendingApps = allApplications.filter(app => 
      app.status === 'pending' || app.status === 'under review' || app.status === 'needs resubmit'
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

// ─── Dashboard Sidebar: Calendar + Pickup Schedule ───────────────────────────

let calViewYear, calViewMonth;

function initDashboardSidebar() {
  const now = new Date();
  calViewYear = now.getFullYear();
  calViewMonth = now.getMonth();

  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const todayEl   = document.getElementById('dashCalToday');
  const daynameEl = document.getElementById('dashCalDayname');
  if (todayEl)   todayEl.textContent   = `${now.getDate()} of ${months[now.getMonth()]} ${now.getFullYear()}`;
  if (daynameEl) daynameEl.textContent = days[now.getDay()];

  renderMiniCalendar();

  document.querySelectorAll('.dash-pickup-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.dash-pickup-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderPickupList(tab.getAttribute('data-pickup-tab'));
    });
  });
}

function getPickupDatesSet() {
  const set = new Set();
  allApplications.forEach(app => {
    if (app.pickupSchedule?.date) set.add(app.pickupSchedule.date);
  });
  return set;
}

function renderMiniCalendar() {
  const container = document.getElementById('dashMiniCalendar');
  if (!container) return;

  const now   = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const pickupDates = getPickupDatesSet();

  const months   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dowLabels = ['S','M','T','W','T','F','S'];

  const firstDay   = new Date(calViewYear, calViewMonth, 1).getDay();
  const daysInMonth= new Date(calViewYear, calViewMonth+1, 0).getDate();
  const monthLabel = `${months[calViewMonth]} ${calViewYear}`;

  let html = `
    <div class="dash-mini-cal-header">
      <button class="dash-mini-cal-nav" id="calPrev">&#8249;</button>
      <span>${monthLabel}</span>
      <button class="dash-mini-cal-nav" id="calNext">&#8250;</button>
    </div>
    <div class="dash-mini-cal-grid">
  `;
  dowLabels.forEach(d => { html += `<div class="dash-mini-cal-dow">${d}</div>`; });
  for (let i = 0; i < firstDay; i++) html += `<div class="dash-mini-cal-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calViewYear}-${String(calViewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday    = dateStr === today ? ' today' : '';
    const hasPickup  = pickupDates.has(dateStr) ? ' has-pickup' : '';
    html += `<div class="dash-mini-cal-day${isToday}${hasPickup}" data-date="${dateStr}">${d}</div>`;
  }
  html += `</div>`;
  container.innerHTML = html;

  document.getElementById('calPrev')?.addEventListener('click', () => {
    calViewMonth--;
    if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
    renderMiniCalendar();
  });
  document.getElementById('calNext')?.addEventListener('click', () => {
    calViewMonth++;
    if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
    renderMiniCalendar();
  });

  container.querySelectorAll('.dash-mini-cal-day.has-pickup').forEach(el => {
    el.addEventListener('click', () => {
      const date = el.getAttribute('data-date');
      filterPickupByDate(date);
    });
  });
}

function filterPickupByDate(date) {
  document.querySelectorAll('.dash-pickup-tab').forEach(t => t.classList.remove('active'));
  renderPickupList('all', date);
}

function renderPickupList(tab, filterDate) {
  const list = document.getElementById('dashPickupList');
  if (!list) return;

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  let items = allApplications.filter(app => app.pickupSchedule?.date);

  if (filterDate) {
    items = items.filter(app => app.pickupSchedule.date === filterDate);
  } else if (tab === 'today') {
    items = items.filter(app => app.pickupSchedule.date === todayStr);
  } else {
    items.sort((a,b) => {
      const da = a.pickupSchedule.date + (a.pickupSchedule.time||'');
      const db2 = b.pickupSchedule.date + (b.pickupSchedule.time||'');
      return da.localeCompare(db2);
    });
    items = items.slice(0, 30);
  }

  if (!items.length) {
    list.innerHTML = `<div class="dash-pickup-empty">${tab === 'today' ? 'No pickups today' : 'No scheduled pickups yet'}</div>`;
    return;
  }

  list.innerHTML = items.map(app => {
    const isToday = app.pickupSchedule.date === todayStr;
    const timeStr = app.pickupSchedule.time || '';
    const dateStr2 = app.pickupSchedule.date || '';
    const name    = app.applicantName || app.applicantEmail || 'Applicant';
    const permit  = (app.permitType || '').length > 38 ? (app.permitType || '').slice(0,38)+'…' : (app.permitType || 'Application');
    const metaLine = [isToday ? 'Today' : dateStr2, timeStr].filter(Boolean).join(' · ');
    return `
      <div class="dash-pickup-item${isToday ? ' today-item' : ''}" onclick="viewApplication('${app.id}')">
        <div class="dash-pickup-dot"></div>
        <div class="dash-pickup-body">
          <div class="dash-pickup-name">${name}</div>
          <div class="dash-pickup-permit">${permit}</div>
          <div class="dash-pickup-time">${metaLine}</div>
        </div>
      </div>`;
  }).join('');
}

function refreshDashboardSidebar() {
  renderMiniCalendar();
  const activeTab = document.querySelector('.dash-pickup-tab.active')?.getAttribute('data-pickup-tab') || 'today';
  renderPickupList(activeTab);
}

// Fetch applications from Firestore with real-time updates
async function fetchApplications() {
  try {
    const applicationsRef = collection(db, 'applications');
    const q = query(applicationsRef);
    
    // Set up real-time listener
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const oldApplications = [...allApplications];
      allApplications = [];
      
      querySnapshot.forEach((doc) => {
        const appData = doc.data();
        allApplications.push({
          id: doc.id,
          ...appData
        });
      });
      
      console.log(`✅ Recent Applications: ${allApplications.length} loaded`);
      
      // Check for resubmissions (status changed from needs resubmit to pending)
      allApplications.forEach(updatedApp => {
        const oldApp = oldApplications.find(app => app.id === updatedApp.id);
        if (oldApp && 
            oldApp.status === 'needs resubmit' && 
            updatedApp.status === 'pending' && 
            updatedApp.revisionSubmittedAt) {
          showResubmitNotification(updatedApp);
        }
      });
      
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
      refreshDashboardSidebar();
      
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

// Show notification for new resubmission
function showResubmitNotification(application) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #10b981;
    color: white;
    padding: 16px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    max-width: 350px;
    animation: slideIn 0.3s ease-out;
  `;
  
  notification.innerHTML = `
    <div style="display: flex; align-items: start; gap: 12px;">
      <div style="font-size: 20px;">🔄</div>
      <div style="flex: 1;">
        <div style="font-weight: 600; margin-bottom: 4px;">New Resubmission</div>
        <div style="font-size: 14px; opacity: 0.9;">
          <strong>${application.applicantName || 'Customer'}</strong> has submitted resubmission for <strong>${application.permitType || 'Application'}</strong>
        </div>
        <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">
          ID: ${application.applicationId || application.id}
        </div>
        <button onclick="this.parentElement.parentElement.parentElement.remove(); viewApplication('${application.id}')" 
                style="margin-top: 8px; background: white; color: #10b981; border: none; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer;">
          Review Now
        </button>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; color: white; font-size: 18px; cursor: pointer; opacity: 0.8;">×</button>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // Auto-remove after 10 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 10000);
}

// Add CSS animation for notifications
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
`;
document.head.appendChild(style);

// Filter and display applications
function filterAndDisplayApplications() {
  const statusFilter = document.getElementById('filterStatus').value;
  const documentTypeFilter = document.getElementById('filterDocumentType').value;
  const dateFromFilter = document.getElementById('filterDateFrom').value;
  const dateToFilter = document.getElementById('filterDateTo').value;
  const searchInput = document.getElementById('searchApplication').value.toLowerCase();
  
  // Start with all applications (show everything including approved/rejected in the table)
  let filtered = [...allApplications];
  
  // Filter by status
  if (statusFilter && statusFilter !== '') {
    filtered = filtered.filter(app => 
      app.status && app.status.toLowerCase() === statusFilter.toLowerCase()
    );
  }
  
  // Filter by document type
  if (documentTypeFilter && documentTypeFilter !== '') {
    filtered = filtered.filter(app => 
      app.documentType && app.documentType.toLowerCase() === documentTypeFilter.toLowerCase()
    );
  }
  
  // Filter by date range
  if (dateFromFilter) {
    filtered = filtered.filter(app => {
      if (!app.createdAt) return false;
      const appDate = app.createdAt.toDate ? app.createdAt.toDate() : new Date(app.createdAt);
      return appDate >= new Date(dateFromFilter);
    });
  }
  
  if (dateToFilter) {
    filtered = filtered.filter(app => {
      if (!app.createdAt) return false;
      const appDate = app.createdAt.toDate ? app.createdAt.toDate() : new Date(app.createdAt);
      return appDate <= new Date(dateToFilter);
    });
  }
  
  // Filter by search
  if (searchInput) {
    filtered = filtered.filter(app =>
      (app.applicationId && app.applicationId.toLowerCase().includes(searchInput)) ||
      app.id.toLowerCase().includes(searchInput) ||
      (app.applicantName && app.applicantName.toLowerCase().includes(searchInput)) ||
      (app.permitType && app.permitType.toLowerCase().includes(searchInput))
    );
  }
  
  // Update visible count
  const visibleCount = document.getElementById('visibleCount');
  const totalCount = document.getElementById('totalCount');
  if (visibleCount) visibleCount.textContent = filtered.length;
  if (totalCount) totalCount.textContent = allApplications.length;
  
  displayApplications(filtered);
}

// Display applications in table
function displayApplications(applications) {
  const tbody = document.getElementById('applicationsTable');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (applications.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 32px; color: #666;">No applications found matching your filters. Try adjusting your search or filters.</td></tr>';
    return;
  }
  
  applications.forEach(app => {
    const row = document.createElement('tr');
    const statusClass = getStatusClass(app.status);
    const dateFormatted = formatDate(app.createdAt);
    
    // Check if application was resubmitted
    const isResubmitted = app.revisionSubmittedAt || app.revisionRequestedAt;
    const resubmitCount = app.revisionCount || 0;
    
    row.innerHTML = `
      <td>
        ${app.applicationId || app.id || 'N/A'}
        ${isResubmitted ? `<span class="resubmit-badge" style="background: #f59e0b; color: white; padding: 2px 6px; border-radius: 10px; font-size: 10px; margin-left: 4px;">🔄 Resubmitted</span>` : ''}
      </td>
      <td>${app.applicantName || 'N/A'}</td>
      <td>${app.permitType || 'N/A'}</td>
      <td>${dateFormatted}</td>
      <td>
        <span class="status-badge ${statusClass}">${app.status || 'PENDING'}</span>
        ${isResubmitted ? `<div style="font-size: 11px; color: #6b7280; margin-top: 2px;">Resubmitted ${resubmitCount + 1}x</div>` : ''}
      </td>
      <td>
        <button class="action-btn btn-view" onclick="viewApplication('${app.id}')">View</button>
        ${app.status === 'pending' || app.status === 'under review' ? `<button class="action-btn btn-approve" onclick="quickApprove('${app.id}')">Approve</button>` : ''}
        ${app.status === 'pending' || app.status === 'under review' ? `<button class="action-btn btn-reject" onclick="quickReject('${app.id}')">Reject</button>` : ''}
        ${app.status === 'pending' || app.status === 'under review' ? `<button class="action-btn btn-review" onclick="quickNeedsResubmit('${app.id}')" style="background: #f59e0b; color: white;">Needs Resubmit</button>` : ''}
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
    'needs resubmit': 'needs-resubmit',
    'approved': 'approved',
    'rejected': 'rejected'
  };
  return statusMap[status?.toLowerCase()] || 'pending';
}

function getStatusIcon(status) {
  const icons = {
    'pending': '⏳',
    'under review': '🔍',
    'needs resubmit': '📝',
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

  // Always re-fetch from Firestore to get the latest documents
  try {
    const freshSnap = await getDoc(doc(db, 'applications', appId));
    if (freshSnap.exists()) {
      currentApplication = { id: freshSnap.id, ...freshSnap.data() };
      // Sync back into allApplications cache
      const idx = allApplications.findIndex(a => a.id === appId);
      if (idx !== -1) allApplications[idx] = currentApplication;
    }
  } catch(e) { console.warn('Could not re-fetch application:', e); }
  
  const detailsDiv = document.getElementById('applicationDetails');
  const actionsDiv = document.getElementById('modalActions');
  
  // Show loading state and navigate to full page section
  detailsDiv.innerHTML = `
    <div style="text-align: center; padding: 60px 20px; color: #64748b;">
      <div style="font-size: 48px; margin-bottom: 16px; animation: pulse 2s infinite;">⏳</div>
      <h3 style="margin: 0 0 8px 0; color: #1e293b;">Loading Application Details</h3>
      <p style="margin: 0; font-size: 14px;">Please wait while we retrieve the information...</p>
    </div>
  `;
  
  navigateToSection('applicationViewSection');
  
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
    ${(() => {
      // Check all possible document field names (documents, uploadedDocuments, files)
      const docsArray = currentApplication.documents || currentApplication.uploadedDocuments || currentApplication.files || [];
      const hasNoDocs = !docsArray || docsArray.length === 0;
      const isFailed = currentApplication.uploadStatus === 'failed';
      const isUploading = currentApplication.uploadStatus === 'uploading';
      if (!hasNoDocs) return '';
      if (isFailed || (isUploading && hasNoDocs)) {
        const submittedMs = currentApplication.createdAt?.toMillis?.() || currentApplication.createdAt?.seconds * 1000 || 0;
        const minutesSince = submittedMs ? (Date.now() - submittedMs) / 60000 : 999;
        const showFailed = isFailed || minutesSince > 5;
        return `
    <div class="detail-section">
      <div class="section-header">
        <h3 class="section-title">📁 Uploaded Documents</h3>
      </div>
      <div class="section-content">
        <div style="padding:16px;background:${showFailed ? '#fef2f2' : '#fffbeb'};border:1px solid ${showFailed ? '#fca5a5' : '#f59e0b'};border-radius:8px;color:${showFailed ? '#991b1b' : '#92400e'};font-size:14px;">
          ${showFailed
            ? '❌ <strong>Documents were not received.</strong> The customer\'s files failed to upload. Please contact the customer to resubmit their documents through their dashboard.'
            : '⏳ <strong>Documents are uploading.</strong> The customer just submitted — this page will update automatically in a moment.'}
        </div>
      </div>
    </div>`;
      }
      if (!isUploading) return '';
      return '';
    })()}
    ${(() => {
      // Check all possible document field names
      const docsArray = currentApplication.documents || currentApplication.uploadedDocuments || currentApplication.files || [];
      return docsArray && docsArray.length > 0 ? `
    <div class="detail-section">
      <div class="section-header">
        <h3 class="section-title">📁 Uploaded Documents (${docsArray.length})</h3>
      </div>
      <div class="section-content">
        <div class="documents-grid">
          ${docsArray.map((doc, index) => {
            const originalName = doc.name || `Document ${index + 1}`;
            const docName = getCleanDocumentName(originalName, doc.type, index);
            const docUrl  = doc.url  || doc.data || '';
            const docPath = doc.storagePath || '';   // plain path e.g. "denr-permits/file.pdf"
            const docType = doc.type || '';
            const docSize = doc.size || 0;
            const isImage = docType && docType.startsWith('image/');
            const isPDF   = docType && docType.includes('pdf');

            if (!docUrl && !docPath) {
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
                      <span>☁️ Firebase</span>
                    </div>
                  </div>
                </div>
              `;
            }

            // Use storagePath for server proxy (avoids URL parsing issues entirely)
            const serverRef = encodeURIComponent(docPath || docUrl);
            const safeName  = docName.replace(/'/g, "\\'");
            const safeUrl   = docUrl.replace(/'/g, "\\'");

            return `
              <div class="document-card" style="display:flex;flex-direction:column;">
                <div class="document-preview" style="cursor:pointer;" onclick="${isImage ? `openImageViewer('${safeUrl}','${safeName}')` : `window.open('/download-file?storagePath=${serverRef}&inline=1','_blank','noopener,noreferrer')`}">
                  ${isImage
                    ? `<img src="${docUrl}" alt="${docName}" style="width:100%;height:100%;object-fit:cover;" />`
                    : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#64748b;">
                        <div style="font-size:48px;margin-bottom:6px;">${isPDF ? '📄' : '📎'}</div>
                        <div style="font-weight:600;font-size:13px;">${isPDF ? 'PDF Document' : 'Document'}</div>
                        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Click to View</div>
                      </div>`
                  }
                </div>
                <div class="document-info" style="flex:1;">
                  <div class="document-name" title="${docName}">${docName}</div>
                  <div class="document-meta">
                    <span>${docSize ? (docSize / 1024).toFixed(1) + ' KB' : 'Unknown size'}</span>
                    <span>☁️ Firebase</span>
                  </div>
                </div>
                <div style="display:flex;gap:6px;padding:8px 10px 4px;">
                  <button onclick="window.open('/download-file?storagePath=${serverRef}&inline=1','_blank','noopener,noreferrer')" style="flex:1;padding:6px 0;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;" title="View in new tab">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    View
                  </button>
                  <a href="/download-file?storagePath=${serverRef}&filename=${encodeURIComponent(docName)}" download="${docName}" target="_blank" rel="noopener noreferrer" style="flex:1;padding:6px 0;background:#059669;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;text-decoration:none;" title="Download file">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download
                  </a>
                </div>
                <div style="padding:0 10px 10px;">
                  <button onclick="scanDocumentOCR('/download-file?storagePath=${serverRef}&inline=1','${safeName}')" style="width:100%;padding:6px 0;background:#7c3aed;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;" title="Scan & extract text using AI OCR">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h.01M7 12h10M7 17h10"/></svg>
                    Scan &amp; Extract Text
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
    ` : '';
    })()}

    <!-- Resubmit History Section -->
    ${(currentApplication.revisionRequestedAt || currentApplication.revisionSubmittedAt) ? `
    <div class="detail-section">
      <div class="section-header">
        <h3 class="section-title">🔄 Resubmission History</h3>
      </div>
      <div class="section-content">
        <div class="revision-history" style="background: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px;">
          ${currentApplication.revisionRequestedAt ? `
          <div style="margin-bottom: 12px;">
            <div style="font-weight: 600; color: #92400e; margin-bottom: 4px;">📝 Resubmission Requested</div>
            <div style="color: #6b7280; font-size: 14px;">${formatDate(currentApplication.revisionRequestedAt)}</div>
            <div style="color: #6b7280; font-size: 14px;">By: ${currentApplication.revisionRequestedBy || 'Staff'}</div>
            ${currentApplication.revisionComments ? `
            <div style="margin-top: 8px; padding: 8px; background: white; border-radius: 4px; border-left: 3px solid #f59e0b;">
              <div style="font-weight: 500; color: #1e293b; margin-bottom: 2px;">Required Changes:</div>
              <div style="color: #374151;">${currentApplication.revisionComments}</div>
            </div>
            ` : ''}
          </div>
          ` : ''}
          
          ${currentApplication.revisionSubmittedAt ? `
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #fbbf24;">
            <div style="font-weight: 600; color: #059669; margin-bottom: 4px;">✅ Resubmission Submitted</div>
            <div style="color: #6b7280; font-size: 14px;">${formatDate(currentApplication.revisionSubmittedAt)}</div>
            <div style="color: #6b7280; font-size: 14px;">By: ${currentApplication.revisionSubmittedBy || 'Customer'}</div>
            <div style="margin-top: 4px; font-size: 12px; color: #6b7280;">
              Total Resubmissions: ${(currentApplication.revisionCount || 0) + 1}
            </div>
          </div>
          ` : ''}
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
          
          ${currentApplication.revisionRequestedAt ? `
          <div class="timeline-item">
            <div class="timeline-marker completed" style="background: #f59e0b;">📝</div>
            <div class="timeline-content">
              <div class="timeline-title">Resubmission Requested</div>
              <div class="timeline-date">${formatDate(currentApplication.revisionRequestedAt)}</div>
              <div style="color: #92400e; font-size: 12px; margin-top: 2px;">By: ${currentApplication.revisionRequestedBy || 'Staff'}</div>
            </div>
          </div>
          ` : ''}
          
          ${currentApplication.revisionSubmittedAt ? `
          <div class="timeline-item">
            <div class="timeline-marker completed" style="background: #10b981;">✅</div>
            <div class="timeline-content">
              <div class="timeline-title">Resubmission Submitted</div>
              <div class="timeline-date">${formatDate(currentApplication.revisionSubmittedAt)}</div>
              <div style="color: #059669; font-size: 12px; margin-top: 2px;">By: ${currentApplication.revisionSubmittedBy || 'Customer'}</div>
            </div>
          </div>
          ` : ''}
          
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

// Quick needs resubmit from table
window.quickNeedsResubmit = async function(appId) {
  currentApplication = allApplications.find(app => app.id === appId);
  const needsResubmitModal = document.getElementById('needsResubmitModal');
  if (needsResubmitModal) {
    needsResubmitModal.style.display = 'flex';
  } else {
    // Fallback to old modal ID if not updated yet
    const needsRevisionModal = document.getElementById('needsRevisionModal');
    if (needsRevisionModal) {
      needsRevisionModal.style.display = 'flex';
    }
  }
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
    const actionButtons = document.querySelectorAll('.action-btn, #confirmReject, #confirmUnderReview, #confirmSchedule, #confirmNeedsResubmit');
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

    if (newStatus === 'needs resubmit') {
      updateData.revisionRequestedBy = auth.currentUser.email;
      updateData.revisionRequestedAt = serverTimestamp();
      if (revisionComments) {
        updateData.revisionComments = revisionComments;
      }
      // Don't increment resubmit count here - increment when customer submits resubmission
    }

    // Persist to Firestore (this was missing — caused status changes to silently
    // revert when the real-time onSnapshot listener refreshed local state).
    await updateDoc(appRef, updateData);

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
      if (newStatus === 'needs resubmit') {
        allApplications[appIndex].revisionRequestedBy = auth.currentUser.email;
        allApplications[appIndex].revisionRequestedAt = new Date();
        // Don't increment resubmit count here - increment when customer submits resubmission
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
    
    const toastMsgs = {
      'approved': '✅ Application approved! Notification sent to customer.',
      'rejected': '❌ Application rejected. Customer has been notified.',
      'needs resubmit': '📝 Resubmission requested. Customer has been notified.',
      'under review': '🔍 Application marked as Under Review.',
    };
    showToast(toastMsgs[newStatus] || `Application ${newStatus} successfully.`, newStatus === 'rejected' ? 'error' : newStatus === 'needs resubmit' ? 'warning' : 'success');

    // Notify customer + admin about the change
    const updatedApplication = {
      ...application,
      status: newStatus,
      rejectionReason,
      revisionComments,
      applicantUid: application.applicantUid,
      applicantName: application.applicantName,
      permitType: application.permitType,
      documentType: application.documentType,
      applicationId: application.applicationId || application.id
    };

    if (newStatus === 'approved') {
      await notifyCustomerAndAdmin('application-approved', updatedApplication);
    } else if (newStatus === 'rejected') {
      await notifyCustomerAndAdmin('application-rejected', updatedApplication, { rejectionReason });
    } else if (newStatus === 'needs resubmit') {
      await notifyCustomerAndAdmin('application-resubmit-requested', updatedApplication, { revisionComments });
    } else {
      await notifyCustomerAndAdmin('application-status-change', updatedApplication, { newStatus });
    }
    
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
}

document.getElementById('btnApprove').addEventListener('click', () => {
  if (currentApplication) {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('pickupDate').min = today;
    document.getElementById('approveScheduleModal').style.display = 'flex';
  }
});

document.getElementById('btnReject').addEventListener('click', () => {
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

// Needs Resubmit modal
document.getElementById('closeNeedsResubmitModal').addEventListener('click', () => {
  document.getElementById('needsResubmitModal').style.display = 'none';
});

document.getElementById('cancelNeedsResubmit').addEventListener('click', () => {
  document.getElementById('needsResubmitModal').style.display = 'none';
});

document.getElementById('confirmNeedsResubmit').addEventListener('click', async () => {
  const comments = document.getElementById('resubmitComments').value;
  if (!comments.trim()) {
    alert('Please provide resubmit comments.');
    return;
  }
  
  if (currentApplication) {
    await updateApplicationStatus(currentApplication.id, 'needs resubmit', null, comments);
    document.getElementById('needsResubmitModal').style.display = 'none';
    document.getElementById('resubmitComments').value = ''; // Clear the textarea
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

      showToast('✅ Application approved & pickup scheduled! Customer has been notified.', 'success');

      await notifyCustomerAndAdmin('application-pickup-scheduled', {
        ...currentApplication,
        status: 'approved'
      }, {
        pickupSchedule: {
          date: pickupDate,
          time: pickupTime,
          notes: pickupNotes || ''
        }
      });
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

// OCR Result modal - close when clicking outside
document.getElementById('ocrResultModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'ocrResultModal') {
    closeOCRModal();
  }
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
  console.log('Opening/downloading document:', url, filename);
  try {
    // Pass full URL — server handles all URL format extraction
    const serverUrl = `/download-file?storagePath=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename || 'document')}`;
    const link = document.createElement('a');
    link.href = serverUrl;
    link.download = filename || 'document';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => document.body.removeChild(link), 200);
  } catch (error) {
    console.error('Download error:', error);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

// Keep the old function for compatibility
window.downloadDocument = function(url, filename) {
  return downloadDocumentFromServer(url, filename);
};

// Open document in a new browser tab for inline viewing
window.viewDocumentInBrowser = function(url) {
  try {
    const viewUrl = `/download-file?storagePath=${encodeURIComponent(url)}&inline=1`;
    window.open(viewUrl, '_blank', 'noopener,noreferrer');
  } catch (error) {
    console.error('View error:', error);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
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
      sizeSpan.textContent = 'Size: Firebase hosted';
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

// Page Navigation - UPDATED with inline styles for reliability
window.navigateToSection = function(sectionId) {
  console.log('[STAFF NAV] Navigating to:', sectionId);
  
  // Hide all sections - use both class and inline style
  document.querySelectorAll('.page-section').forEach(section => {
    section.classList.remove('active');
    section.style.display = 'none'; // FORCE hide
  });

  // Show target section
  const targetSection = document.getElementById(sectionId);
  if (targetSection) {
    targetSection.classList.add('active');
    targetSection.style.display = 'block'; // FORCE show
    console.log('[STAFF NAV] SUCCESS: Section', sectionId, 'is now visible');
  } else {
    console.error('[STAFF NAV] ERROR: Section not found:', sectionId);
  }

  // Update page title
  const pageTitle = document.querySelector('.page-title');
  if (pageTitle) {
    const sectionNames = {
      'dashboardSection': 'Staff Dashboard',
      'applicationsSection': 'Applications',
      'recordsSection': 'My Records',
      'performanceSection': 'My Performance',
      'settingsSection': 'Settings',
      'helpSection': 'Help',
      'applicationViewSection': 'Application Details'
    };
    pageTitle.textContent = sectionNames[sectionId] || 'Staff Dashboard';
  }

  // Update nav items active state
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('data-section') === sectionId) {
      item.classList.add('active');
    }
  });

  // Load section-specific data
  if (sectionId === 'applicationsSection') {
    filterAndDisplayApplications();
  } else if (sectionId === 'performanceSection') {
    loadPerformanceData();
  } else if (sectionId === 'settingsSection') {
    loadSettingsData();
  }
  
  // Save to localStorage
  try { localStorage.setItem('currentSection', sectionId); } catch(e) {}
  
  // Scroll to top
  window.scrollTo(0, 0);
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

// General purpose toast notification
function showToast(message, type = 'success') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const colors = { success: '#0b5f2c', error: '#dc2626', info: '#2563eb', warning: '#d97706' };

  const toast = document.createElement('div');
  toast.className = 'staff-toast';
  toast.innerHTML = `<span style="margin-right:8px;font-size:16px;">${icons[type] || '✅'}</span>${message}`;

  Object.assign(toast.style, {
    position: 'fixed',
    top: '24px',
    right: '24px',
    background: colors[type] || colors.success,
    color: 'white',
    padding: '14px 20px',
    borderRadius: '10px',
    fontWeight: '600',
    fontSize: '14px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    zIndex: '99999',
    display: 'flex',
    alignItems: 'center',
    opacity: '0',
    transform: 'translateY(-16px)',
    transition: 'opacity 0.3s ease, transform 0.3s ease',
    maxWidth: '380px',
    lineHeight: '1.4'
  });

  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; }, 30);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-16px)';
    setTimeout(() => toast.remove(), 350);
  }, 3500);
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
      
      // Upload directly to Firebase Storage
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'staff-avatars');

      const uploadResponse = await fetch('/upload-file-to-storage', {
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
document.getElementById('applyFilterBtn')?.addEventListener('click', filterAndDisplayApplications);
document.getElementById('clearFilterBtn')?.addEventListener('click', clearFilters);

// Search input — normal filter OR OCR content search depending on toggle
let ocrSearchDebounceTimer = null;
document.getElementById('searchApplication')?.addEventListener('input', () => {
  const toggle = document.getElementById('ocrSearchToggle');
  if (toggle && toggle.checked) {
    clearTimeout(ocrSearchDebounceTimer);
    ocrSearchDebounceTimer = setTimeout(runOCRSearch, 600);
  } else {
    filterAndDisplayApplications();
  }
});

// OCR toggle — show/hide the results panel
document.getElementById('ocrSearchToggle')?.addEventListener('change', (e) => {
  const panel = document.getElementById('ocrSearchPanel');
  if (!panel) return;
  if (e.target.checked) {
    panel.style.display = 'block';
    const q = document.getElementById('searchApplication')?.value?.trim();
    if (q && q.length >= 2) runOCRSearch();
  } else {
    panel.style.display = 'none';
    filterAndDisplayApplications();
  }
});

// Batch Index button
document.getElementById('batchIndexBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('batchIndexBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Indexing…';
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE}/ocr/batch-index`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Batch OCR indexing started! This runs in the background. Check again in a few minutes.', 'success');
    } else {
      showToast('⚠️ ' + (data.error || 'Batch index failed.'), 'warning');
    }
  } catch (err) {
    showToast('❌ Failed to start batch index: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Index Docs';
  }
});

// Run OCR full-text search against the server index
async function runOCRSearch() {
  const q = document.getElementById('searchApplication')?.value?.trim();
  const resultsDiv = document.getElementById('ocrSearchResults');
  const statusSpan = document.getElementById('ocrSearchStatus');
  if (!resultsDiv) return;

  if (!q || q.length < 2) {
    resultsDiv.innerHTML = '<p style="color:#9ca3af;font-size:13px;text-align:center;margin:16px 0;">Type a keyword above and enable "Doc Content" to search inside uploaded documents.</p>';
    if (statusSpan) statusSpan.textContent = '';
    return;
  }

  resultsDiv.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:20px;color:#7c3aed;">
      <div style="width:20px;height:20px;border:2px solid #c4b5fd;border-top-color:#7c3aed;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      Searching document contents…
    </div>`;
  if (statusSpan) statusSpan.textContent = 'Searching…';

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE}/ocr/search?q=${encodeURIComponent(q)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Search failed (${res.status})`);
    }

    if (statusSpan) statusSpan.textContent = `${data.count} match${data.count !== 1 ? 'es' : ''} found`;

    if (data.count === 0) {
      resultsDiv.innerHTML = `
        <div style="text-align:center;padding:20px;color:#6b7280;">
          <div style="font-size:32px;margin-bottom:8px;">🔎</div>
          <p style="margin:0;font-size:13px;">No documents contain "<strong>${escapeHtml(q)}</strong>"</p>
          <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;">Try clicking ⚡ Index Docs if documents haven't been indexed yet.</p>
        </div>`;
      return;
    }

    resultsDiv.innerHTML = data.results.map(r => {
      const highlight = r.snippet.replace(
        new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        m => `<mark style="background:#fde68a;color:#92400e;padding:1px 2px;border-radius:2px;">${m}</mark>`
      );
      const matchedApp = allApplications.find(a => a.id === r.applicationId);
      const applicantName = r.applicantName || matchedApp?.applicantName || '—';
      const permitType = r.permitType || matchedApp?.permitType || matchedApp?.documentType || '';
      const appStatus = matchedApp?.status || '';
      const statusBadge = appStatus === 'approved'
        ? '<span style="background:#dcfce7;color:#166534;padding:1px 8px;border-radius:10px;font-size:11px;">✅ Approved</span>'
        : appStatus === 'rejected'
          ? '<span style="background:#fee2e2;color:#991b1b;padding:1px 8px;border-radius:10px;font-size:11px;">❌ Rejected</span>'
          : appStatus === 'pending'
            ? '<span style="background:#fef3c7;color:#92400e;padding:1px 8px;border-radius:10px;font-size:11px;">⏳ Pending</span>'
            : '';
      return `
        <div style="background:white;border:1px solid #e9d5ff;border-radius:8px;padding:12px;cursor:pointer;"
             onclick="openApplicationFromOCR('${r.applicationId}')"
             title="Click to open application">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
            <span style="font-weight:600;font-size:13px;color:#5b21b6;">📄 ${escapeHtml(r.fileName)}</span>
            ${statusBadge}
          </div>
          <div style="display:flex;gap:12px;margin-bottom:6px;font-size:12px;flex-wrap:wrap;">
            <span><strong style="color:#374151;">👤 Applicant:</strong> <span style="color:#1d4ed8;font-weight:600;">${escapeHtml(applicantName)}</span></span>
            ${permitType ? `<span><strong style="color:#374151;">📋 Permit:</strong> <span style="color:#6b7280;">${escapeHtml(permitType)}</span></span>` : ''}
            ${r.applicationId ? `<span><strong style="color:#374151;">ID:</strong> <span style="font-family:monospace;color:#6b7280;">${r.applicationId.slice(0,8)}…</span></span>` : ''}
          </div>
          <div style="font-size:12px;color:#374151;line-height:1.6;font-style:italic;background:#faf5ff;border-left:3px solid #c4b5fd;padding:6px 8px;border-radius:0 4px 4px 0;">"${highlight}"</div>
          <div style="margin-top:8px;display:flex;gap:6px;">
            <button onclick="event.stopPropagation();scanDocumentOCR('/download-file?storagePath=${encodeURIComponent(r.storagePath)}&inline=1','${escapeHtml(r.fileName).replace(/'/g,"\\'")}')"
              style="padding:4px 10px;background:#7c3aed;color:white;border:none;border-radius:5px;font-size:11px;cursor:pointer;">
              🔍 View Extracted Text
            </button>
            <a href="/download-file?storagePath=${encodeURIComponent(r.storagePath)}&inline=1" target="_blank"
              style="padding:4px 10px;background:#2563eb;color:white;border-radius:5px;font-size:11px;text-decoration:none;">
              👁 View Doc
            </a>
          </div>
        </div>`;
    }).join('');

  } catch (err) {
    console.error('[OCR Search]', err);
    if (statusSpan) statusSpan.textContent = 'Error';
    resultsDiv.innerHTML = `<p style="color:#dc2626;font-size:13px;text-align:center;padding:16px;">❌ ${escapeHtml(err.message)}</p>`;
  }
}

// Open the application detail modal from an OCR search result
window.openApplicationFromOCR = function(applicationId) {
  if (!applicationId) return;
  const app = allApplications.find(a => a.id === applicationId || a.applicationId === applicationId);
  if (app) {
    openApplicationDetail(app);
  } else {
    showToast('Application not loaded yet. Please refresh the list.', 'warning');
  }
};

// Clear filters function
function clearFilters() {
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterDocumentType').value = '';
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
  document.getElementById('searchApplication').value = '';
  document.getElementById('ocrSearchToggle').checked = false;
  document.getElementById('ocrSearchPanel').style.display = 'none';
  filterAndDisplayApplications();
}

// ═══════════════════════════════════════════════════════════════════════════
// RECORDS PAGE — Approved & Rejected with Smart Search
// ═══════════════════════════════════════════════════════════════════════════

let currentRecordsTab = 'approved';

// Called whenever the Records section becomes active or data changes
function renderRecordsPage() {
  const approved = allApplications.filter(a => a.status === 'approved');
  const rejected = allApplications.filter(a => a.status === 'rejected');

  // Update stats
  const el = id => document.getElementById(id);
  if (el('recApprovedCount')) el('recApprovedCount').textContent = approved.length;
  if (el('recRejectedCount')) el('recRejectedCount').textContent = rejected.length;
  if (el('recTotalCount'))    el('recTotalCount').textContent    = approved.length + rejected.length;

  applyRecordsFilters();
}

// Switch between Approved / Rejected tabs
window.switchRecordsTab = function(tab) {
  currentRecordsTab = tab;
  const approvedPanel  = document.getElementById('recApprovedPanel');
  const rejectedPanel  = document.getElementById('recRejectedPanel');
  const tabApproved    = document.getElementById('recTabApproved');
  const tabRejected    = document.getElementById('recTabRejected');

  if (tab === 'approved') {
    approvedPanel.style.display  = '';
    rejectedPanel.style.display  = 'none';
    tabApproved.style.color       = '#16a34a';
    tabApproved.style.fontWeight  = '700';
    tabApproved.style.borderBottom = '3px solid #16a34a';
    tabRejected.style.color       = '#9ca3af';
    tabRejected.style.fontWeight  = '600';
    tabRejected.style.borderBottom = '3px solid transparent';
  } else {
    approvedPanel.style.display  = 'none';
    rejectedPanel.style.display  = '';
    tabRejected.style.color       = '#dc2626';
    tabRejected.style.fontWeight  = '700';
    tabRejected.style.borderBottom = '3px solid #dc2626';
    tabApproved.style.color       = '#9ca3af';
    tabApproved.style.fontWeight  = '600';
    tabApproved.style.borderBottom = '3px solid transparent';
  }
};

// Apply filters and re-render both tables
function applyRecordsFilters() {
  const q        = (document.getElementById('recordsSearchInput')?.value || '').toLowerCase().trim();
  const typeVal  = (document.getElementById('recordsTypeFilter')?.value || '').toLowerCase();
  const dateFrom = document.getElementById('recordsDateFrom')?.value;
  const dateTo   = document.getElementById('recordsDateTo')?.value;

  const filter = (apps) => apps.filter(app => {
    // Keyword match
    if (q) {
      const haystack = [
        app.applicationId, app.id, app.applicantName,
        app.permitType, app.documentType, app.rejectionReason,
        app.rejectReason, app.comments
      ].map(v => (v || '').toLowerCase()).join(' ');
      if (!haystack.includes(q)) return false;
    }
    // Permit type
    if (typeVal && !(app.permitType || app.documentType || '').toLowerCase().includes(typeVal)) return false;
    // Date range — use createdAt
    if (dateFrom || dateTo) {
      const raw = app.createdAt;
      if (!raw) return false;
      const d = raw.toDate ? raw.toDate() : new Date(raw);
      if (dateFrom && d < new Date(dateFrom)) return false;
      if (dateTo   && d > new Date(dateTo + 'T23:59:59')) return false;
    }
    return true;
  });

  const approved = filter(allApplications.filter(a => a.status === 'approved'));
  const rejected = filter(allApplications.filter(a => a.status === 'rejected'));

  renderRecordsTable('approved', approved);
  renderRecordsTable('rejected', rejected);
}

function renderRecordsTable(type, apps) {
  const bodyId   = type === 'approved' ? 'recApprovedBody'  : 'recRejectedBody';
  const shownId  = type === 'approved' ? 'recApprovedShown' : 'recRejectedShown';
  const totalId  = type === 'approved' ? 'recApprovedTotal' : 'recRejectedTotal';
  const tbody    = document.getElementById(bodyId);
  if (!tbody) return;

  const allOfType = allApplications.filter(a => a.status === type);
  document.getElementById(shownId).textContent = apps.length;
  document.getElementById(totalId).textContent = allOfType.length;

  if (apps.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#9ca3af;">No ${type} records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = apps.map(app => {
    const id       = app.applicationId || app.id?.slice(0, 8) || '—';
    const name     = app.applicantName || '—';
    const permit   = app.permitType || app.documentType || '—';
    const created  = formatRecordDate(app.createdAt);

    if (type === 'approved') {
      const approvedDate = formatRecordDate(app.approvedAt || app.reviewedAt);
      const pickup = app.pickupSchedule?.date || '—';
      return `<tr>
        <td><span style="font-family:monospace;font-size:12px;">${escapeHtml(id)}</span></td>
        <td>${escapeHtml(name)}</td>
        <td><span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:12px;">${escapeHtml(permit)}</span></td>
        <td style="font-size:12px;color:#6b7280;">${created}</td>
        <td style="font-size:12px;color:#16a34a;font-weight:600;">${approvedDate}</td>
        <td style="font-size:12px;">${pickup !== '—' ? `<span style="background:#eff6ff;color:#2563eb;padding:2px 8px;border-radius:10px;">${pickup}</span>` : '—'}</td>
        <td>
          <button onclick="viewApplication('${app.id}')" style="padding:4px 12px;background:#2563eb;color:white;border:none;border-radius:5px;font-size:12px;cursor:pointer;">View</button>
        </td>
      </tr>`;
    } else {
      const rejectedDate = formatRecordDate(app.rejectedAt || app.reviewedAt);
      const reason = app.rejectionReason || app.rejectReason || app.comments || '—';
      const reasonShort = reason.length > 50 ? reason.slice(0, 50) + '…' : reason;
      return `<tr>
        <td><span style="font-family:monospace;font-size:12px;">${escapeHtml(id)}</span></td>
        <td>${escapeHtml(name)}</td>
        <td><span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:12px;">${escapeHtml(permit)}</span></td>
        <td style="font-size:12px;color:#6b7280;">${created}</td>
        <td style="font-size:12px;color:#dc2626;font-weight:600;">${rejectedDate}</td>
        <td style="font-size:12px;color:#6b7280;" title="${escapeHtml(reason)}">${escapeHtml(reasonShort)}</td>
        <td>
          <button onclick="viewApplication('${app.id}')" style="padding:4px 12px;background:#6b7280;color:white;border:none;border-radius:5px;font-size:12px;cursor:pointer;">View</button>
        </td>
      </tr>`;
    }
  }).join('');
}

function formatRecordDate(val) {
  if (!val) return '—';
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

window.clearRecordsFilters = function() {
  const el = id => document.getElementById(id);
  if (el('recordsSearchInput')) el('recordsSearchInput').value = '';
  if (el('recordsTypeFilter'))  el('recordsTypeFilter').value  = '';
  if (el('recordsDateFrom'))    el('recordsDateFrom').value    = '';
  if (el('recordsDateTo'))      el('recordsDateTo').value      = '';
  if (el('recordsOcrToggle')) { el('recordsOcrToggle').checked = false; }
  if (el('recordsOcrPanel'))    el('recordsOcrPanel').style.display = 'none';
  applyRecordsFilters();
};

// Wire up filter inputs
document.getElementById('recordsSearchInput')?.addEventListener('input', () => {
  const ocrOn = document.getElementById('recordsOcrToggle')?.checked;
  if (ocrOn) {
    clearTimeout(window._recOcrTimer);
    window._recOcrTimer = setTimeout(runRecordsOCRSearch, 600);
  } else {
    applyRecordsFilters();
  }
});
document.getElementById('recordsTypeFilter')?.addEventListener('change', applyRecordsFilters);
document.getElementById('recordsDateFrom')?.addEventListener('change', applyRecordsFilters);
document.getElementById('recordsDateTo')?.addEventListener('change', applyRecordsFilters);

// OCR toggle for Records
document.getElementById('recordsOcrToggle')?.addEventListener('change', (e) => {
  const panel = document.getElementById('recordsOcrPanel');
  if (!panel) return;
  if (e.target.checked) {
    panel.style.display = 'block';
    const q = document.getElementById('recordsSearchInput')?.value?.trim();
    if (q && q.length >= 2) runRecordsOCRSearch();
  } else {
    panel.style.display = 'none';
    applyRecordsFilters();
  }
});

// OCR search for the Records page (reuses the same /ocr/search endpoint)
async function runRecordsOCRSearch() {
  const q          = document.getElementById('recordsSearchInput')?.value?.trim();
  const resultsDiv = document.getElementById('recordsOcrResults');
  const statusSpan = document.getElementById('recordsOcrStatus');
  if (!resultsDiv) return;

  if (!q || q.length < 2) {
    resultsDiv.innerHTML = '<p style="color:#9ca3af;font-size:13px;text-align:center;margin:12px 0;">Type a keyword and enable "Doc Content" to search inside documents.</p>';
    if (statusSpan) statusSpan.textContent = '';
    return;
  }

  resultsDiv.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:16px;color:#7c3aed;">
    <div style="width:18px;height:18px;border:2px solid #c4b5fd;border-top-color:#7c3aed;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
    Searching document contents…</div>`;
  if (statusSpan) statusSpan.textContent = 'Searching…';

  try {
    const token = await auth.currentUser.getIdToken();
    const res   = await fetch(`${API_BASE}/ocr/search?q=${encodeURIComponent(q)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`);

    // Filter results to only show approved/rejected applications
    const recordAppIds = new Set(
      allApplications.filter(a => a.status === 'approved' || a.status === 'rejected').map(a => a.id)
    );
    const filtered = data.results.filter(r => !r.applicationId || recordAppIds.has(r.applicationId));

    if (statusSpan) statusSpan.textContent = `${filtered.length} match${filtered.length !== 1 ? 'es' : ''} in records`;

    if (filtered.length === 0) {
      resultsDiv.innerHTML = `<div style="text-align:center;padding:16px;color:#6b7280;">
        <div style="font-size:28px;margin-bottom:6px;">🔎</div>
        <p style="margin:0;font-size:13px;">No records contain "<strong>${escapeHtml(q)}</strong>"</p>
        <p style="margin:6px 0 0;font-size:12px;color:#9ca3af;">Try ⚡ Index Docs on the Applications page first.</p>
      </div>`;
      return;
    }

    resultsDiv.innerHTML = filtered.map(r => {
      const highlight = r.snippet.replace(
        new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        m => `<mark style="background:#fde68a;color:#92400e;padding:1px 2px;border-radius:2px;">${m}</mark>`
      );
      const app = allApplications.find(a => a.id === r.applicationId);
      const status = app?.status || '';
      const applicantName = r.applicantName || app?.applicantName || '—';
      const permitType = r.permitType || app?.permitType || app?.documentType || '';
      const statusBadge = status === 'approved'
        ? '<span style="background:#dcfce7;color:#166534;padding:1px 8px;border-radius:10px;font-size:11px;">✅ Approved</span>'
        : status === 'rejected'
          ? '<span style="background:#fee2e2;color:#991b1b;padding:1px 8px;border-radius:10px;font-size:11px;">❌ Rejected</span>'
          : '<span style="background:#fef3c7;color:#92400e;padding:1px 8px;border-radius:10px;font-size:11px;">⏳ Pending</span>';
      return `<div style="background:white;border:1px solid #e9d5ff;border-radius:8px;padding:10px;cursor:pointer;"
           onclick="viewApplication('${r.applicationId}')" title="Click to open application">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <span style="font-weight:600;font-size:12px;color:#5b21b6;">📄 ${escapeHtml(r.fileName)}</span>
          <div style="display:flex;gap:4px;align-items:center;">
            ${statusBadge}
          </div>
        </div>
        <div style="display:flex;gap:12px;margin-bottom:6px;font-size:12px;">
          <span><strong style="color:#374151;">👤 Applicant:</strong> <span style="color:#1d4ed8;font-weight:600;">${escapeHtml(applicantName)}</span></span>
          ${permitType ? `<span><strong style="color:#374151;">📋 Permit:</strong> <span style="color:#6b7280;">${escapeHtml(permitType)}</span></span>` : ''}
          ${r.applicationId ? `<span><strong style="color:#374151;">ID:</strong> <span style="font-family:monospace;color:#6b7280;">${r.applicationId.slice(0,8)}…</span></span>` : ''}
        </div>
        <div style="font-size:12px;color:#374151;line-height:1.5;font-style:italic;background:#faf5ff;border-left:3px solid #c4b5fd;padding:6px 8px;border-radius:0 4px 4px 0;">"${highlight}"</div>
        <div style="margin-top:6px;display:flex;gap:6px;">
          <button onclick="event.stopPropagation();scanDocumentOCR('/download-file?storagePath=${encodeURIComponent(r.storagePath)}&inline=1','${escapeHtml(r.fileName).replace(/'/g,"\\'")}')"
            style="padding:3px 10px;background:#7c3aed;color:white;border:none;border-radius:5px;font-size:11px;cursor:pointer;">🔍 View Text</button>
          <a href="/download-file?storagePath=${encodeURIComponent(r.storagePath)}&inline=1" target="_blank"
            style="padding:3px 10px;background:#2563eb;color:white;border-radius:5px;font-size:11px;text-decoration:none;">👁 View Doc</a>
        </div>
      </div>`;
    }).join('');

  } catch (err) {
    console.error('[Records OCR Search]', err);
    if (statusSpan) statusSpan.textContent = 'Error';
    resultsDiv.innerHTML = `<p style="color:#dc2626;font-size:13px;text-align:center;padding:12px;">❌ ${escapeHtml(err.message)}</p>`;
  }
}

// Refresh records page when the section becomes visible
document.querySelectorAll('[data-section="recordsSection"]').forEach(link => {
  link.addEventListener('click', () => setTimeout(renderRecordsPage, 100));
});

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
      await authGuardLogout('/pages/index.html');
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

// Navigation - wrapped in DOMContentLoaded to ensure DOM is ready
document.addEventListener('DOMContentLoaded', function() {
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
});

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
    
    // Check all possible document field names (documents, uploadedDocuments, files)
    const docsArray = application.documents || application.uploadedDocuments || application.files || [];
    
    if (docsArray && docsArray.length > 0) {
      documentsHTML = css + '<div class="documents-grid">';
      
      docsArray.forEach((doc, index) => {
        // Generate user-friendly name instead of technical file name
        const originalName = doc.name || `Document ${index + 1}`;
        const docName = getCleanDocumentName(originalName, doc.type, index);
        // Handle both Firebase Storage documents (url field) and base64 documents (data field)
        const docData = doc.url || doc.data || '';
        const docType = doc.type || '';
        const docSize = doc.size || 0;
        const isImage = docType && docType.startsWith('image/');
        const isPDF = docType && docType.includes('pdf');
        const fileIcon = isImage ? '🖼️' : (isPDF ? '📄' : '📎');
        const fileSize = docSize ? `(${(docSize / 1024).toFixed(1)} KB)` : '';
        
        if (!docData) {
          documentsHTML += `
            <div class="document-item" style="border-color: #ef4444; background: #fef2f2;">
              <div class="document-header">
                <span class="document-icon">⚠️</span>
                <div class="document-info">
                  <h4 style="color: #ef4444;">${docName}</h4>
                  <p class="document-meta">Data not available</p>
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
        
        const downloadUrl = docData;
        
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
              ${isImage ? `
                <button onclick="scanDocumentOCR('${downloadUrl}', '${docName.replace(/'/g, "\\'")}')" class="btn-ocr" style="padding: 8px 16px; margin: 4px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; gap: 6px;" title="Extract text from image using OCR">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h20M2 12l5-5m-5 5 5 5M22 12l-5-5m5 5-5 5"/></svg>
                  🔍 OCR Scan
                </button>
              ` : ''}
              ${isPDF ? '<span style="color: #059669; font-size: 11px; display: block; margin-top: 4px;">• Auto-download enabled</span>' : ''}
              <span style="color: #059669; font-size: 11px; display: block; margin-top: 2px;">☁️ Firebase hosted</span>
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

// ═══════════════════════════════════════════════════════════════════════════
// STAFF DOCUMENT OCR - Scan customer documents directly
// ═══════════════════════════════════════════════════════════════════════════

let currentOCRAbortController = null;

// Scan document using OCR (for staff viewing customer documents)
window.scanDocumentOCR = async function(docUrl, docName) {
  const modal = document.getElementById('ocrResultModal');
  const contentDiv = document.getElementById('ocrResultContent');
  const titleSpan = document.getElementById('ocrDocTitle');
  
  if (!modal || !contentDiv) {
    console.error('[Staff OCR] Modal elements not found');
    alert('OCR viewer not initialized. Please refresh the page.');
    return;
  }
  
  // Show modal with loading state
  titleSpan.textContent = docName;
  contentDiv.innerHTML = `
    <div style="text-align: center; padding: 40px 20px;">
      <div style="display: inline-block; width: 50px; height: 50px; border: 4px solid #e5e7eb; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px;"></div>
      <h3 style="margin: 0 0 8px 0; color: #1f2937; font-size: 18px;">🔍 Scanning Document...</h3>
      <p style="margin: 0; color: #6b7280; font-size: 14px;">Extracting text using AI-powered OCR</p>
      <p style="margin: 8px 0 0 0; color: #9ca3af; font-size: 12px;">This may take a few seconds</p>
    </div>
  `;
  modal.style.display = 'flex';
  
  // Cancel any previous OCR request
  if (currentOCRAbortController) {
    currentOCRAbortController.abort();
  }
  currentOCRAbortController = new AbortController();
  
  try {
    console.log('[Staff OCR] Starting OCR scan for:', docName);
    
    // First, fetch the image as blob
    const imageResponse = await fetch(docUrl, { 
      signal: currentOCRAbortController.signal 
    });
    
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }
    
    const imageBlob = await imageResponse.blob();
    
    // Create form data for OCR API
    const formData = new FormData();
    formData.append('file', imageBlob, docName);
    
    // Use the server's general OCR endpoint (Azure Document Intelligence)
    const API_BASE = window.API_BASE || 
      (location.hostname === 'localhost' ? 'http://127.0.0.1:3000' : '');
    
    // Get Firebase ID token for authentication
    let idToken = '';
    try {
      if (typeof auth !== 'undefined' && auth.currentUser) {
        idToken = await auth.currentUser.getIdToken();
      } else if (window.auth && window.auth.currentUser) {
        idToken = await window.auth.currentUser.getIdToken();
      }
    } catch (e) {
      console.warn('[Staff OCR] Could not get auth token:', e);
    }
    
    const ocrResponse = await fetch(`${API_BASE}/ocr`, {
      method: 'POST',
      body: formData,
      signal: currentOCRAbortController.signal,
      headers: idToken ? {
        'Authorization': `Bearer ${idToken}`
      } : {}
    });
    
    if (!ocrResponse.ok) {
      const errorData = await ocrResponse.json().catch(() => ({}));
      throw new Error(errorData.error || `OCR failed: ${ocrResponse.status}`);
    }
    
    const ocrResult = await ocrResponse.json();
    
    // Display OCR results
    displayOCRResults(ocrResult, docUrl, docName);
    
    console.log('[Staff OCR] Scan completed successfully');
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('[Staff OCR] Request was cancelled');
      return;
    }
    
    console.error('[Staff OCR] Error:', error);
    contentDiv.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: #ef4444;">
        <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
        <h3 style="margin: 0 0 8px 0; color: #dc2626; font-size: 18px;">OCR Scan Failed</h3>
        <p style="margin: 0 0 16px 0; color: #7f1d1d; font-size: 14px;">${error.message}</p>
        <button onclick="scanDocumentOCR('${docUrl}', '${docName.replace(/'/g, "\\'")}')" class="btn-primary" style="padding: 10px 20px; border-radius: 6px; cursor: pointer;">
          🔄 Try Again
        </button>
      </div>
    `;
  }
};

// Display OCR results in the modal
function displayOCRResults(result, docUrl, docName) {
  const contentDiv = document.getElementById('ocrResultContent');
  
  const extractedText = result.text || 'No text detected';
  const confidence = result.confidence || null;
  const lines = result.lines || [];
  
  // Calculate text statistics
  const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;
  const charCount = extractedText.length;
  
  contentDiv.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; height: 100%;">
      <!-- Left: Document Preview -->
      <div style="background: #f9fafb; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; max-height: 70vh; overflow: hidden;">
        <h4 style="margin: 0 0 12px 0; color: #374151; font-size: 14px; font-weight: 600;">📄 Original Document</h4>
        <div style="flex: 1; overflow: auto; border-radius: 8px; border: 1px solid #e5e7eb; background: white;">
          <img src="${docUrl}" alt="${docName}" style="width: 100%; height: auto; display: block;" />
        </div>
        <div style="margin-top: 12px; display: flex; gap: 8px;">
          <a href="${docUrl}" target="_blank" style="flex: 1; padding: 8px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; text-align: center; font-size: 12px; font-weight: 500;">👁️ View Full Size</a>
          <a href="${docUrl}" download="${docName}" style="flex: 1; padding: 8px; background: #10b981; color: white; text-decoration: none; border-radius: 6px; text-align: center; font-size: 12px; font-weight: 500;">📥 Download</a>
        </div>
      </div>
      
      <!-- Right: Extracted Text -->
      <div style="background: white; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; max-height: 70vh; overflow: hidden; border: 1px solid #e5e7eb;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb;">
          <h4 style="margin: 0; color: #374151; font-size: 14px; font-weight: 600;">📝 Extracted Text</h4>
          <div style="display: flex; gap: 8px; align-items: center;">
            ${confidence ? `<span style="padding: 4px 8px; background: ${confidence > 80 ? '#d1fae5' : confidence > 60 ? '#fef3c7' : '#fee2e2'}; color: ${confidence > 80 ? '#065f46' : confidence > 60 ? '#92400e' : '#991b1b'}; border-radius: 12px; font-size: 11px; font-weight: 600;">${confidence}% Confidence</span>` : ''}
            <button onclick="copyOCRText()" style="padding: 6px 12px; background: #f3f4f6; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 4px; color: #374151;" title="Copy extracted text">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Copy
            </button>
          </div>
        </div>
        
        <div style="flex: 1; overflow: auto; background: #f9fafb; border-radius: 8px; padding: 12px; font-family: 'Monaco', 'Consolas', monospace; font-size: 13px; line-height: 1.6; color: #1f2937; white-space: pre-wrap; word-break: break-word;" id="ocrExtractedText">
          ${escapeHtml(extractedText)}
        </div>
        
        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; color: #6b7280; font-size: 12px;">
          <span>${wordCount} words • ${charCount} characters • ${lines.length} lines</span>
          <span style="color: #3b82f6; font-weight: 500;">Powered by Azure AI</span>
        </div>
      </div>
    </div>
  `;
}

// Copy OCR text to clipboard
window.copyOCRText = function() {
  const textEl = document.getElementById('ocrExtractedText');
  if (!textEl) return;
  
  const text = textEl.innerText;
  navigator.clipboard.writeText(text).then(() => {
    showNotification('✅ Text copied to clipboard', 'success');
  }).catch(err => {
    console.error('Failed to copy:', err);
    showNotification('❌ Failed to copy text', 'error');
  });
};

// Close OCR modal
window.closeOCRModal = function() {
  const modal = document.getElementById('ocrResultModal');
  if (modal) {
    modal.style.display = 'none';
  }
  // Abort any ongoing OCR request
  if (currentOCRAbortController) {
    currentOCRAbortController.abort();
    currentOCRAbortController = null;
  }
};

// Helper: Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Helper: Show notification
function showNotification(message, type = 'info') {
  // Use existing notification system or alert
  if (window.showNotification && typeof window.showNotification === 'function') {
    window.showNotification(message, type);
  } else {
    alert(message);
  }
}

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

