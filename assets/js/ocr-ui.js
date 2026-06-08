/**
 * OCR UI Components
 * Provides UI for scanning, viewing results, and searching documents
 */

import { ScannerManager } from './mobile-scanner.js';
import { OCRService } from './ocr-service.js';
import { OCRSearchEngine } from './ocr-search.js';

class OCRUI {
  constructor(db, options = {}) {
    this.db = db;
    this.options = {
      onOCRComplete: null,
      onError: null,
      ...options
    };
    
    this.scanner = new ScannerManager();
    this.ocrService = new OCRService();
    this.searchEngine = new OCRSearchEngine(db);
    this.currentProgress = null;
  }

  /**
   * Show document scanner modal
   */
  async showScanner(documentType = 'generic') {
    const modal = this.createScannerModal();
    document.body.appendChild(modal);

    return new Promise((resolve, reject) => {
      this.scanner.open({
        onCapture: async (result) => {
          modal.remove();
          try {
            const ocrResult = await this.performOCR(result.file, documentType);
            resolve(ocrResult);
          } catch (error) {
            reject(error);
          }
        },
        onClose: () => {
          modal.remove();
          reject(new Error('Scan cancelled'));
        }
      });
    });
  }

  /**
   * Create scanner modal element
   */
  createScannerModal() {
    const modal = document.createElement('div');
    modal.className = 'ocr-modal scanner-modal';
    modal.innerHTML = `
      <div class="ocr-modal-overlay"></div>
      <div class="ocr-modal-content scanner-content">
        <div id="scannerContainer" class="scanner-container"></div>
      </div>
    `;
    
    modal.querySelector('.ocr-modal-overlay').addEventListener('click', () => {
      this.scanner.close();
      modal.remove();
    });
    
    return modal;
  }

  /**
   * Perform OCR with progress UI
   */
  async performOCR(file, documentType) {
    const progressModal = this.showProgressModal('Scanning document...');
    
    try {
      const result = await this.ocrService.scan(file, {
        documentType,
        preprocess: true,
        onProgress: (status) => {
          this.updateProgress(status);
        }
      });

      progressModal.remove();

      if (!result.success) {
        throw new Error(result.error || 'OCR failed');
      }

      // Show results
      const confirmed = await this.showResultsModal(result);
      
      if (confirmed && this.options.onOCRComplete) {
        this.options.onOCRComplete(result);
      }

      return result;

    } catch (error) {
      progressModal.remove();
      this.showErrorModal(error.message);
      throw error;
    }
  }

  /**
   * Show progress modal
   */
  showProgressModal(title) {
    const modal = document.createElement('div');
    modal.className = 'ocr-modal progress-modal';
    modal.innerHTML = `
      <div class="ocr-modal-overlay"></div>
      <div class="ocr-modal-content progress-content">
        <div class="ocr-progress">
          <h3>${title}</h3>
          <div class="progress-bar-container">
            <div class="progress-bar">
              <div class="progress-fill" id="ocrProgressFill"></div>
            </div>
            <span class="progress-text" id="ocrProgressText">0%</span>
          </div>
          <p class="progress-status" id="ocrProgressStatus">Initializing...</p>
          <div class="progress-tips" id="progressTips"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  /**
   * Update progress UI
   */
  updateProgress(status) {
    const fill = document.getElementById('ocrProgressFill');
    const text = document.getElementById('ocrProgressText');
    const statusEl = document.getElementById('ocrProgressStatus');
    const tips = document.getElementById('progressTips');

    if (fill) fill.style.width = `${status.progress}%`;
    if (text) text.textContent = `${status.progress}%`;

    const stageMessages = {
      preprocessing: 'Enhancing image quality...',
      uploading: 'Uploading to server...',
      processing: 'Extracting text with AI...',
      extracting: 'Analyzing document fields...',
      complete: 'Done!'
    };

    if (statusEl && stageMessages[status.stage]) {
      statusEl.textContent = stageMessages[status.stage];
    }

    if (tips && status.stage === 'processing' && status.progress < 50) {
      tips.innerHTML = `
        <p><strong>💡 Tip:</strong> For blurry images, ensure good lighting and hold steady.</p>
      `;
    }
  }

  /**
   * Show OCR results modal
   */
  async showResultsModal(ocrResult) {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'ocr-modal results-modal';
      
      const confidenceColor = ocrResult.confidence >= 80 ? 'good' : 
                               ocrResult.confidence >= 50 ? 'medium' : 'poor';
      
      const suggestions = this.ocrService.getQualitySuggestions(
        ocrResult.confidence, 
        ocrResult.text
      );

      modal.innerHTML = `
        <div class="ocr-modal-overlay"></div>
        <div class="ocr-modal-content results-content">
          <div class="ocr-results">
            <h3>📄 Document Scanned</h3>
            
            <div class="confidence-badge ${confidenceColor}">
              <span class="confidence-label">Confidence</span>
              <span class="confidence-value">${ocrResult.confidence || 'N/A'}%</span>
            </div>

            ${suggestions.length > 0 ? `
              <div class="suggestions-box">
                <h4>Suggestions to improve:</h4>
                <ul>${suggestions.map(s => `<li>${s}</li>`).join('')}</ul>
              </div>
            ` : ''}

            <div class="extracted-fields">
              <h4>Extracted Information</h4>
              ${this.renderFields(ocrResult.fields)}
            </div>

            <div class="extracted-text">
              <h4>Full Text</h4>
              <textarea readonly rows="6">${ocrResult.text}</textarea>
            </div>

            <div class="results-actions">
              <button class="btn-secondary" id="rescanBtn">📷 Rescan</button>
              <button class="btn-primary" id="confirmOCRBtn">✓ Use This</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      modal.querySelector('#rescanBtn').addEventListener('click', () => {
        modal.remove();
        resolve(false);
      });

      modal.querySelector('#confirmOCRBtn').addEventListener('click', () => {
        modal.remove();
        resolve(true);
      });

      modal.querySelector('.ocr-modal-overlay').addEventListener('click', () => {
        modal.remove();
        resolve(false);
      });
    });
  }

  /**
   * Render extracted fields
   */
  renderFields(fields) {
    if (!fields || Object.keys(fields).length === 0) {
      return '<p class="no-fields">No structured fields detected</p>';
    }

    const fieldLabels = {
      fullName: 'Full Name',
      applicantName: 'Applicant Name',
      ownerName: 'Owner Name',
      businessName: 'Business Name',
      idNumber: 'ID Number',
      permitNumber: 'Permit Number',
      titleNumber: 'Title Number',
      address: 'Address',
      businessAddress: 'Business Address',
      dateOfBirth: 'Date of Birth',
      expiryDate: 'Expiry Date',
      issueDate: 'Issue Date',
      documentType: 'Document Type'
    };

    return Object.entries(fields)
      .filter(([key, value]) => value && key !== 'documentType')
      .map(([key, value]) => `
        <div class="field-item">
          <label>${fieldLabels[key] || key}</label>
          <input type="text" value="${value}" readonly class="field-value" data-field="${key}" />
          <button class="copy-btn" data-value="${value}" title="Copy">📋</button>
        </div>
      `).join('');
  }

  /**
   * Show search interface
   */
  async showSearchInterface(userId, onSelect = null) {
    const modal = document.createElement('div');
    modal.className = 'ocr-modal search-modal';
    modal.innerHTML = `
      <div class="ocr-modal-overlay"></div>
      <div class="ocr-modal-content search-content">
        <div class="ocr-search">
          <h3>🔍 Search Documents</h3>
          
          <div class="search-input-container">
            <input type="text" id="searchInput" placeholder="Search by name, ID, address..." />
            <button id="searchBtn">🔍</button>
          </div>

          <div class="search-filters">
            <select id="filterType">
              <option value="">All Types</option>
              <option value="id">ID Card</option>
              <option value="business_permit">Business Permit</option>
              <option value="land_title">Land Title</option>
              <option value="application_form">Application Form</option>
            </select>
            
            <select id="filterSort">
              <option value="relevance">Most Relevant</option>
              <option value="date">Newest First</option>
              <option value="confidence">Highest Confidence</option>
            </select>
          </div>

          <div class="search-results" id="searchResults">
            <p class="search-placeholder">Enter search terms to find documents</p>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Bind search events
    const searchInput = modal.querySelector('#searchInput');
    const searchBtn = modal.querySelector('#searchBtn');
    const filterType = modal.querySelector('#filterType');
    const filterSort = modal.querySelector('#filterSort');
    const resultsContainer = modal.querySelector('#searchResults');

    const performSearch = async () => {
      const query = searchInput.value.trim();
      if (!query) return;

      resultsContainer.innerHTML = '<p class="search-loading">Searching...</p>';

      try {
        const results = await this.searchEngine.search(userId, query, {
          documentType: filterType.value || null,
          sortBy: filterSort.value
        });

        this.renderSearchResults(results, resultsContainer, onSelect);
      } catch (error) {
        resultsContainer.innerHTML = `<p class="search-error">Error: ${error.message}</p>`;
      }
    };

    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') performSearch();
    });

    modal.querySelector('.ocr-modal-overlay').addEventListener('click', () => {
      modal.remove();
    });

    // Load recent documents
    this.loadRecentDocuments(userId, resultsContainer, onSelect);
  }

  /**
   * Render search results
   */
  renderSearchResults(results, container, onSelect) {
    if (results.length === 0) {
      container.innerHTML = '<p class="no-results">No documents found</p>';
      return;
    }

    container.innerHTML = results.map(result => `
      <div class="search-result-item" data-id="${result.id}">
        <div class="result-header">
          <span class="result-type">${this.getDocumentTypeIcon(result.documentType)} ${result.documentType}</span>
          <span class="result-confidence">${result.confidence}%</span>
        </div>
        <div class="result-preview">${result.preview}</div>
        ${result.highlights.length > 0 ? `
          <div class="result-highlights">
            ${result.highlights.map(h => `
              <span class="highlight">...${h.before}<mark>${h.match}</mark>${h.after}...</span>
            `).join('')}
          </div>
        ` : ''}
        <div class="result-meta">
          ${result.fields.fullName ? `<span class="meta-name">${result.fields.fullName}</span>` : ''}
          ${result.fields.idNumber ? `<span class="meta-id">${result.fields.idNumber}</span>` : ''}
          <span class="meta-date">${new Date(result.timestamp).toLocaleDateString()}</span>
        </div>
      </div>
    `).join('');

    // Bind click events
    container.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const result = results.find(r => r.id === item.dataset.id);
        onSelect?.(result);
      });
    });
  }

  /**
   * Load recent documents
   */
  async loadRecentDocuments(userId, container, onSelect) {
    try {
      const recent = await this.searchEngine.getRecent(userId, { limit: 5 });
      if (recent.length > 0) {
        container.innerHTML = '<h4 class="recent-header">Recent Documents</h4>';
        this.renderSearchResults(recent, container, onSelect);
      }
    } catch (error) {
      console.error('Failed to load recent documents:', error);
    }
  }

  /**
   * Get icon for document type
   */
  getDocumentTypeIcon(type) {
    const icons = {
      id: '🆔',
      business_permit: '🏢',
      land_title: '🏞️',
      application_form: '📝'
    };
    return icons[type] || '📄';
  }

  /**
   * Show error modal
   */
  showErrorModal(message) {
    const modal = document.createElement('div');
    modal.className = 'ocr-modal error-modal';
    modal.innerHTML = `
      <div class="ocr-modal-overlay"></div>
      <div class="ocr-modal-content error-content">
        <div class="error-box">
          <span class="error-icon">❌</span>
          <h3>Scan Failed</h3>
          <p>${message}</p>
          <button class="btn-primary" onclick="this.closest('.ocr-modal').remove()">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  /**
   * Create scan button for forms
   */
  createScanButton(options = {}) {
    const { 
      documentType = 'generic',
      onResult = null,
      label = '📷 Scan Document'
    } = options;

    const button = document.createElement('button');
    button.className = 'ocr-scan-btn';
    button.innerHTML = `<span class="scan-icon">📷</span> ${label}`;
    
    button.addEventListener('click', async () => {
      try {
        button.disabled = true;
        button.innerHTML = `<span class="scan-icon">⏳</span> Scanning...`;
        
        const result = await this.showScanner(documentType);
        onResult?.(result);
        
      } catch (error) {
        if (error.message !== 'Scan cancelled') {
          this.showErrorModal(error.message);
        }
      } finally {
        button.disabled = false;
        button.innerHTML = `<span class="scan-icon">📷</span> ${label}`;
      }
    });

    return button;
  }

  /**
   * Create search button
   */
  createSearchButton(userId, onSelect = null) {
    const button = document.createElement('button');
    button.className = 'ocr-search-btn';
    button.innerHTML = `🔍 Search Documents`;
    
    button.addEventListener('click', () => {
      this.showSearchInterface(userId, onSelect);
    });

    return button;
  }
}

export { OCRUI };
export default OCRUI;
