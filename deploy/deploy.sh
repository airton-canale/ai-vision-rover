#!/bin/bash
# Runs ON the Orange Pi (invoked over SSH by the GitHub Actions workflow)
set -e

REPO_DIR="/root/ai-vision-rover"
SERVICE_NAME="rover-cam"

echo "==> Pulling latest code..."
if [ -d "$REPO_DIR" ]; then
  cd "$REPO_DIR"
  git fetch origin
  git reset --hard origin/main
else
  git clone https://github.com/airton-canale/ai-vision-rover.git "$REPO_DIR"
  cd "$REPO_DIR"
fi

echo "==> Installing Node.js if missing..."
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Building frontend..."
cd "$REPO_DIR/frontend"
npm ci --no-audit --no-fund
npm run build
cd "$REPO_DIR"

echo "==> Installing/upgrading Python dependencies..."
pip3 install -r server/requirements.txt --break-system-packages --quiet

echo "==> Installing systemd service (if not already installed)..."
cp deploy/rover-cam.service /etc/systemd/system/rover-cam.service
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo "==> Restarting service..."
systemctl restart "$SERVICE_NAME"

sleep 2
systemctl status "$SERVICE_NAME" --no-pager || true

echo "==> Deploy complete!"
