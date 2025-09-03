// server.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- util: mm -> pt ----
const mm2pt = (mm) => (mm * 72) / 25.4;

// ---- constantes de layout A4 + grid 4x2, 45x100 mm ----
const A4W = mm2pt(210);
const A4H = mm2pt(297);
const IMG_W = mm2pt(45.0);
const IMG_H = mm2pt(100.0);
const COLS = 4;
const ROWS = 2;
const GAP_X = mm2pt(5);
const GAP_Y = mm2pt(5);
const perPage = COLS * ROWS;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(cors());
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

// ------- helpers de manifesto (deduplicação por nome) -------
function manifestPath(batchId) {
  return path.join(UPLOADS_DIR, batchId, 'manifest.json');
}
function readManifest(batchId) {
  try {
    const p = manifestPath(batchId);
    if (!fs.existsSync(p)) return { originalNames: [] };
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { originalNames: [] };
  }
}
function writeManifest(batchId, data) {
  const p = manifestPath(batchId);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

// ------- Multer (salva arquivos fisicamente; dedupe é pós-upload) -------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let batchId = req.query.batchId || req.headers['x-batch-id'];
    if (!batchId) {
      batchId = uuidv4();
      req.batchId = batchId;
    } else {
      req.batchId = batchId;
    }
    const dir = path.join(UPLOADS_DIR, batchId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // mantém nome único físico, mas guardaremos o original no manifesto
    const ext = path.extname(file.originalname) || '.jpg';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024, files: 400 } });

// ------- rota de upload com dedupe por nome original -------
app.post('/upload', upload.array('images', 400), (req, res) => {
  const batchId = req.batchId;
  const dir = path.join(UPLOADS_DIR, batchId);
  const manifest = readManifest(batchId);

  const accepted = [];
  const skipped = []; // duplicadas por nome original

  (req.files || []).forEach(f => {
    const already = manifest.originalNames.includes(f.originalname);
    if (already) {
      // duplicata: apagar arquivo salvo e marcar como skipped
      try { fs.unlinkSync(f.path); } catch {}
      skipped.push(f.originalname);
    } else {
      manifest.originalNames.push(f.originalname);
      accepted.push({
        originalname: f.originalname,
        savedAs: path.basename(f.path),
        url: `/uploads/${batchId}/${path.basename(f.path)}`
      });
    }
  });

  writeManifest(batchId, manifest);

  res.json({
    ok: true,
    batchId,
    acceptedCount: accepted.length,
    skippedCount: skipped.length,
    skippedNames: skipped,
    accepted
  });
});

// ------- listar arquivos do lote (por ordem de upload) -------
app.get('/list/:batchId', (req, res) => {
  const { batchId } = req.params;
  const dir = path.join(UPLOADS_DIR, batchId);
  if (!fs.existsSync(dir)) return res.status(404).json({ ok: false, error: 'Lote não encontrado' });

  // lista apenas os arquivos de imagem (exclui manifest.json)
  const files = fs.readdirSync(dir)
    .filter(fn => fn !== 'manifest.json')
    .map(fn => ({ fn, full: path.join(dir, fn), stat: fs.statSync(path.join(dir, fn)) }))
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)
    .map(x => x.fn);

  const manifest = readManifest(batchId);
  res.json({ ok: true, batchId, count: files.length, files, originalNames: manifest.originalNames });
});

// ------- gerar PDF (funciona mesmo com < 8 imagens) -------
app.get('/pdf/:batchId', (req, res) => {
  const { batchId } = req.params;
  const dir = path.join(UPLOADS_DIR, batchId);
  if (!fs.existsSync(dir)) return res.status(404).send('Lote não encontrado.');

  const files = fs.readdirSync(dir)
    .filter(fn => fn !== 'manifest.json')
    .map(fn => ({ fn, full: path.join(dir, fn), stat: fs.statSync(path.join(dir, fn)) }))
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)
    .map(x => x.full);

  if (files.length === 0) return res.status(400).send('Nenhuma imagem no lote.');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="conversas-${batchId}.pdf"`);

  const doc = new PDFDocument({ size: [A4W, A4H], margin: 0 });
  doc.pipe(res);

  // centraliza o grid 4x2 dentro do A4
  const gridW = (IMG_W * COLS) + (GAP_X * (COLS - 1));
  const gridH = (IMG_H * ROWS) + (GAP_Y * (ROWS - 1));
  const startX = (A4W - gridW) / 2;
  const startY = (A4H - gridH) / 2;

  files.forEach((filePath, i) => {
    if (i > 0 && i % perPage === 0) doc.addPage({ size: [A4W, A4H], margin: 0 });

    const local = i % perPage;
    const row = Math.floor(local / COLS);
    const col = local % COLS;

    const x = startX + col * (IMG_W + GAP_X);
    const y = startY + row * (IMG_H + GAP_Y);

    doc.image(filePath, x, y, { width: IMG_W, height: IMG_H });
  });

  doc.end();
});

app.get('/', (_, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
