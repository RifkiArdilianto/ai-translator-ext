document.addEventListener('DOMContentLoaded', () => {
  const targetLangSelect = document.getElementById('targetLang');
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');

  // Load opsi bahasa yang tersimpan
  chrome.storage.local.get(['targetLang'], (result) => {
    if (result.targetLang) {
      targetLangSelect.value = result.targetLang;
    }
  });

  // Event handler simpan bahasa
  saveBtn.addEventListener('click', () => {
    const targetLang = targetLangSelect.value;

    chrome.storage.local.set({ targetLang: targetLang }, () => {
      statusDiv.style.color = 'green';
      statusDiv.textContent = 'Tersimpan!';
      setTimeout(() => {
        statusDiv.textContent = '';
      }, 2000);
    });
  });
});