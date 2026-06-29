// ============================================================
//  PixelEuro – Cloudflare Worker
//  API + Zahlung (Stripe) + Moderation. DB = D1 (SQLite), Bilder = R2.
//  Statische Dateien (public/) liefert der ASSETS-Binding aus.
// ============================================================
import Stripe from 'stripe';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

function cfg(env) {
  return {
    gridW: Number(env.GRID_W || 500),
    gridH: Number(env.GRID_H || 250),
    pricePerPixel: Number(env.PIXEL_PRICE_CENTS || 100),
    minOrderCents: Number(env.MIN_ORDER_CENTS || 1000),
    reservationMin: Number(env.RESERVATION_MINUTES || 15),
    publicUrl: env.PUBLIC_URL || '',
    siteName: env.SITE_NAME || 'PixelEuro',
    siteTagline: env.SITE_TAGLINE || '1 Pixel. 1 Euro.',
  };
}

const stripeClient = (env) =>
  env.STRIPE_SECRET_KEY
    ? new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() })
    : null;

const clampInt = (v, min, max) => {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, v));
};

// Abgelaufene Reservierungen freigeben (wird opportunistisch aufgerufen)
async function releaseExpired(env) {
  await env.DB.prepare(
    `UPDATE ads SET status='expired'
       WHERE status='reserved' AND reserved_until < datetime('now')`
  ).run();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const C = cfg(env);

    try {
      // ---- Stripe Webhook (roher Body!) ----
      if (path === '/api/webhook' && request.method === 'POST') {
        return handleWebhook(request, env);
      }

      // ---- Konfiguration fürs Frontend ----
      if (path === '/api/config') {
        return json({
          gridW: C.gridW, gridH: C.gridH, pricePerPixel: C.pricePerPixel,
          minOrderCents: C.minOrderCents, siteName: C.siteName,
          siteTagline: C.siteTagline, paymentEnabled: !!env.STRIPE_SECRET_KEY,
        });
      }

      // ---- Belegte Flächen + aktive Anzeigen ----
      if (path === '/api/ads') {
        await releaseExpired(env);
        const { results } = await env.DB.prepare(
          `SELECT id,x,y,w,h,link,title,status FROM ads
            WHERE status='active' OR status='paid'
               OR (status='reserved' AND reserved_until > datetime('now'))`
        ).all();
        const ads = results.map((r) => ({
          id: r.id, x: r.x, y: r.y, w: r.w, h: r.h,
          occupied: r.status !== 'active',
          title: r.status === 'active' ? r.title : null,
          link: r.status === 'active' ? r.link : null,
          image: r.status === 'active' ? `/img/${r.id}` : null,
        }));
        const soldPixels = ads.reduce((s, a) => s + a.w * a.h, 0);
        return json({ ads, soldPixels, totalPixels: C.gridW * C.gridH });
      }

      // ---- Bild einer aktiven Anzeige (aus R2) ----
      if (path.startsWith('/img/')) {
        const id = path.slice(5);
        const row = await env.DB.prepare(
          `SELECT image_key,image_mime FROM ads WHERE id=? AND status='active'`
        ).bind(id).first();
        if (!row || !row.image_key) return new Response('Not found', { status: 404 });
        const obj = await env.IMAGES.get(row.image_key);
        if (!obj) return new Response('Not found', { status: 404 });
        return new Response(obj.body, {
          headers: {
            'content-type': row.image_mime || 'image/png',
            'cache-control': 'public, max-age=86400',
          },
        });
      }

      // ---- Bestellung anlegen + Stripe-Checkout ----
      if (path === '/api/orders' && request.method === 'POST') {
        return handleOrder(request, env, C);
      }

      // ---- Admin / Moderation ----
      if (path.startsWith('/api/admin/')) {
        return handleAdmin(request, env, path);
      }

      // ---- Alles andere: statische Dateien ----
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('Worker-Fehler:', err.stack || err);
      return json({ error: 'Interner Fehler.' }, 500);
    }
  },

  // Cron-Trigger: regelmäßig abgelaufene Reservierungen freigeben
  async scheduled(event, env, ctx) {
    ctx.waitUntil(releaseExpired(env));
  },
};

// ------------------------------------------------------------
async function handleOrder(request, env, C) {
  const stripe = stripeClient(env);
  if (!stripe) return json({ error: 'Zahlung ist nicht konfiguriert.' }, 503);
  await releaseExpired(env);

  const form = await request.formData();
  const x = clampInt(form.get('x'), 0, C.gridW - 1);
  const y = clampInt(form.get('y'), 0, C.gridH - 1);
  const w = clampInt(form.get('w'), 1, C.gridW);
  const h = clampInt(form.get('h'), 1, C.gridH);
  const link = (form.get('link') || '').toString().trim();
  const title = (form.get('title') || '').toString().trim().slice(0, 120);
  const email = (form.get('email') || '').toString().trim().slice(0, 200);
  const file = form.get('image');

  if (x === null || y === null || w === null || h === null)
    return json({ error: 'Invalid selection.' }, 400);
  if (x + w > C.gridW || y + h > C.gridH)
    return json({ error: 'Selection is outside the grid.' }, 400);
  if (!file || typeof file.arrayBuffer !== 'function')
    return json({ error: 'Please upload an image.' }, 400);
  if (file.size > 3 * 1024 * 1024)
    return json({ error: 'Image too large (max. 3 MB).' }, 400);
  if (link && !/^https?:\/\/.+/i.test(link))
    return json({ error: 'Link must start with http:// or https://.' }, 400);

  const pixels = w * h;
  const amount = pixels * C.pricePerPixel;
  if (amount < C.minOrderCents)
    return json({ error: `Minimum order ${(C.minOrderCents / 100).toFixed(2)} € – please choose more pixels.` }, 400);

  // Überschneidung prüfen
  const overlap = await env.DB.prepare(
    `SELECT 1 FROM ads
      WHERE (status='active' OR status='paid'
             OR (status='reserved' AND reserved_until > datetime('now')))
        AND NOT (?1 + ?3 <= x OR x + w <= ?1 OR ?2 + ?4 <= y OR y + h <= ?2)
      LIMIT 1`
  ).bind(x, y, w, h).first();
  if (overlap) return json({ error: 'Sorry, this area is already taken.' }, 409);

  // Bild in R2 ablegen
  const imageKey = crypto.randomUUID();
  const mime = file.type || 'image/png';
  await env.IMAGES.put(imageKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: mime },
  });

  // Reservierung anlegen
  const ins = await env.DB.prepare(
    `INSERT INTO ads (x,y,w,h,link,title,email,image_key,image_mime,amount_cents,status,reserved_until)
     VALUES (?,?,?,?,?,?,?,?,?,?,'reserved', datetime('now', ?))
     RETURNING id`
  ).bind(x, y, w, h, link || null, title || null, email || null, imageKey, mime, amount,
    `+${C.reservationMin} minutes`).first();
  const adId = ins.id;

  // Stripe Checkout
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: amount,
        product_data: {
          name: `${pixels} Pixel auf ${C.siteName}`,
          description: `Position ${x},${y} · Größe ${w}×${h}`,
        },
      },
    }],
    customer_email: email || undefined,
    success_url: `${C.publicUrl || new URL(request.url).origin}/?success=1`,
    cancel_url: `${C.publicUrl || new URL(request.url).origin}/?canceled=1`,
    metadata: { adId: String(adId) },
  });

  await env.DB.prepare(`UPDATE ads SET stripe_session_id=? WHERE id=?`)
    .bind(session.id, adId).run();

  return json({ checkoutUrl: session.url });
}

// ------------------------------------------------------------
async function handleWebhook(request, env) {
  const stripe = stripeClient(env);
  if (!stripe) return new Response('', { status: 503 });
  const sig = request.headers.get('stripe-signature');
  const body = await request.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, sig, env.STRIPE_WEBHOOK_SECRET, undefined, Stripe.createSubtleCryptoProvider()
    );
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    await env.DB.prepare(
      `UPDATE ads SET status='paid', paid_at=datetime('now'), email=COALESCE(?,email)
         WHERE stripe_session_id=? AND status='reserved'`
    ).bind(s.customer_details?.email || null, s.id).run();
  }
  return json({ received: true });
}

// ------------------------------------------------------------
async function handleAdmin(request, env, path) {
  const token = request.headers.get('x-admin-token') || new URL(request.url).searchParams.get('token');
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN)
    return json({ error: 'Nicht autorisiert.' }, 401);

  if (path === '/api/admin/pending') {
    const { results } = await env.DB.prepare(
      `SELECT id,x,y,w,h,link,title,email,amount_cents,created_at
         FROM ads WHERE status='paid' AND approved=0 ORDER BY created_at`
    ).all();
    return json(results);
  }

  if (path.startsWith('/api/admin/img/')) {
    const id = path.split('/').pop();
    const row = await env.DB.prepare(`SELECT image_key,image_mime FROM ads WHERE id=?`).bind(id).first();
    if (!row || !row.image_key) return new Response('Not found', { status: 404 });
    const obj = await env.IMAGES.get(row.image_key);
    if (!obj) return new Response('Not found', { status: 404 });
    return new Response(obj.body, { headers: { 'content-type': row.image_mime || 'image/png' } });
  }

  const m = path.match(/^\/api\/admin\/ads\/(\d+)\/(approve|reject)$/);
  if (m && request.method === 'POST') {
    const [, id, action] = m;
    if (action === 'approve') {
      await env.DB.prepare(`UPDATE ads SET status='active', approved=1 WHERE id=? AND status='paid'`).bind(id).run();
    } else {
      await env.DB.prepare(`UPDATE ads SET status='rejected' WHERE id=?`).bind(id).run();
    }
    return json({ ok: true });
  }

  return json({ error: 'Unbekannte Admin-Route.' }, 404);
}
