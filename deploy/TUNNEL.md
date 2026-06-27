# Permanent bot URL (ngrok free static domain)

The bot's status server listens on `127.0.0.1:8787`. Vercel can't reach a bare VPS port,
so we expose it over HTTPS. ngrok's **free** plan gives **one permanent static URL**
(e.g. `https://coindcx-bangar.ngrok-free.app`) — unlike a Cloudflare *quick* tunnel, the
URL never changes, and running it as a service means it survives reboots and VPS sleep.

> Why not Cloudflare? A named Cloudflare tunnel needs a domain you own. A `*.vercel.app`
> address belongs to Vercel and can't be registered — ngrok needs no domain at all.

One-time setup on the VPS (Linux, systemd):

```bash
# 1. Sign up (free): https://dashboard.ngrok.com/signup

# 2. Reserve your free static domain:
#    Dashboard -> Domains -> "+ New Domain" -> copy it, e.g. coindcx-bangar.ngrok-free.app

# 3. Install ngrok
curl -sSL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz \
  | sudo tar -xz -C /usr/local/bin
#    (or: https://ngrok.com/download)

# 4. Add your authtoken (Dashboard -> Your Authtoken). Run as the SAME user the
#    service runs as — root here, since the unit has no `User=`:
sudo ngrok config add-authtoken <YOUR_AUTHTOKEN>

# 5. Drop in the static URL you reserved in step 2
sudo cp /opt/coindcx/deploy/coindcx-tunnel.service /etc/systemd/system/
sudo sed -i 's#YOUR-STATIC.ngrok-free.app#coindcx-bangar.ngrok-free.app#' \
  /etc/systemd/system/coindcx-tunnel.service     # use YOUR reserved domain

# 6. Enable + start so it auto-starts forever
sudo systemctl daemon-reload
sudo systemctl enable --now coindcx-tunnel.service
sudo systemctl status coindcx-tunnel.service
```

Then set the PWA's `BOT_API_URL` on Vercel to `https://coindcx-bangar.ngrok-free.app`
**once** — it never changes again.

Make sure the status server itself also auto-starts:

```bash
sudo systemctl enable --now coindcx-status.service
```

Quick check after a reboot:

```bash
systemctl is-active coindcx-tunnel coindcx-status   # both: active
curl https://coindcx-bangar.ngrok-free.app/status -H "X-Token: <your BOT_API_TOKEN>"
```
