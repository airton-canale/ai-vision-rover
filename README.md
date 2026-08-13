# AI Vision Rover

Raspberry-Pi-style rover project running on an **Orange Pi 4 LTS**, streaming camera feed to a **Mission Control** web dashboard, with CI/CD auto-deploy via GitHub Actions + Tailscale.

## Project structure

```
ai-vision-rover/
├── .github/workflows/deploy.yml
├── server/
│   ├── main.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── static/
├── deploy/
│   ├── deploy.sh
│   └── rover-cam.service
└── README.md
```

## Frontend dev

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173, proxies /ws → localhost:8000
```

Run the FastAPI server separately (`python3 server/main.py`) for the WebSocket feed.

Production build (auto-run by `deploy.sh` on the Orange Pi):

```bash
cd frontend
npm run build   # outputs to ../static
```

---

## CI/CD Setup (one-time)

### 1. Install Tailscale on the Orange Pi

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

Follow the printed URL to authenticate. Then get its Tailscale IP:

```bash
tailscale ip -4
```

Save this IP — you'll need it for the GitHub secret below.

### 2. Create a Tailscale OAuth client (for GitHub Actions)

Go to https://login.tailscale.com/admin/settings/oauth → **Generate OAuth client**.
Give it the `tag:ci` tag capability. Save the **Client ID** and **Client Secret**.

### 3. Generate an SSH key pair for GitHub Actions → Orange Pi

On your own machine:
```bash
ssh-keygen -t ed25519 -f deploy_key -N ""
```

Copy the **public key** (`deploy_key.pub`) to the Orange Pi's authorized keys:
```bash
ssh-copy-id -i deploy_key.pub root@<orange_pi_tailscale_ip>
```

### 4. Add GitHub repo secrets

Go to **Settings → Secrets and variables → Actions** on the repo and add:

| Secret name | Value |
|---|---|
| `TS_OAUTH_CLIENT_ID` | From step 2 |
| `TS_OAUTH_SECRET` | From step 2 |
| `ORANGE_PI_SSH_KEY` | Contents of the **private** key (`deploy_key`) from step 3 |
| `ORANGE_PI_TAILSCALE_IP` | The Tailscale IP from step 1 |

### 5. Push to main or trigger manually

Every merge to `main` (or a manual "Run workflow" click in the Actions tab) will:
1. Connect the GitHub runner to your Tailscale network
2. SSH into the Orange Pi
3. Pull the latest code
4. Reinstall dependencies if needed
5. Restart the `rover-cam` systemd service

---

## Manual run (without CI/CD)

```bash
cd frontend && npm ci && npm run build && cd ..
cd server
pip3 install -r requirements.txt --break-system-packages
python3 main.py
```

Open `http://<orange_pi_ip>:8000` and click **Connect**.

---

## Notes

- Camera index is set via the `CAMERA_INDEX` env var in `rover-cam.service` (defaults to `5`, matched to our Logitech C270 on `/dev/video5`). Adjust if your camera enumerates differently — check with `v4l2-ctl --list-devices`.
- `opencv-python` is intentionally excluded from `requirements.txt` — install `python3-opencv` via `apt` on the Orange Pi instead, to avoid a numpy version conflict with the system package.
