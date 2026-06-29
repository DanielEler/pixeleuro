// ============================================================
//  PixelEuro – Frontend (Canvas, Auswahl jederzeit, Kauf)
// ============================================================
let CFG = null;
let ADS = [];
let zoom = 1; // 1 = ganze Wand füllt die Breite; >1 = reingezoomt

const canvas = document.getElementById('grid');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvasWrap');
const selBox = document.getElementById('selection');
const tooltip = document.getElementById('tooltip');
const selBadge = document.getElementById('selBadge');

let dragging = false, moved = false, sel = null, isTouch = false, startX = 0, startY = 0;
let selectMode = true; // mobil: an = Rechteck ziehen, aus = Wand verschieben/zoomen

init();

async function init() {
  CFG = await (await fetch('/api/config')).json();
  document.getElementById('siteName').textContent = CFG.siteName;
  document.getElementById('pricePer').innerHTML = (CFG.pricePerPixel / 100).toFixed(0) + '&nbsp;€';
  document.getElementById('year').textContent = '2026';

  canvas.width = CFG.gridW;
  canvas.height = CFG.gridH;
  applyZoom();

  await loadAds();
  handleReturnFromStripe();

  document.getElementById('startBuy').onclick = goToWall;
  document.getElementById('zoomIn').onclick = () => { zoom = Math.min(16, +(zoom * 1.5).toFixed(2)); applyZoom(); };
  document.getElementById('zoomOut').onclick = () => { zoom = Math.max(1, +(zoom / 1.5).toFixed(2)); applyZoom(); };
  document.getElementById('modalClose').onclick = closeModal;
  document.getElementById('buyForm').onsubmit = submitOrder;
  const mSel = document.getElementById('modeSelect');
  const mMove = document.getElementById('modeMove');
  if (mSel) mSel.onclick = () => setMode(true);
  if (mMove) mMove.onclick = () => setMode(false);
  setMode(true);

  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('mousemove', onHover);
  canvas.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
  window.addEventListener('resize', applyZoom);
}

// Canvas füllt die Container-Breite (zoom=1) bzw. wird größer (zoom>1).
function applyZoom() {
  canvas.style.width = (zoom * 100) + '%';
  canvas.style.maxWidth = 'none';
  requestAnimationFrame(() => {
    const cell = canvas.clientWidth / CFG.gridW;
    canvas.style.setProperty('--cell', cell + 'px');
    canvas.style.setProperty('--cell10', cell * 10 + 'px');
  });
}

async function loadAds() {
  const data = await (await fetch('/api/ads')).json();
  ADS = data.ads;
  const sold = data.soldPixels, total = data.totalPixels;
  animateCount(document.getElementById('soldCount'), sold);
  animateCount(document.getElementById('freeCount'), total - sold);
  document.getElementById('progressBar').style.width = (sold / total * 100) + '%';
  await render();
}

function animateCount(el, target) {
  if (!el) return;
  const dur = 700, t0 = performance.now();
  function step(now) {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString('en-US');
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// --- Rendering (leere Pixel = transparent -> weißes Karopapier per CSS) ---
async function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const ad of ADS) {
    if (ad.image) await drawImage(ad);
    else { ctx.fillStyle = '#c6d4da'; ctx.fillRect(ad.x, ad.y, ad.w, ad.h); }
  }
}
const imgCache = new Map();
function drawImage(ad) {
  return new Promise((resolve) => {
    let img = imgCache.get(ad.id);
    if (img && img.complete) { ctx.drawImage(img, ad.x, ad.y, ad.w, ad.h); return resolve(); }
    img = new Image();
    img.onload = () => { ctx.drawImage(img, ad.x, ad.y, ad.w, ad.h); resolve(); };
    img.onerror = () => resolve();
    img.src = ad.image;
    imgCache.set(ad.id, img);
  });
}

// --- Koordinaten: Bildschirm -> Raster (robust, egal welche Anzeigegröße) ---
function toGrid(e) {
  const r = canvas.getBoundingClientRect();
  const cw = r.width / CFG.gridW, ch = r.height / CFG.gridH;
  return {
    x: Math.max(0, Math.min(CFG.gridW - 1, Math.floor((e.clientX - r.left) / cw))),
    y: Math.max(0, Math.min(CFG.gridH - 1, Math.floor((e.clientY - r.top) / ch))),
  };
}

// Umschalten Auswahl <-> Verschieben (mobil entscheidend).
function setMode(sel) {
  selectMode = sel;
  // touch-action steuert, ob der Browser beim Ziehen scrollt:
  //  - Auswahl an  -> none  (wir zeichnen das Rechteck)
  //  - Auswahl aus -> pan-x pan-y (Browser verschiebt/zoomt die Wand)
  canvas.style.touchAction = sel ? 'none' : 'pan-x pan-y';
  const mSel = document.getElementById('modeSelect');
  const mMove = document.getElementById('modeMove');
  if (mSel && mMove) { mSel.classList.toggle('active', sel); mMove.classList.toggle('active', !sel); }
  const hint = document.getElementById('modeHint');
  if (hint) hint.textContent = sel
    ? 'Drag across the wall to pick your pixels · zoom in for precision.'
    : 'Drag to move the wall · use + / − to zoom.';
}

function goToWall() {
  setMode(true); // Kauf-Absicht -> direkt in den Auswahl-Modus
  document.getElementById('wand').scrollIntoView({ behavior: 'smooth' });
}

// Wird gezeichnet? Maus immer; Touch nur im Auswahl-Modus. Sonst = pannen.
function isDrawing() { return selectMode || !isTouch; }

function onDown(e) {
  isTouch = (e.pointerType === 'touch');
  startX = e.clientX; startY = e.clientY;
  dragging = true; moved = false;
  const g = toGrid(e);
  sel = { sx: g.x, sy: g.y, x: g.x, y: g.y, w: 1, h: 1 };
  tooltip.classList.add('hidden');
  if (isDrawing()) { e.preventDefault(); updateSelBox(); showSelBadge(e); }
}
function onMove(e) {
  if (!dragging) return;
  if (Math.abs(e.clientX - startX) > 6 || Math.abs(e.clientY - startY) > 6) moved = true;
  if (!isDrawing()) return; // Touch + Verschieben-Modus: Browser scrollt/pannt
  e.preventDefault();
  const g = toGrid(e);
  sel.x = Math.min(sel.sx, g.x);
  sel.y = Math.min(sel.sy, g.y);
  sel.w = Math.abs(g.x - sel.sx) + 1;
  sel.h = Math.abs(g.y - sel.sy) + 1;
  updateSelBox();
  showSelBadge(e);
}
function showSelBadge(e) {
  const px = sel.w * sel.h;
  const price = (px * CFG.pricePerPixel / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  selBadge.textContent = `${px.toLocaleString('en-US')} px · ${price} €`;
  selBadge.style.left = e.clientX + 'px';
  selBadge.style.top = e.clientY + 'px';
  selBadge.classList.remove('hidden');
}
function onUp() {
  if (!dragging) return;
  dragging = false;
  selBadge.classList.add('hidden');
  if (!sel) return;

  // Touch im Verschieben-Modus: Bewegung = pannen, Tippen = 1 Pixel
  if (!isDrawing()) {
    if (moved) { selBox.classList.add('hidden'); return; } // war Verschieben
    const ad = findAd({ x: sel.x, y: sel.y });
    if (ad) { selBox.classList.add('hidden'); if (ad.link) window.open(ad.link, '_blank', 'noopener'); return; }
    sel.w = 1; sel.h = 1;
    if (overlapsExisting(sel)) { selBox.classList.add('hidden'); alert('This pixel is already taken.'); return; }
    updateSelBox();
    openModal();
    return;
  }

  // Zeichnen (Maus ODER Touch-Auswahl): Rechteck -> Modal, Tap ohne Ziehen -> 1 Pixel
  if (!moved) {
    const ad = findAd({ x: sel.x, y: sel.y });
    if (ad) { selBox.classList.add('hidden'); if (ad.link) window.open(ad.link, '_blank', 'noopener'); return; }
  }
  if (overlapsExisting(sel)) {
    alert('Part of this area is already taken. Please pick free pixels.');
    selBox.classList.add('hidden');
    return;
  }
  openModal();
}
function overlapsExisting(s) {
  return ADS.some(a => !(s.x + s.w <= a.x || a.x + a.w <= s.x || s.y + s.h <= a.y || a.y + a.h <= s.y));
}
function updateSelBox() {
  const r = canvas.getBoundingClientRect();
  const wrapR = wrap.getBoundingClientRect();
  const cw = r.width / CFG.gridW, ch = r.height / CFG.gridH;
  selBox.classList.remove('hidden');
  selBox.style.left = (r.left - wrapR.left + wrap.scrollLeft + sel.x * cw) + 'px';
  selBox.style.top = (r.top - wrapR.top + wrap.scrollTop + sel.y * ch) + 'px';
  selBox.style.width = sel.w * cw + 'px';
  selBox.style.height = sel.h * ch + 'px';
}

// --- Hover-Tooltip ---
function findAd(g) { return ADS.find(a => g.x >= a.x && g.x < a.x + a.w && g.y >= a.y && g.y < a.y + a.h); }
function onHover(e) {
  if (dragging) return;
  const ad = findAd(toGrid(e));
  if (ad && (ad.title || ad.link)) {
    tooltip.textContent = ad.title || ad.link;
    tooltip.style.left = e.clientX + 12 + 'px';
    tooltip.style.top = e.clientY + 12 + 'px';
    tooltip.classList.remove('hidden');
    canvas.style.cursor = ad.link ? 'pointer' : 'crosshair';
  } else {
    tooltip.classList.add('hidden');
    canvas.style.cursor = 'crosshair';
  }
}

// --- Modal / Bestellung ---
// iOS/Safari: Pinch-Zoom der Seite zurücksetzen, damit das Kauf-Fenster
// nicht riesig/reingezoomt erscheint.
function resetPageZoom() {
  const vp = document.querySelector('meta[name="viewport"]');
  if (!vp) return;
  vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
  setTimeout(() => vp.setAttribute('content', 'width=device-width, initial-scale=1'), 400);
}
function openModal() {
  resetPageZoom();
  const pixels = sel.w * sel.h;
  const price = pixels * CFG.pricePerPixel / 100;
  document.getElementById('selSize').textContent = `${sel.w} × ${sel.h}`;
  document.getElementById('selPixels').textContent = pixels.toLocaleString('en-US');
  document.getElementById('selPrice').textContent = price.toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' €';
  const min = CFG.minOrderCents / 100;
  const err = document.getElementById('formError');
  if (price < min) {
    err.textContent = `Minimum order ${min.toFixed(2)} € – please choose a larger area.`;
    err.classList.remove('hidden');
    document.getElementById('payBtn').disabled = true;
  } else {
    err.classList.add('hidden');
    document.getElementById('payBtn').disabled = false;
  }
  document.getElementById('buyModal').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('buyModal').classList.add('hidden');
  selBox.classList.add('hidden');
  selBadge.classList.add('hidden');
}

async function submitOrder(e) {
  e.preventDefault();
  const err = document.getElementById('formError');
  const btn = document.getElementById('payBtn');
  err.classList.add('hidden');
  btn.disabled = true; btn.textContent = 'Preparing…';
  const fd = new FormData();
  fd.append('x', sel.x); fd.append('y', sel.y); fd.append('w', sel.w); fd.append('h', sel.h);
  fd.append('image', document.getElementById('imgInput').files[0]);
  fd.append('link', document.getElementById('linkInput').value);
  fd.append('title', document.getElementById('titleInput').value);
  fd.append('email', document.getElementById('emailInput').value);
  try {
    const res = await fetch('/api/orders', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    window.location.href = data.checkoutUrl;
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Continue to payment →';
  }
}

function handleReturnFromStripe() {
  const p = new URLSearchParams(location.search);
  if (p.get('success')) celebrate();
  if (p.get('canceled')) {
    const adId = p.get('ad');
    if (adId) {
      // Reservierung sofort freigeben + Zähler/Wand neu laden
      fetch('/api/orders/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adId: Number(adId) }),
      }).then(() => loadAds()).catch(() => {});
    }
    showBanner('Payment canceled – your reserved area has been released.', 'warn');
  }
  if (p.get('success') || p.get('canceled')) history.replaceState({}, '', '/');
}

// --- Erfolg: Konfetti + Teilen ---
function celebrate() {
  confettiBurst();
  const ov = document.createElement('div');
  ov.className = 'success-ov';
  ov.innerHTML = `
    <div class="success-box">
      <img src="/logo.svg" alt="Pixi" />
      <h3>You're in! 🎉</h3>
      <p>Your pixel is secured – forever on the internet. It appears on the wall after a short review.</p>
      <button class="cta" id="shareBtn">Share 🟦</button>
      <button class="ghost" id="successClose">To the wall</button>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#shareBtn').onclick = sharePixel;
  ov.querySelector('#successClose').onclick = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
}

function sharePixel() {
  const data = {
    title: 'PixelEuro',
    text: 'I just grabbed my pixel on pixeleuro.de – forever on the internet! 🟦',
    url: 'https://pixeleuro.de',
  };
  if (navigator.share) navigator.share(data).catch(() => {});
  else if (navigator.clipboard) { navigator.clipboard.writeText(data.text + ' ' + data.url); alert('Link copied – now share it!'); }
  else window.open('https://pixeleuro.de', '_blank');
}

function confettiBurst() {
  const colors = ['#14c2da', '#2f6bff', '#FFCB3A', '#16a34a', '#d4537e'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('div');
    c.className = 'confetti-pc';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = (2 + Math.random() * 2) + 's';
    c.style.animationDelay = (Math.random() * 0.6) + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4200);
  }
}
function showBanner(text, kind) {
  const b = document.createElement('div');
  b.className = 'banner ' + kind;
  b.textContent = text;
  document.body.prepend(b);
  setTimeout(() => b.remove(), 9000);
}
