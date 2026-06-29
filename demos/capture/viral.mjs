// ============================================================
//  Capture-Hintergrund für das virale Video: echte Seite, MOBIL,
//  LEERE Wand. Etwas länger (~19 s), damit es die Story-VO abdeckt.
// ============================================================
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runCapture } from '../lib/harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'out', 'viral');

export async function captureViral() {
  await fs.mkdir(OUT, { recursive: true });
  return runCapture(
    { name: 'viral', outDir: OUT, width: 414, height: 736, dsf: 3, mock: { empty: true } },
    async (d) => {
      await d.goto('/');
      await d.waitFor('#startBuy');
      await d.settle(400);
      d.beat('hero', '0 verkauft');
      await d.settle(3800);
      await d.moveTo('.stats');
      await d.settle(1200);

      await d.click('#startBuy');
      await d.settle(900);
      await d.waitFor('#grid');
      d.beat('wall', 'leere Wand');
      await d.settle(2200);

      // Auswahl ziehen + gedrückt halten (kein Modal), lange genug für die Story
      const gx0 = 235, gy0 = 95, gx1 = gx0 + 11, gy1 = gy0 + 11;
      const from = await d.gridPoint(gx0, gy0);
      const to = await d.gridPoint(gx1, gy1);
      await d.moveTo(from);
      await d.settle(200);
      await d.drag(from, to, {
        steps: 28, stepMs: 22, noRelease: true,
        hold: async () => { d.beat('select', 'Auswahl gehalten'); await d.settle(9500); },
      });
    }
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  captureViral().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
