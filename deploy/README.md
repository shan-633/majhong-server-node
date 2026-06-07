# Deployment

Three ways to deploy the Sichuan Mahjong server. All of them end with the
server listening on `PORT` (default `3000`) with a health endpoint at
`/healthz`.

> The code lives on the `claude/sichuan-mahjong-server-RQZ94` branch of
> `shan-633/majhong-server-node`. The scripts default to that repo/branch.

## Option A — one command on the server (recommended)

SSH into the box and run the setup script. It installs **Docker** (if missing),
clones the repo, builds the image, and runs the app as a container with a
`restart unless-stopped` policy (so it survives reboots and crashes).

```bash
ssh root@45.76.49.222
# then, on the server:
curl -fsSL https://raw.githubusercontent.com/shan-633/majhong-server-node/claude/sichuan-mahjong-server-RQZ94/deploy/remote-setup.sh | PORT=3000 bash
```

If the repo is private, clone it manually first (or set `REPO_URL` to an
authenticated URL) and run `bash deploy/remote-setup.sh` from inside the
checkout.

Manage it afterwards:

```bash
docker ps                       # see the running container
docker logs -f majhong-server   # live logs
docker restart majhong-server
docker rm -f majhong-server     # stop & remove
```

To redeploy after new commits, just re-run the same `curl … | bash` line — the
script pulls the latest branch and rebuilds the image.

## Option B — push from your laptop over SSH

From a machine that can reach the server (this script needs an SSH client):

```bash
./deploy/push-deploy.sh root@45.76.49.222
```

It copies `remote-setup.sh` to the server and runs it. You'll be prompted for
the SSH password unless you use a key.

## Option C — Docker by hand (no setup script)

If you already have the repo checked out on a host with Docker:

```bash
docker compose up -d --build
# or
docker build -t majhong-server .
docker run -d --restart unless-stopped -p 3000:3000 --name majhong majhong-server
```

## Verify

```bash
curl http://<server-ip>:3000/healthz      # -> {"ok":true,...}
```

Then open `http://<server-ip>:3000/` in a browser, Join a room, and Start.

## Firewall

If you use `ufw`, open the port:

```bash
ufw allow 3000/tcp
```

To serve on 80/443 behind Nginx, proxy to `http://127.0.0.1:3000` and enable
WebSocket upgrade headers (`proxy_set_header Upgrade $http_upgrade;` /
`proxy_set_header Connection "upgrade";`) so Socket.IO works.
