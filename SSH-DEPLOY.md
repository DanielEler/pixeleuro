# 🔑 SSH-Zugang & Deploy — PixelEuro + Semesto (Hetzner)

> Stand: 2026-06-23. Wie du **jederzeit per SSH deployst**. Kurz & idiotensicher.

## Server-Fakten
- **IP:** `159.69.184.92`  · Hetzner-Server „Semesto", Ubuntu 24.04
- **Root-Konsolen-Passwort (Hetzner Cloud Console):** `sAgrtjPpuxXV`
  *(nur für die Web-Konsole nötig; per SSH läuft Key-Login)*
- **SSH-Key (neu, dediziert):** `~/.ssh/hetzner_pixelsemesto` (privat) / `.pub` (öffentlich)
  - Fingerprint: `SHA256:3arfXXJ7hyjl600tr0GL/gLTDybnsr4YnXBV2ap/zK8`
  - Kommentar: `hetzner-pixelsemesto-2026-06-23`

## ⚠️ Wichtig: Firmennetz blockt SSH
Das **PPE-Firmennetz blockt ausgehenden Port 22 komplett** (getestet: selbst GitHub/GitLab-SSH
läuft ins Timeout). **Deploy daher von zuhause / eigenem Netz** (privates Internet blockt 22 nicht).
Im Firmennetz geht nur der 443-Weg (Object-Storage/Konsole) — siehe `scripts/deploy-console.py`.

## Einmalig: Key auf den Server bringen
Der neue Key ist noch nicht auf dem Server (alter Key wurde gelöscht). **Einmal** über die
**Hetzner Web-Konsole** (console.hetzner.cloud → Server „Semesto" → `>_ Console`, Login `root` /
obiges Passwort) eintragen — Layout auf Deutsch stellen, dann zwei kurze Zeilen:
```
loadkeys de
curl -s https://fsn1.your-objectstorage.com/semesto-media/8gdsvnwekcmd -o k
bash k
```
*(Das Skript trägt `~/.ssh/hetzner_pixelsemesto.pub` in `/root/.ssh/authorized_keys` ein.
Die kurze URL ist nur ein temporärer Helfer im Object Storage — danach löschbar.)*

## Danach: deployen (von zuhause)
```bash
cd /Users/danieleler/GitHub/Pixelwebsite
bash scripts/deploy-both.sh
```
- Nutzt automatisch `~/.ssh/hetzner_pixelsemesto` (in `~/.ssh/config` als `Host 159.69.184.92` hinterlegt).
- Beim ersten Lauf härtet `server-setup.sh` den Server und legt User `semesto` an (kopiert den Key
  automatisch mit). Danach deployt es Semesto + PixelEuro.
- Test der Verbindung: `ssh hetzner-pixel` (= `ssh root@159.69.184.92` mit dem Key).

## DNS (nach erfolgreichem Deploy)
A-Records auf `159.69.184.92`:
- `semesto.de`, `www.semesto.de`, `api.semesto.de`
- `pixeleuro.de`, `www.pixeleuro.de`

## 💾 UNBEDINGT in 1Password speichern (Vault „Semesto")
1. **Privaten SSH-Key** `~/.ssh/hetzner_pixelsemesto` (kompletter Datei-Inhalt) — das ist der EINZIGE
   Zugang. Geht der verloren, kommt man nur per Konsolen-Passwort wieder rein.
   In den Mac-Terminal: `pbcopy < ~/.ssh/hetzner_pixelsemesto` → in 1Password als neues SSH-Key-Item einfügen.
2. **Root-Konsolen-Passwort:** `sAgrtjPpuxXV`
3. **Hetzner-API-Token** (liegt in `.hetzner-token`, gitignored) — bleibt in 1Password „Hetzner-Api-Token".
