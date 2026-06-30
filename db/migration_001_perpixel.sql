-- ============================================================
--  Migration 001 — Rechteck -> Pro-Pixel (r/place)
--  ADDITIV & IDEMPOTENT. Sicher auf der bestehenden Live-DB:
--  nichts wird gelöscht/umbenannt, keine Downtime, kein Datenverlust.
--  (Die docker-entrypoint-initdb-Mount migriert ein BESTEHENDES
--   Volume NICHT — daher diese Datei explizit per psql anwenden.)
-- ============================================================
BEGIN;

-- a) Neue Spalte auf ads (Anzahl tatsächlich gekaufter Einzelpixel = Preis-Basis)
ALTER TABLE ads ADD COLUMN IF NOT EXISTS pixel_count INTEGER NOT NULL DEFAULT 0;

-- b) Pro-Pixel-Besitz: PRIMARY KEY(x,y) verhindert Doppelverkauf physisch
CREATE TABLE IF NOT EXISTS pixels (
  x      INTEGER NOT NULL CHECK (x >= 0),
  y      INTEGER NOT NULL CHECK (y >= 0),
  ad_id  BIGINT  NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  color  TEXT,
  PRIMARY KEY (x, y)
);
CREATE INDEX IF NOT EXISTS idx_pixels_ad   ON pixels (ad_id);
CREATE INDEX IF NOT EXISTS idx_ads_reserved ON ads (reserved_until) WHERE status = 'reserved';

-- c) Backfill: bestehende, die Wand belegende Anzeigen (Rechtecke) als Pixel
--    materialisieren. Mit der aktuellen Live-DB (nur expired/Test) = 0 Zeilen.
INSERT INTO pixels (x, y, ad_id, color)
SELECT gx, gy, a.id, '#c6d4da'
FROM ads a
CROSS JOIN LATERAL generate_series(a.x, a.x + a.w - 1) AS gx
CROSS JOIN LATERAL generate_series(a.y, a.y + a.h - 1) AS gy
WHERE a.status IN ('active','paid')
   OR (a.status = 'reserved' AND a.reserved_until > now())
ON CONFLICT (x, y) DO NOTHING;

-- d) pixel_count aus den Pixel-Zeilen setzen
UPDATE ads a SET pixel_count = c.n
FROM (SELECT ad_id, count(*) n FROM pixels GROUP BY ad_id) c
WHERE c.ad_id = a.id;

COMMIT;
