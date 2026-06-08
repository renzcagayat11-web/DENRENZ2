const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  }
});

async function readOperationResult(operationLocation, key) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1200 : 1000));

    const response = await fetch(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': key }
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error?.message || `Azure OCR polling failed (${response.status})`);
    }

    const status = String(data?.status || '').toLowerCase();
    if (status === 'succeeded') return data;
    if (status === 'failed') throw new Error(data?.error?.message || 'Azure OCR failed to process the document.');
  }

  throw new Error('Azure OCR timed out. Please try again.');
}

function extractReadText(result) {
  const readResult = result?.analyzeResult?.readResults || [];
  const lines = [];
  const confidences = [];

  for (const page of readResult) {
    for (const line of page.lines || []) {
      if (line.text) lines.push(line.text);
      for (const word of line.words || []) {
        if (typeof word.confidence === 'number') confidences.push(word.confidence);
      }
    }
  }

  const confidence = confidences.length
    ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 100)
    : null;

  return {
    text: lines.join('\n').trim(),
    confidence,
    pageCount: readResult.length
  };
}

export async function onRequestPost(context) {
  const endpoint = context.env.AZURE_DI_ENDPOINT;
  const key = context.env.AZURE_DI_KEY;

  if (!endpoint || !key) {
    return json({ error: 'OCR is not configured. Add AZURE_DI_ENDPOINT and AZURE_DI_KEY in Cloudflare Pages environment variables.' }, 503);
  }

  try {
    const formData = await context.request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return json({ error: 'No document image uploaded.' }, 400);
    }

    if (file.size > 10 * 1024 * 1024) {
      return json({ error: 'File is too large. Maximum OCR upload size is 10MB.' }, 413);
    }

    const contentType = file.type || 'application/octet-stream';
    const analyzeUrl = `${endpoint.replace(/\/$/, '')}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2023-07-31`;

    const analyzeResponse = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': contentType
      },
      body: await file.arrayBuffer()
    });

    const operationLocation = analyzeResponse.headers.get('operation-location');
    if (!analyzeResponse.ok || !operationLocation) {
      const errorBody = await analyzeResponse.json().catch(() => null);
      return json({ error: errorBody?.error?.message || `Azure OCR request failed (${analyzeResponse.status})` }, analyzeResponse.status || 500);
    }

    const azureResult = await readOperationResult(operationLocation, key);
    const parsed = extractReadText(azureResult);

    return json({
      success: true,
      text: parsed.text,
      confidence: parsed.confidence,
      pageCount: parsed.pageCount,
      engine: 'Azure Document Intelligence'
    });
  } catch (error) {
    return json({ error: error.message || 'OCR scan failed. Please try again.' }, 500);
  }
}

export async function onRequestGet() {
  return json({ ok: true, endpoint: '/ocr', method: 'POST' });
}
