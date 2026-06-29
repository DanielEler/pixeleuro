// ============================================================
//  Hero-Flow "buy" — der Money-Shot:
//  Wand -> Rechteck ziehen -> Preis tickt -> Kauf-Modal ->
//  ausfüllen -> (gemockt) bezahlen -> Konfetti "für immer drin".
//  Sprach-neutral aufgenommen (Seite ist DE-only); VO/Untertitel
//  kommen erst in der Komposition (DE+EN aus EINEM Capture).
// ============================================================
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runCapture } from '../lib/harness.mjs';
import { primeZone } from '../lib/mock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'out', 'buy');
const ASSETS = join(__dirname, '..', 'assets');
const PLACEHOLDER = join(ASSETS, 'placeholder-logo.png');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, { stdio: 'ignore' });
    ps.on('error', reject);
    ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exit ${c}`))));
  });
}

// Anonymisiertes Platzhalter-Logo (keine echte Marke/Person) für den Upload.
async function ensurePlaceholder() {
  await fs.mkdir(ASSETS, { recursive: true });
  try { await fs.access(PLACEHOLDER); return; } catch {}
  await run('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x2f6bff:s=240x240',
    '-f', 'lavfi', '-i', 'color=c=0x14c2da:s=240x240',
    '-filter_complex', 'blend=all_mode=addition:all_opacity=0.5,format=rgb24',
    '-frames:v', '1', PLACEHOLDER,
  ]);
}

// VO-Manifest laden (label -> Dauer), um den Capture auf die Stimme zu takten.
async function loadVoDurations(lang = 'en') {
  try {
    const m = JSON.parse(await fs.readFile(join(__dirname, '..', 'tts', 'cache', `buy-${lang}.json`), 'utf8'));
    const map = {};
    for (const v of m) map[v.label] = v.dur;
    return map;
  } catch { return null; }
}

export async function captureBuy({ lang = 'en' } = {}) {
  await ensurePlaceholder();
  await fs.mkdir(OUT, { recursive: true });
  const VO = await loadVoDurations(lang);
  // Dwell pro Beat = VO-Länge + knapper Atem-Puffer (straff für schnelles Tempo).
  const hold = (label, fallback = 1.2, extra = 0.12) =>
    Math.round(((VO && VO[label] ? VO[label] : fallback) + extra) * 1000);
  console.log(VO ? '🎚️  Capture VO-getaktet (en)' : '🎚️  Capture mit Default-Pacing (kein VO-Manifest)');

  return runCapture({ name: 'buy', outDir: OUT }, async (d) => {
    // 1) Landung — Hero + animierte Zähler
    await d.goto('/');
    await d.waitFor('#startBuy');
    await d.settle(250);
    d.beat('land', 'Hero sichtbar');
    await d.settle(hold('land'));
    await d.moveTo('.stats');
    d.beat('stats', 'verkauft/frei/Preis');
    await d.settle(hold('stats'));

    // 2) Auf die Wand
    await d.click('#startBuy');     // -> goToWall (smooth scroll)
    await d.settle(550);
    await d.waitFor('#grid');
    d.beat('wall', 'Wand sichtbar');
    await d.settle(hold('wall'));

    // 3) Rechteck in der freien Prime-Zone ziehen (Preis tickt live).
    //    10×10 = 100 Pixel = 100,00 € (approachable, "ab 1 €" glaubwürdig).
    const gx0 = primeZone.x + 28, gy0 = primeZone.y + 30;
    const gx1 = gx0 + 9, gy1 = gy0 + 9;
    const from = await d.gridPoint(gx0, gy0);
    const to = await d.gridPoint(gx1, gy1);
    await d.moveTo(from);
    await d.settle(150);
    // 'select'-Beat WÄHREND des Ziehens: Maus bleibt gedrückt, Rechteck +
    // Preis-Badge sichtbar, VO "drag a rectangle — the price counts up live".
    await d.drag(from, to, {
      steps: 30, stepMs: 18,
      hold: async () => { d.beat('select', 'Auswahl sichtbar, Badge tickt'); await d.settle(hold('select')); },
    });

    // 4) Kauf-Modal — Größe & Preis
    await d.waitFor('#buyModal .modal-box');
    await d.settle(200);
    d.beat('modal', 'Größe & Preis');
    await d.settle(hold('modal'));

    // 5) Formular ausfüllen (anonymisierte Platzhalter) — zügig getippt
    await d.setFile('#imgInput', PLACEHOLDER);
    await d.settle(150);
    await d.type('#titleInput', 'my brand', { perChar: 14 });
    await d.type('#emailInput', 'you@example.com', { perChar: 14 });
    d.beat('form', 'Formular gefüllt');
    await d.check('#agreeInput');
    await d.settle(hold('form'));

    // 6) Bezahlen (gemockt -> /?success=1) -> Konfetti
    await d.click('#payBtn');
    await d.waitFor('.success-ov', { timeout: 12000 });
    d.beat('success', 'Konfetti / für immer drin');
    await d.settle(hold('success', 2.6, 0.3));
  });
}

// Direkt ausführbar: `node capture/buy.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  captureBuy().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
