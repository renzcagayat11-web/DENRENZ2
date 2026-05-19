import { subscribeToNotifications, markNotificationAsRead, markAllNotificationsAsRead } from './notification-service.js';

function formatTimestamp(timestamp) {
  if (!timestamp) return 'Just now';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch (error) {
    console.warn('Failed to format notification timestamp', error);
    return 'Just now';
  }
}

let stylesInjected = false;

function ensureStyles() {
  if (stylesInjected) return;
  const style = document.createElement('style');
  style.id = 'notification-center-styles';
  style.textContent = `
    .notification-center-panel {
      position: fixed;
      top: 72px;
      right: 24px;
      width: min(360px, calc(100vw - 48px));
      max-height: 70vh;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 20px 45px rgba(15, 23, 42, 0.18);
      padding: 14px 16px 18px;
      z-index: 6000;
      display: flex;
      flex-direction: column;
      gap: 12px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      transition: opacity 0.18s ease, transform 0.18s ease;
      opacity: 0;
      transform: translateY(-6px) scale(0.98);
      pointer-events: none;
    }

    .notification-center-panel.is-open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    .notification-center-panel .notification-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .notification-center-panel .notification-panel-title {
      font-weight: 600;
      font-size: 16px;
      color: #0f172a;
    }

    .notification-center-panel .notification-header-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .notification-center-panel button.panel-icon-btn {
      border: none;
      background: transparent;
      color: #94a3b8;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      line-height: 1;
      border-radius: 8px;
      padding: 4px;
      transition: color 0.15s ease;
    }

    .notification-center-panel button.panel-icon-btn:hover {
      color: #0f172a;
    }

    .notification-center-panel button.mark-all-btn {
      border: none;
      background: #e2e8f0;
      color: #0f172a;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }

    .notification-center-panel button.mark-all-btn:hover {
      background: #cbd5f5;
    }

    .notification-center-panel .notification-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
      max-height: 55vh;
      padding-right: 6px;
    }

    .notification-center-panel .notification-empty {
      padding: 18px 6px;
      text-align: center;
      font-size: 14px;
      color: #94a3b8;
    }

    .notification-center-panel .notification-item {
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 12px;
      padding: 12px 14px;
      background: #ffffff;
      display: flex;
      flex-direction: column;
      gap: 6px;
      text-align: left;
      cursor: pointer;
      transition: border 0.15s ease, background 0.15s ease;
    }

    .notification-center-panel .notification-item.unread {
      border-color: rgba(59, 130, 246, 0.35);
      background: #f8fbff;
    }

    .notification-center-panel .notification-item:hover {
      border-color: rgba(37, 99, 235, 0.45);
    }

    .notification-center-panel .notification-item-header {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .notification-center-panel .notification-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: #3b82f6;
      margin-top: 6px;
      flex-shrink: 0;
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    .notification-center-panel .notification-item.unread .notification-dot {
      opacity: 1;
    }

    .notification-center-panel .notification-title {
      font-weight: 600;
      font-size: 14px;
      color: #0f172a;
      margin-bottom: 2px;
    }

    .notification-center-panel .notification-message {
      font-size: 13px;
      color: #475569;
      line-height: 1.4;
    }

    .notification-center-panel .notification-subtle {
      font-size: 12px;
      color: #94a3b8;
      margin-top: 2px;
    }

    .notification-center-panel .notification-divider {
      height: 1px;
      background: rgba(148, 163, 184, 0.22);
      margin: 2px 0;
    }

    @media (max-width: 640px) {
      .notification-center-panel {
        left: 16px !important;
        right: 16px !important;
        width: auto !important;
        max-width: none;
        border-radius: 18px;
      }
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
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

  let panel = document.getElementById(panelId);
  let unsubscribe = null;
  let currentUserId = null;
  let notifications = [];

  function ensurePanel() {
    if (panel) return panel;
    ensureStyles();

    panel = document.createElement('div');
    panel.id = panelId;
    panel.className = 'notification-center-panel';

    panel.innerHTML = `
      <div class="notification-panel-header">
        <div class="notification-panel-title">${title}</div>
        <div class="notification-header-actions">
          <button type="button" class="mark-all-btn">Mark all read</button>
          <button type="button" class="close-panel-btn panel-icon-btn">×</button>
        </div>
      </div>
      <div class="notification-list"></div>
    `;

    document.body.appendChild(panel);

    panel.querySelector('.close-panel-btn').addEventListener('click', () => togglePanel(false));
    panel.querySelector('.mark-all-btn').addEventListener('click', async () => {
      if (!currentUserId) return;
      await markAllNotificationsAsRead(currentUserId);
    });

    document.addEventListener('click', (event) => {
      if (!panel || panel.style.display === 'none') return;
      if (panel.contains(event.target)) return;
      if (button && button.contains(event.target)) return;
      togglePanel(false);
    });

    return panel;
  }

  function positionPanel() {
    if (!panel || !button) return;
    const rect = button.getBoundingClientRect();
    const viewportPadding = 16;
    const width = Math.min(360, window.innerWidth - viewportPadding * 2);
    const top = rect.bottom + 12;
    const spaceRight = window.innerWidth - rect.right;
    const right = Math.max(spaceRight, viewportPadding);

    panel.style.top = `${top}px`;
    panel.style.right = `${right}px`;
    panel.style.width = `${width}px`;
  }

  function togglePanel(forceState) {
    if (!panel) return;
    const shouldShow = forceState !== undefined ? forceState : !panel.classList.contains('is-open');
    if (shouldShow) {
      positionPanel();
      panel.classList.add('is-open');
    } else {
      panel.classList.remove('is-open');
    }
  }

  function updateBadge(unreadCount) {
    if (!badge) return;
    badge.textContent = unreadCount;
    badge.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
  }

  function renderNotifications() {
    const list = panel?.querySelector('.notification-list');
    if (!list) return;

    if (!notifications.length) {
      list.innerHTML = `<div class="notification-empty">${emptyState}</div>`;
      updateBadge(0);
      return;
    }

    const unreadCount = notifications.filter((n) => !n.read).length;
    updateBadge(unreadCount);

    list.innerHTML = notifications
      .map((notification) => {
        const isUnread = notification.read === false;
        const payloadSummary = notification.payload?.permitType || notification.payload?.documentType || '';
        return `
          <button data-id="${notification.id}" class="notification-item${isUnread ? ' unread' : ''}">
            <div class="notification-item-header">
              <div class="notification-dot"></div>
              <div class="notification-item-body">
                <div class="notification-title">${notification.title || 'Notification'}</div>
                <div class="notification-message">${notification.message || ''}</div>
                ${payloadSummary ? `<div class="notification-subtle">${payloadSummary}</div>` : ''}
              </div>
            </div>
            <div class="notification-subtle">${formatTimestamp(notification.createdAt)}</div>
          </button>
        `;
      })
      .join('');

    list.querySelectorAll('.notification-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const id = item.getAttribute('data-id');
        if (!id) return;
        try {
          await markNotificationAsRead(id);
        } catch (error) {
          console.error('Failed to mark notification as read', error);
        }
      });
    });
  }

  async function start(userId) {
    if (!userId) return;
    ensurePanel();

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

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
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
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
    if (panel?.classList.contains('is-open')) {
      positionPanel();
    }
  });

  return {
    start,
    stop,
    toggle: togglePanel
  };
}
