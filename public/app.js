/**
 * ============================================================================
 * AIMEX DISPATCH — MOBILE-FIRST CLIENT CONTROLLER
 * ============================================================================
 * Standardized Image Specs:
 *   - Tracking Slip: 1400px max edge, 0.82 JPEG (~120-210 KB, crisp barcode/text OCR)
 *   - Packaging:     960px max edge, 0.68 JPEG (~65-110 KB, fast upload)
 * All OCR runs on the host computer (POST /api/ocr).
 */

(function () {
  const STAFF_STORAGE_KEY = 'aimex_staff_name';

  const SLIP_IMAGE_SPEC = { maxDim: 1800, quality: 0.85 };
  const PACKAGING_IMAGE_SPEC = { maxDim: 960, quality: 0.68 };

  const DEFAULT_QUICK_ACCESS = [
    { sku: 'AIM8STAGE', name: '8 Stage Filter X 1' },
    { sku: 'AIMAA1', name: 'AA Filter X 1' },
    { sku: 'AIMG128STAGE', name: 'G12 With 3 8 Stage Filter' },
    null,
    null,
    null
  ];

  const state = {
    staffName: '',
    adminToken: '',
    config: {
      googleConnected: false,
      googleSheetUrl: '',
      ocrMode: 'auto',
      hasGeminiApiKey: false
    },
    networkInfo: null,
    productsCatalog: [],
    quickAccess: JSON.parse(JSON.stringify(DEFAULT_QUICK_ACCESS)),
    editingQuickSlots: false,
    activeQuickSlotIndex: 0,
    dispatches: [],
    trackingSlipBase64: null,
    packagingImagesBase64: []
  };

  const els = {};

  function initDomRefs() {
    const ids = [
      'loginScreen',
      'loginForm',
      'loginNameInput',
      'appShell',
      'switchUserBtn',
      'currentUserNameLabel',
      'googleStatusBtn',
      'googleStatusText',
      'openGoogleSheetLink',
      'wifiAccessBtn',
      'settingsBtn',
      'historyCountBadge',
      'productsCountBadge',
      'dispatchAlertBanner',
      'dispatchForm',
      'trackingSlipCameraInput',
      'trackingSlipFileInput',
      'trackingSlipPreviewContainer',
      'trackingSlipPreviewImg',
      'rescanSlipBtn',
      'removeSlipBtn',
      'ocrProgressBox',
      'ocrStatusText',
      'ocrPercentText',
      'ocrProgressBar',
      'ocrLowCertaintyNotice',
      'trackingSlipEmptyState',
      'orderNumberInput',
      'customerNameInput',
      'trackingNumberInput',
      'orderDateInput',
      'nameCertaintyWrap',
      'nameCertaintyText',
      'nameCertaintyFill',
      'trackingCertaintyWrap',
      'trackingCertaintyText',
      'trackingCertaintyFill',
      'quickAccessGrid',
      'toggleEditQuickBtn',
      'editSlotsLabel',
      'productRowsContainer',
      'syncProductsFromSheetBtn',
      'packagingCountBadge',
      'packagingCameraInput',
      'packagingFileInput',
      'packagingGallery',
      'packagingEmptyState',
      'orderCheckReminderNotice',
      'locationReminderNotice',
      'resetFormBtn',
      'submitDispatchBtn',
      'historySearchInput',
      'syncHistoryBtn',
      'dispatchesListContainer',
      'confirmDeleteModal',
      'confirmDeleteMsg',
      'confirmDeleteBtn',
      'addProductForm',
      'newProdSku',
      'newProdCategory',
      'newProdName',
      'refreshCatalogBtn',
      'catalogSearchInput',
      'catalogTableWrapper',
      'quickSlotModal',
      'quickSlotModalTitle',
      'quickSlotSearchInput',
      'quickSlotResults',
      'clearQuickSlotBtn',
      'settingsModal',
      'adminLoginGate',
      'adminLoginForm',
      'adminPasswordInput',
      'adminLoginError',
      'adminPanelBody',
      'adminPanelFooter',
      'dailyEmailEnabledInput',
      'dailyEmailAdminInput',
      'dailyEmailTimeInput',
      'previewDailySummaryBtn',
      'sendDailySummaryNowBtn',
      'dailyEmailStatusNote',
      'dailySummaryPreviewBox',
      'settingsGoogleScriptUrl',
      'testGoogleSheetBtn',
      'initGoogleSheetBtn',
      'copyAppsScriptBtn',
      'googleTestResultBox',
      'settingsOcrMode',
      'settingsGeminiApiKey',
      'testGeminiBtn',
      'geminiStatusNote',
      'newAdminPasswordInput',
      'changeAdminPasswordBtn',
      'adminPwResultBox',
      'checkUpdateBtn',
      'installUpdateBtn',
      'appUpdateResultBox',
      'saveSettingsBtn',
      'wifiModal',
      'wifiQrContainer',
      'wifiUrlsList',
      'lightboxModal',
      'lightboxTitle',
      'lightboxImg'
    ];
    ids.forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function getTodayIsoDate() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ==========================================================================
  // NATIVE <dialog> HELPERS & ACCESSIBLE :user-invalid VALIDATION BRIDGE
  // ==========================================================================

  function openModalDialog(dialogEl) {
    if (!dialogEl) return;
    if (!dialogEl.open && typeof dialogEl.showModal === 'function') {
      dialogEl.showModal();
    }
  }

  function closeModalDialog(dialogEl) {
    if (!dialogEl) return;
    if (dialogEl.open && typeof dialogEl.close === 'function') {
      dialogEl.close();
    }
  }

  function setupNativeDialogs() {
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const isOutside = (e, dialog) => {
        const card = dialog.querySelector('.modal-dialog') || dialog;
        const r = card.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
        let pressedOutside = false;
        dialog.addEventListener('pointerdown', (e) => {
          pressedOutside = isOutside(e, dialog);
        });
        dialog.addEventListener('pointerup', (e) => {
          if (pressedOutside && isOutside(e, dialog)) closeModalDialog(dialog);
        });
      }
    }
  }

  let syncAriaField = () => {};
  let resetFormValidation = () => {};

  function setupAccessibleValidation() {
    const supportsUserInvalid = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('selector(:user-invalid)');
    const announcer = document.createElement('div');
    announcer.setAttribute('aria-live', 'polite');
    announcer.classList.add('visually-hidden');
    document.body.append(announcer);

    let announceTimer;
    let announcedField;
    const dirtyState = new WeakMap();
    const flagged = new WeakSet();
    const announced = new WeakSet();

    const linkError = (el, shown) => {
      const errorId = el.dataset.error;
      if (!errorId) return;
      const ids = (el.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== errorId);
      if (shown) ids.push(errorId);
      if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
      else el.removeAttribute('aria-describedby');
    };

    const spokenText = (node) => {
      const copy = node.cloneNode(true);
      copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => n.replaceWith(`${n.getAttribute('aria-label')}: `));
      return copy.textContent.replace(/\s+/g, ' ').trim();
    };

    const announceError = (el) => {
      const error = document.getElementById(el.dataset.error);
      if (!error) return;
      const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : '';
      clearTimeout(announceTimer);
      announcer.textContent = '';
      announcedField = el;
      announceTimer = setTimeout(() => {
        announcer.textContent = label + spokenText(error);
      }, 500);
    };

    syncAriaField = (el, announce = false) => {
      if (!el?.matches?.('input, select, textarea') || !el.dataset.error) return;
      let isInvalid = false;
      if (supportsUserInvalid) {
        isInvalid = el.matches(':user-invalid');
      } else {
        const st = dirtyState.get(el);
        isInvalid = Boolean(st && st.hasBlurred && !el.validity.valid);
        el.classList.toggle('user-invalid-fallback', isInvalid);
      }

      if (isInvalid) {
        if (announce && !announced.has(el)) {
          announceError(el);
          announced.add(el);
        }
        el.setAttribute('aria-invalid', 'true');
        linkError(el, true);
        flagged.add(el);
      } else if (flagged.has(el) || el.getAttribute('aria-invalid') !== 'true') {
        el.setAttribute('aria-invalid', 'false');
        linkError(el, false);
        el.classList.remove('user-invalid-fallback');
        flagged.delete(el);
        announced.delete(el);
        if (announcedField === el) {
          clearTimeout(announceTimer);
          announcer.textContent = '';
        }
      }
    };

    resetFormValidation = (form) => {
      if (!form) return;
      for (const control of form.elements || []) {
        dirtyState.delete(control);
        flagged.delete(control);
        announced.delete(control);
        control.classList.remove('user-invalid-fallback');
        if (control.dataset?.error) {
          control.setAttribute('aria-invalid', 'false');
          linkError(control, false);
        }
      }
      clearTimeout(announceTimer);
      announcer.textContent = '';
    };

    document.querySelectorAll('input[data-error], select[data-error], textarea[data-error]').forEach((el) => {
      el.setAttribute('aria-invalid', 'false');
    });

    document.addEventListener(
      'blur',
      (e) => {
        const el = e.target;
        if (!el?.dataset?.error) return;
        const st = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
        st.hasBlurred = true;
        dirtyState.set(el, st);
        syncAriaField(el, true);
      },
      true
    );

    document.addEventListener('input', (e) => {
      const el = e.target;
      if (!el?.dataset?.error) return;
      const st = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
      st.hasInteracted = true;
      dirtyState.set(el, st);
      if (el.getAttribute('aria-invalid') === 'true' || el.classList.contains('user-invalid-fallback')) {
        syncAriaField(el, false);
      }
    });

    document.addEventListener(
      'invalid',
      (e) => {
        const el = e.target;
        if (!el?.dataset?.error) return;
        dirtyState.set(el, { hasInteracted: true, hasBlurred: true });
        announced.add(el);
        el.classList.add('user-invalid-fallback');
        el.setAttribute('aria-invalid', 'true');
        linkError(el, true);
        flagged.add(el);
      },
      true
    );
  }

  function validateFormAndFocus(form) {
    if (!form) return true;
    const controls = Array.from(form.elements || []).filter((el) => typeof el.checkValidity === 'function');
    let firstInvalid = null;
    for (const el of controls) {
      if (!el.checkValidity()) {
        if (!firstInvalid) firstInvalid = el;
      }
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return false;
    }
    return true;
  }

  // ==========================================================================
  // GOOGLE APPS SCRIPT CLIENT FALLBACK (USED WHEN HOST DNS IS RESTRICTED)
  // ==========================================================================

  function isHostNetworkFailure(msg) {
    const s = String(msg || '').toLowerCase();
    return (
      s.includes('enotfound') ||
      s.includes('eai_again') ||
      s.includes('econnreset') ||
      s.includes('econnrefused') ||
      s.includes('etimedout') ||
      s.includes('timed out') ||
      s.includes('getaddrinfo') ||
      s.includes('could not verify google apps script')
    );
  }

  async function callAppsScriptGet(scriptUrl, params = {}) {
    const url = new URL(scriptUrl);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const resp = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
    return await resp.json();
  }

  async function callAppsScriptPost(scriptUrl, payloadObj) {
    const resp = await fetch(scriptUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payloadObj)
    });
    return await resp.json();
  }

  async function syncClientResultToServer(payload) {
    try {
      await fetch('/api/google-sheet/client-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn('Client-sync cache warning:', e);
    }
  }

  async function fetchLocalImageAsDataUrl(localUrl) {
    const resp = await fetch(localUrl);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  async function initApp() {
    initDomRefs();
    setupNativeDialogs();
    setupAccessibleValidation();
    bindEvents();

    els.orderDateInput.value = getTodayIsoDate();
    addProductRow();
    renderQuickAccessGrid();

    const savedName = (localStorage.getItem(STAFF_STORAGE_KEY) || '').trim();
    if (savedName) {
      enterAppAsUser(savedName);
    } else {
      showLoginScreen();
    }
  }

  function showLoginScreen() {
    els.appShell.classList.add('hidden');
    els.loginScreen.classList.remove('hidden');
    setTimeout(() => els.loginNameInput.focus(), 50);
  }

  async function enterAppAsUser(name) {
    state.staffName = name.trim();
    localStorage.setItem(STAFF_STORAGE_KEY, state.staffName);
    els.currentUserNameLabel.textContent = state.staffName;

    els.loginScreen.classList.add('hidden');
    els.appShell.classList.remove('hidden');

    await Promise.all([
      loadConfigAndNetwork(),
      loadProductsCatalog(false),
      loadUserQuickAccess(),
      loadDispatches()
    ]);
  }

  function bindEvents() {
    els.loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validateFormAndFocus(els.loginForm)) return;
      const name = els.loginNameInput.value.trim();
      if (!name) return;
      enterAppAsUser(name);
    });

    els.switchUserBtn.addEventListener('click', () => {
      els.loginNameInput.value = state.staffName || '';
      showLoginScreen();
    });

    document.querySelectorAll('.seg-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-tab');
        document.querySelectorAll('.seg-tab').forEach((b) => {
          const isSelected = b === btn;
          b.classList.toggle('active', isSelected);
          b.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });
        document.querySelectorAll('.tab-panel').forEach((p) => {
          const isMatch = p.id === targetId;
          p.classList.toggle('active', isMatch);
          p.hidden = !isMatch;
        });
        if (targetId === 'historyTab') loadDispatches();
      });
    });

    els.settingsBtn.addEventListener('click', openSettingsModal);
    els.googleStatusBtn.addEventListener('click', openSettingsModal);
    els.wifiAccessBtn.addEventListener('click', openWifiModal);

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-close-modal');
        closeModalDialog(document.getElementById(modalId));
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.product-search-wrap')) {
        document.querySelectorAll('.product-dropdown').forEach((d) => d.classList.add('hidden'));
      }
    });

    // Clear certainty indicator if staff manually edits a field
    els.customerNameInput.addEventListener('input', () => clearCertaintyMeter('name'));
    els.trackingNumberInput.addEventListener('input', () => clearCertaintyMeter('tracking'));

    // Tracking Slip Capture
    els.trackingSlipCameraInput.addEventListener('change', handleTrackingSlipFileChange);
    els.trackingSlipFileInput.addEventListener('change', handleTrackingSlipFileChange);
    els.rescanSlipBtn.addEventListener('click', () => {
      if (state.trackingSlipBase64) runHostOcr(state.trackingSlipBase64);
    });
    els.removeSlipBtn.addEventListener('click', clearTrackingSlip);
    els.trackingSlipPreviewImg.addEventListener('click', () => {
      if (state.trackingSlipBase64) openLightbox(state.trackingSlipBase64, 'Tracking Slip');
    });

    // Quick Access 3x2 Grid
    els.toggleEditQuickBtn.addEventListener('click', () => {
      state.editingQuickSlots = !state.editingQuickSlots;
      els.toggleEditQuickBtn.classList.toggle('active', state.editingQuickSlots);
      if (els.editSlotsLabel) {
        els.editSlotsLabel.textContent = state.editingQuickSlots ? 'Done' : 'Edit';
      }
      renderQuickAccessGrid();
    });
    els.quickSlotSearchInput.addEventListener('input', renderQuickSlotModalList);
    els.clearQuickSlotBtn.addEventListener('click', () => assignQuickAccessSlot(null));

    // Order Number reminder & Products
    els.orderNumberInput?.addEventListener('input', updateOrderNumberReminder);
    els.syncProductsFromSheetBtn.addEventListener('click', () => loadProductsCatalog(true));

    // Compact sticky header on scroll (with wide hysteresis to prevent mobile layout jitter)
    const headerEl = document.querySelector('.app-header');
    if (headerEl) {
      let lastToggleAt = 0;
      window.addEventListener(
        'scroll',
        () => {
          const now = Date.now();
          if (now - lastToggleAt < 250) return;
          const y = window.scrollY || 0;
          if (y > 80 && !headerEl.classList.contains('is-scrolled')) {
            headerEl.classList.add('is-scrolled');
            lastToggleAt = now;
          } else if (y <= 8 && headerEl.classList.contains('is-scrolled')) {
            headerEl.classList.remove('is-scrolled');
            lastToggleAt = now;
          }
        },
        { passive: true }
      );
    }
    els.refreshCatalogBtn.addEventListener('click', () => loadProductsCatalog(true));
    els.catalogSearchInput.addEventListener('input', renderCatalogTable);
    els.addProductForm.addEventListener('submit', handleAddProductToCatalog);

    // Packaging Photos
    els.packagingCameraInput.addEventListener('change', handlePackagingFilesChange);
    els.packagingFileInput.addEventListener('change', handlePackagingFilesChange);

    // Form Submit & Clear
    els.dispatchForm.addEventListener('submit', handleSubmitDispatch);
    els.resetFormBtn.addEventListener('click', () => resetDispatchForm(true));

    // Search History & Sync
    els.historySearchInput.addEventListener('input', debounce(() => loadDispatches(false), 180));
    els.syncHistoryBtn.addEventListener('click', () => loadDispatches(true));
    els.confirmDeleteBtn.addEventListener('click', handleConfirmDeleteDispatch);

    // Admin Login & Settings Actions
    els.adminLoginForm.addEventListener('submit', handleAdminLogin);
    els.testGoogleSheetBtn.addEventListener('click', () => testOrInitGoogleSheet(false));
    els.initGoogleSheetBtn.addEventListener('click', () => testOrInitGoogleSheet(true));
    els.copyAppsScriptBtn.addEventListener('click', handleCopyAppsScript);
    els.previewDailySummaryBtn.addEventListener('click', handlePreviewDailySummary);
    els.sendDailySummaryNowBtn.addEventListener('click', handleSendDailySummaryNow);
    els.changeAdminPasswordBtn.addEventListener('click', handleChangeAdminPassword);
    els.testGeminiBtn?.addEventListener('click', handleTestGemini);
    els.checkUpdateBtn?.addEventListener('click', () => handleAppUpdate(false));
    els.installUpdateBtn?.addEventListener('click', () => handleAppUpdate(true));
    els.saveSettingsBtn.addEventListener('click', handleSaveSettings);
  }

  async function loadConfigAndNetwork() {
    try {
      const [cfgRes, netRes] = await Promise.all([
        fetch('/api/config').then((r) => r.json()),
        fetch('/api/network-info').then((r) => r.json())
      ]);
      if (cfgRes.success && cfgRes.config) state.config = cfgRes.config;
      if (netRes.success) state.networkInfo = netRes;
      updateHeaderIndicators();
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  }

  function updateHeaderIndicators() {
    const isConnected = Boolean(state.config.googleConnected);
    els.googleStatusBtn.className = isConnected
      ? 'header-chip status-connected'
      : 'header-chip status-unlinked';
    els.googleStatusText.textContent = isConnected ? 'Synced' : 'Setup';

    if (state.config.googleSheetUrl) {
      els.openGoogleSheetLink.href = state.config.googleSheetUrl;
      els.openGoogleSheetLink.classList.remove('hidden');
    } else {
      els.openGoogleSheetLink.classList.add('hidden');
    }

    updateOcrEngineBadge();
  }

  function updateOcrEngineBadge() {
    if (!els.ocrEngineBadge) return;
    const plat = state.networkInfo?.platform;
    const hostLabel = plat === 'win32' ? 'Windows Host OCR' : 'Host OCR';
    const gs = state.config.geminiStatus || {};
    const useGemini =
      Boolean(state.config.hasGeminiApiKey) &&
      (state.config.ocrMode === 'gemini' || state.config.ocrMode === 'auto');

    if (!useGemini) {
      els.ocrEngineBadge.textContent = hostLabel;
      return;
    }

    if (gs.state === 'fallback_quota') {
      els.ocrEngineBadge.textContent = `${hostLabel} (AI quota paused)`;
    } else {
      els.ocrEngineBadge.textContent = 'Gemini AI OCR';
    }
  }

  // ==========================================================================
  // STANDARDIZED IMAGE COMPRESSION & SHADOW-SAFE OCR NORMALIZATION
  // ==========================================================================

  function compressImageToDataUrl(imageSource, maxDimension, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Could not load image'));

      if (typeof imageSource === 'string') {
        img.src = imageSource;
      } else if (imageSource instanceof File || imageSource instanceof Blob) {
        const reader = new FileReader();
        reader.onload = (e) => {
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(imageSource);
      }
    });
  }

  /**
   * Morphological local-max illumination normalization + upscaling for harsh shadow/low-light photos.
   * Preserves dark barcodes while lifting shadows uniformly across the paper background.
   */
  function normalizeShadowForOcr(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const origMax = Math.max(img.width, img.height);
        let width = img.width;
        let height = img.height;
        if (origMax > 0 && origMax < 1600) {
          const targetMax = Math.min(2000, Math.round(origMax * 1.8));
          const scale = targetMax / origMax;
          width = Math.round(img.width * scale);
          height = Math.round(img.height * scale);
        }

        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = width;
        srcCanvas.height = height;
        const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
        srcCtx.imageSmoothingEnabled = true;
        srcCtx.imageSmoothingQuality = 'high';
        srcCtx.drawImage(img, 0, 0, width, height);

        const srcData = srcCtx.getImageData(0, 0, width, height);
        const p = srcData.data;

        // Build downscaled illumination grid using high-percentile local luminance so dark ink/barcodes don't drag bg down
        const blockSize = Math.max(16, Math.round(Math.max(width, height) / 48));
        const gridW = Math.max(8, Math.ceil(width / blockSize));
        const gridH = Math.max(8, Math.ceil(height / blockSize));
        const grid = new Float32Array(gridW * gridH);

        for (let gy = 0; gy < gridH; gy++) {
          const y0 = Math.floor((gy * height) / gridH);
          const y1 = Math.min(height, Math.floor(((gy + 1) * height) / gridH));
          for (let gx = 0; gx < gridW; gx++) {
            const x0 = Math.floor((gx * width) / gridW);
            const x1 = Math.min(width, Math.floor(((gx + 1) * width) / gridW));
            const samples = [];
            const stepY = Math.max(1, Math.floor((y1 - y0) / 6));
            const stepX = Math.max(1, Math.floor((x1 - x0) / 6));
            for (let y = y0; y < y1; y += stepY) {
              for (let x = x0; x < x1; x += stepX) {
                const idx = (y * width + x) * 4;
                samples.push(0.299 * p[idx] + 0.587 * p[idx + 1] + 0.114 * p[idx + 2]);
              }
            }
            if (samples.length === 0) {
              grid[gy * gridW + gx] = 200;
            } else {
              samples.sort((a, b) => a - b);
              const pIdx = Math.min(samples.length - 1, Math.floor(samples.length * 0.92));
              grid[gy * gridW + gx] = samples[pIdx];
            }
          }
        }

        // 3x3 morphological dilation (local max) on the grid
        const dilated = new Float32Array(gridW * gridH);
        for (let y = 0; y < gridH; y++) {
          for (let x = 0; x < gridW; x++) {
            let mx = 0;
            for (let dy = -1; dy <= 1; dy++) {
              const ny = Math.min(gridH - 1, Math.max(0, y + dy));
              for (let dx = -1; dx <= 1; dx++) {
                const nx = Math.min(gridW - 1, Math.max(0, x + dx));
                const v = grid[ny * gridW + nx];
                if (v > mx) mx = v;
              }
            }
            dilated[y * gridW + x] = mx;
          }
        }

        // 3x3 box smooth on the dilated background grid
        const bgCanvas = document.createElement('canvas');
        bgCanvas.width = gridW;
        bgCanvas.height = gridH;
        const bgCtx = bgCanvas.getContext('2d', { willReadFrequently: true });
        const bgSmall = bgCtx.createImageData(gridW, gridH);
        for (let y = 0; y < gridH; y++) {
          for (let x = 0; x < gridW; x++) {
            let sum = 0;
            let cnt = 0;
            for (let dy = -1; dy <= 1; dy++) {
              const ny = Math.min(gridH - 1, Math.max(0, y + dy));
              for (let dx = -1; dx <= 1; dx++) {
                const nx = Math.min(gridW - 1, Math.max(0, x + dx));
                sum += dilated[ny * gridW + nx];
                cnt++;
              }
            }
            const val = Math.round(sum / cnt);
            const idx = (y * gridW + x) * 4;
            bgSmall.data[idx] = val;
            bgSmall.data[idx + 1] = val;
            bgSmall.data[idx + 2] = val;
            bgSmall.data[idx + 3] = 255;
          }
        }
        bgCtx.putImageData(bgSmall, 0, 0);

        const bgFullCanvas = document.createElement('canvas');
        bgFullCanvas.width = width;
        bgFullCanvas.height = height;
        const bgFullCtx = bgFullCanvas.getContext('2d', { willReadFrequently: true });
        bgFullCtx.imageSmoothingEnabled = true;
        bgFullCtx.drawImage(bgCanvas, 0, 0, width, height);

        const b = bgFullCtx.getImageData(0, 0, width, height).data;

        for (let i = 0; i < p.length; i += 4) {
          const lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
          // Clamp bgLum >= 45 so deep warehouse shadows lift cleanly without dividing by zero
          const bgLum = Math.max(45, b[i]);
          const norm = Math.min(255, (lum / bgLum) * 242);
          let out = (norm - 155) * 1.45 + 175;
          out = out < 0 ? 0 : out > 255 ? 255 : out;
          p[i] = out;
          p[i + 1] = out;
          p[i + 2] = out;
        }

        srcCtx.putImageData(srcData, 0, 0);
        resolve(srcCanvas.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // ==========================================================================
  // HOST-SIDE OCR + CERTAINTY % METER
  // ==========================================================================

  async function handleTrackingSlipFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const standardizedSlip = await compressImageToDataUrl(
        file,
        SLIP_IMAGE_SPEC.maxDim,
        SLIP_IMAGE_SPEC.quality
      );
      setTrackingSlipImage(standardizedSlip);
      await runHostOcr(standardizedSlip);
    } catch (err) {
      showBanner('error', 'Failed to load tracking slip: ' + err.message);
    } finally {
      e.target.value = '';
    }
  }

  async function handleLoadSampleSlip() {
    try {
      const standardizedSlip = await compressImageToDataUrl(
        '/sample-slip.jpg',
        SLIP_IMAGE_SPEC.maxDim,
        SLIP_IMAGE_SPEC.quality
      );
      setTrackingSlipImage(standardizedSlip);
      await runHostOcr(standardizedSlip);
    } catch (err) {
      showBanner('error', 'Failed to load sample slip: ' + err.message);
    }
  }

  function setTrackingSlipImage(dataUrl) {
    state.trackingSlipBase64 = dataUrl;
    els.trackingSlipPreviewImg.src = dataUrl;
    els.trackingSlipPreviewContainer.classList.remove('hidden');
    els.trackingSlipEmptyState.classList.add('hidden');
    els.ocrLowCertaintyNotice.classList.add('hidden');
    updateLocationReminder();
  }

  function clearTrackingSlip() {
    state.trackingSlipBase64 = null;
    els.trackingSlipPreviewImg.src = '';
    els.trackingSlipPreviewContainer.classList.add('hidden');
    els.trackingSlipEmptyState.classList.remove('hidden');
    els.ocrProgressBox.classList.add('hidden');
    els.ocrLowCertaintyNotice.classList.add('hidden');
    clearCertaintyMeter('name');
    clearCertaintyMeter('tracking');
    updateLocationReminder();
  }

  async function runHostOcr(standardizedSlipDataUrl) {
    els.ocrProgressBox.classList.remove('hidden');
    els.ocrLowCertaintyNotice.classList.add('hidden');
    els.ocrStatusText.textContent = 'Reading label on host...';
    els.ocrPercentText.textContent = '';
    els.ocrProgressBar.className = 'ocr-progress';
    els.ocrProgressBar.removeAttribute('value');

    try {
      // Pass 1: Send crisp, unmodified image first (preserves barcode & dark ink edges)
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: standardizedSlipDataUrl })
      }).then((r) => r.json());

      if (!res.success) {
        throw new Error(res.error || 'Host OCR failed');
      }

      let extracted = res.extracted || {};
      let engineUsed = res.engine || 'host';
      let geminiFallbackReason = res.geminiFallbackReason || '';

      if (res.geminiStatus) {
        state.config.geminiStatus = res.geminiStatus;
        updateOcrEngineBadge();
      }

      // Pass 2: If a field is missing or uncertain (< 78%), retry with shadow normalization
      // Never burn another Gemini API call on Pass 2 if Pass 1 already tried Gemini
      const needsShadowRetry =
        !extracted.customerName ||
        !extracted.trackingNumber ||
        (Number(extracted.customerNameCertainty) || 0) < 78 ||
        (Number(extracted.trackingNumberCertainty) || 0) < 78;

      if (needsShadowRetry) {
        els.ocrStatusText.textContent = 'Enhancing shadows & re-checking on host...';
        const shadowNormalized = await normalizeShadowForOcr(standardizedSlipDataUrl);
        const res2 = await fetch('/api/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: shadowNormalized,
            skipGemini: engineUsed.startsWith('gemini')
          })
        }).then((r) => r.json());

        if (res2.geminiStatus) {
          state.config.geminiStatus = res2.geminiStatus;
          updateOcrEngineBadge();
        }
        if (res2.geminiFallbackReason && !geminiFallbackReason) {
          geminiFallbackReason = res2.geminiFallbackReason;
        }

        if (res2.success && res2.extracted) {
          const ex2 = res2.extracted;
          const pickName2 =
            (!extracted.customerName && Boolean(ex2.customerName)) ||
            (Number(ex2.customerNameCertainty) || 0) > (Number(extracted.customerNameCertainty) || 0);
          const pickTrack2 =
            (!extracted.trackingNumber && Boolean(ex2.trackingNumber)) ||
            (Number(ex2.trackingNumberCertainty) || 0) > (Number(extracted.trackingNumberCertainty) || 0);

          extracted = {
            customerName: pickName2 ? ex2.customerName : extracted.customerName,
            customerNameCertainty: pickName2 ? ex2.customerNameCertainty : extracted.customerNameCertainty,
            trackingNumber: pickTrack2 ? ex2.trackingNumber : extracted.trackingNumber,
            trackingNumberCertainty: pickTrack2 ? ex2.trackingNumberCertainty : extracted.trackingNumberCertainty,
            orderDate: extracted.orderDate || ex2.orderDate
          };
          if (pickName2 || pickTrack2) {
            engineUsed = `${engineUsed}+shadow`;
          }
        }
      }

      populateExtractedFields(extracted);

      const nameCert = Number(extracted.customerNameCertainty) || 0;
      const trackCert = Number(extracted.trackingNumberCertainty) || 0;

      updateCertaintyMeter('name', nameCert);
      updateCertaintyMeter('tracking', trackCert);

      const isLow = nameCert < 72 || trackCert < 72;
      els.ocrLowCertaintyNotice.classList.toggle('hidden', !isLow);

      els.ocrProgressBar.className = 'ocr-progress';
      els.ocrProgressBar.value = 100;
      const quotaSuffix =
        geminiFallbackReason && state.config.geminiStatus?.state === 'fallback_quota'
          ? ' — AI quota paused'
          : '';
      els.ocrStatusText.textContent =
        nameCert || trackCert
          ? `Extracted (${engineUsed}${quotaSuffix})`
          : 'Could not read label — retake photo or enter manually';
      els.ocrPercentText.textContent = nameCert || trackCert ? 'Done' : '';

      setTimeout(() => els.ocrProgressBox.classList.add('hidden'), 1400);
    } catch (err) {
      els.ocrProgressBar.className = 'ocr-progress';
      els.ocrProgressBar.value = 100;
      els.ocrStatusText.textContent = 'Host OCR error — enter fields manually';
      els.ocrPercentText.textContent = '';
    }
  }

  function updateCertaintyMeter(which, pct) {
    const wrap = which === 'name' ? els.nameCertaintyWrap : els.trackingCertaintyWrap;
    const textEl = which === 'name' ? els.nameCertaintyText : els.trackingCertaintyText;
    const fillEl = which === 'name' ? els.nameCertaintyFill : els.trackingCertaintyFill;

    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    const level = clamped >= 85 ? 'high' : clamped >= 65 ? 'med' : 'low';
    const label = clamped >= 85 ? `${clamped}%` : clamped >= 65 ? `${clamped}% Check` : `${clamped}% Low`;

    wrap.classList.remove('hidden');
    textEl.className = `certainty-pct ${level}`;
    textEl.textContent = label;
    fillEl.className = `certainty-progress ${level}`;
    fillEl.value = clamped;
  }

  function clearCertaintyMeter(which) {
    const wrap = which === 'name' ? els.nameCertaintyWrap : els.trackingCertaintyWrap;
    wrap.classList.add('hidden');
  }

  function populateExtractedFields(extracted) {
    const pairs = [
      { el: els.customerNameInput, val: extracted.customerName },
      { el: els.trackingNumberInput, val: extracted.trackingNumber },
      { el: els.orderDateInput, val: extracted.orderDate }
    ];

    pairs.forEach(({ el, val }) => {
      if (val && el) {
        el.value = val;
        syncAriaField(el, false);
        el.classList.add('field-autofilled');
        setTimeout(() => el.classList.remove('field-autofilled'), 2400);
      }
    });
  }

  // ==========================================================================
  // USER-SYNCED 3x2 QUICK ACCESS PRODUCT GRID
  // ==========================================================================

  async function loadUserQuickAccess() {
    if (!state.staffName) return;
    try {
      const res = await fetch(
        `/api/user-prefs?user=${encodeURIComponent(state.staffName)}`
      ).then((r) => r.json());
      if (res.success && Array.isArray(res.quickAccess)) {
        state.quickAccess = res.quickAccess;
        renderQuickAccessGrid();
      }
    } catch (err) {
      console.error('Failed to load user quick access:', err);
    }
  }

  async function saveUserQuickAccess() {
    if (!state.staffName) return;
    try {
      const res = await fetch('/api/user-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: state.staffName,
          quickAccess: state.quickAccess
        })
      }).then((r) => r.json());
      if (res.success && Array.isArray(res.quickAccess)) {
        state.quickAccess = res.quickAccess;
      }
    } catch (err) {
      console.error('Failed to save user quick access:', err);
    }
  }

  function renderQuickAccessGrid() {
    const slots = state.quickAccess.slice(0, 6);
    while (slots.length < 6) slots.push(null);

    els.quickAccessGrid.innerHTML = slots
      .map((item, idx) => {
        if (item && item.name) {
          return `
            <button type="button" class="quick-slot-btn filled ${state.editingQuickSlots ? 'editing' : ''}" data-quick-idx="${idx}">
              ${state.editingQuickSlots ? '<span class="quick-slot-edit-tag">Edit</span>' : ''}
              <span class="quick-slot-name">${escapeHtml(item.name)}</span>
              <span class="quick-slot-sku">${escapeHtml(item.sku || 'Custom')}</span>
            </button>
          `;
        }
        return `
          <button type="button" class="quick-slot-btn empty ${state.editingQuickSlots ? 'editing' : ''}" data-quick-idx="${idx}">
            <span>+ Slot ${idx + 1}</span>
          </button>
        `;
      })
      .join('');

    els.quickAccessGrid.querySelectorAll('[data-quick-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-quick-idx'), 10);
        const slotItem = state.quickAccess[idx];

        if (state.editingQuickSlots || !slotItem) {
          openQuickSlotModal(idx);
        } else {
          addOrIncrementProductInOrder(slotItem);
        }
      });
    });
  }

  function addOrIncrementProductInOrder(item) {
    const rows = Array.from(els.productRowsContainer.querySelectorAll('.product-row'));

    for (const row of rows) {
      const inp = row.querySelector('.product-name-input');
      const locInput = row.querySelector('.product-location-input');
      const rowSku = (inp.getAttribute('data-sku') || '').toLowerCase();
      const rowName = (inp.getAttribute('data-prod-name') || inp.value || '').trim().toLowerCase();
      if (
        (item.sku && rowSku && item.sku.toLowerCase() === rowSku) ||
        rowName === item.name.toLowerCase()
      ) {
        const qtyInput = row.querySelector('.qty-input');
        qtyInput.value = (parseInt(qtyInput.value, 10) || 1) + 1;
        updateTotalProductQty();
        inp.classList.add('field-autofilled');
        setTimeout(() => inp.classList.remove('field-autofilled'), 600);
        updateLocationReminder();
        if (locInput && !locInput.value.trim()) {
          locInput.focus();
        }
        return;
      }
    }

    for (const row of rows) {
      const inp = row.querySelector('.product-name-input');
      const locInput = row.querySelector('.product-location-input');
      if (!inp.value.trim()) {
        inp.value = item.sku ? `${item.name} (${item.sku})` : item.name;
        inp.setAttribute('data-sku', item.sku || '');
        inp.setAttribute('data-prod-name', item.name);
        row.querySelector('.qty-input').value = 1;
        updateTotalProductQty();
        inp.classList.add('field-autofilled');
        setTimeout(() => inp.classList.remove('field-autofilled'), 600);
        updateLocationReminder();
        if (locInput) locInput.focus();
        return;
      }
    }

    const added = addProductRow({ sku: item.sku || '', name: item.name, quantity: 1, location: '' });
    added?.querySelector('.product-location-input')?.focus();
  }

  function openQuickSlotModal(slotIndex) {
    state.activeQuickSlotIndex = slotIndex;
    els.quickSlotModalTitle.textContent = `Assign Quick Access Slot ${slotIndex + 1}`;
    els.quickSlotSearchInput.value = '';
    els.clearQuickSlotBtn.classList.toggle('hidden', !state.quickAccess[slotIndex]);
    renderQuickSlotModalList();
    openModalDialog(els.quickSlotModal);
    setTimeout(() => els.quickSlotSearchInput.focus(), 50);
  }

  function renderQuickSlotModalList() {
    const q = (els.quickSlotSearchInput.value || '').trim().toLowerCase();
    let matches = state.productsCatalog;
    if (q) {
      matches = matches
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.sku && p.sku.toLowerCase().includes(q))
        )
        .sort((a, b) => {
          const aStarts = a.sku.toLowerCase().startsWith(q) || a.name.toLowerCase().startsWith(q);
          const bStarts = b.sku.toLowerCase().startsWith(q) || b.name.toLowerCase().startsWith(q);
          return aStarts === bStarts ? 0 : aStarts ? -1 : 1;
        });
    }

    const top = matches.slice(0, 40);
    if (top.length === 0) {
      els.quickSlotResults.innerHTML = `<div style="padding:14px;font-size:13px;color:var(--ink-muted);">No matching products found.</div>`;
      return;
    }

    els.quickSlotResults.innerHTML = top
      .map(
        (p) => `
        <button type="button" class="product-option" data-slot-sku="${escapeHtml(p.sku)}" data-slot-name="${escapeHtml(p.name)}">
          <span class="prod-opt-name">${escapeHtml(p.name)}</span>
          <span class="prod-opt-sku">${escapeHtml(p.sku)}${p.category ? ' · ' + escapeHtml(p.category) : ''}</span>
        </button>
      `
      )
      .join('');

    els.quickSlotResults.querySelectorAll('[data-slot-name]').forEach((btn) => {
      btn.addEventListener('click', () => {
        assignQuickAccessSlot({
          sku: btn.getAttribute('data-slot-sku') || '',
          name: btn.getAttribute('data-slot-name') || ''
        });
      });
    });
  }

  async function assignQuickAccessSlot(productOrNull) {
    state.quickAccess[state.activeQuickSlotIndex] = productOrNull;
    closeModalDialog(els.quickSlotModal);
    renderQuickAccessGrid();
    await saveUserQuickAccess();
  }

  // ==========================================================================
  // SEARCHABLE PRODUCT ROWS
  // ==========================================================================

  function updateOrderNumberReminder() {
    if (!els.orderCheckReminderNotice || !els.orderNumberInput) return;
    const hasPackagingPhotos = state.packagingImagesBase64.length > 0;
    const hasOrderNumber = els.orderNumberInput.value.trim().length > 0;
    els.orderCheckReminderNotice.classList.toggle('hidden', !(hasPackagingPhotos && !hasOrderNumber));
  }

  function updateLocationReminder() {
    if (!els.locationReminderNotice || !els.productRowsContainer) return;
    const hasPictures = state.packagingImagesBase64.length > 0;
    if (!hasPictures) {
      els.locationReminderNotice.classList.add('hidden');
      return;
    }

    const rows = Array.from(els.productRowsContainer.querySelectorAll('.product-row'));
    const namedRows = rows.filter(
      (r) => (r.querySelector('.product-name-input')?.value || '').trim().length > 0
    );
    const hasMissingLocation =
      namedRows.length === 0
        ? true
        : namedRows.some((r) => !(r.querySelector('.product-location-input')?.value || '').trim());

    els.locationReminderNotice.classList.toggle('hidden', !hasMissingLocation);
  }

  function addProductRow(initial = { sku: '', name: '', quantity: 1, location: '' }) {
    const row = document.createElement('div');
    row.className = 'product-row';

    const displayVal =
      initial.sku && initial.name ? `${initial.name} (${initial.sku})` : initial.name || '';

    row.innerHTML = `
      <div class="product-search-wrap">
        <input
          type="text"
          class="product-name-input"
          placeholder="Search product or SKU..."
          value="${escapeHtml(displayVal)}"
          data-sku="${escapeHtml(initial.sku || '')}"
          data-prod-name="${escapeHtml(initial.name || '')}"
          autocomplete="off"
          enterkeyhint="next"
          required
        />
        <div class="product-dropdown hidden"></div>
      </div>
      <div class="product-location-wrap">
        <input
          type="text"
          class="product-location-input"
          placeholder="Location"
          aria-label="Location product was taken from"
          value="${escapeHtml(initial.location || '')}"
          autocomplete="off"
          enterkeyhint="done"
        />
      </div>
      <div class="qty-stepper">
        <button type="button" class="qty-btn qty-minus" aria-label="Decrease">-</button>
        <input
          type="number"
          class="qty-input"
          min="1"
          max="9999"
          value="${Math.max(1, Number(initial.quantity) || 1)}"
          required
        />
        <button type="button" class="qty-btn qty-plus" aria-label="Increase">+</button>
      </div>
      <button type="button" class="btn btn-outline remove-prod-btn" aria-label="Remove">&times;</button>
    `;

    const input = row.querySelector('.product-name-input');
    const locationInput = row.querySelector('.product-location-input');
    const dropdown = row.querySelector('.product-dropdown');
    const qtyInput = row.querySelector('.qty-input');
    const minusBtn = row.querySelector('.qty-minus');
    const plusBtn = row.querySelector('.qty-plus');
    const removeBtn = row.querySelector('.remove-prod-btn');

    function renderSuggestions(query) {
      const q = (query || '').trim().toLowerCase();
      let matches = state.productsCatalog;

      if (q) {
        matches = state.productsCatalog
          .filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              (p.sku && p.sku.toLowerCase().includes(q))
          )
          .sort((a, b) => {
            const aStarts =
              a.sku.toLowerCase().startsWith(q) || a.name.toLowerCase().startsWith(q);
            const bStarts =
              b.sku.toLowerCase().startsWith(q) || b.name.toLowerCase().startsWith(q);
            return aStarts === bStarts ? 0 : aStarts ? -1 : 1;
          });
      }

      const topMatches = matches.slice(0, 30);
      if (topMatches.length === 0) {
        dropdown.classList.add('hidden');
        return;
      }

      dropdown.innerHTML = topMatches
        .map(
          (p) => `
          <button type="button" class="product-option" data-pick-sku="${escapeHtml(p.sku)}" data-pick-name="${escapeHtml(p.name)}">
            <span class="prod-opt-name">${escapeHtml(p.name)}</span>
            <span class="prod-opt-sku">${escapeHtml(p.sku)}${p.category ? ' · ' + escapeHtml(p.category) : ''}</span>
          </button>
        `
        )
        .join('');

      dropdown.classList.remove('hidden');

      dropdown.querySelectorAll('.product-option').forEach((optBtn) => {
        optBtn.addEventListener('click', () => {
          const pickedSku = optBtn.getAttribute('data-pick-sku');
          const pickedName = optBtn.getAttribute('data-pick-name');
          input.value = pickedSku ? `${pickedName} (${pickedSku})` : pickedName;
          input.setAttribute('data-sku', pickedSku);
          input.setAttribute('data-prod-name', pickedName);
          dropdown.classList.add('hidden');
          updateLocationReminder();
          locationInput.focus();
        });
      });
    }

    input.addEventListener('focus', () => {
      document.querySelectorAll('.product-dropdown').forEach((d) => {
        if (d !== dropdown) d.classList.add('hidden');
      });
      renderSuggestions(input.value);
    });

    input.addEventListener('input', () => {
      input.setAttribute('data-sku', '');
      input.setAttribute('data-prod-name', '');
      renderSuggestions(input.value);
      updateLocationReminder();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && input.value.trim()) {
        e.preventDefault();
        dropdown.classList.add('hidden');
        locationInput.focus();
      }
    });

    locationInput.addEventListener('input', updateLocationReminder);

    minusBtn.addEventListener('click', () => {
      qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
      updateTotalProductQty();
    });

    plusBtn.addEventListener('click', () => {
      qtyInput.value = (parseInt(qtyInput.value, 10) || 1) + 1;
      updateTotalProductQty();
    });

    qtyInput.addEventListener('input', updateTotalProductQty);

    removeBtn.addEventListener('click', () => {
      if (els.productRowsContainer.children.length > 1) {
        row.remove();
      } else {
        input.value = '';
        input.setAttribute('data-sku', '');
        input.setAttribute('data-prod-name', '');
        locationInput.value = '';
        qtyInput.value = 1;
      }
      updateTotalProductQty();
      updateLocationReminder();
    });

    els.productRowsContainer.appendChild(row);
    updateTotalProductQty();
    updateLocationReminder();
    return row;
  }

  function updateTotalProductQty() {
    if (!els.totalProductsQtyBadge) return;
    let total = 0;
    els.productRowsContainer.querySelectorAll('.qty-input').forEach((inp) => {
      total += Math.max(0, parseInt(inp.value, 10) || 0);
    });
    els.totalProductsQtyBadge.textContent = String(total);
  }

  function collectPackedProducts() {
    const rows = Array.from(els.productRowsContainer.querySelectorAll('.product-row'));
    const result = [];

    rows.forEach((row) => {
      const inp = row.querySelector('.product-name-input');
      const rawVal = inp?.value.trim() || '';
      const qty = Math.max(1, parseInt(row.querySelector('.qty-input')?.value, 10) || 1);
      const location = (row.querySelector('.product-location-input')?.value || '').trim();
      if (!rawVal) return;

      const selectedSku = inp.getAttribute('data-sku') || '';
      const selectedName = inp.getAttribute('data-prod-name') || '';

      if (selectedName) {
        result.push({ sku: selectedSku, name: selectedName, quantity: qty, location });
      } else {
        const match = state.productsCatalog.find(
          (p) =>
            p.name.toLowerCase() === rawVal.toLowerCase() ||
            (p.sku && p.sku.toLowerCase() === rawVal.toLowerCase()) ||
            `${p.name} (${p.sku})`.toLowerCase() === rawVal.toLowerCase()
        );
        result.push({
          sku: match ? match.sku : '',
          name: match ? match.name : rawVal,
          quantity: qty,
          location
        });
      }
    });

    return result;
  }

  // ==========================================================================
  // PACKAGING PHOTOS (STANDARDIZED 960px @ 0.68)
  // ==========================================================================

  async function handlePackagingFilesChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    for (const file of files) {
      try {
        const compressed = await compressImageToDataUrl(
          file,
          PACKAGING_IMAGE_SPEC.maxDim,
          PACKAGING_IMAGE_SPEC.quality
        );
        state.packagingImagesBase64.push(compressed);
      } catch (err) {
        console.error('Packaging image error:', err);
      }
    }
    renderPackagingGallery();
    e.target.value = '';
  }

  function renderPackagingGallery() {
    const count = state.packagingImagesBase64.length;
    els.packagingCountBadge.textContent = `${count} photo${count === 1 ? '' : 's'}`;

    if (count === 0) {
      els.packagingGallery.classList.add('hidden');
      els.packagingEmptyState.classList.remove('hidden');
      els.packagingGallery.innerHTML = '';
      updateLocationReminder();
      updateOrderNumberReminder();
      return;
    }

    els.packagingGallery.classList.remove('hidden');
    els.packagingEmptyState.classList.add('hidden');
    updateLocationReminder();
    updateOrderNumberReminder();

    els.packagingGallery.innerHTML = state.packagingImagesBase64
      .map(
        (src, idx) => `
        <div class="thumb-card">
          <img src="${src}" alt="Packaging ${idx + 1}" data-lightbox-src="${src}" data-lightbox-title="Packaging Photo ${idx + 1}" />
          <button type="button" class="thumb-del" data-remove-pkg="${idx}" aria-label="Remove">&times;</button>
        </div>
      `
      )
      .join('');

    els.packagingGallery.querySelectorAll('[data-remove-pkg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-remove-pkg'), 10);
        state.packagingImagesBase64.splice(idx, 1);
        renderPackagingGallery();
      });
    });

    els.packagingGallery.querySelectorAll('[data-lightbox-src]').forEach((img) => {
      img.addEventListener('click', () => {
        openLightbox(img.getAttribute('data-lightbox-src'), img.getAttribute('data-lightbox-title'));
      });
    });
  }

  // ==========================================================================
  // SUBMIT DISPATCH
  // ==========================================================================

  async function handleSubmitDispatch(e) {
    e.preventDefault();

    if (!validateFormAndFocus(els.dispatchForm)) {
      showBanner('error', 'Please enter Customer Name, Tracking Number, and Order Date.');
      return;
    }

    const orderNumber = els.orderNumberInput.value.trim();
    const customerName = els.customerNameInput.value.trim();
    const trackingNumber = els.trackingNumberInput.value.trim();
    const orderDate = els.orderDateInput.value || getTodayIsoDate();
    const products = collectPackedProducts();

    if (!customerName || !trackingNumber) {
      showBanner('error', 'Please enter Customer Name and Tracking Number.');
      return;
    }

    if (products.length === 0) {
      showBanner('error', 'Please add at least one product and quantity.');
      return;
    }

    const origText = els.submitDispatchBtn.textContent;
    els.submitDispatchBtn.disabled = true;
    els.submitDispatchBtn.textContent = 'Saving...';

    const slipSnapshot = state.trackingSlipBase64;
    const packagingSnapshot = state.packagingImagesBase64.slice();

    try {
      const res = await fetch('/api/dispatches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber,
          customerName,
          trackingNumber,
          orderDate,
          staffName: state.staffName,
          products,
          trackingSlipImage: slipSnapshot,
          packagingImages: packagingSnapshot
        })
      }).then((r) => r.json());

      if (!res.success) {
        throw new Error(res.error || 'Failed to save dispatch');
      }

      const d = res.dispatch;
      if (d.syncStatus === 'pending_sync' && state.config.googleScriptUrl && isHostNetworkFailure(d.syncError)) {
        try {
          const gsRes = await callAppsScriptPost(state.config.googleScriptUrl, {
            action: 'createDispatch',
            dispatchId: d.dispatchId,
            orderNumber: d.orderNumber || '',
            orderDate: d.orderDate,
            trackingNumber: d.trackingNumber,
            customerName: d.customerName,
            staffName: d.staffName,
            products: d.products,
            trackingSlipImage: slipSnapshot || null,
            packagingImages: packagingSnapshot
          });
          if (gsRes && gsRes.success) {
            d.syncStatus = 'synced';
            d.syncError = null;
            await syncClientResultToServer({
              dispatchUpdate: {
                dispatchId: d.dispatchId,
                driveFolderUrl: gsRes.driveFolderUrl || '',
                trackingSlipDriveUrl: gsRes.trackingSlipUrl || '',
                packagingDriveUrls: gsRes.packagingImageUrls || [],
                sheetRowNumber: gsRes.rowNumber || null
              }
            });
          }
        } catch (fallbackErr) {
          console.warn('Browser dispatch sync fallback error:', fallbackErr);
        }
      }

      if (d.syncStatus === 'synced') {
        showBanner('success', `Saved ${d.trackingNumber} for ${d.customerName} and synced to Google Sheets.`);
      } else if (d.syncStatus === 'pending_sync') {
        showBanner('warning', `Saved locally (${d.dispatchId}). Google Sheets sync pending: ${d.syncError}`);
      } else {
        showBanner('success', `Saved locally (${d.dispatchId}). Connect Google Sheet in Admin Settings to auto-sync.`);
      }

      resetDispatchForm(false);
      await loadDispatches();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      showBanner('error', 'Save failed: ' + err.message);
    } finally {
      els.submitDispatchBtn.disabled = false;
      els.submitDispatchBtn.textContent = origText;
    }
  }

  function resetDispatchForm(clearBanner = true) {
    clearTrackingSlip();
    els.orderNumberInput.value = '';
    els.customerNameInput.value = '';
    els.trackingNumberInput.value = '';
    els.orderDateInput.value = getTodayIsoDate();
    els.productRowsContainer.innerHTML = '';
    addProductRow();
    state.packagingImagesBase64 = [];
    renderPackagingGallery();
    resetFormValidation(els.dispatchForm);
    updateOrderNumberReminder();
    if (clearBanner) els.dispatchAlertBanner.classList.add('hidden');
  }

  // ==========================================================================
  // PRODUCTS CATALOG
  // ==========================================================================

  async function loadProductsCatalog(syncWithGoogle = false) {
    try {
      const res = await fetch(`/api/products${syncWithGoogle ? '?sync=true' : ''}`).then((r) => r.json());
      if (res.success && Array.isArray(res.products)) {
        state.productsCatalog = res.products;

        if (syncWithGoogle && !res.syncedFromGoogle && state.config.googleScriptUrl) {
          try {
            const gsRes = await callAppsScriptGet(state.config.googleScriptUrl, { action: 'products' });
            if (gsRes && gsRes.success && Array.isArray(gsRes.products) && gsRes.products.length > 0) {
              state.productsCatalog = gsRes.products;
              await syncClientResultToServer({ products: gsRes.products });
            }
          } catch (fallbackErr) {
            console.warn('Browser product sync fallback error:', fallbackErr);
          }
        }

        els.productsCountBadge.textContent = String(state.productsCatalog.length);
        renderCatalogTable();
        if (syncWithGoogle) {
          showBanner('success', `Catalog synced (${state.productsCatalog.length} products).`);
        }
      }
    } catch (err) {
      console.error('Products load error:', err);
    }
  }

  function renderCatalogTable() {
    const q = (els.catalogSearchInput.value || '').trim().toLowerCase();
    const list = q
      ? state.productsCatalog.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.sku && p.sku.toLowerCase().includes(q)) ||
            (p.category && p.category.toLowerCase().includes(q))
        )
      : state.productsCatalog;

    if (list.length === 0) {
      els.catalogTableWrapper.innerHTML = `<p class="card-sub">No matching products found.</p>`;
      return;
    }

    els.catalogTableWrapper.innerHTML = `
      <table class="catalog-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Product</th>
            <th>Category</th>
          </tr>
        </thead>
        <tbody>
          ${list
            .map(
              (p) => `
            <tr>
              <td class="mono">${escapeHtml(p.sku || '-')}</td>
              <td>${escapeHtml(p.name)}</td>
              <td>${escapeHtml(p.category || 'General')}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `;
  }

  async function handleAddProductToCatalog(e) {
    e.preventDefault();
    if (!validateFormAndFocus(els.addProductForm)) return;
    const sku = els.newProdSku.value.trim();
    const category = els.newProdCategory.value.trim();
    const name = els.newProdName.value.trim();
    if (!name) return;

    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, category, name })
      }).then((r) => r.json());

      if (res.success) {
        let productsList = res.products || [];
        if (!res.pushedToGoogle && state.config.googleScriptUrl && res.product) {
          try {
            const gsRes = await callAppsScriptPost(state.config.googleScriptUrl, {
              action: 'addProduct',
              ...res.product
            });
            if (gsRes && gsRes.success && Array.isArray(gsRes.products)) {
              productsList = gsRes.products;
              await syncClientResultToServer({ products: gsRes.products });
            }
          } catch (fallbackErr) {
            console.warn('Browser addProduct fallback error:', fallbackErr);
          }
        }
        state.productsCatalog = productsList;
        els.productsCountBadge.textContent = String(state.productsCatalog.length);
        renderCatalogTable();
        els.newProdSku.value = '';
        els.newProdCategory.value = '';
        els.newProdName.value = '';
        resetFormValidation(els.addProductForm);
      }
    } catch (err) {
      alert('Failed to add product: ' + err.message);
    }
  }

  // ==========================================================================
  // DISPATCH HISTORY
  // ==========================================================================

  async function loadDispatches(syncWithGoogle = false) {
    const origSyncText = els.syncHistoryBtn?.textContent || 'Sync Sheet';
    if (syncWithGoogle && els.syncHistoryBtn) {
      els.syncHistoryBtn.disabled = true;
      els.syncHistoryBtn.textContent = 'Syncing...';
    }
    try {
      const q = els.historySearchInput.value.trim();
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (syncWithGoogle) params.set('sync', 'true');

      const res = await fetch(`/api/dispatches?${params.toString()}`).then((r) => r.json());
      if (!res.success) return;

      state.dispatches = res.dispatches || [];
      if (syncWithGoogle && !res.syncedFromGoogle && state.config.googleScriptUrl) {
        try {
          const gsRes = await callAppsScriptGet(state.config.googleScriptUrl, {
            action: 'search',
            limit: '200'
          });
          if (gsRes && gsRes.success && Array.isArray(gsRes.dispatches)) {
            const localById = new Map(state.dispatches.map((d) => [d.dispatchId, d]));
            const merged = state.dispatches.filter((d) => d.syncStatus !== 'synced');
            const seen = new Set(merged.map((d) => d.dispatchId));
            for (const remote of gsRes.dispatches) {
              if (!remote?.dispatchId || seen.has(remote.dispatchId)) continue;
              seen.add(remote.dispatchId);
              const existing = localById.get(remote.dispatchId);
              merged.push(
                existing
                  ? { ...existing, syncStatus: 'synced', driveFolderUrl: remote.driveFolderUrl || existing.driveFolderUrl || '' }
                  : {
                      dispatchId: remote.dispatchId,
                      timestamp: remote.timestamp || '',
                      orderDate: remote.orderDate || '',
                      trackingNumber: remote.trackingNumber || '',
                      customerName: remote.customerName || '',
                      staffName: remote.staffName || '',
                      products: Array.isArray(remote.products) ? remote.products : [],
                      totalQty: Number(remote.totalQty) || 0,
                      localTrackingSlipUrl: null,
                      localPackagingUrls: [],
                      syncStatus: 'synced',
                      driveFolderUrl: remote.driveFolderUrl || ''
                    }
              );
            }
            state.dispatches = merged;
          }
        } catch (fallbackErr) {
          console.warn('Browser history sync fallback error:', fallbackErr);
        }
      }

      els.historyCountBadge.textContent = String(res.total ?? state.dispatches.length);
      renderDispatchesList();
    } catch (err) {
      console.error('Failed to load dispatches:', err);
    } finally {
      if (syncWithGoogle && els.syncHistoryBtn) {
        els.syncHistoryBtn.disabled = false;
        els.syncHistoryBtn.textContent = origSyncText;
      }
    }
  }

  function renderDispatchesList() {
    const list = state.dispatches;
    if (list.length === 0) {
      els.dispatchesListContainer.innerHTML = `<div class="empty-box">No dispatches logged yet.</div>`;
      return;
    }

    els.dispatchesListContainer.innerHTML = list
      .map((d) => {
        const isSynced = d.syncStatus === 'synced';
        const syncPill = isSynced
          ? `<span class="sync-pill ok">Synced</span>`
          : `<span class="sync-pill pending">Local</span>`;

        const productsText = Array.isArray(d.products)
          ? d.products
              .map(
                (p) =>
                  `${p.quantity}x ${p.sku ? `[${escapeHtml(p.sku)}] ` : ''}${escapeHtml(p.name)}${
                    p.location ? ` (Loc: ${escapeHtml(p.location)})` : ''
                  }`
              )
              .join(', ')
          : '';

        const thumbs = [];
        if (d.localTrackingSlipUrl) {
          thumbs.push(
            `<img src="${escapeHtml(d.localTrackingSlipUrl)}" class="mini-thumb" alt="Slip" data-lightbox-src="${escapeHtml(d.localTrackingSlipUrl)}" data-lightbox-title="Tracking Slip" />`
          );
        }
        if (Array.isArray(d.localPackagingUrls)) {
          d.localPackagingUrls.forEach((u, idx) => {
            thumbs.push(
              `<img src="${escapeHtml(u)}" class="mini-thumb" alt="Packaging" data-lightbox-src="${escapeHtml(u)}" data-lightbox-title="Packaging Photo ${idx + 1}" />`
            );
          });
        }

        const retryBtn = !isSynced
          ? `<button type="button" class="btn btn-xs btn-outline" data-sync-id="${escapeHtml(d.dispatchId)}">Sync</button>`
          : '';

        const driveLink = d.driveFolderUrl
          ? `<a href="${escapeHtml(d.driveFolderUrl)}" target="_blank" rel="noopener" class="btn btn-xs btn-outline">Drive</a>`
          : '';

        const deleteBtn = `<button type="button" class="btn btn-xs btn-outline" data-delete-id="${escapeHtml(d.dispatchId)}" data-delete-label="${escapeHtml(d.customerName || d.trackingNumber || d.dispatchId)}">Remove</button>`;

        return `
          <div class="history-item">
            <div class="history-top">
              <span class="history-customer">${escapeHtml(d.customerName || 'Unknown')}</span>
              <div class="history-top-meta">
                <span class="mono history-tracking">${escapeHtml(d.trackingNumber || d.connote || '')}</span>
                ${syncPill}
              </div>
            </div>
            <div class="history-meta">
              <div>${d.orderNumber ? `<strong>Order #:</strong> <span class="mono">${escapeHtml(d.orderNumber)}</span> &middot; ` : ''}<strong>Order Date:</strong> ${escapeHtml(d.orderDate || '-')} &middot; <strong>Staff:</strong> ${escapeHtml(d.staffName || d.staffMember || '-')}</div>
              <div><strong>Items (${d.totalQty || 0}):</strong> ${productsText || '-'}</div>
            </div>
            <div class="history-thumbs">${thumbs.join('')}${driveLink}${retryBtn}${deleteBtn}</div>
          </div>
        `;
      })
      .join('');

    els.dispatchesListContainer.querySelectorAll('[data-lightbox-src]').forEach((img) => {
      img.addEventListener('click', () => {
        openLightbox(img.getAttribute('data-lightbox-src'), img.getAttribute('data-lightbox-title'));
      });
    });

    els.dispatchesListContainer.querySelectorAll('[data-delete-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.pendingDeleteId = btn.getAttribute('data-delete-id');
        const label = btn.getAttribute('data-delete-label') || state.pendingDeleteId;
        els.confirmDeleteMsg.textContent = `Remove "${label}" (${state.pendingDeleteId}) from local history and delete its row from the connected Google Sheet?`;
        openModalDialog(els.confirmDeleteModal);
      });
    });

    els.dispatchesListContainer.querySelectorAll('[data-sync-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-sync-id');
        btn.disabled = true;
        btn.textContent = 'Syncing...';
        try {
          const res = await fetch(`/api/dispatches/${encodeURIComponent(id)}/sync`, { method: 'POST' }).then((r) => r.json());
          if (!res.success && state.config.googleScriptUrl && isHostNetworkFailure(res.error)) {
            const record = state.dispatches.find((item) => item.dispatchId === id);
            if (record) {
              const slipB64 = record.localTrackingSlipUrl
                ? await fetchLocalImageAsDataUrl(record.localTrackingSlipUrl)
                : null;
              const pkgB64 = [];
              for (const u of record.localPackagingUrls || []) {
                const imgData = await fetchLocalImageAsDataUrl(u);
                if (imgData) pkgB64.push(imgData);
              }
              const gsRes = await callAppsScriptPost(state.config.googleScriptUrl, {
                action: 'createDispatch',
                dispatchId: record.dispatchId,
                orderNumber: record.orderNumber || '',
                orderDate: record.orderDate || '',
                trackingNumber: record.trackingNumber || record.connote || '',
                customerName: record.customerName || '',
                staffName: record.staffName || record.staffMember || '',
                products: record.products || [],
                trackingSlipImage: slipB64,
                packagingImages: pkgB64
              });
              if (gsRes && gsRes.success) {
                await syncClientResultToServer({
                  dispatchUpdate: {
                    dispatchId: record.dispatchId,
                    driveFolderUrl: gsRes.driveFolderUrl || '',
                    trackingSlipDriveUrl: gsRes.trackingSlipUrl || '',
                    packagingDriveUrls: gsRes.packagingImageUrls || [],
                    sheetRowNumber: gsRes.rowNumber || null
                  }
                });
                await loadDispatches();
                return;
              }
            }
          }
          if (!res.success) alert(res.error || 'Sync failed');
          await loadDispatches();
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
          btn.textContent = 'Sync';
        }
      });
    });
  }

  async function handleConfirmDeleteDispatch() {
    const id = state.pendingDeleteId;
    if (!id) return;
    const origText = els.confirmDeleteBtn.textContent;
    els.confirmDeleteBtn.disabled = true;
    els.confirmDeleteBtn.textContent = 'Deleting...';

    try {
      const res = await fetch(`/api/dispatches/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => r.json());
      if (!res.success) throw new Error(res.error || 'Delete failed');

      if (!res.sheetDeleted && res.sheetError && state.config.googleScriptUrl && isHostNetworkFailure(res.sheetError)) {
        try {
          await callAppsScriptPost(state.config.googleScriptUrl, {
            action: 'deleteDispatch',
            dispatchId: id
          });
        } catch (fallbackErr) {
          console.warn('Browser delete fallback error:', fallbackErr);
        }
      }

      state.pendingDeleteId = null;
      closeModalDialog(els.confirmDeleteModal);
      await loadDispatches(false);
    } catch (err) {
      alert('Failed to delete dispatch: ' + err.message);
    } finally {
      els.confirmDeleteBtn.disabled = false;
      els.confirmDeleteBtn.textContent = origText;
    }
  }

  // ==========================================================================
  // ADMIN AUTH & SETTINGS MODAL
  // ==========================================================================

  async function adminFetch(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        'X-Admin-Token': state.adminToken
      }
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      if (text.includes('<!DOCTYPE') || text.includes('<html')) {
        throw new Error(
          'Server returned an outdated web page instead of JSON. The host server must be restarted to apply new routes (close and re-run start-dispatch-server.bat, or click "Install Update & Restart").'
        );
      }
      throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
    }
    return json;
  }

  async function openSettingsModal() {
    openModalDialog(els.settingsModal);
    els.adminLoginError.classList.add('hidden');
    els.googleTestResultBox.classList.add('hidden');
    els.dailyEmailStatusNote.classList.add('hidden');
    els.dailySummaryPreviewBox.classList.add('hidden');
    els.adminPwResultBox.classList.add('hidden');

    if (state.adminToken) {
      const ok = await loadAdminPanelData();
      if (ok) {
        els.adminLoginGate.classList.add('hidden');
        els.adminPanelBody.classList.remove('hidden');
        els.adminPanelFooter.classList.remove('hidden');
        return;
      }
      state.adminToken = '';
    }

    els.adminLoginGate.classList.remove('hidden');
    els.adminPanelBody.classList.add('hidden');
    els.adminPanelFooter.classList.add('hidden');
    els.adminPasswordInput.value = '';
    resetFormValidation(els.adminLoginForm);
    setTimeout(() => els.adminPasswordInput.focus(), 50);
  }

  async function handleAdminLogin(e) {
    e.preventDefault();
    if (!validateFormAndFocus(els.adminLoginForm)) return;
    const password = els.adminPasswordInput.value;
    els.adminLoginError.classList.add('hidden');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      }).then((r) => r.json());

      if (!res.success || !res.token) {
        els.adminLoginError.textContent = res.error || 'Invalid password.';
        els.adminLoginError.classList.remove('hidden');
        return;
      }

      state.adminToken = res.token;
      await loadAdminPanelData();
      els.adminLoginGate.classList.add('hidden');
      els.adminPanelBody.classList.remove('hidden');
      els.adminPanelFooter.classList.remove('hidden');
    } catch (err) {
      els.adminLoginError.textContent = err.message;
      els.adminLoginError.classList.remove('hidden');
    }
  }

  async function loadAdminPanelData() {
    try {
      const res = await adminFetch('/api/admin/config');
      if (!res.success) return false;

      const c = res.config;
      els.settingsGoogleScriptUrl.value = c.googleScriptUrl || '';
      els.settingsOcrMode.value = c.ocrMode || 'auto';
      els.settingsGeminiApiKey.value = c.geminiApiKeyMasked || '';

      if (els.geminiStatusNote) {
        const gs = c.geminiStatus || {};
        if (c.hasGeminiApiKey && gs.state === 'fallback_quota') {
          els.geminiStatusNote.classList.remove('hidden');
          els.geminiStatusNote.style.background = '#fef2f2';
          els.geminiStatusNote.style.color = '#991b1b';
          els.geminiStatusNote.textContent = gs.reason || 'Gemini quota exhausted — reverted to Host OCR.';
        } else if (c.hasGeminiApiKey && gs.state === 'active' && gs.activeModel && gs.activeModel !== 'auto') {
          els.geminiStatusNote.classList.remove('hidden');
          els.geminiStatusNote.style.background = '#ecfdf5';
          els.geminiStatusNote.style.color = '#065f46';
          els.geminiStatusNote.textContent = `Gemini active (${gs.activeModel}). Automatically falls back to Host OCR if credits run out.`;
        } else {
          els.geminiStatusNote.classList.add('hidden');
        }
      }

      const de = c.dailyEmail || {};
      els.dailyEmailEnabledInput.checked = de.enabled !== false;
      els.dailyEmailAdminInput.value = de.adminEmail || '';
      els.dailyEmailTimeInput.value = de.time || '15:00';

      if (de.lastSentDate || de.lastSentError) {
        els.dailyEmailStatusNote.classList.remove('hidden');
        els.dailyEmailStatusNote.style.background = de.lastSentError ? '#fef2f2' : '#f1f5f9';
        els.dailyEmailStatusNote.style.color = de.lastSentError ? '#991b1b' : '#334155';
        els.dailyEmailStatusNote.textContent = de.lastSentError
          ? `Last error: ${de.lastSentError}`
          : `Last sent: ${de.lastSentDate} (${de.lastSentStatus || 'OK'})`;
      }

      return true;
    } catch (err) {
      return false;
    }
  }

  async function handlePreviewDailySummary() {
    els.dailySummaryPreviewBox.classList.remove('hidden');
    els.dailySummaryPreviewBox.textContent = 'Loading today\'s totals...';

    try {
      const res = await adminFetch('/api/admin/daily-summary');
      if (!res.success) {
        els.dailySummaryPreviewBox.textContent = res.error || 'Failed to load summary.';
        return;
      }
      const s = res.summary;
      const rows = Array.isArray(s.entries) && s.entries.length > 0 ? s.entries : s.products || [];
      if (rows.length === 0) {
        els.dailySummaryPreviewBox.innerHTML = `<strong>${escapeHtml(s.date)}</strong>: 0 products packaged today.`;
        return;
      }
      els.dailySummaryPreviewBox.innerHTML = `
        <div style="margin-bottom:6px;"><strong>${escapeHtml(s.date)}</strong> — ${s.totalOrders} orders, ${s.totalUnits} total units</div>
        <table class="catalog-table">
          <thead><tr><th>Time</th><th>Product</th><th style="text-align:right;">Qty</th><th>Location</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (r) =>
                  `<tr><td class="mono">${escapeHtml(r.time || '-')}</td><td>${escapeHtml(r.name)}${
                    r.sku ? ` <span class="mono">(${escapeHtml(r.sku)})</span>` : ''
                  }</td><td style="text-align:right;font-weight:700;">${r.quantity}</td><td>${escapeHtml(r.location || '-')}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      els.dailySummaryPreviewBox.textContent = err.message;
    }
  }

  async function handleSendDailySummaryNow() {
    // Save current admin email/time settings first so send uses latest email
    await handleSaveSettings(false);
    els.dailyEmailStatusNote.classList.remove('hidden');
    els.dailyEmailStatusNote.style.background = '#f1f5f9';
    els.dailyEmailStatusNote.style.color = '#334155';
    els.dailyEmailStatusNote.textContent = 'Sending daily summary email...';

    try {
      const res = await adminFetch('/api/admin/send-daily-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.success && isHostNetworkFailure(res.error) && res.summary && res.adminEmail) {
        const scriptUrl = els.settingsGoogleScriptUrl.value.trim() || state.config.googleScriptUrl;
        if (scriptUrl) {
          const gsRes = await callAppsScriptPost(scriptUrl, {
            action: 'sendDailySummary',
            adminEmail: res.adminEmail,
            date: res.date,
            summary: res.summary
          });
          if (gsRes && gsRes.success) {
            await syncClientResultToServer({
              dailySummarySent: {
                date: res.date,
                status: `Sent via browser (${res.summary.totalUnits} units)`
              }
            });
            els.dailyEmailStatusNote.style.background = '#ecfdf5';
            els.dailyEmailStatusNote.style.color = '#065f46';
            els.dailyEmailStatusNote.textContent = `Summary sent to ${res.adminEmail} (${res.summary.totalUnits} units).`;
            return;
          }
        }
      }
      if (!res.success) {
        els.dailyEmailStatusNote.style.background = '#fef2f2';
        els.dailyEmailStatusNote.style.color = '#991b1b';
        els.dailyEmailStatusNote.textContent = res.error || 'Failed to send email.';
        return;
      }
      els.dailyEmailStatusNote.style.background = '#ecfdf5';
      els.dailyEmailStatusNote.style.color = '#065f46';
      els.dailyEmailStatusNote.textContent = `Summary sent to ${res.sentTo} (${res.summary.totalUnits} units).`;
    } catch (err) {
      els.dailyEmailStatusNote.style.background = '#fef2f2';
      els.dailyEmailStatusNote.style.color = '#991b1b';
      els.dailyEmailStatusNote.textContent = err.message;
    }
  }

  async function handleCopyAppsScript() {
    try {
      const res = await adminFetch('/api/apps-script-code');
      if (!res.success || !res.code) throw new Error('Could not fetch Code.gs');
      await navigator.clipboard.writeText(res.code);
      showTestResult('success', 'Copied Code.gs to clipboard! Paste into Google Sheet -> Extensions -> Apps Script.');
    } catch (err) {
      showTestResult('error', 'Clipboard copy failed — open google-apps-script/Code.gs directly.');
    }
  }

  async function testOrInitGoogleSheet(initSheet = false) {
    const scriptUrl = els.settingsGoogleScriptUrl.value.trim();
    if (!scriptUrl) {
      showTestResult('error', 'Enter Google Apps Script Web App URL first.');
      return;
    }
    showTestResult('info', initSheet ? 'Formatting Google Sheet tabs...' : 'Testing connection...');

    try {
      let res = await adminFetch('/api/google-sheet/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googleScriptUrl: scriptUrl, initSheet })
      });

      if (!res.success && isHostNetworkFailure(res.error)) {
        try {
          const gsRes = await callAppsScriptGet(scriptUrl, { action: initSheet ? 'init' : 'ping' });
          if (gsRes && gsRes.success) {
            await syncClientResultToServer({
              googleScriptUrl: scriptUrl,
              googleSheetUrl: gsRes.spreadsheetUrl || '',
              products: Array.isArray(gsRes.products) ? gsRes.products : []
            });
            res = gsRes;
          }
        } catch (fallbackErr) {
          console.warn('Browser Apps Script test fallback failed:', fallbackErr);
        }
      }

      if (!res.success) {
        showTestResult('error', res.error || 'Connection failed');
        return;
      }

      showTestResult(
        'success',
        `Connected to "${res.spreadsheetName || 'Google Sheet'}"${initSheet ? ' and initialized tabs.' : '.'}`
      );
      await loadConfigAndNetwork();
      await loadProductsCatalog(false);
    } catch (err) {
      showTestResult('error', err.message);
    }
  }

  function showTestResult(type, msg) {
    els.googleTestResultBox.classList.remove('hidden');
    els.googleTestResultBox.style.background =
      type === 'success' ? '#ecfdf5' : type === 'error' ? '#fef2f2' : '#f1f5f9';
    els.googleTestResultBox.style.color =
      type === 'success' ? '#065f46' : type === 'error' ? '#991b1b' : '#334155';
    els.googleTestResultBox.textContent = msg;
  }

  async function handleChangeAdminPassword() {
    const newPassword = els.newAdminPasswordInput.value.trim();
    els.adminPwResultBox.classList.remove('hidden');
    if (newPassword.length < 4) {
      els.adminPwResultBox.style.background = '#fef2f2';
      els.adminPwResultBox.style.color = '#991b1b';
      els.adminPwResultBox.textContent = 'Password must be at least 4 characters.';
      return;
    }
    try {
      const res = await adminFetch('/api/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });
      if (!res.success) throw new Error(res.error);
      els.newAdminPasswordInput.value = '';
      els.adminPwResultBox.style.background = '#ecfdf5';
      els.adminPwResultBox.style.color = '#065f46';
      els.adminPwResultBox.textContent = 'Admin password updated.';
    } catch (err) {
      els.adminPwResultBox.style.background = '#fef2f2';
      els.adminPwResultBox.style.color = '#991b1b';
      els.adminPwResultBox.textContent = err.message;
    }
  }

  async function handleTestGemini() {
    if (!els.geminiStatusNote) return;
    els.geminiStatusNote.classList.remove('hidden');
    els.geminiStatusNote.style.background = '#f1f5f9';
    els.geminiStatusNote.style.color = '#334155';
    els.geminiStatusNote.textContent = 'Discovering & testing latest Gemini model...';

    const rawKey = (els.settingsGeminiApiKey?.value || '').trim();
    try {
      const res = await adminFetch('/api/admin/test-gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: rawKey })
      });

      if (res.geminiStatus) {
        state.config.geminiStatus = res.geminiStatus;
        updateOcrEngineBadge();
      }

      if (!res.success) {
        els.geminiStatusNote.style.background = '#fef2f2';
        els.geminiStatusNote.style.color = '#991b1b';
        els.geminiStatusNote.textContent = res.error || 'Gemini test failed.';
        return;
      }

      els.geminiStatusNote.style.background = '#ecfdf5';
      els.geminiStatusNote.style.color = '#065f46';
      els.geminiStatusNote.textContent = res.message || `Connected (${res.activeModel}).`;
    } catch (err) {
      els.geminiStatusNote.style.background = '#fef2f2';
      els.geminiStatusNote.style.color = '#991b1b';
      els.geminiStatusNote.textContent = err.message || 'Failed to test Gemini key.';
    }
  }

  async function handleAppUpdate(install = false) {
    if (!els.appUpdateResultBox) return;
    els.appUpdateResultBox.classList.remove('hidden');
    els.appUpdateResultBox.style.background = '#f1f5f9';
    els.appUpdateResultBox.style.color = '#334155';
    els.appUpdateResultBox.textContent = install ? 'Installing update & restarting...' : 'Checking GitHub for updates...';

    try {
      const res = await adminFetch('/api/admin/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ install })
      });

      if (!res.success) {
        els.appUpdateResultBox.style.background = '#fef2f2';
        els.appUpdateResultBox.style.color = '#991b1b';
        els.appUpdateResultBox.textContent = res.error || 'Update failed.';
        return;
      }

      els.appUpdateResultBox.style.background = '#ecfdf5';
      els.appUpdateResultBox.style.color = '#065f46';
      els.appUpdateResultBox.textContent = res.message;

      if (install && res.updated) {
        setTimeout(() => window.location.reload(), 3000);
      }
    } catch (err) {
      els.appUpdateResultBox.style.background = '#fef2f2';
      els.appUpdateResultBox.style.color = '#991b1b';
      els.appUpdateResultBox.textContent = err.message;
    }
  }

  async function handleSaveSettings(closeAfter = true) {
    const googleScriptUrl = els.settingsGoogleScriptUrl.value.trim();
    const ocrMode = els.settingsOcrMode.value;
    const geminiApiKey = els.settingsGeminiApiKey.value.trim();

    const dailyEmail = {
      enabled: els.dailyEmailEnabledInput.checked,
      adminEmail: els.dailyEmailAdminInput.value.trim(),
      time: els.dailyEmailTimeInput.value || '15:00'
    };

    try {
      const res = await adminFetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleScriptUrl,
          ocrMode,
          geminiApiKey: geminiApiKey === '' ? '__CLEAR__' : geminiApiKey,
          dailyEmail
        })
      });

      if (res.success) {
        await loadConfigAndNetwork();
        if (closeAfter !== false) {
          closeModalDialog(els.settingsModal);
          showBanner('success', 'Admin settings saved.');
        }
      }
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  }

  async function openWifiModal() {
    await loadConfigAndNetwork();
    openModalDialog(els.wifiModal);
    els.wifiQrContainer.innerHTML = '';

    const addresses = state.networkInfo?.addresses || [];
    const primaryUrl = addresses.length > 0 ? addresses[0].url : window.location.origin;

    if (typeof QRCode !== 'undefined') {
      new QRCode(els.wifiQrContainer, {
        text: primaryUrl,
        width: 190,
        height: 190
      });
    }

    els.wifiUrlsList.innerHTML =
      addresses.length > 0
        ? addresses.map((a) => `<div class="wifi-url-pill">${escapeHtml(a.url)}</div>`).join('')
        : `<div class="wifi-url-pill">${escapeHtml(window.location.origin)}</div>`;
  }

  function openLightbox(src, title) {
    els.lightboxImg.src = src;
    els.lightboxTitle.textContent = title || 'Photo';
    openModalDialog(els.lightboxModal);
  }

  function showBanner(type, message) {
    els.dispatchAlertBanner.className = `alert-banner alert-${type}`;
    els.dispatchAlertBanner.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    els.dispatchAlertBanner.innerHTML = '';

    const textSpan = document.createElement('span');
    textSpan.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-xs btn-outline';
    closeBtn.setAttribute('aria-label', 'Dismiss notice');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      els.dispatchAlertBanner.classList.add('hidden');
    });

    els.dispatchAlertBanner.append(textSpan, closeBtn);
    els.dispatchAlertBanner.classList.remove('hidden');
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function debounce(fn, waitMs) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), waitMs);
    };
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
