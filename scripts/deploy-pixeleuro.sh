#!/usr/bin/env bash
# Nur PixelEuro neu ausrollen (Frontend-/Code- UND Config-Änderungen). Aus FREIEM Netz ausführen.
# Semesto bleibt unberührt.
set -uo pipefail
IP=159.69.184.92
KEY=~/.ssh/hetzner_pixelsemesto
PIX="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSHO="-o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -o IdentityAgent=none -i $KEY"
log(){ echo -e "\033[1;36m[pixeleuro]\033[0m $*"; }

nc -z -w5 $IP 22 2>/dev/null || { echo "Port 22 zu — du bist im Firmennetz. Ins Hotspot/Heim-WLAN wechseln und erneut starten."; exit 1; }

cd "$PIX"
log "Code synchronisieren …"
rsync -az -e "ssh $SSHO" \
  --exclude node_modules --exclude .git --exclude .env --exclude deploy.env --exclude .idea --exclude worker --exclude dist \
  Dockerfile .dockerignore docker-compose.yml package.json package-lock.json src public db \
  semesto@$IP:/home/semesto/PixelEuro/ && log "✓ Code gesynct"

log "Config (.env inkl. Stripe-Key, MIN_ORDER_CENTS …) hochladen"
EDGE=$(ssh $SSHO semesto@$IP "docker network ls --format '{{.Name}}' | grep -E '^semesto.*default$' | head -1")
TMP=$(mktemp); grep -v '^EDGE_NETWORK=' "$PIX/deploy.env" > "$TMP"; echo "EDGE_NETWORK=${EDGE:-semesto_default}" >> "$TMP"
scp $SSHO "$TMP" semesto@$IP:/home/semesto/PixelEuro/.env && rm -f "$TMP" && log "✓ .env aktualisiert"

log "Image neu bauen + starten …"
ssh $SSHO semesto@$IP 'cd /home/semesto/PixelEuro && docker compose up -d --build pixeleuro 2>&1 | tail -5'

log "Live-Check …"
for i in $(seq 1 10); do
  sleep 4
  C=$(curl -sS -m8 -o /tmp/pcfg -w "%{http_code}" https://pixeleuro.de/api/config 2>/dev/null)
  L=$(curl -sS -m8 -o /dev/null -w "%{http_code}" https://pixeleuro.de/logo.svg 2>/dev/null)
  echo "   pixeleuro.de/api/config=$C  logo.svg=$L"
  if [ "$C" = "200" ] && [ "$L" = "200" ]; then
    log "✓ live: https://pixeleuro.de"
    echo "   Config: $(cat /tmp/pcfg)"
    break
  fi
done
