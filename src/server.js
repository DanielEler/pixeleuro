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
      await query(
        `UPDATE ads
           SET status = 'paid', paid_at = now(), email = COALESCE($2, email)
         WHERE stripe_session_id = $1 AND status = 'reserved'`,
        [session.id, session.customer_details?.email || null]
      );
      console.log('✅ Payment confirmed for session', session.id);
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

// Gibt abgelaufene Reservierungen wieder frei.
async function releaseExpired() {
  try {
    await query(
      `UPDATE ads SET status = 'expired'
       WHERE status = 'reserved' AND reserved_until < now()`
    );
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
  const { rows } = await query(
    `SELECT id, x, y, w, h, link, title, status
       FROM ads
      WHERE status = 'active'
         OR status = 'paid'
         OR (status = 'reserved' AND reserved_until > now())`
  );
  // Sensible Daten (E-Mail) niemals ausliefern. Bild/Link nur bei aktiven Anzeigen.
  const ads = rows.map((r) => ({
    id: r.id,
    x: r.x, y: r.y, w: r.w, h: r.h,
    occupied: r.status !== 'active',           // belegt, aber noch nicht freigeschaltet
    title: r.status === 'active' ? r.title : null,
    link: r.status === 'active' ? r.link : null,
    image: r.status === 'active' ? `/img/${r.id}` : null,
  }));
  // Nur TATSÄCHLICH verkaufte Pixel zählen (bezahlt/aktiv). Reservierte
  // (im Checkout, noch nicht bezahlt) blockieren die Fläche, gelten aber
  // NICHT als "verkauft" — sonst zeigt ein Zahlungsabbruch fälschlich
  // verkaufte Pixel an.
  const soldPixels = rows.reduce(
    (s, r) => s + ((r.status === 'active' || r.status === 'paid') ? r.w * r.h : 0),
    0
  );
  res.json({ ads, soldPixels, totalPixels: CFG.gridW * CFG.gridH });
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
    // Jeder Bestellversuch wird geloggt -> "wie oft wurde der Button gedrückt?"
    // zählbar via: docker logs pixeleuro | grep ORDER_ATTEMPT | wc -l
    console.log('ORDER_ATTEMPT', new Date().toISOString(), `${req.body.w}x${req.body.h}`, 'img:', !!req.file);
    if (!stripe) return res.status(503).json({ error: 'Payment is not configured.' });

    const x = clampInt(req.body.x, 0, CFG.gridW - 1);
    const y = clampInt(req.body.y, 0, CFG.gridH - 1);
    const w = clampInt(req.body.w, 1, CFG.gridW);
    const h = clampInt(req.body.h, 1, CFG.gridH);
    const link = (req.body.link || '').trim();
    const title = (req.body.title || '').trim().slice(0, 120);
    const email = (req.body.email || '').trim().slice(0, 200);

    if (x === null || y === null || w === null || h === null)
      return res.status(400).json({ error: 'Invalid selection.' });
    if (x + w > CFG.gridW || y + h > CFG.gridH)
      return res.status(400).json({ error: 'Selection is outside the grid.' });
    if (link && !/^https?:\/\/.+/i.test(link))
      return res.status(400).json({ error: 'Link must start with http:// or https://.' });
    // Bild ist OPTIONAL: wer im In-App-Browser keins hochladen kann, bekommt
    // einen einfarbigen Marken-Block (kann später ersetzt werden).

    const pixels = w * h;
    const amount = pixels * CFG.pricePerPixel;
    if (amount < CFG.minOrderCents)
      return res.status(400).json({
        error: `Minimum order ${(CFG.minOrderCents / 100).toFixed(2)} € – please choose more pixels.`,
      });

    // Bild bestimmen. Drei Fälle, alle ohne harten Abbruch:
    //  (a) Bild hochgeladen + sharp -> exakt auf w×h skalieren (PNG).
    //  (b) Bild hochgeladen, sharp fehlt/scheitert -> Original speichern.
    //  (c) KEIN Bild -> einfarbiger Marken-Block (In-App-Browser-Fallback).
    let imageBuf, imageMime = 'image/png';
    // 1x1 PNG (Marken-Blau) als letzte Rückfallebene ohne sharp:
    const FALLBACK_PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgLy39DwAEYAH3y4lJBwAAAABJRU5ErkJggg==',
      'base64');
    if (req.file) {
      imageBuf = req.file.buffer;
      imageMime = req.file.mimetype || 'image/png';
      if (sharp) {
        try {
          imageBuf = await sharp(req.file.buffer, { failOn: 'none' }).rotate().resize(w, h, { fit: 'fill' }).png().toBuffer();
          imageMime = 'image/png';
        } catch (err) {
          console.error('sharp processing failed, storing original image:', err);
          imageBuf = req.file.buffer; imageMime = req.file.mimetype || 'image/png';
        }
      }
    } else if (sharp) {
      // Einfarbiger Block in Marken-Blau, exakt w×h
      imageBuf = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 47, g: 107, b: 255 } } }).png().toBuffer();
    } else {
      imageBuf = FALLBACK_PNG; // Browser skaliert das 1x1 auf die Fläche
    }

    // Transaktion: Überschneidung prüfen + reservieren (verhindert Doppelverkauf)
    const client = await pool.connect();
    let adId;
    try {
      await client.query('BEGIN');
      const overlap = await client.query(
        `SELECT 1 FROM ads
          WHERE (status = 'active' OR status = 'paid'
                 OR (status = 'reserved' AND reserved_until > now()))
            AND NOT ($1::int + $3::int <= x OR x + w <= $1::int
                  OR $2::int + $4::int <= y OR y + h <= $2::int)
          FOR UPDATE`,
        [x, y, w, h]
      );
      if (overlap.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Sorry, this area is already taken.' });
      }
      const ins = await client.query(
        `INSERT INTO ads (x, y, w, h, link, title, email, image, image_mime, amount_cents,
                          status, reserved_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'reserved', now() + ($11::int * interval '1 minute'))
         RETURNING id`,
        [x, y, w, h, link || null, title || null, email || null, imageBuf, imageMime, amount,
          String(CFG.reservationMin)]
      );
      adId = ins.rows[0].id;
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Stripe Checkout-Session erstellen
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: amount,
          product_data: {
            name: `${pixels} pixels on ${CFG.siteName}`,
            description: `Position ${x},${y} · Size ${w}×${h}`,
          },
        },
      }],
      customer_email: email || undefined,
      success_url: `${CFG.publicUrl}/?success=1`,
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
    await query(`UPDATE ads SET status = 'expired' WHERE id = $1 AND status = 'reserved'`, [adId]);
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
  // Inhalt löschen, Fläche freigeben. (Rückerstattung ggf. manuell in Stripe.)
  await query(`UPDATE ads SET status = 'rejected', image = NULL WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// ---------- Start ----------
app.listen(CFG.port, () => {
  console.log(`\n🟦 ${CFG.siteName} running on ${CFG.publicUrl}`);
  console.log(`   Grid ${CFG.gridW}×${CFG.gridH} = ${CFG.gridW * CFG.gridH} pixels`);
  console.log(`   Payment: ${stripe ? 'active (Stripe)' : 'NOT configured'}`);
});
