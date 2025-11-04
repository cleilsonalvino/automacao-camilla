// REMOVIDO: const zip = new JSZip(); (Melhor instanciar quando for usar)
const { jsPDF } = window.jspdf;

let lotes = [];
let activeId = null;

const addLoteBtn = document.getElementById("addLote");
const lotesListEl = document.getElementById("lotesList");
const loteTitleEl = document.getElementById("loteTitle");
const loteMetaEl = document.getElementById("loteMeta");
const renameBtn = document.getElementById("renameLote");
const deleteBtn = document.getElementById("deleteLote");
const fileInput = document.getElementById("fileInput");
const clearBtn = document.getElementById("clearLote");
const genPDFBtn = document.getElementById("genPDF");
const downloadZIPBtn = document.getElementById("downloadZIP");
const gridEl = document.getElementById("grid");
const dropzone = document.getElementById("dropzone");
const imgPerPageEl = document.getElementById("imgPerPage");
const progressBar = document.getElementById("progressBar");
const previewModal = document.getElementById("previewModal");
const pdfPreview = document.getElementById("pdfPreview");
const closePreview = document.getElementById("closePreview");

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function saveLocal() {
  localStorage.setItem(
    "lotesPDFv2",
    JSON.stringify(
      lotes.map((l) => ({
        id: l.id,
        name: l.name,
        // Salva width/height no localStorage
        items: l.items.map((it) => ({
          name: it.name,
          type: it.type,
          dataURL: it.dataURL,
          width: it.width,
          height: it.height,
        })),
        seen: [...l.seen],
      }))
    )
  );
}
function loadLocal() {
  const data = localStorage.getItem("lotesPDFv2");
  if (data) {
    lotes = JSON.parse(data).map((l) => ({ ...l, seen: new Set(l.seen) }));
    activeId = lotes[0]?.id ?? null;
  } else {
    const id = uid();
    lotes = [{ id, name: "Lote 1", items: [], seen: new Set() }];
    activeId = id;
  }
}

function ensureActiveUI(enabled) {
  [
    fileInput,
    clearBtn,
    genPDFBtn,
    renameBtn,
    deleteBtn,
    downloadZIPBtn,
  ].forEach((b) => (b.disabled = !enabled));
  dropzone.classList.toggle("disabled", !enabled);
}

function renderSidebar() {
  lotesListEl.innerHTML = "";
  // Ordena para o mais recente (maior ID) aparecer primeiro
  [...lotes].sort((a,b) => b.id.slice(-13) - a.id.slice(-13)).forEach((l) => {
    const div = document.createElement("div");
    // Classe da sidebar estava errada no seu código
    div.className = "list-item" + (l.id === activeId ? " active" : "");
    div.onclick = () => {
      activeId = l.id;
      renderAll();
    };
    // Usei textContent para segurança contra XSS
    const h4 = document.createElement('h4');
    h4.textContent = l.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${l.items.length} imagem(ns)`;
    div.appendChild(h4);
    div.appendChild(meta);
    lotesListEl.appendChild(div);
  });
}

function renderMain() {
  const lote = lotes.find((l) => l.id === activeId);
  if (!lote) {
    loteTitleEl.textContent = "Selecione um lote";
    loteMetaEl.textContent = "Nenhum ativo.";
    gridEl.innerHTML = "";
    ensureActiveUI(false);
    return;
  }
  loteTitleEl.textContent = lote.name;
  loteMetaEl.textContent = `${lote.items.length} imagens.`;
  ensureActiveUI(true);
  
  // Habilita/desabilita botões de gerar/limpar
  const hasImages = lote.items.length > 0;
  [clearBtn, genPDFBtn, downloadZIPBtn].forEach(b => b.disabled = !hasImages);

  gridEl.innerHTML = "";
  lote.items.forEach((it, idx) => {
    const c = document.createElement("div");
    c.className = "thumb";
    // Corrigido para usar a classe correta do HTML (thumb-remove)
    c.innerHTML = `<img src="${it.dataURL}"><div class="thumb-remove" data-idx="${idx}">×</div>`;
    gridEl.appendChild(c);
  });
  gridEl.querySelectorAll(".thumb-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const i = +e.currentTarget.dataset.idx;
      lote.seen.delete(lote.items[i].name);
      lote.items.splice(i, 1);
      saveLocal();
      renderAll();
    });
  });
}
function renderAll() {
  renderSidebar();
  renderMain();
}

addLoteBtn.onclick = () => {
  const id = uid();
  lotes.push({ id, name: `Lote ${lotes.length + 1}`, items: [], seen: new Set() });
  activeId = id;
  saveLocal();
  renderAll();
};
renameBtn.onclick = () => {
  const l = lotes.find((x) => x.id === activeId);
  if (!l) return;
  const n = prompt("Novo nome:", l.name);
  if (n) {
    l.name = n;
    saveLocal();
    renderAll();
  }
};
deleteBtn.onclick = () => {
  const i = lotes.findIndex((x) => x.id === activeId);
  if (i < 0) return;
  if (confirm("Excluir lote?")) {
    lotes.splice(i, 1);
    activeId = lotes[0]?.id ?? null;
    saveLocal();
    renderAll();
  }
};
clearBtn.onclick = () => {
  const l = lotes.find((x) => x.id === activeId);
  if (!l) return;
  if (confirm("Remover todas imagens?")) {
    l.items = [];
    l.seen.clear();
    saveLocal();
    renderAll();
  }
};

fileInput.onchange = async () => {
  const l = lotes.find((x) => x.id === activeId);
  if (!l) return;
  await addFiles(l, Array.from(fileInput.files));
  fileInput.value = "";
};
["dragenter", "dragover"].forEach((e) =>
  dropzone.addEventListener(e, (ev) => {
    ev.preventDefault();
    if (dropzone.disabled) return;
    dropzone.classList.add("drag");
  })
);
["dragleave", "drop"].forEach((e) =>
  dropzone.addEventListener(e, (ev) => {
    ev.preventDefault();
    dropzone.classList.remove("drag");
  })
);
dropzone.addEventListener("drop", async (e) => {
  const l = lotes.find((x) => x.id === activeId);
  if (!l || dropzone.disabled) return;
  const fs = Array.from(e.dataTransfer.files).filter((f) =>
    f.type.startsWith("image/")
  );
  await addFiles(l, fs);
});

function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// =======================================================
// ✨ FUNÇÕES CORRIGIDAS E ADICIONADAS
// =======================================================

/**
 * [NOVO] Calcula dimensões "contain" (manter proporção) para caber num container.
 * @returns {object} { w, h, x, y }
 */
function calculateAspectRatioFit(srcW, srcH, maxW, maxH) {
  const ratio = Math.min(maxW / srcW, maxH / srcH);
  const w = srcW * ratio;
  const h = srcH * ratio;
  const x = (maxW - w) / 2; // Offset X para centralizar
  const y = (maxH - h) / 2; // Offset Y para centralizar
  return { w, h, x, y };
}

/**
 * [CORRIGIDO] Retorna um objeto com dataURL, width e height
 */
async function compressImage(dataURL, maxW = 800, maxH = 800) {
  const img = new Image();
  img.src = dataURL;
  await new Promise((r) => (img.onload = r));
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const c = document.createElement("canvas");
  c.width = img.width * scale;
  c.height = img.height * scale;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, c.width, c.height);

  // MUDANÇA: Retorna um objeto em vez de apenas a string
  return {
    dataURL: c.toDataURL("image/jpeg", 0.8),
    width: c.width, // Retorna a nova largura
    height: c.height, // Retorna a nova altura
  };
}

/**
 * [CORRIGIDO] Salva width e height no objeto do lote
 */
async function addFiles(lote, files) {
  progressBar.style.width = "0%";
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f.type.startsWith("image/")) continue;
    if (lote.seen.has(f.name)) continue;
    const dataURL = await fileToDataURL(f);
    
    // MUDANÇA: imgData agora é {dataURL, width, height}
    const imgData = await compressImage(dataURL);

    lote.items.push({
      name: f.name,
      type: f.type,
      dataURL: imgData.dataURL, // Salva o dataURL
      width: imgData.width,     // Salva a largura
      height: imgData.height,   // Salva a altura
    });

    lote.seen.add(f.name);
    progressBar.style.width = `${((i + 1) / files.length) * 100}%`;
  }
  
  saveLocal();
  renderAll();
  
  // A barra de progresso vai a 100% e depois zera
  progressBar.style.width = "100%";
  setTimeout(() => (progressBar.style.width = "0%"), 800);
}

genPDFBtn.onclick = () => generatePDF(false);
downloadZIPBtn.onclick = () => generatePDF(true);

/**
 * [TOTALMENTE REESCRITO] Usa layout dinâmico e aspect ratio
 */
function generatePDF(asZIP = false) {
  const lote = lotes.find((l) => l.id === activeId);
  if (!lote || !lote.items.length) {
    alert("Lote vazio.");
    return;
  }
  const perPage = parseInt(imgPerPageEl.value);
  const layout = { 4: [2, 2], 6: [3, 2], 8: [4, 2], 9: [3, 3] }[perPage];
  const [COLS, ROWS] = layout;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Definição dinâmica do grid
  const MARGIN = 5; // 10mm de margem
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - MARGIN * 2;
  const usableHeight = pageHeight - MARGIN * 2;

  // Calcula o tamanho de cada "slot" na página
  const slotWidth = usableWidth / COLS;
  const slotHeight = usableHeight / ROWS;

  lote.items.forEach((item, i) => {
    if (i > 0 && i % perPage === 0) doc.addPage();
    const local = i % perPage;
    const r = Math.floor(local / COLS),
      c = local % COLS;

    // Posição X e Y do *slot* (canto superior esquerdo)
    const slotX = MARGIN + c * slotWidth;
    const slotY = MARGIN + r * slotHeight;

    // Usa a função de ajuda para calcular as dimensões corretas
    // 'item.width' e 'item.height' vêm do Passo 2  (addFiles)
    if(!item.width || !item.height) {
        console.warn("Item sem dimensões, pulando:", item.name);
        return; // Pula imagens quebradas ou de loads antigos
    }

    const fit = calculateAspectRatioFit(
      item.width,
      item.height,
      slotWidth,
      slotHeight
    );

    const fmt = item.type.includes("png") ? "PNG" : "JPEG";

    // Chamada final do addImage com proporção correta
    doc.addImage(
      item.dataURL,
      fmt,
      slotX + fit.x, // Posição X + offset de centralização
      slotY + fit.y, // Posição Y + offset de centralização
      fit.w,         // Largura correta (com proporção)
      fit.h          // Altura correta (com proporção)
    );
  });

  const pdfBlob = doc.output("blob");
  if (asZIP) {
    // Instancia o JSZip aqui
    const zip = new JSZip();
    zip.file(`${lote.name}.pdf`, pdfBlob);
    zip.generateAsync({ type: "blob" }).then((c) => {
      // Use a biblioteca FileSaver.js (que você já importou)
      saveAs(c, `${lote.name}.zip`);
    });
  } else {
    const url = URL.createObjectURL(pdfBlob);
    pdfPreview.src = url;
    previewModal.style.display = "flex"; // 'flex' ou 'block'
  }
}

// =======================================================
// FIM DAS CORREÇÕES
// =======================================================

closePreview.onclick = () => {
  previewModal.style.display = "none";
  pdfPreview.src = "about:blank"; // Limpa a URL para liberar memória
};
window.onclick = (e) => {
  if (e.target === previewModal) {
    previewModal.style.display = "none";
    pdfPreview.src = "about:blank";
  }
};

(function init() {
  loadLocal();
  renderAll();
})();