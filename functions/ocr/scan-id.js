const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

async function readOperationResult(operationLocation, key) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1500 : 1000));
    const response = await fetch(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': key }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message || `Azure polling failed (${response.status})`);
    const status = String(data?.status || '').toLowerCase();
    if (status === 'succeeded') return data;
    if (status === 'failed') throw new Error(data?.error?.message || 'Azure OCR failed.');
  }
  throw new Error('Azure OCR timed out.');
}

export async function onRequestPost(context) {
  const endpoint = context.env.AZURE_DI_ENDPOINT;
  const key = context.env.AZURE_DI_KEY;

  if (!endpoint || !key) {
    return json({ error: 'Azure Document Intelligence is not configured.' }, 503);
  }

  try {
    const formData = await context.request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') return json({ error: 'No file uploaded.' }, 400);
    if (file.size > 10 * 1024 * 1024) return json({ error: 'File too large (max 10MB).' }, 413);

    const contentType = file.type || 'application/octet-stream';
    const analyzeUrl = `${endpoint.replace(/\/$/, '')}/formrecognizer/documentModels/prebuilt-idDocument:analyze?api-version=2023-07-31`;

    const analyzeResponse = await fetch(analyzeUrl, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': contentType },
      body: await file.arrayBuffer()
    });

    const operationLocation = analyzeResponse.headers.get('operation-location');
    if (!analyzeResponse.ok || !operationLocation) {
      const errorBody = await analyzeResponse.json().catch(() => null);
      return json({ error: errorBody?.error?.message || `Azure request failed (${analyzeResponse.status})` }, analyzeResponse.status || 500);
    }

    const azureResult = await readOperationResult(operationLocation, key);
    const docs = azureResult?.analyzeResult?.documents || [];

    if (docs.length === 0) {
      return json({ error: 'No ID document detected. Please upload a clear photo of a valid ID.' }, 422);
    }

    const idDoc = docs[0];
    const f = idDoc.fields || {};
    const fields = {};

    if (f.FirstName) fields.firstName = f.FirstName.content || f.FirstName.value || '';
    if (f.LastName) fields.lastName = f.LastName.content || f.LastName.value || '';
    if (f.MiddleName) fields.middleName = f.MiddleName.content || f.MiddleName.value || '';
    if (f.Address) fields.address = f.Address.content || f.Address.value || '';
    if (f.DateOfBirth) fields.dateOfBirth = f.DateOfBirth.content || f.DateOfBirth.value || '';
    if (f.DocumentNumber) fields.documentNumber = f.DocumentNumber.content || f.DocumentNumber.value || '';
    if (f.Sex) fields.sex = f.Sex.content || f.Sex.value || '';

    const docConfidence = typeof idDoc.confidence === 'number' ? Math.round(idDoc.confidence * 100) : null;

    return json({
      success: true,
      docType: idDoc.docType || 'unknown',
      confidence: docConfidence,
      fields,
      rawFieldCount: Object.keys(f).length
    });
  } catch (error) {
    return json({ error: error.message || 'ID scan failed.' }, 500);
  }
}
