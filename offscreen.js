// ============================================================================
// Offscreen Document: GPU-Accelerated Local AI Engine (Transformers.js)
// ============================================================================

// In-memory cache for ultra-fast deduplication
const memoryCache = new Map();

let pipelineModule = null;
let pipelinePromise = null;
let activeBackend = 'initializing';

// ===== 1. REGISTER LISTENER IMMEDIATELY (SYNCHRONOUSLY) AT THE TOP ===== //
// CRITICAL: Must be registered before any async/network import so Chrome never
// throws "Could not establish connection. Receiving end does not exist."
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || request.target !== 'offscreen') {
    return false;
  }

  // Instant heartbeat ping from Background Service Worker
  if (request.action === 'ping') {
    sendResponse({ status: 'ready', backend: activeBackend });
    return false;
  }

  // Handle batch translation
  if (request.action === 'translate_batch') {
    translateBatch(request.texts)
      .then((translations) => {
        sendResponse({ success: true, translations, backend: activeBackend });
      })
      .catch((error) => {
        console.error('[Offscreen AI] Batch translation error:', error);
        sendResponse({
          success: false,
          error: error.message,
          translations: request.texts,
          backend: activeBackend
        });
      });
    return true; // Keep message channel open for async response
  }

  // Handle single string translation
  if (request.action === 'translate') {
    translateSingleText(request.text)
      .then((translated) => {
        sendResponse({ success: true, translated, backend: activeBackend });
      })
      .catch((error) => {
        console.error('[Offscreen AI] Single translation error:', error);
        sendResponse({
          success: false,
          error: error.message,
          translated: request.text,
          backend: activeBackend
        });
      });
    return true; // Keep message channel open for async response
  }
});

// Announce presence to background service worker immediately
try {
  chrome.runtime.sendMessage({ target: 'background', action: 'offscreen_alive' }, () => {
    if (chrome.runtime.lastError) {
      // Suppress if background is already listening or closed
    }
  });
} catch (e) {}

// ===== 2. DYNAMIC TRANSFORMERS.JS LOADER & PIPELINE INITIALIZER ===== //
async function loadTransformers() {
  if (pipelineModule) return pipelineModule;

  console.log('[Offscreen AI] Loading Transformers.js v2.17.2 module...');
  const module = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');

  // Configure environment for offline caching and ONNX execution
  module.env.useBrowserCache = true;
  module.env.allowLocalModels = false;

  if (module.env.backends?.onnx?.wasm) {
    module.env.backends.onnx.wasm.proxy = false;
    module.env.backends.onnx.wasm.numThreads = 1;
  }

  pipelineModule = module;
  return pipelineModule;
}

async function initializeTranslator() {
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    const { pipeline, env } = await loadTransformers();

    // Attempt 1: WebGPU Acceleration
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        console.log('[Offscreen AI] Initializing Xenova/opus-mt-en-id with WebGPU acceleration...');
        const translator = await pipeline('translation', 'Xenova/opus-mt-en-id', {
          device: 'webgpu'
        });
        activeBackend = 'webgpu';
        console.log('[Offscreen AI] WebGPU pipeline successfully initialized!');
        return translator;
      } catch (gpuErr) {
        console.warn('[Offscreen AI] WebGPU initialization failed, falling back to ONNX WASM:', gpuErr);
      }
    } else {
      console.log('[Offscreen AI] WebGPU not available in current browser environment. Using ONNX WASM.');
    }

    // Attempt 2: Fallback to ONNX WASM on CPU
    try {
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.proxy = false;
        env.backends.onnx.wasm.numThreads = 1;
      }
      console.log('[Offscreen AI] Initializing Xenova/opus-mt-en-id with ONNX WASM CPU fallback...');
      const translator = await pipeline('translation', 'Xenova/opus-mt-en-id', {
        device: 'wasm'
      });
      activeBackend = 'wasm';
      console.log('[Offscreen AI] ONNX WASM pipeline successfully initialized!');
      return translator;
    } catch (wasmErr) {
      console.error('[Offscreen AI] Fatal: Failed to initialize translation pipeline:', wasmErr);
      pipelinePromise = null; // Allow retry on subsequent request
      throw wasmErr;
    }
  })();

  return pipelinePromise;
}

// Pre-warm the model in the background
initializeTranslator().catch((err) => {
  console.warn('[Offscreen AI] Pre-warming notice:', err?.message || err);
});

// ===== 3. TRANSLATION PROCESSORS ===== //
async function translateSingleText(text) {
  if (!text || typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (trimmed.length === 0) return text;

  // Check in-memory cache first (< 0.1ms)
  if (memoryCache.has(trimmed)) {
    return memoryCache.get(trimmed);
  }

  try {
    const translator = await initializeTranslator();
    const output = await translator(trimmed);

    let translated = '';
    if (Array.isArray(output) && output.length > 0) {
      translated = output[0]?.translation_text || '';
    } else if (output && typeof output === 'object') {
      translated = output.translation_text || '';
    } else if (typeof output === 'string') {
      translated = output;
    }

    translated = translated.trim();
    if (translated) {
      memoryCache.set(trimmed, translated);
      return translated;
    }
    return trimmed;
  } catch (err) {
    console.error('[Offscreen AI] Error translating string:', trimmed, err);
    return trimmed;
  }
}

async function translateBatch(texts) {
  if (!Array.isArray(texts)) return [];

  const results = [];
  for (const text of texts) {
    const translated = await translateSingleText(text);
    results.push(translated);
  }
  return results;
}
