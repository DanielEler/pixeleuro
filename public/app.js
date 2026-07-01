// ============================================================
//  PixelEuro — Million-Dollar-Homepage-Modell (Block-Platzierung)
//  Die ganze Wand ist sichtbar. Kunde lädt sein Bild hoch, ZIEHT es
//  frei über die Wand (rastet aufs Raster), kauft den GANZEN
//  Rechteck-Block. Belegte Pixel blockieren (kein Überlappen):
//  Client markiert Kollisionen rot + sperrt den Kauf, die DB
//  (PRIMARY KEY x,y) verhindert Doppelverkauf endgültig.
//  1 Finger auf Block = ziehen · 1 Finger daneben = Wand schieben ·
//  2 Finger = zoomen/verschieben.
// ============================================================
let CFG = null;
let ADS = [];

const canvas = document.getElementById('grid');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvasWrap');
const world = document.getElementById('world');
const selBadge = document.getElementById('selBadge');

let view = { s: 1, tx: 0, ty: 0 };
let baseW = 0, baseH = 0, cell = 0;
const MIN_S = 1, MAX_S = 40;

const OWNED = new Map();      // "x,y" -> color (bereits belegte/verkaufte Zellen)
let occMask = null;           // Uint8 Belegt-Maske (O(1))
let dirty = true;

// --- Der platzierte Bild-Block (genau einer) ---
//  block = { bitmap, w, h, gx, gy, colors:[hex...], valid:bool }
//  Es wird der GANZE Rechteck-Block gekauft; transparente Bildstellen -> Weiß.
let block = null;
const MAX_IMG_BYTES = 20 * 1024 * 1024; // Rohdatei-Obergrenze (nur Client, gegen Browser-Überlast)

// Zeitlich begrenzte Hervorhebung (Permalink „dein Fleck")
let highlight = null;         // { x, y, w, h, until }

// Gesten
const pointers = new Map();   // pointerId -> {x,y}
let dragging = null;          // Block ziehen: { offX, offY } in Grid-Koordinaten
let panLast = null;           // Wand schieben
let pinchLast = null;
let gestureWasMulti = false;

init();

async function init() {
  CFG = await (await fetch('/api/config')).json();
  document.getElementById('siteName').textContent = CFG.siteName;
  const pp = document.getElementById('pricePer'); if (pp) pp.innerHTML = (CFG.pricePerPixel / 100).toFixed(0) + '&nbsp;€';
  const yr = document.getElementById('year'); if (yr) yr.textContent = '2026';

  canvas.width = CFG.gridW;
  canvas.height = CFG.gridH;
  occMask = new Uint8Array(CFG.gridW * CFG.gridH);

  layout();
  await loadAds();
  handleReturnFromStripe();
  wireToolbar();
  wireGestures();
  handlePermalink();
  updateBadge();                 // korrekter Anfangstext ("Add an image to continue")
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
  // Ganze Wand sichtbar lassen (MDH-Gefühl): Höhe = volle Wandhöhe,
  // gedeckelt, damit sie auf großen Screens nicht die Seite sprengt.
  wrap.style.height = Math.min(baseH, Math.max(320, window.innerHeight * 0.72)) + 'px';
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
function screenToCellF(clientX, clientY) {   // Grid-Koordinate als Float
  const r = wrap.getBoundingClientRect();
  return {
    x: (clientX - r.left - view.tx) / (cell * view.s),
    y: (clientY - r.top - view.ty) / (cell * view.s),
  };
}
function viewCenterCell() {
  const r = wrap.getBoundingClientRect();
  const f = screenToCellF(r.left + r.width / 2, r.top + r.height / 2);
  return { x: Math.round(f.x), y: Math.round(f.y) };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- Daten ----
async function loadAds() {
  const data = await (await fetch('/api/ads')).json();
  ADS = data.ads || [];
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
  if (block) computeValid();
  dirty = true;
}
function animateCount(el, target) {
  if (!el) return; const dur = 700, t0 = performance.now();
  (function step(now) { const p = Math.min(1, (now - t0) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString('en-US');
    if (p < 1) requestAnimationFrame(step); })(performance.now());
}

// ---- Rendering ----
function occupied(gx, gy) { return occMask[gy * CFG.gridW + gx] === 1; }
function renderLoop() {
  if (highlight && performance.now() < highlight.until) dirty = true;
  else if (highlight) { highlight = null; dirty = true; }
  if (dirty) { draw(); dirty = false; }
  requestAnimationFrame(renderLoop);
}
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // 1) belegte Zellen
  for (const [key, color] of OWNED) { const i = key.indexOf(','); ctx.fillStyle = color; ctx.fillRect(+key.slice(0, i), +key.slice(i + 1), 1, 1); }
  // 2) der platzierte Block (Kollisionen rot)
  if (block) {
    for (let j = 0; j < block.h; j++) for (let i = 0; i < block.w; i++) {
      const gx = block.gx + i, gy = block.gy + j;
      ctx.fillStyle = occupied(gx, gy) ? '#e11d48' : block.colors[j * block.w + i];
      ctx.fillRect(gx, gy, 1, 1);
    }
  }
  // 3) Permalink-Hervorhebung
  if (highlight) {
    const t = (highlight.until - performance.now()) / 4000;         // 1 -> 0
    ctx.save();
    ctx.strokeStyle = '#FFCB3A';
    ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 200));
    ctx.lineWidth = Math.max(0.6, 1.2 / view.s);
    ctx.strokeRect(highlight.x - 0.5, highlight.y - 0.5, highlight.w + 1, highlight.h + 1);
    ctx.restore();
  }
}

// ---- Bild-Upload -> Block ----
function resetBlock() {
  block = null;
  const ib = document.getElementById('imgBar'); if (ib) ib.classList.add('hidden');
}
async function onImagePicked(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';                                   // erneutes Wählen derselben Datei erlauben
  if (!file) return;
  if (!/^image\//.test(file.type)) { showBanner('Please choose an image file.', 'warn'); return; }
  if (file.size > MAX_IMG_BYTES) { showBanner('Image too large (max 20 MB). Please pick a smaller file.', 'warn'); return; }
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { showBanner('Could not read that image.', 'warn'); return; }
  block = { bitmap, w: 0, h: 0, gx: 0, gy: 0, colors: [], valid: false };
  document.getElementById('imgBar').classList.remove('hidden');
  sizeBlock(viewCenterCell());
  showBanner('Drag your image to a free spot, then hit buy.', 'ok');
}
function removeImage() { resetBlock(); dirty = true; updateBadge(); }

// Block aus dem Bild aufbauen: Größe aus Slider (längste Seite), Seitenverhältnis erhalten,
// zentriert auf `center`. Transparente Pixel -> Weiß (der ganze Block wird gekauft).
function sizeBlock(center) {
  if (!block) return;
  const longest = clamp(+document.getElementById('imgSize').value || 32, 8, Math.min(CFG.gridW, CFG.gridH));
  const ar = block.bitmap.width / block.bitmap.height;
  let w = ar >= 1 ? longest : Math.round(longest * ar);
  let h = ar >= 1 ? Math.round(longest / ar) : longest;
  w = clamp(w, 1, CFG.gridW); h = clamp(h, 1, CFG.gridH);

  const off = document.createElement('canvas'); off.width = w; off.height = h;
  const c = off.getContext('2d'); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(block.bitmap, 0, 0, w, h);
  const data = c.getImageData(0, 0, w, h).data;
  const colors = new Array(w * h);
  for (let k = 0; k < w * h; k++) {
    const p = k * 4;
    colors[k] = data[p + 3] < 128 ? '#ffffff' : rgbToHex(data[p], data[p + 1], data[p + 2]);
  }
  block.w = w; block.h = h; block.colors = colors;
  block.gx = clamp(center.x - (w >> 1), 0, CFG.gridW - w);
  block.gy = clamp(center.y - (h >> 1), 0, CFG.gridH - h);
  computeValid();
  dirty = true; updateBadge();
}
function rgbToHex(r, g, b) { return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1); }

// Kein-Überlappung: liegt IRGENDEINE Block-Zelle auf einer belegten Zelle?
function computeValid() {
  if (!block) return false;
  let ok = true;
  for (let j = 0; j < block.h && ok; j++) for (let i = 0; i < block.w; i++) {
    if (occupied(block.gx + i, block.gy + j)) { ok = false; break; }
  }
  block.valid = ok;
  return ok;
}
function moveBlockTo(gx, gy) {
  block.gx = clamp(gx, 0, CFG.gridW - block.w);
  block.gy = clamp(gy, 0, CFG.gridH - block.h);
  computeValid();
  dirty = true; updateBadge();
}

// ---- Preis-Badge (live) ----
function updateBadge() {
  const buyBtn = document.getElementById('buyBtn');
  if (!block) {
    selBadge.classList.add('hidden');
    buyBtn.disabled = true; buyBtn.textContent = 'Add an image to continue →';
    return;
  }
  const n = block.w * block.h;
  const price = (n * CFG.pricePerPixel / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  if (!block.valid) {
    selBadge.textContent = '⚠︎ Overlaps taken pixels — move it';
    selBadge.classList.remove('hidden');
    buyBtn.disabled = true; buyBtn.textContent = 'Move to a free spot';
    return;
  }
  selBadge.textContent = `${n.toLocaleString('en-US')} px · ${price} €`;
  selBadge.classList.remove('hidden');
  buyBtn.disabled = false; buyBtn.textContent = `Buy ${n.toLocaleString('en-US')} px · ${price} € →`;
}

// ---- Toolbar ----
function wireToolbar() {
  document.getElementById('zoomIn').onclick = () => zoomBy(1.6);
  document.getElementById('zoomOut').onclick = () => zoomBy(1 / 1.6);
  document.getElementById('buyBtn').onclick = openModal;
  document.getElementById('addImageBtn').onclick = () => document.getElementById('imgInput').click();
  document.getElementById('imgInput').onchange = onImagePicked;
  document.getElementById('imgSize').oninput = () => {
    document.getElementById('imgSizeVal').textContent = document.getElementById('imgSize').value + ' px';
    if (block) { const cx = block.gx + (block.w >> 1), cy = block.gy + (block.h >> 1); sizeBlock({ x: cx, y: cy }); }
  };
  document.getElementById('imgRemove').onclick = removeImage;
  const start = document.getElementById('startBuy'); if (start) start.onclick = goToWall;
  document.getElementById('modalClose').onclick = closeModal;
  document.getElementById('buyForm').onsubmit = submitOrder;
}
function goToWall() { document.getElementById('wand').scrollIntoView({ behavior: 'smooth' }); }
function zoomBy(f, cx, cy) {
  const r = wrap.getBoundingClientRect();
  const ox = (cx == null ? r.width / 2 : cx - r.left), oy = (cy == null ? r.height / 2 : cy - r.top);
  const ns = Math.max(MIN_S, Math.min(MAX_S, view.s * f)), k = ns / view.s;
  view.tx = ox - (ox - view.tx) * k; view.ty = oy - (oy - view.ty) * k; view.s = ns;
  clampView(); applyView(); dirty = true;
}

// ---- Gesten: 1 Finger auf Block = ziehen · daneben = Wand pannen · 2 Finger = zoom/pan ----
function wireGestures() {
  wrap.addEventListener('pointerdown', onDown);
  wrap.addEventListener('pointermove', onMove, { passive: false });
  wrap.addEventListener('pointerup', onUp);
  wrap.addEventListener('pointercancel', onUp);
}
function pointerOnBlock(clientX, clientY) {
  if (!block) return false;
  const f = screenToCellF(clientX, clientY);
  return f.x >= block.gx && f.x < block.gx + block.w && f.y >= block.gy && f.y < block.gy + block.h;
}
function onDown(e) {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { wrap.setPointerCapture(e.pointerId); } catch {}
  if (pointers.size === 2) { dragging = null; panLast = null; gestureWasMulti = true; startPinch(); return; }
  if (pointers.size > 2) return;
  gestureWasMulti = false;
  if (pointerOnBlock(e.clientX, e.clientY)) {
    const f = screenToCellF(e.clientX, e.clientY);
    dragging = { offX: f.x - block.gx, offY: f.y - block.gy };
  } else {
    panLast = { x: e.clientX, y: e.clientY };
  }
}
function onMove(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2) { doPinch(); return; }
  if (gestureWasMulti) return;
  e.preventDefault();
  if (dragging && block) {
    const f = screenToCellF(e.clientX, e.clientY);
    moveBlockTo(Math.round(f.x - dragging.offX), Math.round(f.y - dragging.offY));
    return;
  }
  if (panLast) {
    view.tx += e.clientX - panLast.x; view.ty += e.clientY - panLast.y;
    panLast = { x: e.clientX, y: e.clientY }; clampView(); applyView();
  }
}
function onUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchLast = null;
  if (pointers.size > 0) return;
  if (gestureWasMulti) gestureWasMulti = false;
  dragging = null; panLast = null;
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

// ---- Permalink: /?ad=<id> -> zum eigenen Block zoomen + hervorheben ----
function handlePermalink() {
  const id = new URLSearchParams(location.search).get('ad');
  if (!id) return;
  const ad = ADS.find((a) => String(a.id) === String(id));
  if (ad && Number.isFinite(+ad.x)) focusAd(ad);
}
function focusAd(ad) {
  const cxCell = +ad.x + (+ad.w) / 2, cyCell = +ad.y + (+ad.h) / 2;
  const targetPxW = wrap.clientWidth * 0.4;
  view.s = clamp(targetPxW / (Math.max(1, +ad.w) * cell), MIN_S, MAX_S);
  view.tx = wrap.clientWidth / 2 - cxCell * cell * view.s;
  view.ty = wrap.clientHeight / 2 - cyCell * cell * view.s;
  clampView(); applyView();
  highlight = { x: +ad.x, y: +ad.y, w: +ad.w, h: +ad.h, until: performance.now() + 4000 };
  dirty = true;
  goToWall();
}

// ---- Bounding-Box (= Block) + Rasterung + Bestellung ----
function boundingBox() { return { x: block.gx, y: block.gy, w: block.w, h: block.h }; }
function rasterize() {
  const off = document.createElement('canvas'); off.width = block.w; off.height = block.h;
  const c = off.getContext('2d');
  for (let j = 0; j < block.h; j++) for (let i = 0; i < block.w; i++) { c.fillStyle = block.colors[j * block.w + i]; c.fillRect(i, j, 1, 1); }
  return new Promise((res) => off.toBlob((b) => res({ blob: b, bb: boundingBox() }), 'image/png'));
}
function cellsPayload() {
  const cells = [];
  for (let j = 0; j < block.h; j++) for (let i = 0; i < block.w; i++) cells.push({ x: block.gx + i, y: block.gy + j, c: block.colors[j * block.w + i] });
  return cells;
}

function openModal() {
  if (!block || !block.valid) return;
  const n = block.w * block.h, price = n * CFG.pricePerPixel / 100, min = (CFG.minOrderCents || 0) / 100;
  document.getElementById('selPixels').textContent = n.toLocaleString('en-US');
  document.getElementById('selPrice').textContent = price.toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' €';
  const err = document.getElementById('formError'), pay = document.getElementById('payBtn');
  if (price < min) { err.textContent = `Minimum order ${min.toFixed(2)} € – please pick a bigger image.`; err.classList.remove('hidden'); pay.disabled = true; }
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
    if (!block) return fail('Please add an image first.');
    if (!computeValid()) return fail('Your block overlaps taken pixels — move it to a free spot.');
    const { blob, bb } = await rasterize();
    const fd = new FormData();
    fd.append('x', bb.x); fd.append('y', bb.y); fd.append('w', bb.w); fd.append('h', bb.h);
    fd.append('pixels', String(bb.w * bb.h));
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
  } catch (e2) { fail(e2.name === 'AbortError' ? 'Upload took too long — try a smaller image or a better connection.' : (e2.message || 'Something went wrong.')); }
}

// ---- Rückkehr von Stripe + Share-Card ----
function handleReturnFromStripe() {
  const p = new URLSearchParams(location.search);
  if (p.get('success')) celebrate(p.get('ad'));
  if (p.get('canceled')) { const adId = p.get('ad'); if (adId) fetch('/api/orders/release', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adId: Number(adId) }) }).then(() => loadAds()).catch(() => {}); showBanner('Payment canceled – your reserved area has been released.', 'warn'); }
  if (p.get('success') || p.get('canceled')) history.replaceState({}, '', '/');
}
function celebrate(adId) {
  confettiBurst();
  const permalink = adId ? `https://pixeleuro.de/?ad=${encodeURIComponent(adId)}` : 'https://pixeleuro.de';
  const ov = document.createElement('div'); ov.className = 'success-ov';
  ov.innerHTML = `<div class="success-box"><img src="/logo.svg" alt="Pixi" /><h3>You're on the wall! 🎉</h3><p>Your block is secured – forever on the internet. It appears after a short review.</p><button class="cta" id="shareBtn">Share my spot 🟦</button><button class="ghost" id="successClose">To the wall</button></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#shareBtn').onclick = () => sharePixel(permalink, adId);
  ov.querySelector('#successClose').onclick = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
}
function sharePixel(permalink, adId) {
  const total = (CFG && CFG.gridW * CFG.gridH || 125000).toLocaleString('en-US');
  const data = { title: 'PixelEuro', text: `I'm on the wall 🟦 — forever on the internet, out of ${total} pixels. Grab yours:`, url: permalink };
  if (navigator.share) navigator.share(data).catch(() => {});
  else if (navigator.clipboard) { navigator.clipboard.writeText(data.text + ' ' + data.url); alert('Link copied – now share it!'); }
  else window.open(permalink, '_blank');
}
function confettiBurst() { const colors = ['#14c2da', '#2f6bff', '#FFCB3A', '#16a34a', '#d4537e']; for (let i = 0; i < 90; i++) { const c = document.createElement('div'); c.className = 'confetti-pc'; c.style.left = Math.random() * 100 + 'vw'; c.style.background = colors[i % colors.length]; c.style.animationDuration = (2 + Math.random() * 2) + 's'; c.style.animationDelay = (Math.random() * 0.6) + 's'; document.body.appendChild(c); setTimeout(() => c.remove(), 4200); } }
function showBanner(text, kind) { const b = document.createElement('div'); b.className = 'banner ' + kind; b.textContent = text; document.body.prepend(b); setTimeout(() => b.remove(), 9000); }
