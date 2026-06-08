/**
 * OCR Service Module
 * Handles image pre-processing, Azure Document Intelligence OCR,
 * and text extraction for DENR permit documents.
 */

const API_BASE = window.API_BASE ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:3000'
    : '');

// OCR Configuration
const OCR_CONFIG = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  confidenceThreshold: 60, // Minimum confidence for auto-fill
  maxRetries: 2
};

/**
 * Image pre-processing to enhance OCR accuracy for poor quality images
 */
class ImagePreprocessor {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * Process image for better OCR results
   * @param {File|Blob|HTMLCanvasElement} source - Input image
   * @param {Object} options - Processing options
   * @returns {Promise<Blob>} - Processed image blob
   */
  async process(source, options = {}) {
    const {
      autoContrast = true,
      sharpen = true,
      denoise = true,
      autoRotate = true,
      targetWidth = 2000
    } = options;

    try {
      // Load image
      const img = await this.loadImage(source);
      
      // Set canvas size (limit max dimension for performance)
      let { width, height } = this.calculateDimensions(img.width, img.height, targetWidth);
      this.canvas.width = width;
      this.canvas.height = height;

      // Clear and draw original
      this.ctx.clearRect(0, 0, width, height);
      this.ctx.drawImage(img, 0, 0, width, height);

      // Get image data for processing
      let imageData = this.ctx.getImageData(0, 0, width, height);

      // Apply enhancements
      if (autoContrast) {
        imageData = this.applyAutoContrast(imageData);
      }

      if (denoise) {
        imageData = this.applyDenoise(imageData);
      }

      if (sharpen) {
        imageData = this.applySharpen(imageData);
      }

      // Put processed data back
      this.ctx.putImageData(imageData, 0, 0);

      // Auto-rotation detection and correction (simplified)
      if (autoRotate) {
        // For now, we'll skip complex rotation detection
        // as Azure DI handles some rotation automatically
      }

      // Convert to blob
      return await this.canvasToBlob(this.canvas, 'image/jpeg', 0.9);
    } catch (error) {
      console.error('Image preprocessing failed:', error);
      // Return original if processing fails
      return source instanceof Blob ? source : await this.canvasToBlob(source);
    }
  }

  loadImage(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      
      if (source instanceof File || source instanceof Blob) {
        img.src = URL.createObjectURL(source);
      } else if (source instanceof HTMLCanvasElement) {
        img.src = source.toDataURL();
      } else {
        reject(new Error('Invalid image source'));
      }
    });
  }

  calculateDimensions(width, height, maxWidth) {
    if (width <= maxWidth) return { width, height };
    const ratio = maxWidth / width;
    return {
      width: maxWidth,
      height: Math.round(height * ratio)
    };
  }

  applyAutoContrast(imageData) {
    const data = imageData.data;
    const pixelCount = data.length / 4;
    
    // Calculate histogram
    let min = 255, max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      min = Math.min(min, gray);
      max = Math.max(max, gray);
    }

    // Apply contrast stretching
    if (max > min) {
      const range = max - min;
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const newGray = ((gray - min) / range) * 255;
        data[i] = data[i + 1] = data[i + 2] = newGray;
      }
    }

    return imageData;
  }

  applyDenoise(imageData) {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data);
    
    // Simple median filter for denoising
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        const neighbors = [];
        
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nIdx = ((y + dy) * width + (x + dx)) * 4;
            neighbors.push(data[nIdx]);
          }
        }
        
        neighbors.sort((a, b) => a - b);
        const median = neighbors[4];
        output[idx] = output[idx + 1] = output[idx + 2] = median;
      }
    }
    
    return new ImageData(output, width, height);
  }

  applySharpen(imageData) {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data);
    
    // Sharpen kernel
    const kernel = [
      0, -1, 0,
      -1, 5, -1,
      0, -1, 0
    ];
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let r = 0, g = 0, b = 0;
        
        for (let ky = 0; ky < 3; ky++) {
          for (let kx = 0; kx < 3; kx++) {
            const idx = ((y + ky - 1) * width + (x + kx - 1)) * 4;
            const weight = kernel[ky * 3 + kx];
            r += data[idx] * weight;
            g += data[idx + 1] * weight;
            b += data[idx + 2] * weight;
          }
        }
        
        const idx = (y * width + x) * 4;
        output[idx] = Math.min(255, Math.max(0, r));
        output[idx + 1] = Math.min(255, Math.max(0, g));
        output[idx + 2] = Math.min(255, Math.max(0, b));
      }
    }
    
    return new ImageData(output, width, height);
  }

  canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    });
  }
}

/**
 * Document field extractors for common document types
 */
class FieldExtractor {
  /**
   * Extract common fields from OCR text
   * @param {string} text - Raw OCR text
   * @param {string} documentType - Type of document
   * @returns {Object} - Extracted fields
   */
  static extract(text, documentType = 'generic') {
    const extractors = {
      'id': this.extractIdFields,
      'business_permit': this.extractBusinessFields,
      'land_title': this.extractLandTitleFields,
      'application_form': this.extractFormFields,
      'generic': this.extractGenericFields
    };

    const extractor = extractors[documentType] || extractors.generic;
    return extractor.call(this, text);
  }

  static extractIdFields(text) {
    return {
      fullName: this.extractName(text),
      idNumber: this.extractIdNumber(text),
      dateOfBirth: this.extractDate(text, /birth|dob|born/i),
      address: this.extractAddress(text),
      expiryDate: this.extractDate(text, /expir|valid/i),
      documentType: 'ID Card'
    };
  }

  static extractBusinessFields(text) {
    return {
      businessName: this.extractBusinessName(text),
      ownerName: this.extractName(text),
      businessAddress: this.extractAddress(text),
      permitNumber: this.extractPermitNumber(text),
      issueDate: this.extractDate(text, /issue|granted/i),
      expiryDate: this.extractDate(text, /expir|valid/i),
      documentType: 'Business Permit'
    };
  }

  static extractLandTitleFields(text) {
    return {
      titleNumber: this.extractTitleNumber(text),
      ownerName: this.extractName(text),
      lotArea: this.extractArea(text),
      location: this.extractAddress(text),
      issueDate: this.extractDate(text),
      documentType: 'Land Title'
    };
  }

  static extractFormFields(text) {
    return {
      applicantName: this.extractName(text),
      applicationDate: this.extractDate(text, /date.*apply|application.*date/i),
      contactInfo: this.extractContactInfo(text),
      address: this.extractAddress(text),
      documentType: 'Application Form'
    };
  }

  static extractGenericFields(text) {
    return {
      detectedNames: this.extractAllNames(text),
      detectedDates: this.extractAllDates(text),
      detectedNumbers: this.extractAllNumbers(text),
      documentType: 'Unknown Document'
    };
  }

  // Field extraction helpers
  static extractName(text) {
    const patterns = [
      /(?:name|full name|applicant|owner)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
      /([A-Z][a-zA-Z]+(?:,\s+)?[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]+)*)/,
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1]?.trim();
    }
    return null;
  }

  static extractAllNames(text) {
    const namePattern = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}/g;
    return [...text.matchAll(namePattern)].map(m => m[0]).slice(0, 5);
  }

  static extractIdNumber(text) {
    const patterns = [
      /(?:id|number|no)[:\s#]*([A-Z0-9-]{6,20})/i,
      /\b([0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4})\b/,
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1]?.trim();
    }
    return null;
  }

  static extractPermitNumber(text) {
    const match = text.match(/(?:permit|license|cert)[:\s#]*([A-Z0-9-]{5,25})/i);
    return match ? match[1]?.trim() : null;
  }

  static extractTitleNumber(text) {
    const match = text.match(/(?:title|tdt|oct)[:\s#]*([A-Z0-9-]{5,20})/i);
    return match ? match[1]?.trim() : null;
  }

  static extractBusinessName(text) {
    const match = text.match(/(?:business name|company|establishment)[:\s]+([^\n]+)/i);
    return match ? match[1]?.trim() : null;
  }

  static extractAddress(text) {
    const patterns = [
      /(?:address|located at|residence)[:\s]+([^\n,]+(?:,\s*[^\n]+){0,3})/i,
      /([^\n,]*(?:Barangay|Brgy|Street|Avenue|Road)[^\n,]*)/i,
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1]?.trim();
    }
    return null;
  }

  static extractDate(text, contextPattern = null) {
    const datePatterns = [
      /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/,
      /(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/,
      /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i,
    ];
    
    if (contextPattern) {
      // Look for date near context words
      const lines = text.split('\n');
      for (const line of lines) {
        if (contextPattern.test(line)) {
          for (const pattern of datePatterns) {
            const match = line.match(pattern);
            if (match) return match[1];
          }
        }
      }
    }
    
    // Default: find first date
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  static extractAllDates(text) {
    const datePattern = /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/g;
    return [...text.matchAll(datePattern)].map(m => m[0]).slice(0, 5);
  }

  static extractContactInfo(text) {
    const phone = text.match(/(?:tel|phone|mobile|contact)[:\s]*([0-9\-\+\s]{7,15})/i);
    const email = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    
    return {
      phone: phone ? phone[1]?.trim() : null,
      email: email ? email[1] : null
    };
  }

  static extractArea(text) {
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:sqm|sq\.?m|square|hectare|ha)/i);
    return match ? match[0] : null;
  }

  static extractAllNumbers(text) {
    const numberPattern = /\b\d{4,}[\w-]*\b/g;
    return [...text.matchAll(numberPattern)].map(m => m[0]).slice(0, 10);
  }
}

/**
 * Main OCR Service Class
 */
class OCRService {
  constructor() {
    this.preprocessor = new ImagePreprocessor();
    this.abortController = null;
  }

  /**
   * Perform OCR on an image file
   * @param {File|Blob} file - Image file to process
   * @param {Object} options - OCR options
   * @returns {Promise<Object>} - OCR result
   */
  async scan(file, options = {}) {
    const {
      documentType = 'generic',
      preprocess = true,
      onProgress = null
    } = options;

    // Validate file
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    try {
      onProgress?.({ stage: 'preprocessing', progress: 0 });

      // Pre-process image
      let processedFile = file;
      if (preprocess && file.type.startsWith('image/')) {
        processedFile = await this.preprocessor.process(file);
      }

      onProgress?.({ stage: 'uploading', progress: 30 });

      // Perform OCR via API
      const result = await this.performOCR(processedFile, onProgress);

      onProgress?.({ stage: 'extracting', progress: 80 });

      // Extract structured fields
      const fields = FieldExtractor.extract(result.text, documentType);

      onProgress?.({ stage: 'complete', progress: 100 });

      return {
        success: true,
        text: result.text,
        lines: result.lines || [],
        confidence: result.confidence,
        pageCount: result.pageCount || 1,
        fields,
        documentType,
        engine: result.engine || 'Azure Document Intelligence',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('OCR scan failed:', error);
      return {
        success: false,
        error: error.message,
        stage: 'failed'
      };
    }
  }

  /**
   * Validate file for OCR
   */
  validateFile(file) {
    if (!file) {
      return { valid: false, error: 'No file provided' };
    }

    if (file.size > OCR_CONFIG.maxFileSize) {
      return { valid: false, error: `File too large. Maximum size is ${OCR_CONFIG.maxFileSize / 1024 / 1024}MB` };
    }

    if (!OCR_CONFIG.allowedTypes.includes(file.type)) {
      return { valid: false, error: `File type not supported. Allowed: ${OCR_CONFIG.allowedTypes.join(', ')}` };
    }

    return { valid: true };
  }

  /**
   * Perform OCR via server endpoint
   */
  async performOCR(file, onProgress) {
    // Cancel any ongoing request
    this.abortController?.abort();
    this.abortController = new AbortController();

    const formData = new FormData();
    formData.append('file', file, file.name || 'scan.jpg');

    onProgress?.({ stage: 'processing', progress: 50 });

    const response = await fetch(`${API_BASE}/ocr`, {
      method: 'POST',
      body: formData,
      signal: this.abortController.signal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `OCR failed: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Cancel ongoing OCR request
   */
  cancel() {
    this.abortController?.abort();
  }

  /**
   * Detect document type from image/content
   */
  detectDocumentType(text) {
    const textLower = text.toLowerCase();
    
    if (/driver['']?s license|passport|id card|national id|philippine id|ssn|tin|gsis/i.test(textLower)) {
      return 'id';
    }
    if (/business permit|mayor['']?s permit|business license|dti|sec registration/i.test(textLower)) {
      return 'business_permit';
    }
    if (/title|tdt|oct|transfer certificate|original certificate|deed|survey/i.test(textLower)) {
      return 'land_title';
    }
    if (/application form|application for|permit application/i.test(textLower)) {
      return 'application_form';
    }
    
    return 'generic';
  }

  /**
   * Check if confidence is good enough for auto-fill
   */
  isConfidenceGood(confidence) {
    return confidence >= OCR_CONFIG.confidenceThreshold;
  }

  /**
   * Get suggestions for improving scan quality
   */
  getQualitySuggestions(confidence, text) {
    const suggestions = [];
    
    if (confidence < 60) {
      suggestions.push('Image may be blurry. Try taking photo again with steady hands.');
    }
    if (confidence < 40) {
      suggestions.push('Ensure document is well-lit and in focus.');
    }
    if (text.length < 50) {
      suggestions.push('Limited text detected. Make sure all document text is visible.');
    }
    
    return suggestions;
  }
}

/**
 * OCR Storage Manager - Handles saving/retrieving OCR results
 */
class OCRStorage {
  constructor(db) {
    this.db = db;
  }

  /**
   * Save OCR result to Firestore
   */
  async save(userId, applicationId, ocrResult, metadata = {}) {
    const ocrData = {
      userId,
      applicationId: applicationId || null,
      text: ocrResult.text,
      confidence: ocrResult.confidence,
      fields: ocrResult.fields,
      documentType: ocrResult.documentType,
      engine: ocrResult.engine,
      timestamp: new Date().toISOString(),
      metadata,
      searchableText: this.createSearchableText(ocrResult)
    };

    // Save to ocrResults collection
    const docRef = await this.db.collection('ocrResults').add(ocrData);
    
    // Update search index
    await this.updateSearchIndex(userId, docRef.id, ocrData);

    return { id: docRef.id, ...ocrData };
  }

  /**
   * Create searchable text from OCR result
   */
  createSearchableText(ocrResult) {
    const parts = [ocrResult.text];
    
    if (ocrResult.fields) {
      Object.values(ocrResult.fields).forEach(value => {
        if (value && typeof value === 'string') {
          parts.push(value);
        }
      });
    }
    
    return parts.join(' ').toLowerCase();
  }

  /**
   * Update search index
   */
  async updateSearchIndex(userId, ocrId, ocrData) {
    const indexData = {
      userId,
      ocrId,
      searchableText: ocrData.searchableText,
      documentType: ocrData.documentType,
      timestamp: ocrData.timestamp,
      confidence: ocrData.confidence,
      fields: {
        fullName: ocrData.fields?.fullName || ocrData.fields?.applicantName || ocrData.fields?.ownerName,
        idNumber: ocrData.fields?.idNumber || ocrData.fields?.permitNumber || ocrData.fields?.titleNumber
      }
    };

    await this.db.collection('documentIndex').doc(ocrId).set(indexData);
  }

  /**
   * Get OCR results for a user
   */
  async getByUser(userId, options = {}) {
    const { limit = 50, applicationId } = options;
    
    let query = this.db.collection('ocrResults')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(limit);

    if (applicationId) {
      query = query.where('applicationId', '==', applicationId);
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * Get single OCR result
   */
  async getById(ocrId) {
    const doc = await this.db.collection('ocrResults').doc(ocrId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }

  /**
   * Delete OCR result
   */
  async delete(ocrId) {
    await this.db.collection('ocrResults').doc(ocrId).delete();
    await this.db.collection('documentIndex').doc(ocrId).delete();
  }
}

/**
 * OCR Search functionality
 */
class OCRSearch {
  constructor(db) {
    this.db = db;
  }

  /**
   * Search documents by text content
   */
  async search(userId, query, options = {}) {
    const { 
      documentType = null,
      dateFrom = null,
      dateTo = null,
      limit = 20
    } = options;

    const searchLower = query.toLowerCase();
    const keywords = searchLower.split(/\s+/).filter(k => k.length > 2);

    // Get all user's documents
    let dbQuery = this.db.collection('documentIndex')
      .where('userId', '==', userId);

    if (documentType) {
      dbQuery = dbQuery.where('documentType', '==', documentType);
    }

    const snapshot = await dbQuery.get();
    const results = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      const searchableText = data.searchableText || '';
      
      // Check if all keywords are present
      const matchesAll = keywords.every(keyword => searchableText.includes(keyword));
      
      if (matchesAll) {
        // Calculate relevance score
        let score = 0;
        keywords.forEach(keyword => {
          const matches = (searchableText.match(new RegExp(keyword, 'g')) || []).length;
          score += matches;
        });

        // Boost score for name/ID matches
        if (data.fields?.fullName?.toLowerCase().includes(searchLower)) score += 10;
        if (data.fields?.idNumber?.toLowerCase().includes(searchLower)) score += 10;

        results.push({
          id: doc.id,
          ...data,
          relevanceScore: score
        });
      }
    });

    // Sort by relevance
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return results.slice(0, limit);
  }

  /**
   * Quick search by field
   */
  async searchByField(userId, field, value) {
    const snapshot = await this.db.collection('documentIndex')
      .where('userId', '==', userId)
      .where(`fields.${field}`, '>=', value)
      .where(`fields.${field}`, '<=', value + '\uf8ff')
      .limit(10)
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
}

// Export classes
export { OCRService, OCRStorage, OCRSearch, FieldExtractor, ImagePreprocessor, OCR_CONFIG };
export default OCRService;
