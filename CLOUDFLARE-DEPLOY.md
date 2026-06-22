# ☁️ PixelEuro auf Cloudflare deployen (ohne SSH)

Komplett serverlos: **Workers** (App) + **D1** (Datenbank) + **R2** (Bilder). Deploy nur per
Token/CLI – kein Server, kein SSH. Semesto auf Hetzner bleibt unberührt.

## Voraussetzungen
- Cloudflare-Account (hast du)
- `npm install` ausgeführt (installiert `wrangler` lokal)

## 1. Bei Cloudflare anmelden
```bash
npx wrangler login          # öffnet den Browser -> "Allow" klicken
# ODER nicht-interaktiv mit API-Token:
export CLOUDFLARE_API_TOKEN="dein-cloudflare-token"
npx wrangler whoami         # zeigt den eingeloggten Account
```
> Cloudflare-API-Token (falls Token-Weg): Dashboard → My Profile → API Tokens →
> „Create Token" → Template **„Edit Cloudflare Workers"** + zusätzlich **D1** und **R2** erlauben.

## 2. D1-Datenbank anlegen
```bash
npx wrangler d1 create pixeleuro
```
→ Gibt eine `database_id` aus. Diese in **wrangler.jsonc** bei `"database_id"` eintragen
(ersetzt `PLACEHOLDER_D1_ID`).

Tabellen anlegen:
```bash
npm run cf:initdb           # = wrangler d1 execute pixeleuro --remote --file=db/schema_d1.sql
```

## 3. R2-Bucket für Bilder anlegen
```bash
npx wrangler r2 bucket create pixeleuro-images
```
(Heißt dein Bucket anders, den Namen in **wrangler.jsonc** bei `"bucket_name"` anpassen.)

## 4. Geheimnisse setzen
```bash
npx wrangler secret put ADMIN_TOKEN            # langes Zufallstoken für /admin.html
# Sobald Stripe eingerichtet ist:
npx wrangler secret put STRIPE_SECRET_KEY      # sk_live_... / sk_test_...
npx wrangler secret put STRIPE_WEBHOOK_SECRET  # whsec_...
```
> Ohne Stripe-Keys geht die Seite trotzdem live – nur der Kauf ist deaktiviert.
> So kannst du Design & Wand sofort zeigen und Stripe später nachrüsten.

## 5. Deployen
```bash
npm run cf:deploy           # = wrangler deploy
```
→ Seite läuft sofort unter `https://pixeleuro.<dein-account>.workers.dev`.

## 6. Eigene Domain (pixeleuro.de)
Im Cloudflare-Dashboard → Workers & Pages → `pixeleuro` → **Custom Domains** →
`pixeleuro.de` (und `www`) hinzufügen. SSL kommt automatisch.
Danach in **wrangler.jsonc** `PUBLIC_URL` auf `https://pixeleuro.de` setzen und neu deployen.

## 7. Stripe-Webhook
Stripe-Dashboard → Webhooks → Endpoint `https://pixeleuro.de/api/webhook`,
Event `checkout.session.completed` → `whsec_...` als Secret setzen (Schritt 4).

---

### DSGVO / Datenstandort
D1 & R2 lassen sich mit EU-Region (Data Localization / Jurisdiction `eu`) betreiben.
Beim Bucket-Anlegen ggf. `--jurisdiction eu` nutzen; für D1 die EU-Location wählen.
Personenbezogene Daten (E-Mail) werden datensparsam in D1 gehalten, Zahlungsdaten nur bei Stripe.
