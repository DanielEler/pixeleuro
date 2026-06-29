#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════════
# PixelEuro + Semesto → BESTEHENDER Hetzner-Server, ohne SSH, ohne Neukauf.
#
# Liefert alles über HTTPS/443 (Firmennetz blockt nur Port 22):
#   1. Lokalen Working-Tree beider Projekte packen (inkl. uncommitted Fixes + Secrets)
#   2. Tarball + Bootstrap-Skript in den Object Storage laden (S3-Creds aus deploy.env)
#   3. Presigned URLs erzeugen (Server zieht Code/Bootstrap; meldet Log zurück)
#   4. EINE Zeile ausgeben, die du in der Hetzner-Web-Konsole (als root) einfügst.
#   5. Lokal auf die Fertig-Meldung des Servers pollen.
#
# Aufruf:  python3 scripts/deploy-console.py
# Erstellt/verändert KEINEN Server. Nur Object-Storage-Uploads + Anzeige.
# ═══════════════════════════════════════════════════════════════════════════
import sys, os, json, time, hashlib, hmac, datetime, subprocess, tempfile, urllib.parse, urllib.request, urllib.error

PIX_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEM_ROOT = os.path.join(os.path.dirname(PIX_ROOT), "Semesto")
SERVER_IP = os.environ.get("SERVER_IP", "159.69.184.92")

def log(m): print(f"\033[1;36m[deploy]\033[0m {m}", flush=True)
def die(m): sys.exit(f"\033[1;31m[fail]\033[0m {m}")

def load_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1); env[k] = v
    return env

SEC = load_env(os.path.join(SEM_ROOT, "secrets", "deploy.env"))
S3_ENDPOINT = SEC["S3_ENDPOINT"].rstrip("/"); S3_REGION = SEC["S3_REGION"]
S3_AK = SEC["S3_ACCESS_KEY"]; S3_SK = SEC["S3_SECRET_KEY"]; S3_BUCKET = SEC["S3_BUCKET"]
S3_HOST = urllib.parse.urlparse(S3_ENDPOINT).netloc

def _sign(key, msg): return hmac.new(key, msg.encode(), hashlib.sha256).digest()
def _sigkey(date):
    k = _sign(("AWS4"+S3_SK).encode(), date)
    return _sign(_sign(_sign(k, S3_REGION), "s3"), "aws4_request")
def _now():
    t = datetime.datetime.now(datetime.timezone.utc)
    return t.strftime("%Y%m%dT%H%M%SZ"), t.strftime("%Y%m%d")
def _cu(key): return "/" + S3_BUCKET + "/" + urllib.parse.quote(key, safe="/")

def s3_put(local_or_bytes, key):
    if isinstance(local_or_bytes, (bytes, bytearray)):
        body = bytes(local_or_bytes)
    else:
        with open(local_or_bytes, "rb") as f: body = f.read()
    amz, ds = _now(); ph = hashlib.sha256(body).hexdigest(); cu = _cu(key)
    ch = f"host:{S3_HOST}\nx-amz-content-sha256:{ph}\nx-amz-date:{amz}\n"
    sh = "host;x-amz-content-sha256;x-amz-date"
    creq = f"PUT\n{cu}\n\n{ch}\n{sh}\n{ph}"
    scope = f"{ds}/{S3_REGION}/s3/aws4_request"
    sts = f"AWS4-HMAC-SHA256\n{amz}\n{scope}\n{hashlib.sha256(creq.encode()).hexdigest()}"
    sig = hmac.new(_sigkey(ds), sts.encode(), hashlib.sha256).hexdigest()
    auth = f"AWS4-HMAC-SHA256 Credential={S3_AK}/{scope}, SignedHeaders={sh}, Signature={sig}"
    req = urllib.request.Request(S3_ENDPOINT+cu, data=body, method="PUT", headers={
        "Host": S3_HOST, "x-amz-date": amz, "x-amz-content-sha256": ph,
        "Authorization": auth, "Content-Length": str(len(body))})
    with urllib.request.urlopen(req, timeout=120) as r:
        log(f"hochgeladen: {key} ({len(body)//1024 or 1} KB) → {r.status}")

def s3_presign(key, method, expires):
    amz, ds = _now(); scope = f"{ds}/{S3_REGION}/s3/aws4_request"; cu = _cu(key)
    q = {"X-Amz-Algorithm":"AWS4-HMAC-SHA256","X-Amz-Credential":f"{S3_AK}/{scope}",
         "X-Amz-Date":amz,"X-Amz-Expires":str(expires),"X-Amz-SignedHeaders":"host"}
    cqs = "&".join(f"{urllib.parse.quote(k,safe='')}={urllib.parse.quote(v,safe='')}"
                   for k,v in sorted(q.items()))
    creq = f"{method}\n{cu}\n{cqs}\nhost:{S3_HOST}\n\nhost\nUNSIGNED-PAYLOAD"
    sts = f"AWS4-HMAC-SHA256\n{amz}\n{scope}\n{hashlib.sha256(creq.encode()).hexdigest()}"
    sig = hmac.new(_sigkey(ds), sts.encode(), hashlib.sha256).hexdigest()
    return f"{S3_ENDPOINT}{cu}?{cqs}&X-Amz-Signature={sig}"

def s3_get(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""

def bootstrap(get_url, status_put_url):
    return f"""#!/bin/bash
set -uxo pipefail
exec > /var/log/stack-bootstrap.log 2>&1
report() {{ curl -sS -m30 -X PUT --data-binary @/var/log/stack-bootstrap.log "{status_put_url}" || true; }}
trap report EXIT
export DEBIAN_FRONTEND=noninteractive

# Swap (4GB-Server: Docker-Builds nicht durch OOM killen lassen)
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile || true
fi

if ! command -v docker >/dev/null 2>&1; then
  for i in $(seq 1 40); do apt-get update && break || sleep 5; done
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
  for i in $(seq 1 40); do apt-get update && break || sleep 5; done
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

rm -rf /opt/stack && mkdir -p /opt/stack
curl -fsSL "{get_url}" -o /opt/stack.tgz
tar xzf /opt/stack.tgz -C /opt/stack

# ─── Semesto ───
cd /opt/stack/Semesto
cp secrets/deploy.env .env
docker compose up -d --build

NET=""
for i in $(seq 1 30); do NET=$(docker network ls --format '{{{{.Name}}}}' | grep -E '^semesto.*default$' | head -1); [ -n "$NET" ] && break; sleep 2; done

# ─── PixelEuro ───
cd /opt/stack/PixelEuro
grep -v '^EDGE_NETWORK=' deploy.env > .env
echo "EDGE_NETWORK=${{NET:-semesto_default}}" >> .env
docker compose up -d --build

# Caddy neu laden, damit pixeleuro.de greift
cd /opt/stack/Semesto
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile || true

echo "=== STACK-DEPLOY FERTIG $(date -u) ==="
docker ps --format 'table {{{{.Names}}}}\t{{{{.Status}}}}'
echo "STACK_BOOTSTRAP_DONE"
"""

def pack(tgz):
    with tempfile.TemporaryDirectory() as tmp:
        stage = os.path.join(tmp, "stack"); os.makedirs(stage)
        sem_dst = os.path.join(stage, "Semesto"); os.makedirs(sem_dst)
        subprocess.check_call(["rsync","-a",
            "--exclude","node_modules","--exclude",".git","--exclude","dist",
            "--exclude","ios","--exclude","android","--exclude","screenshots","--exclude","docs",
            "--exclude",".DS_Store", SEM_ROOT+"/", sem_dst])
        pix_dst = os.path.join(stage, "PixelEuro"); os.makedirs(pix_dst)
        subprocess.check_call(["rsync","-a",
            "--exclude","node_modules","--exclude",".git","--exclude","dist",
            "--exclude",".idea","--exclude","worker","--exclude",".DS_Store",
            PIX_ROOT+"/", pix_dst])
        subprocess.check_call(["tar","czf",tgz,"-C",stage,"Semesto","PixelEuro"])

def main():
    ts = subprocess.check_output(["date","+%Y%m%d-%H%M%S"]).decode().strip()
    k_code   = f"_deploy/stack-{ts}.tgz"
    k_boot   = f"_deploy/boot-{ts}.sh"
    k_status = f"_deploy/status-{ts}.log"

    log("packe lokalen Stand beider Projekte (inkl. uncommitted Fixes + Secrets) …")
    with tempfile.TemporaryDirectory() as tmp:
        tgz = os.path.join(tmp, "stack.tgz"); pack(tgz)
        log(f"Payload: {os.path.getsize(tgz)//1024} KB")
        s3_put(tgz, k_code)

    get_url    = s3_presign(k_code, "GET", 6*3600)
    status_put = s3_presign(k_status, "PUT", 6*3600)
    boot = bootstrap(get_url, status_put)
    s3_put(boot.encode(), k_boot)
    boot_url   = s3_presign(k_boot, "GET", 6*3600)
    poll_url   = s3_presign(k_status, "GET", 6*3600)

    one_liner = f'curl -fsSL "{boot_url}" -o /tmp/boot.sh && bash /tmp/boot.sh'

    print("\n" + "="*72)
    print(" SO GEHT'S — in der Hetzner Cloud Console (Browser, kein SSH):")
    print("="*72)
    print(f" 1) https://console.hetzner.cloud  →  Projekt  →  Server 'Semesto'")
    print(f"    →  oben rechts  >_  Console  öffnen")
    print(f" 2) Als root einloggen (Login: 1Password 'Login-Root-Konsole-Hetzner').")
    print(f" 3) Diese EINE Zeile einfügen (Toolbar-Paste) und Enter:")
    print()
    print(one_liner)
    print()
    print(" Danach läuft der Deploy automatisch (~4–8 Min). Ich warte hier auf die Meldung.")
    print("="*72 + "\n")

    # Datei mit der Zeile, falls Copy/Paste aus dem Terminal einfacher ist
    with open(os.path.join(PIX_ROOT, ".console-command.txt"), "w") as f:
        f.write(one_liner + "\n")
    log("Befehl auch gespeichert in .console-command.txt")

    log("polle auf Fertig-Meldung des Servers (Strg-C bricht nur das Warten ab, nicht den Deploy) …")
    deadline = time.time() + 25*60
    while time.time() < deadline:
        time.sleep(20)
        code, content = s3_get(poll_url)
        if code == 200 and content:
            if b"STACK_BOOTSTRAP_DONE" in content:
                log("✓✓ DEPLOY FERTIG — Server meldet Erfolg.")
                tail = content.decode("utf-8","replace").splitlines()[-30:]
                print("\n----- letzte Server-Log-Zeilen -----\n" + "\n".join(tail))
                break
            lines = content.strip().splitlines()
            last = lines[-1][:80].decode("utf-8","replace") if lines else ""
            log(f"  … läuft ({len(content)} bytes) – {last}")
        else:
            log("  … noch keine Meldung (du eingeloggt & Zeile abgeschickt?)")
    else:
        log("⚠ Timeout beim Warten — Deploy kann noch laufen. Nochmal pollen: erneut starten o. melde dich.")

    print("\n" + "="*72)
    print(f" Nach erfolgreichem Deploy DNS A-Records auf {SERVER_IP} setzen:")
    print(f"   semesto.de, www.semesto.de, api.semesto.de   →  {SERVER_IP}")
    print(f"   pixeleuro.de, www.pixeleuro.de               →  {SERVER_IP}")
    print("="*72)

if __name__ == "__main__":
    main()
