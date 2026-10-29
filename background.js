const translationCache = new Map();

async function fetchTranslation(text, targetLang) {
  // Cek cache agar tidak buang-buang request
  if (translationCache.has(text)) {
    return translationCache.get(text);
  }

  // 1. Endpoint Google Translate V2 (Khusus Chrome Extension - Sangat Stabil)
  const url1 = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  
  // 2. Endpoint Google Translate V1 (GTX - Fallback)
  const url2 = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  
  // 3. Endpoint MyMemory (Ultimate Fallback)
  const url3 = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${targetLang}`;

  try {
    // Coba Google API V2 dulu
    let res = await fetch(url1);
    
    // Kalau diblokir (429), otomatis pindah ke Google API V1
    if (!res.ok) {
      res = await fetch(url2);
    }

    // Jika salah satu Google API berhasil
    if (res.ok) {
      const data = await res.json();
      if (data && data[0]) {
        let translatedText = '';
        data[0].forEach(item => { if (item[0]) translatedText += item[0]; });
        translationCache.set(text, translatedText);
        return translatedText;
      }
    }

    // Kalau Google API tumbang semua, pakai MyMemory
    const resMyMemory = await fetch(url3);
    if (resMyMemory.ok) {
      const dataMM = await resMyMemory.json();
      if (dataMM && dataMM.responseData && dataMM.responseData.translatedText) {
        const transMM = dataMM.responseData.translatedText;
        translationCache.set(text, transMM);
        return transMM;
      }
    }

    // Kalau semua API gagal (sangat jarang terjadi), kembalikan teks aslinya
    return text;
  } catch (err) {
    return text;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    fetchTranslation(request.text, request.targetLang || 'id').then(translated => {
      sendResponse({ translated });
    });
    return true; // Wajib true untuk async response
  }
});