import { auth, db } from './firebase-config.js';
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  onSnapshot,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const notificationsRef = collection(db, 'notifications');
const usersRef = collection(db, 'users');

const userCache = new Map();
const roleCache = new Map();

const EVENT_PREFERENCE_MAP = {
  customer: {
    'application-status-change': 'notifyStatusChange',
    'application-approved': 'notifyApproved',
    'application-rejected': 'notifyRejected',
    'application-resubmit-requested': 'notifyStatusChange',
    'application-comment': 'notifyStatusChange',
    'application-pickup-scheduled': 'notifyStatusChange'
  },
  staff: {
    'application-submitted': 'notifyNewApplications',
    'application-resubmitted': 'notifyUrgentApplications',
    'application-edited': 'notifyNewApplications'
  }
};

async function fetchUser(userId) {
  if (!userId) return null;
  if (userCache.has(userId)) return userCache.get(userId);
  const snap = await getDoc(doc(db, 'users', userId));
  const data = snap.exists() ? { id: userId, ...snap.data() } : null;
  userCache.set(userId, data);
  return data;
}

async function fetchUsersByRole(role) {
  if (!role) return [];
  if (roleCache.has(role)) return roleCache.get(role);
  try {
    const q = query(usersRef, where('role', '==', role));
    const snap = await getDocs(q);
    const users = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(user => user.status !== 'inactive');
    if (users.length > 0) roleCache.set(role, users);
    return users;
  } catch (err) {
    console.error(`[notification-service] fetchUsersByRole(${role}) failed:`, err);
    return [];
  }
}

function buildChannels(user, role, eventType, overrides = {}) {
  const base = {
    inApp: overrides.inApp !== undefined ? overrides.inApp : true,
    email: overrides.email ?? true,
    sms: overrides.sms ?? Boolean(user?.mobile)
  };

  const prefKey = EVENT_PREFERENCE_MAP[role]?.[eventType];
  if (prefKey && user) {
    const prefValue = user[prefKey];
    if (prefValue === false) {
      base.email = false;
      base.sms = false;
    }
  }

  return base;
}

async function deliverOutOfBand(notificationIds) {
  if (!notificationIds.length) return;
  const currentUser = auth.currentUser;
  if (!currentUser) return;
  try {
    const token = await currentUser.getIdToken();
    await fetch('/notifications/deliver', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ notificationIds })
    });
  } catch (err) {
    console.error('Failed to deliver email/SMS notifications:', err);
  }
}

function buildDocData({
  recipient,
  eventType,
  title,
  message,
  payload,
  channels,
  actor
}) {
  return {
    recipientId: recipient.id,
    recipientRole: recipient.role || 'customer',
    recipientEmail: recipient.email || null,
    recipientPhone: recipient.mobile || recipient.phone || null,
    recipientName: recipient.displayName || `${recipient.firstName || ''} ${recipient.surname || recipient.lastName || ''}`.trim() || 'User',
    eventType,
    title,
    message,
    payload: payload || {},
    channels,
    emailStatus: channels.email ? 'pending' : 'skipped',
    smsStatus: channels.sms ? 'pending' : 'skipped',
    read: false,
    createdAt: serverTimestamp(),
    createdBy: actor?.id || null,
    createdByName: actor?.name || null
  };
}

export async function createNotifications({
  eventType,
  title,
  message,
  payload = {},
  actor = {},
  recipients = []
}) {
  if (!eventType || !title || !message || !recipients.length) return [];

  const resolvedRecipients = [];
  for (const target of recipients) {
    if (target.userId) {
      const user = await fetchUser(target.userId);
      if (user) resolvedRecipients.push({ ...user, role: user.role || target.role });
    } else if (target.role) {
      const users = await fetchUsersByRole(target.role);
      resolvedRecipients.push(...users.map(u => ({ ...u, role: target.role })));
    }
  }

  const deliveryIds = [];
  for (const user of resolvedRecipients) {
    const channels = buildChannels(user, user.role, eventType, {});
    if (!channels.inApp && !channels.email && !channels.sms) continue;

    const docData = buildDocData({ recipient: user, eventType, title, message, payload, channels, actor });
    const docRef = await addDoc(notificationsRef, docData);

    if (channels.email || channels.sms) {
      deliveryIds.push(docRef.id);
    }
  }

  if (deliveryIds.length) {
    deliverOutOfBand(deliveryIds);
  }
}

export function subscribeToNotifications({ userId, onUpdate, limitCount = 20 }) {
  if (!userId || !onUpdate) return () => {};
  const q = query(
    notificationsRef,
    where('recipientId', '==', userId)
  );
  return onSnapshot(q, snapshot => {
    const items = snapshot.docs
      .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const tb = b.createdAt?.toMillis?.() ?? (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return tb - ta;
      })
      .slice(0, limitCount);
    onUpdate(items);
  });
}

export async function markNotificationAsRead(notificationId) {
  if (!notificationId) return;
  try {
    await updateDoc(doc(db, 'notifications', notificationId), {
      read: true,
      readAt: serverTimestamp()
    });
  } catch (err) {
    console.error('Failed to mark notification as read:', err);
  }
}

export async function markAllNotificationsAsRead(userId) {
  if (!userId) return;
  try {
    const q = query(notificationsRef, where('recipientId', '==', userId), where('read', '==', false), limit(25));
    const snap = await getDocs(q);
    const updates = snap.docs.map(docSnap => updateDoc(docSnap.ref, {
      read: true,
      readAt: serverTimestamp()
    }));
    await Promise.all(updates);
  } catch (err) {
    console.error('Failed to mark notifications as read:', err);
  }
}
