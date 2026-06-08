const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

export async function onRequestPost(context) {
  const apiKey = context.env.OCR_SPACE_API_KEY;
  if (!apiKey) {
    return json({ error: 'OCR.space API key not configured. Add OCR_SPACE_API_KEY in Cloudflare Pages environment variables.' }, 503);
  }

  try {
    const formData = await context.request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') return json({ error: 'No file uploaded.' }, 400);
    if (file.size > 10 * 1024 * 1024) return json({ error: 'File too large (max 10MB).' }, 413);

    const proxyForm = new FormData();
    proxyForm.append('apikey', apiKey);
    proxyForm.append('file', file);
    proxyForm.append('language', 'eng');
    proxyForm.append('isOverlayRequired', 'false');

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: proxyForm
    });

    const data = await response.json();

    if (data.IsErroredOnProcessing) {
      return json({ error: data.ErrorMessage || 'OCR processing failed' }, 422);
    }

    const parsedText = data.ParsedResults?.[0]?.ParsedText || '';
    return json({ success: true, text: parsedText });
  } catch (error) {
    return json({ error: error.message || 'OCR processing failed.' }, 500);
  }
}
