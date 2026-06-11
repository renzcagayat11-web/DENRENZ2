// Cloudflare Pages Function: GET /ocr/search?q=keyword
// Full-text search across ocrIndex collection, enriched with applicant name from users collection

import { firestoreList, fromFirestoreDoc, firestoreGet } from '../_shared/firestore.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }
});

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = url.searchParams.get('q') || '';

  if (!q || q.trim().length < 2) {
    return json({ error: 'Query must be at least 2 characters.' }, 400);
  }

  try {
    const keyword = q.trim().toLowerCase();

    // Fetch all ocrIndex documents
    const docs = await firestoreList(context.env, 'ocrIndex');

    const matches = [];
    for (const doc of docs) {
      const d = fromFirestoreDoc(doc);
      if (!d || !d.textLower) continue;
      if (!d.textLower.includes(keyword)) continue;

      const idx   = d.textLower.indexOf(keyword);
      const start = Math.max(0, idx - 80);
      const end   = Math.min((d.text || '').length, idx + keyword.length + 80);
      const snippet = (start > 0 ? '…' : '') + (d.text || '').slice(start, end) + (end < (d.text || '').length ? '…' : '');

      matches.push({
        storagePath:   d.storagePath || '',
        url:           d.url || '',
        fileName:      d.fileName || '',
        applicationId: d.applicationId || null,
        applicantName: d.applicantName || null,
        permitType:    d.permitType || null,
        snippet,
      });
    }

    // Enrich with applicant name from Firestore applications + users
    const uniqueAppIds = [...new Set(matches.map(m => m.applicationId).filter(Boolean))];
    const appDataMap = {};
    const userDataMap = {};

    await Promise.all(uniqueAppIds.map(async appId => {
      try {
        const appDoc = await firestoreGet(context.env, 'applications', appId);
        if (appDoc) {
          const app = fromFirestoreDoc(appDoc);
          appDataMap[appId] = app;
          // If no applicantName, fetch user by UID
          if (!app.applicantName && app.applicantUid) {
            const userDoc = await firestoreGet(context.env, 'users', app.applicantUid);
            if (userDoc) userDataMap[app.applicantUid] = fromFirestoreDoc(userDoc);
          }
        }
      } catch (e) { /* non-fatal */ }
    }));

    for (const m of matches) {
      if (!m.applicationId) continue;
      const app = appDataMap[m.applicationId];
      if (!app) continue;
      let name = app.applicantName || '';
      if (!name && app.applicantUid && userDataMap[app.applicantUid]) {
        const u = userDataMap[app.applicantUid];
        name = [u.firstName, u.middleName, u.surname].filter(Boolean).join(' ');
      }
      m.applicantName = name || null;
      m.permitType    = app.permitType || app.documentType || m.permitType || null;
      m.appStatus     = app.status || null;
    }

    return json({ success: true, query: q, count: matches.length, results: matches });
  } catch (err) {
    return json({ error: err.message || 'Search failed.' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' } });
}
