// ============================================================
//  PixelEuro — Mobile-First Freiform-Paint-Canvas
//  1 Finger = malen · 2 Finger = zoomen/verschieben (immer).
//  Versetztes Fadenkreuz für Pixel-Präzision. Geste-Intent:
//  erst malen, wenn klar kein Pinch. Screen-space UI (neutral).
// ============================================================
let CFG = null;
let ADS = [];

const canvas = document.getElementById('grid');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvasWrap');
const world = document.getElementById('world');
const selBadge = document.getElementById('selBadge');
let brush = null; // Fadenkreuz-Element

const PALETTE = ['#122530', '#ffffff', '#e11d48', '#f59e0b', '#facc15',
                 '#16a34a', '#14c2da', '#2f6bff', '#7c3aed', '#ec4899'];
let activeColor = '#2f6bff';

let view = { s: 1, tx: 0, ty: 0 };
let baseW = 0, baseH = 0, cell = 0;
const MIN_S = 1, MAX_S = 40;
const TOUCH_OFFSET = 46;      // Zielzelle so weit ÜBER dem Finger (gegen Verdeckung)
const MOVE_THRESHOLD = 7;     // px Bewegung, ab der ein Tippen zum Strich wird

let mode = 'paint';           // 'paint' | 'move' | 'erase'
let erasing = false;

const painted = new Map();    // "x,y" -> color (Auswahl des Users)
const OWNED = new Map();      // "x,y" -> color (bereits belegte/verkaufte Zellen)
const undoStack = [];
let stroke = null;

// Gesten
const pointers = new Map();   // pointerId -> {x,y}
let pending = null;           // 1-Finger: {startX,startY,painting}
let panLast = null, pinchLast = null, lastCell = null;
let gestureWasMulti = false;  // sobald 2 Finger -> kein Malen bis alle los
let occMask = null;           // Uint8 Belegt-Maske (O(1))
let dirty = true;

// Bild-Upload: das Bild wird clientseitig auf das Pixelraster heruntergerechnet
// und landet als Farben in `painted` — hochgeladen wird nur das winzige Pixel-PNG,
// nie die große Originaldatei (deshalb sind MB kein Thema fürs Backend).
let imgBitmap = null;         // geladenes Bild
let imgCenter = null;         // {x,y} Zielzelle = Bildmitte
let imgCells = [];            // von diesem Bild gesetzte painted-Keys (Ersetzen/Entfernen)
const MAX_IMG_BYTES = 20 * 1024 * 1024; // Rohdatei-Obergrenze (nur Client, gegen Browser-Überlast)

init();

async function init() {
  CFG = await (await fetch('/api/config')).json();
  document.getElementById('siteName').textContent = CFG.siteName;
  const pp = document.getElementById('pricePer'); if (pp) pp.innerHTML = (CFG.pricePerPixel / 100).toFixed(0) + '&nbsp;€';
  const yr = document.getElementById('year'); if (yr) yr.textContent = '2026';

  canvas.width = CFG.gridW;
  canvas.height = CFG.gridH;
  occMask = new Uint8Array(CFG.gridW * CFG.gridH);

  // Fadenkreuz anlegen
  brush = document.createElement('div');
  brush.id = 'brush'; brush.className = 'brush hidden';
  wrap.appendChild(brush);

  buildPalette();
  layout();
  await loadAds();
  handleReturnFromStripe();
  wireToolbar();
  wireGestures();
  requestAnimationFrame(renderLoop);

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
}

// ---- Layout (Resize-sicher: tx/ty proportional mitskalieren) ----
function onResize() {
  const oldCell = cell || 1;
  layout(oldCell);
  dirty = true;
}
function layout(oldCell) {
  const w = wrap.clientWidth;
  baseW = w;
  baseH = w * (CFG.gridH / CFG.gridW);
  const newCell = baseW / CFG.gridW;
  if (oldCell && oldCell !== newCell) {
    const k = newCell / oldCell;
    view.tx *= k; view.ty *= k; // Blickfeld proportional halten
  }
  cell = newCell;
  world.style.width = baseW + 'px';
  world.style.height = baseH + 'px';
  wrap.style.height = Math.min(baseH, Math.max(320, window.innerHeight * 0.6)) + 'px';
  clampView();
  applyView();
}
function applyView() { world.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`; }
function clampView() {
  view.s = Math.max(MIN_S, Math.min(MAX_S, view.s));
  const vw = wrap.clientWidth, vh = wrap.clientHeight;
  const ww = baseW * view.s, wh = baseH * view.s;
  const minTx = Math.min(0, vw - ww), minTy = Math.min(0, vh - wh);
  view.tx = Math.max(minTx, Math.min(0, view.tx));
  view.ty = Math.max(minTy, Math.min(0, view.ty));
  if (ww < vw) view.tx = (vw - ww) / 2;
  if (wh < vh) view.ty = (vh - wh) / 2;
}

// ---- Koordinaten ----
function screenToCell(clientX, clientY) {
  const r = wrap.getBoundingClientRect();
  const gx = Math.floor((clientX - r.left - view.tx) / (cell * view.s));
  const gy = Math.floor((clientY - r.top - view.ty) / (cell * view.s));
  if (gx < 0 || gy < 0 || gx >= CFG.gridW || gy >= CFG.gridH) return null;
  return { x: gx, y: gy };
}
// Fadenkreuz an die Zielzelle setzen (screen-space)
function showBrush(c) {
  if (!c) { brush.classList.add('hidden'); return; }
  const cx = view.tx + (c.x + 0.5) * cell * view.s;
  const cy = view.ty + (c.y + 0.5) * cell * view.s;
  brush.style.left = cx + 'px'; brush.style.top = cy + 'px';
  brush.style.width = brush.style.height = Math.max(10, cell * view.s) + 'px';
  brush.classList.remove('hidden');
}

// ---- Daten ----
async function loadAds() {
  const data = await (await fetch('/api/ads')).json();
  ADS = data.ads || [];               // aktive Anzeigen (Bounding-Box) für Klick/Tooltip
  OWNED.clear(); occMask.fill(0);
  for (const p of (data.pixels || [])) {
    if (p.x >= 0 && p.y >= 0 && p.x < CFG.gridW && p.y < CFG.gridH) {
      OWNED.set(p.x + ',' + p.y, p.c || '#c6d4da');
      occMask[p.y * CFG.gridW + p.x] = 1;
    }
  }
  const sold = data.soldPixels || 0, total = data.totalPixels || (CFG.gridW * CFG.gridH);
  animateCount(document.getElementById('soldCount'), sold);
  animateCount(document.getElementById('freeCount'), total - sold);
  const pb = document.getElementById('progressBar'); if (pb) pb.style.width = (sold / total * 100) + '%';
  dirty = true;
}
function animateCount(el, target) {
  if (!el) return; const dur = 700, t0 = performance.now();
  (function step(now) { const p = Math.min(1, (now - t0) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString('en-US');
    if (p < 1) requestAnimationFrame(step); })(performance.now());
}

// ---- Rendering (pro-Pixel) ----
function occupied(gx, gy) { return occMask[gy * CFG.gridW + gx] === 1; }
function renderLoop() { if (dirty) { draw(); dirty = false; } requestAnimationFrame(renderLoop); }
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const [key, color] of OWNED) { const i = key.indexOf(','); ctx.fillStyle = color; ctx.fillRect(+key.slice(0, i), +key.slice(i + 1), 1, 1); }
  for (const [key, color] of painted) { const i = key.indexOf(','); ctx.fillStyle = color; ctx.fillRect(+key.slice(0, i), +key.slice(i + 1), 1, 1); }
}

// ---- Malen ----
function paintCell(gx, gy) {
  if (gx == null || gx < 0 || gy < 0 || gx >= CFG.gridW || gy >= CFG.gridH) return;
  if (occupied(gx, gy)) return;
  const key = gx + ',' + gy;
  const prev = painted.has(key) ? painted.get(key) : null;
  if (erasing) { if (prev === null) return; painted.delete(key); }
  else { if (prev === activeColor) return; painted.set(key, activeColor); }
  if (stroke) stroke.push({ key, prev });
  dirty = true; updateBadge();
}
function paintLine(a, b) {
  if (!a) { paintCell(b.x, b.y); return; }
  let x0 = a.x, y0 = a.y; const x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx - dy;
  for (;;) { paintCell(x0, y0); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 > -dy) { e -= dy; x0 += sx; } if (e2 < dx) { e += dx; y0 += sy; } }
}
function beginStroke() { stroke = []; }
function endStroke() { if (stroke && stroke.length) { undoStack.push(stroke); if (undoStack.length > 60) undoStack.shift(); } stroke = null; updateBadge(); }
function cancelStroke() { // verwerfen ohne Commit (z. B. wenn Pinch erkannt)
  if (stroke) { for (let i = stroke.length - 1; i >= 0; i--) { const { key, prev } = stroke[i]; if (prev === null) painted.delete(key); else painted.set(key, prev); } stroke = null; dirty = true; updateBadge(); }
}
function undo() { const s = undoStack.pop(); if (!s) return; for (let i = s.length - 1; i >= 0; i--) { const { key, prev } = s[i]; if (prev === null) painted.delete(key); else painted.set(key, prev); } dirty = true; updateBadge(); }
function clearAll() { if (!painted.size) return; undoStack.push([...painted].map(([key, c]) => ({ key, prev: c }))); painted.clear(); resetImageState(); dirty = true; updateBadge(); }

// ---- Bild-Upload -> Pixel ----
function viewCenterCell() {
  const r = wrap.getBoundingClientRect();
  return screenToCell(r.left + r.width / 2, r.top + r.height / 2) || { x: (CFG.gridW / 2) | 0, y: (CFG.gridH / 2) | 0 };
}
function resetImageState() {
  imgCells = []; imgBitmap = null; imgCenter = null;
  const ib = document.getElementById('imgBar'); if (ib) ib.classList.add('hidden');
}
async function onImagePicked(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';                                   // erneutes Wählen derselben Datei erlauben
  if (!file) return;
  if (!/^image\//.test(file.type)) { showBanner('Please choose an image file.', 'warn'); return; }
  if (file.size > MAX_IMG_BYTES) { showBanner('Image too large (max 20 MB). Please pick a smaller file.', 'warn'); return; }
  try { imgBitmap = await createImageBitmap(file); }
  catch { showBanner('Could not read that image.', 'warn'); return; }
  imgCenter = viewCenterCell();
  document.getElementById('imgBar').classList.remove('hidden');
  placeImage();
}
function removeImage() { for (const key of imgCells) painted.delete(key); resetImageState(); dirty = true; updateBadge(); }
function rgbToHex(r, g, b) { return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1); }
function placeImage() {
  if (!imgBitmap || !imgCenter) return;
  for (const key of imgCells) painted.delete(key);          // altes Bild ersetzen
  imgCells = [];
  const longest = Math.max(8, Math.min(120, +document.getElementById('imgSize').value || 44));
  const ar = imgBitmap.width / imgBitmap.height;
  let w = ar >= 1 ? longest : Math.round(longest * ar);
  let h = ar >= 1 ? Math.round(longest / ar) : longest;
  w = Math.max(1, Math.min(CFG.gridW, w)); h = Math.max(1, Math.min(CFG.gridH, h));
  const off = document.createElement('canvas'); off.width = w; off.height = h;
  const c = off.getContext('2d'); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(imgBitmap, 0, 0, w, h);
  const data = c.getImageData(0, 0, w, h).data;
  const ox = imgCenter.x - (w >> 1), oy = imgCenter.y - (h >> 1);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = (j * w + i) * 4;
    if (data[p + 3] < 128) continue;                        // transparent -> überspringen
    const gx = ox + i, gy = oy + j;
    if (gx < 0 || gy < 0 || gx >= CFG.gridW || gy >= CFG.gridH || occupied(gx, gy)) continue;
    const key = gx + ',' + gy;
    painted.set(key, rgbToHex(data[p], data[p + 1], data[p + 2]));
    imgCells.push(key);
  }
  dirty = true; updateBadge();
}

// ---- Preis-Badge (live) ----
function updateBadge() {
  const n = painted.size, buyBtn = document.getElementById('buyBtn');
  if (n === 0) { selBadge.classList.add('hidden'); buyBtn.disabled = true; buyBtn.textContent = 'Pick pixels to continue →'; return; }
  const price = (n * CFG.pricePerPixel / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  selBadge.textContent = `${n.toLocaleString('en-US')} px · ${price} €`;
  selBadge.classList.remove('hidden');
  buyBtn.disabled = false; buyBtn.textContent = `Buy ${n.toLocaleString('en-US')} px · ${price} € →`;
}

// ---- Palette / Toolbar ----
function buildPalette() {
  const p = document.getElementById('palette');
  PALETTE.forEach((c, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'swatch' + (c === activeColor ? ' active' : ''); b.style.background = c; b.dataset.color = c; b.setAttribute('aria-label', 'Color ' + (i + 1)); b.onclick = () => setColor(c); p.appendChild(b); });
  const custom = document.createElement('input'); custom.type = 'color'; custom.className = 'swatch custom'; custom.value = activeColor; custom.oninput = () => setColor(custom.value); custom.title = 'Custom color'; p.appendChild(custom);
}
function setColor(c) { activeColor = c; erasing = false; document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset && s.dataset.color === c)); setMode('paint'); }
function setMode(m) {
  mode = m; erasing = (m === 'erase');
  document.getElementById('modePaint').classList.toggle('active', m === 'paint');
  const mv = document.getElementById('modeMove'); if (mv) mv.classList.toggle('active', m === 'move');
  document.getElementById('modeErase').classList.toggle('active', m === 'erase');
  const hint = document.getElementById('modeHint');
  if (hint) hint.textContent = m === 'move' ? 'Drag to move · pinch to zoom.' : '1 finger paints · 2 fingers zoom & move.';
}
function wireToolbar() {
  document.getElementById('modePaint').onclick = () => setMode('paint');
  const mv = document.getElementById('modeMove'); if (mv) mv.onclick = () => setMode('move');
  document.getElementById('modeErase').onclick = () => setMode('erase');
  document.getElementById('zoomIn').onclick = () => zoomBy(1.6);
  document.getElementById('zoomOut').onclick = () => zoomBy(1 / 1.6);
  document.getElementById('undoBtn').onclick = undo;
  document.getElementById('clearBtn').onclick = clearAll;
  document.getElementById('buyBtn').onclick = openModal;
  document.getElementById('addImageBtn').onclick = () => document.getElementById('imgInput').click();
  document.getElementById('imgInput').onchange = onImagePicked;
  document.getElementById('imgSize').oninput = () => { document.getElementById('imgSizeVal').textContent = document.getElementById('imgSize').value + ' px'; placeImage(); };
  document.getElementById('imgPlaceHere').onclick = () => { imgCenter = viewCenterCell(); placeImage(); };
  document.getElementById('imgRemove').onclick = removeImage;
  const start = document.getElementById('startBuy'); if (start) start.onclick = goToWall;
  document.getElementById('modalClose').onclick = closeModal;
  document.getElementById('buyForm').onsubmit = submitOrder;
  setMode('paint');
}
function goToWall() { document.getElementById('wand').scrollIntoView({ behavior: 'smooth' }); }
function zoomBy(f, cx, cy) {
  const r = wrap.getBoundingClientRect();
  const ox = (cx == null ? r.width / 2 : cx - r.left), oy = (cy == null ? r.height / 2 : cy - r.top);
  const ns = Math.max(MIN_S, Math.min(MAX_S, view.s * f)), k = ns / view.s;
  view.tx = ox - (ox - view.tx) * k; view.ty = oy - (oy - view.ty) * k; view.s = ns;
  clampView(); applyView(); dirty = true;
}

// ---- Gesten (1 Finger malt, 2 Finger zoom/pan IMMER) ----
function wireGestures() {
  wrap.addEventListener('pointerdown', onDown);
  wrap.addEventListener('pointermove', onMove, { passive: false });
  wrap.addEventListener('pointerup', onUp);
  wrap.addEventListener('pointercancel', onUp);
}
function targetCell(e) {
  // Touch: Zielzelle versetzt ÜBER dem Finger (Finger verdeckt sie sonst)
  const off = e.pointerType === 'touch' ? TOUCH_OFFSET : 0;
  return screenToCell(e.clientX, e.clientY - off);
}
function onDown(e) {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { wrap.setPointerCapture(e.pointerId); } catch {}
  if (pointers.size === 2) { cancelStroke(); pending = null; painting(false); gestureWasMulti = true; startPinch(); return; }
  if (pointers.size > 2) return;
  // Erster Finger
  if (mode === 'move') { panLast = { x: e.clientX, y: e.clientY }; return; }
  gestureWasMulti = false;
  const c = targetCell(e);
  if (e.pointerType !== 'touch') { // Maus: sofort malen
    beginStroke(); lastCell = c; if (c) paintCell(c.x, c.y);
  } else { // Touch: erst Fadenkreuz, malen erst nach Schwelle (Pinch-Intent)
    pending = { startX: e.clientX, startY: e.clientY, painting: false };
    lastCell = c; showBrush(c);
  }
}
function painting(v) { if (pending) pending.painting = v; }
function onMove(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2) { doPinch(); return; }
  if (gestureWasMulti) return; // ein Finger noch unten nach Pinch -> nicht malen
  if (mode === 'move') { if (panLast) { view.tx += e.clientX - panLast.x; view.ty += e.clientY - panLast.y; panLast = { x: e.clientX, y: e.clientY }; clampView(); applyView(); } return; }
  e.preventDefault();
  const c = targetCell(e);
  showBrush(c);
  if (e.pointerType !== 'touch') { if (c) { paintLine(lastCell, c); lastCell = c; } return; }
  // Touch: ab Bewegungs-Schwelle malen
  if (pending && !pending.painting) {
    if (Math.abs(e.clientX - pending.startX) > MOVE_THRESHOLD || Math.abs(e.clientY - pending.startY) > MOVE_THRESHOLD) {
      pending.painting = true; beginStroke(); if (lastCell) paintCell(lastCell.x, lastCell.y);
    }
  }
  if (pending && pending.painting && c) { paintLine(lastCell, c); lastCell = c; }
}
function onUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchLast = null;
  if (pointers.size > 0) return; // noch Finger unten
  // alle Finger los
  if (gestureWasMulti) { gestureWasMulti = false; pending = null; lastCell = null; panLast = null; brush.classList.add('hidden'); return; }
  if (mode === 'move') { panLast = null; brush.classList.add('hidden'); return; }
  if (e.pointerType !== 'touch') { endStroke(); }
  else {
    if (pending && !pending.painting && lastCell) { beginStroke(); paintCell(lastCell.x, lastCell.y); endStroke(); } // Tap = 1 Pixel
    else if (pending && pending.painting) endStroke();
  }
  pending = null; lastCell = null; brush.classList.add('hidden');
}
function twoPts() { return [...pointers.values()].slice(0, 2); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function startPinch() { const [p, q] = twoPts(); if (p && q) pinchLast = { d: dist(p, q), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 }; }
function doPinch() {
  const [p, q] = twoPts(); if (!p || !q) return;
  const d = dist(p, q), mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  if (!pinchLast) { pinchLast = { d, mx, my }; return; }
  const r = wrap.getBoundingClientRect();
  const ns = Math.max(MIN_S, Math.min(MAX_S, view.s * (d / (pinchLast.d || d)))), k = ns / view.s;
  const ox = pinchLast.mx - r.left, oy = pinchLast.my - r.top;
  view.tx = ox - (ox - view.tx) * k; view.ty = oy - (oy - view.ty) * k; view.s = ns;
  view.tx += mx - pinchLast.mx; view.ty += my - pinchLast.my;
  pinchLast = { d, mx, my }; clampView(); applyView(); dirty = true;
}

// ---- Bounding-Box + Rasterung + Bestellung ----
function boundingBox() { let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1; for (const key of painted.keys()) { const i = key.indexOf(','); const x = +key.slice(0, i), y = +key.slice(i + 1); if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; } return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }; }
function rasterize() { const bb = boundingBox(); const off = document.createElement('canvas'); off.width = bb.w; off.height = bb.h; const c = off.getContext('2d'); for (const [key, color] of painted) { const i = key.indexOf(','); c.fillStyle = color; c.fillRect(+key.slice(0, i) - bb.x, +key.slice(i + 1) - bb.y, 1, 1); } return new Promise((res) => off.toBlob((b) => res({ blob: b, bb }), 'image/png')); }
function cellsPayload() { return [...painted].map(([key, color]) => { const i = key.indexOf(','); return { x: +key.slice(0, i), y: +key.slice(i + 1), c: color }; }); }

function openModal() {
  if (!painted.size) return;
  const n = painted.size, price = n * CFG.pricePerPixel / 100, min = (CFG.minOrderCents || 0) / 100;
  document.getElementById('selPixels').textContent = n.toLocaleString('en-US');
  document.getElementById('selPrice').textContent = price.toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' €';
  const err = document.getElementById('formError'), pay = document.getElementById('payBtn');
  if (price < min) { err.textContent = `Minimum order ${min.toFixed(2)} € – please pick more pixels.`; err.classList.remove('hidden'); pay.disabled = true; }
  else { err.classList.add('hidden'); pay.disabled = false; }
  document.getElementById('buyModal').classList.remove('hidden');
}
function closeModal() { document.getElementById('buyModal').classList.add('hidden'); }

async function submitOrder(e) {
  e.preventDefault();
  const err = document.getElementById('formError'), btn = document.getElementById('payBtn');
  const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Continue to payment →'; };
  err.classList.add('hidden'); btn.disabled = true; btn.textContent = 'Preparing…';
  try {
    if (!painted.size) return fail('Please paint some pixels first.');
    const { blob, bb } = await rasterize();
    const fd = new FormData();
    fd.append('x', bb.x); fd.append('y', bb.y); fd.append('w', bb.w); fd.append('h', bb.h);
    fd.append('pixels', String(painted.size));
    fd.append('cells', JSON.stringify(cellsPayload()));
    fd.append('image', blob, 'design.png');
    fd.append('link', document.getElementById('linkInput').value);
    fd.append('title', document.getElementById('titleInput').value);
    fd.append('email', document.getElementById('emailInput').value);
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 45000);
    let res; try { res = await fetch('/api/orders', { method: 'POST', body: fd, signal: ctrl.signal }); } finally { clearTimeout(to); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return fail(data.error || `Error (${res.status}). Please try again.`);
    if (!data.checkoutUrl) return fail('No checkout link received. Please try again.');
    window.location.href = data.checkoutUrl;
  } catch (e2) { fail(e2.name === 'AbortError' ? 'Upload took too long — try fewer pixels or a better connection.' : (e2.message || 'Something went wrong.')); }
}

function handleReturnFromStripe() {
  const p = new URLSearchParams(location.search);
  if (p.get('success')) celebrate();
  if (p.get('canceled')) { const adId = p.get('ad'); if (adId) fetch('/api/orders/release', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adId: Number(adId) }) }).then(() => loadAds()).catch(() => {}); showBanner('Payment canceled – your reserved area has been released.', 'warn'); }
  if (p.get('success') || p.get('canceled')) history.replaceState({}, '', '/');
}
function celebrate() {
  confettiBurst();
  const ov = document.createElement('div'); ov.className = 'success-ov';
  ov.innerHTML = `<div class="success-box"><img src="/logo.svg" alt="Pixi" /><h3>You're in! 🎉</h3><p>Your pixels are secured – forever on the internet. They appear on the wall after a short review.</p><button class="cta" id="shareBtn">Share 🟦</button><button class="ghost" id="successClose">To the wall</button></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#shareBtn').onclick = sharePixel; ov.querySelector('#successClose').onclick = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
}
function sharePixel() { const data = { title: 'PixelEuro', text: 'I just grabbed my pixels on pixeleuro.de – forever on the internet! 🟦', url: 'https://pixeleuro.de' }; if (navigator.share) navigator.share(data).catch(() => {}); else if (navigator.clipboard) { navigator.clipboard.writeText(data.text + ' ' + data.url); alert('Link copied – now share it!'); } else window.open('https://pixeleuro.de', '_blank'); }
function confettiBurst() { const colors = ['#14c2da', '#2f6bff', '#FFCB3A', '#16a34a', '#d4537e']; for (let i = 0; i < 90; i++) { const c = document.createElement('div'); c.className = 'confetti-pc'; c.style.left = Math.random() * 100 + 'vw'; c.style.background = colors[i % colors.length]; c.style.animationDuration = (2 + Math.random() * 2) + 's'; c.style.animationDelay = (Math.random() * 0.6) + 's'; document.body.appendChild(c); setTimeout(() => c.remove(), 4200); } }
function showBanner(text, kind) { const b = document.createElement('div'); b.className = 'banner ' + kind; b.textContent = text; document.body.prepend(b); setTimeout(() => b.remove(), 9000); }
