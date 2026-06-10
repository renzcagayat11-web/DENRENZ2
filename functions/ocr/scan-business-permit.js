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
  const endpoint = context.env.AZURE_DOC_INTEL_ENDPOINT;
  const key = context.env.AZURE_DOC_INTEL_KEY;

  if (!endpoint || !key) {
    return json({ error: 'Azure Document Intelligence is not configured.' }, 503);
  }

  try {
    const formData = await context.request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') return json({ error: 'No file uploaded.' }, 400);
    if (file.size > 10 * 1024 * 1024) return json({ error: 'File too large (max 10MB).' }, 413);

    const contentType = file.type || 'application/octet-stream';
    
    // Use prebuilt-document model for business permits
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

    // Extract key-value pairs from Azure results
    const keyValuePairs = (ar.keyValuePairs || []).map(kv => ({
      key: kv.key?.content || '',
      value: kv.value?.content || '',
      confidence: typeof kv.confidence === 'number' ? Math.round(kv.confidence * 100) : null
    }));

    // Parse business permit data from extracted text and key-value pairs
    const businessData = parseBusinessPermit(text, keyValuePairs);

    // Confidence calculation
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
      docType: 'business-permit',
      confidence: avgConfidence,
      fields: businessData,
      rawText: text,
      keyValuePairs
    });
  } catch (error) {
    return json({ error: error.message || 'Business permit scan failed.' }, 500);
  }
}

// Parse business permit data from extracted text
function parseBusinessPermit(text, keyValuePairs) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = text.toUpperCase();
  
  const result = {
    businessName: '',
    ownerName: '',
    businessAddress: '',
    permitNumber: '',
    dateIssued: '',
    expiryDate: '',
    businessType: '',
    taxId: ''
  };

  // Helper to find value by key patterns
  const findValueByKeys = (patterns) => {
    for (const kv of keyValuePairs) {
      const keyUpper = kv.key.toUpperCase();
      if (patterns.some(p => keyUpper.includes(p))) {
        return kv.value;
      }
    }
    return '';
  };

  // Extract Business Name
  result.businessName = findValueByKeys(['BUSINESS NAME', 'TRADE NAME', 'COMPANY NAME', 'NAME OF BUSINESS']) ||
                       findValueByKeys(['BUSINESS:', 'TRADE:', 'COMPANY:']) ||
                       extractPattern(lines, /(?:BUSINESS\s*NAME|TRADE\s*NAME|COMPANY)\s*[:\-]?\s*(.+)/i);

  // Extract Owner Name
  result.ownerName = findValueByKeys(['OWNER', 'PROPRIETOR', 'PRESIDENT', 'MANAGING HEAD', 'OWNER NAME']) ||
                    findValueByKeys(['NAME OF OWNER', 'REGISTERED OWNER']) ||
                    extractPattern(lines, /(?:OWNER|PROPRIETOR|PRESIDENT)\s*[:\-]?\s*(.+)/i);

  // Extract Business Address
  result.businessAddress = findValueByKeys(['ADDRESS', 'BUSINESS ADDRESS', 'LOCATION', 'PREMISES']) ||
                          extractPattern(lines, /(?:ADDRESS|LOCATION|PREMISES)\s*[:\-]?\s*(.+)/i);

  // Extract Permit Number
  result.permitNumber = findValueByKeys(['PERMIT NO', 'MAYOR\'S PERMIT', 'PERMIT NUMBER', 'BUSINESS PERMIT']) ||
                       findPattern(lines, /\d{4}-\d{4,}|BP\d+|MP\d+|\d{8,}/);

  // Extract Dates
  const dates = extractDates(text);
  if (dates.length >= 1) result.dateIssued = dates[0];
  if (dates.length >= 2) result.expiryDate = dates[1];

  // Extract Business Type/Nature
  result.businessType = findValueByKeys(['KIND OF BUSINESS', 'BUSINESS TYPE', 'NATURE OF BUSINESS', 'LINE OF BUSINESS']) ||
                       extractPattern(lines, /(?:KIND|NATURE|TYPE)\s*OF\s*BUSINESS\s*[:\-]?\s*(.+)/i);

  // Extract Tax ID (TIN)
  result.taxId = findValueByKeys(['TIN', 'TAX ID', 'TAX IDENTIFICATION']) ||
                findPattern(lines, /\d{3}-?\d{3}-?\d{3}-?\d{3}/);

  return result;
}

// Helper: Extract pattern from lines
function extractPattern(lines, regex) {
  for (const line of lines) {
    const match = line.match(regex);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return '';
}

// Helper: Find pattern in lines
function findPattern(lines, regex) {
  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      return match[0];
    }
  }
  return '';
}

// Helper: Extract dates from text
function extractDates(text) {
  const datePatterns = [
    /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/g,  // MM/DD/YYYY or DD/MM/YYYY
    /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/g,  // YYYY/MM/DD
    /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2}),?\s+(\d{4})/gi,  // Month DD, YYYY
  ];

  const dates = [];
  for (const pattern of datePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      dates.push(match[0]);
    }
  }
  return dates;
}
