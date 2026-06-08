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
    const analyzeUrl = `${endpoint.replace(/\/$/, '')}/formrecognizer/documentModels/prebuilt-document:analyze?api-version=2023-07-31`;

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
    const ar = azureResult?.analyzeResult || {};
    const text = ar.content || '';

    // Key-value pairs
    const keyValuePairs = (ar.keyValuePairs || []).map(kv => ({
      key: kv.key?.content || '',
      value: kv.value?.content || '',
      confidence: typeof kv.confidence === 'number' ? Math.round(kv.confidence * 100) : null
    }));

    // Tables
    const tables = (ar.tables || []).map(table => ({
      rowCount: table.rowCount,
      columnCount: table.columnCount,
      cells: (table.cells || []).map(cell => ({
        text: cell.content,
        row: cell.rowIndex,
        col: cell.columnIndex
      }))
    }));

    // Confidence
    const readResults = ar.readResults || ar.pages || [];
    let totalConf = 0;
    let wc = 0;
    for (const page of readResults) {
      for (const line of page.lines || []) {
        for (const word of line.words || []) {
          if (typeof word.confidence === 'number') { totalConf += word.confidence; wc++; }
        }
      }
    }
    const avgConfidence = wc > 0 ? Math.round((totalConf / wc) * 100) : null;

    return json({
      success: true,
      text,
      confidence: avgConfidence,
      pageCount: readResults.length,
      keyValuePairs,
      tables
    });
  } catch (error) {
    return json({ error: error.message || 'Document verification failed.' }, 500);
  }
}
