# 🧭 PixelEuro – Komplette Anleitung von A bis Z

Schritt-für-Schritt vom leeren Account bis zur live gehenden, beworbenen Seite.
Hak einfach von oben nach unten ab. ✅

---

## TEIL 1 – Domain sichern

1. Registrar wählen (Empfehlung **Cloudflare Registrar** – ohne Aufschlag, da du schon einen Account hast; alternativ **INWX**).
2. Wunsch-Domain prüfen & kaufen: **`pixeleuro.de`** (zusätzlich `pixeleuro.com` zum Marken­schutz).
3. **WHOIS-/Domain-Privacy:** brauchst du i. d. R. nicht extra zu kaufen.
   - Bei `.de` veröffentlicht die DENIC ohnehin **keine** privaten Halterdaten öffentlich.
   - Cloudflare Registrar aktiviert WHOIS-Privacy automatisch & kostenlos.
   - **Zahle nichts extra** für „Domain Protection / Privacy"-Upsells.

---

## TEIL 2 – Cloudflare einrichten (gratis, nur DNS)

> Cloudflare kostet dich nichts und sitzt als Schutzschild + SSL vor deinem Hetzner-Server.

1. Im Cloudflare-Dashboard **Add a Site** → `pixeleuro.de` → **Free-Plan**.
2. Falls die Domain NICHT bei Cloudflare gekauft wurde: beim Registrar die **Nameserver** auf die zwei von Cloudflare angezeigten umstellen.
3. **DNS-Records** anlegen:
   - Typ `A`, Name `@`, Inhalt = **deine Hetzner-Server-IP**, Proxy **AN** (orange Wolke).
   - Typ `A` (oder `CNAME`), Name `www`, gleiches Ziel, Proxy AN.
4. **SSL/TLS** → Modus **Full (strict)**.
5. **Security**: „Bot Fight Mode" an, optional Rate-Limiting-Regel für `/api/orders`.
6. Fertig – du bekommst gratis SSL, DDoS-Schutz und Caching.

---

## TEIL 3 – Hetzner-Server (App + Datenbank)

Siehe **README.md** → Abschnitt „Produktiv-Setup". Kurzfassung:
1. Cloud-Server **CX22** (Ubuntu 24.04, Standort Nürnberg/Falkenstein) bestellen.
2. `nodejs`, `npm`, `postgresql`, `nginx`, `certbot` installieren.
3. PostgreSQL-User + DB anlegen.
4. Repo klonen: `git clone https://github.com/DanielEler/pixeleuro.git`
5. `npm install --omit=dev`, `.env` ausfüllen, `npm run initdb`.
6. systemd-Dienst + nginx-Reverse-Proxy einrichten (Configs stehen im README).
7. `certbot` für Let's Encrypt-Zertifikat (passt zu Cloudflare „Full strict").

---

## TEIL 4 – Stripe-Account & Zahlung (Schritt für Schritt)

1. Konto auf **stripe.com** erstellen → **Aktivieren** (Firmen-/Personendaten, IBAN für Auszahlungen).
2. Im Dashboard: **Entwickler → API-Keys**:
   - `Secret key` (`sk_live_…` bzw. `sk_test_…`) → in die `.env` als `STRIPE_SECRET_KEY`.
3. **Webhook** anlegen: Entwickler → Webhooks → Endpoint
   `https://pixeleuro.de/api/webhook`, Event **`checkout.session.completed`**.
   → das `whsec_…` als `STRIPE_WEBHOOK_SECRET` in die `.env`.
4. **Zahlungsmethoden für niedrige Gebühren** (Einstellungen → Zahlungsmethoden):
   - ✅ **Karte** (Visa/Mastercard) – beste UX
   - ✅ **SEPA-Lastschrift** – günstigste Gebühr (flat)
   - ✅ **Apple Pay / Google Pay** – kostet wie Karte, höhere Conversion
   - ⛔ PayPal nur, wenn Kunden es ausdrücklich wünschen (teuer bei Kleinbeträgen)
5. **Testen:** mit `sk_test_…` + Testkarte `4242 4242 4242 4242` einen Kauf durchspielen.
6. Erst dann auf **Live-Keys** umstellen.

### Gebühren-Vergleich (Richtwerte 2026 – auf den Preisseiten verifizieren!)

| Methode | typische Gebühr | bei 10 € Kauf | bei 50 € Kauf |
|---|---|---|---|
| SEPA-Lastschrift (Stripe/Mollie) | ~0,25–0,35 € flat | ~3,0 % | ~0,6 % |
| Stripe Karte (EU) | 1,5 % + 0,25 € | ~0,40 € (4,0 %) | ~1,00 € (2,0 %) |
| Mollie Karte | ~1,8 % + 0,25 € | ~0,43 € | ~1,15 € |
| PayPal | ~2,99 % + 0,39 € | ~0,69 € (6,9 %) | ~1,89 € |
| Lemon Squeezy / Paddle (MoR) | ~5 % + 0,50 € | ~1,00 € | ~3,00 € |

**Erkenntnis:** Je größer der Einzelkauf, desto kleiner der Gebührenanteil.

### 💡 Gebühren-Spar-Strategie
1. **Mindestbestellwert 10 €** (steht schon im Code via `MIN_ORDER_CENTS`).
2. **Pixel-Pakete** bewerben statt Einzelpixel:
   - Starter: 10 € = 100 Px (10×10)
   - Logo: 25 € = 400 Px (20×20)
   - Premium: 50 € = 900 Px (30×30)
3. **SEPA-Lastschrift** aktivieren (flache Gebühr schlägt % bei größeren Käufen).
4. **Apple/Google Pay** an (mehr Abschlüsse, gleiche Gebühr wie Karte).

### Steuer-Hinweis (wichtig)
Wenn dir die **Umsatzsteuer/MwSt-Bürokratie** zu viel ist, sind **Lemon Squeezy** oder **Paddle**
(„Merchant of Record") eine Überlegung wert: höhere Gebühr (~5 %), dafür kümmern sie sich um
EU-Mehrwertsteuer & Rechnungen. Achtung: Das würde **eine Anpassung des Codes** erfordern
(aktuell ist Stripe integriert). Steuerfragen bitte mit Steuerberater klären – keine Steuerberatung.

---

## TEIL 5 – Social-Media-Accounts (überall gleicher Name)

Sichere den Namen **@pixeleuro** auf: **TikTok, Instagram, YouTube, X, optional Threads**.

### Fertige Bios zum Kopieren

**TikTok / Instagram (kurz):**
```
🟦 1 Pixel = 1 €. Für immer im Netz.
🇩🇪 Die deutsche Pixel-Wand. Bau mit!
👇 Sichere dir dein Pixel
pixeleuro.de
```

**YouTube (Kanalbeschreibung):**
```
PixelEuro – die deutsche Pixel-Wand. Inspiriert von der legendären Million Dollar
Homepage (2005): 125.000 Pixel, jeder kostet 1 €, jeder bleibt für immer sichtbar.
Hier zeige ich, wie die Wand Tag für Tag wächst. Mach mit: pixeleuro.de
```

**X (Twitter):**
```
1 Pixel. 1 €. Für die Ewigkeit im Netz. 🟦 Die deutsche Pixel-Wand → pixeleuro.de
```

### Profilbild
Dein Logo (siehe **LOGO-PROMPTS.md**) als quadratisches Bild, gut auch als winziges Icon lesbar.

---

## TEIL 6 – Launch-Checkliste (Reihenfolge)

- [ ] Domain gekauft (`pixeleuro.de` + `.com`)
- [ ] Cloudflare DNS + SSL eingerichtet
- [ ] Hetzner-Server live, Seite erreichbar unter HTTPS
- [ ] PostgreSQL-Backups per Cron (`pg_dump`) eingerichtet
- [ ] Stripe live, Testkauf erfolgreich, Webhook grün
- [ ] `ADMIN_TOKEN` stark gesetzt, `/admin` getestet
- [ ] Impressum / Datenschutz / AGB ausgefüllt & geprüft
- [ ] Gewerbe angemeldet, Steuer/Kleinunternehmer geklärt
- [ ] Social-Accounts @pixeleuro angelegt + Bios + Logo
- [ ] Erste eigene Pixel gekauft (Seite nicht leer wirken lassen)
- [ ] 5 Videos vorproduziert (Skripte in CONCEPT.md)
- [ ] Launch-Post auf allen Kanälen + Reddit

> Marketing-/Viral-Plan & Video-Skripte: **CONCEPT.md** · Logo: **LOGO-PROMPTS.md**
