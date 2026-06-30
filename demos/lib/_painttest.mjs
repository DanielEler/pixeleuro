// Verifikation Stage 1: Paint-Canvas auf Touch — malen (mehrere Pixel),
// Pinch-Zoom, neutrale Badge-Größe. + Screenshot.
import { chromium, devices } from 'playwright';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { installMocks } from './mock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', '..', 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json' };
const server = http.createServer(async (req, res) => {
  try { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const f = join(PUBLIC, p); await fs.access(f);
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' }); createReadStream(f).pipe(res);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
await installMocks(page, { empty: true });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);
await page.locator('#wand').scrollIntoViewIfNeeded();
await page.waitForTimeout(500);

const out = {};
const box = await page.locator('#canvasWrap').boundingBox();

// --- Paint: Touch-Drag diagonal über die Leinwand ---
async function touch(type, id, x, y) {
  await page.evaluate(([type, id, x, y]) => {
    document.getElementById('canvasWrap').dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: id === 1, bubbles: true, cancelable: true, clientX: x, clientY: y }));
  }, [type, id, x, y]);
}
const x0 = box.x + box.width * 0.25, y0 = box.y + box.height * 0.3;
const x1 = box.x + box.width * 0.7, y1 = box.y + box.height * 0.7;
await touch('pointerdown', 1, x0, y0);
for (let i = 1; i <= 12; i++) { const t = i / 12; await touch('pointermove', 1, x0 + (x1-x0)*t, y0 + (y1-y0)*t); await page.waitForTimeout(12); }
await touch('pointerup', 1, x1, y1);
await page.waitForTimeout(300);

out.badge = await page.locator('#selBadge').textContent().catch(()=>'?');
out.badgeHidden = await page.locator('#selBadge').evaluate(e => e.classList.contains('hidden')).catch(()=>true);
out.badgeFontPx = await page.locator('#selBadge').evaluate(e => getComputedStyle(e).fontSize).catch(()=>'?');
out.buyBtn = await page.locator('#buyBtn').textContent().catch(()=>'?');
out.buyDisabled = await page.locator('#buyBtn').isDisabled().catch(()=>true);

// --- Pinch-Zoom (zwei Finger auseinander) ---
await page.locator('#modeMove').click(); await page.waitForTimeout(100);
const cx = box.x + box.width/2, cy = box.y + box.height/2;
await touch('pointerdown', 11, cx-30, cy); await touch('pointerdown', 12, cx+30, cy);
for (let i = 1; i <= 10; i++) { const d = 30 + i*12; await touch('pointermove', 11, cx-d, cy); await touch('pointermove', 12, cx+d, cy); await page.waitForTimeout(14); }
await touch('pointerup', 11, cx-150, cy); await touch('pointerup', 12, cx+150, cy);
await page.waitForTimeout(200);
out.worldTransform = await page.locator('#world').evaluate(e => e.style.transform).catch(()=>'?');
out.badgeFontAfterZoom = await page.locator('#selBadge').evaluate(e => getComputedStyle(e).fontSize).catch(()=>'?');

await page.screenshot({ path: join(__dirname, '..', 'out', 'paint-test.png') });
out.pageErrors = errors;
console.log(JSON.stringify(out, null, 2));
await browser.close(); server.close();
