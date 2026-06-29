#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Finale Live-Schritte — aus einem FREIEN Netz ausführen (Firmennetz blockt Port 22).
# Liest Secrets aus den gitignored deploy.env-Dateien (nichts Geheimes im Skript).
#
#   1. Semesto-Landingpage hochladen        → semesto.de zeigt die Seite statt 404
#   2. Semesto: Pflicht-E-Mail-Verifizierung (REQUIRE_EMAIL_VERIFICATION=true)
#   3. PixelEuro: Stripe-Key aktivieren      → Kauf-Button live (Testmodus)
#   4. Caddy neu starten                     → TLS-Zertifikat für pixeleuro.de
#   5. Health-/Live-Checks
#
#   bash scripts/finalize-live.sh
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
IP=159.69.184.92
KEY=~/.ssh/hetzner_pixelsemesto
PIX="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEM="$(cd "$PIX/.." && pwd)/Semesto"
SSHO="-o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -o IdentityAgent=none -o ConnectTimeout=10 -i $KEY"
log(){ echo -e "\033[1;36m[final]\033[0m $*"; }

nc -z -w5 $IP 22 2>/dev/null || { echo "Port 22 zu — du bist im Firmennetz. Ins Hotspot/Heim-WLAN wechseln und erneut starten."; exit 1; }

log "1) Semesto-Landingpage + Rechtsseiten hochladen"
scp $SSHO "$SEM/landing/"*.html semesto@$IP:/home/semesto/Semesto/landing/ && log "   ✓ hochgeladen (index/impressum/datenschutz/agb)"

log "2) Semesto: Pflicht-Verifizierung scharf + api neu"
ssh $SSHO semesto@$IP 'cd /home/semesto/Semesto && sed -i "s#^REQUIRE_EMAIL_VERIFICATION=.*#REQUIRE_EMAIL_VERIFICATION=true#" .env && docker compose up -d --force-recreate api >/dev/null 2>&1 && echo "   api REQUIRE_EMAIL_VERIFICATION=$(docker exec semesto-api-1 printenv REQUIRE_EMAIL_VERIFICATION)"'

log "3) PixelEuro: .env (inkl. Stripe-Key) neu hochladen + Container neu"
EDGE=$(ssh $SSHO semesto@$IP "docker network ls --format '{{.Name}}' | grep -E '^semesto.*default$' | head -1")
TMP=$(mktemp); grep -v '^EDGE_NETWORK=' "$PIX/deploy.env" > "$TMP"; echo "EDGE_NETWORK=${EDGE:-semesto_default}" >> "$TMP"
scp $SSHO "$TMP" semesto@$IP:/home/semesto/PixelEuro/.env && rm -f "$TMP"
ssh $SSHO semesto@$IP 'cd /home/semesto/PixelEuro && docker compose up -d --force-recreate pixeleuro >/dev/null 2>&1 && echo "   pixeleuro neu (paymentEnabled folgt aus STRIPE_SECRET_KEY)"'

log "4) Caddy neu starten (zieht pixeleuro.de-Zertifikat)"
ssh $SSHO semesto@$IP 'cd /home/semesto/Semesto && docker compose restart caddy >/dev/null 2>&1 && echo "   ✓ caddy neu gestartet"'

log "5) Warte auf Zertifikate + Health …"
for i in $(seq 1 24); do
  sleep 5
  PIXC=$(curl -sS -m8 -o /tmp/pcfg -w "%{http_code}" https://pixeleuro.de/api/config 2>/dev/null)
  SEMH=$(curl -sS -m8 -o /dev/null -w "%{http_code}" https://api.semesto.de/health 2>/dev/null)
  LAND=$(curl -sS -m8 -o /dev/null -w "%{http_code}" https://semesto.de/ 2>/dev/null)
  echo "   pixeleuro.de=$PIXC  api.semesto.de=$SEMH  semesto.de=$LAND"
  [ "$PIXC" = "200" ] && [ "$SEMH" = "200" ] && [ "$LAND" = "200" ] && { log "✓✓ Alles live."; echo "   PixelEuro-Config: $(cat /tmp/pcfg)"; break; }
done

echo
echo "Live:  https://pixeleuro.de   ·   https://semesto.de   ·   https://api.semesto.de/health"
echo "Stripe: Testmodus aktiv. Für Zahlungsbestätigung noch Webhook anlegen:"
echo "  Stripe → Webhooks → Endpoint https://pixeleuro.de/api/webhook → Event checkout.session.completed"
echo "  → Signing Secret (whsec_…) in deploy.env eintragen + Skript erneut laufen lassen."
