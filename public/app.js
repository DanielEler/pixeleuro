// ============================================================
//  PixelEuro – Frontend-Logik (Canvas, Auswahl, Kauf)
// ============================================================
let CFG = null;
let ADS = [];
let scale = 2; // Anzeige-Zoom (1 Rasterpixel = scale Bildschirmpixel)

const canvas = document.getElementById('grid');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvasWrap');
const selBox = document.getElementById('selection');
const tooltip = document.getElementById('tooltip');

// --- Auswahlzustand ---
let buying = false;
let dragging = false;
let sel = null; // {x, y, w, h} in Rasterpixeln

init();

async function init() {
  CFG = await (await fetch('/api/config')).json();
  document.getElementById('siteName').textContent = CFG.siteName;
  document.getElementById('tagline').textContent = CFG.siteTagline;
  document.getElementById('pricePer').innerHTML = (CFG.pricePerPixel / 100).toFixed(0) + '&nbsp;€';
  document.getElementById('year').textContent = '2026';

  canvas.width = CFG.gridW;
  canvas.height = CFG.gridH;
  applyScale();

  await loadAds();
  handleReturnFromStripe();

  // Events
  document.getElementById('startBuy').onclick = enterBuyMode;
  document.getElementById('zoomIn').onclick = () => { scale = Math.min(8, scale + 1); applyScale(); render(); };
  document.getElementById('zoomOut').onclick = () => { scale = Math.max(1, scale - 1); applyScale(); render(); };
  document.getElementById('modalClose').onclick = closeModal;
  document.getElementById('buyForm').onsubmit = submitOrder;

  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('mousemove', onHover);
  canvas.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
  canvas.addEventListener('click', onCanvasClick);
}

function applyScale() {
  canvas.style.width = CFG.gridW * scale + 'px';
  canvas.style.maxWidth = 'none';
}

async function loadAds() {
  const data = await (await fetch('/api/ads')).json();
  ADS = data.ads;
  // Statistiken
  const sold = data.soldPixels, total = data.totalPixels;
  document.getElementById('soldCount').textContent = sold.toLocaleString('de-DE');
  document.getElementById('freeCount').textContent = (total - sold).toLocaleString('de-DE');
  document.getElementById('progressBar').style.width = (sold / total * 100) + '%';
  await render();
}

// --- Rendering ---
async function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Hintergrund
  ctx.fillStyle = '#0e1430';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const ad of ADS) {
    if (ad.image) {
      await drawImage(ad);
    } else {
      // belegt, aber noch nicht freigeschaltet
      ctx.fillStyle = '#2a3358';
      ctx.fillRect(ad.x, ad.y, ad.w, ad.h);
    }
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

// --- Koordinaten: Bildschirm -> Raster ---
function toGrid(e) {
  const r = canvas.getBoundingClientRect();
  const gx = Math.floor((e.clientX - r.left) / scale);
  const gy = Math.floor((e.clientY - r.top) / scale);
  return {
    x: Math.max(0, Math.min(CFG.gridW - 1, gx)),
    y: Math.max(0, Math.min(CFG.gridH - 1, gy)),
  };
}

// --- Kaufmodus ---
function enterBuyMode() {
  buying = true;
  document.getElementById('modeHint').textContent = '✏️ Zieh jetzt ein Rechteck auf der Wand auf.';
  document.getElementById('wand').scrollIntoView({ behavior: 'smooth' });
}

function onDown(e) {
  if (!buying) return;
  e.preventDefault();
  dragging = true;
  const g = toGrid(e);
  sel = { sx: g.x, sy: g.y, x: g.x, y: g.y, w: 1, h: 1 };
  updateSelBox();
}

function onMove(e) {
  if (!dragging) return;
  const g = toGrid(e);
  sel.x = Math.min(sel.sx, g.x);
  sel.y = Math.min(sel.sy, g.y);
  sel.w = Math.abs(g.x - sel.sx) + 1;
  sel.h = Math.abs(g.y - sel.sy) + 1;
  updateSelBox();
}

function onUp() {
  if (!dragging) return;
  dragging = false;
  if (sel && sel.w >= 1 && sel.h >= 1) {
    if (overlapsExisting(sel)) {
      alert('Teile dieser Fläche sind schon vergeben. Bitte wähle freie Pixel.');
      selBox.classList.add('hidden');
      return;
    }
    openModal();
  }
}

function overlapsExisting(s) {
  return ADS.some(a => !(s.x + s.w <= a.x || a.x + a.w <= s.x || s.y + s.h <= a.y || a.y + a.h <= s.y));
}

function updateSelBox() {
  const r = canvas.getBoundingClientRect();
  const wrapR = wrap.getBoundingClientRect();
  selBox.classList.remove('hidden');
  selBox.style.left = (r.left - wrapR.left + wrap.scrollLeft + sel.x * scale) + 'px';
  selBox.style.top = (r.top - wrapR.top + wrap.scrollTop + sel.y * scale) + 'px';
  selBox.style.width = sel.w * scale + 'px';
  selBox.style.height = sel.h * scale + 'px';
}

// --- Hover-Tooltip & Klick auf Anzeige ---
function findAd(g) {
  return ADS.find(a => g.x >= a.x && g.x < a.x + a.w && g.y >= a.y && g.y < a.y + a.h);
}
function onHover(e) {
  if (buying) return;
  const ad = findAd(toGrid(e));
  if (ad && (ad.title || ad.link)) {
    tooltip.textContent = ad.title || ad.link;
    tooltip.style.left = e.clientX + 12 + 'px';
    tooltip.style.top = e.clientY + 12 + 'px';
    tooltip.classList.remove('hidden');
    canvas.style.cursor = ad.link ? 'pointer' : 'default';
  } else {
    tooltip.classList.add('hidden');
    canvas.style.cursor = buying ? 'crosshair' : 'default';
  }
}
function onCanvasClick(e) {
  if (buying) return;
  const ad = findAd(toGrid(e));
  if (ad && ad.link) window.open(ad.link, '_blank', 'noopener');
}

// --- Modal / Bestellung ---
function openModal() {
  const pixels = sel.w * sel.h;
  const price = pixels * CFG.pricePerPixel / 100;
  document.getElementById('selSize').textContent = `${sel.w} × ${sel.h}`;
  document.getElementById('selPixels').textContent = pixels.toLocaleString('de-DE');
  document.getElementById('selPrice').textContent = price.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €';
  const min = CFG.minOrderCents / 100;
  const err = document.getElementById('formError');
  if (price < min) {
    err.textContent = `Mindestbestellwert ${min.toFixed(2)} € – bitte größere Fläche wählen.`;
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
  buying = false;
  selBox.classList.add('hidden');
  document.getElementById('modeHint').textContent = 'Klick „Pixel sichern" und zieh ein Rechteck auf die Wand.';
}

async function submitOrder(e) {
  e.preventDefault();
  const err = document.getElementById('formError');
  const btn = document.getElementById('payBtn');
  err.classList.add('hidden');
  btn.disabled = true; btn.textContent = 'Wird vorbereitet…';

  const fd = new FormData();
  fd.append('x', sel.x); fd.append('y', sel.y); fd.append('w', sel.w); fd.append('h', sel.h);
  fd.append('image', document.getElementById('imgInput').files[0]);
  fd.append('link', document.getElementById('linkInput').value);
  fd.append('title', document.getElementById('titleInput').value);
  fd.append('email', document.getElementById('emailInput').value);

  try {
    const res = await fetch('/api/orders', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler');
    window.location.href = data.checkoutUrl; // weiter zu Stripe
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Zur Zahlung →';
  }
}

// --- Rückkehr von Stripe ---
function handleReturnFromStripe() {
  const p = new URLSearchParams(location.search);
  if (p.get('success')) showBanner('🎉 Danke! Deine Zahlung war erfolgreich. Dein Pixel-Block erscheint nach kurzer Prüfung.', 'ok');
  if (p.get('canceled')) showBanner('Zahlung abgebrochen – deine reservierte Fläche wird bald wieder frei.', 'warn');
  if (p.get('success') || p.get('canceled')) history.replaceState({}, '', '/');
}
function showBanner(text, kind) {
  const b = document.createElement('div');
  b.className = 'banner ' + kind;
  b.textContent = text;
  document.body.prepend(b);
  setTimeout(() => b.remove(), 9000);
}
