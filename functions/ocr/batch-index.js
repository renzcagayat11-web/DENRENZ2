// Cloudflare Pages Function: POST /ocr/batch-index
// Indexes all application documents into ocrIndex via Azure Document Intelligence
// ?force=true patches applicantName on already-indexed docs without re-OCRing

import { firestoreList, firestoreGet, firestoreSet, firestorePatch, fromFirestoreDoc } from '../_shared/firestore.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }
});

async function azureOCR(fileUrl, endpoint, key) {
  // Fetch the file from Firebase Storage download URL
  const fileResp = await fetch(fileUrl);
  if (!fileResp.ok) throw new Error(`Failed to fetch file: ${fileResp.status}`);
  const buffer = await fileResp.arrayBuffer();
  const contentType = fileResp.headers.get('content-type') || 'application/octet-stream';

  const analyzeUrl = `${endpoint.replace(/\/$/, '')}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2023-07-31`;
  const analyzeResp = await fetch(analyzeUrl, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': contentType },
    body: buffer
  });

  const opLocation = analyzeResp.headers.get('operation-location');
  if (!analyzeResp.ok || !opLocation) throw new Error(`Azure analyze failed (${analyzeResp.status})`);

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 1500 : 1000));
    const pollResp = await fetch(opLocation, { headers: { 'Ocp-Apim-Subscription-Key': key } });
    const pollData = await pollResp.json().catch(() => null);
    const status = String(pollData?.status || '').toLowerCase();
    if (status === 'succeeded') {
      const ar = pollData?.analyzeResult || {};
      const text = ar.content || '';
      // Confidence
      let total = 0, wc = 0;
      for (const page of ar.pages || []) {
        for (const word of page.words || []) {
          if (typeof word.confidence === 'number') { total += word.confidence; wc++; }
        }
      }
      return { text, confidence: wc > 0 ? Math.round((total / wc) * 100) : null };
    }
    if (status === 'failed') throw new Error('Azure OCR failed.');
  }
  throw new Error('Azure OCR timed out.');
}

export async function onRequestPost(context) {
  const endpoint = context.env.AZURE_DI_ENDPOINT || context.env.AZURE_DOC_INTEL_ENDPOINT;
  const key      = context.env.AZURE_DI_KEY      || context.env.AZURE_DOC_INTEL_KEY;
  const url      = new URL(context.request.url);
  const force    = url.searchParams.get('force') === 'true';

  if (!endpoint || !key) {
    return json({ error: 'Azure Document Intelligence not configured.' }, 503);
  }

  // Respond immediately — indexing runs synchronously but we cap at 20 docs to avoid CF timeout
  // For full indexing, run in batches by calling multiple times
  try {
    const appDocs  = await firestoreList(context.env, 'applications');
    const ocrDocs  = await firestoreList(context.env, 'ocrIndex');
    const indexedIds = new Set(ocrDocs.map(d => d.name?.split('/').pop()));

    let queued = 0, indexed = 0, relinked = 0;
    const MAX = 20; // CF Worker CPU limit safety

    for (const appDoc of appDocs) {
      if (indexed + relinked >= MAX) break;
      const app = fromFirestoreDoc(appDoc);
      if (!app) continue;

      // Resolve applicant name
      let applicantName = app.applicantName || '';
      if (!applicantName && app.applicantUid) {
        try {
          const uDoc = await firestoreGet(context.env, 'users', app.applicantUid);
          if (uDoc) {
            const u = fromFirestoreDoc(uDoc);
            applicantName = [u.firstName, u.middleName, u.surname].filter(Boolean).join(' ');
          }
        } catch (e) { /* non-fatal */ }
      }

      const docs = app.documents || app.uploadedDocuments || app.files || [];
      for (const doc of docs) {
        if (indexed + relinked >= MAX) break;
        const storagePath = doc.storagePath || '';
        const fileUrl     = doc.url || '';
        const fileName    = doc.name || 'document';
        const contentType = doc.type || '';
        if (!storagePath && !fileUrl) continue;

        const docId = (storagePath || fileUrl).replace(/\//g, '_');

        if (indexedIds.has(docId)) {
          if (force) {
            await firestorePatch(context.env, 'ocrIndex', docId, {
              applicationId: app._id,
              applicantName: applicantName || null,
              permitType: app.permitType || app.documentType || null
            });
            relinked++;
          }
          continue;
        }

        if (!fileUrl) continue;
        queued++;
        try {
          const ocr = await azureOCR(fileUrl, endpoint, key);
          await firestoreSet(context.env, 'ocrIndex', docId, {
            storagePath: storagePath || fileUrl,
            url: fileUrl,
            fileName,
            contentType,
            applicationId: app._id,
            applicantName: applicantName || null,
            permitType: app.permitType || app.documentType || null,
            text: ocr.text,
            textLower: ocr.text.toLowerCase(),
          });
          indexed++;
        } catch (e) {
          console.error('[Batch OCR] Failed for', fileName, e.message);
        }
      }
    }

    return json({ success: true, queued, indexed, relinked, capped: appDocs.length > MAX });
  } catch (err) {
    return json({ error: err.message || 'Batch index failed.' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' } });
}
