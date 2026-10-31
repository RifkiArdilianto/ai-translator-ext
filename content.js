// ============================================================================
// High-Performance Hybrid Web Translator (Content Script)
// Subtitle Translation + Full Text / Transcript Scanner + Note Saver (PDF Ready)
// ============================================================================

const BATCH_SIZE = 15;
const inMemoryCache = new Map();

// ===== LIFECYCLE & CONTEXT INTEGRITY GUARD ===== //
let periodicTimer = null;
let debounceTimer = null;
let observer = null;

// Detect if extension context is valid (prevents "Extension context invalidated")
function isExtensionValid() {
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

// Clean up all observers and intervals if extension was reloaded in chrome://extensions
function cleanupExtension() {
  try {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  } catch (e) { }
}

// ===== 1. CORE TRANSLATION DISPATCHER ===== //

// Detect Chrome Built-in On-Device Translation API (< 10ms native C++)
let nativeTranslator = null;
let nativeCheckDone = false;

async function getNativeTranslator() {
  if (nativeTranslator) return nativeTranslator;
  if (nativeCheckDone) return null;

  try {
    if (typeof self !== 'undefined' && self.translation && typeof self.translation.createTranslator === 'function') {
      const canTranslate = await self.translation.canTranslate({ sourceLanguage: 'en', targetLanguage: 'id' });
      if (canTranslate !== 'no') {
        nativeTranslator = await self.translation.createTranslator({ sourceLanguage: 'en', targetLanguage: 'id' });
        console.log('[AI Translator] Native on-device C++ translation active (< 10ms)');
        return nativeTranslator;
      }
    }
    if (typeof Translator !== 'undefined' && typeof Translator.create === 'function') {
      const availability = await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'id' });
      if (availability !== 'unavailable' && availability !== 'no') {
        nativeTranslator = await Translator.create({ sourceLanguage: 'en', targetLanguage: 'id' });
        console.log('[AI Translator] Standard Chrome Translator API active (< 10ms)');
        return nativeTranslator;
      }
    }
  } catch (e) { }

  nativeCheckDone = true;
  return null;
}

// Translate single string (used by subtitles)
function translateSingleText(text) {
  return new Promise(async (resolve) => {
    if (!text || typeof text !== 'string' || !text.trim()) return resolve(text);
    const trimmed = text.trim();

    // 1. In-memory cache (< 0.05ms)
    if (inMemoryCache.has('tr_' + trimmed)) {
      return resolve(inMemoryCache.get('tr_' + trimmed));
    }

    // 2. Native On-Device API
    const native = await getNativeTranslator();
    if (native) {
      try {
        const result = await native.translate(trimmed);
        if (result && result.trim()) {
          inMemoryCache.set('tr_' + trimmed, result.trim());
          if (isExtensionValid() && chrome.storage?.local) {
            chrome.storage.local.set({ ['tr_' + trimmed]: result.trim() });
          }
          return resolve(result.trim());
        }
      } catch (e) { }
    }

    // 3. Background Service Worker (Offscreen Local AI + Guaranteed Fast Fallback)
    if (!isExtensionValid()) return resolve(trimmed);

    try {
      chrome.runtime.sendMessage({ action: 'translate', text: trimmed }, (response) => {
        if (!isExtensionValid() || chrome.runtime?.lastError || !response || !response.translated) {
          resolve(trimmed);
        } else {
          const res = response.translated.trim();
          inMemoryCache.set('tr_' + trimmed, res);
          if (isExtensionValid() && chrome.storage?.local) {
            chrome.storage.local.set({ ['tr_' + trimmed]: res });
          }
          resolve(res);
        }
      });
    } catch (err) {
      cleanupExtension();
      resolve(trimmed);
    }
  });
}

// Translate batch of strings (used by page content & transcripts)
function translateBatchViaBackground(texts) {
  return new Promise((resolve) => {
    if (!isExtensionValid()) return resolve(texts);

    try {
      chrome.runtime.sendMessage({ action: 'translate_batch', texts }, (response) => {
        if (!isExtensionValid() || chrome.runtime?.lastError || !response || !response.translations) {
          resolve(texts);
        } else {
          resolve(response.translations);
        }
      });
    } catch (err) {
      cleanupExtension();
      resolve(texts);
    }
  });
}

async function executeHybridBatch(texts) {
  const native = await getNativeTranslator();
  if (native) {
    try {
      const results = [];
      for (const t of texts) {
        const trans = await native.translate(t);
        results.push(trans ? trans.trim() : t);
      }
      return results;
    } catch (e) { }
  }
  return await translateBatchViaBackground(texts);
}

// ===== 2. STORAGE & NOTE SAVING HELPERS ===== //
function fetchStorageCache(keys) {
  return new Promise((resolve) => {
    if (!isExtensionValid() || !chrome.storage?.local || !keys || keys.length === 0) {
      return resolve({});
    }
    try {
      chrome.storage.local.get(keys, (res) => {
        if (!isExtensionValid() || chrome.runtime?.lastError) {
          return resolve({});
        }
        resolve(res || {});
      });
    } catch (err) {
      cleanupExtension();
      resolve({});
    }
  });
}

function saveNoteToStorage(originalText, translatedText, courseTitle, callback) {
  if (!isExtensionValid() || !chrome.storage?.local) return;

  try {
    chrome.storage.local.get(['saved_notes'], (res) => {
      if (!isExtensionValid() || chrome.runtime?.lastError) return;
      const notes = res?.saved_notes || [];

      if (notes.some((n) => n.original === originalText)) {
        if (callback) callback(true);
        return;
      }

      notes.push({
        id: Date.now().toString(36),
        course: courseTitle,
        original: originalText,
        translated: translatedText,
        date: new Date().toLocaleDateString('id-ID')
      });

      chrome.storage.local.set({ saved_notes: notes }, () => {
        if (callback) callback(false);
      });
    });
  } catch (err) {
    cleanupExtension();
  }
}

// ===== 3. FEATURE 1: VIDEO SUBTITLE OVERLAY ===== //
function getOrCreateSubOverlay() {
  let overlay = document.getElementById('ai-auto-sub-overlay');
  const targetContainer = document.fullscreenElement || document.body;

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ai-auto-sub-overlay';
    overlay.style.cssText = `
      position: fixed;
      bottom: 70px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.95);
      color: #38bdf8;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      text-align: center;
      z-index: 2147483647;
      max-width: 85%;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.8);
      border: 1px solid #38bdf8;
      font-family: system-ui, -apple-system, sans-serif;
      display: none;
      align-items: center;
      justify-content: center;
      gap: 14px;
      pointer-events: auto !important;
      backdrop-filter: blur(6px);
    `;

    const textSpan = document.createElement('span');
    textSpan.id = 'ai-sub-text-span';
    textSpan.style.cssText = 'flex-grow: 1; line-height: 1.4;';

    const saveBtn = document.createElement('button');
    saveBtn.id = 'ai-sub-save-btn';
    saveBtn.type = 'button';
    saveBtn.innerText = '💾 Simpan';
    saveBtn.style.cssText = `
      padding: 5px 12px;
      font-size: 12px;
      font-weight: bold;
      background: #0284c7;
      color: #ffffff;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      white-space: nowrap;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      transition: background 0.2s ease;
    `;

    overlay.appendChild(textSpan);
    overlay.appendChild(saveBtn);
    targetContainer.appendChild(overlay);
  } else if (overlay.parentElement !== targetContainer) {
    targetContainer.appendChild(overlay);
  }

  return overlay;
}

let lastSubText = '';
let currentTranslatedSub = '';

async function processVideoSubtitles() {
  if (!isExtensionValid()) {
    cleanupExtension();
    return;
  }

  const subtitleSelectors = [
    '.vjs-text-track-cue',
    '.vjs-text-track-display div',
    '.caption-text',
    '.ytp-caption-segment',
    '.mejs-captions-text',
    '[class*="vjs-text-track-cue"]',
    '[class*="caption-text"]',
    '[class*="subtitle-text"]',
    '[class*="subtitles-cue"]',
    '.vjs-text-track-display',
    '[class*="vjs-text-track"]',
    '[class*="caption-window"]',
    '[class*="transcript-cue"]'
  ];

  let subEl = null;
  for (const selector of subtitleSelectors) {
    const el = document.querySelector(selector);
    if (el && !el.closest('#ai-auto-sub-overlay') && el.innerText && el.innerText.trim().length > 0) {
      subEl = el;
      break;
    }
  }

  const overlay = getOrCreateSubOverlay();

  if (subEl) {
    const currentText = subEl.innerText.trim();
    if (currentText && /[a-zA-Z]{2,}/.test(currentText)) {
      overlay.style.display = 'flex';

      if (currentText !== lastSubText) {
        lastSubText = currentText;
        const textSpan = document.getElementById('ai-sub-text-span');
        const saveBtn = document.getElementById('ai-sub-save-btn');

        if (textSpan) textSpan.innerText = 'Menerjemahkan...';

        const translated = await translateSingleText(currentText);
        currentTranslatedSub = translated;

        if (textSpan) {
          textSpan.innerText = currentTranslatedSub;
        }

        if (saveBtn) {
          saveBtn.innerText = '💾 Simpan';
          saveBtn.style.background = '#0284c7';

          saveBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const courseTitle =
              document.querySelector('h1, h2, #breadcrumbs, [class*="title"]')?.innerText?.replace(/\n/g, ' ')?.trim() ||
              'Video Subtitle';
            saveNoteToStorage(currentText, currentTranslatedSub, courseTitle, () => {
              saveBtn.innerText = '✓ Tersimpan';
              saveBtn.style.background = '#059669';
            });
          };
        }
      }
      return;
    }
  }

  if (overlay && overlay.style.display !== 'none' && !subEl) {
    overlay.style.display = 'none';
  }
}

// ===== 4. FEATURE 2: PAGE CONTENT & TRANSCRIPT SCANNER ===== //
function attachSaveButton(el, originalText, translatedText) {
  if (el.querySelector('.ai-save-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'ai-save-btn';
  btn.type = 'button';
  btn.innerText = '💾 Simpan';
  btn.title = 'Simpan ke Catatan';
  btn.style.cssText = `
    display: inline-block;
    margin-left: 8px;
    padding: 2px 7px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    background: #1e293b;
    color: #38bdf8;
    border: 1px solid #38bdf8;
    border-radius: 4px;
    cursor: pointer;
    vertical-align: middle;
    user-select: none;
    transition: all 0.2s ease;
  `;

  btn.onmouseenter = () => {
    if (!btn.innerText.includes('✓')) {
      btn.style.background = '#0284c7';
      btn.style.color = '#ffffff';
    }
  };

  btn.onmouseleave = () => {
    if (!btn.innerText.includes('✓')) {
      btn.style.background = '#1e293b';
      btn.style.color = '#38bdf8';
    }
  };

  btn.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const courseTitle =
      document.querySelector('h1, h2, #breadcrumbs, [class*="title"]')?.innerText?.replace(/\n/g, ' ')?.trim() ||
      'Catatan Materi';
    saveNoteToStorage(originalText, translatedText, courseTitle, () => {
      btn.innerText = '✓ Tersimpan';
      btn.style.background = '#059669';
      btn.style.borderColor = '#059669';
      btn.style.color = '#ffffff';
    });
  };

  el.appendChild(btn);
}

function applyTranslation(el, originalText, translatedText) {
  if (!el.isConnected) return;
  el.textContent = translatedText + ' ';
  el.style.color = '#38bdf8';
  el.dataset.translated = 'true';
  attachSaveButton(el, originalText, translatedText);
}

let isScanningDOM = false;

async function scanAndTranslateDOM() {
  if (!isExtensionValid()) {
    cleanupExtension();
    return;
  }
  if (isScanningDOM) return;
  isScanningDOM = true;

  try {
    const SELECTOR = [
      'p',
      'li',
      'h1', 'h2', 'h3', 'h4',
      'blockquote',
      'td', 'th',
      'label',
      // AWS Skill Builder & LMS Specific Transcripts
      '.SideTranscript span.SafeHTMLSpan',
      '[class*="SideTranscript"] span.SafeHTMLSpan',
      'button span.SafeHTMLSpan',
      'span.SafeHTMLSpan',
      '.SideTranscript .SafeHTMLSpan',
      '[class*="SideTranscript"] .SafeHTMLSpan',
      '.SafeHTMLSpan',
      '.SideTranscript *',
      '[class*="SideTranscript" i] *',
      '.flex-scrolly *',
      '[class*="flex-scrolly" i] *',
      '.MyGrid1Col *',
      '[class*="MyGrid1Col" i] *',
      // Transcripts (classes, IDs, ARIA, and data attributes)
      '[class*="transcript" i]',
      '[id*="transcript" i]',
      '[aria-label*="transcript" i]',
      '[data-tab*="transcript" i]',
      '[class*="transcript-line" i]',
      '[class*="transcript-text" i]',
      '[class*="transcript-cue" i]',
      '[class*="transcript-item" i]',
      '[class*="transcript-segment" i]',
      '[class*="transcript-sentence" i]',
      '[class*="cue-text" i]',
      '[class*="cue" i]',
      '[class*="caption-text" i]',
      '[class*="subtitle-text" i]',
      // Sidebars & panels containing transcript / course text
      'aside [class*="text" i]',
      'aside p',
      'aside span',
      'aside div',
      '[class*="sidebar" i] [class*="text" i]',
      '[class*="sidebar" i] p',
      '[class*="sidebar" i] span',
      '[class*="panel" i] [class*="transcript" i]',
      '[class*="drawer" i] [class*="transcript" i]',
      // General text containers
      '[class*="question"]',
      'div[class*="text"]',
      'div[class*="content"]',
      'span[class*="text"]'
    ].join(', ');

    const elements = document.querySelectorAll(SELECTOR);
    const candidateItems = [];

    for (const el of elements) {
      if (el.dataset.translated === 'true' || el.dataset.translating === 'true') {
        continue;
      }

      // 1. Skip our own overlay, buttons, scripts, styles, raw code, inputs
      if (
        el.closest(
          '#ai-auto-sub-overlay, .ai-save-btn, script, style, noscript, svg, code, pre, textarea, input, select, [contenteditable="true"], #breadcrumbs'
        )
      ) {
        continue;
      }

      // Check if this element is part of a transcript container (SideTranscript, sidebar, bottom, drawer, tabs)
      const isTranscript = Boolean(
        el.closest(
          '.SideTranscript, [class*="SideTranscript" i], .SafeHTMLSpan, [class*="SafeHTMLSpan" i], .flex-scrolly, [class*="flex-scrolly" i], .MyGrid1Col, [class*="MyGrid1Col" i], [class*="transcript" i], [id*="transcript" i], [aria-label*="transcript" i], [data-tab*="transcript" i], [class*="cue" i], aside, [class*="sidebar" i], button.selected, button.notselected, button[class*="selected"]'
        ) || el.classList?.contains('SafeHTMLSpan')
      );

      // 2. For non-transcripts: skip general navigation, header, footer, and buttons
      // For transcripts: allow them even if rendered inside a sidebar, drawer, or clickable cue item
      if (!isTranscript) {
        if (el.closest('nav, header, footer, button')) {
          continue;
        }
      } else {
        // Inside transcripts, only skip generic utility buttons like "Close", "Download", "Search"
        if (
          el.tagName === 'BUTTON' &&
          el.textContent.trim().length < 15 &&
          /close|search|filter|download|copy|settings|clear/i.test(el.textContent.trim())
        ) {
          continue;
        }
      }

      // 3. ANTI-CRASH CHECK: Never overwrite a container that directly has input controls (protects quiz radio/checkbox)
      if (el.querySelector('input, select, textarea, canvas, iframe, audio, video')) {
        continue;
      }

      // 4. Avoid translating wrapper containers that have child paragraphs or lines
      if (
        el.querySelector(
          'p, h1, h2, h3, h4, li, blockquote, [class*="transcript-line" i], [class*="transcript-cue" i], [class*="transcript-item" i]'
        )
      ) {
        continue;
      }

      const text = el.textContent ? el.textContent.trim() : '';

      // 5. Skip timestamps (e.g. "00:15", "01:23:45", "1:05", "12.3s")
      if (/^[\d\s:.-]+s?$/.test(text)) {
        continue;
      }

      // 6. Skip short snippets, pure numbers, or non-alphabetic strings
      if (text.length < 3 || !/[a-zA-Z]{2,}/.test(text)) {
        continue;
      }

      candidateItems.push({ el, text });
    }

    // Direct Inspection for .SideTranscript & .flex-scrolly containers
    const sideTranscriptContainers = document.querySelectorAll(
      '.SideTranscript, [class*="SideTranscript" i], .flex-scrolly, [class*="flex-scrolly" i]'
    );
    for (const container of sideTranscriptContainers) {
      const itemsInSide = container.querySelectorAll('*');
      for (const el of itemsInSide) {
        if (el.dataset.translated === 'true' || el.dataset.translating === 'true') continue;
        if (el.closest('#ai-auto-sub-overlay, .ai-save-btn, script, style, input, textarea, select')) continue;

        // Skip parent elements that have text children so we only translate the leaf text container
        let hasChildText = false;
        for (const child of el.children) {
          if (child.textContent && child.textContent.trim().length > 2 && /[a-zA-Z]{2,}/.test(child.textContent)) {
            hasChildText = true;
            break;
          }
        }
        if (hasChildText) continue;

        const text = el.textContent ? el.textContent.trim() : '';
        if (/^[\d\s:.-]+s?$/.test(text)) continue;

        if (text.length >= 3 && /[a-zA-Z]{2,}/.test(text)) {
          if (!candidateItems.some((c) => c.el === el)) {
            candidateItems.push({ el, text });
          }
        }
      }
    }

    if (candidateItems.length === 0) {
      isScanningDOM = false;
      return;
    }

    // Step 1: In-memory cache check (< 0.05ms)
    const uncachedInMemory = [];
    for (const item of candidateItems) {
      const cacheKey = 'tr_' + item.text;
      if (inMemoryCache.has(cacheKey)) {
        applyTranslation(item.el, item.text, inMemoryCache.get(cacheKey));
      } else {
        uncachedInMemory.push(item);
      }
    }

    if (uncachedInMemory.length === 0) {
      isScanningDOM = false;
      return;
    }

    // Step 2: Instant persistent storage check (< 1ms)
    const storageKeys = Array.from(new Set(uncachedInMemory.map((i) => 'tr_' + i.text)));
    const storageResults = await fetchStorageCache(storageKeys);

    const pendingQueue = [];
    for (const item of uncachedInMemory) {
      const cacheKey = 'tr_' + item.text;
      if (storageResults[cacheKey]) {
        const cachedTranslation = storageResults[cacheKey];
        inMemoryCache.set(cacheKey, cachedTranslation);
        applyTranslation(item.el, item.text, cachedTranslation);
      } else {
        item.el.dataset.translating = 'true';
        pendingQueue.push(item);
      }
    }

    if (pendingQueue.length === 0) {
      isScanningDOM = false;
      return;
    }

    // Step 3: Group into batches of 15 elements to prevent message flooding
    for (let i = 0; i < pendingQueue.length; i += BATCH_SIZE) {
      if (!isExtensionValid()) {
        cleanupExtension();
        break;
      }

      const batch = pendingQueue.slice(i, i + BATCH_SIZE);
      const batchTexts = batch.map((item) => item.text);

      const translations = await executeHybridBatch(batchTexts);
      const storageUpdates = {};

      batch.forEach((item, index) => {
        delete item.el.dataset.translating;
        const translated = translations[index] || item.text;

        if (translated && translated !== item.text) {
          applyTranslation(item.el, item.text, translated);
          const cacheKey = 'tr_' + item.text;
          inMemoryCache.set(cacheKey, translated);
          storageUpdates[cacheKey] = translated;
        }
      });

      if (Object.keys(storageUpdates).length > 0 && isExtensionValid() && chrome.storage?.local) {
        try {
          chrome.storage.local.set(storageUpdates);
        } catch (e) {
          cleanupExtension();
        }
      }
    }
  } catch (err) {
    if (err?.message?.includes('Extension context invalidated')) {
      cleanupExtension();
    } else {
      console.warn('[AI Translator] DOM scan notice:', err?.message || err);
    }
  } finally {
    isScanningDOM = false;
  }
}

// ===== 5. LIFECYCLE & CONTINUOUS SCANNER ===== //
function attachScrollListeners() {
  const scrollContainers = document.querySelectorAll(
    '.SideTranscript, .flex-scrolly, [class*="SideTranscript" i], [class*="flex-scrolly" i], [class*="scrolly" i]'
  );
  scrollContainers.forEach((sc) => {
    if (!sc.dataset.hasScrollListener) {
      sc.dataset.hasScrollListener = 'true';
      sc.addEventListener(
        'scroll',
        () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            runPeriodicScanner();
          }, 300);
        },
        { passive: true }
      );
    }
  });
}

function runPeriodicScanner() {
  if (!isExtensionValid()) {
    cleanupExtension();
    return;
  }
  processVideoSubtitles();
  attachScrollListeners();
  scanAndTranslateDOM();
}

observer = new MutationObserver(() => {
  if (!isExtensionValid()) {
    cleanupExtension();
    return;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    runPeriodicScanner();
  }, 600);
});

function initObserver() {
  if (document.body && observer) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

// Run scanner continuously every 1000ms for dynamic SPAs, late-loaded transcripts, and video captions
periodicTimer = setInterval(runPeriodicScanner, 1000);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initObserver();
    runPeriodicScanner();
  });
} else {
  initObserver();
  runPeriodicScanner();
}
