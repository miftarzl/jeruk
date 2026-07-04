/**
 * CitrusScan — Detection Engine (app.js)
 * Model: YOLOv8 via TensorFlow.js
 * Classes: 0=Matang Pohon/Oranye, 1=Mentah/Hijau, 2=Setengah Matang/Hijau Kekuningan
 */

'use strict';

// ─── Config ───────────────────────────────────────────────────────────────────
const MODEL_PATH    = './model_jeruk_tfjs/model.json';
const INPUT_SIZE    = 640;
const CONF_THRESH   = 0.35;
const IOU_THRESH    = 0.45;
const MAX_DET       = 50;

const CLASS_META = [
  { name: 'Matang Pohon',        sub: 'Oranye',             emoji: '🟠', badge: 'badge-matang',   color: '#F97316' },
  { name: 'Mentah',              sub: 'Hijau',              emoji: '🟢', badge: 'badge-mentah',   color: '#16A34A' },
  { name: 'Setengah Matang',     sub: 'Hijau Kekuningan',   emoji: '🟡', badge: 'badge-setengah', color: '#CA8A04' },
];

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const statusEl       = document.getElementById('model-status');
const statusText     = document.getElementById('status-text');
const btnUpload      = document.getElementById('btn-upload');
const btnKamera      = document.getElementById('btn-kamera');
const btnStopCam     = document.getElementById('btn-stop-camera');
const btnHapus       = document.getElementById('btn-hapus-gambar');
const fileInput      = document.getElementById('file-input');
const dropzone       = document.getElementById('dropzone');
const placeholder    = document.getElementById('dropzone-placeholder');
const canvas         = document.getElementById('detection-canvas');
const overlayCanvas  = document.getElementById('overlay-canvas');
const videoEl        = document.getElementById('camera-feed');
const camControls    = document.getElementById('camera-controls');
const imageControls  = document.getElementById('image-controls');
const resultEmpty    = document.getElementById('result-empty');
const resultItems    = document.getElementById('result-items');
const resultStats    = document.getElementById('result-stats');
const statTotal      = document.getElementById('stat-total');
const statTime       = document.getElementById('stat-time');
const toast          = document.getElementById('toast');
const navbar         = document.getElementById('navbar');


// ─── State ────────────────────────────────────────────────────────────────────
let model           = null;
let cameraStream    = null;
let camAnimId       = null;
let isProcessing    = false;
let lastInferenceTs = 0;
const INFERENCE_INTERVAL = 150; // ms antara setiap inferensi

// ─── Navbar scroll ────────────────────────────────────────────────────────────
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 10);
});

// ─── Load Model ───────────────────────────────────────────────────────────────
async function loadModel() {
  setStatus('loading', 'Memuat Model...');
  try {
    model = await tf.loadGraphModel(MODEL_PATH);
    // Warm up
    const dummy = tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3]);
    const warmup = model.predict(dummy);
    tf.dispose([dummy, warmup]);
    setStatus('ready', 'Model Siap Digunakan');
    showToast('✅ Model berhasil dimuat!');
  } catch (e) {
    console.error('Model load error:', e);
    setStatus('error', 'Gagal Memuat Model');
    showToast('❌ Gagal memuat model. Cek konsol.');
  }
}

function setStatus(state, text) {
  statusEl.className = 'model-status';
  if (state === 'loading') statusEl.classList.add('loading');
  if (state === 'error')   statusEl.classList.add('error');
  statusText.textContent = text;
}

// ─── Upload Gambar ────────────────────────────────────────────────────────────
btnUpload.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) processImageFile(e.target.files[0]);
  fileInput.value = '';
});

// Drag & Drop
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) processImageFile(file);
  else showToast('⚠️ Mohon unggah file gambar.');
});
dropzone.addEventListener('click', e => {
  if (e.target === dropzone || e.target.closest('.dropzone-placeholder')) fileInput.click();
});

async function processImageFile(file) {
  if (!model) { showToast('⏳ Model masih dimuat, harap tunggu...'); return; }
  if (isProcessing) return;

  stopCamera();

  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = async () => {
    URL.revokeObjectURL(url);
    showCanvas();
    drawImageToCanvas(img);
    await runDetection(img);
  };
  img.src = url;
}

// ─── Kamera Real-time ─────────────────────────────────────────────────────────
btnKamera.addEventListener('click', startCamera);
btnStopCam.addEventListener('click', stopCamera);

async function startCamera() {
  if (!model) { showToast('⏳ Model masih dimuat...'); return; }
  try {
    // Coba dengan constraint ideal dulu, fallback ke video:true jika gagal
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }
      });
    } catch (_) {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
    }

    videoEl.srcObject = cameraStream;

    // Tunggu metadata dengan timeout 5 detik
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('Timeout memuat video')), 5000);
      videoEl.onloadedmetadata = () => { clearTimeout(timer); res(); };
    });
    videoEl.play();

    // Siapkan overlay canvas di atas video
    overlayCanvas.width  = videoEl.videoWidth  || 640;
    overlayCanvas.height = videoEl.videoHeight || 480;
    overlayCanvas.hidden = false;
    videoEl.hidden = false;
    canvas.hidden = true;
    placeholder.style.display = 'none';
    camControls.hidden = false;

    // Reset panel hasil
    resultEmpty.hidden = false;
    resultEmpty.textContent = 'Mendeteksi...';
    resultItems.hidden = true;
    resultStats.hidden = true;

    showToast('🎥 Deteksi real-time aktif!');
    startRealtimeLoop();
  } catch (err) {
    showToast('❌ Tidak bisa mengakses kamera: ' + err.message);
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  if (camAnimId) { cancelAnimationFrame(camAnimId); camAnimId = null; }
  videoEl.hidden = true;
  overlayCanvas.hidden = true;
  camControls.hidden = true;
  isProcessing = false;
}

function startRealtimeLoop() {
  async function loop(timestamp) {
    // Hentikan jika kamera sudah dimatikan
    if (!cameraStream) return;

    camAnimId = requestAnimationFrame(loop);

    // Throttle: jalankan inferensi hanya setiap INFERENCE_INTERVAL ms
    if (timestamp - lastInferenceTs < INFERENCE_INTERVAL) return;
    if (isProcessing) return;
    if (videoEl.readyState < 2) return; // Pastikan video siap

    lastInferenceTs = timestamp;
    isProcessing = true;

    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) { isProcessing = false; return; }

    // Sinkronisasi ukuran overlay canvas dengan video
    if (overlayCanvas.width !== vw || overlayCanvas.height !== vh) {
      overlayCanvas.width  = vw;
      overlayCanvas.height = vh;
    }

    const t0 = performance.now();

    try {
      const inputTensor = tf.tidy(() => {
        const frame     = tf.browser.fromPixels(videoEl);
        const resized   = tf.image.resizeBilinear(frame, [INPUT_SIZE, INPUT_SIZE]);
        const norm      = resized.div(255.0);
        return norm.expandDims(0);
      });

      const rawOutput  = model.predict(inputTensor);
      const detections = await postprocess(rawOutput, vw, vh);
      const elapsed    = (performance.now() - t0).toFixed(0);

      tf.dispose([inputTensor, rawOutput]);

      // Gambar kotak deteksi ke overlay canvas
      drawRealtimeDetections(detections, vw, vh);
      renderResults(detections, elapsed);
    } catch (err) {
      console.error('Realtime inference error:', err);
    }

    isProcessing = false;
  }

  camAnimId = requestAnimationFrame(loop);
}

function drawRealtimeDetections(detections, vw, vh) {
  // Gunakan ukuran tampilan CSS untuk koordinat yang tepat
  const dw = videoEl.offsetWidth  || vw;
  const dh = videoEl.offsetHeight || vh;
  overlayCanvas.width  = dw;
  overlayCanvas.height = dh;

  const scaleX = dw / vw;
  const scaleY = dh / vh;

  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, dw, dh);

  detections.forEach(det => {
    const meta = CLASS_META[det.classId] || CLASS_META[0];
    const x1 = det.x1 * scaleX, y1 = det.y1 * scaleY;
    const bw = (det.x2 - det.x1) * scaleX, bh = (det.y2 - det.y1) * scaleY;

    // Kotak
    ctx.strokeStyle = meta.color;
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.roundRect(x1, y1, bw, bh, 6);
    ctx.stroke();

    // Fill semi-transparan
    ctx.fillStyle = meta.color + '22';
    ctx.fillRect(x1, y1, bw, bh);

    // Label
    const label = `${meta.emoji} ${meta.name} ${(det.score * 100).toFixed(0)}%`;
    ctx.font = 'bold 12px Inter, sans-serif';
    const tw = ctx.measureText(label).width;
    const lh = 20, lp = 6;
    const lx = x1;
    const ly = y1 - lh - 2 < 0 ? y1 + 2 : y1 - lh - 2;

    ctx.fillStyle = meta.color;
    ctx.beginPath();
    ctx.roundRect(lx, ly, tw + lp * 2, lh, 4);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.fillText(label, lx + lp, ly + 14);
  });
}

// ─── Inference ────────────────────────────────────────────────────────────────
async function runDetection(imgSrc) {
  if (isProcessing) return;
  isProcessing = true;

  showLoading();
  clearResults();

  const t0 = performance.now();

  try {
    const inputTensor = preprocessImage(imgSrc);
    const rawOutput   = model.predict(inputTensor);
    const detections  = await postprocess(rawOutput, imgSrc.naturalWidth || imgSrc.width, imgSrc.naturalHeight || imgSrc.height);

    const elapsed = (performance.now() - t0).toFixed(0);

    drawDetections(imgSrc, detections);
    renderResults(detections, elapsed);

    tf.dispose([inputTensor, rawOutput]);
  } catch (err) {
    console.error('Inference error:', err);
    showToast('❌ Terjadi kesalahan saat deteksi.');
    renderResults([], '–');
  }

  hideLoading();
  isProcessing = false;
}

function preprocessImage(img) {
  return tf.tidy(() => {
    const imgTensor = tf.browser.fromPixels(img);
    const resized   = tf.image.resizeBilinear(imgTensor, [INPUT_SIZE, INPUT_SIZE]);
    const normalized = resized.div(255.0);
    return normalized.expandDims(0); // [1, 640, 640, 3]
  });
}

async function postprocess(rawOutput, origW, origH) {
  // YOLOv8 output shape: [1, 84, 8400] (or [1, num_classes+4, anchors])
  const outputData = await rawOutput.array();
  const batch = outputData[0]; // [num_outputs, anchors]

  const numClasses  = batch.length - 4;
  const numAnchors  = batch[0].length;

  const boxes = []; const scores = []; const classIds = [];

  const scaleX = origW / INPUT_SIZE;
  const scaleY = origH / INPUT_SIZE;

  for (let a = 0; a < numAnchors; a++) {
    const cx = batch[0][a];
    const cy = batch[1][a];
    const w  = batch[2][a];
    const h  = batch[3][a];

    let maxScore = -Infinity, maxCls = 0;
    for (let c = 0; c < numClasses; c++) {
      if (batch[4 + c][a] > maxScore) {
        maxScore = batch[4 + c][a];
        maxCls   = c;
      }
    }

    if (maxScore < CONF_THRESH) continue;

    // Convert cx,cy,w,h (relative to INPUT_SIZE) → x1,y1,x2,y2 (pixel in original image)
    const x1 = (cx - w / 2) * scaleX;
    const y1 = (cy - h / 2) * scaleY;
    const x2 = (cx + w / 2) * scaleX;
    const y2 = (cy + h / 2) * scaleY;

    boxes.push([y1 / origH, x1 / origW, y2 / origH, x2 / origW]); // normalized for tf.image.nonMaxSuppression
    scores.push(maxScore);
    classIds.push(maxCls);
  }

  if (boxes.length === 0) return [];

  // NMS
  const boxesTensor  = tf.tensor2d(boxes);
  const scoresTensor = tf.tensor1d(scores);
  const indices      = await tf.image.nonMaxSuppressionAsync(boxesTensor, scoresTensor, MAX_DET, IOU_THRESH, CONF_THRESH);
  const idxArr       = await indices.array();
  tf.dispose([boxesTensor, scoresTensor, indices]);

  return idxArr.map(i => ({
    classId:  classIds[i],
    score:    scores[i],
    x1: boxes[i][1] * origW,
    y1: boxes[i][0] * origH,
    x2: boxes[i][3] * origW,
    y2: boxes[i][2] * origH,
  }));
}

// ─── Drawing ──────────────────────────────────────────────────────────────────
function drawImageToCanvas(img) {
  const ctx = canvas.getContext('2d');
  const maxW = dropzone.clientWidth  || 600;
  const maxH = 480;
  const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  canvas.width  = img.naturalWidth  * ratio;
  canvas.height = img.naturalHeight * ratio;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}

function drawDetections(img, detections) {
  const ctx = canvas.getContext('2d');
  const maxW = dropzone.clientWidth  || 600;
  const maxH = 480;
  const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  canvas.width  = img.naturalWidth  * ratio;
  canvas.height = img.naturalHeight * ratio;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  detections.forEach(det => {
    const meta  = CLASS_META[det.classId] || CLASS_META[0];
    const x1 = det.x1 * ratio, y1 = det.y1 * ratio;
    const x2 = det.x2 * ratio, y2 = det.y2 * ratio;
    const bw = x2 - x1, bh = y2 - y1;

    // Box
    ctx.strokeStyle = meta.color;
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.roundRect(x1, y1, bw, bh, 6);
    ctx.stroke();

    // Fill semi-transparent
    ctx.fillStyle = meta.color + '22';
    ctx.fillRect(x1, y1, bw, bh);

    // Label background
    const label = `${meta.emoji} ${meta.name} ${(det.score * 100).toFixed(0)}%`;
    ctx.font = 'bold 11px Inter, sans-serif';
    const tw = ctx.measureText(label).width;
    const lh = 18, lp = 5;
    const lx = x1, ly = y1 - lh - 2;
    const drawLy = ly < 0 ? y1 + 2 : ly;

    ctx.fillStyle = meta.color;
    ctx.beginPath();
    ctx.roundRect(lx, drawLy, tw + lp * 2, lh, 4);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.fillText(label, lx + lp, drawLy + 13);
  });
}

// ─── Results Panel ────────────────────────────────────────────────────────────
function renderResults(detections, elapsed) {
  const isRealtime = !!cameraStream;
  resultItems.innerHTML = '';

  if (detections.length === 0) {
    resultEmpty.hidden = false;
    resultEmpty.textContent = isRealtime ? 'Mendeteksi...' : 'Tidak ada jeruk terdeteksi.';
    resultItems.hidden = true;
    resultStats.hidden = true;
    if (!isRealtime) showToast('🔍 Tidak ada jeruk terdeteksi. Coba gambar lain.');
    return;
  }

  resultEmpty.hidden = true;
  resultItems.hidden = false;
  resultStats.hidden = false;

  // Group by class
  const grouped = {};
  detections.forEach(d => {
    grouped[d.classId] = (grouped[d.classId] || []);
    grouped[d.classId].push(d);
  });

  Object.entries(grouped).forEach(([cid, dets]) => {
    const meta   = CLASS_META[parseInt(cid)] || CLASS_META[0];
    const avgConf = dets.reduce((s, d) => s + d.score, 0) / dets.length;

    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <span class="result-item-emoji">${meta.emoji}</span>
      <div class="result-item-info">
        <div class="result-item-class">${meta.name} <span style="font-weight:400;color:var(--text-mid)">/ ${meta.sub}</span></div>
        <div class="result-item-conf">Kepercayaan rata-rata: ${(avgConf * 100).toFixed(1)}%</div>
      </div>
      <span class="result-item-badge ${meta.badge}">${dets.length}x</span>
    `;
    resultItems.appendChild(item);
  });

  statTotal.textContent = detections.length;
  statTime.textContent  = elapsed + ' ms';

  if (!isRealtime) showToast(`✅ ${detections.length} objek terdeteksi!`);
}

function clearResults() {
  resultEmpty.hidden = false;
  resultEmpty.textContent = 'Mendeteksi...';
  resultItems.hidden = true;
  resultItems.innerHTML = '';
  resultStats.hidden = true;
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────
function showCanvas() {
  canvas.hidden = false;
  placeholder.style.display = 'none';
  videoEl.hidden = true;
  overlayCanvas.hidden = true;
  imageControls.hidden = false;
}

function resetImage() {
  // Bersihkan canvas
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.hidden = true;

  // Tampilkan kembali placeholder
  placeholder.style.display = '';

  // Sembunyikan tombol hapus
  imageControls.hidden = true;

  // Reset panel hasil
  resultEmpty.hidden = false;
  resultEmpty.textContent = 'Belum ada deteksi...';
  resultItems.hidden = true;
  resultItems.innerHTML = '';
  resultStats.hidden = true;

  showToast('🗑️ Gambar dihapus.');
}

btnHapus.addEventListener('click', resetImage);

let loadingEl = null;
function showLoading() {
  if (loadingEl) return;
  loadingEl = document.createElement('div');
  loadingEl.className = 'loading-overlay';
  loadingEl.innerHTML = '<div class="spinner"></div>';
  dropzone.appendChild(loadingEl);
}
function hideLoading() {
  if (loadingEl) { loadingEl.remove(); loadingEl = null; }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
loadModel();
