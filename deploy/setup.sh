#!/usr/bin/env bash
# Filmwriter — one-shot deploy on a fresh Ubuntu ECS box (run from the repo root).
#   sudo bash deploy/setup.sh
# Stands up the Node orchestrator + the existing Cloudflare named tunnel as systemd
# services (auto-restart, start on boot). filmwriter.tlz.us carries over unchanged
# because we reuse the same tunnel ID.
#
# BEFORE running, on the box:
#   1. git clone <your-repo> /opt/filmwriter   (so this file is at /opt/filmwriter/deploy/setup.sh)
#   2. scp the tunnel credential from Vesper (C:\Users\solti\.cloudflared\<ID>.json)
#        ->  ~/.cloudflared/<ID>.json   on the box
#   3. have your QWEN_API_KEY ready (you'll be prompted; it never gets committed)
set -euo pipefail

APP_DIR=/opt/filmwriter
TUNNEL_ID=5b7b0f3f-1b2c-4ec9-a341-c086550c0c89
FQDN=filmwriter.tlz.us
CF_DIR=/etc/cloudflared

echo "== 1/6 Node 20 =="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "== 2/6 cloudflared =="
if ! command -v cloudflared >/dev/null 2>&1; then
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb
  sudo dpkg -i /tmp/cf.deb
fi
cloudflared --version

echo "== 3/6 tunnel credential + config =="
sudo mkdir -p "$CF_DIR"
CRED="$HOME/.cloudflared/$TUNNEL_ID.json"
[ -f "$CRED" ] || CRED="$CF_DIR/$TUNNEL_ID.json"
if [ ! -f "$CRED" ]; then
  echo "!! Missing $TUNNEL_ID.json — scp it from Vesper to ~/.cloudflared/ first."; exit 1
fi
sudo cp "$CRED" "$CF_DIR/$TUNNEL_ID.json"
sudo tee "$CF_DIR/config.yml" >/dev/null <<YML
tunnel: $TUNNEL_ID
credentials-file: $CF_DIR/$TUNNEL_ID.json
ingress:
  - hostname: $FQDN
    service: http://localhost:8787
  - service: http_status:404
YML

echo "== 4/6 app env =="
if [ ! -f "$APP_DIR/.env" ]; then
  read -rsp "Paste QWEN_API_KEY: " KEY; echo
  echo "QWEN_API_KEY=$KEY" | sudo tee "$APP_DIR/.env" >/dev/null
  sudo chmod 600 "$APP_DIR/.env"
fi

echo "== 5/6 systemd services =="
sudo cp "$APP_DIR/deploy/filmwriter.service"  /etc/systemd/system/filmwriter.service
sudo cp "$APP_DIR/deploy/cloudflared.service" /etc/systemd/system/cloudflared.service
sudo systemctl daemon-reload
sudo systemctl enable --now filmwriter cloudflared
sleep 3

echo "== 6/6 health =="
curl -s http://localhost:8787/api && echo
systemctl --no-pager --plain status filmwriter cloudflared | grep -E 'filmwriter|cloudflared|Active' || true
echo
echo ">> Deployed. Test https://$FQDN  then STOP the Vesper tunnel so only ECS serves it."
