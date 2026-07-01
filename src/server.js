// ============================================================
//  Pixelwebsite – Server (Express + PostgreSQL + Stripe)
// ============================================================
import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import Stripe from 'stripe';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query, pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- Konfiguration ----------
const CFG = {
  port: Number(process.env.PORT || 3000),
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000',
  gridW: Number(process.env.GRID_W || 500),
  gridH: Number(process.env.GRID_H || 250),
  pricePerPixel: Number(process.env.PIXEL_PRICE_CENTS || 100),
  minOrderCents: Number(process.env.MIN_ORDER_CENTS || 1000),
  reservationMin: Number(process.env.RESERVATION_MINUTES || 15),
  adminToken: process.env.ADMIN_TOKEN || '',
  siteName: process.env.SITE_NAME || 'PixelEuro',
  siteTagline: process.env.SITE_TAGLINE || '1 pixel. 1 euro.',
};

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// sharp ist optional: skaliert Uploads serverseitig exakt auf die Fläche (effizienter).
// Falls die native Bibliothek nicht ladbar ist, läuft die App trotzdem – das Bild wird
// dann unverändert gespeichert und vom Canvas im Browser skaliert.
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch (err) {
  console.warn('⚠️  sharp not available – images are stored without server-side scaling.');
}

const app = express();
app.set('trust proxy', 1); // hinter Cloudflare/Reverse-Proxy korrekte Client-IP

// ---------- Stripe Webhook (braucht ROHEN Body -> vor express.json) ----------
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Invalid webhook signature:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      const r = await query(
        `UPDATE ads
           SET status = 'paid', paid_at = now(), email = COALESCE($2, email)
         WHERE stripe_session_id = $1 AND status = 'reserved'`,
        [session.id, session.customer_details?.email || null]
      );
      if (r.rowCount === 0) {
        // Reservierung war bei Zahlungseingang schon abgelaufen -> Pixel evtl. weg.
        // Laut + sichtbar loggen für manuelle Prüfung/Erstattung.
        console.error('⚠️ PAYMENT_AFTER_EXPIRY — paid but no reserved ad for session', session.id);
      } else {
        console.log('✅ Payment confirmed for session', session.id);
      }
    } catch (err) {
      console.error('Error recording payment:', err);
    }
  }
  res.json({ received: true });
});

// ---------- Standard-Middleware ----------
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12 MB – Handyfotos sind oft 4–10 MB
});

// Upload-Middleware mit SAUBERER Fehlerbehandlung: ein zu großes Bild darf
// NIE einen unbehandelten 500 (HTML) werfen — der ließ den Bezahl-Button hängen.
function uploadImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      console.warn('Upload abgelehnt:', err.code || err.message);
      return res.status(400).json({
        error: tooBig
          ? 'Image too large (max. 12 MB). Please pick a smaller photo and try again.'
          : 'Could not read that image. Please try a different one.',
      });
    }
    next();
  });
}

// Großzügiger: mobile Nutzer teilen sich oft eine Carrier-IP (NAT) — ein zu
// niedriges Limit blockt echte Käufer. 60/Min/IP bremst nur Missbrauch.
const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

// ---------- Hilfsfunktionen ----------
function clampInt(v, min, max) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, v));
}

// Gibt abgelaufene Reservierungen frei — inkl. der belegten Pixel (sonst
// bleiben die Zellen für immer gesperrt). Pixel ZUERST löschen wäre falsch
// (FK), daher: erst expired markieren, dann deren Pixel löschen.
async function releaseExpired() {
  try {
    const { rows } = await query(
      `UPDATE ads SET status = 'expired'
       WHERE status = 'reserved' AND reserved_until < now()
       RETURNING id`
    );
    if (rows.length) {
      await query(`DELETE FROM pixels WHERE ad_id = ANY($1::bigint[])`, [rows.map((r) => r.id)]);
    }
  } catch (err) {
    console.error('Cleanup error:', err.message);
  }
}
setInterval(releaseExpired, 60 * 1000);

// ---------- API: Konfiguration fürs Frontend ----------
app.get('/api/config', (req, res) => {
  res.json({
    gridW: CFG.gridW,
    gridH: CFG.gridH,
    pricePerPixel: CFG.pricePerPixel,
    minOrderCents: CFG.minOrderCents,
    siteName: CFG.siteName,
    siteTagline: CFG.siteTagline,
    paymentEnabled: !!stripe,
  });
});

// ---------- API: belegte Flächen + aktive Anzeigen ----------
app.get('/api/ads', async (req, res) => {
  try {
    await releaseExpired();
    // Belegte Einzelpixel: freigegebene zeigen ihre echte Farbe, noch nicht
    // moderierte (reserved/paid) erscheinen NEUTRAL grau (Inhalt erst nach Prüfung).
    const { rows: pix } = await query(
      `SELECT p.x, p.y,
              CASE WHEN a.status = 'active' THEN p.color ELSE '#c6d4da' END AS color,
              (a.status IN ('active','paid'))::int AS sold
         FROM pixels p
         JOIN ads a ON a.id = p.ad_id
        WHERE a.status IN ('active','paid')
           OR (a.status = 'reserved' AND a.reserved_until > now())`
    );
    const pixels = pix.map((r) => ({ x: r.x, y: r.y, c: r.color }));
    const soldPixels = pix.reduce((s, r) => s + (r.sold ? 1 : 0), 0);

    // Aktive (freigeschaltete) Anzeigen: Bounding-Box + Link/Titel für Tooltip/Klick.
    const { rows: ads } = await query(
      `SELECT id, x, y, w, h, title, link FROM ads WHERE status = 'active'`
    );
    const adsOut = ads.map((a) => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h, title: a.title, link: a.link, image: `/img/${a.id}` }));

    res.json({ pixels, ads: adsOut, soldPixels, totalPixels: CFG.gridW * CFG.gridH });
  } catch (err) {
    console.error('Error in /api/ads:', err.message);
    res.status(500).json({ error: 'Database unavailable.' });
  }
});

// ---------- API: Bild einer aktiven Anzeige ausliefern ----------
app.get('/img/:id', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT image, image_mime FROM ads WHERE id = $1 AND status = 'active'`,
      [req.params.id]
    );
    if (!rows.length || !rows[0].image) return res.status(404).end();
    res.set('Content-Type', rows[0].image_mime);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(rows[0].image);
  } catch (err) {
    res.status(500).end();
  }
});

// ---------- API: Bestellung anlegen + Stripe-Checkout starten ----------
app.post('/api/orders', orderLimiter, uploadImage, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payment is not configured.' });

    // Freiform-Zellen vom Client parsen + SERVERSEITIG validieren (nie dem Client trauen).
    let raw;
    try { raw = JSON.parse(req.body.cells || '[]'); } catch { raw = []; }
    if (!Array.isArray(raw) || raw.length === 0)
      return res.status(400).json({ error: 'Please paint some pixels first.' });

    const seen = new Set();
    const xs = [], ys = [], colors = [];
    let bx = Infinity, by = Infinity, bX = -1, bY = -1;
    for (const c of raw) {
      const cx = clampInt(c && c.x, 0, CFG.gridW - 1);
      const cy = clampInt(c && c.y, 0, CFG.gridH - 1);
      if (cx === null || cy === null) continue;
      const key = cx + ',' + cy;
      if (seen.has(key)) continue;            // Duplikate raus (sonst Selbst-Kollision)
      seen.add(key);
      const col = (c && typeof c.c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.c)) ? c.c.toLowerCase() : '#2f6bff';
      xs.push(cx); ys.push(cy); colors.push(col);
      if (cx < bx) bx = cx; if (cy < by) by = cy; if (cx > bX) bX = cx; if (cy > bY) bY = cy;
    }
    const pixelCount = xs.length;
    if (pixelCount === 0) return res.status(400).json({ error: 'No valid pixels selected.' });
    if (pixelCount > CFG.gridW * CFG.gridH) return res.status(400).json({ error: 'Too many pixels.' });

    console.log('ORDER_ATTEMPT', new Date().toISOString(), pixelCount + 'px', 'img:', !!req.file);

    const link = (req.body.link || '').trim();
    const title = (req.body.title || '').trim().slice(0, 120);
    const email = (req.body.email || '').trim().slice(0, 200);
    if (link && !/^https?:\/\/.+/i.test(link))
      return res.status(400).json({ error: 'Link must start with http:// or https://.' });

    const amount = pixelCount * CFG.pricePerPixel;
    if (amount < CFG.minOrderCents)
      return res.status(400).json({ error: `Minimum order ${(CFG.minOrderCents / 100).toFixed(2)} € – please pick more pixels.` });

    const bw = bX - bx + 1, bh = bY - by + 1;

    // Optionales Design-Bild (für Moderation/Logo) — Rendering läuft pro-Pixel über Farben.
    let imageBuf = null, imageMime = 'image/png';
    if (req.file) {
      imageBuf = req.file.buffer; imageMime = req.file.mimetype || 'image/png';
      if (sharp) { try { imageBuf = await sharp(req.file.buffer, { failOn: 'none' }).png().toBuffer(); imageMime = 'image/png'; } catch { imageBuf = req.file.buffer; } }
    }

    // Atomar: Anzeige anlegen + ALLE Zellen claimen. PRIMARY KEY(x,y) verhindert
    // Doppelverkauf physisch — kollidiert auch nur eine Zelle, schlägt das ganze
    // INSERT fehl (23505) und die Transaktion rollt komplett zurück (kein Teil-Besitz).
    const client = await pool.connect();
    let adId, conflict = false;
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO ads (x, y, w, h, pixel_count, link, title, email, image, image_mime,
                          amount_cents, status, reserved_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'reserved', now() + ($12::int * interval '1 minute'))
         RETURNING id`,
        [bx, by, bw, bh, pixelCount, link || null, title || null, email || null, imageBuf, imageMime, amount, String(CFG.reservationMin)]
      );
      adId = ins.rows[0].id;
      await client.query(
        `INSERT INTO pixels (x, y, ad_id, color)
         SELECT u.x, u.y, $4::bigint, u.color
           FROM unnest($1::int[], $2::int[], $3::text[]) AS u(x, y, color)`,
        [xs, ys, colors, adId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') conflict = true; else throw err;
    } finally {
      client.release();
    }
    if (conflict)
      return res.status(409).json({ error: 'Some of those pixels were just taken — adjust your selection and try again.' });

    // Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: amount,
          product_data: { name: `${pixelCount} pixels on ${CFG.siteName}`, description: `Freeform pixel art (${pixelCount} px)` },
        },
      }],
      customer_email: email || undefined,
      success_url: `${CFG.publicUrl}/?success=1&ad=${adId}`,
      cancel_url: `${CFG.publicUrl}/?canceled=1&ad=${adId}`,
      metadata: { adId: String(adId) },
    });
    await query(`UPDATE ads SET stripe_session_id = $1 WHERE id = $2`, [session.id, adId]);
    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ error: 'Internal error. Please try again later.' });
  }
});

// ---------- API: Reservierung sofort freigeben (Checkout abgebrochen) ----------
// Gibt NUR unbezahlte Reservierungen frei; bezahlte/aktive bleiben unberührt.
app.post('/api/orders/release', async (req, res) => {
  try {
    const adId = clampInt(req.body.adId, 1, Number.MAX_SAFE_INTEGER);
    if (!adId) return res.status(400).json({ error: 'Invalid id.' });
    const r = await query(`UPDATE ads SET status = 'expired' WHERE id = $1 AND status = 'reserved' RETURNING id`, [adId]);
    if (r.rowCount) await query(`DELETE FROM pixels WHERE ad_id = $1`, [adId]); // Zellen freigeben
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal error.' });
  }
});

// ============================================================
//  Admin / Moderation (geschützt durch ADMIN_TOKEN)
// ============================================================
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!CFG.adminToken || token !== CFG.adminToken)
    return res.status(401).json({ error: 'Not authorized.' });
  next();
}

// Bezahlte, noch nicht freigegebene Anzeigen
app.get('/api/admin/pending', requireAdmin, async (req, res) => {
  const { rows } = await query(
    `SELECT id, x, y, w, h, link, title, email, amount_cents, created_at
       FROM ads WHERE status = 'paid' AND approved = FALSE ORDER BY created_at`
  );
  res.json(rows);
});

// Vorschau-Bild für Moderation (auch wenn noch nicht aktiv)
app.get('/api/admin/img/:id', requireAdmin, async (req, res) => {
  const { rows } = await query(`SELECT image, image_mime FROM ads WHERE id = $1`, [req.params.id]);
  if (!rows.length || !rows[0].image) return res.status(404).end();
  res.set('Content-Type', rows[0].image_mime);
  res.send(rows[0].image);
});

app.post('/api/admin/ads/:id/approve', requireAdmin, async (req, res) => {
  await query(`UPDATE ads SET status = 'active', approved = TRUE WHERE id = $1 AND status = 'paid'`,
    [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/admin/ads/:id/reject', requireAdmin, async (req, res) => {
  // Inhalt löschen + Pixel freigeben. (Rückerstattung ggf. manuell in Stripe.)
  await query(`UPDATE ads SET status = 'rejected', image = NULL WHERE id = $1`, [req.params.id]);
  await query(`DELETE FROM pixels WHERE ad_id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// ---------- Start ----------
app.listen(CFG.port, () => {
  console.log(`\n🟦 ${CFG.siteName} running on ${CFG.publicUrl}`);
  console.log(`   Grid ${CFG.gridW}×${CFG.gridH} = ${CFG.gridW * CFG.gridH} pixels`);
  console.log(`   Payment: ${stripe ? 'active (Stripe)' : 'NOT configured'}`);
});
