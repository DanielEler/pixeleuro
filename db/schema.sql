-- ============================================================
--  PixelEuro – Datenbankschema (PostgreSQL)
--  Freiform-Pixel-Besitz: jede einzelne Zelle gehört genau einer
--  Anzeige (PRIMARY KEY (x,y) verhindert Doppelverkauf physisch).
--  Alle Daten (auch Bilder) in der DB, nicht im Dateisystem (DSGVO).
-- ============================================================

-- Eine Anzeige = ein Kauf / ein Design (gemaltes Muster oder Logo).
CREATE TABLE IF NOT EXISTS ads (
  id                BIGSERIAL PRIMARY KEY,

  -- Bounding-Box des Designs (für Bild-Platzierung beim Rendern)
  x                 INTEGER NOT NULL CHECK (x >= 0),
  y                 INTEGER NOT NULL CHECK (y >= 0),
  w                 INTEGER NOT NULL CHECK (w >= 1),
  h                 INTEGER NOT NULL CHECK (h >= 1),

  -- Tatsächlich gekaufte Einzelpixel (= Preis-Basis, kann < w*h sein)
  pixel_count       INTEGER NOT NULL DEFAULT 0,

  link              TEXT,
  title             TEXT,
  image             BYTEA,
  image_mime        TEXT NOT NULL DEFAULT 'image/png',
  email             TEXT,

  amount_cents      INTEGER NOT NULL,
  stripe_session_id TEXT,

  status            TEXT NOT NULL DEFAULT 'reserved',   -- reserved | paid | active | rejected | expired
  approved          BOOLEAN NOT NULL DEFAULT FALSE,
  reserved_until    TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at           TIMESTAMPTZ
);

-- Pro-Pixel-Besitz: die Wahrheit für Überlappung & Doppelverkauf-Schutz.
CREATE TABLE IF NOT EXISTS pixels (
  x      INTEGER NOT NULL CHECK (x >= 0),
  y      INTEGER NOT NULL CHECK (y >= 0),
  ad_id  BIGINT  NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  color  TEXT,
  PRIMARY KEY (x, y)
);

CREATE INDEX IF NOT EXISTS idx_ads_status  ON ads (status);
CREATE INDEX IF NOT EXISTS idx_ads_session ON ads (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_pixels_ad   ON pixels (ad_id);
