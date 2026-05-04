/**
 * Auth Guard Module - Firebase Auth State Management
 * 
 * Best Practices:
 * - Rely ONLY on Firebase Auth state (onAuthStateChanged)
 * - No sessionStorage/localStorage for auth decisions
 * - Use URL params for explicit logout detection
 * - Wait for auth state to initialize before redirecting
 */

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, getIdTokenResult } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getDoc, doc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Auth state cache
let authState = {
  initialized: false,
  user: null,
  role: null,
  token: null
};

// Listeners for auth state changes
const listeners = new Set();

/**
 * Check if URL contains logout parameter
 * This is the ONLY acceptable use of "storage" for auth - URL params survive navigation
 */
function hasLogoutParam() {
  const params = new URLSearchParams(window.location.search);
  return params.has('loggedOut');
}

/**
 * Clear logout parameter from URL without page reload
 */
function clearLogoutParam() {
  if (hasLogoutParam()) {
    const url = new URL(window.location.href);
    url.searchParams.delete('loggedOut');
    window.history.replaceState({}, '', url);
  }
}

/**
 * Get user role from token or Firestore
 */
async function getUserRole(user) {
  try {
    const tokenResult = await user.getIdTokenResult(true);
    let role = tokenResult.claims.role;
    
    if (!role) {
      // Fallback to Firestore
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      role = userDoc.exists() ? userDoc.data().role : 'customer';
    }
    
    return role;
  } catch (error) {
    console.error('Error getting user role:', error);
    return 'customer';
  }
}

/**
 * Initialize auth state listener
 * Call this once at app startup
 */
export function initAuthGuard() {
  return new Promise((resolve) => {
    // Clear logout param on any successful auth
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      authState.initialized = true;
      authState.user = user;
      
      if (user) {
        authState.role = await getUserRole(user);
        authState.token = await user.getIdToken();
        clearLogoutParam(); // User is logged in, clear logout param
      } else {
        authState.role = null;
        authState.token = null;
      }
      
      // Notify all listeners
      listeners.forEach(cb => cb(authState));
      
      resolve(authState);
    });
    
    // Return unsubscribe function
    return unsubscribe;
  });
}

/**
 * Subscribe to auth state changes
 */
export function onAuthChange(callback) {
  listeners.add(callback);
  // Immediately call with current state if initialized
  if (authState.initialized) {
    callback(authState);
  }
  
  // Return unsubscribe
  return () => listeners.delete(callback);
}

/**
 * Get current auth state (synchronous, may be stale)
 */
export function getAuthState() {
  return authState;
}

/**
 * Wait for auth to initialize
 */
export function waitForAuth() {
  return new Promise((resolve) => {
    if (authState.initialized) {
      resolve(authState);
      return;
    }
    
    const unsubscribe = onAuthChange((state) => {
      unsubscribe();
      resolve(state);
    });
  });
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated() {
  return authState.initialized && authState.user !== null;
}

/**
 * Get current user
 */
export function getCurrentUser() {
  return authState.user;
}

/**
 * Get user role
 */
export function getCurrentRole() {
  return authState.role;
}

/**
 * Logout with proper redirect handling
 * Uses URL parameter to prevent redirect loops
 */
export async function logout(redirectUrl = '/index.html') {
  try {
    await auth.signOut();
    // Add loggedOut param to prevent auth redirect loops
    const separator = redirectUrl.includes('?') ? '&' : '?';
    window.location.href = `${redirectUrl}${separator}loggedOut=true`;
  } catch (error) {
    console.error('Logout error:', error);
    throw error;
  }
}

/**
 * Create loading overlay while auth is being checked
 * This prevents content flash before redirect
 */
function createAuthOverlay() {
  // Check if overlay already exists
  if (document.getElementById('auth-check-overlay')) return;
  
  const overlay = document.createElement('div');
  overlay.id = 'auth-check-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: #f8fafc;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: system-ui, -apple-system, sans-serif;
  `;
  overlay.innerHTML = `
    <div style="
      width: 48px;
      height: 48px;
      border: 4px solid #e2e8f0;
      border-top-color: #059669;
      border-radius: 50%;
      animation: auth-spin 1s linear infinite;
    "></div>
    <p style="margin-top: 16px; color: #64748b; font-size: 14px;">Verifying access...</p>
    <style>
      @keyframes auth-spin {
        to { transform: rotate(360deg); }
      }
    </style>
  `;
  document.body.appendChild(overlay);
}

/**
 * Remove auth overlay
 */
function removeAuthOverlay() {
  const overlay = document.getElementById('auth-check-overlay');
  if (overlay) {
    overlay.remove();
  }
}

/**
 * Role-based dashboard redirects
 * Maps user roles to their correct dashboard URLs
 */
const roleDashboardRedirects = {
  admin: '/pages/admin-dashboard.html',
  staff: '/pages/staff-dashboard.html',
  customer: '/pages/customer-dashboard.html'
};

/**
 * Protect a route - redirect to login if not authenticated
 * Redirect to correct dashboard if wrong role
 * Call this in dashboard pages
 */
export async function protectRoute(options = {}) {
  const {
    allowedRoles = [], // Empty array = any authenticated user
    loginRedirect = '/index.html',
    onAuthenticated = null,
    onUnauthenticated = null
  } = options;
  
  // Create overlay immediately to prevent content flash
  if (document.body) {
    createAuthOverlay();
  }
  
  // Wait for auth to initialize
  const state = await waitForAuth();
  
  // Check for explicit logout - don't redirect if user just logged out
  if (hasLogoutParam()) {
    clearLogoutParam();
    removeAuthOverlay();
    if (onUnauthenticated) onUnauthenticated();
    return false;
  }
  
  if (state.user) {
    // Check role if specified
    if (allowedRoles.length > 0 && !allowedRoles.includes(state.role)) {
      console.warn(`[AUTH GUARD] Access denied. User role: ${state.role}, Required: ${allowedRoles.join(', ')}`);
      
      // Security audit log
      const accessAttempt = {
        timestamp: new Date().toISOString(),
        userId: state.user.uid,
        userRole: state.role,
        attemptedPage: window.location.pathname,
        requiredRoles: allowedRoles,
        ip: 'client-side'
      };
      console.warn('[AUTH GUARD] Unauthorized access attempt:', accessAttempt);
      
      // IMPORTANT: Redirect to user's CORRECT dashboard based on their role
      // Don't sign out - keep them logged in and send them where they belong
      const correctDashboard = roleDashboardRedirects[state.role] || loginRedirect;
      
      console.warn(`[AUTH GUARD] Redirecting user to their correct dashboard: ${correctDashboard}`);
      
      // Only redirect if they're not already on their correct dashboard
      if (window.location.pathname !== correctDashboard.replace('/pages/', '/pages/')) {
        window.location.href = correctDashboard;
      } else {
        // They're already on their correct dashboard but somehow triggered this
        removeAuthOverlay();
        if (onAuthenticated) onAuthenticated(state);
        return true;
      }
      return false;
    }
    
    // Authorized - remove overlay and allow access
    removeAuthOverlay();
    if (onAuthenticated) onAuthenticated(state);
    return true;
  } else {
    // Not authenticated
    console.warn('[AUTH GUARD] No authenticated user found. Redirecting to login.');
    if (onUnauthenticated) onUnauthenticated();
    window.location.href = loginRedirect;
    return false;
  }
}

/**
 * Redirect authenticated users away from login page
 * Call this on login page
 */
export async function redirectIfAuthenticated(options = {}) {
  const {
    redirectUrl = '/pages/customer-dashboard.html',
    roleBasedRedirects = {
      admin: '/pages/admin-dashboard.html',
      staff: '/pages/staff-dashboard.html',
      customer: '/pages/customer-dashboard.html'
    }
  } = options;
  
  // Wait for auth to initialize
  const state = await waitForAuth();
  
  // Check for explicit logout - stay on login page
  if (hasLogoutParam()) {
    clearLogoutParam();
    return false;
  }
  
  if (state.user && state.user.emailVerified) {
    // Redirect based on role
    const targetUrl = roleBasedRedirects[state.role] || redirectUrl;
    window.location.href = targetUrl;
    return true;
  }
  
  return false;
}

// Re-export auth for convenience
export { auth };
