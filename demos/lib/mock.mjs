// ============================================================
//  Mock-Backend für die Capture (record -> replay, $0, deterministisch)
//  Liefert /api/config + /api/ads ohne DB/Stripe.
//  WICHTIG (DSGVO): ausschließlich ANONYMISIERTE Platzhalter-Daten.
//  Keine echten Marken, Mails, Bilder oder personenbezogenen Daten.
// ============================================================

const GRID_W = 500;
const GRID_H = 250;

// Seeded PRNG (mulberry32) — deterministisch, kein Math.random.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Marken-nahe Palette (aus design.md), für bunte Platzhalter-Blöcke.
const PALETTE = ['#14c2da', '#2f6bff', '#0e93a8', '#16a34a', '#FFCB3A', '#d4537e', '#7c5cff', '#ff7a45'];

// Solid-Color-Block als SVG-Data-URI (kein externes Asset, byte-stabil).
function blockImage(color, label) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">` +
    `<rect width="40" height="40" rx="4" fill="${color}"/>` +
    `<rect width="40" height="40" rx="4" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>` +
    `<text x="20" y="27" font-family="Inter,sans-serif" font-size="20" font-weight="800" ` +
    `fill="rgba(255,255,255,.92)" text-anchor="middle">${label}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Belegte Felder vermeiden Überlappung + lassen die "Prime-Zone" frei,
// in der die Demo ihr Rechteck zieht.
const PRIME = { x: 206, y: 70, w: 92, h: 78 }; // bewusst frei gehalten

function rectsOverlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function buildAds() {
  const rng = mulberry32(20260628); // fixer Seed
  const ads = [];
  const occupied = [{ ...PRIME }]; // Prime-Zone als belegt markieren -> bleibt frei
  let id = 1;
  let attempts = 0;

  // Cluster bewusst in oberer/unterer Region + Rändern, Mitte luftig lassen.
  while (ads.length < 46 && attempts < 4000) {
    attempts++;
    const w = 4 + Math.floor(rng() * 26);
    const h = 4 + Math.floor(rng() * 18);
    const x = Math.floor(rng() * (GRID_W - w));
    const y = Math.floor(rng() * (GRID_H - h));
    const cand = { x, y, w, h };
    if (occupied.some((o) => rectsOverlap(cand, o))) continue;
    // etwas Abstand zur Prime-Zone halten, damit die Auswahl klar wirkt
    if (rectsOverlap({ x: x - 6, y: y - 6, w: w + 12, h: h + 12 }, PRIME)) continue;

    const color = PALETTE[Math.floor(rng() * PALETTE.length)];
    const label = String.fromCharCode(65 + (id % 26)); // anonymer Buchstabe
    occupied.push(cand);
    ads.push({
      id: `mock-${id}`,
      x, y, w, h,
      occupied: false,
      title: `marke-${String(id).padStart(2, '0')}`, // anonymisiert
      link: null,
      image: blockImage(color, label),
    });
    id++;
  }
  return ads;
}

const ADS = buildAds();
const SOLD = ADS.reduce((s, a) => s + a.w * a.h, 0);

export const mockConfig = {
  gridW: GRID_W,
  gridH: GRID_H,
  pricePerPixel: 100,
  minOrderCents: 1000,
  siteName: 'PixelEuro',
  siteTagline: '1 Pixel. 1 Euro.',
  paymentEnabled: true,
};

export const mockAdsResponse = {
  ads: ADS,
  soldPixels: SOLD,
  totalPixels: GRID_W * GRID_H,
};

// Prime-Zone (Grid-Koordinaten) für die Capture-Flows exportiert.
export const primeZone = PRIME;

// Leere Wand (Tag 1: noch nichts verkauft). Neue Pro-Pixel-Form: pixels[].
export const emptyAdsResponse = {
  pixels: [],
  ads: [],
  soldPixels: 0,
  totalPixels: GRID_W * GRID_H,
};

// Installiert die Route-Mocks auf einer Playwright-Page.
// opts.empty  = true        -> leere Wand (0 verkauft).
// opts.pixels = [{x,y,c}]    -> genau diese Pro-Pixel-Zellen verkauft (z. B. „1. Pixel").
export async function installMocks(page, opts = {}) {
  let body;
  if (opts.pixels) {
    body = { pixels: opts.pixels, ads: [], soldPixels: opts.pixels.length, totalPixels: GRID_W * GRID_H };
  } else {
    body = opts.empty ? emptyAdsResponse : mockAdsResponse;
  }
  const adsBody = JSON.stringify(body);
  await page.route('**/api/config', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(mockConfig) })
  );
  await page.route('**/api/ads', (route) =>
    route.fulfill({ contentType: 'application/json', body: adsBody })
  );
  // Bestellung: gemockte Checkout-URL, die direkt den Erfolgs-Zustand zeigt
  // (kein echtes Stripe, keine echten Daten).
  await page.route('**/api/orders', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ checkoutUrl: '/?success=1' }),
    })
  );
}
