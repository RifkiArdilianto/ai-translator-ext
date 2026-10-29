document.addEventListener('DOMContentLoaded', () => {
  const targetLangSelect = document.getElementById('targetLang');
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');
  const noteList = document.getElementById('noteList');
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  const clearBtn = document.getElementById('clearBtn');

  // 1. Load opsi bahasa yang tersimpan
  chrome.storage.local.get(['targetLang'], (result) => {
    if (result.targetLang) {
      targetLangSelect.value = result.targetLang;
    }
  });

  // 2. Event handler simpan bahasa
  saveBtn.addEventListener('click', () => {
    const targetLang = targetLangSelect.value;

    chrome.storage.local.set({ targetLang: targetLang }, () => {
      statusDiv.style.color = '#38bdf8';
      statusDiv.textContent = 'Pengaturan tersimpan!';
      setTimeout(() => {
        statusDiv.textContent = '';
      }, 2000);
    });
  });

  // 3. Render daftar catatan di Popup
  function renderNotes() {
    chrome.storage.local.get(['saved_notes'], (res) => {
      const notes = res.saved_notes || [];
      if (notes.length === 0) {
        noteList.innerHTML = '<div class="empty-msg">Belum ada catatan yang disimpan.</div>';
        return;
      }

      noteList.innerHTML = notes.map(n => `
        <div class="note-item">
          <div class="note-orig">EN: ${n.original}</div>
          <div class="note-trans">ID: ${n.translated}</div>
        </div>
      `).join('');
    });
  }

  // 4. Buka Halaman Pratinjau Catatan di Tab Baru (Tanpa Auto Print)
  exportPdfBtn.addEventListener('click', () => {
    chrome.storage.local.get(['saved_notes'], (res) => {
      const notes = res.saved_notes || [];
      if (notes.length === 0) return alert("Catatan masih kosong! Klik tombol 💾 Simpan pada materi terlebih dahulu.");

      const win = window.open('', '_blank');
      let html = `
        <!DOCTYPE html>
        <html lang="id">
        <head>
          <meta charset="UTF-8">
          <title>Rangkuman Catatan Belajar AWS</title>
          <style>
            body { 
              font-family: system-ui, -apple-system, sans-serif; 
              padding: 40px; 
              max-width: 800px;
              margin: 0 auto;
              line-height: 1.6; 
              background: #f8fafc;
              color: #0f172a;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 2px solid #0284c7;
              padding-bottom: 15px;
              margin-bottom: 25px;
            }
            h2 { color: #0284c7; margin: 0; }
            .print-btn {
              background: #0284c7;
              color: white;
              border: none;
              padding: 8px 16px;
              border-radius: 6px;
              font-weight: bold;
              cursor: pointer;
            }
            .print-btn:hover { background: #0369a1; }
            .item { 
              margin-bottom: 16px; 
              padding: 14px; 
              border-left: 4px solid #0284c7; 
              background: #ffffff; 
              border-radius: 0 8px 8px 0;
              box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            }
            .id { color: #0f172a; font-weight: 600; font-size: 15px; margin-bottom: 4px; }
            .en { color: #64748b; font-size: 13px; font-style: italic; }
            @media print {
              .print-btn { display: none; }
              body { padding: 0; background: white; }
              .item { box-shadow: none; border-left: 3px solid #000; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>📚 Rangkuman Catatan Materi AWS</h2>
            <button class="print-btn" onclick="window.print()">📄 Simpan ke PDF / Cetak</button>
          </div>
      `;

      notes.forEach((n, index) => {
        html += `
          <div class="item">
            <div class="id">${index + 1}. ${n.translated}</div>
            <div class="en">Asli: ${n.original}</div>
          </div>
        `;
      });

      html += `
        </body>
        </html>
      `;

      win.document.write(html);
      win.document.close();
    });
  });

  // 5. Hapus Semua Catatan
  clearBtn.addEventListener('click', () => {
    if (confirm("Yakin ingin menghapus semua catatan yang tersimpan?")) {
      chrome.storage.local.set({ saved_notes: [] }, () => {
        renderNotes();
      });
    }
  });

  // Jalankan render awal saat popup dibuka
  renderNotes();
});