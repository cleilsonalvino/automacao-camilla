const { jsPDF } = window.jspdf;
const zip = new JSZip();

let lotes = [];
let activeId = null;

const addLoteBtn = document.getElementById('addLote');
const lotesListEl = document.getElementById('lotesList');
const loteTitleEl = document.getElementById('loteTitle');
const loteMetaEl = document.getElementById('loteMeta');
const renameBtn = document.getElementById('renameLote');
const deleteBtn = document.getElementById('deleteLote');
const fileInput = document.getElementById('fileInput');
const clearBtn = document.getElementById('clearLote');
const genPDFBtn = document.getElementById('genPDF');
const downloadZIPBtn = document.getElementById('downloadZIP');
const gridEl = document.getElementById('grid');
const dropzone = document.getElementById('dropzone');
const imgPerPageEl = document.getElementById('imgPerPage');
const progressBar = document.getElementById('progressBar');
const previewModal = document.getElementById('previewModal');
const pdfPreview = document.getElementById('pdfPreview');
const closePreview = document.getElementById('closePreview');

function uid(){ return Math.random().toString(36).slice(2)+Date.now().toString(36); }
function saveLocal(){ localStorage.setItem('lotesPDFv2', JSON.stringify(lotes.map(l=>({id:l.id,name:l.name,items:l.items,seen:[...l.seen]})))); }
function loadLocal(){
  const data = localStorage.getItem('lotesPDFv2');
  if(data){ lotes = JSON.parse(data).map(l=>({...l,seen:new Set(l.seen)})); activeId = lotes[0]?.id ?? null; }
  else { const id=uid(); lotes=[{id,name:'Lote 1',items:[],seen:new Set()}]; activeId=id; }
}

function ensureActiveUI(enabled){
  [fileInput,clearBtn,genPDFBtn,renameBtn,deleteBtn,downloadZIPBtn].forEach(b=>b.disabled=!enabled);
  dropzone.classList.toggle('disabled',!enabled);
}

function renderSidebar(){
  lotesListEl.innerHTML='';
  lotes.forEach(l=>{
    const div=document.createElement('div');
    div.className='lote'+(l.id===activeId?' active':'');
    div.onclick=()=>{activeId=l.id;renderAll();};
    div.innerHTML=`<h4>${l.name}</h4><div class="meta">${l.items.length} imagem(ns)</div>`;
    lotesListEl.appendChild(div);
  });
}

function renderMain(){
  const lote=lotes.find(l=>l.id===activeId);
  if(!lote){loteTitleEl.textContent='Selecione um lote';loteMetaEl.textContent='Nenhum ativo.';gridEl.innerHTML='';ensureActiveUI(false);return;}
  loteTitleEl.textContent=lote.name;
  loteMetaEl.textContent=`${lote.items.length} imagens.`;
  ensureActiveUI(true);
  gridEl.innerHTML='';
  lote.items.forEach((it,idx)=>{
    const c=document.createElement('div');
    c.className='thumb';
    c.innerHTML=`<img src="${it.dataURL}"><div class="x" data-idx="${idx}">×</div>`;
    gridEl.appendChild(c);
  });
  gridEl.querySelectorAll('.x').forEach(btn=>{
    btn.addEventListener('click',e=>{
      const i=+e.currentTarget.dataset.idx;
      lote.seen.delete(lote.items[i].name);
      lote.items.splice(i,1);
      saveLocal();renderAll();
    });
  });
}
function renderAll(){renderSidebar();renderMain();}

addLoteBtn.onclick=()=>{const id=uid();lotes.push({id,name:`Lote ${lotes.length+1}`,items:[],seen:new Set()});activeId=id;saveLocal();renderAll();};
renameBtn.onclick=()=>{const l=lotes.find(x=>x.id===activeId);if(!l)return;const n=prompt('Novo nome:',l.name);if(n){l.name=n;saveLocal();renderAll();}};
deleteBtn.onclick=()=>{const i=lotes.findIndex(x=>x.id===activeId);if(i<0)return;if(confirm('Excluir lote?')){lotes.splice(i,1);activeId=lotes[0]?.id??null;saveLocal();renderAll();}};
clearBtn.onclick=()=>{const l=lotes.find(x=>x.id===activeId);if(!l)return;if(confirm('Remover todas imagens?')){l.items=[];l.seen.clear();saveLocal();renderAll();}};

fileInput.onchange=async()=>{const l=lotes.find(x=>x.id===activeId);if(!l)return;await addFiles(l,Array.from(fileInput.files));fileInput.value='';};
['dragenter','dragover'].forEach(e=>dropzone.addEventListener(e,ev=>{ev.preventDefault();dropzone.classList.add('drag');}));
['dragleave','drop'].forEach(e=>dropzone.addEventListener(e,ev=>{ev.preventDefault();dropzone.classList.remove('drag');}));
dropzone.addEventListener('drop',async e=>{
  const l=lotes.find(x=>x.id===activeId);if(!l)return;
  const fs=Array.from(e.dataTransfer.files).filter(f=>f.type.startsWith('image/'));
  await addFiles(l,fs);
});

function fileToDataURL(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});}
async function compressImage(dataURL,maxW=800,maxH=800){
  const img=new Image();img.src=dataURL;
  await new Promise(r=>img.onload=r);
  const scale=Math.min(maxW/img.width,maxH/img.height,1);
  const c=document.createElement('canvas');
  c.width=img.width*scale;c.height=img.height*scale;
  const ctx=c.getContext('2d');ctx.drawImage(img,0,0,c.width,c.height);
  return c.toDataURL('image/jpeg',0.8);
}

async function addFiles(lote,files){
  progressBar.style.width='0%';
  for(let i=0;i<files.length;i++){
    const f=files[i];
    if(!f.type.startsWith('image/'))continue;
    if(lote.seen.has(f.name))continue;
    const dataURL=await fileToDataURL(f);
    const compressed=await compressImage(dataURL);
    lote.items.push({name:f.name,type:f.type,dataURL:compressed});
    lote.seen.add(f.name);
    progressBar.style.width=`${(i/files.length)*100}%`;
  }
  progressBar.style.width='100%';
  saveLocal();renderAll();
  setTimeout(()=>progressBar.style.width='0%',800);
}

genPDFBtn.onclick=()=>generatePDF(false);
downloadZIPBtn.onclick=()=>generatePDF(true);

function generatePDF(asZIP=false){
  const lote=lotes.find(l=>l.id===activeId);
  if(!lote||!lote.items.length){alert('Lote vazio.');return;}
  const perPage=parseInt(imgPerPageEl.value);
  const layout={4:[2,2],6:[3,2],8:[4,2],9:[3,3]}[perPage];
  const [COLS,ROWS]=layout;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const A4W=210,A4H=297,IMG_W=45,IMG_H=100,GAP_X=5,GAP_Y=5;
  const gridW=COLS*IMG_W+GAP_X*(COLS-1);
  const gridH=ROWS*IMG_H+GAP_Y*(ROWS-1);
  const startX=(A4W-gridW)/2,startY=(A4H-gridH)/2;

  lote.items.forEach((item,i)=>{
    if(i>0&&i%perPage===0)doc.addPage();
    const local=i%perPage;
    const r=Math.floor(local/COLS),c=local%COLS;
    const x=startX+c*(IMG_W+GAP_X),y=startY+r*(IMG_H+GAP_Y);
    const fmt=item.type.includes('png')?'PNG':'JPEG';
    doc.addImage(item.dataURL,fmt,x,y,IMG_W,IMG_H);
  });

  const pdfBlob=doc.output('blob');
  if(asZIP){
    zip.file(`${lote.name}.pdf`,pdfBlob);
    zip.generateAsync({type:'blob'}).then(c=>{
      saveAs(c,`${lote.name}.zip`);
      zip.remove(`${lote.name}.pdf`);
    });
  } else {
    const url=URL.createObjectURL(pdfBlob);
    pdfPreview.src=url;
    previewModal.style.display='flex';
  }
}

closePreview.onclick=()=>{previewModal.style.display='none';pdfPreview.src='';};
window.onclick=e=>{if(e.target===previewModal){previewModal.style.display='none';pdfPreview.src='';}};

(function init(){loadLocal();renderAll();})();
