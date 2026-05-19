import { subscribeToNotifications, markNotificationAsRead, markAllNotificationsAsRead } from './notification-service.js';

function formatTimestamp(timestamp) {
  if (!timestamp) return 'Just now';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return 'Just now';
  }
}

function getEventIcon(eventType) {
  const icons = {
    'application-submitted':          `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>`,
    'application-resubmitted':        `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></svg>`,
    'application-approved':           `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"/></svg>`,
    'application-rejected':           `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    'application-resubmit-requested': `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    'application-pickup-scheduled':   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    'application-status-change':      `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>`,
    'application-edited':             `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  };
  return icons[eventType] || icons['application-status-change'];
}

function getEventColor(eventType) {
  const map = {
    'application-submitted':          { bg: '#eff6ff', color: '#2563eb' },
    'application-resubmitted':        { bg: '#eff6ff', color: '#2563eb' },
    'application-approved':           { bg: '#f0fdf4', color: '#16a34a' },
    'application-rejected':           { bg: '#fef2f2', color: '#dc2626' },
    'application-resubmit-requested': { bg: '#fffbeb', color: '#d97706' },
    'application-pickup-scheduled':   { bg: '#ecfeff', color: '#0891b2' },
    'application-status-change':      { bg: '#f8fafc', color: '#64748b' },
    'application-edited':             { bg: '#faf5ff', color: '#7c3aed' },
  };
  return map[eventType] || map['application-status-change'];
}

let stylesInjected = false;

function ensureStyles() {
  if (stylesInjected) return;
  const style = document.createElement('style');
  style.id = 'notification-center-styles';
  style.textContent = `
    .nc-panel {
      position: fixed;
      top: 72px;
      right: 24px;
      width: min(390px, calc(100vw - 32px));
      max-height: 78vh;
      background: #fff;
      border-radius: 18px;
      box-shadow: 0 24px 60px rgba(15,23,42,0.15), 0 4px 16px rgba(15,23,42,0.06);
      z-index: 6000;
      display: flex;
      flex-direction: column;
      border: 1px solid rgba(15,23,42,0.08);
      transition: opacity 0.2s ease, transform 0.2s cubic-bezier(.16,1,.3,1);
      opacity: 0;
      transform: translateY(-8px) scale(0.97);
      pointer-events: none;
      overflow: hidden;
    }
    .nc-panel.is-open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    .nc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 15px 18px 13px;
      border-bottom: 1px solid #f1f5f9;
      flex-shrink: 0;
    }
    .nc-header-left { display: flex; align-items: center; gap: 8px; }
    .nc-title { font-weight: 700; font-size: 15px; color: #0f172a; }
    .nc-unread-pill {
      background: #2563eb; color: #fff; font-size: 11px; font-weight: 700;
      border-radius: 999px; padding: 2px 8px; line-height: 1.5; display: none;
    }
    .nc-header-actions { display: flex; gap: 6px; align-items: center; }
    .nc-mark-all-btn {
      border: 1px solid #e2e8f0; background: #fff; color: #475569;
      padding: 5px 12px; border-radius: 8px; font-size: 12px; font-weight: 500;
      cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s; white-space: nowrap;
    }
    .nc-mark-all-btn:hover:not(:disabled) { background: #f1f5f9; border-color: #94a3b8; color: #0f172a; }
    .nc-mark-all-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .nc-close-btn {
      border: none; background: transparent; color: #94a3b8; cursor: pointer;
      border-radius: 8px; width: 30px; height: 30px; display: flex;
      align-items: center; justify-content: center; transition: background 0.15s, color 0.15s; flex-shrink: 0;
    }
    .nc-close-btn:hover { background: #f1f5f9; color: #0f172a; }
    .nc-list {
      display: flex; flex-direction: column; overflow-y: auto; flex: 1;
      padding: 6px 8px; gap: 2px;
    }
    .nc-list::-webkit-scrollbar { width: 4px; }
    .nc-list::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 99px; }
    .nc-empty {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 36px 20px; gap: 10px;
    }
    .nc-empty-icon {
      width: 46px; height: 46px; background: #f1f5f9; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
    }
    .nc-empty-text { font-size: 13px; color: #94a3b8; font-weight: 500; }
    .nc-item {
      display: flex; align-items: flex-start; gap: 11px;
      padding: 10px 10px; border-radius: 12px; cursor: pointer;
      border: none; background: transparent; text-align: left; width: 100%;
      transition: background 0.12s;
    }
    .nc-item:hover { background: #f8fafc; }
    .nc-item.unread { background: #f0f7ff; }
    .nc-item.unread:hover { background: #e6f1ff; }
    .nc-item-icon {
      width: 36px; height: 36px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;
    }
    .nc-item-body { flex: 1; min-width: 0; }
    .nc-item-title {
      font-weight: 600; font-size: 13px; color: #0f172a; margin-bottom: 3px;
      display: flex; align-items: center; gap: 6px;
    }
    .nc-unread-dot {
      width: 7px; height: 7px; border-radius: 50%; background: #2563eb;
      flex-shrink: 0; display: none;
    }
    .nc-item.unread .nc-unread-dot { display: inline-block; }
    .nc-item-message { font-size: 12.5px; color: #475569; line-height: 1.45; margin-bottom: 5px; }
    .nc-item-meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .nc-item-time { font-size: 11.5px; color: #94a3b8; font-weight: 500; }
    .nc-item-tag {
      font-size: 11px; color: #94a3b8; background: #f1f5f9;
      border-radius: 5px; padding: 1px 7px; max-width: 140px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .nc-footer {
      padding: 10px 12px 13px; border-top: 1px solid #f1f5f9; flex-shrink: 0;
    }
    .nc-view-all-btn {
      display: block; width: 100%; padding: 9px;
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
      font-size: 13px; font-weight: 600; color: #2563eb; cursor: pointer;
      text-align: center; transition: background 0.15s, border-color 0.15s;
    }
    .nc-view-all-btn:hover { background: #eff6ff; border-color: #bfdbfe; }
    .nc-modal-overlay {
      position: fixed; inset: 0; z-index: 7000;
      background: rgba(15,23,42,0.45); display: flex;
      align-items: center; justify-content: center; padding: 16px;
    }
    .nc-modal {
      background: #fff; border-radius: 20px; width: min(520px, 100%);
      max-height: 84vh; display: flex; flex-direction: column;
      overflow: hidden; box-shadow: 0 32px 80px rgba(15,23,42,0.22);
    }
    .nc-modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 22px 14px; border-bottom: 1px solid #f1f5f9; flex-shrink: 0;
    }
    .nc-modal-title { font-weight: 700; font-size: 16px; color: #0f172a; }
    .nc-modal-list {
      overflow-y: auto; flex: 1; padding: 8px 14px; display: flex; flex-direction: column; gap: 2px;
    }
    .nc-modal-list::-webkit-scrollbar { width: 4px; }
    .nc-modal-list::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 99px; }
    .nc-modal-footer {
      padding: 12px 18px 16px; border-top: 1px solid #f1f5f9;
      display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
    }
    .nc-modal-count { font-size: 13px; color: #94a3b8; }
    .nc-modal-mark-all {
      border: 1px solid #e2e8f0; background: #fff; color: #2563eb;
      font-weight: 600; font-size: 13px; padding: 8px 16px;
      border-radius: 9px; cursor: pointer; transition: background 0.15s, border-color 0.15s;
    }
    .nc-modal-mark-all:hover:not(:disabled) { background: #eff6ff; border-color: #bfdbfe; }
    .nc-modal-mark-all:disabled { opacity: 0.4; cursor: not-allowed; }
    @media (max-width: 640px) {
      .nc-panel { left: 10px !important; right: 10px !important; width: auto !important; top: 62px !important; }
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

function buildNotificationItemHTML(n) {
  const isUnread = n.read === false;
  const { bg, color } = getEventColor(n.eventType);
  const tag = n.payload?.permitType || n.payload?.documentType || '';
  return `
    <button data-id="${n.id}" class="nc-item${isUnread ? ' unread' : ''}">
      <div class="nc-item-icon" style="background:${bg};color:${color};">${getEventIcon(n.eventType)}</div>
      <div class="nc-item-body">
        <div class="nc-item-title">
          <span>${n.title || 'Notification'}</span>
          <span class="nc-unread-dot"></span>
        </div>
        <div class="nc-item-message">${n.message || ''}</div>
        <div class="nc-item-meta">
          <span class="nc-item-time">${formatTimestamp(n.createdAt)}</span>
          ${tag ? `<span class="nc-item-tag">${tag}</span>` : ''}
        </div>
      </div>
    </button>
  `;
}

export function createNotificationCenter({
  buttonSelector = '#notificationBtn',
  badgeSelector = '.notification-badge',
  panelId = 'globalNotificationPanel',
  emptyState = 'No notifications yet',
  title = 'Notifications'
} = {}) {
  const button = buttonSelector ? document.querySelector(buttonSelector) : null;
  const badge = badgeSelector
    ? (badgeSelector.startsWith('#') || badgeSelector.startsWith('.')
        ? document.querySelector(badgeSelector)
        : button?.querySelector(badgeSelector))
    : button?.querySelector('.notification-badge');

  let panel = null;
  let unsubscribe = null;
  let currentUserId = null;
  let notifications = [];
  let markingAll = false;

  function ensurePanel() {
    if (panel) return panel;
    ensureStyles();

    panel = document.createElement('div');
    panel.id = panelId;
    panel.className = 'nc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', title);

    panel.innerHTML = `
      <div class="nc-header">
        <div class="nc-header-left">
          <span class="nc-title">${title}</span>
          <span class="nc-unread-pill">0</span>
        </div>
        <div class="nc-header-actions">
          <button type="button" class="nc-mark-all-btn" disabled>Mark all read</button>
          <button type="button" class="nc-close-btn" aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="nc-list"></div>
      <div class="nc-footer">
        <button type="button" class="nc-view-all-btn">View all notifications</button>
      </div>
    `;

    document.body.appendChild(panel);

    panel.querySelector('.nc-close-btn').addEventListener('click', () => togglePanel(false));

    panel.querySelector('.nc-mark-all-btn').addEventListener('click', async (e) => {
      if (!currentUserId || markingAll) return;
      markingAll = true;
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Marking…';
      try {
        await markAllNotificationsAsRead(currentUserId);
      } finally {
        markingAll = false;
      }
    });

    panel.querySelector('.nc-view-all-btn').addEventListener('click', () => {
      togglePanel(false);
      openAllNotificationsModal();
    });

    document.addEventListener('click', (event) => {
      if (!panel?.classList.contains('is-open')) return;
      if (panel.contains(event.target)) return;
      if (button && button.contains(event.target)) return;
      togglePanel(false);
    });

    return panel;
  }

  function openAllNotificationsModal() {
    document.getElementById('ncModalOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ncModalOverlay';
    overlay.className = 'nc-modal-overlay';

    const unreadCount = notifications.filter(n => !n.read).length;

    overlay.innerHTML = `
      <div class="nc-modal">
        <div class="nc-modal-header">
          <span class="nc-modal-title">All Notifications</span>
          <button type="button" class="nc-close-btn" id="ncModalClose" aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="nc-modal-list" id="ncModalList"></div>
        <div class="nc-modal-footer">
          <span class="nc-modal-count">${notifications.length} notification${notifications.length !== 1 ? 's' : ''}</span>
          <button type="button" class="nc-modal-mark-all" id="ncModalMarkAll" ${unreadCount === 0 ? 'disabled' : ''}>
            Mark all as read
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    renderModalList(overlay);

    overlay.querySelector('#ncModalClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#ncModalMarkAll').addEventListener('click', async (e) => {
      if (!currentUserId) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Marking…';
      await markAllNotificationsAsRead(currentUserId).catch(() => {});
      overlay.remove();
    });
  }

  function renderModalList(overlay) {
    const list = overlay.querySelector('#ncModalList');
    if (!list) return;
    if (!notifications.length) {
      list.innerHTML = `<div class="nc-empty"><div class="nc-empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div><span class="nc-empty-text">No notifications yet</span></div>`;
      return;
    }
    list.innerHTML = notifications.map(buildNotificationItemHTML).join('');
    list.querySelectorAll('.nc-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const id = item.getAttribute('data-id');
        if (id) {
          item.classList.remove('unread');
          item.querySelector('.nc-unread-dot')?.style.setProperty('display', 'none');
          await markNotificationAsRead(id).catch(() => {});
        }
      });
    });
  }

  function positionPanel() {
    if (!panel || !button) return;
    const rect = button.getBoundingClientRect();
    const vp = 16;
    const width = Math.min(390, window.innerWidth - vp * 2);
    const top = rect.bottom + 10;
    const right = Math.max(window.innerWidth - rect.right, vp);
    panel.style.top = `${top}px`;
    panel.style.right = `${right}px`;
    panel.style.width = `${width}px`;
  }

  function togglePanel(forceState) {
    if (!panel) return;
    const shouldShow = forceState !== undefined ? forceState : !panel.classList.contains('is-open');
    if (shouldShow) { positionPanel(); panel.classList.add('is-open'); }
    else { panel.classList.remove('is-open'); }
  }

  function updateBadge(unreadCount) {
    if (!badge) return;
    badge.textContent = unreadCount;
    badge.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
  }

  function renderNotifications() {
    const list = panel?.querySelector('.nc-list');
    const pill = panel?.querySelector('.nc-unread-pill');
    const markAllBtn = panel?.querySelector('.nc-mark-all-btn');
    if (!list) return;

    const unreadCount = notifications.filter((n) => !n.read).length;
    updateBadge(unreadCount);

    if (pill) {
      pill.textContent = unreadCount;
      pill.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    }
    if (markAllBtn) {
      markAllBtn.disabled = unreadCount === 0 || markingAll;
      if (!markingAll) markAllBtn.textContent = 'Mark all read';
    }

    if (!notifications.length) {
      list.innerHTML = `
        <div class="nc-empty">
          <div class="nc-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </div>
          <span class="nc-empty-text">${emptyState}</span>
        </div>
      `;
      return;
    }

    list.innerHTML = notifications.slice(0, 8).map(buildNotificationItemHTML).join('');

    list.querySelectorAll('.nc-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const id = item.getAttribute('data-id');
        if (!id) return;
        await markNotificationAsRead(id).catch(() => {});
      });
    });
  }

  async function start(userId) {
    if (!userId) return;
    ensurePanel();
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    currentUserId = userId;
    unsubscribe = subscribeToNotifications({
      userId,
      onUpdate: (items) => {
        notifications = items;
        renderNotifications();
      }
    });
  }

  function stop() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    currentUserId = null;
    notifications = [];
    updateBadge(0);
  }

  if (button) {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      ensurePanel();
      togglePanel();
    });
  }

  window.addEventListener('resize', () => {
    if (panel?.classList.contains('is-open')) positionPanel();
  });

  return { start, stop, toggle: togglePanel };
}
