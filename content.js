// ===== CORE TRANSLATOR VIA BACKGROUND SERVICE WORKER ===== //
function translateText(text, targetLang = 'id') {
  return new Promise((resolve) => {
    if (!text || !text.trim() || text.length < 2) return resolve(text);
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return resolve(text);

    chrome.runtime.sendMessage(
      { action: 'translate', text: text, targetLang: targetLang },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve(text);
        } else {
          resolve(response.translated || text);
        }
      }
    );
  });
}

// ===== HELPER: SIMPAN CATATAN KE STORAGE LOKAL ===== //
function saveNoteToStorage(originalText, translatedText, courseTitle, callback) {
  chrome.storage.local.get(['saved_notes'], (res) => {
    const notes = res.saved_notes || [];

    if (notes.some(n => n.original === originalText)) {
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
}

// ===== FITUR 1: OVERLAY SUBTITLE VIDEO ===== //
function getOrCreateSubOverlay() {
  let overlay = document.getElementById('ai-auto-sub-overlay');
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
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: bold;
      text-align: center;
      z-index: 2147483647;
      max-width: 85%;
      box-shadow: 0 4px 14px rgba(0,0,0,0.7);
      border: 1px solid #38bdf8;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      pointer-events: auto !important;
    `;

    const textSpan = document.createElement('span');
    textSpan.id = 'ai-sub-text-span';
    textSpan.style.flexGrow = '1';

    const saveBtn = document.createElement('button');
    saveBtn.id = 'ai-sub-save-btn';
    saveBtn.innerText = '💾 Simpan';
    saveBtn.style.cssText = `
      padding: 4px 10px;
      font-size: 11px;
      background: #0284c7;
      color: #ffffff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      white-space: nowrap;
      font-weight: bold;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    `;

    overlay.appendChild(textSpan);
    overlay.appendChild(saveBtn);
    document.body.appendChild(overlay);
  }
  return overlay;
}

let lastSubText = '';
async function processVideoSubtitles() {
  const subEl = document.querySelector('.vjs-text-track-display, .caption-text, .ytp-caption-segment, [class*="vjs-text-track"], [class*="caption"], [class*="subtitle"]');
  
  if (subEl) {
    const currentText = subEl.innerText.trim();
    if (currentText && currentText !== lastSubText) {
      lastSubText = currentText;
      getOrCreateSubOverlay();
      
      const currentTranslatedSub = await translateText(currentText, 'id');
      const textSpan = document.getElementById('ai-sub-text-span');
      if (textSpan) textSpan.innerText = currentTranslatedSub;

      const saveBtn = document.getElementById('ai-sub-save-btn');
      if (saveBtn) {
        saveBtn.innerText = '💾 Simpan';
        saveBtn.style.background = '#0284c7';
        
        saveBtn.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          const courseTitle = document.querySelector('h1, h2, #breadcrumbs, [class*="title"]')?.innerText?.replace(/\n/g, ' ')?.trim() || "AWS Video Subtitle";
          saveNoteToStorage(currentText, currentTranslatedSub, courseTitle, () => {
            saveBtn.innerText = '✓ Tersimpan';
            saveBtn.style.background = '#059669';
          });
        };
      }
    }
  }
}

// ===== FITUR 2: TRANSLATE TEKS HALAMAN AMAN (ANTI-CRASH) ===== //
const processedElements = new WeakSet();

function attachSaveButton(el, originalText, translatedText) {
  if (el.querySelector('.ai-save-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'ai-save-btn';
  btn.innerText = '💾 Simpan';
  btn.style.cssText = `
    margin-left: 8px;
    padding: 2px 6px;
    font-size: 10px;
    background: #1e293b;
    color: #38bdf8;
    border: 1px solid #38bdf8;
    border-radius: 4px;
    cursor: pointer;
    vertical-align: middle;
  `;

  btn.onclick = (e) => {
    e.stopPropagation();
    const courseTitle = document.querySelector('h1, h2, #breadcrumbs, [class*="title"]')?.innerText?.replace(/\n/g, ' ')?.trim() || "AWS Course Note";
    saveNoteToStorage(originalText, translatedText, courseTitle, () => {
      btn.innerText = '✓ Tersimpan';
      btn.style.background = '#059669';
      btn.style.color = '#fff';
    });
  };

  el.appendChild(btn);
}

async function processPageTextContent() {
  // Ditambahkan kembali span dan div agar opsi jawaban ikut diterjemahkan
  const elements = document.querySelectorAll('p, li, span, div, h1, h2, h3, h4, label, [class*="transcript"], [class*="question"]');

  for (let el of elements) {
    if (el.closest('#breadcrumbs, #header, #left-side, .ic-app-header, header, nav, .navigation, .menu, button, script, style, #ai-auto-sub-overlay')) continue;

    // KUNCI ANTI-CRASH: el.children.length === 0 memastikan kita HANYA menyentuh teks murni (daun elemen).
    if (!processedElements.has(el) && el.children.length === 0 && el.textContent && el.textContent.trim().length > 3) {
      const originalText = el.textContent.trim();
      
      if (/^[0-9\s\W]+$/.test(originalText)) continue;

      processedElements.add(el);
      const translated = await translateText(originalText, 'id');
      
      if (translated && translated !== originalText) {
        el.textContent = translated + ' ';
        el.style.color = '#38bdf8';
        attachSaveButton(el, originalText, translated);
      }
    }
  }
}

// ===== SYSTEM RUNNER ===== //
function runScanner() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      processVideoSubtitles();
      processPageTextContent();
    }
  } catch (err) {}
}

const mainObserver = new MutationObserver(() => {
  runScanner();
});

mainObserver.observe(document.body, {
  childList: true,
  subtree: true
});

setInterval(runScanner, 1200);
document.addEventListener('DOMContentLoaded', runScanner);