// ============================================================
//  Capture für den Teaser: ECHTE Seite, MOBIL, LEERE Wand.
//  Hero (0 verkauft) -> runter zur leeren Wand -> Rechteck ziehen
//  und gedrückt HALTEN (zeigt Auswahl + Preis-Badge, KEIN Modal).
//  Dient als scharfer Hintergrund für den großen Hook-Text.
// ============================================================
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runCapture } from '../lib/harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'out', 'teaser');

export async function captureTeaser() {
  await fs.mkdir(OUT, { recursive: true });
  return runCapture(
    { name: 'teaser', outDir: OUT, width: 414, height: 736, dsf: 3, mock: { empty: true } },
    async (d) => {
      await d.goto('/');
      await d.waitFor('#startBuy');
      await d.settle(400);
      d.beat('hero', '0 verkauft sichtbar');
      await d.settle(2600);            // Hero: 0 sold / 125.000 free
      await d.moveTo('.stats');
      await d.settle(900);

      await d.click('#startBuy');       // -> runter zur Wand
      await d.settle(900);
      await d.waitFor('#grid');
      d.beat('wall', 'leere Wand');
      await d.settle(1400);

      // Rechteck ziehen + gedrückt halten (Auswahl + Badge sichtbar, kein Modal)
      const gx0 = 235, gy0 = 95, gx1 = gx0 + 11, gy1 = gy0 + 11;
      const from = await d.gridPoint(gx0, gy0);
      const to = await d.gridPoint(gx1, gy1);
      await d.moveTo(from);
      await d.settle(200);
      await d.drag(from, to, {
        steps: 28, stepMs: 22, noRelease: true,
        hold: async () => { d.beat('select', 'Auswahl gehalten'); await d.settle(5200); },
      });
    }
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  captureTeaser().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
