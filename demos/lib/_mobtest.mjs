// Mobile-Touch-Verifikation: Select-Modus = Rechteck (mehrere Pixel) -> Modal;
// Move-Modus = pannt (kein Modal); + gemockter Zahlungs-Flow ohne Hänger.
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
const ctx = await browser.newContext({ ...devices['iPhone 13'] }); // hasTouch + isMobile
const page = await ctx.newPage();
await installMocks(page, { empty: true });
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

// Touch-Drag via echte PointerEvents (pointerType:touch)
async function touchDrag(ax, ay, bx, by) {
  await page.evaluate(async ([ax, ay, bx, by]) => {
    const cv = document.getElementById('grid');
    const fire = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y,
    }));
    fire(cv, 'pointerdown', ax, ay);
    const N = 8;
    for (let i = 1; i <= N; i++) { const t = i / N; fire(window, 'pointermove', ax + (bx-ax)*t, ay + (by-ay)*t); await new Promise(r=>setTimeout(r,16)); }
    fire(window, 'pointerup', bx, by);
  }, [ax, ay, bx, by]);
}
async function gridPt(gx, gy) {
  return await page.evaluate(([gx, gy]) => { const c = document.getElementById('grid'); const r = c.getBoundingClientRect();
    const cw = r.width/c.width, ch = r.height/c.height; return { x: r.left + (gx+0.5)*cw, y: r.top + (gy+0.5)*ch }; }, [gx, gy]);
}

const out = { };
// scroll to wall
await page.locator('#wand').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);

// --- Test 1: SELECT mode -> finger drag selects MANY pixels ---
const a = await gridPt(80, 60), b = await gridPt(180, 130);
await touchDrag(a.x, a.y, b.x, b.y);
await page.waitForTimeout(500);
out.modalOpen = await page.locator('#buyModal').evaluate(el => !el.classList.contains('hidden')).catch(()=>false);
out.selPixels = await page.locator('#selPixels').textContent().catch(()=>'?');
out.selSize = await page.locator('#selSize').textContent().catch(()=>'?');

// close modal
await page.locator('#modalClose').click().catch(()=>{});
await page.waitForTimeout(200);

// --- Test 2: MOVE mode -> drag should NOT open modal ---
await page.locator('#modeMove').click();
await page.waitForTimeout(150);
const c2 = await gridPt(60, 50), d2 = await gridPt(160, 120);
await touchDrag(c2.x, c2.y, d2.x, d2.y);
await page.waitForTimeout(400);
out.moveModeOpensModal = await page.locator('#buyModal').evaluate(el => !el.classList.contains('hidden')).catch(()=>false);

// --- Test 3: payment flow (mocked) doesn't hang ---
await page.locator('#modeSelect').click();
await page.waitForTimeout(150);
const a3 = await gridPt(80, 60), b3 = await gridPt(180, 130);
await touchDrag(a3.x, a3.y, b3.x, b3.y);
await page.waitForTimeout(400);
await page.setInputFiles('#imgInput', join(__dirname, '..', 'assets', 'placeholder-logo.png')).catch(e=>out.fileErr=String(e));
await page.fill('#emailInput', 'you@example.com');
await page.check('#agreeInput');
const payDisabled = await page.locator('#payBtn').isDisabled();
out.payBtnEnabled = !payDisabled;
await page.locator('#payBtn').click();
await page.waitForTimeout(1500);
out.afterPayUrl = page.url();
out.celebrated = await page.locator('.success-ov').count();

console.log(JSON.stringify(out, null, 2));
await browser.close(); server.close();
