/**
 * Customer OCR Scanner — Camera capture, file upload, and Azure DI integration.
 * Implements all missing functions referenced in customer-dashboard.html.
 */

import { auth } from './firebase-config.js';
import { getIdToken } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const API_BASE = window.API_BASE ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:3000'
    : '');

// ─── State ──────────────────────────────────────────────────────────────────
let cameraStream = null;
let currentFacingMode = 'environment'; // 'environment' = back, 'user' = front
let torchEnabled = false;
let capturedBlob = null;   // blob from camera capture
let uploadedFile = null;   // file from upload tab
let activeTab = 'camera';  // 'camera' | 'upload'

// ─── Tab Switching ──────────────────────────────────────────────────────────
window.custOcrSwitchTab = function (tab) {
  activeTab = tab;
  document.querySelectorAll('.cust-ocr-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ocrTab === tab);
  });
  const cameraPanel = document.getElementById('custOcrCameraPanel');
  const uploadPanel = document.getElementById('custOcrUploadPanel');
  if (cameraPanel) cameraPanel.classList.toggle('active', tab === 'camera');
  if (uploadPanel) uploadPanel.classList.toggle('active', tab === 'upload');

  // Stop camera when switching away
  if (tab !== 'camera') stopCameraStream();
};

// ─── Camera ─────────────────────────────────────────────────────────────────
async function startCameraStream(facingMode) {
  stopCameraStream();
  try {
    const constraints = {
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    };
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    const video = document.getElementById('custCameraVideo');
    if (video) {
      video.srcObject = cameraStream;
      video.play();
    }
    // Show camera wrapper, hide start button
    const wrapper = document.getElementById('custCameraWrapper');
    const startBtn = document.getElementById('custStartCamBtn');
    if (wrapper) wrapper.style.display = '';
    if (startBtn) startBtn.style.display = 'none';
  } catch (err) {
    console.error('Camera access error:', err);
    if (typeof showAlert === 'function') {
      showAlert('Unable to access camera. Please allow camera permission or use the Upload tab.', 'warning');
    }
  }
}

function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  const video = document.getElementById('custCameraVideo');
  if (video) video.srcObject = null;
}

window.custStartCamera = function () {
  startCameraStream(currentFacingMode);
};

window.custSwitchCamera = function () {
  currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  startCameraStream(currentFacingMode);
};

window.custToggleTorch = function () {
  if (!cameraStream) return;
  const track = cameraStream.getVideoTracks()[0];
  if (!track) return;
  torchEnabled = !torchEnabled;
  track.applyConstraints({ advanced: [{ torch: torchEnabled }] }).catch(() => {
    if (typeof showAlert === 'function') showAlert('Flashlight not supported on this device.', 'info');
    torchEnabled = false;
  });
};

window.custCapturePhoto = function () {
  const video = document.getElementById('custCameraVideo');
  const canvas = document.getElementById('custCameraCanvas');
  if (!video || !canvas) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  canvas.toBlob(blob => {
    if (!blob) return;
    capturedBlob = blob;
    const url = URL.createObjectURL(blob);
    const previewImg = document.getElementById('custPreviewImg');
    if (previewImg) previewImg.src = url;

    // Show preview, hide live camera
    const wrapper = document.getElementById('custCameraWrapper');
    const preview = document.getElementById('custPreviewWrapper');
    if (wrapper) wrapper.style.display = 'none';
    if (preview) preview.style.display = '';

    // Reset enhance sliders
    resetEnhance('custBrightness', 'custBrightnessVal', 'custContrast', 'custContrastVal', 'custPreviewImg');
  }, 'image/jpeg', 0.92);
};

window.custRetake = function () {
  capturedBlob = null;
  const wrapper = document.getElementById('custCameraWrapper');
  const preview = document.getElementById('custPreviewWrapper');
  if (wrapper) wrapper.style.display = '';
  if (preview) preview.style.display = 'none';
  startCameraStream(currentFacingMode);
};

// ─── File Upload ────────────────────────────────────────────────────────────
window.custHandleFileUpload = function (e) {
  const file = e.target.files && e.target.files[0];
  if (file) showUploadPreview(file);
};

window.custHandleDrop = function (e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) showUploadPreview(file);
};

function showUploadPreview(file) {
  if (file.size > 10 * 1024 * 1024) {
    if (typeof showAlert === 'function') showAlert('File too large. Maximum is 10MB.', 'warning');
    return;
  }
  uploadedFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = document.getElementById('custUploadPreviewImg');
    if (img) img.src = ev.target.result;
    const area = document.getElementById('custUploadArea');
    const preview = document.getElementById('custUploadPreviewWrapper');
    if (area) area.style.display = 'none';
    if (preview) preview.style.display = '';
    resetEnhance('custUpBrightness', 'custUpBrightnessVal', 'custUpContrast', 'custUpContrastVal', 'custUploadPreviewImg');
  };
  reader.readAsDataURL(file);
}

window.custClearUpload = function () {
  uploadedFile = null;
  const area = document.getElementById('custUploadArea');
  const preview = document.getElementById('custUploadPreviewWrapper');
  if (area) area.style.display = '';
  if (preview) preview.style.display = 'none';
  const input = document.getElementById('custFileInput');
  if (input) input.value = '';
};

// ─── Image Enhance ──────────────────────────────────────────────────────────
function resetEnhance(bId, bValId, cId, cValId, imgId) {
  const b = document.getElementById(bId);
  const bv = document.getElementById(bValId);
  const c = document.getElementById(cId);
  const cv = document.getElementById(cValId);
  if (b) b.value = 100;
  if (bv) bv.textContent = '100%';
  if (c) c.value = 100;
  if (cv) cv.textContent = '100%';
  applyFilter(imgId, 100, 100);
}

function applyFilter(imgId, brightness, contrast) {
  const img = document.getElementById(imgId);
  if (img) img.style.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
}

window.custApplyEnhance = function () {
  const b = parseInt(document.getElementById('custBrightness')?.value || 100, 10);
  const c = parseInt(document.getElementById('custContrast')?.value || 100, 10);
  const bv = document.getElementById('custBrightnessVal');
  const cv = document.getElementById('custContrastVal');
  if (bv) bv.textContent = b + '%';
  if (cv) cv.textContent = c + '%';
  applyFilter('custPreviewImg', b, c);
};

window.custApplyUploadEnhance = function () {
  const b = parseInt(document.getElementById('custUpBrightness')?.value || 100, 10);
  const c = parseInt(document.getElementById('custUpContrast')?.value || 100, 10);
  const bv = document.getElementById('custUpBrightnessVal');
  const cv = document.getElementById('custUpContrastVal');
  if (bv) bv.textContent = b + '%';
  if (cv) cv.textContent = c + '%';
  applyFilter('custUploadPreviewImg', b, c);
};

// ─── OCR Processing ─────────────────────────────────────────────────────────
window.custStartOCR = async function () {
  // Determine source file
  let file = null;
  if (activeTab === 'camera' && capturedBlob) {
    file = new File([capturedBlob], 'camera-capture.jpg', { type: 'image/jpeg' });
  } else if (activeTab === 'upload' && uploadedFile) {
    file = uploadedFile;
  }

  if (!file) {
    if (typeof showAlert === 'function') showAlert('Please capture or upload a document first.', 'warning');
    return;
  }

  // Switch to processing step
  showOcrStep(2);
  setProgress(0, 'Preparing document...');

  try {
    setProgress(20, 'Uploading to OCR engine...');

    // Get auth token
    let token = '';
    if (auth.currentUser) {
      token = await getIdToken(auth.currentUser, false);
    }

    const formData = new FormData();
    formData.append('file', file);

    setProgress(40, 'Analyzing document...');

    const resp = await fetch(`${API_BASE}/ocr`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData
    });

    setProgress(70, 'Extracting text...');

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || `Server error ${resp.status}`);
    }

    const result = await resp.json();
    setProgress(100, 'Complete!');

    // Show results after brief delay for UX
    setTimeout(() => {
      displayOcrResults(result, file);
    }, 400);
  } catch (err) {
    console.error('Customer OCR error:', err);
    showOcrStep(1); // back to input
    if (typeof showAlert === 'function') showAlert(err.message || 'OCR processing failed. Please try again.', 'error');
  }
};

function displayOcrResults(result, file) {
  showOcrStep(3);

  // Confidence badge
  const badge = document.getElementById('custConfidenceBadge');
  if (badge) {
    const conf = result.confidence != null ? result.confidence : '--';
    badge.textContent = conf + '%';
    badge.style.background = conf >= 90 ? '#10b981' : conf >= 70 ? '#f59e0b' : '#ef4444';
  }

  // Result image preview
  const resultImg = document.getElementById('custResultImg');
  if (resultImg && file) {
    resultImg.src = URL.createObjectURL(file);
  }

  // Extracted text
  const textarea = document.getElementById('custOcrResultText');
  if (textarea) textarea.value = result.text || '(No text detected)';
}

function showOcrStep(step) {
  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById(`custOcrStep${i}`);
    if (el) el.style.display = i === step ? '' : 'none';
  }
}

function setProgress(pct, label) {
  const fill = document.getElementById('custOcrProgressFill');
  const text = document.getElementById('custOcrProcessText');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = label;
}

// ─── Result Actions ─────────────────────────────────────────────────────────
window.custScanAgain = function () {
  capturedBlob = null;
  uploadedFile = null;
  showOcrStep(1);

  // Reset camera preview
  const wrapper = document.getElementById('custCameraWrapper');
  const preview = document.getElementById('custPreviewWrapper');
  if (wrapper) wrapper.style.display = '';
  if (preview) preview.style.display = 'none';

  // Reset upload area
  const area = document.getElementById('custUploadArea');
  const upPreview = document.getElementById('custUploadPreviewWrapper');
  if (area) area.style.display = '';
  if (upPreview) upPreview.style.display = 'none';
  const input = document.getElementById('custFileInput');
  if (input) input.value = '';

  stopCameraStream();
};

window.custCopyText = function () {
  const textarea = document.getElementById('custOcrResultText');
  if (!textarea) return;
  navigator.clipboard.writeText(textarea.value).then(() => {
    if (typeof showAlert === 'function') showAlert('Text copied to clipboard!', 'success');
  }).catch(() => {
    textarea.select();
    document.execCommand('copy');
    if (typeof showAlert === 'function') showAlert('Text copied!', 'success');
  });
};

window.custDownloadText = function () {
  const textarea = document.getElementById('custOcrResultText');
  if (!textarea) return;
  const blob = new Blob([textarea.value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ocr-result.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ─── ID Scan — Auto-Fill Applicant Form ─────────────────────────────────────
/**
 * Scan a valid ID (Philippine driver's license, passport, national ID) and
 * auto-fill the applicant details form on Step 3.
 */
window.scanIdAndAutoFill = async function (fileInput) {
  const file = fileInput?.files?.[0];
  if (!file) {
    if (typeof showAlert === 'function') showAlert('Please select an ID image first.', 'warning');
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    if (typeof showAlert === 'function') showAlert('File too large. Maximum is 10MB.', 'warning');
    return;
  }

  const btn = document.getElementById('scanIdBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning ID...'; }

  try {
    let token = '';
    if (auth.currentUser) {
      token = await getIdToken(auth.currentUser, false);
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', 'prebuilt-idDocument');

    const resp = await fetch(`${API_BASE}/ocr/scan-id`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || `Server error ${resp.status}`);
    }

    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'ID scan failed');

    const fields = data.fields || {};
    let filled = 0;

    // Determine if personal or company type is active
    const personalType = document.getElementById('personalType');
    if (personalType && personalType.checked) {
      if (fields.firstName) { setVal('firstName', fields.firstName); filled++; }
      if (fields.lastName) { setVal('lastName', fields.lastName); filled++; }
      if (fields.middleName) { setVal('middleName', fields.middleName); filled++; }
    }

    // Address fields
    if (fields.address) {
      setVal('streetAddress', fields.address);
      filled++;
    }

    // Mobile (if extracted)
    if (fields.mobile) {
      const mobileField = document.getElementById('applicantMobileIndividual');
      if (mobileField) { mobileField.value = fields.mobile; filled++; }
    }

    if (filled > 0) {
      if (typeof showAlert === 'function') showAlert(`Auto-filled ${filled} field(s) from your ID. Please review and correct if needed.`, 'success');
    } else {
      if (typeof showAlert === 'function') showAlert('Could not extract fields from this ID. Please fill in manually.', 'warning');
    }
  } catch (err) {
    console.error('ID scan error:', err);
    if (typeof showAlert === 'function') showAlert(err.message || 'ID scan failed. Please fill in manually.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Scan ID'; }
  }
};

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

// ─── Document Verification — Validate uploaded requirements via OCR ─────────
const DOCUMENT_KEYWORDS = {
  'Barangay Clearance': ['barangay', 'clearance', 'punong barangay', 'captain', 'certification', 'brgy'],
  'Tax Declaration': ['tax', 'declaration', 'assessed value', 'real property', 'tax dec', 'municipal assessor'],
  'Cedula': ['cedula', 'community tax', 'certificate', 'ctc', 'community tax certificate'],
  'Environmental Compliance Certificate': ['environmental', 'compliance', 'ecc', 'denr', 'eia'],
  'Business Permit': ['business', 'permit', 'mayor', 'municipal', 'business permit'],
  'Land Title': ['title', 'register of deeds', 'transfer certificate', 'tct', 'oct', 'original certificate'],
  'Valid ID': ['identification', 'driver', 'license', 'passport', 'philsys', 'national id', 'sss', 'umid', 'voter'],
  'Endorsement Letter': ['endorsement', 'recommend', 'endorse', 'letter', 'forwarded'],
  'Survey Plan': ['survey', 'plan', 'geodetic', 'lot', 'boundary', 'surveyor'],
  'Affidavit': ['affidavit', 'sworn', 'notary', 'notarized', 'oath'],
  'CENRO Certification': ['cenro', 'certification', 'environment', 'natural resources'],
  'Deed of Sale': ['deed', 'sale', 'absolute', 'vendor', 'vendee', 'conveyance'],
  'Letter Request': ['letter', 'request', 'dear', 'sir', 'madam', 'respectfully', 'application']
};

/**
 * Verify a single uploaded document: OCR it, classify it, check keywords.
 * Returns { verified, detectedType, confidence, matchScore, text }.
 */
window.verifyDocument = async function (file, expectedType) {
  if (!file) return { verified: false, error: 'No file provided' };

  try {
    let token = '';
    if (auth.currentUser) {
      token = await getIdToken(auth.currentUser, false);
    }

    const formData = new FormData();
    formData.append('file', file);

    const resp = await fetch(`${API_BASE}/ocr`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || `Server error ${resp.status}`);
    }

    const result = await resp.json();
    const text = (result.text || '').toLowerCase();
    const ocrConfidence = result.confidence || 0;

    // Classify document
    const classification = classifyDocument(text);

    // Check if detected type matches expected
    const expectedNorm = (expectedType || '').toLowerCase();
    const detectedNorm = (classification.type || '').toLowerCase();
    const isMatch = detectedNorm.includes(expectedNorm) || expectedNorm.includes(detectedNorm) ||
      classification.matchScores.some(s =>
        expectedNorm.includes(s.type.toLowerCase()) && s.score > 0
      );

    return {
      verified: isMatch && classification.confidence > 30,
      detectedType: classification.type,
      confidence: ocrConfidence,
      matchScore: classification.confidence,
      expectedType: expectedType,
      text: result.text,
      pageCount: result.pageCount
    };
  } catch (err) {
    console.error('Document verification error:', err);
    return { verified: false, error: err.message };
  }
};

/**
 * Classify a document based on OCR text content by matching keywords.
 */
function classifyDocument(text) {
  const scores = [];
  for (const [docType, keywords] of Object.entries(DOCUMENT_KEYWORDS)) {
    let matchCount = 0;
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) matchCount++;
    }
    const score = keywords.length > 0 ? Math.round((matchCount / keywords.length) * 100) : 0;
    scores.push({ type: docType, score, matchCount, totalKeywords: keywords.length });
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0] || { type: 'Unknown', score: 0 };

  return {
    type: best.score > 0 ? best.type : 'Unknown',
    confidence: best.score,
    matchScores: scores.filter(s => s.score > 0)
  };
}

/**
 * Batch-verify all uploaded documents in Step 5 dynamically.
 * Shows inline verification badges per upload slot.
 */
window.verifyAllUploadedDocuments = async function () {
  const verifyBtn = document.getElementById('verifyDocsBtn');
  if (verifyBtn) { verifyBtn.disabled = true; verifyBtn.textContent = 'Verifying...'; }

  const permitType = document.getElementById('permitType')?.value || '';
  const requirements = window.PERMIT_REQUIREMENTS?.[permitType] || [];
  const results = [];

  for (let i = 0; i < requirements.length; i++) {
    const uploadField = document.getElementById(`docUpload_${i}`);
    const file = uploadField?.files?.[0];
    const badgeId = `docVerifyBadge_${i}`;

    // Create or find badge element
    let badge = document.getElementById(badgeId);
    if (!badge) {
      badge = document.createElement('span');
      badge.id = badgeId;
      badge.style.cssText = 'display:inline-block;margin-left:8px;font-size:12px;font-weight:600;padding:2px 8px;border-radius:6px;';
      const label = uploadField?.closest('.upload-slot')?.querySelector('label, .requirement-label');
      if (label) label.appendChild(badge);
    }

    if (!file) {
      badge.textContent = '— No file';
      badge.style.background = '#f1f5f9';
      badge.style.color = '#64748b';
      results.push({ index: i, requirement: requirements[i], verified: false, reason: 'no file' });
      continue;
    }

    badge.textContent = '⏳ Checking...';
    badge.style.background = '#fef3c7';
    badge.style.color = '#92400e';

    const result = await window.verifyDocument(file, requirements[i]);
    results.push({ index: i, requirement: requirements[i], ...result });

    if (result.error) {
      badge.textContent = '⚠️ Error';
      badge.style.background = '#fef2f2';
      badge.style.color = '#991b1b';
      badge.title = result.error;
    } else if (result.verified) {
      badge.textContent = `✅ ${result.matchScore}%`;
      badge.style.background = '#ecfdf5';
      badge.style.color = '#065f46';
      badge.title = `Detected: ${result.detectedType} (${result.confidence}% OCR confidence)`;
    } else {
      badge.textContent = `⚠️ ${result.detectedType || 'Unknown'}`;
      badge.style.background = '#fff7ed';
      badge.style.color = '#9a3412';
      badge.title = `Expected: ${requirements[i]}, Detected: ${result.detectedType || 'Unknown'}`;
    }
  }

  if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.textContent = 'Verify Documents'; }

  // Summary alert
  const verified = results.filter(r => r.verified).length;
  const total = results.filter(r => r.reason !== 'no file').length;
  if (total > 0) {
    if (typeof showAlert === 'function') {
      if (verified === total) {
        showAlert(`All ${verified} document(s) verified successfully!`, 'success');
      } else {
        showAlert(`${verified}/${total} document(s) verified. Please check flagged documents.`, 'warning');
      }
    }
  }

  return results;
};

// Clean up camera on page unload
window.addEventListener('beforeunload', () => {
  stopCameraStream();
});
