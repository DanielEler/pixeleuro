-- ============================================================
--  PixelEuro – D1 (SQLite) Schema für Cloudflare Workers
--  Bilder liegen in R2 (Objektspeicher), nicht lokal -> referenziert via image_key.
-- ============================================================

CREATE TABLE IF NOT EXISTS ads (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  x                 INTEGER NOT NULL,
  y                 INTEGER NOT NULL,
  w                 INTEGER NOT NULL,
  h                 INTEGER NOT NULL,
  link              TEXT,
  title             TEXT,
  email             TEXT,
  image_key         TEXT,                 -- Schlüssel des Bildes im R2-Bucket
  image_mime        TEXT NOT NULL DEFAULT 'image/png',
  amount_cents      INTEGER NOT NULL,
  stripe_session_id TEXT,
  status            TEXT NOT NULL DEFAULT 'reserved',  -- reserved|paid|active|rejected|expired
  approved          INTEGER NOT NULL DEFAULT 0,
  reserved_until    TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_ads_status  ON ads (status);
CREATE INDEX IF NOT EXISTS idx_ads_session ON ads (stripe_session_id);
