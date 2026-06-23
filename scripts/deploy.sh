#!/usr/bin/env bash
# Deploy the CoinDCX bot as an always-on systemd service. Idempotent: re-run to update.
#
# Usage (on a fresh Ubuntu/Debian VPS, as root or with sudo):
#   REPO=git@github.com:you/coindcx.git ./deploy.sh
#   # or if the code is already in /opt/coindcx, just:  ./deploy.sh
#
# After first run, put your real .env at $DIR/.env (chmod 600) and:  systemctl restart coindcx-bot
set -euo pipefail

DIR="${DIR:-/opt/coindcx}"
REPO="${REPO:-}"
SERVICE="coindcx-bot"
PYTHON="${PYTHON:-python3}"

# --- need root for systemd + /opt ---
if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (or: sudo REPO=... $0)"; exit 1
fi

# --- code: clone if REPO given and dir absent, else pull if it's a repo ---
if [ -n "$REPO" ] && [ ! -d "$DIR/.git" ]; then
  echo ">> cloning $REPO -> $DIR"
  git clone "$REPO" "$DIR"
elif [ -d "$DIR/.git" ]; then
  echo ">> updating $DIR"
  git -C "$DIR" pull --ff-only
elif [ ! -d "$DIR" ]; then
  echo "No code at $DIR and no REPO set. Set REPO=<git-url> or copy code to $DIR first."; exit 1
fi

# --- venv + deps ---
echo ">> venv + dependencies"
[ -d "$DIR/.venv" ] || "$PYTHON" -m venv "$DIR/.venv"
"$DIR/.venv/bin/pip" install -q --upgrade pip
"$DIR/.venv/bin/pip" install -q -r "$DIR/requirements.txt"

# --- .env check (never created here — secrets are yours to place) ---
if [ ! -f "$DIR/.env" ]; then
  echo "!! No $DIR/.env yet — bot will run in DRY_RUN. Add keys + 'chmod 600 .env' then restart."
  [ -f "$DIR/.env.example" ] && cp "$DIR/.env.example" "$DIR/.env" && chmod 600 "$DIR/.env"
fi
chmod 600 "$DIR/.env" 2>/dev/null || true
mkdir -p "$DIR/data"

# --- systemd unit ---
echo ">> installing $SERVICE.service"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=CoinDCX trading bot
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$DIR
ExecStart=$DIR/.venv/bin/python -m bot.engine
EnvironmentFile=$DIR/.env
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE"
systemctl restart "$SERVICE"

echo
echo ">> done. status / logs:"
echo "   systemctl status $SERVICE"
echo "   journalctl -u $SERVICE -f"
