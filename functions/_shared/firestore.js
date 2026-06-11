// Shared Firestore REST API helper for Cloudflare Functions
// Uses Firebase service account credentials stored as Cloudflare env vars

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents';

async function getAccessToken(env) {
  const projectId  = env.FIREBASE_PROJECT_ID || 'denr-permit';
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    throw new Error('FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY env vars are required.');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase'
  };

  const token = await signJWT(payload, privateKey);

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${token}`
  });

  const data = await resp.json();
  if (!data.access_token) throw new Error('Failed to get Firebase access token: ' + JSON.stringify(data));
  return { accessToken: data.access_token, projectId };
}

async function signJWT(payload, privateKeyPem) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${enc(header)}.${enc(payload)}`;

  const pemContents = privateKeyPem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const b64sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${signingInput}.${b64sig}`;
}

export async function firestoreGet(env, collection, docId) {
  const { accessToken, projectId } = await getAccessToken(env);
  const url = `${FIRESTORE_BASE.replace('{PROJECT_ID}', projectId)}/${collection}/${docId}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (resp.status === 404) return null;
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || `Firestore GET failed (${resp.status})`);
  return data;
}

export async function firestoreList(env, collection) {
  const { accessToken, projectId } = await getAccessToken(env);
  const url = `${FIRESTORE_BASE.replace('{PROJECT_ID}', projectId)}/${collection}?pageSize=1000`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || `Firestore LIST failed (${resp.status})`);
  return data.documents || [];
}

export async function firestorePatch(env, collection, docId, fields) {
  const { accessToken, projectId } = await getAccessToken(env);
  const url = `${FIRESTORE_BASE.replace('{PROJECT_ID}', projectId)}/${collection}/${docId}`;
  const body = { fields: toFirestoreFields(fields) };
  const updateMask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const resp = await fetch(`${url}?${updateMask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || `Firestore PATCH failed (${resp.status})`);
  return data;
}

export async function firestoreSet(env, collection, docId, fields) {
  const { accessToken, projectId } = await getAccessToken(env);
  const url = `${FIRESTORE_BASE.replace('{PROJECT_ID}', projectId)}/${collection}/${docId}`;
  const body = { fields: toFirestoreFields(fields) };
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || `Firestore SET failed (${resp.status})`);
  return data;
}

// Convert plain JS object to Firestore REST fields format
export function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) fields[k] = { nullValue: null };
    else if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (Array.isArray(v)) fields[k] = { arrayValue: { values: v.map(i => typeof i === 'string' ? { stringValue: i } : { doubleValue: i }) } };
    else fields[k] = { stringValue: String(v) };
  }
  return fields;
}

// Convert Firestore REST document fields to plain JS object
export function fromFirestoreDoc(doc) {
  if (!doc || !doc.fields) return null;
  const obj = { _id: doc.name?.split('/').pop() };
  for (const [k, v] of Object.entries(doc.fields)) {
    if ('stringValue' in v) obj[k] = v.stringValue;
    else if ('integerValue' in v) obj[k] = parseInt(v.integerValue);
    else if ('doubleValue' in v) obj[k] = v.doubleValue;
    else if ('booleanValue' in v) obj[k] = v.booleanValue;
    else if ('nullValue' in v) obj[k] = null;
    else if ('arrayValue' in v) obj[k] = (v.arrayValue.values || []).map(i => i.stringValue || i.doubleValue || null);
    else obj[k] = null;
  }
  return obj;
}
