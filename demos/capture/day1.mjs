// ============================================================
//  Flow "day1" — Daily-Update-Serie, Tag 1:
//  MOBIL-Ansicht (schmaler Viewport, aber Maus-Steuerung -> Rechteck-
//  Auswahl funktioniert), LEERE Wand (0 verkauft), Day-1-Hook.
//  Viewport 414×736 = exakt 9:16 -> füllt den Frame nativ.
// ============================================================
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runCapture } from '../lib/harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'out', 'day1');
const ASSETS = join(__dirname, '..', 'assets');
const PLACEHOLDER = join(ASSETS, 'placeholder-logo.png');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, { stdio: 'ignore' });
    ps.on('error', reject);
    ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exit ${c}`))));
  });
}
async function ensurePlaceholder() {
  await fs.mkdir(ASSETS, { recursive: true });
  try { await fs.access(PLACEHOLDER); return; } catch {}
  await run('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'color=c=0x2f6bff:s=240x240',
    '-f', 'lavfi', '-i', 'color=c=0x14c2da:s=240x240',
    '-filter_complex', 'blend=all_mode=addition:all_opacity=0.5,format=rgb24',
    '-frames:v', '1', PLACEHOLDER,
  ]);
}
async function loadVoDurations(lang = 'en') {
  try {
    const m = JSON.parse(await fs.readFile(join(__dirname, '..', 'tts', 'cache', `day1-${lang}.json`), 'utf8'));
    const map = {}; for (const v of m) map[v.label] = v.dur; return map;
  } catch { return null; }
}

export async function captureDay1({ lang = 'en' } = {}) {
  await ensurePlaceholder();
  await fs.mkdir(OUT, { recursive: true });
  const VO = await loadVoDurations(lang);
  const hold = (label, fallback = 1.2, extra = 0.12) =>
    Math.round(((VO && VO[label] ? VO[label] : fallback) + extra) * 1000);
  console.log(VO ? '🎚️  day1 VO-getaktet (en)' : '🎚️  day1 Default-Pacing (kein VO-Manifest)');

  // MOBIL: 414×736 (9:16), deviceScaleFactor 3. mock.empty -> leere Wand.
  return runCapture(
    { name: 'day1', outDir: OUT, width: 414, height: 736, dsf: 3, mock: { empty: true } },
    async (d) => {
      // 1) Landung — Hero, 0 verkauft / 125.000 frei
      await d.goto('/');
      await d.waitFor('#startBuy');
      await d.settle(300);
      d.beat('land', 'Hero, leere Wand');
      await d.settle(hold('land'));
      await d.moveTo('.stats');
      d.beat('stats', '0 verkauft / 125.000 frei');
      await d.settle(hold('stats'));

      // 2) Auf die (leere) Wand
      await d.click('#startBuy');
      await d.settle(550);
      await d.waitFor('#grid');
      d.beat('wall', 'leere Wand');
      await d.settle(hold('wall', 0.8));

      // 3) Rechteck zihen (leere Wand -> freie Wahl). 10×10 = 100 px = 100 €.
      const gx0 = 240, gy0 = 100, gx1 = gx0 + 9, gy1 = gy0 + 9;
      const from = await d.gridPoint(gx0, gy0);
      const to = await d.gridPoint(gx1, gy1);
      await d.moveTo(from);
      await d.settle(150);
      await d.drag(from, to, {
        steps: 30, stepMs: 18,
        hold: async () => { d.beat('select', 'Auswahl, Badge tickt'); await d.settle(hold('select')); },
      });

      // 4) Kauf-Modal
      await d.waitFor('#buyModal .modal-box');
      await d.settle(200);
      d.beat('modal', 'Größe & Preis');
      await d.settle(hold('modal', 0.8));

      // 5) Formular schnell (kurz & knackig): nur Bild + E-Mail + Häkchen
      await d.setFile('#imgInput', PLACEHOLDER);
      await d.settle(120);
      await d.type('#emailInput', 'you@example.com', { perChar: 12 });
      await d.check('#agreeInput');
      d.beat('form', 'Formular gefüllt');
      await d.settle(hold('form', 0.7));

      // 6) Bezahlen (gemockt) -> Konfetti
      await d.click('#payBtn');
      await d.waitFor('.success-ov', { timeout: 12000 });
      d.beat('success', 'Konfetti / sei der Erste');
      await d.settle(hold('success', 2.4, 0.3));
    }
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  captureDay1().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
