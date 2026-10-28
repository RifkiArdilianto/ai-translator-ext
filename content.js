// ===== CORE TRANSLATOR ENGINE (Google Free Endpoint) ===== //
async function translateText(text, targetLang = 'id') {
  if (!text || !text.trim()) return text;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data && data[0]) {
      let translatedText = '';
      data[0].forEach(item => { if (item[0]) translatedText += item[0]; });
      return translatedText;
    }
    return text;
  } catch (err) {
    return text;
  }
}

// ===== FITUR 1: AUTO SUBTITLE VIDEO ===== //
function getOrCreateSubOverlay() {
  let overlay = document.getElementById('ai-auto-sub-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ai-auto-sub-overlay';
    overlay.style.cssText = `
      position: absolute;
      bottom: 50px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.9);
      color: #00ffcc;
      padding: 8px 18px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: bold;
      text-align: center;
      z-index: 2147483647;
      max-width: 85%;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.6);
      border: 1px solid #00ffcc;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    const container = document.querySelector('.video-js, video, iframe')?.parentElement || document.body;
    container.style.position = 'relative';
    container.appendChild(overlay);
  }
  return overlay;
}

let lastSubText = '';
async function processVideoSubtitles() {
  const subEl = document.querySelector('.vjs-text-track-display, .caption-text, .ytp-caption-segment, [class*="vjs-text-track"]');
  if (subEl) {
    const currentText = subEl.innerText.trim();
    if (currentText && currentText !== lastSubText) {
      lastSubText = currentText;
      const overlay = getOrCreateSubOverlay();
      const translated = await translateText(currentText, 'id');
      overlay.innerText = translated;
    }
  }
}

// ===== FITUR 2: AUTO TRANSLATE PANEL TRANSKRIP & MATERI ===== //
const translatedNodes = new WeakSet();

async function processPageElements() {
  const elements = document.querySelectorAll('p, li, span, h1, h2, h3, h4, [class*="transcript"], [class*="cue"]');

  for (let el of elements) {
    if (!translatedNodes.has(el) && el.children.length === 0 && el.innerText && el.innerText.trim().length > 3) {
      const originalText = el.innerText.trim();
      
      // ABAIKAN jika teks berupa angka/simbol saja
      if (/^[0-9\s\W]+$/.test(originalText)) continue;

      translatedNodes.add(el);
      const translated = await translateText(originalText, 'id');
      
      if (translated && translated !== originalText) {
        el.innerText = translated;
        el.style.color = '#38bdf8'; // Warna biru penanda teks terjemahan otomatis
      }
    }
  }
}

// ===== SYSTEM OBSERVER (DENGAN PENGAMAN CONTEXT EXTENSION) ===== //
const mainObserver = new MutationObserver(() => {
  try {
    // Stop observer otomatis jika context ekstensi terputus / di-reload
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
      mainObserver.disconnect();
      return;
    }
    processVideoSubtitles();
    processPageElements();
  } catch (err) {
    mainObserver.disconnect();
  }
});

mainObserver.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true
});

// Pemindaian awal saat halaman selesai dimuat
document.addEventListener('DOMContentLoaded', () => {
  try {
    processPageElements();
  } catch (err) {
    // Ignore error jika context berubah saat load
  }
});