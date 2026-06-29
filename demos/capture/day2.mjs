// ============================================================
//  Capture-Hintergrund Day 2: echte Seite, MOBIL, leere Wand.
//  Zeigt den Select/Move-Toggle + eine gezogene Mehrfach-Auswahl
//  (die neue Mobil-Funktion). ~16 s für die VO.
// ============================================================
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runCapture } from '../lib/harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'out', 'day2');

export async function captureDay2() {
  await fs.mkdir(OUT, { recursive: true });
  return runCapture(
    { name: 'day2', outDir: OUT, width: 414, height: 736, dsf: 4, mock: { empty: true } },
    async (d) => {
      await d.goto('/');
      await d.waitFor('#startBuy');
      await d.settle(400);
      d.beat('hero', '0 verkauft');
      await d.settle(3000);
      await d.moveTo('.stats');
      await d.settle(900);

      await d.click('#startBuy');       // -> Wand + Select-Modus
      await d.settle(900);
      await d.waitFor('#grid');
      d.beat('wall', 'leere Wand + Toggle sichtbar');
      await d.settle(1600);

      // Mehrfach-Auswahl ziehen + halten (zeigt die neue Mobil-Funktion)
      const gx0 = 232, gy0 = 92, gx1 = gx0 + 13, gy1 = gy0 + 13;
      const from = await d.gridPoint(gx0, gy0);
      const to = await d.gridPoint(gx1, gy1);
      await d.moveTo(from);
      await d.settle(200);
      await d.drag(from, to, {
        steps: 30, stepMs: 22, noRelease: true,
        hold: async () => { d.beat('select', 'Block-Auswahl gehalten'); await d.settle(6800); },
      });
    }
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  captureDay2().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
