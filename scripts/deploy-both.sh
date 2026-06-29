#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# PixelEuro + Semesto — beide live auf EINEM Hetzner-Server (ein Kommando).
#
#   1. Semesto deployen (ruft dessen scripts/remote-deploy.sh – unverändert).
#      Dabei wird auch die erweiterte Caddyfile (inkl. pixeleuro.de-vhost) hochgeladen.
#   2. PixelEuro-Code hochladen (rsync) + Produktions-.env (aus deploy.env).
#   3. PixelEuro-Stack bauen + starten (eigene DB, eigener Container, im Caddy-Netz).
#   4. Caddy neu laden, damit pixeleuro.de greift. Health-Checks.
#
# WICHTIG: In DEINEM NORMALEN Terminal ausführen (NICHT in Claude Code) —
# nur dort signiert der 1Password-SSH-Agent / ist die IP nicht gesperrt.
#
#   cd /Users/danieleler/GitHub/Pixelwebsite
#   bash scripts/deploy-both.sh
#
# Voraussetzungen:
#   • 1Password entsperrt, SSH-Key "Hetzner-Semesto" im Agent (für Semesto-Setup).
#   • secrets/deploy.env in Semesto + deploy.env in PixelEuro vorbefüllt (sind sie).
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

SERVER_IP="${SERVER_IP:-159.69.184.92}"
PIXEL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEMESTO_DIR="${SEMESTO_DIR:-$(cd "$PIXEL_ROOT/.." && pwd)/Semesto}"
PIXEL_REMOTE="/home/semesto/PixelEuro"
SSH_USER="semesto@${SERVER_IP}"
SSHO="-o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"

log()  { echo -e "\033[1;36m[both]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m $*" >&2; }
die()  { echo -e "\033[1;31m[fail]\033[0m $*" >&2; exit 1; }

cd "$PIXEL_ROOT"

# ─── 0. Vorbedingungen ───
[ -d "$SEMESTO_DIR" ]        || die "Semesto-Repo nicht gefunden: $SEMESTO_DIR (per SEMESTO_DIR=... setzen)."
[ -f "$SEMESTO_DIR/scripts/remote-deploy.sh" ] || die "Semesto remote-deploy.sh fehlt in $SEMESTO_DIR/scripts/."
[ -f deploy.env ]           || die "PixelEuro deploy.env fehlt (aus deploy.env.example erzeugen)."

# ─── 1. Semesto deployen (unverändert; lädt auch die neue Caddyfile hoch) ───
log "Schritt 1/4 — Semesto deployen (server-setup + Stack) …"
( cd "$SEMESTO_DIR" && SERVER_IP="$SERVER_IP" bash scripts/remote-deploy.sh )
log "Semesto fertig."

# ─── 2. Caddy-Netz ermitteln (für PixelEuros externe Netz-Anbindung) ───
log "Schritt 2/4 — PixelEuro hochladen …"
EDGE_NETWORK="$(ssh $SSHO "$SSH_USER" "docker network ls --format '{{.Name}}' | grep -E '^semesto.*default$' | head -1" || true)"
[ -n "$EDGE_NETWORK" ] || die "Semesto-Caddy-Netz nicht gefunden — läuft Semesto wirklich? (docker network ls)"
log "Caddy-Netz erkannt: $EDGE_NETWORK"

# Code hochladen (Working-Tree, ohne lokal-only / Cloudflare-Artefakte)
ssh $SSHO "$SSH_USER" "mkdir -p ${PIXEL_REMOTE}"
rsync -az \
  --exclude node_modules --exclude .git --exclude dist \
  --exclude '.env' --exclude 'deploy.env' --exclude '.DS_Store' \
  --exclude worker --exclude '.dev.vars' \
  Dockerfile .dockerignore docker-compose.yml package.json package-lock.json \
  src public db \
  "${SSH_USER}:${PIXEL_REMOTE}/"

# Produktions-.env erzeugen: deploy.env + erkanntes EDGE_NETWORK
log ".env auf dem Server erzeugen (deploy.env + EDGE_NETWORK=$EDGE_NETWORK)"
TMP_ENV="$(mktemp)"
grep -v '^EDGE_NETWORK=' deploy.env > "$TMP_ENV"
echo "EDGE_NETWORK=${EDGE_NETWORK}" >> "$TMP_ENV"
scp $SSHO "$TMP_ENV" "${SSH_USER}:${PIXEL_REMOTE}/.env"
rm -f "$TMP_ENV"
ssh $SSHO "$SSH_USER" "chmod 600 ${PIXEL_REMOTE}/.env"

# ─── 3. PixelEuro-Stack bauen + starten ───
log "Schritt 3/4 — PixelEuro-Stack bauen + starten …"
ssh $SSHO "$SSH_USER" "cd ${PIXEL_REMOTE} && docker compose up -d --build"

# ─── 4. Caddy neu laden + Health ───
log "Schritt 4/4 — Caddy neu laden + Health-Checks …"
SEMESTO_REMOTE="/home/semesto/Semesto"
ssh $SSHO "$SSH_USER" "cd ${SEMESTO_REMOTE} && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile" \
  || warn "Caddy-Reload meldete einen Fehler (oft nur ACME für pixeleuro.de ohne DNS) — Semesto läuft weiter."

log "PixelEuro-Health (intern):"
if ssh $SSHO "$SSH_USER" "cd ${PIXEL_REMOTE} && docker compose exec -T pixeleuro node -e \"fetch('http://localhost:3000/api/config').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\""; then
  log "✓ PixelEuro antwortet intern."
else
  warn "PixelEuro antwortet intern noch nicht — Logs: ssh $SSH_USER 'cd $PIXEL_REMOTE && docker compose logs --tail=50 pixeleuro'"
fi

log "════════════════════════════════════════════════════════"
log " FERTIG."
log "   • Semesto API:  https://api.semesto.de/health"
log "   • PixelEuro:    https://pixeleuro.de   (sobald DNS A-Record → ${SERVER_IP} steht)"
log ""
log " DNS noch setzen: pixeleuro.de + www.pixeleuro.de  A  →  ${SERVER_IP}"
log " Danach holt Caddy automatisch das TLS-Zertifikat."
log "════════════════════════════════════════════════════════"
ssh $SSHO "$SSH_USER" "cd ${PIXEL_REMOTE} && docker compose ps"
