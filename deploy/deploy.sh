#!/bin/bash
set -e

REPO_DIR="/root/ai-vision-rover"

if [ -d "$REPO_DIR" ]; then
  cd "$REPO_DIR"
  git fetch origin
  git reset --hard origin/main
else
  git clone https://github.com/airton-canale/ai-vision-rover.git "$REPO_DIR"
  cd "$REPO_DIR"
fi

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

cd "$REPO_DIR/frontend"
npm ci --no-audit --no-fund
npm run build
cd "$REPO_DIR"

pip3 install -r server/requirements.txt --break-system-packages --quiet

cp deploy/rover-cam.service /etc/systemd/system/rover-cam.service
systemctl daemon-reload
systemctl enable rover-cam

systemctl restart rover-cam

sleep 2
systemctl status rover-cam --no-pager || true
