# 🟦 PixelEuro – Die deutsche Pixel-Wand

> **1 Pixel = 1 Euro.** Käufer wählen eine Fläche auf einem 500×250-Raster (125.000 Pixel),
> laden ein Bild + Link hoch und bezahlen per Stripe. Nach Moderation erscheint ihr Pixel-Block.

Inspiriert von der „Million Dollar Homepage" (2005) – als deutsche Euro-Variante.

---

## 📦 Was ist drin?

| Teil | Technik |
|------|---------|
| Webserver / API | Node.js + Express |
| Datenbank | PostgreSQL (Bilder liegen in der DB, nicht im Dateisystem) |
| Zahlung | Stripe Checkout + Webhook |
| Frontend | HTML5 Canvas (kein Framework nötig) |
| Bildverarbeitung | sharp (skaliert Logos exakt auf die Fläche) |
| Moderation | `/admin` – geschützt per Token |
| Recht | Impressum / Datenschutz / AGB als Vorlagen |

---

## 🚀 Schnellstart (lokal testen)

```bash
# 1. Pakete installieren
npm install

# 2. Konfiguration anlegen
cp .env.example .env
#    -> DATABASE_URL, STRIPE_SECRET_KEY, ADMIN_TOKEN usw. eintragen

# 3. PostgreSQL-Datenbank anlegen (Beispiel)
createdb pixelwebsite
npm run initdb        # legt die Tabellen an

# 4. Server starten
npm start             # http://localhost:3000
```

> **Ohne Stripe-Keys** startet die Seite trotzdem – nur der Bezahl-Button ist dann inaktiv.
> So kannst du Design & Auswahl schon testen.

### Stripe lokal testen
```bash
# Stripe CLI installieren, dann Webhooks weiterleiten:
stripe listen --forward-to localhost:3000/api/webhook
# Das ausgegebene whsec_... als STRIPE_WEBHOOK_SECRET in die .env
```
Testkarte: `4242 4242 4242 4242`, beliebiges zukünftiges Datum, CVC `123`.

---

## 🏗️ Produktiv-Setup: Hetzner + Cloudflare (empfohlen & sicher)

**Architektur:** Cloudflare sitzt als Schutzschild **vor** deinem Hetzner-Server.
Personenbezogene Daten bleiben DSGVO-konform auf dem deutschen Server.

```
Besucher ──► Cloudflare (DDoS-Schutz, WAF, SSL, Cache) ──► Hetzner-Server (Node + PostgreSQL)
```

### 1. Hetzner-Server (z. B. CX22, Standort Nürnberg/Falkenstein)
```bash
# Ubuntu 24.04. Als root:
apt update && apt install -y nodejs npm postgresql nginx
# Node 20+ sicherstellen (sonst via nodesource installieren)

# PostgreSQL einrichten
sudo -u postgres psql -c "CREATE USER pixel WITH PASSWORD 'STARKES-PASSWORT';"
sudo -u postgres psql -c "CREATE DATABASE pixelwebsite OWNER pixel;"

# Projekt hochladen (git clone oder scp), dann:
cd /opt/pixelwebsite
npm install --omit=dev
cp .env.example .env && nano .env   # echte Werte eintragen
npm run initdb

# Als Dienst laufen lassen (systemd) – siehe unten
```

**systemd-Dienst** `/etc/systemd/system/pixelweb.service`:
```ini
[Unit]
Description=PixelEuro
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/pixelwebsite
ExecStart=/usr/bin/node src/server.js
Restart=always
EnvironmentFile=/opt/pixelwebsite/.env
User=www-data

[Install]
WantedBy=multi-user.target
```
```bash
systemctl enable --now pixelweb
```

**nginx als Reverse Proxy** (`/etc/nginx/sites-available/pixel`):
```nginx
server {
  listen 80;
  server_name deine-domain.de;
  client_max_body_size 5M;          # für Bild-Uploads
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
```bash
ln -s /etc/nginx/sites-available/pixel /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx
```

### 2. Cloudflare davorschalten
1. Domain bei Cloudflare hinzufügen → Nameserver beim Registrar auf Cloudflare umstellen.
2. DNS: `A`-Record `@` und `www` → Hetzner-Server-IP, **Proxy aktiviert (orange Wolke)**.
3. SSL/TLS-Modus auf **Full (strict)** → kostenloses Zertifikat von Cloudflare + Let's Encrypt auf dem Server (`certbot`).
4. **WAF-Regeln** + **Rate Limiting** aktivieren, „Under Attack Mode" bei Bedarf.
5. Caching: statische Dateien (`/style.css`, `/app.js`, `/img/*`) werden automatisch gecacht.

### 3. Stripe Webhook produktiv
- Im Stripe-Dashboard → Webhooks → Endpoint `https://deine-domain.de/api/webhook`
- Event: `checkout.session.completed`
- Das `whsec_...` als `STRIPE_WEBHOOK_SECRET` in die `.env`.
- **Für niedrige Gebühren:** im Stripe-Dashboard unter „Zahlungsmethoden" zusätzlich
  **SEPA-Lastschrift** und ggf. **Klarna/Sofort** aktivieren – diese sind bei größeren
  Beträgen günstiger als Kreditkarte.

---

## 🔐 Sicherheit & DSGVO (Kurz-Checkliste)
- [x] Bilder & Daten in der DB (kein lokales Dateisystem)
- [x] Zahlungsdaten nur bei Stripe (wir speichern keine Kartendaten)
- [x] Admin-Bereich per Token geschützt – **starkes `ADMIN_TOKEN` setzen!**
- [x] Rate Limiting auf Bestellungen
- [x] Datensparsam (nur E-Mail für Beleg)
- [ ] Impressum/Datenschutz/AGB final rechtlich prüfen lassen
- [ ] AV-Verträge (Auftragsverarbeitung) mit Hetzner, Cloudflare, Stripe abschließen
- [ ] Backups der PostgreSQL-Datenbank einrichten (`pg_dump` per Cron)

---

## ⚙️ Wichtige Einstellungen (`.env`)
| Variable | Bedeutung |
|----------|-----------|
| `GRID_W` / `GRID_H` | Rastergröße (Standard 500×250 = 125.000 Pixel) |
| `PIXEL_PRICE_CENTS` | Preis pro Pixel (100 = 1 €) |
| `MIN_ORDER_CENTS` | Mindestbestellwert (1000 = 10 €) – gegen hohe Gebührenanteile |
| `RESERVATION_MINUTES` | Reservierungsdauer vor Zahlung |
| `ADMIN_TOKEN` | Zugang zur Moderation `/admin` |

Siehe **CONCEPT.md** für Domains, Marketing- & Viral-Strategie und KI-Video-Ideen.
