# Permanent bot URL (named Cloudflare tunnel)

The quick tunnel (`cloudflared tunnel --url ...`) gives a **random** `*.trycloudflare.com`
that dies when the terminal closes. A **named tunnel** gives a fixed hostname
(`bot.yourdomain.com`) and runs as a service, so it survives reboots and VPS sleep.

One-time setup on the VPS (Linux, systemd). Your domain must already be a zone on your
Cloudflare account.

```bash
# 1. Install cloudflared (if not already)
#    https://pkg.cloudflare.com/  (or download the binary to /usr/local/bin/cloudflared)

# 2. Authenticate (opens a browser link; pick your zone)
cloudflared tunnel login

# 3. Create the tunnel — writes credentials to ~/.cloudflared/<UUID>.json
cloudflared tunnel create coindcx

# 4. Put the config + credentials where the service expects them
sudo mkdir -p /etc/cloudflared
sudo cp /path/to/repo/deploy/cloudflared-config.yml /etc/cloudflared/config.yml
sudo cp ~/.cloudflared/<UUID>.json /etc/cloudflared/coindcx.json
#    Edit /etc/cloudflared/config.yml: set `hostname:` to your real subdomain.

# 5. Point DNS at the tunnel (creates a proxied CNAME automatically)
cloudflared tunnel route dns coindcx bot.yourdomain.com

# 6. Install + enable the service so it auto-starts forever
sudo cp /path/to/repo/deploy/coindcx-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now coindcx-tunnel.service
sudo systemctl status coindcx-tunnel.service
```

Then set the PWA's `BOT_API_URL` on Vercel to `https://bot.yourdomain.com` **once** — it
never changes again.

Make sure the status server itself also auto-starts:

```bash
sudo systemctl enable --now coindcx-status.service
```
