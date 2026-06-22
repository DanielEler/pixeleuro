-- ============================================================
--  Pixelwebsite – Datenbankschema (PostgreSQL)
--  Alle Daten (auch hochgeladene Bilder) liegen in der DB,
--  nicht im lokalen Dateisystem -> einfacher zu sichern & DSGVO-konform.
-- ============================================================

CREATE TABLE IF NOT EXISTS ads (
  id                BIGSERIAL PRIMARY KEY,

  -- Position & Größe des gekauften Rechtecks im Raster (in Pixeln)
  x                 INTEGER NOT NULL CHECK (x >= 0),
  y                 INTEGER NOT NULL CHECK (y >= 0),
  w                 INTEGER NOT NULL CHECK (w >= 1),
  h                 INTEGER NOT NULL CHECK (h >= 1),

  -- Inhalt der Anzeige
  link              TEXT,              -- Ziel-URL beim Klick
  title             TEXT,              -- Tooltip / Alt-Text
  image             BYTEA,             -- das Logo/Bild, in der DB gespeichert
  image_mime        TEXT NOT NULL DEFAULT 'image/png',

  -- Käufer (datensparsam: nur das Nötigste)
  email             TEXT,              -- für Zahlungsbeleg

  -- Zahlung
  amount_cents      INTEGER NOT NULL,
  stripe_session_id TEXT,

  -- Status: reserved | paid | active | rejected | expired
  status            TEXT NOT NULL DEFAULT 'reserved',
  approved          BOOLEAN NOT NULL DEFAULT FALSE,
  reserved_until    TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at           TIMESTAMPTZ
);

-- Schneller Zugriff für Überschneidungs-Prüfungen und Anzeige
CREATE INDEX IF NOT EXISTS idx_ads_status   ON ads (status);
CREATE INDEX IF NOT EXISTS idx_ads_rect     ON ads (x, y, w, h);
CREATE INDEX IF NOT EXISTS idx_ads_session  ON ads (stripe_session_id);
