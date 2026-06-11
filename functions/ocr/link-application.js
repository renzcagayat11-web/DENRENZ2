// Cloudflare Pages Function: POST /ocr/link-application
// Links uploaded storagePaths to their applicationId in ocrIndex after Firestore app save

import { firestoreSet } from '../_shared/firestore.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }
});

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { applicationId, applicantName, permitType, storagePaths } = body;

    if (!applicationId || !Array.isArray(storagePaths) || storagePaths.length === 0) {
      return json({ error: 'applicationId and storagePaths[] are required.' }, 400);
    }

    await Promise.all(storagePaths.map(sp => {
      const docId = sp.replace(/\//g, '_');
      return firestoreSet(context.env, 'ocrIndex', docId, {
        applicationId,
        applicantName: applicantName || null,
        permitType: permitType || null
      });
    }));

    return json({ success: true, linked: storagePaths.length });
  } catch (err) {
    return json({ error: err.message || 'Link failed.' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' } });
}
