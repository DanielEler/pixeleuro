#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════════
# PixelEuro + Semesto — SSH-FREIER Deploy via Hetzner Cloud API + cloud-init.
#
# Warum: Das Firmennetz blockt ausgehenden Port 22 (SSH) komplett. Alles hier
# läuft NUR über HTTPS/443:
#   1. Lokalen Working-Tree beider Projekte packen (inkl. uncommitted Fixes + Secrets)
#   2. Tarball in den Hetzner Object Storage laden (S3-Creds aus Semesto/secrets/deploy.env)
#   3. Presigned GET-URL erzeugen (Server zieht den Code), presigned PUT-URL (Server
#      meldet seinen Deploy-Log zurück) — beide kurzlebig.
#   4. Neuen Hetzner-Server per API erstellen; cloud-init deployt ihn vollautomatisch.
#   5. Lokal auf die Fertig-Meldung des Servers pollen (kein SSH).
#
# Aufruf:
#   HCLOUD_TOKEN=... python3 scripts/deploy-hetzner-api.py
#   (oder Token in Datei .hetzner-token im Repo-Root / via 1Password)
#
# Nicht-destruktiv: erstellt einen NEUEN Server, fasst vorhandene nicht an.
# ═══════════════════════════════════════════════════════════════════════════
import sys, os, json, time, hashlib, hmac, datetime, subprocess, tempfile, urllib.parse, urllib.request, urllib.error

PIX_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEM_ROOT = os.path.join(os.path.dirname(PIX_ROOT), "Semesto")
SERVER_NAME = os.environ.get("SERVER_NAME", "pixel-semesto")
LOCATION    = os.environ.get("HCLOUD_LOCATION", "fsn1")
IMAGE       = os.environ.get("HCLOUD_IMAGE", "ubuntu-24.04")
# Deploy-Key (pixeleuro-deploy) – damit du später aus einem freien Netz auch per SSH rankommst
SSH_KEY_IDS = [int(x) for x in os.environ.get("HCLOUD_SSH_KEYS", "114159157").split(",") if x.strip()]

def log(m): print(f"\033[1;36m[api]\033[0m {m}", flush=True)
def die(m): sys.exit(f"\033[1;31m[fail]\033[0m {m}")

# ─── S3 Creds laden ───
def load_deploy_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1); env[k] = v
    return env

SEC = load_deploy_env(os.path.join(SEM_ROOT, "secrets", "deploy.env"))
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

def s3_put(local, key):
    with open(local, "rb") as f: body = f.read()
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
        log(f"hochgeladen: {key} ({len(body)} bytes) → {r.status}")

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

# ─── Hetzner API ───
def hc_token():
    t = os.environ.get("HCLOUD_TOKEN")
    if t: return t.strip()
    for p in [os.path.join(PIX_ROOT, ".hetzner-token"), os.path.expanduser("~/.config/hcloud-token")]:
        if os.path.exists(p):
            return open(p).read().strip()
    die("Kein Hetzner-Token. Setze HCLOUD_TOKEN=... oder lege .hetzner-token im Repo-Root an.")

HC = hc_token()
def hc(method, path, body=None):
    url = "https://api.hetzner.cloud/v1" + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
        headers={"Authorization": f"Bearer {HC}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def pick_server_type():
    want = os.environ.get("HCLOUD_TYPE")
    st, data = hc("GET", "/server_types?per_page=50")
    if st != 200: die(f"server_types: {st} {data}")
    types = {t["name"]: t for t in data["server_types"] if not t.get("deprecated")}
    if want:
        if want not in types: die(f"Typ {want} nicht verfügbar. Verfügbar: {sorted(types)}")
        return want
    # x86, >= 8 GB RAM, lokaler Speicher, günstigster
    cand = [t for t in types.values()
            if t.get("architecture") == "x86" and t.get("memory", 0) >= 4
            and t.get("storage_type") == "local"]
    cand.sort(key=lambda t: t.get("cores", 99))
    if not cand: die(f"Kein passender Typ (>=8GB x86) gefunden: {sorted(types)}")
    return cand[0]["name"]

def build_user_data(get_url, status_put_url):
    return f"""#!/bin/bash
set -uxo pipefail
exec > /var/log/stack-bootstrap.log 2>&1
report() {{ curl -sS -m30 -X PUT --data-binary @/var/log/stack-bootstrap.log "{status_put_url}" || true; }}
trap report EXIT
export DEBIAN_FRONTEND=noninteractive

# Swap (4GB-Server: Docker-Builds nicht durch OOM killen lassen)
if [ ! -f /swapfile ]; then
  fallocate -l 3G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile || true
  echo '/swapfile none swap sw 0 0' >> /etc/fstab || true
fi

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

mkdir -p /opt/stack
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

# Caddy neu laden (pixeleuro-vhost aktiv)
cd /opt/stack/Semesto
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile || true

echo "=== STACK-DEPLOY FERTIG $(date -u) ==="
docker compose -f /opt/stack/Semesto/docker-compose.yml ps
docker compose -f /opt/stack/PixelEuro/docker-compose.yml ps
echo "STACK_BOOTSTRAP_DONE"
"""

def main():
    ts = subprocess.check_output(["date", "+%Y%m%d-%H%M%S"]).decode().strip()
    key_code = f"_deploy/stack-{ts}.tgz"
    key_status = f"_deploy/status-{ts}.log"

    # 1) Working-Tree beider Projekte in eine staging-Struktur packen
    log("packe lokalen Stand (inkl. uncommitted Fixes + Secrets) …")
    with tempfile.TemporaryDirectory() as tmp:
        tgz = os.path.join(tmp, "stack.tgz")
        # rsync in staging, dann tar -> saubere /Semesto und /PixelEuro Top-Dirs
        stage = os.path.join(tmp, "stack"); os.makedirs(stage)
        def rsync(src, dst, includes):
            subprocess.check_call(["rsync","-a",
                "--exclude","node_modules","--exclude",".git","--exclude","dist",
                "--exclude",".idea","--exclude",".DS_Store"] + includes +
                [src+"/", dst])
        sem_dst = os.path.join(stage, "Semesto"); os.makedirs(sem_dst)
        subprocess.check_call(["rsync","-a",
            "--exclude","node_modules","--exclude",".git","--exclude","dist",
            "--exclude","ios","--exclude","android","--exclude","screenshots","--exclude","docs",
            "--exclude",".DS_Store",
            SEM_ROOT+"/", sem_dst])
        pix_dst = os.path.join(stage, "PixelEuro"); os.makedirs(pix_dst)
        subprocess.check_call(["rsync","-a",
            "--exclude","node_modules","--exclude",".git","--exclude","dist",
            "--exclude",".idea","--exclude","worker","--exclude",".DS_Store",
            PIX_ROOT+"/", pix_dst])
        subprocess.check_call(["tar","czf",tgz,"-C",stage,"Semesto","PixelEuro"])
        sz = os.path.getsize(tgz); log(f"Payload: {sz//1024} KB")

        # 2) hochladen
        s3_put(tgz, key_code)

    # 3) presignen
    get_url  = s3_presign(key_code, "GET", 3*3600)
    put_url  = s3_presign(key_status, "PUT", 3*3600)
    poll_url = s3_presign(key_status, "GET", 3*3600)

    # 4) Server-Typ + create
    stype = pick_server_type()
    log(f"Server-Typ: {stype}, Location: {LOCATION}, Image: {IMAGE}")
    ud = build_user_data(get_url, put_url)
    body = {"name": SERVER_NAME, "server_type": stype, "image": IMAGE,
            "location": LOCATION, "start_after_create": True,
            "user_data": ud, "public_net": {"enable_ipv4": True, "enable_ipv6": True}}
    if SSH_KEY_IDS: body["ssh_keys"] = SSH_KEY_IDS
    st, data = hc("POST", "/servers", body)
    if st not in (200, 201):
        die(f"Server-Create fehlgeschlagen: {st} {json.dumps(data)[:400]}")
    srv = data["server"]; sid = srv["id"]; ip = srv["public_net"]["ipv4"]["ip"]
    log(f"✓ Server erstellt: ID {sid}, IP {ip}")
    log(f"  (cloud-init deployt jetzt automatisch — dauert ~4–8 Min für die Docker-Builds)")

    # 5) auf Fertig-Meldung pollen
    log("warte auf Deploy-Meldung des Servers (kein SSH nötig) …")
    deadline = time.time() + 20*60
    last = b""
    while time.time() < deadline:
        time.sleep(20)
        code, content = s3_get(poll_url)
        if code == 200 and content:
            last = content
            if b"STACK_BOOTSTRAP_DONE" in content:
                log("✓✓ DEPLOY FERTIG — Server meldet Erfolg.")
                break
            log(f"  … läuft (Log {len(content)} bytes, letzte Zeile: {content.strip().splitlines()[-1][:80].decode('utf-8','replace') if content.strip() else ''})")
        else:
            log("  … Server bootet / installiert noch (noch keine Meldung)")
    else:
        log("⚠ Timeout beim Warten. Server läuft evtl. noch — Log unten ist der letzte Stand.")

    print("\n" + "="*70)
    print(f" Server-IP: {ip}   (Server-ID {sid})")
    print(" Nächster Schritt — DNS setzen (A-Records auf diese IP):")
    print(f"   semesto.de, www.semesto.de, api.semesto.de   →  {ip}")
    print(f"   pixeleuro.de, www.pixeleuro.de               →  {ip}")
    print(" Danach holt Caddy automatisch TLS-Zertifikate.")
    print("="*70)
    if last:
        print("\n----- letzte Server-Log-Zeilen -----")
        print("\n".join(last.decode("utf-8","replace").splitlines()[-25:]))

if __name__ == "__main__":
    main()
