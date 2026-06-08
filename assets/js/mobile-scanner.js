/**
 * Mobile Scanner Component
 * Handles camera access, document capture, and real-time preview
 * Optimized for mobile browsers
 */

/**
 * Mobile Document Scanner
 */
class MobileScanner {
  constructor(options = {}) {
    this.options = {
      videoWidth: 1920,
      videoHeight: 1080,
      facingMode: 'environment', // 'environment' = rear camera
      onCapture: null,
      onError: null,
      ...options
    };
    
    this.stream = null;
    this.videoElement = null;
    this.canvasElement = null;
    this.isScanning = false;
    this.capturedImage = null;
  }

  /**
   * Initialize camera stream
   */
  async initialize(containerId) {
    try {
      // Check for camera support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera not supported in this browser. Please use a modern mobile browser.');
      }

      // Create scanner UI
      this.createScannerUI(containerId);

      // Request camera access
      const constraints = {
        video: {
          facingMode: this.options.facingMode,
          width: { ideal: this.options.videoWidth },
          height: { ideal: this.options.videoHeight }
        },
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Set up video element
      this.videoElement = document.getElementById('scannerVideo');
      this.videoElement.srcObject = this.stream;
      
      return new Promise((resolve, reject) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          this.isScanning = true;
          this.startFrameProcessing();
          resolve(true);
        };
        
        this.videoElement.onerror = () => {
          reject(new Error('Failed to initialize video stream'));
        };
      });

    } catch (error) {
      console.error('Camera initialization failed:', error);
      this.options.onError?.(error);
      throw error;
    }
  }

  /**
   * Create scanner UI elements
   */
  createScannerUI(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container #${containerId} not found`);
    }

    container.innerHTML = `
      <div class="mobile-scanner">
        <div class="scanner-viewport">
          <video id="scannerVideo" autoplay playsinline muted></video>
          <canvas id="scannerCanvas" style="display: none;"></canvas>
          
          <!-- Document frame overlay -->
          <div class="document-frame-overlay">
            <div class="document-corner tl"></div>
            <div class="document-corner tr"></div>
            <div class="document-corner bl"></div>
            <div class="document-corner br"></div>
            <div class="document-guide-text">Align document within frame</div>
          </div>
          
          <!-- Focus indicator -->
          <div class="focus-indicator">
            <div class="focus-ring"></div>
          </div>
          
          <!-- Preview overlay (hidden by default) -->
          <div class="preview-overlay" id="previewOverlay" style="display: none;">
            <img id="previewImage" alt="Captured document" />
          </div>
        </div>
        
        <!-- Scanner controls -->
        <div class="scanner-controls">
          <button class="scanner-btn secondary" id="closeScannerBtn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          
          <button class="scanner-btn capture" id="captureBtn">
            <div class="capture-ring">
              <div class="capture-inner"></div>
            </div>
          </button>
          
          <button class="scanner-btn secondary" id="flipCameraBtn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"></path>
              <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"></path>
              <circle cx="12" cy="12" r="3"></circle>
              <path d="m18 22-3-3 3-3"></path>
              <path d="m6 2 3 3-3 3"></path>
            </svg>
          </button>
        </div>
        
        <!-- Preview controls (shown after capture) -->
        <div class="preview-controls" id="previewControls" style="display: none;">
          <button class="scanner-btn text" id="retakeBtn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Retake
          </button>
          <button class="scanner-btn primary" id="confirmBtn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Use Photo
          </button>
        </div>
        
        <!-- Flash toggle -->
        <button class="flash-toggle" id="flashToggle">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"></path>
          </svg>
        </button>
        
        <!-- Zoom slider (mobile only) -->
        <div class="zoom-control" id="zoomControl">
          <input type="range" min="1" max="3" step="0.1" value="1" id="zoomSlider" />
          <span class="zoom-value">1x</span>
        </div>
        
        <!-- Tips overlay -->
        <div class="scanner-tips" id="scannerTips">
          <div class="tips-content">
            <h4>📸 Tips for best results</h4>
            <ul>
              <li>Ensure good lighting</li>
              <li>Hold steady - avoid blur</li>
              <li>Fill the frame with document</li>
              <li>Keep text parallel to edges</li>
            </ul>
            <button class="got-it-btn" id="gotItBtn">Got it</button>
          </div>
        </div>
      </div>
    `;

    // Bind events
    this.bindEvents();
    
    // Show tips on first use
    if (!localStorage.getItem('scannerTipsShown')) {
      document.getElementById('scannerTips').classList.add('show');
    }
  }

  /**
   * Bind UI events
   */
  bindEvents() {
    // Close button
    document.getElementById('closeScannerBtn')?.addEventListener('click', () => {
      this.close();
    });

    // Capture button
    document.getElementById('captureBtn')?.addEventListener('click', () => {
      this.capture();
    });

    // Flip camera
    document.getElementById('flipCameraBtn')?.addEventListener('click', () => {
      this.flipCamera();
    });

    // Retake
    document.getElementById('retakeBtn')?.addEventListener('click', () => {
      this.showScanner();
    });

    // Confirm
    document.getElementById('confirmBtn')?.addEventListener('click', () => {
      this.confirmCapture();
    });

    // Flash toggle
    document.getElementById('flashToggle')?.addEventListener('click', () => {
      this.toggleFlash();
    });

    // Zoom slider
    const zoomSlider = document.getElementById('zoomSlider');
    zoomSlider?.addEventListener('input', (e) => {
      this.setZoom(parseFloat(e.target.value));
    });

    // Got it button (tips)
    document.getElementById('gotItBtn')?.addEventListener('click', () => {
      localStorage.setItem('scannerTipsShown', 'true');
      document.getElementById('scannerTips')?.classList.remove('show');
    });

    // Touch gestures for focus
    const viewport = document.querySelector('.scanner-viewport');
    viewport?.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.setFocusPoint(e.touches[0].clientX, e.touches[0].clientY);
      }
    });

    // Double tap to focus
    let lastTap = 0;
    viewport?.addEventListener('touchend', (e) => {
      const currentTime = new Date().getTime();
      const tapLength = currentTime - lastTap;
      if (tapLength < 500 && tapLength > 0) {
        this.autoFocus();
      }
      lastTap = currentTime;
    });
  }

  /**
   * Process video frames for edge detection
   */
  startFrameProcessing() {
    if (!this.canvasElement) {
      this.canvasElement = document.getElementById('scannerCanvas');
    }
    
    const ctx = this.canvasElement.getContext('2d');
    
    const processFrame = () => {
      if (!this.isScanning || !this.videoElement) return;
      
      // Match canvas to video dimensions
      if (this.canvasElement.width !== this.videoElement.videoWidth) {
        this.canvasElement.width = this.videoElement.videoWidth;
        this.canvasElement.height = this.videoElement.videoHeight;
      }
      
      // Draw current frame
      ctx.drawImage(this.videoElement, 0, 0);
      
      requestAnimationFrame(processFrame);
    };
    
    requestAnimationFrame(processFrame);
  }

  /**
   * Capture image from video stream
   */
  capture() {
    if (!this.videoElement || !this.canvasElement) return;

    const ctx = this.canvasElement.getContext('2d');
    
    // Draw current frame
    ctx.drawImage(
      this.videoElement,
      0, 0,
      this.canvasElement.width,
      this.canvasElement.height
    );

    // Convert to blob
    this.canvasElement.toBlob((blob) => {
      this.capturedImage = blob;
      this.showPreview();
    }, 'image/jpeg', 0.95);
  }

  /**
   * Show captured preview
   */
  showPreview() {
    if (!this.capturedImage) return;

    const previewOverlay = document.getElementById('previewOverlay');
    const previewImage = document.getElementById('previewImage');
    const previewControls = document.getElementById('previewControls');
    const scannerControls = document.querySelector('.scanner-controls');

    const url = URL.createObjectURL(this.capturedImage);
    previewImage.src = url;
    
    previewOverlay.style.display = 'flex';
    previewControls.style.display = 'flex';
    scannerControls.style.display = 'none';
  }

  /**
   * Return to scanner view
   */
  showScanner() {
    const previewOverlay = document.getElementById('previewOverlay');
    const previewControls = document.getElementById('previewControls');
    const scannerControls = document.querySelector('.scanner-controls');

    previewOverlay.style.display = 'none';
    previewControls.style.display = 'none';
    scannerControls.style.display = 'flex';

    this.capturedImage = null;
  }

  /**
   * Confirm capture and return image
   */
  confirmCapture() {
    if (this.capturedImage && this.options.onCapture) {
      // Add metadata
      const imageFile = new File([this.capturedImage], `scan_${Date.now()}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now()
      });

      this.options.onCapture({
        file: imageFile,
        blob: this.capturedImage,
        width: this.canvasElement.width,
        height: this.canvasElement.height
      });
    }
  }

  /**
   * Flip between front and back camera
   */
  async flipCamera() {
    this.options.facingMode = this.options.facingMode === 'environment' 
      ? 'user' 
      : 'environment';
    
    // Restart with new camera
    await this.stop();
    
    const container = document.querySelector('.mobile-scanner').parentElement;
    const containerId = container.id;
    
    await this.initialize(containerId);
  }

  /**
   * Set focus point (if supported)
   */
  async setFocusPoint(x, y) {
    try {
      const track = this.stream?.getVideoTracks()[0];
      if (!track) return;

      const capabilities = track.getCapabilities();
      if (!capabilities.focusMode) return;

      // Show focus indicator
      const indicator = document.querySelector('.focus-indicator');
      indicator.style.left = `${x}px`;
      indicator.style.top = `${y}px`;
      indicator.classList.add('active');

      // Try to set focus (if supported)
      await track.applyConstraints({
        focusMode: 'manual'
      });

      setTimeout(() => {
        indicator.classList.remove('active');
      }, 1000);

    } catch (error) {
      console.log('Focus not supported');
    }
  }

  /**
   * Auto focus trigger
   */
  async autoFocus() {
    try {
      const track = this.stream?.getVideoTracks()[0];
      if (!track) return;

      const capabilities = track.getCapabilities();
      if (capabilities.focusMode?.includes('continuous')) {
        await track.applyConstraints({
          focusMode: 'continuous'
        });
      }
    } catch (error) {
      console.log('Auto focus not supported');
    }
  }

  /**
   * Toggle flash/torch (if supported)
   */
  async toggleFlash() {
    try {
      const track = this.stream?.getVideoTracks()[0];
      if (!track) return;

      const capabilities = track.getCapabilities();
      if (!capabilities.torch) {
        console.log('Flash not supported');
        return;
      }

      const settings = track.getSettings();
      const newTorch = !settings.torch;

      await track.applyConstraints({
        torch: newTorch
      });

      // Update UI
      const btn = document.getElementById('flashToggle');
      btn.classList.toggle('active', newTorch);

    } catch (error) {
      console.log('Flash toggle not supported');
    }
  }

  /**
   * Set zoom level (if supported)
   */
  async setZoom(level) {
    try {
      const track = this.stream?.getVideoTracks()[0];
      if (!track) return;

      const capabilities = track.getCapabilities();
      if (!capabilities.zoom) return;

      await track.applyConstraints({
        zoom: level
      });

      // Update display
      document.querySelector('.zoom-value').textContent = `${level.toFixed(1)}x`;

    } catch (error) {
      console.log('Zoom not supported');
    }
  }

  /**
   * Stop camera and cleanup
   */
  stop() {
    this.isScanning = false;
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }

  /**
   * Close scanner completely
   */
  close() {
    this.stop();
    
    const container = document.querySelector('.mobile-scanner')?.parentElement;
    if (container) {
      container.innerHTML = '';
    }
  }

  /**
   * Check if device has camera
   */
  static async hasCamera() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(device => device.kind === 'videoinput');
    } catch {
      return false;
    }
  }

  /**
   * Check permissions
   */
  static async checkPermission() {
    try {
      const result = await navigator.permissions.query({ name: 'camera' });
      return result.state;
    } catch {
      return 'prompt';
    }
  }
}

/**
 * Simple file picker fallback for devices without camera
 */
class FilePicker {
  constructor(options = {}) {
    this.options = {
      accept: 'image/*',
      onSelect: null,
      ...options
    };
  }

  /**
   * Open file picker
   */
  open() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = this.options.accept;
    input.capture = 'environment'; // Suggests camera on mobile
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file && this.options.onSelect) {
        this.options.onSelect(file);
      }
    };

    input.click();
  }
}

/**
 * Scanner Manager - Handles scanner lifecycle
 */
class ScannerManager {
  constructor() {
    this.currentScanner = null;
    this.containerId = null;
  }

  /**
   * Open scanner modal
   */
  async open(options = {}) {
    const {
      onCapture,
      onClose,
      containerId = 'scannerContainer'
    } = options;

    this.containerId = containerId;

    // Create modal if doesn't exist
    let container = document.getElementById(containerId);
    if (!container) {
      container = this.createModal(containerId);
    }

    container.style.display = 'block';
    document.body.style.overflow = 'hidden';

    try {
      // Check for camera
      const hasCamera = await MobileScanner.hasCamera();
      
      if (hasCamera) {
        // Use camera scanner
        this.currentScanner = new MobileScanner({
          onCapture: (result) => {
            onCapture?.(result);
            this.close();
          },
          onError: (error) => {
            console.error('Scanner error:', error);
            // Fallback to file picker
            this.fallbackToFilePicker(onCapture);
          }
        });

        await this.currentScanner.initialize(containerId);
      } else {
        // Fallback to file picker
        this.fallbackToFilePicker(onCapture);
      }

    } catch (error) {
      console.error('Failed to open scanner:', error);
      this.fallbackToFilePicker(onCapture);
    }
  }

  /**
   * Create scanner modal
   */
  createModal(containerId) {
    const modal = document.createElement('div');
    modal.id = containerId;
    modal.className = 'scanner-modal';
    document.body.appendChild(modal);
    return modal;
  }

  /**
   * Fallback to file picker
   */
  fallbackToFilePicker(onSelect) {
    const picker = new FilePicker({
      onSelect: (file) => {
        onSelect?.({
          file,
          blob: file,
          isFilePicker: true
        });
        this.close();
      }
    });

    picker.open();
  }

  /**
   * Close scanner
   */
  close() {
    this.currentScanner?.close();
    this.currentScanner = null;

    const container = document.getElementById(this.containerId);
    if (container) {
      container.style.display = 'none';
    }

    document.body.style.overflow = '';
  }
}

// Export classes
export { MobileScanner, FilePicker, ScannerManager };
export default ScannerManager;
