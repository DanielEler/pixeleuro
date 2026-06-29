# PixelEuro — Brand Tokens (Single Source of Truth)

Quelle: `public/style.css` `:root`. Diese Werte sind die einzige Wahrheit für
alle Kompositionen (Hintergrund, Untertitel, Fensterrahmen, Callouts).

## Farben
| Token        | Hex       | Rolle                              |
|--------------|-----------|------------------------------------|
| `ink`        | `#122530` | Text dunkel (Blau-Ink, kein Schwarz) |
| `muted`      | `#5b6b75` | Sekundärtext                       |
| `bg`         | `#ffffff` | Seiten-Hintergrund                 |
| `bg2`        | `#f2fbfc` | zarter Türkis-Hauch                |
| `brand1`     | `#14c2da` | Türkis (Pixi) — Primär-Akzent      |
| `brand2`     | `#2f6bff` | Blau (Pixi-Ring) — Sekundär-Akzent |
| `accent`     | `#0e93a8` | lesbares Teal für Highlights       |
| `ok`         | `#16a34a` | Erfolg / grün                      |
| `gold`       | `#FFCB3A` | Konfetti/Highlight-Gold            |
| `pink`       | `#d4537e` | Konfetti-Akzent                    |

## Verlauf (Marke)
- Primär: `linear-gradient(135deg, #14c2da 0%, #2f6bff 100%)`
- Dunkler Bühnen-Hintergrund (9:16): `radial-gradient(120% 80% at 50% 0%, #0b3a52 0%, #061826 60%, #03101a 100%)`

## Typo
- Familie: **Inter** (400/500/600/700/800/900), wie auf der Seite.
- Untertitel: 800/900, `letter-spacing: -0.02em`.
- Zahlen-Ticker: tabular-nums.

## Format
- Social-Primärformat: **9:16 = 1080 × 1920**.
- Capture (Desktop-Fenster): 1280 × 800 @ deviceScaleFactor 2.

## Maskottchen
- **Pixi** (`public/logo.svg`) — Münz-Charakter, Marken-Blau. Für Intro/Outro nutzbar.

## Tonalität
- Direkt, knapp, leicht frech (vgl. Seiten-Copy „Kauf dir hier bloß keinen Pixel, wenn…").
- Kein Hype-Sprech, keine erfundenen Zahlen.
