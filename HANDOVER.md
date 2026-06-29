# 🤝 Übergabe / Projektstand – PixelEuro

> Stand: 2026-06-23. Dieses Dokument fasst zusammen, wo wir stehen, damit in einem neuen
> Chat sofort weitergearbeitet werden kann. **Keine Geheimnisse hier** – Token/Passwörter
> liegen in 1Password (siehe unten).

---

## 🎯 Worum geht's
**PixelEuro** = deutsche „Million Dollar Homepage". Raster **500×250 = 125.000 Pixel**,
**1 €/Pixel**, Käufer wählen freie Pixelanzahl per Rechteck-Auswahl, **Mindestbestellwert 10 €**
(gegen hohe Zahlungsgebühren). Maskottchen heißt **Pixi** (blauer Münz-Charakter).
Zahlung über Stripe, Moderation der Anzeigen vor Veröffentlichung. Ziel: viral über TikTok/Instagram.

---

## ✅ Was fertig ist
- **Kompletter Code im privaten Repo:** https://github.com/DanielEler/pixeleuro (Owner: DanielEler)
- **Zwei lauffähige Varianten:**
  1. **Klassisch** (für eigenen Server): Node/Express + PostgreSQL + Stripe + Canvas-Frontend
     → `src/server.js`, `db/schema.sql`, `public/*`
  2. **Serverlos** (Cloudflare): Worker + D1 + R2
     → `worker/index.js`, `db/schema_d1.sql`, `wrangler.jsonc`
- **Frontend** (`public/`): Pixel-Wand mit Canvas, Auswahl per Rechteck, Kauf-Modal,
  Admin-/Moderationsseite (`admin.html`), Rechtsseiten-Vorlagen (`public/legal/`).
- **Doku im Repo:**
  - `README.md` – Setup klassisch (Hetzner + nginx + Postgres + Stripe)
  - `CLOUDFLARE-DEPLOY.md` – Setup serverlos (wrangler, D1, R2)
  - `SETUP-ANLEITUNG.md` – A–Z: Domain, Cloudflare, Stripe, Gebühren, Social-Bios, Launch-Checkliste
  - `CONCEPT.md` – Domains, Marketing-/Viral-Strategie, KI-Video-Skripte, 30-Tage-Roadmap
  - `LOGO-PROMPTS.md` – virale Logo-Prompts
- **Logo/Pixi:** Zwei SVGs lagen in `~/Downloads/` (Maskottchen). **Gewählt: Variante B**
  (Münz-Charakter mit Armen/Beinen). Auf Marken-Blau umgefärbt getestet (`#2f6bff`/`#00d4ff`).
  → Noch offen: Pixi final ins Repo legen (`public/`) + Favicon (nur Kopf) + in `index.html` einbinden.

---

## 🚧 Wo wir hängen geblieben sind (Deployment)
**Entscheidung des Users:** PixelEuro soll **mit der Dating-App „Semesto" auf EINEM Hetzner-Server**
laufen (PixelEuro auf eigenem Port + eigener DB + eigenem nginx-Eintrag, Semesto unangetastet).
Cloudflare-Variante ist nur Backup.

**Das Problem:** Der SSH-Zugang zum Server scheiterte über Stunden:
1. Der richtige SSH-Key liegt in **1Password** (Eintrag „Hetzner-Semesto", Vault **„Semesto"**,
   Konto **„Unsere Familie"**). Musste erst in `~/.config/1Password/ssh/agent.toml` freigegeben
   werden (Zeile `[[ssh-keys]] vault = "Semesto"` ist bereits eingetragen ✅).
2. Danach: Der 1Password-Agent **signiert nicht** aus der automatisierten Claude-Umgebung
   („communication with agent failed"). Aus dem **eigenen Terminal des Users** würde 1Password
   signieren – aber root-Login per Passwort ist gesperrt (`PermitRootLogin prohibit-password`).
3. Durch viele Fehlversuche hat **Hetzners Netzwerk-Schutz die Claude-IP gezielt für Port 22
   zu diesem Server gesperrt** (Port 80/443 erreichbar, Port 22 Timeout – auch nach Rebuild).
   → Das ist **netzseitig bei Hetzner**, nicht im Server (kein fail2ban-Fix möglich), löst sich
   selbst nach ~1–2 Std.
4. Der User hat den Server zwischenzeitlich **neu aufgesetzt (Rebuild → Ubuntu 24.04)** –
   Server ist jetzt **leer** (Semesto ggf. neu zu deployen).

**Aktueller Zustand (Update 2026-06-23):** Turnkey gebaut. PixelEuro läuft jetzt
containerisiert **neben** Semesto auf demselben Server, hinter **derselben Caddy**.

### ✅ Ein-Kommando-Deploy (vom EIGENEN Terminal, NICHT in Claude Code)
```bash
cd /Users/danieleler/GitHub/Pixelwebsite
bash scripts/deploy-both.sh
```
Das Skript: (1) deployt Semesto via dessen `scripts/remote-deploy.sh` (unverändert) und
lädt dabei die erweiterte `Caddyfile` hoch, (2) lädt PixelEuro per rsync hoch + erzeugt
die `.env` aus `deploy.env`, (3) baut/startet den PixelEuro-Stack (eigener Container +
eigene Postgres-DB `pixelwebsite`, im Caddy-Netz von Semesto), (4) lädt Caddy neu.

**Warum nicht aus Claude heraus:** Diese Umgebung geht über IP `185.74.219.153` raus —
genau die von Hetzner für Port 22 gesperrte IP — und kann den 1Password-SSH-Agent nicht
zum Signieren bewegen. Vom Terminal des Users klappt beides.

**Neue Dateien (PixelEuro-Repo):** `Dockerfile`, `.dockerignore`, `docker-compose.yml`,
`deploy.env` (prefilled, gitignored), `deploy.env.example`, `scripts/deploy-both.sh`.
**Semesto-Repo:** nur `Caddyfile` erweitert (vhost `pixeleuro.de`, additiv — Semesto-Dienste unangetastet).

**Noch offen vor „echt live":**
- **DNS:** `pixeleuro.de` + `www.pixeleuro.de` A-Record → `159.69.184.92` (sonst kein TLS/keine Erreichbarkeit).
- **Stripe:** Keys in `deploy.env` eintragen (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) + Webhook auf `https://pixeleuro.de/api/webhook`. Ohne Keys läuft die Seite, Zahlung ist nur deaktiviert.
- **Semesto:** `RESEND_API_KEY` in `secrets/deploy.env` (sonst keine Verify-/Reset-Mails).

---

## ➡️ Nächste Schritte (Optionen, die offen liegen)
1. **Neuer Mini-Server (empfohlen, sofort machbar):** per Hetzner-API einen neuen kleinen Server
   (~4 €/Mon) mit FRISCHER IP erstellen, Deploy-Key beim Erstellen injizieren (`ssh_keys: [114159157]`),
   dann PixelEuro autonom deployen. Umgeht die IP-Sperre komplett.
2. **Warten (~1–2 Std.),** bis Hetzner die IP-Sperre aufhebt, dann auf diesem Server weiter.
   Davor muss der Deploy-Key noch auf den (rebuildeten) Server – z. B. via Hetzner-Web-Konsole
   oder vom Terminal des Users.
3. **Cloudflare** statt Server (serverlos, kein SSH nötig) – Code liegt bereit, siehe `CLOUDFLARE-DEPLOY.md`.

### Deploy-Plan (klassisch, sobald SSH klappt)
- Read-only prüfen, welche Ports/DB/nginx-Vhosts Semesto belegt (Kollisionen vermeiden!).
- PixelEuro: eigener Port (z. B. 3000), eigene Postgres-DB `pixelwebsite`, eigener systemd-Dienst,
  eigener nginx-Server-Block für `pixeleuro.de`. Semesto NICHT anfassen.
- `.env` aus `.env.example`, `npm run initdb`, Stripe-Keys, Domain via Cloudflare DNS.

---

## 🔑 Fakten & IDs (KEINE Geheimnisse – die sind in 1Password)
- **Hetzner-Projekt-ID:** 15076320
- **Server:** Name `Semesto`, **ID 144044186**, IP **159.69.184.92**, Typ cpx22,
  aktuell Ubuntu 24.04 (nach Rebuild, leer)
- **Hetzner SSH-Keys (Projekt):**
  - `pixeleuro-deploy` → ID **114159157** (Claudes Deploy-Key; privat auf dem Mac unter
    `~/.ssh/pixeleuro_deploy`, public: `~/.ssh/pixeleuro_deploy.pub`)
  - `Hetzner-Semesto` → ID 114124097 (Users Key, Fingerprint `SHA256:3lepQ1mDir6...`)
- **Claude-Egress-IP** (war gesperrt): 185.74.219.153 (kann sich ändern)

### 🔐 Geheimnisse liegen in 1Password (Konto „Unsere Familie", Vault „Semesto")
- `Hetzner-Api-Token` – Hetzner Cloud API-Token (Read & Write)
- `Hetzner-Semesto` – SSH-Key (privat + öffentlich)
- `Login-Root-Konsole-Hetzner` – Root-Konsolen-Login
- Stripe-Keys: noch **nicht** angelegt (Zahlung optional zum Start; Seite läuft auch ohne)

---

## ⚠️ Wichtige Hinweise
- **Semesto niemals zerschießen** – läuft (bzw. soll) auf demselben Server. Vor jedem Eingriff
  read-only prüfen, was belegt ist.
- **DSGVO:** personenbezogene Daten (E-Mail, Upload-Bilder) datensparsam halten; Bilder in DB/R2,
  nicht lokal; Impressum/Datenschutz/AGB (Vorlagen in `public/legal/`) rechtlich prüfen lassen.
- **Gebühren:** Mindestbestellwert 10 € + „Pixel-Pakete" bewerben; SEPA/Karte via Stripe.
- **Kein SSH-Gefummel mehr:** Wenn SSH zickt, früh auf API-Token/neuen Server/Cloudflare wechseln
  (hat diesmal viel Zeit gekostet).
