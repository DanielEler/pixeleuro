// ============================================================
//  Capture-Engine: Playwright + CDP-Screencast -> CFR-60fps-MP4
//  + action-timeline.json (Beats: Story-Moment + Zeit + Cursor).
//  "Capture = Daten": die echte Seite wird automatisch bedient,
//  jeder Frame aufgenommen, nichts von Hand abgefilmt.
// ============================================================
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { installMocks } from './mock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', '..', 'public');
const CURSOR_JS = join(__dirname, 'cursor.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

// --- Mini-Static-Server für public/ (so läuft die echte Seite ohne Backend) ---
function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        const file = join(PUBLIC_DIR, p);
        if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403).end(); return; }
        await fs.access(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        createReadStream(file).pipe(res);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', reject);
    ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}\n${err.slice(-1500)}`))));
  });
}

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * runCapture(cfg, flow)
 *  cfg:  { name, outDir, width?, height?, dsf?, fps? }
 *  flow: async (d) => {}   — bekommt das Driver-Objekt d
 */
export async function runCapture(cfg, flow) {
  const width = cfg.width || 1280;
  const height = cfg.height || 800;
  const dsf = cfg.dsf || 1.5;
  const fps = cfg.fps || 60;
  const outDir = cfg.outDir;
  const framesDir = join(outDir, 'frames');
  await fs.rm(framesDir, { recursive: true, force: true });
  await fs.mkdir(framesDir, { recursive: true });

  const { server, port } = await startStaticServer();
  const baseURL = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ args: ['--force-color-profile=srgb'] });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dsf,
    locale: 'de-DE',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await installMocks(page, cfg.mock || {});
  await page.addInitScript({ path: CURSOR_JS });

  // --- CDP-Screencast ---
  const client = await context.newCDPSession(page);
  const frames = [];           // { idx, t } — t = ms seit Capture-Start
  let frameIdx = 0;
  let t0 = 0;
  let writing = Promise.resolve();

  client.on('Page.screencastFrame', (ev) => {
    const t = t0 ? performance.now() - t0 : 0;
    const idx = ++frameIdx;
    const file = join(framesDir, `f_${String(idx).padStart(6, '0')}.png`);
    // Reihenfolge-stabil schreiben, ohne den Event-Loop zu blockieren.
    writing = writing.then(() => fs.writeFile(file, Buffer.from(ev.data, 'base64')));
    frames.push({ idx, t });
    client.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  });

  // Cursor-Status (in CSS-Viewport-Koordinaten)
  let cx = width / 2;
  let cy = height / 2;
  const beats = [];

  async function setCursor(x, y) {
    cx = x; cy = y;
    await page.evaluate(([px, py]) => window.__demoCursor && window.__demoCursor.setPos(px, py), [x, y]);
  }
  async function resolvePoint(target) {
    if (target && typeof target === 'object' && 'x' in target) return { x: target.x, y: target.y };
    const box = await page.locator(target).first().boundingBox();
    if (!box) throw new Error(`Kein boundingBox für ${target}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  async function easedMove(to, { steps = 28, stepMs = 14 } = {}) {
    const from = { x: cx, y: cy };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const n = Math.max(8, Math.min(48, Math.round(dist / 24)));
    for (let i = 1; i <= n; i++) {
      const e = easeInOutCubic(i / n);
      const x = from.x + (to.x - from.x) * e;
      const y = from.y + (to.y - from.y) * e;
      await page.mouse.move(x, y);
      await setCursor(x, y);
      await sleep(stepMs);
    }
  }

  // --- Driver-Objekt für die Flows ---
  const d = {
    page,
    cfg: { width, height },
    async goto(path = '/') {
      await page.goto(baseURL + path, { waitUntil: 'networkidle' });
      await setCursor(cx, cy);
    },
    async waitFor(sel, opts = {}) {
      await page.locator(sel).first().waitFor({ state: 'visible', timeout: 8000, ...opts });
    },
    async settle(ms = 600) { await sleep(ms); },
    async moveTo(target, opts) { await easedMove(await resolvePoint(target), opts); },
    async click(target) {
      const p = await resolvePoint(target);
      await easedMove(p);
      await page.evaluate(([x, y]) => window.__demoCursor && window.__demoCursor.ripple(x, y), [p.x, p.y]);
      await page.mouse.down(); await sleep(60); await page.mouse.up();
      await sleep(120);
    },
    // Rechteck-Auswahl auf dem Canvas: gedrückt ziehen.
    async drag(from, to, opts = {}) {
      const a = await resolvePoint(from);
      const b = await resolvePoint(to);
      await easedMove(a);
      await page.evaluate(() => window.__demoCursor && window.__demoCursor.press(true));
      await page.mouse.down();
      await sleep(120);
      // langsam ziehen, damit die Live-Badge mittickt
      const n = opts.steps || 36;
      for (let i = 1; i <= n; i++) {
        const e = easeInOutCubic(i / n);
        const x = a.x + (b.x - a.x) * e;
        const y = a.y + (b.y - a.y) * e;
        await page.mouse.move(x, y);
        await setCursor(x, y);
        await sleep(opts.stepMs || 22);
      }
      await sleep(180);
      // Optional: mit gedrückter Maus halten (Rechteck + Preis-Badge sichtbar),
      // z. B. um hier einen Beat + VO-Hold zu platzieren.
      if (opts.hold) await opts.hold();
      if (!opts.noRelease) {
        await page.mouse.up();
        await page.evaluate(() => window.__demoCursor && window.__demoCursor.press(false));
        await sleep(120);
      }
    },
    async type(sel, text, { perChar = 45 } = {}) {
      await this.click(sel);
      await page.locator(sel).first().fill('');
      await page.keyboard.type(text, { delay: perChar });
      await sleep(120);
    },
    async setFile(sel, filePath) {
      await page.locator(sel).first().setInputFiles(filePath);
      await sleep(150);
    },
    async check(sel) {
      const p = await resolvePoint(sel);
      await easedMove(p);
      await page.evaluate(([x, y]) => window.__demoCursor && window.__demoCursor.ripple(x, y), [p.x, p.y]);
      await page.locator(sel).first().check();
      await sleep(120);
    },
    // Grid-(gx,gy) -> Viewport-CSS-Punkt auf dem #grid-Canvas
    async gridPoint(gx, gy) {
      return await page.evaluate(([gx, gy]) => {
        const c = document.getElementById('grid');
        const r = c.getBoundingClientRect();
        const cw = r.width / c.width, ch = r.height / c.height;
        return { x: r.left + (gx + 0.5) * cw, y: r.top + (gy + 0.5) * ch };
      }, [gx, gy]);
    },
    async scrollTo(sel) {
      await page.locator(sel).first().scrollIntoViewIfNeeded();
      await sleep(700); // smooth-scroll/settle
    },
    // *** Der wichtigste Call: Story-Beat markieren ***
    beat(label, note = '') {
      const t = t0 ? performance.now() - t0 : 0;
      beats.push({ label, note, t: +(t / 1000).toFixed(3), x: +cx.toFixed(1), y: +cy.toFixed(1) });
    },
    // Zoom-Anker ohne Aktion (Cursor bleibt, markiert Fokuspunkt)
    async zoomAt(target, label) {
      const p = await resolvePoint(target);
      await setCursor(p.x, p.y);
      this.beat(label, `zoom@${target}`);
    },
  };

  // --- Aufnahme starten ---
  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  t0 = performance.now();

  await flow(d);

  // --- Aufnahme stoppen ---
  const endT = performance.now() - t0;
  await client.send('Page.stopScreencast').catch(() => {});
  await writing; // alle Frame-Writes abschließen
  await browser.close();
  server.close();

  if (frames.length < 2) throw new Error('Zu wenige Frames aufgenommen.');

  // --- CFR-MP4 bauen: concat-Demuxer mit echten Frame-Dauern, dann -r fps ---
  const list = [];
  for (let i = 0; i < frames.length; i++) {
    const cur = frames[i];
    const next = frames[i + 1];
    const durMs = (next ? next.t : endT) - cur.t;
    const dur = Math.max(0.001, durMs / 1000);
    list.push(`file 'frames/f_${String(cur.idx).padStart(6, '0')}.png'`);
    list.push(`duration ${dur.toFixed(4)}`);
  }
  // concat-Quirk: letztes Bild erneut ohne duration
  list.push(`file 'frames/f_${String(frames[frames.length - 1].idx).padStart(6, '0')}.png'`);
  const listFile = join(outDir, 'frames.txt');
  await fs.writeFile(listFile, list.join('\n'));

  const mp4 = join(outDir, 'capture.mp4');
  await run('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vsync', 'cfr', '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    mp4,
  ]);

  // --- action-timeline.json schreiben ---
  const timeline = {
    name: cfg.name,
    width: Math.round(width * dsf),
    height: Math.round(height * dsf),
    cssWidth: width,
    cssHeight: height,
    dsf,
    fps,
    duration: +(endT / 1000).toFixed(3),
    frameCount: frames.length,
    beats,
  };
  await fs.writeFile(join(outDir, 'action-timeline.json'), JSON.stringify(timeline, null, 2));

  // Frames aufräumen (MP4 + concat-Liste reichen)
  await fs.rm(framesDir, { recursive: true, force: true });
  await fs.rm(listFile, { force: true });

  console.log(`✅ Capture "${cfg.name}": ${frames.length} Frames, ${timeline.duration}s, ${beats.length} Beats`);
  console.log(`   -> ${mp4}`);
  return timeline;
}
