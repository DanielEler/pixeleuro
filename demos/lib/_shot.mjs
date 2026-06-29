// Schneller visueller Check der (englischen) Live-Seite mit gemocktem Backend.
import { chromium } from 'playwright';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { installMocks } from './mock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', '..', 'public');
const OUT = join(__dirname, '..', 'out', 'site-check');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = join(PUBLIC, p);
    await fs.access(f);
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
    createReadStream(f).pipe(res);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await installMocks(page);
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.screenshot({ path: join(OUT, 'home.png') });

// Wand + Modal
await page.locator('#wand').scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'wall.png') });

// Modal öffnen: Rechteck ziehen
const pt = await page.evaluate(() => {
  const c = document.getElementById('grid'); const r = c.getBoundingClientRect();
  const cw = r.width / c.width, ch = r.height / c.height;
  return { x0: r.left + 240 * cw, y0: r.top + 100 * ch, x1: r.left + 250 * cw, y1: r.top + 110 * ch };
});
await page.mouse.move(pt.x0, pt.y0); await page.mouse.down();
await page.mouse.move(pt.x1, pt.y1, { steps: 12 }); await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'modal.png') });

await browser.close(); server.close();
console.log('shots ->', OUT);
